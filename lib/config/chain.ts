import { defineChain } from "viem";

export const ROBINHOOD_CHAIN_TESTNET_ID = 46630;

export const robinhoodChainTestnet = defineChain({
  id: ROBINHOOD_CHAIN_TESTNET_ID,
  name: "Robinhood Chain Testnet",
  network: "robinhood-chain-testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        process.env.NEXT_PUBLIC_RBN_RPC_URL ??
          "https://rpc.testnet.chain.robinhood.com",
      ],
    },
    public: {
      http: ["https://rpc.testnet.chain.robinhood.com"],
    },
  },
  blockExplorers: {
    default: {
      name: "Robinhood Chain Explorer",
      url: "https://explorer.testnet.chain.robinhood.com",
    },
  },
  fees: {
    // 0.05 gwei floor. RBN testnet historically accepts priority fees as
    // low as 1 wei, but the AA bundler enforces a higher minimum
    // (see lib/aa/send-userop.ts → MIN_PRIORITY_FEE). Keeping EOA priority
    // fees at the same floor avoids stuck-in-mempool surprises when keeper
    // and user txs share the chain. Raise to 0.5 gwei if the chain's
    // congestion ever pushes effective base fees higher.
    defaultPriorityFee: () => 50_000_000n,
  },
  // NOTE: Address 0xa432504b6F04Cafe775b09D8AA92e8dbe41Ec7a8 on RBN testnet
  // implements Multicall v1/v2 (aggregate, tryAggregate) but NOT Multicall3
  // (aggregate3). Registering it as `multicall3` caused viem to call
  // aggregate3 → revert → every useReadContracts batch returned no data,
  // surfacing as "Off-chain · sim" and stuck "loading…" balances in the UI.
  // Without `multicall3` configured, viem falls back to per-call eth_call
  // (slower but reliable). Replace with a real Multicall3 deployment when
  // one ships on RBN testnet.
  testnet: true,
});

export const FAUCET_URL = "https://faucet.testnet.chain.robinhood.com/";
export const DOCS_URL = "https://docs.robinhood.com/chain/";
