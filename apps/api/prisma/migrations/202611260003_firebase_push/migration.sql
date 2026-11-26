-- CreateTable
CREATE TABLE "PushRegistration" (
    "id" TEXT NOT NULL,
    "fid" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushDelivery" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "notificationId" TEXT,
    "testBatchId" TEXT,
    "ordinal" INTEGER NOT NULL DEFAULT 0,
    "dueAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushRegistration_fid_key" ON "PushRegistration"("fid");

-- CreateIndex
CREATE INDEX "PushRegistration_staffId_idx" ON "PushRegistration"("staffId");

-- CreateIndex
CREATE INDEX "PushDelivery_state_dueAt_idx" ON "PushDelivery"("state", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "PushDelivery_registrationId_notificationId_key" ON "PushDelivery"("registrationId", "notificationId");

-- CreateIndex
CREATE UNIQUE INDEX "PushDelivery_registrationId_testBatchId_ordinal_key" ON "PushDelivery"("registrationId", "testBatchId", "ordinal");

-- AddForeignKey
ALTER TABLE "PushRegistration" ADD CONSTRAINT "PushRegistration_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushDelivery" ADD CONSTRAINT "PushDelivery_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "PushRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushDelivery" ADD CONSTRAINT "PushDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
