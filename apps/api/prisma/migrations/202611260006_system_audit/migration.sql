CREATE TABLE "SystemAuditEvent" (
 "id" TEXT NOT NULL, "actorStaffId" TEXT, "type" TEXT NOT NULL,
 "payload" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "SystemAuditEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SystemAuditEvent_createdAt_idx" ON "SystemAuditEvent"("createdAt");
ALTER TABLE "SystemAuditEvent" ADD CONSTRAINT "SystemAuditEvent_actorStaffId_fkey" FOREIGN KEY ("actorStaffId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
