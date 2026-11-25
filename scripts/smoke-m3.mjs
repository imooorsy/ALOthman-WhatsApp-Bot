import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHmac } from "node:crypto";
const require = createRequire(
  new URL("../apps/api/package.json", import.meta.url),
);
const { PrismaClient } = require("@prisma/client");
const env = Object.fromEntries(
  readFileSync("apps/api/.env", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => {
      const at = l.indexOf("=");
      return [l.slice(0, at), l.slice(at + 1)];
    }),
);
const db = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
const phone = "1555" + String(Date.now()).slice(-7);
const messageId = "webhook-" + Date.now();
let id;
const webRequire = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const { io } = webRequire("socket.io-client");
const auth = await fetch("http://localhost:4000/auth/login", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: "http://localhost:3000",
  },
  body: JSON.stringify({
    email: env.SEED_ADMIN_EMAIL,
    password: env.SEED_ADMIN_PASSWORD,
  }),
});
assert.equal(auth.status, 201);
const cookie = auth.headers.get("set-cookie").split(";")[0];
const socket = io("http://localhost:4000", {
  transports: ["websocket"],
  extraHeaders: { Origin: "http://localhost:3000", Cookie: cookie },
  reconnection: false,
});
const updates = [];
const handoffs = [];
socket.on("conversation.updated", (x) => updates.push(x));
socket.on("handoff.created", (x) => handoffs.push(x));
await new Promise((resolve, reject) => {
  const timer = setTimeout(
    () => reject(new Error("Socket connect timeout")),
    5000,
  );
  socket.once("connect", () => {
    clearTimeout(timer);
    resolve();
  });
  socket.once("connect_error", (error) => {
    clearTimeout(timer);
    reject(error);
  });
});
const body = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [
    {
      changes: [
        {
          value: {
            messages: [
              {
                id: messageId,
                from: phone,
                timestamp: String(Math.floor(Date.now() / 1000)),
                type: "text",
                text: { body: "عاجل" },
              },
            ],
          },
        },
      ],
    },
  ],
});
async function deliver(signature) {
  return fetch("http://localhost:4000/webhooks/whatsapp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": signature,
    },
    body,
  });
}
try {
  assert.equal((await deliver("sha256=" + "00".repeat(32))).status, 403);
  const sig =
    "sha256=" +
    createHmac("sha256", env.WA_APP_SECRET).update(body).digest("hex");
  const responses = await Promise.all([
    deliver(sig),
    deliver(sig),
    deliver(sig),
  ]);
  assert.ok(responses.every((r) => r.status === 200));
  let message;
  for (let i = 0; i < 30; i++) {
    message = await db.message.findUnique({
      where: { waMessageId: messageId },
    });
    if (message) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(message);
  id = message.conversationId;
  let c;
  for (let i = 0; i < 30; i++) {
    c = await db.conversation.findUniqueOrThrow({
      where: { id },
      include: { messages: true, events: true },
    });
    if (c.status === "urgent") break;
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.equal(c.status, "urgent");
  assert.equal(c.messages.filter((m) => m.direction === "client").length, 1);
  assert.equal(c.messages.filter((m) => m.direction === "agent").length, 1);
  assert.ok(
    c.messages.find((m) => m.direction === "agent").agentConfigVersion > 0,
  );
  assert.ok(c.events.some((e) => e.type === "agent.handoff_urgent"));
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(updates.some((x) => x.conversationId === id));
  assert.ok(handoffs.some((x) => x.conversationId === id));
  const notices = await (
    await fetch("http://localhost:4000/notifications", {
      headers: { Cookie: cookie },
    })
  ).json();
  assert.ok(notices.some((n) => n.conversationId === id));
  await fetch("http://localhost:4000/chats/" + id + "/read", {
    method: "POST",
    headers: { Origin: "http://localhost:3000", Cookie: cookie },
  });
  const missed = await (
    await fetch("http://localhost:4000/notifications", {
      headers: { Cookie: cookie },
    })
  ).json();
  assert.ok(!missed.some((n) => n.conversationId === id));
  console.log(
    "M3/M4 smoke passed: signature, concurrent retries, durable worker, config provenance, urgent socket events and persisted notification reads.",
  );
} finally {
  socket.disconnect();
  if (id) await db.conversation.delete({ where: { id } });
  await db.client.deleteMany({ where: { phone: "+" + phone } });
  await db.webhookInbox.deleteMany({ where: { id: messageId } });
  await db.$disconnect();
}
