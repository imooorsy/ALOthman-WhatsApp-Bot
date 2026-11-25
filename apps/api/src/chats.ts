import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  IsIn,
  IsInt,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { ConversationMachine, secretaryLink, StaffAction } from "@osman/shared";
import { Prisma } from "@prisma/client";
import { Db } from "./db";
import { AuthGuard, AuthRequest } from "./auth";
import { SettingsService } from "./settings";
import { WhatsAppProvider } from "./whatsapp";
import { RealtimeGateway } from "./realtime";
export const chatInclude = {
  client: true,
  assignedStaff: { select: { id: true, name: true } },
  messages: { orderBy: { createdAt: "desc" as const }, take: 1 },
};
export async function lockConversation(
  tx: Prisma.TransactionClient,
  id: string,
) {
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${id},0))`;
}
class ActionDto {
  @IsIn(["take", "resume", "secretary", "close"]) action!: StaffAction;
  @IsInt() @Min(0) version!: number;
}
class SendDto {
  @IsString() @MinLength(1) @MaxLength(4096) text!: string;
  @IsInt() @Min(0) version!: number;
}
@Injectable()
export class ChatsService {
  constructor(
    private db: Db,
    private settings: SettingsService,
    private wa: WhatsAppProvider,
    private realtime: RealtimeGateway,
  ) {}
  list() {
    return this.db.conversation
      .findMany({ include: chatInclude, orderBy: { lastActivityAt: "desc" } })
      .then((rows) =>
        rows.sort(
          (a, b) =>
            Number(b.status === "urgent") - Number(a.status === "urgent"),
        ),
      );
  }
  async get(id: string) {
    const chat = await this.db.conversation.findUnique({
      where: { id },
      include: { ...chatInclude, messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!chat) throw new NotFoundException("المحادثة غير موجودة");
    return chat;
  }
  async read(id: string, staffId: string) {
    const changed = await this.db.$transaction(async (tx) => {
      await lockConversation(tx, id);
      const c = await tx.conversation.findUnique({ where: { id } });
      if (!c) throw new NotFoundException("المحادثة غير موجودة");
      const notifications = await tx.notification.findMany({
        where: { conversationId: id, reads: { none: { staffId } } },
        select: { id: true },
      });
      if (!c.unreadCount && !notifications.length) return false;
      await tx.conversation.update({ where: { id }, data: { unreadCount: 0 } });
      await tx.notificationRead.createMany({
        data: notifications.map((n) => ({ notificationId: n.id, staffId })),
        skipDuplicates: true,
      });
      return true;
    });
    if (changed) this.realtime.changed(id, staffId);
    return { ok: true };
  }
  async action(id: string, body: ActionDto, actor: AuthRequest["user"]) {
    const settings = await this.settings.get();
    const result = await this.db.$transaction(async (tx) => {
      await lockConversation(tx, id);
      const c = await tx.conversation.findUnique({
        where: { id },
        include: { client: true, assignedStaff: true },
      });
      if (!c) throw new NotFoundException("المحادثة غير موجودة");
      if (c.version !== body.version)
        throw new ConflictException("تم تحديث المحادثة؛ أعد المحاولة");
      if (c.assignedStaffId && c.assignedStaffId !== actor.id)
        throw new ConflictException("المحادثة عند " + c.assignedStaff?.name);
      let link: string | undefined;
      if (body.action === "secretary")
        try {
          link = secretaryLink(settings.contacts.secretary, {
            name: c.client.name,
            phone: c.client.phone,
            category: c.category || c.client.detectedCategory,
            summary: c.summary,
          });
        } catch (e) {
          throw new BadRequestException((e as Error).message);
        }
      const state = ConversationMachine.staff(
        body.action,
        c.assignedStaffId,
        actor.id,
      );
      await tx.conversation.update({
        where: { id },
        data: { ...state, version: { increment: 1 }, unreadCount: 0 },
      });
      await tx.conversationEvent.create({
        data: {
          conversationId: id,
          type: "staff." + body.action,
          actorStaffId: actor.id,
          payload: { previousStatus: c.status, status: state.status },
        },
      });
      return { ok: true, link };
    });
    this.realtime.changed(id, actor.id);
    return result;
  }
  async send(id: string, body: SendDto, actor: AuthRequest["user"]) {
    const result = await this.db.$transaction(
      async (tx) => {
        await lockConversation(tx, id);
        const c = await tx.conversation.findUnique({
          where: { id },
          include: { client: true, assignedStaff: true },
        });
        if (!c) throw new NotFoundException();
        if (c.version !== body.version)
          throw new ConflictException("تم تحديث المحادثة؛ أعد المحاولة");
        if (c.assignedStaffId !== actor.id)
          throw new ConflictException(
            c.assignedStaff
              ? "المحادثة عند " + c.assignedStaff.name
              : "استلم المحادثة أولًا",
          );
        if (!ConversationMachine.canCompose(c.status, c.lastClientMessageAt))
          throw new BadRequestException(
            "الإرسال غير متاح؛ يلزم استلام المحادثة ووجود رسالة عميل خلال 24 ساعة",
          );
        const m = await tx.message.create({
          data: { conversationId: id, direction: "staff", text: body.text },
        });
        try {
          const sent = await this.wa.send(c.client.phone, body.text);
          await tx.message.update({
            where: { id: m.id },
            data: { waMessageId: sent.id, deliveryStatus: "sent" },
          });
        } catch {
          await tx.message.update({
            where: { id: m.id },
            data: { deliveryStatus: "failed" },
          });
        }
        await tx.conversation.update({
          where: { id },
          data: { version: { increment: 1 }, lastActivityAt: new Date() },
        });
        await tx.conversationEvent.create({
          data: {
            conversationId: id,
            type: "staff.message",
            actorStaffId: actor.id,
            payload: { messageId: m.id },
          },
        });
        return { ok: true };
      },
      { timeout: 30000 },
    );
    this.realtime.changed(id, actor.id);
    return result;
  }
}
@Controller("chats")
@UseGuards(AuthGuard)
export class ChatsController {
  constructor(private chats: ChatsService) {}
  @Get() list() {
    return this.chats.list();
  }
  @Get(":id") get(@Param("id") id: string) {
    return this.chats.get(id);
  }
  @Post(":id/read") read(@Param("id") id: string, @Req() req: AuthRequest) {
    return this.chats.read(id, req.user.id);
  }
  @Post(":id/actions") action(
    @Param("id") id: string,
    @Body() body: ActionDto,
    @Req() req: AuthRequest,
  ) {
    return this.chats.action(id, body, req.user);
  }
  @Post(":id/messages") send(
    @Param("id") id: string,
    @Body() body: SendDto,
    @Req() req: AuthRequest,
  ) {
    return this.chats.send(id, body, req.user);
  }
}
