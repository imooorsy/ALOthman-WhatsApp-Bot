import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";
import PgBoss from "pg-boss";
import type { Prisma } from "@prisma/client";
@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  readonly boss = new PgBoss({
    connectionString: process.env.DATABASE_URL!,
    schema: "pgboss",
  });
  private log = new Logger(QueueService.name);
  async onModuleInit() {
    this.boss.on("error", () =>
      this.log.error("Background queue error; inspect database connectivity"),
    );
    await this.boss.start();
    await this.boss.createQueue("conversation");
    await this.boss.createQueue("whatsapp.inbox");
    await this.boss.createQueue("push.send");
  }
  async push(
    deliveryId: string,
    startAfter: Date,
    tx: Prisma.TransactionClient,
  ) {
    return this.boss.send(
      "push.send",
      { deliveryId },
      {
        startAfter,
        retryLimit: 3,
        retryDelay: 2,
        expireInSeconds: 30,
        db: {
          executeSql: async (sql: string, values: unknown[]) => ({
            rows: (await tx.$queryRawUnsafe(sql, ...values)) as object[],
          }),
        },
      },
    );
  }
  async inbox(id: string, tx: Prisma.TransactionClient) {
    return this.boss.send(
      "whatsapp.inbox",
      { id },
      {
        retryLimit: 20,
        retryDelay: 5,
        retryBackoff: true,
        expireInSeconds: 120,
        db: {
          executeSql: async (sql: string, values: unknown[]) => ({
            rows: (await tx.$queryRawUnsafe(sql, ...values)) as object[],
          }),
        },
      },
    );
  }
  async enqueue(id: string, tx?: Prisma.TransactionClient) {
    return this.boss.send(
      "conversation",
      { conversationId: id },
      {
        startAfter: new Date(
          Date.now() + Number(process.env.DEBOUNCE_MS || 3000),
        ),
        retryLimit: 3,
        retryDelay: 5,
        expireInSeconds: 120,
        ...(tx
          ? {
              db: {
                executeSql: async (sql: string, values: unknown[]) => ({
                  rows: (await tx.$queryRawUnsafe(sql, ...values)) as object[],
                }),
              },
            }
          : {}),
      },
    );
  }
  async onModuleDestroy() {
    await this.boss.stop({ graceful: true, timeout: 60000 });
  }
}
