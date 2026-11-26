export function evolutionUrl() {
  const raw = process.env.EVOLUTION_URL || "";
  const url = new URL(raw.includes("://") ? raw : "http://" + raw);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid Evolution configuration");
  return url.href.replace(/\/$/, "");
}
export class EvolutionApiError extends Error {
  constructor(readonly status: number) {
    super("WhatsApp connector request failed");
  }
}
export async function evolutionRequest(
  route: string,
  method = "GET",
  body?: unknown,
): Promise<unknown> {
  if (!process.env.EVOLUTION_API_KEY)
    throw new Error("Evolution is not configured");
  const response = await fetch(evolutionUrl() + route, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(10000),
    headers: {
      apikey: process.env.EVOLUTION_API_KEY,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new EvolutionApiError(response.status);
  return response.json();
}
