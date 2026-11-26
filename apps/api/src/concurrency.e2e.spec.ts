import PgBoss from "pg-boss";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { defaultSettings } from "@osman/shared";
import { ConversationWorker } from "./worker";
import { InboundService, ConversationBusyError } from "./inbound";
import { Db } from "./db";
import { QueueService } from "./queue";
import { SettingsService } from "./settings";
import { RealtimeGateway } from "./realtime";
import { AgentService } from "./agent";
import { WhatsAppProvider } from "./whatsapp";

(process.env.TEST_DATABASE_URL ? describe : describe.skip)(
  "concurrent conversation processing",
  () => {
    it("runs ten agents simultaneously, isolates private-ID clients, and defers duplicate chat jobs", async () => {
      const url = new URL(process.env.TEST_DATABASE_URL!);
      url.searchParams.set("connection_limit", "24");
      const db = new PrismaClient({ datasourceUrl: url.toString() });
      const schema = "concurrency_" + randomUUID().replaceAll("-", "");
      const boss = new PgBoss({ connectionString: url.toString(), schema });
      const previousDebounce = process.env.DEBOUNCE_MS;
      process.env.DEBOUNCE_MS = "0";
      const clientIds: string[] = [];
      let release!: () => void;
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      let active = 0,
        maximum = 0;
      const calls = new Map<string, number>();
      const respond = jest.fn(
        async (request: {
          conversationId: string;
          clientPhone: string | null;
          history: unknown[];
          newMessages: string[];
        }) => {
          calls.set(
            request.conversationId,
            (calls.get(request.conversationId) || 0) + 1,
          );
          active++;
          maximum = Math.max(maximum, active);
          if (active === 10) release();
          await barrier;
          active--;
          return {
            reply: "fixture",
            action: "continue",
            category: null,
            clientName: null,
            summary: null,
            urgentReason: null,
            state: { owner: request.conversationId },
          };
        },
      );
      const send = jest.fn(async () => ({ id: "fixture-" + randomUUID() }));
      const realtime = {
        changed: jest.fn(),
        notify: jest.fn(),
      } as unknown as RealtimeGateway;
      try {
        const { services, categories, ...data } = defaultSettings;
        await db.officeSettings.upsert({
          where: { id: 1 },
          create: { id: 1, data },
          update: {},
        });
        await boss.start();
        await boss.createQueue("conversation");
        await boss.createQueue("whatsapp.inbox");
        const queue = {
          boss,
          enqueue: (id: string) =>
            boss.send(
              "conversation",
              { conversationId: id },
              { retryLimit: 2 },
            ),
        } as unknown as QueueService;
        const inbound = new InboundService(
          db as Db,
          new SettingsService(db as Db),
          { respond } as unknown as AgentService,
          { send } as unknown as WhatsAppProvider,
          queue,
          realtime,
        );
        await new ConversationWorker(
          queue,
          inbound,
          db as Db,
          realtime,
        ).onApplicationBootstrap();
        // Ten private identities with no public phone. Nothing is sent to a real provider.
        const prefix = String(Date.now());
        const chats = await Promise.all(
          Array.from({ length: 10 }, async (_, i) => {
            const result = await inbound.receive({
              id: "parallel-" + prefix + i,
              address: prefix + i + "@lid",
              text: "fixture-" + i,
              type: "text",
            });
            const chat = await db.conversation.findUniqueOrThrow({
              where: { id: result.id },
            });
            clientIds.push(chat.clientId);
            return result.id;
          }),
        );
        const deadline = Date.now() + 12000;
        while (Date.now() < deadline && maximum < 10)
          await new Promise((resolve) => setTimeout(resolve, 50));
        expect(maximum).toBe(10);
        release();
        while (
          Date.now() < deadline &&
          (await db.message.count({
            where: { conversationId: { in: chats }, direction: "agent" },
          })) < 10
        )
          await new Promise((resolve) => setTimeout(resolve, 50));
        expect(
          await db.message.count({
            where: { conversationId: { in: chats }, direction: "agent" },
          }),
        ).toBe(10);
        expect(calls.size).toBe(10);
        expect([...calls.values()]).toEqual(Array(10).fill(1));
        expect(
          respond.mock.calls.every(([request]) => request.clientPhone === null),
        ).toBe(true);
        expect(send).toHaveBeenCalledTimes(10);
        expect(
          new Set(respond.mock.calls.map(([request]) => request.newMessages[0]))
            .size,
        ).toBe(10);
        expect(
          respond.mock.calls.every(
            ([request]) =>
              request.history.length === 0 && request.newMessages.length === 1,
          ),
        ).toBe(true);
        expect(
          new Set(
            send.mock.calls.map((args) => (args as unknown as string[])[0]),
          ).size,
        ).toBe(10);
        const saved = await db.conversation.findMany({
          where: { id: { in: chats } },
          select: { id: true, agentState: true },
        });
        expect(
          saved.every(
            (chat) => (chat.agentState as { owner: string }).owner === chat.id,
          ),
        ).toBe(true);
        expect(
          send.mock.calls.every((args) =>
            /@lid$/.test((args as unknown as string[])[0]),
          ),
        ).toBe(true);
        // An already-locked chat must return/requeue without occupying a model slot.
        await db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${chats[0]},0))`;
          await expect(
            inbound.receive({
              id: "busy-" + prefix,
              address: prefix + "0@lid",
              text: "fixture",
              type: "text",
            }),
          ).rejects.toBeInstanceOf(ConversationBusyError);
          const start = Date.now();
          await inbound.process(chats[0]);
          expect(Date.now() - start).toBeLessThan(1000);
        });
        expect([...calls.values()]).toEqual(Array(10).fill(1));
      } finally {
        release();
        await boss.stop({ graceful: true });
        await db.conversation.deleteMany({
          where: { clientId: { in: clientIds } },
        });
        await db.client.deleteMany({ where: { id: { in: clientIds } } });
        await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
        await db.$disconnect();
        if (previousDebounce === undefined) delete process.env.DEBOUNCE_MS;
        else process.env.DEBOUNCE_MS = previousDebounce;
      }
    }, 30000);
  },
);
