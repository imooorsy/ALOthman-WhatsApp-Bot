import { spawn, ChildProcess } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hash } from "bcrypt";
import { defaultSettings } from "@osman/shared";
import { io } from "socket.io-client";
import { InboundService } from "./inbound";
import { SettingsService } from "./settings";
import { AgentService } from "./agent";
import { Db } from "./db";
import { QueueService } from "./queue";
import { RealtimeGateway } from "./realtime";
import { WhatsAppProvider } from "./whatsapp";
import { resolve } from "node:path";
import type { AgentPort } from "@osman/shared";
const describeDatabase = process.env.TEST_DATABASE_URL
  ? describe
  : describe.skip;
describeDatabase("webhook → PostgreSQL queue → agent → state → socket", () => {
  let db: PrismaClient;
  let child: ChildProcess;
  let cookie: string;
  let socket: ReturnType<typeof io>;
  let id: string | undefined;
  const secret = randomBytes(24).toString("hex");
  const password = randomBytes(24).toString("hex");
  const phone = "1555" + String(Date.now()).slice(-7);
  const email = "pipeline-" + Date.now() + "@example.invalid";
  const base = "http://127.0.0.1:4101";
  beforeAll(async () => {
    db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
    const { services, categories, ...data } = defaultSettings;
    await db.officeSettings.upsert({
      where: { id: 1 },
      create: { id: 1, data },
      update: {},
    });
    await db.staffUser.create({
      data: {
        email,
        name: "اختبار",
        role: "admin",
        passwordHash: await hash(password, 4),
      },
    });
    child = spawn(process.execPath, ["dist/src/main.js"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: process.env.TEST_DATABASE_URL,
        PORT: "4101",
        WEB_ORIGINS: "http://localhost:3000",
        JWT_SECRET: randomBytes(32).toString("hex"),
        WA_APP_SECRET: secret,
        WA_PROVIDER: "mock",
        AGENT_MODE: "mock",
        DEBOUNCE_MS: "50",
        NODE_ENV: "test",
      },
      stdio: "ignore",
    });
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try {
        ready = (await fetch(base + "/health")).ok;
      } catch {}
      if (ready) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!ready) throw new Error("Test API did not start");
    const login = await fetch(base + "/auth/login", {
      method: "POST",
      headers: {
        Origin: "http://localhost:3000",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });
    expect(login.status).toBe(201);
    cookie = login.headers.get("set-cookie")!.split(";")[0];
    socket = io(base, {
      transports: ["websocket"],
      reconnection: false,
      extraHeaders: { Origin: "http://localhost:3000", Cookie: cookie },
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Socket connection timeout")),
        5000,
      );
      socket.once("connect", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once("connect_error", reject);
    });
  }, 30000);
  afterAll(async () => {
    socket?.disconnect();
    child?.kill();
    if (db) {
      if (id) await db.conversation.deleteMany({ where: { id } });
      await db.client.deleteMany({ where: { phone: "+" + phone } });
      await db.webhookInbox.deleteMany({
        where: { id: { startsWith: "pipeline-" + phone } },
      });
      await db.staffUser.deleteMany({ where: { email } });
      await db.$disconnect();
    }
  });
  it("deduplicates webhook retries and emits a handoff after durable processing", async () => {
    const messages: unknown[] = [];
    socket.on("handoff.created", (payload) => messages.push(payload));
    const waId = "pipeline-" + phone;
    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: waId,
                    from: phone,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: "text",
                    text: { body: "عاجل" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const signature =
      "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
    const send = () =>
      fetch(base + "/webhooks/whatsapp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Hub-Signature-256": signature,
        },
        body,
      });
    expect(
      (await Promise.all([send(), send(), send()])).every(
        (r) => r.status === 200,
      ),
    ).toBe(true);
    let conversation;
    for (let i = 0; i < 60; i++) {
      const message = await db.message.findUnique({
        where: { waMessageId: waId },
      });
      if (message) {
        id = message.conversationId;
        conversation = await db.conversation.findUnique({
          where: { id },
          include: { messages: true },
        });
      }
      if (conversation?.status === "urgent" && messages.length) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(conversation?.status).toBe("urgent");
    expect(
      conversation?.messages.filter((m) => m.direction === "client"),
    ).toHaveLength(1);
    expect(
      conversation?.messages.filter((m) => m.direction === "agent"),
    ).toHaveLength(1);
    expect(messages).toHaveLength(1);
    expect(await db.notification.count({ where: { conversationId: id } })).toBe(
      1,
    );
    const outbound = conversation!.messages.find(
      (m) => m.direction === "agent",
    )!;
    for (const status of ["read", "delivered"]) {
      const receipt = JSON.stringify({
        object: "whatsapp_business_account",
        entry: [
          {
            changes: [
              { value: { statuses: [{ id: outbound.waMessageId, status }] } },
            ],
          },
        ],
      });
      const sig =
        "sha256=" + createHmac("sha256", secret).update(receipt).digest("hex");
      expect(
        (
          await fetch(base + "/webhooks/whatsapp", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Hub-Signature-256": sig,
            },
            body: receipt,
          })
        ).status,
      ).toBe(200);
      for (let i = 0; i < 30; i++) {
        const row = await db.webhookInbox.findUnique({
          where: { id: `status:${outbound.waMessageId}:${status}` },
        });
        if (row?.processedAt) break;
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    expect(
      (await db.message.findUniqueOrThrow({ where: { id: outbound.id } }))
        .deliveryStatus,
    ).toBe("read");
    await db.webhookInbox.deleteMany({
      where: {
        id: {
          in: [
            `status:${outbound.waMessageId}:read`,
            `status:${outbound.waMessageId}:delivered`,
          ],
        },
      },
    });
  });
  it("persists the delivered agent memory and restores it on the next turn", async () => {
    const client = await db.client.create({
      data: { phone: "+1777" + phone.slice(-7) },
    });
    const c = await db.conversation.create({
      data: {
        clientId: client.id,
        lastActivityAt: new Date(Date.now() - 60000),
        messages: { create: { direction: "client", text: "السلام عليكم" } },
      },
    });
    const { createAgent } = require(
      resolve(__dirname, "../../../agent/dashboard-adapter.cjs"),
    ) as {
      createAgent(options: {
        env: NodeJS.ProcessEnv;
        fetcher: typeof fetch;
      }): AgentPort;
    };
    const answer = {
      service: "",
      requested: "غير محدد",
      client_name: "",
      memory: [
        { field: "المدينة", required: false, status: "معروف", value: "الرياض" },
      ],
      threshold: "غير معروف",
      required_documents: [],
      risk_flags: [],
      status: "قيد الفرز",
      priority: "عادي",
      action: "ask",
      next_question: "كيف يمكنني مساعدتك؟",
      asking_about: [],
      reply_used: "R1",
      language: "ar",
      reply: "وعليكم السلام، معك عثمان. كيف يمكنني مساعدتك؟",
      internal_summary: "",
    };
    (answer.asking_about as string[]).push("نوع الخدمة");
    const fetcher = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  finish_reason: "stop",
                  message: { content: JSON.stringify(answer) },
                },
              ],
            }),
          ),
      );
    const agent = createAgent({
      env: {
        MODEL_PROVIDER: "openrouter",
        OPENROUTER_API_KEY: "fixture",
        OPENROUTER_MODEL: "fixture",
      },
      fetcher,
    });
    const respond = jest.spyOn(agent, "respond");
    const realtime = {
      changed: jest.fn(),
      notify: jest.fn(),
    } as unknown as RealtimeGateway;
    const wa = {
      send: jest.fn().mockResolvedValue({ id: "fixture-" + c.id }),
    } as unknown as WhatsAppProvider;
    const service = new InboundService(
      db as Db,
      new SettingsService(db as Db),
      agent as AgentService,
      wa,
      {} as QueueService,
      realtime,
    );
    try {
      await service.process(c.id);
      expect(respond).toHaveBeenCalledTimes(1);
      await expect(respond.mock.results[0].value).resolves.toHaveProperty(
        "state",
      );
      const saved = await db.conversation.findUniqueOrThrow({
        where: { id: c.id },
      });
      expect(saved.agentState).toMatchObject({
        adapter: "alothman-v1",
        memory: { المدينه: { value: "الرياض" } },
      });
      const reply = await db.message.findFirstOrThrow({
        where: { conversationId: c.id, direction: "agent" },
      });
      expect(reply.agentConfigVersion).toBeGreaterThan(0);
      await db.message.create({
        data: {
          conversationId: c.id,
          direction: "client",
          text: "أحتاج مساعدة",
        },
      });
      await db.conversation.update({
        where: { id: c.id },
        data: { lastActivityAt: new Date(Date.now() - 60000) },
      });
      answer.action = "silent";
      answer.reply = "";
      await service.process(c.id);
      const input = JSON.parse(
        JSON.parse(fetcher.mock.calls[1][1]?.body as string).messages[1]
          .content,
      );
      expect(input.memory).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: "المدينة", value: "الرياض" }),
        ]),
      );
      expect(
        (await db.conversation.findUniqueOrThrow({ where: { id: c.id } }))
          .status,
      ).toBe("human");
      expect(realtime.notify).toHaveBeenCalled();
    } finally {
      await db.conversation.delete({ where: { id: c.id } });
      await db.client.delete({ where: { id: client.id } });
    }
  });
  it("persists a human fallback, audit entry and notification on agent failure", async () => {
    const client = await db.client.create({
      data: { phone: "+1666" + phone.slice(-7) },
    });
    const c = await db.conversation.create({
      data: {
        clientId: client.id,
        lastActivityAt: new Date(Date.now() - 5000),
        messages: { create: { direction: "client", text: "test failure" } },
      },
    });
    try {
      const realtime = {
        changed: jest.fn(),
        notify: jest.fn().mockResolvedValue(undefined),
      } as unknown as RealtimeGateway;
      const service = new InboundService(
        db as Db,
        new SettingsService(db as Db),
        {
          respond: jest.fn().mockRejectedValue(new Error("invalid response")),
        } as unknown as AgentService,
        new WhatsAppProvider(),
        { enqueue: jest.fn() } as unknown as QueueService,
        realtime,
      );
      await service.process(c.id);
      const result = await db.conversation.findUniqueOrThrow({
        where: { id: c.id },
        include: { events: true, notifications: true, messages: true },
      });
      expect(result.status).toBe("human");
      expect(result.events.some((e) => e.type === "agent_error")).toBe(true);
      expect(result.notifications[0].type).toBe("agent_error");
      expect(result.messages[0].processedAt).not.toBeNull();
      expect(realtime.notify).toHaveBeenCalled();
    } finally {
      await db.conversation.delete({ where: { id: c.id } });
      await db.client.delete({ where: { id: client.id } });
    }
  });
});
