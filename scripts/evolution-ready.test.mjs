import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForEvolutionReady } from "./evolution-ready.mjs";
test("waits through startup socket closures and returns the initial read", async () => {
  let calls = 0;
  const delays = [];
  const result = await waitForEvolutionReady(
    async () => {
      if (++calls < 3) throw new TypeError("fetch failed");
      return [];
    },
    {
      sleep: async (ms) => {
        delays.push(ms);
      },
      report: () => {},
    },
  );
  assert.deepEqual(result, []);
  assert.deepEqual(delays, [2000, 2000]);
});
test("fails immediately on authentication errors", async () => {
  let calls = 0;
  await assert.rejects(
    waitForEvolutionReady(async () => {
      calls++;
      throw Object.assign(new Error("auth"), { status: 401 });
    }),
    /auth/,
  );
  assert.equal(calls, 1);
});
test("retries startup gateway errors", async () => {
  let calls = 0;
  assert.equal(
    await waitForEvolutionReady(
      async () => {
        if (++calls === 1)
          throw Object.assign(new Error("starting"), { status: 503 });
        return "ready";
      },
      { sleep: async () => {}, report: () => {} },
    ),
    "ready",
  );
});
test("stops after the configured limit with actionable guidance", async () => {
  let calls = 0;
  await assert.rejects(
    waitForEvolutionReady(
      async () => {
        calls++;
        throw new TypeError("socket closed");
      },
      { attempts: 2, sleep: async () => {}, report: () => {} },
    ),
    /did not become ready/,
  );
  assert.equal(calls, 2);
});
