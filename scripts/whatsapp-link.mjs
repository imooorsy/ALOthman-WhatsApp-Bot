import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { waitForEvolutionReady } from "./evolution-ready.mjs";
async function main() {
  const require = createRequire(
    new URL("../apps/api/package.json", import.meta.url),
  );
  const { parse } = require("dotenv");
  const env = parse(
    fs.readFileSync(new URL("../apps/api/.env", import.meta.url)),
  );
  if (
    !env.EVOLUTION_URL ||
    !env.EVOLUTION_API_KEY ||
    !env.EVOLUTION_WEBHOOK_SECRET ||
    !env.EVOLUTION_INSTANCE
  )
    throw new Error("Run node scripts/whatsapp-setup.mjs first");
  const base = env.EVOLUTION_URL.replace(/\/$/, "");
  const name = encodeURIComponent(env.EVOLUTION_INSTANCE);
  const request = async (method, route, body) => {
    const response = await fetch(base + route, {
      method,
      redirect: "error",
      headers: {
        apikey: env.EVOLUTION_API_KEY,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15000),
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok)
      throw Object.assign(
        new Error(
          `Evolution request failed (${response.status}); check the service and API configuration`,
        ),
        { status: response.status },
      );
    return response.json();
  };
  const webhook = {
    enabled: true,
    url:
      process.env.EVOLUTION_CALLBACK_URL ||
      "http://host.docker.internal:4000/webhooks/evolution",
    headers: { "x-webhook-secret": env.EVOLUTION_WEBHOOK_SECRET },
    byEvents: false,
    base64: false,
    events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE"],
  };
  // This version returns 404 for a filtered lookup before the instance exists.
  // List first, then select locally so a first-time setup can create its instance.
  const list = await waitForEvolutionReady(() =>
    request("GET", "/instance/fetchInstances"),
  );
  const exists = []
    .concat(list || [])
    .some((x) =>
      [x.name, x.instance?.instanceName, x.instance?.name].includes(
        env.EVOLUTION_INSTANCE,
      ),
    );
  if (!exists)
    await request("POST", "/instance/create", {
      instanceName: env.EVOLUTION_INSTANCE,
      integration: "WHATSAPP-BAILEYS",
      qrcode: false,
      groupsIgnore: true,
      alwaysOnline: false,
      readMessages: false,
      readStatus: false,
      syncFullHistory: false,
      webhook,
    });
  await request("POST", `/webhook/set/${name}`, { webhook });
  const imageFile = new URL("../.local/whatsapp-qr.png", import.meta.url);
  let connected = false;
  console.log(
    "Waiting for a WhatsApp QR code and phone scan (up to 10 minutes)...",
  );
  for (let attempt = 0; attempt < 120; attempt++) {
    const state = await request("GET", `/instance/connectionState/${name}`);
    if ((state.instance?.state || state.state) === "open") {
      connected = true;
      break;
    }
    const qr = await request("GET", `/instance/connect/${name}`);
    if (
      typeof qr.base64 === "string" &&
      /^data:image\/png;base64,/.test(qr.base64)
    ) {
      fs.writeFileSync(
        imageFile,
        Buffer.from(qr.base64.split(",")[1], "base64"),
        { mode: 0o600 },
      );
      console.log(
        `Open ${fileURLToPath(imageFile)} and scan using WhatsApp > Linked devices > Link a device.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  if (connected) {
    fs.rmSync(imageFile, { force: true });
    console.log(
      "WhatsApp connected. Set WA_PROVIDER=evolution in apps/api/.env and restart the API. No messages were sent by this script.",
    );
  } else {
    fs.rmSync(imageFile, { force: true });
    console.log(
      "Not connected yet. Run this command again for a fresh QR code.",
    );
    process.exitCode = 1;
  }
}
main().catch((error) => {
  // Do not dump fetch/socket objects, URLs, headers, credentials or provider bodies.
  if (
    error instanceof TypeError ||
    ["TimeoutError", "AbortError"].includes(error?.name)
  )
    console.error(
      "Evolution connection was interrupted. Check docker compose -f compose.evolution.yaml ps, then rerun node scripts/whatsapp-link.mjs.",
    );
  else if (
    error?.status ||
    error?.message?.startsWith("Evolution did not become ready") ||
    error?.message === "Run node scripts/whatsapp-setup.mjs first"
  )
    console.error(error.message);
  else
    console.error(
      "WhatsApp linking failed. Check the local configuration and Evolution service, then retry.",
    );
  process.exitCode = 1;
});
