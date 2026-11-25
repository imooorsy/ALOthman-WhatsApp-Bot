import { createHmac } from "node:crypto";
import { validSignature } from "./webhook";
import { agentResponseSchema } from "@osman/shared";
describe("webhook authentication", () => {
  const raw = Buffer.from('{"entry":[]}');
  const secret = "test-secret";
  const signature =
    "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  it("authenticates the exact raw bytes", () => {
    expect(validSignature(raw, signature, secret)).toBe(true);
    expect(
      validSignature(Buffer.from('{ "entry":[]}'), signature, secret),
    ).toBe(false);
  });
  it.each([undefined, "", "sha256=x", "sha256=" + "00".repeat(32)])(
    "rejects missing or invalid signature %s",
    (signature) => expect(validSignature(raw, signature, secret)).toBe(false),
  );
  it("fails closed without a configured secret", () =>
    expect(validSignature(raw, signature, undefined)).toBe(false));
});
describe("agent response validation", () => {
  const valid = {
    reply: null,
    action: "handoff",
    category: null,
    clientName: null,
    summary: "ملخص نصي",
    urgentReason: null,
  };
  it("accepts nullable response fields", () =>
    expect(agentResponseSchema.safeParse(valid).success).toBe(true));
  it.each([
    { ...valid, action: "delete_all" },
    { ...valid, summary: { html: "unsafe" } },
    { ...valid, reply: 34 },
    { ...valid, unexpected: true },
    { action: "continue" },
  ])("rejects invalid output", (value) =>
    expect(agentResponseSchema.safeParse(value).success).toBe(false),
  );
});
