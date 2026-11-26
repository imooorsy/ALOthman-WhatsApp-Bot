function address(value: string) {
  try {
    return new URL(value);
  } catch {
    throw new Error("Invalid production URL configuration");
  }
}
export function validateRuntimeConfig(env: NodeJS.ProcessEnv) {
  if (env.NODE_ENV !== "production") return;
  if (
    !env.JWT_SECRET ||
    env.JWT_SECRET.length < 32 ||
    /replace-with|local|test-secret/i.test(env.JWT_SECRET)
  )
    throw new Error("Set a production JWT_SECRET");
  const origins = (env.WEB_ORIGINS || "").split(",").filter(Boolean);
  if (!origins.length || !env.COOKIE_DOMAIN)
    throw new Error("Set production WEB_ORIGINS and COOKIE_DOMAIN");
  for (const origin of origins) {
    const url = address(origin);
    const domain = env.COOKIE_DOMAIN.replace(/^\./, "");
    if (
      url.protocol !== "https:" ||
      url.origin !== origin ||
      !(url.hostname === domain || url.hostname.endsWith("." + domain))
    )
      throw new Error(
        "Production origins must use HTTPS and match the cookie domain",
      );
  }
  if (!["evolution", "meta"].includes(env.WA_PROVIDER || ""))
    throw new Error("Select a real production WhatsApp provider");
  if (
    env.AGENT_MODE === "inprocess" &&
    (!env.OPENROUTER_API_KEY ||
      !env.OPENROUTER_MODEL ||
      env.MODEL_PROVIDER !== "openrouter")
  )
    throw new Error("Configure the production model provider, key and model");
  if (env.AGENT_MODE !== "inprocess" && env.AGENT_MODE !== "http")
    throw new Error("Select a real production agent");
  if (
    env.AGENT_MODE === "http" &&
    (!env.AGENT_URL || !env.AGENT_API_KEY || env.AGENT_API_KEY.length < 32)
  )
    throw new Error("Configure the private HTTP agent URL and key");
  if (
    env.WA_PROVIDER === "meta" &&
    (!env.WA_PHONE_NUMBER_ID ||
      !env.WA_ACCESS_TOKEN ||
      !env.WA_VERIFY_TOKEN ||
      !env.WA_APP_SECRET ||
      !env.WA_API_VERSION)
  )
    throw new Error("Complete the production Meta configuration");
  if (env.WA_PROVIDER === "evolution") {
    if (
      !env.EVOLUTION_URL ||
      !env.EVOLUTION_API_KEY ||
      !env.EVOLUTION_INSTANCE ||
      !env.EVOLUTION_WEBHOOK_SECRET ||
      env.EVOLUTION_WEBHOOK_SECRET.length < 32 ||
      !env.EVOLUTION_CALLBACK_URL
    )
      throw new Error("Complete the production Evolution configuration");
    const callback = address(env.EVOLUTION_CALLBACK_URL);
    if (
      callback.protocol !== "https:" ||
      callback.pathname !== "/webhooks/evolution" ||
      callback.username ||
      callback.password ||
      callback.search ||
      callback.hash
    )
      throw new Error("Use the public HTTPS Evolution webhook callback");
  }
}
