import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Post,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { Db } from "./db";
import { QueueService } from "./queue";

const record = z.record(z.string(), z.unknown());
const payloadSchema = z.object({
  event: z.string(),
  instance: z.string(),
  data: z.union([record, z.array(record)]),
});
const messageSchema = z.object({
  key: z.object({
    id: z.string().min(1).max(200),
    remoteJid: z.string(),
    fromMe: z.boolean(),
    remoteJidAlt: z.string().optional(),
    senderPn: z.string().optional(),
  }),
  messageTimestamp: z.union([
    z.number(),
    z.string(),
    z.object({ low: z.number() }),
  ]),
  message: record,
  senderPn: z.string().optional(),
});
export function evolutionEvents(body: unknown, instance: string) {
  const parsed = payloadSchema.safeParse(body);
  const messages: {
    id: string;
    phone?: string;
    address: string;
    text: string;
    type: "text" | "image" | "audio" | "document" | "other";
    at: string;
  }[] = [];
  const statuses: {
    id: string;
    status: "sent" | "delivered" | "read" | "failed";
  }[] = [];
  if (!parsed.success || parsed.data.instance !== instance)
    return { messages, statuses };
  const event = parsed.data.event.toLowerCase().replaceAll("_", ".");
  const items = Array.isArray(parsed.data.data)
    ? parsed.data.data
    : [parsed.data.data];
  for (const item of items) {
    if (event === "messages.update") {
      const key = record.safeParse(item.key);
      const update = record.safeParse(item.update);
      const id =
        item.keyId || (key.success ? key.data.id : undefined) || item.id;
      const raw =
        item.status ?? (update.success ? update.data.status : undefined);
      const state = (
        {
          "0": "failed",
          "2": "sent",
          "3": "delivered",
          "4": "read",
          "5": "read",
          ERROR: "failed",
          SERVER_ACK: "sent",
          DELIVERY_ACK: "delivered",
          READ: "read",
          PLAYED: "read",
        } as const
      )[String(raw) as "0"];
      if (typeof id === "string" && state) statuses.push({ id, status: state });
      continue;
    }
    if (event !== "messages.upsert") continue;
    const checked = messageSchema.safeParse(item);
    if (!checked.success || checked.data.key.fromMe) continue;
    const m = checked.data;
    // Private IDs are valid delivery addresses; never invent an E.164 phone from them.
    const address = m.key.remoteJid;
    let jid = address;
    if (/^\d{5,24}@lid$/.test(jid))
      jid =
        [m.key.remoteJidAlt, m.key.senderPn, m.senderPn].find(
          (value) => value && /^[1-9]\d{7,14}@s\.whatsapp\.net$/.test(value),
        ) || "";
    if (!/^(?:[1-9]\d{7,14}@s\.whatsapp\.net|\d{5,24}@lid)$/.test(address))
      continue;
    const seconds = Number(
      typeof m.messageTimestamp === "object"
        ? m.messageTimestamp.low
        : m.messageTimestamp,
    );
    if (
      !Number.isFinite(seconds) ||
      seconds <= 0 ||
      seconds * 1000 > Date.now() + 60000
    )
      continue;
    let content = m.message;
    for (let depth = 0; depth < 4; depth++) {
      const wrapper = [
        "ephemeralMessage",
        "viewOnceMessage",
        "viewOnceMessageV2",
        "documentWithCaptionMessage",
      ]
        .map((k) => content[k])
        .find((v) => typeof v === "object" && v !== null);
      const inside = record.safeParse(wrapper);
      const nested = inside.success
        ? record.safeParse(inside.data.message)
        : null;
      if (!nested?.success) break;
      content = nested.data;
    }
    if (
      content.protocolMessage ||
      content.reactionMessage ||
      content.senderKeyDistributionMessage
    )
      continue;
    const extended = record.safeParse(content.extendedTextMessage);
    const text =
      typeof content.conversation === "string"
        ? content.conversation
        : extended.success && typeof extended.data.text === "string"
          ? extended.data.text
          : "";
    const type = content.imageMessage
      ? "image"
      : content.audioMessage
        ? "audio"
        : content.documentMessage
          ? "document"
          : text
            ? "text"
            : "other";
    messages.push({
      id: m.key.id,
      ...(jid ? { phone: "+" + jid.split("@")[0] } : {}),
      address,
      text: text.slice(0, 10000),
      type,
      at: new Date(seconds * 1000).toISOString(),
    });
  }
  return { messages, statuses };
}

@Controller("webhooks/evolution")
export class EvolutionWebhookController {
  constructor(
    private db: Db,
    private queue: QueueService,
  ) {}
  @Post() @HttpCode(200) async receive(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    const expected = process.env.EVOLUTION_WEBHOOK_SECRET || "";
    const supplied = req.get("x-webhook-secret") || "";
    if (
      process.env.WA_PROVIDER !== "evolution" ||
      !expected ||
      Buffer.byteLength(expected) !== Buffer.byteLength(supplied) ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))
    )
      throw new ForbiddenException();
    const { messages, statuses } = evolutionEvents(
      body,
      process.env.EVOLUTION_INSTANCE || "",
    );
    for (const event of [
      ...messages.map((payload) => ({
        id: payload.id,
        kind: "message",
        payload,
      })),
      ...statuses.map((payload) => ({
        id: `status:${payload.id}:${payload.status}`,
        kind: "status",
        payload,
      })),
    ]) {
      await this.db.$transaction(async (tx) => {
        const created = await tx.webhookInbox.createMany({
          data: [event],
          skipDuplicates: true,
        });
        if (created.count) await this.queue.inbox(event.id, tx);
      });
    }
    return { ok: true };
  }
}
