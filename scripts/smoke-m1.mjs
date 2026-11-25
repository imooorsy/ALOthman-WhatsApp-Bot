import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
const env = Object.fromEntries(
  readFileSync("apps/api/.env", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => {
      const at = l.indexOf("=");
      return [l.slice(0, at), l.slice(at + 1)];
    }),
);
const base = "http://localhost:4000";
const headers = {
  "Content-Type": "application/json",
  Origin: "http://localhost:3000",
};
async function call(path, method = "GET", body, cookie) {
  return fetch(base + path, {
    method,
    headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
assert.equal((await call("/settings")).status, 401);
const credentials = {
  email: env.SEED_ADMIN_EMAIL,
  password: env.SEED_ADMIN_PASSWORD,
};
assert.equal(
  (
    await fetch(base + "/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://untrusted.invalid",
      },
      body: JSON.stringify(credentials),
    })
  ).status,
  403,
);
const login = await call("/auth/login", "POST", credentials);
assert.equal(login.status, 201);
const cookie = login.headers.get("set-cookie");
assert.match(cookie, /HttpOnly/i);
assert.match(cookie, /SameSite=Lax/i);
const session = cookie.split(";")[0];
const initial = await (await call("/settings", "GET", null, session)).json();
assert.equal(initial.categories.length, 6);
assert.equal(initial.services.length, 4);
const saved = await call("/settings", "PUT", initial, session);
assert.equal(saved.status, 200);
assert.equal((await saved.json()).version, initial.version + 1);
assert.equal((await call("/settings", "PUT", initial, session)).status, 409);
const employee = {
  name: "اختبار الصلاحيات",
  email: `smoke-${Date.now()}@example.invalid`,
  password: randomBytes(18).toString("hex"),
  role: "employee",
};
const created = await call("/staff", "POST", employee, session);
assert.equal(created.status, 201);
const user = await created.json();
try {
  const employeeLogin = await call("/auth/login", "POST", {
    email: employee.email,
    password: employee.password,
  });
  assert.equal(employeeLogin.status, 201);
  const employeeCookie = employeeLogin.headers.get("set-cookie").split(";")[0];
  assert.equal(
    (await call("/settings", "GET", null, employeeCookie)).status,
    200,
  );
  assert.equal(
    (await call("/settings", "PUT", initial, employeeCookie)).status,
    403,
  );
  assert.equal((await call("/staff", "GET", null, employeeCookie)).status, 403);
  assert.equal((await call("/staff", "DELETE", null, session)).status, 404);
} finally {
  assert.equal(
    (await call("/staff/" + user.id, "DELETE", null, session)).status,
    200,
  );
}
console.log(
  "M1 smoke passed: auth, Origin, roles, settings versioning, defaults and staff cleanup.",
);
