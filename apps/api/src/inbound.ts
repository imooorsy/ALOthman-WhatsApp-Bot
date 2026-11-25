import {
  BadRequestException,
  Body,
  Controller,
  Injectable,
  NotFoundException,
  Post,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { ConversationMachine, phoneSchema } from "@osman/shared";
import { Db } from "./db";
import { AuthGuard, Admin } from "./auth";
import { SettingsService } from "./settings";
import { AgentService } from "./agent";
import { WhatsAppProvider } from "./whatsapp";
import { lockConversation } from "./chats";
import { QueueService } from "./queue";
import { RealtimeGateway } from "./realtime";
import { events } from "@osman/shared";
export const inboundSchema = z.object({
  id: z.string().min(1).max(200),
  phone: phoneSchema,
  text: z.string().max(10000),
  type: z.enum(["text", "image", "audio", "document", "other"]).default("text"),
  at: z.string().datetime().optional(),
});
export type Inbound = z.infer<typeof inboundSchema>;
@Injectable()
export class InboundService {
  constructor(
    private db: Db,
    private settings: SettingsService,
    private agent: AgentService,
    private wa: WhatsAppProvider,
    private queue: QueueService,
    private realtime: RealtimeGateway,
  ) {}
  async receive(input: Inbound) {
    const config = await this.settings.get();
    const result = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${input.phone},0))`;
      const duplicate = await tx.message.findUnique({
        where: { waMessageId: input.id },
      });
      if (duplicate) return { id: duplicate.conversationId, duplicate: true };
      let client = await tx.client.findUnique({
        where: { phone: input.phone },
      });
      if (!client)
        client = await tx.client.create({ data: { phone: input.phone } });
      // Keep terminal conversations addressable: default not_suitable policy is silent storage.
      let chat = await tx.conversation.findFirst({
        where: { clientId: client.id },
        orderBy: { lastActivityAt: "desc" },
      });
      if (!chat)
        chat = await tx.conversation.create({
          data: {
            clientId: client.id,
            lastClientMessageAt: input.at ? new Date(input.at) : new Date(),
          },
        });
      await lockConversation(tx, chat.id);
      chat = await tx.conversation.findUniqueOrThrow({
        where: { id: chat.id },
      });
      const policy = ConversationMachine.inbound(
        chat.status,
        config.rules.paused,
        input.type !== "text",
        {
          attachmentHandoff: process.env.ATTACHMENT_HANDOFF !== "false",
          notifyWaiting: process.env.NOTIFY_WAITING !== "false",
          notifyNotSuitable: process.env.NOTIFY_NOT_SUITABLE === "true",
        },
      );
      const labels = {
        image: "صورة",
        audio: "رسالة صوتية",
        document: "مستند",
        other: "آخر",
        text: "",
      };
      const at = input.at ? new Date(input.at) : new Date();
      await tx.message.create({
        data: {
          conversationId: chat.id,
          waMessageId: input.id,
          direction: "client",
          type: input.type,
          text:
            input.type === "text"
              ? input.text
              : `[مرفق: ${labels[input.type]}]`,
          deliveryStatus: "received",
          createdAt: at,
          processedAt: policy.callAgent ? null : new Date(),
        },
      });
      await tx.conversation.update({
        where: { id: chat.id },
        data: {
          status: policy.status,
          unreadCount: { increment: 1 },
          version: { increment: 1 },
          lastActivityAt: new Date(),
          lastClientMessageAt:
            at > chat.lastClientMessageAt ? at : chat.lastClientMessageAt,
        },
      });
      if (policy.status !== chat.status)
        await tx.conversationEvent.create({
          data: {
            conversationId: chat.id,
            type: "inbound.handoff",
            payload: {
              reason: policy.reason,
              previousStatus: chat.status,
              status: policy.status,
            },
          },
        });
      const notification = policy.notify
        ? await tx.notification.create({
            data: {
              conversationId: chat.id,
              type: policy.status === "urgent" ? "urgent" : "message",
              reason: policy.reason,
            },
          })
        : null;
      if (policy.callAgent) await this.queue.enqueue(chat.id, tx);
      return {
        id: chat.id,
        duplicate: false,
        notificationId: notification?.id,
      };
    });
    if (!result.duplicate) {
      this.realtime.changed(result.id);
      if (result.notificationId)
        await this.realtime.notify(
          result.id,
          result.notificationId,
          events.inbound,
        );
    }
    return result;
  }
  async process(id: string) {
    const notice = await this.db.$transaction(
      async (tx) => {
        await lockConversation(tx, id);
        const c = await tx.conversation.findUniqueOrThrow({
          where: { id },
          include: {
            client: true,
            messages: { orderBy: { createdAt: "asc" } },
          },
        });
        const pending = c.messages.filter(
          (m) => m.direction === "client" && !m.processedAt,
        );
        if (!pending.length) return;
        const config = await this.settings.get();
        const markProcessed = () =>
          tx.message.updateMany({
            where: { id: { in: pending.map((m) => m.id) } },
            data: { processedAt: new Date() },
          });
        const handoffDisabledAgent = async () => {
          const reason = "نموذج عثمان متوقف؛ يلزم متابعة الموظف";
          await tx.conversation.update({
            where: { id },
            data: {
              status: "human",
              assignedStaffId: null,
              version: { increment: 1 },
            },
          });
          await tx.conversationEvent.create({
            data: {
              conversationId: id,
              type: "agent.paused",
              payload: { reason, previousStatus: c.status, status: "human" },
            },
          });
          const notification = await tx.notification.create({
            data: { conversationId: id, type: "handoff", reason },
          });
          await markProcessed();
          return notification.id;
        };
        if (c.status !== "agent_active") {
          await markProcessed();
          return;
        }
        if (config.rules.paused) return handoffDisabledAgent();
        if (
          Date.now() - c.lastActivityAt.getTime() <
          Number(process.env.DEBOUNCE_MS || 3000)
        ) {
          await this.queue.enqueue(id, tx);
          return;
        }
        let notificationId: string | undefined;
        try {
          const response = await this.agent.respond({
            conversationId: id,
            clientPhone: c.client.phone,
            history: c.messages
              .filter((m) => !pending.some((p) => p.id === m.id))
              .map((m) => ({
                role: m.direction === "agent" ? "assistant" : m.direction,
                text: m.type === "text" ? m.text : "[attachment]",
                at: m.createdAt.toISOString(),
              })),
            newMessages: pending.map((m) =>
              m.type === "text" ? m.text : "[attachment]",
            ),
            config,
          });
          // Do not deliver a reply if an admin disabled the model while it ran.
          if ((await this.settings.get()).rules.paused)
            return handoffDisabledAgent();
          const status = ConversationMachine.agentAction(response.action);
          if (response.reply) {
            const sent = await this.wa.send(c.client.phone, response.reply);
            await tx.message.create({
              data: {
                conversationId: id,
                direction: "agent",
                text: response.reply,
                waMessageId: sent.id,
                deliveryStatus: "sent",
                agentConfigVersion: config.version,
              },
            });
          }
          await tx.conversation.update({
            where: { id },
            data: {
              status,
              category: response.category || c.category,
              summary: response.summary || c.summary,
              urgentReason: response.urgentReason,
              version: { increment: 1 },
              lastActivityAt: new Date(),
            },
          });
          await tx.client.update({
            where: { id: c.clientId },
            data: {
              name: response.clientName || c.client.name,
              detectedCategory: response.category || c.client.detectedCategory,
              shortDescription:
                response.summary?.slice(0, 300) || c.client.shortDescription,
            },
          });
          await tx.conversationEvent.create({
            data: {
              conversationId: id,
              type: "agent." + response.action,
              payload: {
                previousStatus: c.status,
                status,
                configVersion: config.version,
              },
            },
          });
          if (status === "human" || status === "urgent")
            notificationId = (
              await tx.notification.create({
                data: {
                  conversationId: id,
                  type: status === "urgent" ? "urgent" : "handoff",
                  reason: response.urgentReason || "طلب متابعة موظف",
                },
              })
            ).id;
        } catch {
          await tx.conversation.update({
            where: { id },
            data: { status: "human", version: { increment: 1 } },
          });
          await tx.conversationEvent.create({
            data: {
              conversationId: id,
              type: "agent_error",
              payload: { reason: "تعذر رد عثمان؛ يلزم متابعة العميل" },
            },
          });
          notificationId = (
            await tx.notification.create({
              data: {
                conversationId: id,
                type: "agent_error",
                reason: "تعذر رد عثمان؛ يلزم متابعة العميل",
              },
            })
          ).id;
        }
        await tx.message.updateMany({
          where: { id: { in: pending.map((m) => m.id) } },
          data: { processedAt: new Date() },
        });
        return notificationId;
      },
      { timeout: 60000 },
    );
    this.realtime.changed(id);
    if (notice) await this.realtime.notify(id, notice, events.handoff);
  }
}
@Controller("dev")
@UseGuards(AuthGuard)
@Admin()
export class DevController {
  constructor(private inbound: InboundService) {}
  @Post("inbound") async simulate(@Body() body: unknown) {
    if (
      process.env.NODE_ENV === "production" ||
      (process.env.WA_PROVIDER || "mock") !== "mock"
    )
      throw new NotFoundException();
    const result = inboundSchema.safeParse(body);
    if (!result.success)
      throw new BadRequestException("بيانات الرسالة غير صالحة");
    return this.inbound.receive(result.data);
  }
}
