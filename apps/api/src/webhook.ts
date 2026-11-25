import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { InboundService } from "./inbound";
import { Db } from "./db";
import { SettingsService } from "./settings";
import { QueueService } from "./queue";
import { RealtimeGateway } from "./realtime";
export function validSignature(
  raw: Buffer | undefined,
  signature: string | undefined,
  secret: string | undefined,
) {
  if (
    !raw ||
    !secret ||
    !signature ||
    !/^sha256=[a-f0-9]{64}$/i.test(signature)
  )
    return false;
  return timingSafeEqual(
    createHmac("sha256", secret).update(raw).digest(),
    Buffer.from(signature.slice(7), "hex"),
  );
}
const envelope = z
  .object({
    object: z.literal("whatsapp_business_account"),
    entry: z.array(
      z
        .object({
          changes: z.array(
            z
              .object({
                value: z
                  .object({
                    messages: z
                      .array(
                        z
                          .object({
                            id: z.string(),
                            from: z.string().regex(/^[1-9]\d{7,14}$/),
                            timestamp: z.string().regex(/^\d+$/),
                            type: z.string(),
                            text: z
                              .object({ body: z.string().max(10000) })
                              .optional(),
                          })
                          .passthrough(),
                      )
                      .optional(),
                    statuses: z
                      .array(
                        z
                          .object({
                            id: z.string(),
                            status: z.enum([
                              "sent",
                              "delivered",
                              "read",
                              "failed",
                            ]),
                          })
                          .passthrough(),
                      )
                      .optional(),
                  })
                  .passthrough(),
              })
              .passthrough(),
          ),
        })
        .passthrough(),
    ),
  })
  .passthrough();
@Controller("webhooks/whatsapp")
export class WebhookController {
  constructor(
    private inbound: InboundService,
    private db: Db,
    private queue: QueueService,
    private realtime: RealtimeGateway,
  ) {}
  @Get() verify(
    @Query("hub.mode") mode: string,
    @Query("hub.verify_token") token: string,
    @Query("hub.challenge") challenge: string,
  ) {
    if (
      mode !== "subscribe" ||
      !process.env.WA_VERIFY_TOKEN ||
      token !== process.env.WA_VERIFY_TOKEN
    )
      throw new ForbiddenException();
    return challenge;
  }
  @Post() @HttpCode(200) async receive(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: unknown,
  ) {
    if (
      !validSignature(
        req.rawBody,
        req.get("x-hub-signature-256"),
        process.env.WA_APP_SECRET,
      )
    )
      throw new ForbiddenException("Invalid signature");
    const parsed = envelope.safeParse(body);
    if (!parsed.success) return { ok: true };
    for (const entry of parsed.data.entry)
      for (const change of entry.changes) {
        for (const message of change.value.messages || []) {
          const type = ["text", "image", "audio", "document"].includes(
            message.type,
          )
            ? (message.type as "text" | "image" | "audio" | "document")
            : "other";
          const payload = {
            id: message.id,
            phone: "+" + message.from,
            text: message.text?.body || "",
            type,
            at: new Date(Number(message.timestamp) * 1000).toISOString(),
          };
          await this.db.$transaction(async (tx) => {
            const created = await tx.webhookInbox.createMany({
              data: [{ id: message.id, kind: "message", payload }],
              skipDuplicates: true,
            });
            if (created.count) await this.queue.inbox(message.id, tx);
          });
        }
        for (const status of change.value.statuses || []) {
          const id = `status:${status.id}:${status.status}`;
          await this.db.$transaction(async (tx) => {
            const created = await tx.webhookInbox.createMany({
              data: [
                {
                  id,
                  kind: "status",
                  payload: { id: status.id, status: status.status },
                },
              ],
              skipDuplicates: true,
            });
            if (created.count) await this.queue.inbox(id, tx);
          });
        }
      }
    return { ok: true };
  }
}
@Controller("internal")
export class InternalController {
  constructor(private settings: SettingsService) {}
  @Get("agent-config") config(@Req() req: Request) {
    const expected = process.env.AGENT_API_KEY;
    const actual = req.get("x-agent-api-key") || "";
    if (
      !expected ||
      Buffer.byteLength(actual) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
    )
      throw new ForbiddenException();
    return this.settings.get();
  }
}
