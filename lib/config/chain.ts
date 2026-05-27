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
    defaultPriorityFee: () => 1n,
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
