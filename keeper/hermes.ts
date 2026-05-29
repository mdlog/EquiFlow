import type { HermesParsed } from "./core.ts";

// Fetch the latest parsed prices for a set of priceIds from Pyth Hermes.
// We consume `parsed` (decoded values for MockPyth); `binary` (the VAA) is only
// used by real Pyth — see docs/contracts/keeper-relay-spec.md §9.
export async function fetchHermes(priceIds: readonly string[], hermesUrl: string): Promise<HermesParsed[]> {
  const url = new URL(`${hermesUrl}/v2/updates/price/latest`);
  for (const id of priceIds) url.searchParams.append("ids[]", id);
  url.searchParams.set("parsed", "true");
  url.searchParams.set("encoding", "hex");

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Hermes ${res.status}: ${await res.text().catch(() => "")}`);
  const body = (await res.json()) as { parsed?: HermesParsed[] };
  if (!body.parsed) throw new Error("Hermes response missing `parsed`");
  return body.parsed;
}
