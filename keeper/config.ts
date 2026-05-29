// Feed list + env-driven keeper config. priceIds are the ones listed by
// script/Deploy.s.sol (US-equity, regular hours).

export interface Feed {
  symbol: string;
  priceId: `0x${string}`;
}

export const FEEDS: readonly Feed[] = [
  { symbol: "TSLA", priceId: "0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1" },
  { symbol: "AMZN", priceId: "0xb5d0e0fa58a1f8b81498ae670ce93c872d14434b72c364885d4fa1b257cbb07a" },
  { symbol: "PLTR", priceId: "0x11a70634863ddffb71f2b11f2cff29f73f3db8f6d0b78c49f2b5f4ad36e885f0" },
  { symbol: "NFLX", priceId: "0x8376cfd7ca8bcdf372ced05307b24dced1f15b1afafdeff715664598f15a3dd2" },
  { symbol: "AMD", priceId: "0x3622e381dbca2efd1859253763b1adc63f7f9abb8e76da1aa8e638a57ccde93e" },
] as const;

export interface KeeperConfig {
  rpcUrl: string;
  chainId: number;
  privateKey: `0x${string}`;
  registry?: `0x${string}`;
  adapters: Record<string, `0x${string}`>; // symbol -> adapter (overrides registry)
  hermesUrl: string;
  tickSec: number;
  heartbeatSec: bigint;
  devTriggerBps: bigint;
  deviationCapBps: bigint;
  maxAgeSec: bigint;
}

function req(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`Missing required env: ${key}`);
  return v;
}

function num(env: NodeJS.ProcessEnv, key: string, dflt: number): number {
  const v = env[key];
  return v === undefined || v === "" ? dflt : Number(v);
}

export function loadConfig(env: NodeJS.ProcessEnv): KeeperConfig {
  let pk = req(env, "KEEPER_PK");
  if (!pk.startsWith("0x")) pk = `0x${pk}`;

  const adapters: Record<string, `0x${string}`> = {};
  for (const f of FEEDS) {
    const a = env[`ADAPTER_${f.symbol}`];
    if (a) adapters[f.symbol] = a as `0x${string}`;
  }

  const registry = env.ADAPTER_REGISTRY as `0x${string}` | undefined;
  if (Object.keys(adapters).length === 0 && !registry) {
    throw new Error("Provide ADAPTER_<SYM> for each feed, or ADAPTER_REGISTRY to resolve them.");
  }

  return {
    rpcUrl: req(env, "RBN_RPC_URL"),
    chainId: num(env, "CHAIN_ID", 46630),
    privateKey: pk as `0x${string}`,
    registry,
    adapters,
    hermesUrl: env.HERMES_URL?.replace(/\/$/, "") || "https://hermes.pyth.network",
    tickSec: num(env, "TICK_SEC", 60),
    heartbeatSec: BigInt(num(env, "HEARTBEAT_SEC", 300)),
    devTriggerBps: BigInt(num(env, "DEV_TRIGGER_BPS", 50)), // 0.5%
    deviationCapBps: BigInt(num(env, "DEVIATION_CAP_BPS", 500)), // matches adapter maxDeviationBps
    maxAgeSec: BigInt(num(env, "MAX_AGE_SEC", 3600)), // matches adapter maxAge / vault staleAfter
  };
}
