import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(
  new URL("../apps/api/package.json", import.meta.url),
);
const env = Object.fromEntries(
  readFileSync("apps/api/.env", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => {
      const at = l.indexOf("=");
      return [l.slice(0, at), l.slice(at + 1)];
    }),
);
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
const base = "http://localhost:4000";
let cookie;
async function call(path, method = "GET", body) {
  const r = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return r;
}
const login = await call("/auth/login", "POST", {
  email: env.SEED_ADMIN_EMAIL,
  password: env.SEED_ADMIN_PASSWORD,
});
assert.equal(login.status, 201);
cookie = login.headers.get("set-cookie").split(";")[0];
const phone = "+1555" + String(Date.now()).slice(-7);
let id;
try {
  const inbound = await call("/dev/inbound", "POST", {
    id: "test-" + Date.now(),
    phone,
    text: "عاجل",
  });
  assert.equal(inbound.status, 201);
  id = (await inbound.json()).id;
  let c;
  for (let attempt = 0; attempt < 30; attempt++) {
    c = await (await call("/chats/" + id)).json();
    if (c.status === "urgent") break;
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.equal(c.status, "urgent");
  assert.equal(c.messages.filter((m) => m.direction === "agent").length, 1);
  const take = await call("/chats/" + id + "/actions", "POST", {
    action: "take",
    version: c.version,
  });
  assert.equal(take.status, 201);
  assert.equal(
    (
      await call("/chats/" + id + "/actions", "POST", {
        action: "resume",
        version: c.version,
      })
    ).status,
    409,
  );
  c = await (await call("/chats/" + id)).json();
  assert.equal(c.status, "human");
  assert.equal(
    (
      await call("/chats/" + id + "/messages", "POST", {
        text: "رد الموظف",
        version: c.version,
      })
    ).status,
    201,
  );
  const messageId = "human-" + Date.now();
  await call("/dev/inbound", "POST", {
    id: messageId,
    phone,
    text: "رسالة جديدة",
  });
  await call("/dev/inbound", "POST", {
    id: messageId,
    phone,
    text: "رسالة جديدة",
  });
  c = await (await call("/chats/" + id)).json();
  assert.equal(c.messages.filter((m) => m.direction === "agent").length, 1);
  assert.equal(c.messages.filter((m) => m.waMessageId === messageId).length, 1);
  assert.equal(
    (
      await call("/chats/" + id + "/actions", "POST", {
        action: "secretary",
        version: c.version,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call("/chats/" + id + "/actions", "POST", {
        action: "close",
        version: c.version,
      })
    ).status,
    201,
  );
  await call("/dev/inbound", "POST", {
    id: "silent-" + Date.now(),
    phone,
    text: "متابعة",
  });
  c = await (await call("/chats/" + id)).json();
  assert.equal(c.status, "not_suitable");
  assert.equal(c.messages.filter((m) => m.direction === "agent").length, 1);
  console.log(
    "M2 smoke passed: mock agent, takeover, stale version, staff send, idempotency and silent terminal messages.",
  );
} finally {
  if (id) await db.conversation.delete({ where: { id } });
  await db.client.deleteMany({ where: { phone } });
  await db.$disconnect();
}
