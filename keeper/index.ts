// EquiFlow keeper: relays real Pyth Hermes prices into the on-chain MockPyth
// (via PythPriceAdapter) on Robinhood Chain testnet.
//
//   npm run keeper            # after `npm install` and filling keeper/.env
//
// See docs/contracts/keeper-relay-spec.md for the full design.

import { createPublicClient, createWalletClient, defineChain, http, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig, FEEDS, type Feed } from "./config.ts";
import { REGISTRY_ABI } from "./abi.ts";
import { fetchHermes } from "./hermes.ts";
import { relayFeed } from "./relay.ts";

const ts = () => new Date().toISOString();
const log = (...a: unknown[]) => console.log(ts(), ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const cfg = loadConfig(process.env);
  const chain = defineChain({
    id: cfg.chainId,
    name: `chain-${cfg.chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
  });
  const account = privateKeyToAccount(cfg.privateKey);
  const publicClient = createPublicClient({ chain, transport: http(cfg.rpcUrl) });
  const walletClient = createWalletClient({ account, chain, transport: http(cfg.rpcUrl) });

  log(`keeper account ${account.address} on chain ${cfg.chainId}`);

  // Resolve adapters: explicit ADAPTER_<SYM> wins, else registry.adapterOf(priceId).
  const feeds: Array<Feed & { adapter: `0x${string}` }> = [];
  for (const f of FEEDS) {
    let adapter = cfg.adapters[f.symbol];
    if (!adapter && cfg.registry) {
      adapter = (await publicClient.readContract({
        address: cfg.registry,
        abi: REGISTRY_ABI,
        functionName: "adapterOf",
        args: [f.priceId],
      })) as `0x${string}`;
    }
    if (!adapter || adapter === zeroAddress) {
      log(`! ${f.symbol}: no adapter resolved — skipping`);
      continue;
    }
    feeds.push({ ...f, adapter });
    log(`  ${f.symbol} -> ${adapter}`);
  }
  if (feeds.length === 0) throw new Error("No feeds resolved; set ADAPTER_<SYM> or ADAPTER_REGISTRY.");

  const lastPush = new Map<string, bigint>(); // symbol -> wall-clock seconds

  // forever loop; every error is contained so the keeper never dies on one bad tick.
  for (;;) {
    try {
      const parsed = await fetchHermes(feeds.map((f) => f.priceId), cfg.hermesUrl);
      const byId = new Map(parsed.map((p) => [(p.id.startsWith("0x") ? p.id : `0x${p.id}`).toLowerCase(), p]));
      const nowSec = BigInt(Math.floor(Date.now() / 1000));

      for (const f of feeds) {
        const pf = byId.get(f.priceId.toLowerCase());
        if (!pf) { log(`${f.symbol}: no Hermes data`); continue; }
        try {
          const r = await relayFeed(f, pf, { publicClient, walletClient, account, params: cfg }, lastPush.get(f.symbol) ?? 0n, nowSec);
          if (r.pushed) {
            lastPush.set(f.symbol, nowSec);
            log(`${f.symbol}: pushed (${r.method})`);
          } else if (r.error) {
            log(`${f.symbol}: not pushed — ${r.error}`);
          } else {
            log(`${f.symbol}: skip (${r.reason})`);
          }
        } catch (e) {
          log(`${f.symbol}: feed error —`, e instanceof Error ? e.message : e);
        }
      }
    } catch (e) {
      log("tick error —", e instanceof Error ? e.message : e);
    }
    await sleep(cfg.tickSec * 1000);
  }
}

main().catch((e) => {
  console.error(ts(), "fatal:", e);
  process.exit(1);
});
