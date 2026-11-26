import { WhatsAppSessionService } from "./whatsapp-session";
import { Db } from "./db";
import { evolutionUrl } from "./evolution-client";
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1kAAAAASUVORK5CYII=";
describe("authenticated WhatsApp session lifecycle", () => {
  const original = { ...process.env };
  let connected: boolean, exists: boolean, image: string;
  let create: jest.Mock;
  let service: WhatsAppSessionService;
  beforeEach(() => {
    Object.assign(process.env, {
      WA_PROVIDER: "evolution",
      EVOLUTION_URL: "connector.internal:8080",
      EVOLUTION_API_KEY: "server-only-key",
      EVOLUTION_WEBHOOK_SECRET: "server-only-webhook-secret",
      EVOLUTION_INSTANCE: "osman",
      NODE_ENV: "test",
    });
    connected = false;
    exists = false;
    image = png;
    create = jest.fn().mockResolvedValue({});
    service = new WhatsAppSessionService({
      systemAuditEvent: { create },
    } as unknown as Db);
    jest.spyOn(global, "fetch").mockImplementation(async (input, options) => {
      const url = String(input);
      let body: unknown = {};
      if (url.includes("fetchInstances"))
        body = exists ? [{ name: "osman" }] : [];
      else if (url.includes("/instance/create")) exists = true;
      else if (url.includes("connectionState"))
        body = { instance: { state: connected ? "open" : "connecting" } };
      else if (url.includes("/instance/connect/")) body = { base64: image };
      return new Response(JSON.stringify(body), {
        status: options?.method === "POST" ? 201 : 200,
      });
    });
  });
  afterEach(() => {
    process.env = { ...original };
    jest.restoreAllMocks();
  });
  it("normalizes Render hostport and forbids embedded URL credentials", () => {
    expect(evolutionUrl()).toBe("http://connector.internal:8080");
    process.env.EVOLUTION_URL = "http://user:secret@host";
    expect(() => evolutionUrl()).toThrow();
  });
  it("does not expose QR data until an admin starts pairing", async () => {
    expect((await service.status(true)).qr).toBeNull();
    const result = await service.connect("admin-id");
    expect(result).toMatchObject({ state: "connecting", qr: png });
    expect(result.expiresAt).not.toBeNull();
    expect((await service.status(false)).qr).toBeNull();
    expect(
      create.mock.calls.every(
        ([arg]) => JSON.stringify(arg.data.payload) === "{}",
      ),
    ).toBe(true);
    expect(create.mock.calls[0][0].data.actorStaffId).toBe("admin-id");
  });
  it("preserves an already connected instance and removes the QR after connection", async () => {
    await service.connect("admin-id");
    connected = true;
    expect(await service.status(true)).toMatchObject({
      state: "connected",
      qr: null,
      expiresAt: null,
    });
    await service.connect("admin-id");
    expect(
      jest
        .mocked(fetch)
        .mock.calls.filter(([url]) => String(url).endsWith("/instance/create")),
    ).toHaveLength(1);
    expect(
      jest
        .mocked(fetch)
        .mock.calls.some(([url]) => /logout|delete|restart/.test(String(url))),
    ).toBe(false);
  });
  it("does not accept SVG QR payloads or silently extend an unchanged expired QR", async () => {
    let now = Date.now();
    jest.spyOn(Date, "now").mockImplementation(() => now);
    await service.connect("admin-id");
    await service.status(false); // Employee polling must not reset the admin expiry.
    now += 46000;
    expect((await service.status(true)).qr).toBeNull();
    image = "data:image/svg+xml;base64,PHN2Zy8+";
    expect((await service.status(true)).qr).toBeNull();
  });
  it("records a sanitized failed connection and requires HTTPS callbacks in production", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.EVOLUTION_CALLBACK_URL;
    await expect(service.connect("admin-id")).rejects.toThrow("تعذر تجهيز");
    expect(create.mock.calls.map(([value]) => value.data.type)).toEqual([
      "whatsapp.connect.requested",
      "whatsapp.connect.failed",
    ]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("returns an unavailable state without leaking provider response data", async () => {
    jest.mocked(fetch).mockRejectedValue(new Error("private details"));
    expect(await service.status(true)).toEqual({
      provider: "evolution",
      state: "unavailable",
      qr: null,
      expiresAt: null,
    });
  });
});
