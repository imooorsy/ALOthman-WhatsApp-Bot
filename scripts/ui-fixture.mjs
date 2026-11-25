// Explicit local-only browser-QA fixture; remove it with `node scripts/ui-fixture.mjs clean`.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(
  new URL("../apps/api/package.json", import.meta.url),
);
const { PrismaClient } = require("@prisma/client");
const { hash } = require("bcrypt");
const raw = readFileSync("apps/api/.env", "utf8");
const url = raw
  .split(/\r?\n/)
  .find((l) => l.startsWith("DATABASE_URL="))
  .slice(13);
if (!url.includes("localhost:54329/osman"))
  throw new Error("QA fixtures only support local development database");
const db = new PrismaClient({ datasourceUrl: url });
const email = "ui-qa@example.invalid";
const phone = "+15555550199";
try {
  if (process.argv.includes("clean")) {
    const clients = await db.client.findMany({ where: { phone } });
    await db.conversation.deleteMany({
      where: { clientId: { in: clients.map((c) => c.id) } },
    });
    await db.client.deleteMany({ where: { phone } });
    await db.staffUser.deleteMany({ where: { email } });
    console.log("Local UI fixtures removed.");
  } else {
    await db.staffUser.upsert({
      where: { email },
      create: {
        email,
        name: "اختبار الواجهة",
        passwordHash: await hash("Local-QA-Only-2026!", 4),
        role: "admin",
      },
      update: {},
    });
    const client = await db.client.upsert({
      where: { phone },
      create: { phone, name: "اختبار الواجهة" },
      update: {},
    });
    const c = await db.conversation.create({
      data: {
        clientId: client.id,
        status: "human",
        summary: "اختبار عرض الملخص كنص عادي: <script>لا ينفذ</script>",
        category: "عمالي",
        messages: {
          create: [
            { direction: "client", text: "أحتاج إلى متابعة طلبي مع الفريق." },
            {
              direction: "agent",
              text: "تم تحويل طلبك للفريق المختص.",
              agentConfigVersion: 1,
            },
          ],
        },
      },
    });
    console.log("Local QA chat: " + c.id);
  }
} finally {
  await db.$disconnect();
}
