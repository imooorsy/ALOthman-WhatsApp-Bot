import { resolve } from "node:path";
import { AgentPort, AgentRequest, defaultSettings } from "@osman/shared";
const adapter = require(
  resolve(__dirname, "../../../agent/dashboard-adapter.cjs"),
) as {
  createAgent(options: {
    env: NodeJS.ProcessEnv;
    fetcher: typeof fetch;
  }): AgentPort;
  mapAction(
    output: { action: string; priority?: string },
    mode?: string,
  ): string;
};
const intake = require(
  resolve(__dirname, "../../../agent/dashboard-intake.cjs"),
) as {
  routingProblems(
    output: Record<string, unknown>,
    memory: Record<string, unknown>,
    request: AgentRequest,
  ): string[];
  requestedStaff(messages: string[]): boolean;
};
const request: AgentRequest = {
  conversationId: "intake-test",
  clientPhone: "+15555550100",
  history: [
    {
      role: "staff",
      text: "ما علاقتك بالطرف الآخر؟",
      at: new Date().toISOString(),
    },
  ],
  newMessages: ["مجرد عميل وأريد رفع مطالبة"],
  config: { ...defaultSettings, version: 1 },
};
const memory = {
  الاسم: {
    field: "الاسم",
    required: true,
    status: "ناقص",
    value: "",
    asked: 0,
  },
};
const output = {
  service: "تجاري: مطالبة مالية",
  requested: "تمثيل",
  client_name: "",
  memory: [{ field: "الاسم", required: true, status: "ناقص", value: "" }],
  threshold: "غير معروف",
  required_documents: [],
  risk_flags: [],
  status: "قيد الفرز",
  priority: "عادي",
  action: "existing_client",
  next_question: "ما اسمك؟",
  asking_about: ["الاسم"],
  reply_used: "free",
  language: "ar",
  reply: "ما اسمك؟",
  internal_summary: "طلب جديد يحتاج بيانات الاستقبال",
};
const env = {
  MODEL_PROVIDER: "openrouter",
  OPENROUTER_API_KEY: "fixture",
  OPENROUTER_MODEL: "fixture",
};
describe("reversible flexible intake", () => {
  it("does not infer an existing legal file from dashboard staff history", () => {
    expect(intake.routingProblems(output, memory, request)).not.toHaveLength(0);
    expect(
      intake.routingProblems(output, memory, {
        ...request,
        newMessages: ["عندي ملف قضية عندكم وأريد متابعته"],
      }),
    ).toHaveLength(0);
    expect(
      intake.routingProblems(output, memory, {
        ...request,
        newMessages: ["ليس لدي ملف عند مكتبكم"],
      }),
    ).not.toHaveLength(0);
    expect(
      intake.routingProblems(
        { ...output, action: "book", asking_about: [], client_name: "أحمد" },
        { phone: { field: "رقم الهاتف", status: "معروف", value: "٨٣٧٣٧٣" } },
        { ...request, clientPhone: null },
      ),
    ).not.toHaveLength(0);
  });
  it("keeps collecting an unresolved fact instead of handing off with its question", () => {
    expect(
      intake.routingProblems({ ...output, action: "refer" }, memory, request),
    ).not.toHaveLength(0);
    expect(
      intake.routingProblems(
        { ...output, action: "refer" },
        { الاسم: { ...memory.الاسم, status: "رفض" } },
        request,
      ),
    ).toHaveLength(0);
  });
  it("does not delay an urgent or explicitly requested staff handoff", () => {
    expect(
      intake.routingProblems(
        { ...output, action: "urgent", priority: "عاجل" },
        memory,
        request,
      ),
    ).toHaveLength(0);
    expect(
      intake.routingProblems(output, memory, {
        ...request,
        newMessages: ["أريد التحدث إلى موظف الآن"],
      }),
    ).toHaveLength(0);
    expect(intake.requestedStaff(["لا تحولني لموظف"])).toBe(false);
  });
  it("requires practical booking data but accepts a ready appointment request", () => {
    expect(
      intake.routingProblems(
        { ...output, action: "book", asking_about: [] },
        {},
        request,
      ),
    ).not.toHaveLength(0);
    expect(
      intake.routingProblems(
        {
          ...output,
          action: "book",
          asking_about: [],
          client_name: "أحمد",
          requested: "استشارة",
        },
        {},
        request,
      ),
    ).toHaveLength(0);
    expect(
      intake.routingProblems(
        { ...output, action: "book", asking_about: [], client_name: "أحمد" },
        {},
        { ...request, clientPhone: null },
      ),
    ).not.toHaveLength(0);
  });
  it("quiet closing stays with the agent and original mode restores prior routing", () => {
    expect(adapter.mapAction({ action: "close" })).toBe("continue");
    expect(adapter.mapAction({ action: "silent" })).toBe("continue");
    expect(adapter.mapAction({ action: "close" }, "original")).toBe("handoff");
    expect(adapter.mapAction({ action: "silent" }, "original")).toBe("handoff");
    expect(adapter.mapAction({ action: "book" })).toBe("completed");
  });
  it("repairs an early referral before any reply is delivered and gives the model feedback", async () => {
    const fetcher = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockImplementationOnce(
        async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  finish_reason: "stop",
                  message: { content: JSON.stringify(output) },
                },
              ],
            }),
          ),
      )
      .mockImplementationOnce(
        async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  finish_reason: "stop",
                  message: {
                    content: JSON.stringify({ ...output, action: "ask" }),
                  },
                },
              ],
            }),
          ),
      );
    const result = await adapter.createAgent({ env, fetcher }).respond(request);
    expect(result.action).toBe("continue");
    expect(fetcher).toHaveBeenCalledTimes(2);
    const input = JSON.parse(
      JSON.parse(fetcher.mock.calls[1][1]?.body as string).messages[1].content,
    );
    expect(input.guard_problems.length).toBeGreaterThan(0);
    expect(input.client_contact.phone_available).toBe(true);
    expect(
      JSON.parse(fetcher.mock.calls[0][1]?.body as string).messages[0].content,
    ).toContain("تحسين تجريبي");
  });
  it("original mode leaves the prompt and referral handling unchanged", async () => {
    const fetcher = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  finish_reason: "stop",
                  message: { content: JSON.stringify(output) },
                },
              ],
            }),
          ),
      );
    const result = await adapter
      .createAgent({ env: { ...env, AGENT_INTAKE_MODE: "original" }, fetcher })
      .respond(request);
    expect(result.action).toBe("handoff");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(fetcher.mock.calls[0][1]?.body as string).messages[0].content,
    ).not.toContain("تحسين تجريبي");
  });
});
