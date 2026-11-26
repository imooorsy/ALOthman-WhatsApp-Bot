import { evolutionEvents, EvolutionWebhookController } from "./evolution";
import { WhatsAppProvider } from "./whatsapp";
import { Db } from "./db";
import { QueueService } from "./queue";
import type { Request } from "express";

const message = (overrides = {}) => ({
  key: { id: "wa-1", remoteJid: "15555550100@s.whatsapp.net", fromMe: false },
  messageTimestamp: Math.floor(Date.now() / 1000),
  message: { conversation: "test" },
  ...overrides,
});
const event = (
  data: unknown,
  name = "messages.upsert",
  instance = "osman",
) => ({ event: name, instance, data });
describe("Evolution connector", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
    jest.restoreAllMocks();
  });
  it("normalizes text and attachments, and accepts a phone alias for LID", () => {
    expect(
      evolutionEvents(event(message()), "osman").messages[0],
    ).toMatchObject({ phone: "+15555550100", type: "text" });
    expect(
      evolutionEvents(
        event(message({ message: { audioMessage: {} } })),
        "osman",
      ).messages[0].type,
    ).toBe("audio");
    expect(
      evolutionEvents(
        event(
          message({
            key: {
              id: "2",
              remoteJid: "12345@lid",
              remoteJidAlt: "15555550100@s.whatsapp.net",
              fromMe: false,
            },
          }),
        ),
        "osman",
      ).messages,
    ).toHaveLength(1);
  });
  it("rejects self messages, groups, unknown LIDs, foreign instances and history events", () => {
    for (const jid of ["123@g.us", "12345@lid", "status@broadcast"])
      expect(
        evolutionEvents(
          event(message({ key: { id: "2", remoteJid: jid, fromMe: false } })),
          "osman",
        ).messages,
      ).toHaveLength(0);
    expect(
      evolutionEvents(
        event(
          message({
            key: {
              id: "2",
              remoteJid: "15555550100@s.whatsapp.net",
              fromMe: true,
            },
          }),
        ),
        "osman",
      ).messages,
    ).toHaveLength(0);
    expect(
      evolutionEvents(event(message(), "messages.set"), "osman").messages,
    ).toHaveLength(0);
    expect(
      evolutionEvents(event(message(), "messages.upsert", "other"), "osman")
        .messages,
    ).toHaveLength(0);
  });
  it("normalizes delivery receipts", () => {
    expect(
      evolutionEvents(
        event({ keyId: "out", status: 3 }, "MESSAGES_UPDATE"),
        "osman",
      ).statuses,
    ).toEqual([{ id: "out", status: "delivered" }]);
  });
  it("requires webhook secret before touching the database", async () => {
    process.env.WA_PROVIDER = "evolution";
    process.env.EVOLUTION_WEBHOOK_SECRET = "private-secret";
    await expect(
      new EvolutionWebhookController({} as Db, {} as QueueService).receive(
        { get: () => "wrong" } as unknown as Request,
        {},
      ),
    ).rejects.toThrow();
  });
  it("only enqueues newly persisted webhook IDs, in the same transaction", async () => {
    process.env.WA_PROVIDER = "evolution";
    process.env.EVOLUTION_WEBHOOK_SECRET = "private-secret";
    process.env.EVOLUTION_INSTANCE = "osman";
    const tx = {
      webhookInbox: {
        createMany: jest
          .fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 0 }),
      },
    };
    const db = {
      $transaction: (fn: (value: typeof tx) => Promise<void>) => fn(tx),
    } as unknown as Db;
    const queue = { inbox: jest.fn() };
    const controller = new EvolutionWebhookController(
      db,
      queue as unknown as QueueService,
    );
    const req = { get: () => "private-secret" } as unknown as Request;
    await controller.receive(req, event(message()));
    await controller.receive(req, event(message()));
    expect(queue.inbox).toHaveBeenCalledTimes(1);
    expect(queue.inbox).toHaveBeenCalledWith("wa-1", tx);
  });
  it("sends through Evolution v2 and rejects malformed provider responses", async () => {
    process.env.WA_PROVIDER = "evolution";
    process.env.EVOLUTION_URL = "http://localhost:8080";
    process.env.EVOLUTION_INSTANCE = "osman";
    process.env.EVOLUTION_API_KEY = "test";
    const fetcher = jest
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ key: { id: "out" } })));
    await expect(
      new WhatsAppProvider().send("+15555550100", "test"),
    ).resolves.toEqual({ id: "out" });
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toEqual({
      number: "15555550100",
      text: "test",
      linkPreview: false,
    });
    fetcher.mockResolvedValue(new Response("{}"));
    await expect(
      new WhatsAppProvider().send("+15555550100", "test"),
    ).rejects.toThrow();
  });
});
