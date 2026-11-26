import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(
  new URL("../apps/api/package.json", import.meta.url),
);
const { parse } = require("dotenv");
const apiFile = path.join(root, "apps/api/.env");
if (!fs.existsSync(apiFile)) throw new Error("Create apps/api/.env first");
let text = fs.readFileSync(apiFile, "utf8");
const env = parse(text);
const secret = () => randomBytes(32).toString("hex");
const key = env.EVOLUTION_API_KEY || secret();
const hook = env.EVOLUTION_WEBHOOK_SECRET || secret();
const localFile = path.join(root, ".local/evolution.env");
const certDir = path.join(root, ".local/certs");
fs.mkdirSync(certDir, { recursive: true });
const old = fs.existsSync(localFile) ? parse(fs.readFileSync(localFile)) : {};
const password = old.POSTGRES_PASSWORD || secret();
const settings = {
  EVOLUTION_URL: env.EVOLUTION_URL || "http://localhost:8080",
  EVOLUTION_INSTANCE: env.EVOLUTION_INSTANCE || "osman",
  EVOLUTION_API_KEY: key,
  EVOLUTION_WEBHOOK_SECRET: hook,
  MODEL_PROVIDER: env.MODEL_PROVIDER || "openrouter",
  OPENROUTER_API_KEY: env.OPENROUTER_API_KEY || "",
  OPENROUTER_MODEL: env.OPENROUTER_MODEL || "openai/gpt-6-luna",
  AGENT_MODULE: "../../agent/dashboard-adapter.cjs",
};
for (const [name, value] of Object.entries(settings)) {
  const pattern = new RegExp(`^${name}=.*$`, "m");
  text = pattern.test(text)
    ? text.replace(pattern, () => `${name}=${value}`)
    : text.trimEnd() + `\n${name}=${value}\n`;
}
fs.writeFileSync(apiFile, text, { mode: 0o600 });
fs.mkdirSync(path.dirname(localFile), { recursive: true });
const docker = {
  ...(fs.existsSync(path.join(certDir, "extra-ca.pem"))
    ? { NODE_EXTRA_CA_CERTS: "/evolution/local-certs/extra-ca.pem" }
    : {}),
  SERVER_TYPE: "http",
  SERVER_PORT: 8080,
  SERVER_URL: "http://localhost:8080",
  AUTHENTICATION_API_KEY: key,
  POSTGRES_USER: "evolution",
  POSTGRES_PASSWORD: password,
  POSTGRES_DB: "evolution",
  DATABASE_ENABLED: "true",
  DATABASE_PROVIDER: "postgresql",
  DATABASE_CONNECTION_URI: `postgresql://evolution:${password}@postgres:5432/evolution`,
  DATABASE_CONNECTION_CLIENT_NAME: "osman",
  CACHE_REDIS_ENABLED: "false",
  CACHE_LOCAL_ENABLED: "true",
  TELEMETRY_ENABLED: "false",
  LOG_LEVEL: "ERROR,WARN",
  LOG_BAILEYS: "error",
  LOG_COLOR: "false",
  DATABASE_SAVE_DATA_INSTANCE: "true",
  DATABASE_SAVE_DATA_NEW_MESSAGE: "true",
  DATABASE_SAVE_MESSAGE_UPDATE: "true",
  DATABASE_SAVE_DATA_CONTACTS: "false",
  DATABASE_SAVE_DATA_CHATS: "false",
  DATABASE_SAVE_DATA_LABELS: "false",
  DATABASE_SAVE_DATA_HISTORIC: "false",
  WEBHOOK_GLOBAL_ENABLED: "false",
  AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES: "false",
  CORS_ORIGIN: "*",
  CONFIG_SESSION_PHONE_CLIENT: "Osman",
  CONFIG_SESSION_PHONE_NAME: "Chrome",
};
fs.writeFileSync(
  localFile,
  Object.entries(docker)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n") + "\n",
  { mode: 0o600 },
);
console.log(
  "Local Evolution secrets prepared. Existing agent and WhatsApp modes were preserved.",
);
console.log("Next: docker compose -f compose.evolution.yaml up -d");
