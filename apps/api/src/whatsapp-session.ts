import {
  Controller,
  Get,
  Header,
  Injectable,
  Post,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";
import { AuthGuard, Admin, AuthRequest } from "./auth";
import { Db } from "./db";
import { evolutionRequest, EvolutionApiError } from "./evolution-client";

const stateSchema = z.object({ instance: z.object({ state: z.string() }) });
const listSchema = z.array(
  z.object({
    name: z.string().optional(),
    instance: z
      .object({
        name: z.string().optional(),
        instanceName: z.string().optional(),
      })
      .optional(),
  }),
);
const qrSchema = z.object({ base64: z.string().max(300000).optional() });
export type WhatsAppSession = {
  provider: string;
  state:
    | "connected"
    | "disconnected"
    | "connecting"
    | "unavailable"
    | "unconfigured"
    | "not_applicable";
  qr: string | null;
  expiresAt: string | null;
};
@Injectable()
export class WhatsAppSessionService {
  private pendingUntil = 0;
  private image: string | null = null;
  private imageUntil = 0;
  constructor(private db: Db) {}
  private configured() {
    return !!(
      process.env.EVOLUTION_URL &&
      process.env.EVOLUTION_API_KEY &&
      process.env.EVOLUTION_INSTANCE &&
      process.env.EVOLUTION_WEBHOOK_SECRET
    );
  }
  private callback() {
    const callback = new URL(
      process.env.EVOLUTION_CALLBACK_URL ||
        "http://host.docker.internal:4000/webhooks/evolution",
    );
    if (
      callback.username ||
      callback.password ||
      callback.pathname !== "/webhooks/evolution" ||
      callback.search ||
      callback.hash ||
      !["http:", "https:"].includes(callback.protocol)
    )
      throw new Error("Invalid callback configuration");
    if (
      process.env.NODE_ENV === "production" &&
      (!process.env.EVOLUTION_CALLBACK_URL || callback.protocol !== "https:")
    )
      throw new Error("Production callback must use HTTPS");
    return callback.href;
  }
  async status(admin = false): Promise<WhatsAppSession> {
    const provider = process.env.WA_PROVIDER || "mock";
    const result: WhatsAppSession = {
      provider,
      state: "not_applicable",
      qr: null,
      expiresAt: null,
    };
    if (provider !== "evolution") return result;
    if (!this.configured()) return { ...result, state: "unconfigured" };
    try {
      const name = encodeURIComponent(process.env.EVOLUTION_INSTANCE!);
      const response = stateSchema.parse(
        await evolutionRequest("/instance/connectionState/" + name),
      );
      if (response.instance.state === "open") {
        this.image = null;
        this.pendingUntil = 0;
        return { ...result, state: "connected" };
      }
      if (admin && this.pendingUntil > Date.now()) {
        const qr = qrSchema.parse(
          await evolutionRequest("/instance/connect/" + name),
        );
        if (
          qr.base64 &&
          /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(qr.base64)
        ) {
          const bytes = Buffer.from(qr.base64.split(",")[1], "base64");
          if (
            bytes
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
            this.image !== qr.base64
          ) {
            this.image = qr.base64;
            this.imageUntil = Date.now() + 45000;
          }
        }
        return {
          ...result,
          state: "connecting",
          qr: this.imageUntil > Date.now() ? this.image : null,
          expiresAt:
            this.imageUntil > Date.now()
              ? new Date(this.imageUntil).toISOString()
              : null,
        };
      }
      if (this.pendingUntil <= Date.now()) this.image = null;
      return {
        ...result,
        state:
          response.instance.state === "connecting"
            ? "connecting"
            : "disconnected",
      };
    } catch (error) {
      return {
        ...result,
        state:
          error instanceof EvolutionApiError && error.status === 404
            ? "disconnected"
            : "unavailable",
      };
    }
  }
  async connect(actorId: string) {
    if (process.env.WA_PROVIDER !== "evolution" || !this.configured())
      throw new ServiceUnavailableException(
        "أكمل إعداد موصل واتساب على الخادم أولًا",
      );
    // Record intent before touching the external connector; never store keys or QR data.
    await this.db.systemAuditEvent.create({
      data: {
        actorStaffId: actorId,
        type: "whatsapp.connect.requested",
        payload: {},
      },
    });
    try {
      const callback = this.callback();
      const name = process.env.EVOLUTION_INSTANCE!;
      const list = listSchema.parse(
        await evolutionRequest("/instance/fetchInstances"),
      );
      const webhook = {
        enabled: true,
        url: callback,
        headers: { "x-webhook-secret": process.env.EVOLUTION_WEBHOOK_SECRET },
        byEvents: false,
        base64: false,
        events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE"],
      };
      if (
        !list.some((item) =>
          [
            item.name,
            item.instance?.name,
            item.instance?.instanceName,
          ].includes(name),
        )
      )
        await evolutionRequest("/instance/create", "POST", {
          instanceName: name,
          integration: "WHATSAPP-BAILEYS",
          qrcode: false,
          groupsIgnore: true,
          alwaysOnline: false,
          readMessages: false,
          readStatus: false,
          syncFullHistory: false,
          webhook,
        });
      await evolutionRequest(
        "/webhook/set/" + encodeURIComponent(name),
        "POST",
        { webhook },
      );
      this.pendingUntil = Date.now() + 10 * 60 * 1000;
      await this.db.systemAuditEvent.create({
        data: {
          actorStaffId: actorId,
          type: "whatsapp.connect.prepared",
          payload: {},
        },
      });
      return await this.status(true);
    } catch {
      await this.db.systemAuditEvent.create({
        data: {
          actorStaffId: actorId,
          type: "whatsapp.connect.failed",
          payload: {},
        },
      });
      throw new ServiceUnavailableException(
        "تعذر تجهيز ربط واتساب؛ تحقق من إعدادات الموصل واتصال الخادم",
      );
    }
  }
}
@Controller("whatsapp")
@UseGuards(AuthGuard)
export class WhatsAppSessionController {
  constructor(private sessions: WhatsAppSessionService) {}
  @Get("status")
  @Header("Cache-Control", "no-store, private")
  status(@Req() req: AuthRequest) {
    return this.sessions.status(req.user.role === "admin");
  }
  @Post("connect")
  @Admin()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Header("Cache-Control", "no-store, private")
  connect(@Req() req: AuthRequest) {
    return this.sessions.connect(req.user.id);
  }
}
