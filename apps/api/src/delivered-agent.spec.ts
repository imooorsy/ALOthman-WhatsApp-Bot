import {
  AgentPort,
  AgentRequest,
  agentResponseSchema,
  defaultSettings,
} from "@osman/shared";
import { resolve } from "node:path";
const adapter = require(
  resolve(__dirname, "../../../agent/dashboard-adapter.cjs"),
) as {
  createAgent(options: {
    env: NodeJS.ProcessEnv;
    fetcher: typeof fetch;
  }): AgentPort;
  mapAction(value: {
    action: string;
    priority?: string;
    status?: string;
  }): string;
};
const request: AgentRequest = {
  conversationId: "contract",
  clientPhone: "+15555550100",
  history: [],
  newMessages: ["السلام عليكم"],
  config: { ...defaultSettings, version: 9 },
};
const output = {
  service: "",
  requested: "غير محدد",
  client_name: "",
  memory: [],
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
const env = {
  MODEL_PROVIDER: "openrouter",
  OPENROUTER_API_KEY: "test-key",
  OPENROUTER_MODEL: "test-model",
};
describe("delivered agent adapter", () => {
  it.each([
    ["ask", "continue"],
    ["answer", "continue"],
    ["refer", "handoff"],
    ["urgent", "handoff_urgent"],
    ["book", "completed"],
    ["decline", "not_suitable"],
    ["existing_client", "handoff"],
    ["job", "not_suitable"],
    ["marketing", "not_suitable"],
    ["close", "handoff"],
    ["silent", "handoff"],
  ])("maps %s to %s", (action, expected) =>
    expect(adapter.mapAction({ action })).toBe(expected),
  );
  it("keeps a decline unsuitable even when marked urgent", () =>
    expect(adapter.mapAction({ action: "decline", priority: "عاجل" })).toBe(
      "not_suitable",
    ));
  it("calls the actual engineer provider, validates the reply and passes current settings", async () => {
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
              model: "test-model",
            }),
          ),
      );
    const agent = adapter.createAgent({ env, fetcher });
    const response = agentResponseSchema.parse(await agent.respond(request));
    expect(response.action).toBe("continue");
    expect(response.state?.adapter).toBe("alothman-v1");
    const body = JSON.parse(fetcher.mock.calls[0][1]?.body as string);
    expect(body.messages[0].content).toContain('"version":9');
    expect(body.messages[0].content).toContain(request.config.office.name);
    expect(JSON.parse(body.messages[1].content).conversation[0]).toMatchObject({
      new: true,
      role: "client",
    });
    await agent.respond({
      ...request,
      state: response.state,
      history: [
        {
          role: "assistant",
          text: response.reply!,
          at: new Date().toISOString(),
        },
      ],
      newMessages: ["أحتاج استشارة"],
    });
    expect(
      JSON.parse(
        JSON.parse(fetcher.mock.calls[1][1]?.body as string).messages[1]
          .content,
      ).previous,
    ).not.toBeNull();
  });
  it("rejects missing configuration, paused models and invalid model schema", async () => {
    const fetcher = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              choices: [{ finish_reason: "stop", message: { content: "{}" } }],
            }),
          ),
      );
    await expect(
      adapter.createAgent({ env: {}, fetcher }).respond(request),
    ).rejects.toThrow();
    await expect(
      adapter
        .createAgent({ env, fetcher })
        .respond({
          ...request,
          config: {
            ...request.config,
            rules: { ...request.config.rules, paused: true },
          },
        }),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    await expect(
      adapter.createAgent({ env, fetcher }).respond(request),
    ).rejects.toThrow("agent_invalid_schema");
  });
  it("rejects unsafe replies even if their schema is valid", async () => {
    const unsafe = { ...output, reply: "أضمن لك كسب القضية" };
    const fetcher = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  finish_reason: "stop",
                  message: { content: JSON.stringify(unsafe) },
                },
              ],
            }),
          ),
      );
    await expect(
      adapter.createAgent({ env, fetcher }).respond(request),
    ).rejects.toThrow("agent_reply_rejected");
  });
  it("bounds persisted memory and rejects non-JSON state", () => {
    const valid = {
      reply: null,
      action: "handoff",
      category: null,
      clientName: null,
      summary: null,
      urgentReason: null,
    };
    expect(
      agentResponseSchema.safeParse({ ...valid, state: { bad: undefined } })
        .success,
    ).toBe(false);
    expect(
      agentResponseSchema.safeParse({
        ...valid,
        state: { oversized: "x".repeat(100001) },
      }).success,
    ).toBe(false);
  });
});
