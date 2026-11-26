import { validateRuntimeConfig } from "./runtime-config";
const env: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  JWT_SECRET: "a".repeat(40),
  WEB_ORIGINS: "https://osman.alothmanlaw.sa",
  COOKIE_DOMAIN: ".alothmanlaw.sa",
  WA_PROVIDER: "evolution",
  EVOLUTION_URL: "connector:8080",
  EVOLUTION_API_KEY: "private",
  EVOLUTION_INSTANCE: "osman",
  EVOLUTION_WEBHOOK_SECRET: "b".repeat(40),
  EVOLUTION_CALLBACK_URL: "https://osman-api.alothmanlaw.sa/webhooks/evolution",
  AGENT_MODE: "inprocess",
  MODEL_PROVIDER: "openrouter",
  OPENROUTER_API_KEY: "private",
  OPENROUTER_MODEL: "model",
};
describe("production runtime configuration", () => {
  it("accepts configured same-site HTTPS services", () =>
    expect(() => validateRuntimeConfig(env)).not.toThrow());
  it.each([
    { WA_PROVIDER: "mock" },
    { WA_PROVIDER: "meta" },
    { AGENT_MODE: "mock" },
    { AGENT_MODE: "http" },
    { OPENROUTER_API_KEY: "" },
    {
      EVOLUTION_CALLBACK_URL:
        "http://host.docker.internal:4000/webhooks/evolution",
    },
    { WEB_ORIGINS: "https://unrelated.example.com" },
  ])("rejects unsafe production defaults %j", (change) =>
    expect(() => validateRuntimeConfig({ ...env, ...change })).toThrow(),
  );
});
