import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hash } from "bcrypt";
import { defaultSettings } from "@osman/shared";
const db = new PrismaClient();
async function main() {
  const { SEED_ADMIN_EMAIL: email, SEED_ADMIN_PASSWORD: password } =
    process.env;
  if (!email || !password || password.length < 12)
    throw new Error(
      "Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (12+ characters)",
    );
  await db.$transaction(async (tx) => {
    await tx.staffUser.upsert({
      where: { email: email.toLowerCase() },
      update: {},
      create: {
        email: email.toLowerCase(),
        name: process.env.SEED_ADMIN_NAME || "مدير المكتب",
        passwordHash: await hash(password, 12),
        role: "admin",
      },
    });
    const existing = await tx.officeSettings.findUnique({ where: { id: 1 } });
    if (!existing) {
      const { services, categories, ...defaults } = defaultSettings;
      const data = {
        ...defaults,
        rules: {
          ...defaults.rules,
          paused:
            process.env.SEED_BOT_PAUSED === "true"
              ? true
              : defaults.rules.paused,
        },
      };
      await tx.officeSettings.create({ data: { id: 1, data } });
      await tx.service.createMany({ data: services });
      await tx.caseCategory.createMany({ data: categories });
    }
  });
}
main()
  .finally(() => db.$disconnect())
  .catch(() => {
    console.error(
      "Seed failed. Check database and seed environment variables.",
    );
    process.exitCode = 1;
  });
