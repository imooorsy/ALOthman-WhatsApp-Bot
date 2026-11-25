import { defaultSettings } from "@osman/shared";
import { InboundService } from "./inbound";
import { Db } from "./db";
import { SettingsService } from "./settings";
import { AgentService } from "./agent";
import { WhatsAppProvider } from "./whatsapp";
import { QueueService } from "./queue";
import { RealtimeGateway } from "./realtime";

function setup(paused: boolean, status = "agent_active") {
  const config = {
    ...defaultSettings,
    rules: { ...defaultSettings.rules, paused },
    version: 1,
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    conversation: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: "chat",
        status,
        lastActivityAt: new Date(Date.now() - 60000),
        client: { phone: "+15555550100" },
        messages: [
          {
            id: "message",
            direction: "client",
            type: "text",
            text: "طلب",
            processedAt: null,
            createdAt: new Date(),
          },
        ],
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    message: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    conversationEvent: { create: jest.fn().mockResolvedValue({}) },
    notification: {
      create: jest.fn().mockResolvedValue({ id: "notification" }),
    },
  };
  const db = {
    $transaction: jest.fn((fn: (value: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
  };
  const settings = { get: jest.fn().mockResolvedValue(config) };
  const agent = {
    respond: jest
      .fn()
      .mockResolvedValue({
        reply: "رد",
        action: "continue",
        category: null,
        clientName: null,
        summary: null,
        urgentReason: null,
      }),
  };
  const wa = { send: jest.fn() };
  const realtime = {
    changed: jest.fn(),
    notify: jest.fn().mockResolvedValue(undefined),
  };
  const service = new InboundService(
    db as unknown as Db,
    settings as unknown as SettingsService,
    agent as unknown as AgentService,
    wa as unknown as WhatsAppProvider,
    {} as QueueService,
    realtime as unknown as RealtimeGateway,
  );
  return { config, tx, settings, agent, wa, realtime, service };
}
describe("agent enable/disable setting", () => {
  it("hands queued messages to staff without invoking a disabled model", async () => {
    const s = setup(true);
    await s.service.process("chat");
    expect(s.agent.respond).not.toHaveBeenCalled();
    expect(s.wa.send).not.toHaveBeenCalled();
    expect(s.tx.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "human" }),
      }),
    );
    expect(s.tx.conversationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "agent.paused" }),
      }),
    );
    expect(s.tx.message.updateMany).toHaveBeenCalled();
    expect(s.realtime.notify).toHaveBeenCalledWith(
      "chat",
      "notification",
      "handoff.created",
    );
  });
  it("discards a pending reply if the model is switched off during the call", async () => {
    const s = setup(false);
    s.settings.get
      .mockResolvedValueOnce(s.config)
      .mockResolvedValueOnce({
        ...s.config,
        rules: { ...s.config.rules, paused: true },
      });
    await s.service.process("chat");
    expect(s.agent.respond).toHaveBeenCalledTimes(1);
    expect(s.wa.send).not.toHaveBeenCalled();
    expect(s.tx.notification.create).toHaveBeenCalled();
    expect(s.realtime.notify).toHaveBeenCalled();
  });
  it("preserves staff-owned conversations while the model is disabled", async () => {
    const s = setup(true, "human");
    await s.service.process("chat");
    expect(s.agent.respond).not.toHaveBeenCalled();
    expect(s.tx.conversation.update).not.toHaveBeenCalled();
    expect(s.tx.notification.create).not.toHaveBeenCalled();
    expect(s.tx.message.updateMany).toHaveBeenCalled();
  });
});
