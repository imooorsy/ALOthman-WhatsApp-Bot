import {
  Controller,
  Get,
  Post,
  Param,
  Req,
  UseGuards,
  Logger,
} from "@nestjs/common";
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
} from "@nestjs/websockets";
import { Server } from "socket.io";
import { events } from "@osman/shared";
import { AuthGuard, AuthRequest } from "./auth";
import { Db } from "./db";
import { PushService } from "./push";
@WebSocketGateway({
  cors: {
    origin: (process.env.WEB_ORIGINS || "http://localhost:3000").split(","),
    credentials: true,
  },
  transports: ["websocket"],
})
export class RealtimeGateway implements OnGatewayInit {
  private log = new Logger(RealtimeGateway.name);
  @WebSocketServer() server!: Server;
  constructor(
    private auth: AuthGuard,
    private db: Db,
    private push: PushService,
  ) {}
  afterInit(server: Server) {
    server.use(async (socket, next) => {
      try {
        const origin = socket.handshake.headers.origin;
        const origins = (process.env.WEB_ORIGINS || "http://localhost:3000")
          .split(",")
          .map((x) => x.trim());
        if (!origin || !origins.includes(origin)) throw new Error();
        const cookie = socket.handshake.headers.cookie
          ?.split(";")
          .map((x) => x.trim())
          .find((x) => x.startsWith("osman_session="))
          ?.slice("osman_session=".length);
        socket.data.user = await this.auth.actor(cookie);
        next();
      } catch {
        next(new Error("Unauthorized"));
      }
    });
    server.on("connection", (socket) => {
      socket.join("staff");
      const recheck = setInterval(() => {
        void this.auth
          .actor(
            socket.handshake.headers.cookie
              ?.split(";")
              .map((x) => x.trim())
              .find((x) => x.startsWith("osman_session="))
              ?.slice(14),
          )
          .catch(() => socket.disconnect(true));
      }, 60000);
      socket.on("disconnect", () => clearInterval(recheck));
    });
  }
  changed(conversationId: string, actorStaffId?: string) {
    this.server
      ?.to("staff")
      .emit(events.updated, { conversationId, actorStaffId });
  }
  async notify(conversationId: string, notificationId: string, event: string) {
    const notification = await this.db.notification.findUnique({
      where: { id: notificationId },
      include: { conversation: { include: { client: true } } },
    });
    if (notification)
      this.server?.to("staff").emit(event, { conversationId, notification });
    if (notification)
      await this.push
        .enqueueNotification(notificationId)
        .catch(() =>
          this.log.error("Could not enqueue background notification"),
        );
  }
  settings(paused: boolean) {
    this.server?.to("staff").emit(events.settings, { paused });
  }
}
@Controller("notifications")
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private db: Db) {}
  @Get() list(@Req() req: AuthRequest) {
    return this.db.notification.findMany({
      where: { reads: { none: { staffId: req.user.id } } },
      include: { conversation: { include: { client: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }
  @Post(":id/read") async read(
    @Param("id") id: string,
    @Req() req: AuthRequest,
  ) {
    await this.db.notificationRead.upsert({
      where: {
        notificationId_staffId: { notificationId: id, staffId: req.user.id },
      },
      create: { notificationId: id, staffId: req.user.id },
      update: {},
    });
    return { ok: true };
  }
}
