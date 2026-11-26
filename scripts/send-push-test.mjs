// Run only after the user confirms the dashboard tab is closed.
// Sends five generic notifications to one registered browser of the local admin.
import { readFileSync } from "node:fs";
const env = Object.fromEntries(
  readFileSync("apps/api/.env", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);
if (new URL(env.DATABASE_URL).hostname !== "localhost")
  throw new Error("This helper is for local testing only");
const base = "http://localhost:4000";
const login = await fetch(base + "/auth/login", {
  method: "POST",
  headers: {
    Origin: "http://localhost:3000",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    email: env.SEED_ADMIN_EMAIL,
    password: env.SEED_ADMIN_PASSWORD,
  }),
});
if (!login.ok) throw new Error("Local admin login failed");
const cookie = login.headers.get("set-cookie").split(";")[0];
const status = await (
  await fetch(base + "/push/status", { headers: { Cookie: cookie } })
).json();
if (!status.configured || !status.registrations?.length)
  throw new Error("Enable background notifications in the dashboard first");
const result = await fetch(base + "/push/test", {
  method: "POST",
  headers: {
    Cookie: cookie,
    Origin: "http://localhost:3000",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    registrationId: status.registrations[0].id,
    count: 5,
    intervalSeconds: 2,
    delaySeconds: 0,
  }),
});
if (!result.ok) throw new Error("Could not schedule test notifications");
const batch = await result.json();
console.log(JSON.stringify(batch));
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const rows = await (
    await fetch(base + "/push/test/" + batch.batchId, {
      headers: { Cookie: cookie },
    })
  ).json();
  if (
    rows.length === 5 &&
    rows.every((row) => ["sent", "skipped"].includes(row.state))
  ) {
    console.log(JSON.stringify(rows));
    break;
  }
  if (i === 29) console.log(JSON.stringify(rows));
}
