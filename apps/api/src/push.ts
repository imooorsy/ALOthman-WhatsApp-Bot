import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  OnApplicationBootstrap,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Db } from "./db";
import { QueueService } from "./queue";
import { AuthGuard, AuthRequest } from "./auth";

const registrationSchema = z.object({
  fid: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
});
export const pushTestSchema = z.object({
  registrationId: z.string().min(1),
  count: z.number().int().min(1).max(5).default(5),
  intervalSeconds: z.number().int().min(2).max(30).default(2),
  delaySeconds: z.number().int().min(0).max(120).default(0),
});
export function pushErrorCode(error: unknown) {
  const code = (error as { code?: unknown })?.code;
  return typeof code === "string" && /^messaging\/[a-z-]+$/.test(code)
    ? code
    : "push/delivery-failed";
}
export function pushData(
  delivery: {
    id: string;
    ordinal: number;
    testBatchId: string | null;
    notificationId: string | null;
  },
  notice?: { conversationId: string; type: string } | null,
) {
  const test = !!delivery.testBatchId;
  return {
    deliveryId: delivery.id,
    kind: test ? "test" : "notification",
    notificationId: delivery.notificationId || "",
    conversationId: notice?.conversationId || "",
    urgent: notice?.type === "urgent" ? "true" : "false",
    title: test
      ? `اختبار إشعار ${delivery.ordinal}`
      : notice?.type === "urgent"
        ? "محادثة عاجلة"
        : "متابعة محادثة",
    body: test
      ? "هذا اختبار لإشعارات الخلفية في لوحة عثمان."
      : "توجد محادثة تحتاج متابعة. افتح اللوحة للاطلاع عليها.",
  };
}
@Injectable()
export class PushService {
  constructor(
    private db: Db,
    private queue: QueueService,
  ) {}
  configured() {
    return (
      !!process.env.GOOGLE_APPLICATION_CREDENTIALS &&
      existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)
    );
  }
  private sender() {
    if (!this.configured())
      throw new ServiceUnavailableException("إعداد إشعارات الخلفية غير مكتمل");
    const app =
      getApps().find((a) => a.name === "osman-push") ||
      initializeApp({ credential: applicationDefault() }, "osman-push");
    return getMessaging(app);
  }
  async status(staffId: string) {
    return {
      configured: this.configured(),
      registrations: await this.db.pushRegistration.findMany({
        where: { staffId },
        select: { id: true, lastSeenAt: true },
        orderBy: { lastSeenAt: "desc" },
      }),
    };
  }
  async register(staffId: string, body: unknown) {
    if (!this.configured())
      throw new ServiceUnavailableException("إعداد إشعارات الخلفية غير مكتمل");
    const parsed = registrationSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException("تسجيل إشعارات غير صالح");
    const record = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${"push:" + parsed.data.fid},0))`;
      const previous = await tx.pushRegistration.findUnique({
        where: { fid: parsed.data.fid },
      });
      // Switching accounts on a shared browser must cancel the old account's
      // queued deliveries, rather than transfer them to the new staff member.
      if (previous && previous.staffId !== staffId)
        await tx.pushRegistration.delete({ where: { id: previous.id } });
      return tx.pushRegistration.upsert({
        where: { fid: parsed.data.fid },
        create: { fid: parsed.data.fid, staffId },
        update: { lastSeenAt: new Date() },
        select: { id: true },
      });
    });
    return record;
  }
  async remove(staffId: string, id: string) {
    await this.db.pushRegistration.deleteMany({ where: { id, staffId } });
    return { ok: true };
  }
  async test(staffId: string, body: unknown) {
    if (!this.configured())
      throw new ServiceUnavailableException("إعداد إشعارات الخلفية غير مكتمل");
    const parsed = pushTestSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException("إعداد اختبار الإشعارات غير صالح");
    const input = parsed.data;
    const registration = await this.db.pushRegistration.findFirst({
      where: { id: input.registrationId, staffId },
    });
    if (!registration)
      throw new BadRequestException(
        "فعّل إشعارات الخلفية في هذا المتصفح أولًا",
      );
    const batchId = randomUUID();
    const firstAt = Date.now() + input.delaySeconds * 1000;
    await this.db.$transaction(async (tx) => {
      for (let i = 0; i < input.count; i++) {
        const dueAt = new Date(firstAt + i * input.intervalSeconds * 1000);
        const delivery = await tx.pushDelivery.create({
          data: {
            registrationId: registration.id,
            testBatchId: batchId,
            ordinal: i + 1,
            dueAt,
          },
        });
        await this.queue.push(delivery.id, dueAt, tx);
      }
    });
    return {
      batchId,
      count: input.count,
      intervalSeconds: input.intervalSeconds,
      delaySeconds: input.delaySeconds,
    };
  }
  async enqueueNotification(notificationId: string) {
    if (!this.configured()) return;
    const notice = await this.db.notification.findUnique({
      where: { id: notificationId },
      include: { reads: true },
    });
    if (!notice) return;
    const registrations = await this.db.pushRegistration.findMany({
      include: { staff: { select: { notifyPrefs: true } } },
    });
    for (const registration of registrations) {
      if (
        !(registration.staff.notifyPrefs as { desktop?: boolean }).desktop ||
        notice.reads.some((r) => r.staffId === registration.staffId)
      )
        continue;
      await this.db.$transaction(async (tx) => {
        const made = await tx.pushDelivery.createMany({
          data: [
            {
              registrationId: registration.id,
              notificationId,
              dueAt: new Date(Date.now() + 1000),
            },
          ],
          skipDuplicates: true,
        });
        if (!made.count) return;
        const delivery = await tx.pushDelivery.findUniqueOrThrow({
          where: {
            registrationId_notificationId: {
              registrationId: registration.id,
              notificationId,
            },
          },
        });
        await this.queue.push(delivery.id, delivery.dueAt, tx);
      });
    }
  }
  async send(id: string) {
    const delivery = await this.db.pushDelivery.findUnique({
      where: { id },
      include: {
        registration: {
          include: { staff: { select: { id: true, notifyPrefs: true } } },
        },
        notification: { include: { reads: true } },
      },
    });
    if (!delivery || !["pending", "failed", "sending"].includes(delivery.state))
      return;
    const stale = Date.now() - delivery.dueAt.getTime() > 5 * 60 * 1000;
    const disabled = !(
      delivery.registration.staff.notifyPrefs as { desktop?: boolean }
    ).desktop;
    const read = delivery.notification?.reads.some(
      (r) => r.staffId === delivery.registration.staffId,
    );
    if (stale || disabled || read) {
      await this.db.pushDelivery.update({
        where: { id },
        data: { state: "skipped" },
      });
      return;
    }
    const claimed = await this.db.pushDelivery.updateMany({
      where: { id, state: delivery.state },
      data: { state: "sending" },
    });
    if (!claimed.count) return;
    try {
      const data = {
        ...pushData(delivery, delivery.notification),
        staffId: delivery.registration.staffId,
        expiresAt: String(Date.now() + 120000),
      };
      await this.sender().send({
        fid: delivery.registration.fid,
        data,
        webpush: { headers: { Urgency: "high", TTL: "120" } },
      });
      await this.db.pushDelivery.updateMany({
        where: { id },
        data: { state: "sent", errorCode: null },
      });
    } catch (error) {
      const code = pushErrorCode(error);
      if (
        [
          "messaging/registration-token-not-registered",
          "messaging/invalid-registration-token",
          "messaging/installation-not-found",
        ].includes(code)
      ) {
        await this.db.pushRegistration.deleteMany({
          where: { id: delivery.registrationId },
        });
        return;
      }
      await this.db.pushDelivery.updateMany({
        where: { id },
        data: { state: "failed", errorCode: code },
      });
      // Queue errors contain only a sanitized code, never credentials or payloads.
      throw new Error(code);
    }
  }
}
@Injectable()
export class PushWorker implements OnApplicationBootstrap {
  constructor(
    private push: PushService,
    private queue: QueueService,
  ) {}
  async onApplicationBootstrap() {
    await this.queue.boss.work<{ deliveryId: string }>(
      "push.send",
      { batchSize: 1, pollingIntervalSeconds: 0.5 },
      async (jobs) => {
        for (const job of jobs) await this.push.send(job.data.deliveryId);
      },
    );
  }
}
@Controller("push")
@UseGuards(AuthGuard)
export class PushController {
  constructor(
    private push: PushService,
    private db: Db,
  ) {}
  @Get("status") status(@Req() req: AuthRequest) {
    return this.push.status(req.user.id);
  }
  @Get("session") session(@Req() req: AuthRequest) {
    return { staffId: req.user.id };
  }
  @Post("registrations") register(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    return this.push.register(req.user.id, body);
  }
  @Delete("registrations/:id") remove(
    @Req() req: AuthRequest,
    @Param("id") id: string,
  ) {
    return this.push.remove(req.user.id, id);
  }
  @Post("test") @Throttle({ default: { limit: 3, ttl: 60000 } }) test(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    return this.push.test(req.user.id, body);
  }
  @Get("test/:batchId") result(
    @Req() req: AuthRequest,
    @Param("batchId") batchId: string,
  ) {
    return this.db.pushDelivery.findMany({
      where: { testBatchId: batchId, registration: { staffId: req.user.id } },
      select: { ordinal: true, state: true, dueAt: true, errorCode: true },
      orderBy: { ordinal: "asc" },
    });
  }
}
