import { PushService, pushData, pushErrorCode, pushTestSchema } from "./push";
import { Db } from "./db";
import { QueueService } from "./queue";

describe("background push privacy and test limits", () => {
  it("sends only generic metadata, never a phone or team summary", () => {
    const data = pushData(
      {
        id: "delivery",
        ordinal: 0,
        testBatchId: null,
        notificationId: "notice",
      },
      { conversationId: "chat", type: "urgent" },
    );
    expect(data.urgent).toBe("true");
    expect(data.conversationId).toBe("chat");
    expect(Object.keys(data)).not.toContain("phone");
    expect(Object.keys(data)).not.toContain("summary");
  });
  it("uses distinct delivery identifiers and ordinals for tests", () => {
    const data = pushData({
      id: "second",
      ordinal: 2,
      testBatchId: "batch",
      notificationId: null,
    });
    expect(data.kind).toBe("test");
    expect(data.deliveryId).toBe("second");
    expect(data.title).toContain("2");
  });
  it("limits a test to five messages and at least two seconds apart", () => {
    expect(
      pushTestSchema.parse({ registrationId: "own-browser" }),
    ).toMatchObject({ count: 5, intervalSeconds: 2, delaySeconds: 0 });
    expect(
      pushTestSchema.safeParse({ registrationId: "own-browser", count: 6 })
        .success,
    ).toBe(false);
    expect(
      pushTestSchema.safeParse({
        registrationId: "own-browser",
        intervalSeconds: 1,
      }).success,
    ).toBe(false);
  });
  it("does not expose arbitrary credential error messages or codes", () => {
    expect(pushErrorCode(new Error("private data"))).toBe(
      "push/delivery-failed",
    );
    expect(pushErrorCode({ code: "some-private-key-value" })).toBe(
      "push/delivery-failed",
    );
    expect(pushErrorCode({ code: "messaging/server-unavailable" })).toBe(
      "messaging/server-unavailable",
    );
  });
});
describe("private test batch scheduling", () => {
  function setup() {
    const tx = {
      pushDelivery: {
        create: jest.fn(
          async ({ data }: { data: { dueAt: Date; ordinal: number } }) => ({
            id: "delivery-" + data.ordinal,
            ...data,
          }),
        ),
      },
    };
    const db = {
      pushRegistration: {
        findFirst: jest.fn().mockResolvedValue({ id: "own-browser" }),
      },
      $transaction: jest.fn((fn: (txArg: typeof tx) => Promise<void>) =>
        fn(tx),
      ),
    };
    const queue = { push: jest.fn().mockResolvedValue("job") };
    const service = new PushService(
      db as unknown as Db,
      queue as unknown as QueueService,
    );
    jest.spyOn(service, "configured").mockReturnValue(true);
    return { tx, db, queue, service };
  }
  it("schedules exactly five deliveries for one owned registration two seconds apart", async () => {
    const s = setup();
    const result = await s.service.test("me", {
      registrationId: "own-browser",
      count: 5,
      intervalSeconds: 2,
    });
    expect(result.count).toBe(5);
    expect(s.db.pushRegistration.findFirst).toHaveBeenCalledWith({
      where: { id: "own-browser", staffId: "me" },
    });
    expect(s.queue.push).toHaveBeenCalledTimes(5);
    const times = s.queue.push.mock.calls.map((call) =>
      Number((call as unknown as [string, Date])[1]),
    );
    for (let i = 1; i < times.length; i++)
      expect(times[i] - times[i - 1]).toBe(2000);
  });
  it("rejects a browser registration not owned by the caller", async () => {
    const s = setup();
    s.db.pushRegistration.findFirst.mockResolvedValue(null);
    await expect(
      s.service.test("other", { registrationId: "own-browser" }),
    ).rejects.toThrow();
    expect(s.queue.push).not.toHaveBeenCalled();
  });
});
describe("push delivery gating", () => {
  function setup(
    options: { desktop?: boolean; read?: boolean; state?: string } = {},
  ) {
    const delivery = {
      id: "delivery",
      state: options.state || "pending",
      dueAt: new Date(),
      registrationId: "browser",
      registration: {
        fid: "f".repeat(22),
        staffId: "staff",
        staff: { notifyPrefs: { desktop: options.desktop ?? true } },
      },
      notification: {
        conversationId: "chat",
        type: "handoff",
        reads: options.read ? [{ staffId: "staff" }] : [],
      },
      notificationId: "notice",
      testBatchId: null,
      ordinal: 0,
    };
    const db = {
      pushDelivery: {
        findUnique: jest.fn().mockResolvedValue(delivery),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      pushRegistration: { deleteMany: jest.fn().mockResolvedValue({}) },
    };
    const service = new PushService(db as unknown as Db, {} as QueueService);
    const send = jest.fn().mockResolvedValue("firebase-message");
    jest
      .spyOn(
        service as unknown as { sender: () => { send: typeof send } },
        "sender",
      )
      .mockReturnValue({ send });
    return { db, service, send };
  }
  it.each([{ desktop: false }, { read: true }])(
    "skips disabled or read notifications",
    async (options) => {
      const s = setup(options);
      await s.service.send("delivery");
      expect(s.send).not.toHaveBeenCalled();
      expect(s.db.pushDelivery.update).toHaveBeenCalledWith({
        where: { id: "delivery" },
        data: { state: "skipped" },
      });
    },
  );
  it("sends data-only Firebase messages addressed to the registered installation", async () => {
    const s = setup();
    await s.service.send("delivery");
    expect(s.send).toHaveBeenCalledWith(
      expect.objectContaining({
        fid: "f".repeat(22),
        data: expect.objectContaining({
          deliveryId: "delivery",
          kind: "notification",
        }),
      }),
    );
    expect(s.db.pushDelivery.updateMany).toHaveBeenLastCalledWith({
      where: { id: "delivery" },
      data: { state: "sent", errorCode: null },
    });
  });
  it("never resends a successfully completed delivery", async () => {
    const s = setup({ state: "sent" });
    await s.service.send("delivery");
    expect(s.send).not.toHaveBeenCalled();
  });
  it("records a sanitized failed state for durable retry", async () => {
    const s = setup();
    s.send.mockRejectedValue(new Error("private credential error"));
    await expect(s.service.send("delivery")).rejects.toThrow(
      "push/delivery-failed",
    );
    expect(s.db.pushDelivery.updateMany).toHaveBeenLastCalledWith({
      where: { id: "delivery" },
      data: { state: "failed", errorCode: "push/delivery-failed" },
    });
  });
  it("removes invalid browser registrations", async () => {
    const s = setup();
    s.send.mockRejectedValue({
      code: "messaging/registration-token-not-registered",
    });
    await s.service.send("delivery");
    expect(s.db.pushRegistration.deleteMany).toHaveBeenCalledWith({
      where: { id: "browser" },
    });
  });
});
