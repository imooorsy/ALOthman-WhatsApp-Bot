import { ConversationWorker } from "./worker";
import { ConversationBusyError, InboundService } from "./inbound";
import { QueueService } from "./queue";
import { Db } from "./db";
import { RealtimeGateway } from "./realtime";
describe("parallel queue workers", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });
  it("registers ten independent workers per queue and defers a busy conversation", async () => {
    delete process.env.AGENT_CONCURRENCY;
    const handlers: Record<
      string,
      (jobs: { data: { id: string } }[]) => Promise<void>
    > = {};
    const work = jest.fn(async (name, options, handler) => {
      handlers[name] = handler;
    });
    const queue = { boss: { work }, deferInbox: jest.fn() };
    const inbound = {
      receive: jest.fn().mockRejectedValue(new ConversationBusyError()),
    };
    const db = {
      webhookInbox: {
        findUnique: jest
          .fn()
          .mockResolvedValue({
            id: "inbox",
            kind: "message",
            payload: {
              id: "inbox",
              address: "12345@lid",
              text: "fixture",
              type: "text",
            },
          }),
        update: jest.fn(),
      },
    };
    await new ConversationWorker(
      queue as unknown as QueueService,
      inbound as unknown as InboundService,
      db as unknown as Db,
      {} as RealtimeGateway,
    ).onApplicationBootstrap();
    expect(
      work.mock.calls.filter(([name]) => name === "conversation"),
    ).toHaveLength(10);
    expect(
      work.mock.calls.filter(([name]) => name === "whatsapp.inbox"),
    ).toHaveLength(10);
    await handlers["whatsapp.inbox"]([{ data: { id: "inbox" } }]);
    expect(queue.deferInbox).toHaveBeenCalledWith("inbox");
    expect(db.webhookInbox.update).not.toHaveBeenCalled();
  });
});
