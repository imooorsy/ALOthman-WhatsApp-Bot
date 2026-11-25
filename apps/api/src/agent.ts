import { Injectable } from "@nestjs/common";
import {
  AgentPort,
  AgentRequest,
  AgentResponse,
  agentResponseSchema,
} from "@osman/shared";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
export class MockAgent implements AgentPort {
  async respond(req: AgentRequest): Promise<AgentResponse> {
    const text = req.newMessages.join("\n");
    const action = /عاجل|urgent/i.test(text)
      ? "handoff_urgent"
      : /موظف|handoff/i.test(text)
        ? "handoff"
        : /خارج النطاق|غير مناسب|unsuitable/i.test(text)
          ? "not_suitable"
          : /موعد|انتهيت|completed/i.test(text)
            ? "completed"
            : "continue";
    return agentResponseSchema.parse({
      reply:
        action === "continue"
          ? "معك عثمان. كيف يمكننا مساعدتك؟"
          : action === "not_suitable"
            ? "نعتذر، الطلب خارج نطاق خدمات المكتب."
            : action === "completed"
              ? "تم استلام طلبك، بانتظار تحديد موعد مع السكرتيرة."
              : "تم تحويل طلبك إلى الفريق المختص.",
      action,
      category:
        req.config.categories.find((c) => c.active && text.includes(c.name))
          ?.name || null,
      clientName: null,
      summary:
        action === "continue" ? null : "محادثة تجريبية تحتاج متابعة الفريق.",
      urgentReason:
        action === "handoff_urgent" ? "طلب العميل متابعة عاجلة" : null,
    });
  }
}
@Injectable()
export class AgentService implements AgentPort {
  private adapter: AgentPort | undefined;
  async respond(req: AgentRequest) {
    const attempts = Number(process.env.AGENT_RETRIES || 1) + 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const call = async () => {
          const mode = process.env.AGENT_MODE || "mock";
          if (mode === "http") {
            const address = process.env.AGENT_URL || "";
            const response = await fetch(
              new URL(
                "/respond",
                address.includes("://") ? address : "http://" + address,
              ),
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-agent-api-key": process.env.AGENT_API_KEY || "",
                },
                body: JSON.stringify(req),
                signal: AbortSignal.timeout(
                  Number(process.env.AGENT_TIMEOUT_MS || 20000),
                ),
              },
            );
            if (!response.ok) throw new Error("Agent HTTP error");
            return response.json();
          }
          if (!this.adapter) {
            if (mode === "mock") this.adapter = new MockAgent();
            else if (mode === "inprocess") {
              // Preserve native import under CommonJS so ESM agents are supported.
              const load = new Function("url", "return import(url)") as (
                url: string,
              ) => Promise<{ default?: AgentPort; agent?: AgentPort }>;
              const module = await load(
                pathToFileURL(
                  resolve(
                    process.cwd(),
                    process.env.AGENT_MODULE || "../../agent/index.js",
                  ),
                ).href,
              );
              this.adapter = module.default || module.agent;
            } else throw new Error("Unsupported agent mode");
          }
          if (!this.adapter || typeof this.adapter.respond !== "function")
            throw new Error("Agent module must export an AgentPort");
          return this.adapter.respond(req);
        };
        return agentResponseSchema.parse(
          await Promise.race([
            call(),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error("Agent timeout")),
                Number(process.env.AGENT_TIMEOUT_MS || 20000),
              );
            }),
          ]),
        );
      } catch {
        if (attempt === attempts - 1)
          throw new Error(
            "تعذر رد عثمان بعد إعادة المحاولة؛ يلزم متابعة العميل",
          );
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    throw new Error("Agent failed");
  }
}
