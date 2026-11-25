import { z } from "zod";
export const statuses = [
  "agent_active",
  "human",
  "urgent",
  "waiting_schedule",
  "not_suitable",
] as const;
export type ConversationStatus = (typeof statuses)[number];
export const statusLabels: Record<ConversationStatus, string> = {
  agent_active: "عثمان يحاور",
  human: "عند موظف",
  urgent: "عاجل",
  waiting_schedule: "بانتظار الموعد",
  not_suitable: "غير مناسب",
};
export const phoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, "أدخل رقمًا بالصيغة الدولية مثل +966501234567");
export const notifyPrefsSchema = z.object({
  sound: z.boolean(),
  desktop: z.boolean(),
  volume: z.number().min(0).max(1),
});
export const settingsSchema = z.object({
  office: z.object({
    name: z.string().trim().min(1).max(200),
    intro: z.string().max(5000),
    address: z.string().max(500),
    workingHours: z.string().max(500),
  }),
  contacts: z.object({
    office: phoneSchema.or(z.literal("")),
    secretary: phoneSchema.or(z.literal("")),
    employee: phoneSchema.or(z.literal("")),
  }),
  rules: z.object({
    minimumClaim: z.number().nonnegative(),
    urgentHandoff: z.boolean(),
    autoApology: z.boolean(),
    sendSummary: z.boolean(),
    paused: z.boolean(),
  }),
  services: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string().trim().min(1).max(200),
        price: z.number().nonnegative().max(1e9),
        active: z.boolean(),
        sort: z.number().int().nonnegative(),
      }),
    )
    .max(100),
  categories: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string().trim().min(1).max(200),
        active: z.boolean(),
        outOfScope: z.boolean(),
        sort: z.number().int().nonnegative(),
      }),
    )
    .max(100),
});
export type OfficeConfig = z.infer<typeof settingsSchema> & { version: number };
export const defaultSettings: z.infer<typeof settingsSchema> = {
  office: {
    name: "آل عثمان محامون ومستشارون",
    intro: "",
    address: "",
    workingHours: "",
  },
  contacts: { office: "", secretary: "", employee: "" },
  rules: {
    minimumClaim: 80000,
    urgentHandoff: true,
    autoApology: true,
    sendSummary: true,
    paused: false,
  },
  services: [
    ["استشارة حضورية أو مرئية", 750],
    ["استشارة هاتفية", 500],
    ["صياغة صحيفة أو مذكرة (من)", 2500],
    ["حضور جلسة أو تحقيق", 5000],
  ].map(([name, price], sort) => ({
    name: String(name),
    price: Number(price),
    active: true,
    sort,
  })),
  categories: [
    "عمالي",
    "تجاري وعقود",
    "ضريبي وزكوي",
    "عقاري",
    "أسري",
    "خارج النطاق",
  ].map((name, sort) => ({
    name,
    active: true,
    outOfScope: name === "خارج النطاق",
    sort,
  })),
};
export type Staff = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "employee";
  notifyPrefs: z.infer<typeof notifyPrefsSchema>;
};
export const agentResponseSchema = z
  .object({
    reply: z.string().max(10000).nullable(),
    action: z.enum([
      "continue",
      "handoff",
      "handoff_urgent",
      "not_suitable",
      "completed",
    ]),
    category: z.string().max(200).nullable(),
    clientName: z.string().max(200).nullable(),
    summary: z.string().max(10000).nullable(),
    urgentReason: z.string().max(1000).nullable(),
  })
  .strict();
export type AgentResponse = z.infer<typeof agentResponseSchema>;
export interface AgentRequest {
  conversationId: string;
  clientPhone: string;
  history: {
    role: "client" | "assistant" | "staff";
    text: string;
    at: string;
  }[];
  newMessages: string[];
  config: OfficeConfig;
}
export interface AgentPort {
  respond(request: AgentRequest): Promise<AgentResponse>;
}
export const events = {
  updated: "conversation.updated",
  inbound: "message.inbound",
  handoff: "handoff.created",
  settings: "settings.updated",
} as const;
export type ChatMessage = {
  id: string;
  conversationId: string;
  direction: "client" | "agent" | "staff";
  type: "text" | "image" | "audio" | "document" | "other";
  text: string;
  deliveryStatus: string;
  createdAt: string;
  agentConfigVersion: number | null;
};
export type Chat = {
  id: string;
  clientId: string;
  client: {
    phone: string;
    name: string | null;
    detectedCategory: string | null;
    shortDescription: string | null;
  };
  status: ConversationStatus;
  assignedStaffId: string | null;
  assignedStaff: { id: string; name: string } | null;
  category: string | null;
  summary: string | null;
  urgentReason: string | null;
  unreadCount: number;
  lastClientMessageAt: string;
  lastActivityAt: string;
  version: number;
  messages: ChatMessage[];
};
export type StaffAction = "take" | "resume" | "secretary" | "close";
export type StaffNotification = {
  id: string;
  type: string;
  conversationId: string;
  reason: string;
  createdAt: string;
  conversation: Chat;
};
export class ConversationMachine {
  static agentAction(action: AgentResponse["action"]): ConversationStatus {
    return {
      continue: "agent_active",
      handoff: "human",
      handoff_urgent: "urgent",
      not_suitable: "not_suitable",
      completed: "waiting_schedule",
    }[action] as ConversationStatus;
  }
  static inbound(
    status: ConversationStatus,
    paused: boolean,
    attachment: boolean,
    options = {
      attachmentHandoff: true,
      notifyWaiting: true,
      notifyNotSuitable: false,
    },
  ) {
    const next =
      paused || (attachment && options.attachmentHandoff) ? "human" : status;
    return {
      status: next as ConversationStatus,
      callAgent: next === "agent_active" && !paused,
      notify:
        next === "human" ||
        next === "urgent" ||
        (next === "waiting_schedule" && options.notifyWaiting) ||
        (next === "not_suitable" && options.notifyNotSuitable),
      reason: paused ? "البوت متوقف" : attachment ? "مرفق" : "رسالة جديدة",
    };
  }
  static staff(action: StaffAction, assignee: string | null, actor: string) {
    if (assignee && assignee !== actor)
      throw new Error("المحادثة عند موظف آخر");
    return {
      status: (
        {
          take: "human",
          resume: "agent_active",
          secretary: "waiting_schedule",
          close: "not_suitable",
        } as const
      )[action],
      assignedStaffId: action === "take" ? actor : null,
    };
  }
  static canCompose(
    status: ConversationStatus,
    lastClientMessageAt: string | Date,
    now = Date.now(),
  ) {
    const elapsed = now - new Date(lastClientMessageAt).getTime();
    return (
      (status === "human" || status === "urgent") &&
      elapsed >= 0 &&
      elapsed < 24 * 60 * 60 * 1000
    );
  }
}
export function secretaryLink(
  number: string,
  client: {
    name: string | null;
    phone: string;
    category: string | null;
    summary: string | null;
  },
) {
  if (!phoneSchema.safeParse(number).success)
    throw new Error("أضف رقم واتساب السكرتيرة في الإعدادات أولًا");
  const text = `العميل: ${client.name || client.phone}\nالهاتف: ${client.phone}\nتصنيف القضية: ${client.category || "غير محدد"}\nملخص الفريق: ${client.summary || "لم يُضف ملخص بعد"}\nبانتظار تحديد موعد`;
  return `https://wa.me/${number.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}
