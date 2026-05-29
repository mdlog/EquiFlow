import { BaseError, ContractFunctionRevertedError, type PublicClient, type WalletClient, type Account } from "viem";
import { ADAPTER_ABI } from "./abi.ts";
import { toE8, encodePriceFeed, decide, type HermesParsed, type Method } from "./core.ts";
import type { KeeperConfig } from "./config.ts";

// Extract a require-string ("price deviation too large") OR a decoded custom-error
// name ("StalePrice", "PublishTimeTooOld", ...) from a viem revert. Anything else
// returns a short message — the caller logs + skips, never crashes the loop.
export function revertName(err: unknown): string {
  if (err instanceof BaseError) {
    const rev = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (rev instanceof ContractFunctionRevertedError) {
      return rev.data?.errorName ?? rev.reason ?? rev.shortMessage;
    }
    return err.shortMessage;
  }
  return err instanceof Error ? err.message : String(err);
}

export interface RelayDeps {
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: Account;
  params: KeeperConfig;
}

export interface RelayResult {
  pushed: boolean;
  method?: Method;
  reason?: string; // skip reason
  error?: string; // revert name on failure
}

// Decide + push one feed. Pre-computes update-vs-force from deviation, and falls
// back update -> force if updatePrice unexpectedly trips the on-chain cap.
export async function relayFeed(
  feed: { symbol: string; priceId: `0x${string}`; adapter: `0x${string}` },
  parsed: HermesParsed,
  deps: RelayDeps,
  lastPushWallSec: bigint,
  nowSec: bigint,
): Promise<RelayResult> {
  const { publicClient, walletClient, account, params } = deps;

  const [, cachedE8, , updatedAt] = (await publicClient.readContract({
    address: feed.adapter,
    abi: ADAPTER_ABI,
    functionName: "latestRoundData",
  })) as readonly [bigint, bigint, bigint, bigint, bigint];

  const newE8 = toE8(BigInt(parsed.price.price), parsed.price.expo);
  const d = decide({
    hermesPublishTime: BigInt(parsed.price.publish_time),
    cachedUpdatedAt: updatedAt,
    nowSec,
    maxAgeSec: params.maxAgeSec,
    newE8,
    cachedE8,
    deviationCapBps: params.deviationCapBps,
    devTriggerBps: params.devTriggerBps,
    lastPushWallSec,
    heartbeatSec: params.heartbeatSec,
  });
  if (d.action === "skip") return { pushed: false, reason: d.reason };

  const data = encodePriceFeed(parsed);
  // update first (unless deviation already exceeds the cap), then force as fallback.
  const order: Method[] = d.method === "force" ? ["force"] : ["update", "force"];

  for (const method of order) {
    const fn = method === "force" ? "forceUpdatePrice" : "updatePrice";
    try {
      // simulate first so an on-chain revert never costs a failed tx
      await publicClient.simulateContract({
        account,
        address: feed.adapter,
        abi: ADAPTER_ABI,
        functionName: fn,
        args: [[data]],
        value: 0n,
      });
      const hash = await walletClient.writeContract({
        account,
        chain: walletClient.chain,
        address: feed.adapter,
        abi: ADAPTER_ABI,
        functionName: fn,
        args: [[data]],
        value: 0n,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      return { pushed: true, method };
    } catch (e) {
      const name = revertName(e);
      // update tripped the 5% cap -> fall through to force
      if (method === "update" && name === "price deviation too large") continue;
      // force not yet eligible (30-min override delay) -> back off, retry next tick
      if (method === "force" && name === "override too soon") return { pushed: false, error: "override too soon" };
      // StalePrice / PublishTimeTooOld / transient -> log + skip
      return { pushed: false, error: name };
    }
  }
  return { pushed: false, error: "exhausted" };
}
