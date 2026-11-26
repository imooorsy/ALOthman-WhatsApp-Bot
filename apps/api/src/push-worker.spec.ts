import { runInNewContext } from "node:vm";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { GET } from "../../web/app/firebase-messaging-sw.js/route";

describe("closed-tab service worker delivery", () => {
  const original = { ...process.env };
  beforeEach(() => {
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY = "public-test-key";
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "test-project";
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID = "test-app";
  });
  afterEach(() => {
    process.env = { ...original };
  });
  async function worker() {
    let handle:
      | ((payload: { data: Record<string, string> }) => Promise<void>)
      | undefined;
    const showNotification = jest.fn().mockResolvedValue(undefined);
    const fetchSession = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ staffId: "me" }) });
    const source = await GET().text();
    runInNewContext(source, {
      URL,
      Date,
      Number,
      IDBKeyRange,
      indexedDB: new IDBFactory(),
      fetch: fetchSession,
      importScripts: jest.fn(),
      self: {
        location: { origin: "http://localhost:3000" },
        addEventListener: jest.fn(),
        registration: { showNotification },
      },
      firebase: {
        initializeApp: jest.fn(),
        messaging: () => ({
          onBackgroundMessage: (fn: typeof handle) => {
            handle = fn;
          },
        }),
      },
    });
    return {
      showNotification,
      fetchSession,
      deliver: (id: string, extra: Record<string, string> = {}) =>
        handle!({
          data: {
            deliveryId: id,
            kind: "test",
            staffId: "me",
            title: "اختبار",
            body: "اختبار إشعارات الخلفية",
            expiresAt: String(Date.now() + 60000),
            ...extra,
          },
        }),
    };
  }
  it("displays five independent test notifications without any open page", async () => {
    const w = await worker();
    for (let i = 0; i < 5; i++) await w.deliver("test-" + i);
    expect(w.showNotification).toHaveBeenCalledTimes(5);
    const tags = w.showNotification.mock.calls.map(
      (call) => (call as unknown as [string, { tag: string }])[1].tag,
    );
    expect(new Set(tags).size).toBe(5);
  });
  it("deduplicates an identical delivery across push retries", async () => {
    const w = await worker();
    await w.deliver("duplicate");
    await w.deliver("duplicate");
    expect(w.showNotification).toHaveBeenCalledTimes(1);
  });
  it("does not display a queued notification after logout", async () => {
    const w = await worker();
    w.fetchSession.mockResolvedValue({
      ok: false,
      json: async () => ({ staffId: "me" }),
    });
    await w.deliver("logged-out");
    expect(w.showNotification).not.toHaveBeenCalled();
  });
  it("rejects notifications for a different staff account", async () => {
    const w = await worker();
    await w.deliver("wrong-user", { staffId: "someone-else" });
    expect(w.showNotification).not.toHaveBeenCalled();
  });
  it("ignores expired deliveries", async () => {
    const w = await worker();
    await w.deliver("expired", { expiresAt: "1" });
    expect(w.showNotification).not.toHaveBeenCalled();
    expect(w.fetchSession).not.toHaveBeenCalled();
  });
});
