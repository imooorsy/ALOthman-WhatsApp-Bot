import "dotenv/config";
import { defaultSettings, agentResponseSchema } from "@osman/shared";
import { AgentService } from "./agent";
async function main() {
  const agent = new AgentService();
  for (const text of [
    "السلام عليكم",
    "أحتاج موظف",
    "عاجل",
    "خارج النطاق",
    "موعد",
  ]) {
    const response = await agent.respond({
      conversationId: "contract-check",
      clientPhone: "+15555550100",
      history: [],
      newMessages: [text],
      config: { ...defaultSettings, version: 1 },
    });
    agentResponseSchema.parse(response);
  }
  console.log(
    "Agent contract passed for active mode: " +
      (process.env.AGENT_MODE || "mock"),
  );
}
main().catch(() => {
  console.error(
    "Agent contract failed; verify adapter configuration and response shape.",
  );
  process.exitCode = 1;
});
