/// ─── Alchemy Endpoint Config — Robinhood Chain Testnet ──────────────────
///
/// EquiFlow's AA layer uses `permissionless` + `viem`'s built-in bundler
/// client (wagmi-version-agnostic, unlike @account-kit/react which pins to
/// wagmi 2.x). This file only exposes the URLs and policy IDs — actual
/// client instantiation lives in lib/aa/bundler.ts.
///
/// SETUP:
///   1. Go to dashboard.alchemy.com → "Create New App" → pick "Robinhood Chain Testnet"
///   2. Copy the API key into NEXT_PUBLIC_ALCHEMY_API_KEY
///   3. In the same app: "Gas Manager" → "Create Policy" → "Sponsor all UserOps"
///      → copy policy ID into NEXT_PUBLIC_ALCHEMY_GAS_POLICY_ID
///   4. For Tier 5 (USDG as gas): create a second policy with ERC20 paymaster
///      enabled and USDG in the allowed-token list → set
///      NEXT_PUBLIC_ALCHEMY_GAS_POLICY_ID_USDG.

export const ALCHEMY_API_KEY = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY ?? "";

/// Native-gas sponsorship policy (Tier 2).
export const GAS_POLICY_ID = process.env.NEXT_PUBLIC_ALCHEMY_GAS_POLICY_ID ?? "";

/// ERC20 paymaster policy — lets users pay gas in USDG (Tier 5).
export const GAS_POLICY_ID_USDG =
  process.env.NEXT_PUBLIC_ALCHEMY_GAS_POLICY_ID_USDG ?? "";

/// Until the user provides a real key, AA UserOp submission will surface an
/// inline error pointing at the env setup. UI surfaces still render so the
/// flow is fully visible/demoable.
export const AA_CONFIGURED = ALCHEMY_API_KEY.length > 0;

/// Alchemy bundler RPC for Robinhood Chain Testnet.
///
/// Alchemy's endpoint subdomain (per their dashboard) is `robinhood-testnet`.
/// The same URL handles both `eth_*` reads and ERC-4337 bundler methods
/// (`eth_sendUserOperation`, `eth_estimateUserOperationGas`, etc.).
export function alchemyBundlerUrl(): string {
  const override = process.env.NEXT_PUBLIC_ALCHEMY_BUNDLER_URL;
  if (override) return override;
  if (!ALCHEMY_API_KEY) {
    // Return the public RBN RPC so dev mode doesn't blow up on import.
    // Actual UserOp sends will fail with a clearer "AA_NOT_CONFIGURED" error
    // surfaced in lib/aa/send-userop.ts.
    return "https://rpc.testnet.chain.robinhood.com";
  }
  return `https://robinhood-testnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
}

/// Alchemy's Gas Manager paymaster URL — same domain, paymaster path.
export function alchemyPaymasterUrl(policyId: string = GAS_POLICY_ID): string {
  const override = process.env.NEXT_PUBLIC_ALCHEMY_PAYMASTER_URL;
  if (override) return override;
  if (!ALCHEMY_API_KEY || !policyId) {
    return "";
  }
  return `https://robinhood-testnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
}

/// Standard EntryPoint v0.7 address (canonical, same on every chain).
/// Robinhood Chain Testnet has this deployed via Alchemy's infrastructure.
export const ENTRY_POINT_07 =
  "0x0000000071727De22E5E9d8BAf0edAc6f37da032" as const;

/// Modular Account v2 implementation address on RBN testnet (Alchemy
/// canonical). Smart wallets created via the factory point at this impl.
export const MODULAR_ACCOUNT_V2_IMPL =
  (process.env.NEXT_PUBLIC_MODULAR_ACCOUNT_V2_IMPL ??
    "0x99999999B4ad8aa6d4666f23dab18d3D9C3B3eC7") as `0x${string}`;

/// Modular Account v2 factory — deterministic CREATE2 deploys at this
/// canonical address on every Alchemy-supported chain (incl. RBN testnet).
/// Override via env if Alchemy publishes a different address for RBN.
/// Why: factory.getAddress(owner, salt) returns the counterfactual smart
/// wallet address before any on-chain deploy.
export const MODULAR_ACCOUNT_V2_FACTORY =
  (process.env.NEXT_PUBLIC_MODULAR_ACCOUNT_V2_FACTORY ??
    "0x00000000000017c61b5bEe81050EC8eFc9c6fecd") as `0x${string}`;

/// Salt used for CREATE2 deploys. Keep at 0 unless a user needs multiple
/// smart wallets for one EOA (rare — most flows pick the salt-0 wallet).
export const MODULAR_ACCOUNT_V2_SALT = 0n;
