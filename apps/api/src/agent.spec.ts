import { createServer, Server, RequestListener } from "node:http";
import { AgentService } from "./agent";
describe("agent adapters", () => {
  let server: Server;
  let original: NodeJS.ProcessEnv;
  let calls: number;
  beforeEach(() => {
    original = { ...process.env };
    calls = 0;
    process.env.AGENT_MODE = "http";
    process.env.AGENT_TIMEOUT_MS = "100";
    process.env.AGENT_RETRIES = "1";
  });
  afterEach(async () => {
    process.env = original;
    if (server)
      await new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      });
  });
  const request = {
    conversationId: "test",
    clientPhone: "+15555550100",
    history: [],
    newMessages: ["test"],
    config: {
      version: 1,
      office: { name: "test", intro: "", address: "", workingHours: "" },
      contacts: { office: "", secretary: "", employee: "" },
      services: [],
      categories: [],
      rules: {
        minimumClaim: 80000,
        urgentHandoff: true,
        autoApology: true,
        sendSummary: true,
        paused: false,
      },
    },
  };
  async function serve(handler: RequestListener) {
    server = createServer(handler);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    process.env.AGENT_URL =
      "http://127.0.0.1:" + (server.address() as { port: number }).port;
  }
  it("retries an invalid response and fails closed", async () => {
    await serve((_req, res) => {
      calls++;
      res.end(JSON.stringify({ action: "unknown" }));
    });
    await expect(new AgentService().respond(request)).rejects.toThrow();
    expect(calls).toBe(2);
  });
  it("times out a stalled adapter", async () => {
    process.env.AGENT_TIMEOUT_MS = "30";
    await serve(() => {
      calls++;
    });
    await expect(new AgentService().respond(request)).rejects.toThrow();
    expect(calls).toBeGreaterThan(0);
  });
  it("accepts a valid response from an HTTP agent", async () => {
    await serve((_req, res) =>
      res.end(
        JSON.stringify({
          reply: null,
          action: "handoff",
          category: null,
          clientName: null,
          summary: "ملخص",
          urgentReason: null,
        }),
      ),
    );
    await expect(new AgentService().respond(request)).resolves.toMatchObject({
      action: "handoff",
    });
  });
});
