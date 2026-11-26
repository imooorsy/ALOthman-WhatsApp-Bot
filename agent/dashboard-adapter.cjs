"use strict";
// Integration only. The engineer's server, file store and WhatsApp transport are never started.
const { config } = require("./server/config");
const { OpenRouterProvider } = require("./server/openrouter");
const { validate } = require("./server/schema");
const { createState } = require("./ai/src/flow");
const { checkAgentReply, officeData } = require("./ai/src/agent-guard");
const { normalizeText } = require("./ai/src/normalize");
const core = require("./server/agent");

function mapAction(d) {
  if (["decline", "job", "marketing"].includes(d.action)) return "not_suitable";
  if (d.action === "urgent" || d.priority === "عاجل" || d.status === "عاجل")
    return "handoff_urgent";
  if (d.action === "book") return "completed";
  if (["refer", "existing_client", "close", "silent"].includes(d.action))
    return "handoff";
  return "continue";
}

function createAgent({ env = process.env, fetcher = fetch } = {}) {
  return {
    async respond(req) {
      if (req.config.rules.paused) throw new Error("agent_disabled");
      const settings = config(env);
      // The supplied conversation agent is implemented by OpenRouterProvider.converse only.
      if (
        settings.modelProvider !== "openrouter" ||
        !settings.modelKey ||
        !(settings.agentModel || settings.model)
      )
        throw new Error(
          "Configure MODEL_PROVIDER=openrouter, OPENROUTER_API_KEY and OPENROUTER_MODEL",
        );
      const snapshot = req.state?.adapter === "alothman-v1" ? req.state : {};
      const c = {
        state: createState(),
        name: snapshot.name || "",
        agent: snapshot.agent || null,
        agentMemory: snapshot.memory || {},
        agentAsks: snapshot.asks || {},
        messages: req.history.map((m, i) => ({
          ...m,
          id: `history-${i}`,
          at: new Date(m.at).getTime(),
          type: "text",
        })),
      };
      const now = Date.now();
      const batch = req.newMessages.map((text, i) => ({
        id: `new-${i}`,
        role: "client",
        text,
        at: now,
        type: "text",
      }));
      c.messages.push(...batch);
      c.state.sentCount = req.history.filter(
        (m) => m.role === "assistant",
      ).length;
      c.state.everWithStaff = req.history.some((m) => m.role === "staff");
      if (c.state.sentCount >= settings.agentMaxReplies)
        throw new Error("agent_reply_limit");
      const input = core.agentInput(c, {
        newIds: new Set(batch.map((m) => m.id)),
        today: {
          gregorian: new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Riyadh",
          }).format(now),
          weekday: new Intl.DateTimeFormat("ar-SA", {
            timeZone: "Asia/Riyadh",
            weekday: "long",
          }).format(now),
          hijri: new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura", {
            timeZone: "Asia/Riyadh",
          }).format(now),
        },
      });
      const provider = new OpenRouterProvider(settings, fetcher);
      const active = {
        ...req.config,
        services: req.config.services.filter((s) => s.active),
        categories: req.config.categories.filter((c) => c.active),
      };
      // Settings are trusted staff configuration, separate from untrusted client messages.
      // Keep the engineer's legal policy; current dashboard office data overrides static examples.
      const instructions = `${core.agentPrompt}\n\n## إعدادات المكتب الحالية (الإصدار ${req.config.version})\nهذه الإعدادات هي المرجع الحالي للاسم والتعريف والعنوان وأوقات العمل وأرقام التواصل والخدمات والأسعار وتصنيفات القضايا وقواعد القبول. تتقدم على الأمثلة القديمة المتعارضة في الملف. لا تعرض خدمة غير نشطة أو سعرًا غير موجود فيها. لا تخترع ساعات عمل أو بيانات تواصل غير مسجلة.\n${JSON.stringify(active)}`;
      const raw = await provider.ask(
        settings.agentModel || settings.model,
        instructions,
        "agent",
        input,
        settings.agentMaxTokens,
        Math.min(settings.agentTimeout, Number(env.AGENT_TIMEOUT_MS || 20000)),
        { effort: settings.agentReasoning },
      );
      if (validate(raw.object, core.agentSchema).length)
        throw new Error("agent_invalid_schema");
      const merged = core.mergeMemory(c.agentMemory, raw.object.memory);
      const data = officeData(
        `## 4. الأسعار الحالية\n${JSON.stringify(active.services)}\n### 16.1 بيانات المكتب الحالية\n${JSON.stringify({ office: active.office, contacts: active.contacts })}`,
      );
      const check = checkAgentReply(raw.object, {
        said: c.messages.filter((m) => m.role === "client").map((m) => m.text),
        previous: c.messages
          .filter((m) => m.role === "assistant")
          .map((m) => m.text),
        memory: { before: c.agentMemory, after: merged },
        progress: core.progressFor(c),
        data,
      });
      // Reject every guard failure; the dashboard retries and audits a human handoff.
      const plain = normalizeText(check.text).toLowerCase();
      const promise =
        /(?:اضمن|نضمن|مضمون).{0,35}(?:كسب|فوز|ربح|نجاح)|(?:guarantee|guaranteed).{0,35}(?:win|success)/i.test(
          plain,
        );
      if (!check.ok || promise) throw new Error("agent_reply_rejected");
      const decision = core.decisionFrom(raw.object, check.text, c.state);
      core.keepDecision(c, decision, merged);
      const category =
        active.categories.find((cat) => decision.service.includes(cat.name))
          ?.name || null;
      const action = mapAction(decision);
      return {
        reply: decision.reply || null,
        action,
        category,
        clientName: decision.client_name || snapshot.name || null,
        summary: core.renderRecord(c.agent),
        urgentReason:
          action === "handoff_urgent"
            ? decision.internal_summary || "طلب عاجل يحتاج متابعة الفريق"
            : null,
        state: {
          adapter: "alothman-v1",
          memory: c.agentMemory,
          asks: c.agentAsks,
          agent: c.agent,
          name: decision.client_name || snapshot.name || "",
        },
      };
    },
  };
}
module.exports = createAgent();
module.exports.createAgent = createAgent;
module.exports.mapAction = mapAction;
