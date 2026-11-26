import { RealtimeGateway, NotificationsController } from "./realtime";
import { PushService, PushWorker, PushController } from "./push";
import { QueueService } from "./queue";
import { ConversationWorker } from "./worker";
import { WebhookController, InternalController } from "./webhook";
import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";
import { Db } from "./db";
import { AuthController, AuthGuard } from "./auth";
import { SettingsController, SettingsService } from "./settings";
import { StaffController } from "./staff";
import { ChatsController, ChatsService } from "./chats";
import { InboundService, DevController } from "./inbound";
import { AgentService } from "./agent";
import { WhatsAppProvider } from "./whatsapp";
import { EvolutionWebhookController } from "./evolution";
import { Controller, Get } from "@nestjs/common";
@Controller("health")
class HealthController {
  constructor(private db: Db) {}
  @Get() async health() {
    await this.db.$queryRaw`SELECT 1`;
    return { ok: true };
  }
}
@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET,
      signOptions: {
        expiresIn: "8h",
        issuer: "osman-api",
        audience: "osman-staff",
      },
      verifyOptions: { issuer: "osman-api", audience: "osman-staff" },
    }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]),
    LoggerModule.forRoot({
      pinoHttp: {
        autoLogging: false,
        redact: [
          "req.headers.cookie",
          "req.headers.authorization",
          "req.body",
          "res.headers.set-cookie",
        ],
        serializers: { req: () => undefined, res: () => undefined },
      },
    }),
  ],
  controllers: [
    HealthController,
    AuthController,
    SettingsController,
    StaffController,
    ChatsController,
    DevController,
    WebhookController,
    EvolutionWebhookController,
    InternalController,
    NotificationsController,
    PushController,
  ],
  providers: [
    Db,
    AuthGuard,
    SettingsService,
    ChatsService,
    InboundService,
    AgentService,
    WhatsAppProvider,
    QueueService,
    ConversationWorker,
    RealtimeGateway,
    PushService,
    PushWorker,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
