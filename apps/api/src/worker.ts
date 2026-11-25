import { Injectable, OnApplicationBootstrap } from "@nestjs/common";
import { QueueService } from "./queue";
import { InboundService } from "./inbound";
import { Db } from "./db";
import { inboundSchema } from "./inbound";
import { RealtimeGateway } from "./realtime";
import { z } from "zod";
@Injectable()
export class ConversationWorker implements OnApplicationBootstrap {
  constructor(
    private queue: QueueService,
    private inbound: InboundService,
    private db: Db,
    private realtime: RealtimeGateway,
  ) {}
  async onApplicationBootstrap() {
    await this.queue.boss.work<{ id: string }>(
      "whatsapp.inbox",
      { batchSize: 1, pollingIntervalSeconds: 0.5 },
      async (jobs) => {
        for (const job of jobs) {
          const row = await this.db.webhookInbox.findUnique({
            where: { id: job.data.id },
          });
          if (!row || row.processedAt) continue;
          if (row.kind === "message")
            await this.inbound.receive(inboundSchema.parse(row.payload));
          else if (row.kind === "status") {
            const status = z
              .object({
                id: z.string(),
                status: z.enum(["sent", "delivered", "read", "failed"]),
              })
              .parse(row.payload);
            const m = await this.db.message.findUnique({
              where: { waMessageId: status.id },
            });
            if (!m)
              throw new Error("Delivery receipt awaits an outbound record");
            const ranks: Record<string, number> = {
              pending: 0,
              failed: 0,
              sent: 1,
              delivered: 2,
              read: 3,
            };
            if (
              m.deliveryStatus !== "read" &&
              (status.status === "failed" ||
                ranks[status.status] >= ranks[m.deliveryStatus])
            ) {
              await this.db.message.updateMany({
                where: { id: m.id, deliveryStatus: m.deliveryStatus },
                data: { deliveryStatus: status.status },
              });
              this.realtime.changed(m.conversationId);
            }
          }
          await this.db.webhookInbox.update({
            where: { id: row.id },
            data: { processedAt: new Date() },
          });
        }
      },
    );
    await this.queue.boss.work<{ conversationId: string }>(
      "conversation",
      { batchSize: 1, pollingIntervalSeconds: 0.5 },
      async (jobs) => {
        for (const job of jobs)
          await this.inbound.process(job.data.conversationId);
      },
    );
  }
}
