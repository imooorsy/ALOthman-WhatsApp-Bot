ALTER TABLE "Client" ALTER COLUMN "phone" DROP NOT NULL;
ALTER TABLE "Client" ADD COLUMN "waAddress" TEXT;
CREATE UNIQUE INDEX "Client_waAddress_key" ON "Client"("waAddress");
UPDATE "Client" SET "waAddress" = regexp_replace("phone", '[^0-9]', '', 'g') || '@s.whatsapp.net' WHERE "phone" IS NOT NULL;
