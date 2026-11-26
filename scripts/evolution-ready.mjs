// Only the initial read is retried. Never replay instance creation or other mutations.
export async function waitForEvolutionReady(
  request,
  {
    attempts = 60,
    delayMs = 2000,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    report = console.log,
  } = {},
) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await request();
    } catch (error) {
      const transient =
        error instanceof TypeError ||
        ["TimeoutError", "AbortError"].includes(error?.name) ||
        [502, 503, 504].includes(error?.status);
      if (!transient) throw error;
      if (attempt === attempts - 1)
        throw new Error(
          "Evolution did not become ready. Check docker compose -f compose.evolution.yaml ps, then rerun the link command.",
        );
      if (attempt === 0)
        report("Waiting for Evolution to finish starting on port 8080...");
      await sleep(delayMs);
    }
  }
  throw new Error("Evolution readiness attempts must be positive");
}
