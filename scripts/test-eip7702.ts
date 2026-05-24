/// ─── EIP-7702 Support Test for Robinhood Chain Testnet ──────────────────
///
/// Run (Node 22+):
///   node --env-file=.env.local --experimental-strip-types scripts/test-eip7702.ts
///
/// Or with tsx (no flags needed):
///   npx tsx --env-file=.env.local scripts/test-eip7702.ts
///
/// What it does:
///   1. Reads KEEPER_PRIVATE_KEY from .env.local (any funded EOA works)
///   2. Signs a 7702 authorization delegating the EOA to MODULAR_ACCOUNT_V2_IMPL
///   3. Sends a self-call (0 wei, 0x data) with authorizationList attached
///   4. Polls eth_getCode at the EOA after the tx mines
///
/// Outcomes:
///   - code == "0x"                → tx never applied delegation (unexpected; check tx receipt)
///   - code == "0xef0100<impl>"    → ✅ RBN supports EIP-7702
///   - submit error "tx type 4"    → ❌ RBN bundler/RPC does NOT support type-4 txs
///   - submit error "EIP-7702 disabled" / "Prague" → ❌ chain not on Pectra hardfork yet
///
/// Safe: tx value = 0, only ~22k gas spent on signature recovery + delegation set.

import {
  createPublicClient,
  createWalletClient,
  http,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { robinhoodChainTestnet } from "../lib/config/chain";
import { MODULAR_ACCOUNT_V2_IMPL } from "../lib/web3/alchemy";

async function main() {
  const pk = process.env.KEEPER_PRIVATE_KEY as Hex | undefined;
  if (!pk) {
    console.error("✗ Missing KEEPER_PRIVATE_KEY in .env.local");
    process.exit(1);
  }

  const account = privateKeyToAccount(pk);
  console.log("Testing 7702 with EOA:", account.address);
  console.log("Delegation target:    ", MODULAR_ACCOUNT_V2_IMPL);

  const publicClient = createPublicClient({
    chain: robinhoodChainTestnet,
    transport: http(),
  });
  const walletClient = createWalletClient({
    account,
    chain: robinhoodChainTestnet,
    transport: http(),
  });

  // Pre-state — is the EOA already delegated?
  const codeBefore = await publicClient.getCode({ address: account.address });
  console.log("Code at EOA before:   ", codeBefore || "0x");

  const balance = await publicClient.getBalance({ address: account.address });
  console.log("Balance:              ", balance, "wei");
  if (balance === 0n) {
    console.error("✗ EOA has 0 ETH — fund it first");
    process.exit(1);
  }

  // Sign the authorization tuple. viem will use the local PrivateKeyAccount
  // sign method to produce a valid SignedAuthorization.
  const nonce = await publicClient.getTransactionCount({
    address: account.address,
  });

  let auth;
  try {
    auth = await walletClient.signAuthorization({
      account,
      contractAddress: MODULAR_ACCOUNT_V2_IMPL,
      chainId: robinhoodChainTestnet.id,
      nonce,
    });
    console.log("✓ Signed authorization:", JSON.stringify(auth, (_, v) => typeof v === "bigint" ? v.toString() : v));
  } catch (err) {
    console.error("✗ Could not sign authorization (viem version issue?):", err);
    process.exit(1);
  }

  // Direct probe: ask the RPC to estimate gas for a type-4 call. This
  // bypasses the balance check entirely — if the chain doesn't know about
  // the EIP-7702 transaction format, estimateGas returns
  // "transaction type not supported" / "invalid type" immediately. If it
  // returns a number, the chain understands the type.
  try {
    const gas = await publicClient.estimateGas({
      account: account.address,
      to: account.address,
      value: 0n,
      data: "0x",
      authorizationList: [auth],
    });
    console.log("✓ eth_estimateGas with authorizationList:", gas, "gas");
    console.log("  → RBN testnet UNDERSTANDS the EIP-7702 type-4 format.");
  } catch (err) {
    const msg = (err as Error).message || "";
    const formatRejected =
      /unsupported transaction type|invalid transaction type|type ?4|prague|7702 disabled|not supported/i.test(
        msg,
      );
    if (formatRejected) {
      console.error("✗ eth_estimateGas rejected the type-4 format:");
      console.error("  ", msg);
      console.error("\n❌ RBN testnet does NOT support EIP-7702 yet.");
      process.exit(2);
    }
    // Other errors (e.g. simulation revert) still mean format is supported.
    console.log("⚠ estimateGas threw, but not due to format. Continuing:");
    console.log("  ", msg.split("\n")[0]);
  }

  // Send a Type-4 self-tx with the auth attached.
  let txHash: Hex;
  try {
    txHash = await walletClient.sendTransaction({
      to: account.address,
      value: 0n,
      data: "0x",
      authorizationList: [auth],
      // Force a low max-fee so a small balance can still cover gas.
      maxFeePerGas: 100_000_000n, // 0.1 gwei
      maxPriorityFeePerGas: 0n,
    });
    console.log("✓ Tx submitted:        ", txHash);
  } catch (err) {
    const msg = (err as Error).message || "";
    const formatRejected =
      /unsupported transaction type|invalid transaction type|type ?4|prague|7702 disabled/i.test(
        msg,
      );

    if (formatRejected) {
      console.error("✗ sendTransaction REJECTED — RBN does NOT support EIP-7702:");
      console.error("  ", msg);
      process.exit(2);
    }

    console.error("⚠ Tx not submitted, but the chain accepted the type-4 format.");
    console.error("  Failure reason (NOT a 7702 support issue):");
    console.error("  ", msg);
    console.error(
      "\nLikely fix: fund EOA with more native ETH (current balance: " +
        balance.toString() +
        " wei) or rerun with a wallet that has at least 0.001 ETH.",
    );
    console.error(
      "\nPreliminary verdict: RBN testnet APPEARS TO SUPPORT EIP-7702 " +
        "(signAuthorization succeeded + RPC accepted type-4 envelope).",
    );
    process.exit(3);
  }

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    timeout: 60_000,
  });
  console.log("Tx status:            ", receipt.status);

  const codeAfter = await publicClient.getCode({ address: account.address });
  console.log("Code at EOA after:    ", codeAfter || "0x");

  if (codeAfter && codeAfter.startsWith("0xef0100")) {
    const delegate = "0x" + codeAfter.slice(8);
    console.log("\n✅ EIP-7702 SUPPORTED on RBN testnet");
    console.log("   EOA now delegated to:", delegate);
  } else {
    console.log("\n⚠️ Tx mined but EOA code did NOT become 0xef0100...");
    console.log("   Either delegation was not applied or RBN handles 7702 differently.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
