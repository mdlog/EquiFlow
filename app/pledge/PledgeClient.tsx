"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { encodeFunctionData, parseUnits, maxUint256, type Address, type Hex } from "viem";
import {
  useAccount,
  useChainId,
  useConnect,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { PageNav } from "@/components/PageNav";
import { SiteFooter } from "@/components/SiteFooter";
import { STOCKS, findStock, stockAddress, isLive } from "@/lib/config/stocks";
import { useStockPrice, useAdapterPrice } from "@/lib/hooks/use-adapter-price";
import { useMarketsSparkline } from "@/lib/hooks/use-market-history";
import { useProtocolStats, useListedAssets } from "@/lib/hooks/use-protocol-stats";
import { useRecentVaultEvents } from "@/lib/hooks/use-recent-vault-events";
import { fmt } from "@/lib/format";
import {
  ERC20_ABI,
  EQUIFLOW_VAULT_ABI,
  EQUIFLOW_VAULT_ADDRESS,
  STOCK_TOKEN_ADDRESSES,
  explorerAddr,
  explorerTx,
  shortAddr,
} from "@/lib/contracts";
import { VaultSelector } from "@/components/VaultSelector";
import { useVaultContext } from "@/lib/hooks/use-vault-context";
import { ROBINHOOD_CHAIN_TESTNET_ID, FAUCET_URL } from "@/lib/config/chain";
import { AssetLogo } from "@/components/AssetLogo";
import { useSmartWallet } from "@/lib/aa/use-smart-wallet";
import { sendUserOp, type GasMode } from "@/lib/aa/send-userop";
import { AA_CONFIGURED, GAS_POLICY_ID_USDG } from "@/lib/web3/alchemy";
import { useEthPrice } from "@/lib/hooks/use-eth-price";

/// Stage values:
///   idle → user composing
///   approving/locking → legacy EOA two-step (approve then lock)
///   bundling → smart-wallet single UserOp (approve + pledgeAndBorrow batched)
///   sealed → done
type Stage = "idle" | "approve" | "approving" | "lock" | "locking" | "bundling" | "sealed";

type Operation = {
  id: number;
  op: string;
  contract: string;
  fn: string;
  gas: number;
  skipped?: boolean;
};

export function PledgeClient() {
  const search = useSearchParams();
  const initSym = search.get("sym");
  const { vault } = useVaultContext();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connectors, connect } = useConnect();
  const { switchChain } = useSwitchChain();

  const [stock, setStock] = useState(() => {
    const fromUrl = initSym && STOCKS.find((s) => s.sym === initSym)?.sym;
    // prefer live symbol when no URL hint
    const firstLive = STOCKS.find((s) => isLive(s.sym))?.sym;
    return fromUrl ?? firstLive ?? "TSLA";
  });
  const [shares, setShares] = useState(0);
  const [borrowPct, setBorrowPct] = useState(60);
  /// Aave V3 auto-routing not yet wired on-chain — keep the toggle off so
  /// the displayed numbers and bundle ops match what actually executes.
  const [autoVault, setAutoVault] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");

  const s = findStock(stock);
  const tokenAddr = stockAddress(stock);
  const live = isLive(stock);
  const onCorrectChain = chainId === ROBINHOOD_CHAIN_TESTNET_ID;

  // Live price from PythPriceAdapter (same source as /markets). Falls back to
  // the static STOCKS.price baseline when the adapter isn't wired.
  const { price: livePrice, isLive: priceIsLive, liqThreshold } = useStockPrice(stock);

  const spender =
    vault.address ?? EQUIFLOW_VAULT_ADDRESS ??
    ("0x000000000000000000000000000000000000dEaD" as Address);

  // ── on-chain reads ────────────────────────────────────────────────
  const { data: decimals } = useReadContract({
    abi: ERC20_ABI,
    address: tokenAddr,
    functionName: "decimals",
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { enabled: !!tokenAddr },
  });
  const dec = (decimals as number | undefined) ?? 18;

  // ── smart wallet (Account Abstraction) ──────────────────────────────
  const {
    mode: aaMode,
    smartAccount,
    smartAddress,
    prepareForSubmit,
  } = useSmartWallet();
  const aaActive = aaMode !== "off" && smartAccount != null;
  /// Address whose allowance/balance we should read. When AA mode is on, the
  /// smart wallet is the one calling the vault — so we check ITS allowance,
  /// not the underlying EOA's.
  const callerAddress = (aaActive && smartAddress ? smartAddress : address) as
    | Address
    | undefined;

  // ── on-chain reads (caller-aware) ───────────────────────────────────
  // Balance/allowance are read for the *active* caller (EOA or smart wallet).
  // For EIP-7702 these collapse to the same address as the EOA.

  const { data: balance, refetch: refetchBalance } = useReadContract({
    abi: ERC20_ABI,
    address: tokenAddr,
    functionName: "balanceOf",
    args: callerAddress ? [callerAddress] : undefined,
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { enabled: !!tokenAddr && !!callerAddress, refetchInterval: 12_000 },
  });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    abi: ERC20_ABI,
    address: tokenAddr,
    functionName: "allowance",
    args: callerAddress ? [callerAddress, spender] : undefined,
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { enabled: !!tokenAddr && !!callerAddress, refetchInterval: 12_000 },
  });

  // ── derived display ─────────────────────────────────────────────────
  const collateralUsd = livePrice * shares;
  const maxBorrow = collateralUsd * s.ltv;
  const borrowUsd = maxBorrow * (borrowPct / 100);
  const ltvActual = collateralUsd > 0 ? (borrowUsd / collateralUsd) * 100 : 0;
  const ltvCap = s.ltv * 100;
  const listedAddrs = useListedAssets(vault.address);
  const pledgeStats = useProtocolStats(listedAddrs, vault.address, vault.tokenAddress);
  const pledgeBorrowApr = pledgeStats.derived ? pledgeStats.derived.borrowAprBps / 100 : 0;
  const pledgeVaultApr = pledgeStats.derived ? pledgeStats.derived.supplyAprBps / 100 : 0;
  const liqAt = liqThreshold * 100;
  const healthFactor = ltvActual > 0 ? liqAt / ltvActual : 99;
  const liqPrice = ltvActual > 0 ? livePrice * (ltvActual / liqAt) : 0;
  const netApy = autoVault ? pledgeVaultApr - pledgeBorrowApr : -pledgeBorrowApr;
  const yearlyNet = borrowUsd * (netApy / 100);

  const { price: ethPrice } = useEthPrice();
  const isWethVault = vault.id === "weth";
  const borrowTokenAmount =
    isWethVault && ethPrice && ethPrice > 0 ? borrowUsd / ethPrice : null;

  const shareAmountRaw = useMemo(() => {
    try {
      return parseUnits(shares.toString(), dec);
    } catch {
      return 0n;
    }
  }, [shares, dec]);

  const needsApproval =
    live && allowance !== undefined && shareAmountRaw > (allowance as bigint);

  const insufficient =
    live && balance !== undefined && shareAmountRaw > (balance as bigint);

  const MIN_BORROW_USD = 10;
  const borrowBelowMinimum = borrowUsd > 0 && borrowUsd < MIN_BORROW_USD;

  const vaultLiquidityUsd =
    pledgeStats.liquidityUsd != null
      ? Number(pledgeStats.liquidityUsd) / 1e18
      : null;
  const borrowExceedsLiquidity =
    borrowUsd > 0 &&
    vaultLiquidityUsd != null &&
    borrowUsd > vaultLiquidityUsd;

  // ── tx flow ────────────────────────────────────────────────────────
  const {
    writeContract,
    data: txHash,
    isPending: writePending,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  const { isLoading: receiptPending, isSuccess: receiptSuccess } =
    useWaitForTransactionReceipt({
      hash: txHash,
      chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    });

  // advance stage on receipt success
  useEffect(() => {
    if (!receiptSuccess) return;
    if (stage === "approving") {
      resetWrite();
      refetchAllowance().then(() => setStage("lock"));
    } else if (stage === "locking") {
      setStage("sealed");
      refetchBalance();
    }
  }, [receiptSuccess, stage, resetWrite, refetchAllowance, refetchBalance]);

  const operations: Operation[] = useMemo(
    () => [
      {
        id: 1,
        op: "approve",
        contract: `${s.sym}.tokenized`,
        fn: `approve(EquiFlowVault, ${shares})`,
        gas: 0.00042,
      },
      {
        id: 2,
        op: "lock",
        contract: "EquiFlowVault",
        fn: `lock(${s.sym}, ${shares} shares)`,
        gas: 0.00091,
      },
      {
        id: 3,
        op: "borrow",
        contract: "EquiFlowVault",
        fn: `borrow(${vault.borrowSymbol}, ${fmt.abbr(borrowUsd)})`,
        gas: 0.00105,
      },
      /// Aave V3 routing op intentionally omitted — the contract integration is
      /// not yet live, so it would never appear in the actual bundle.
    ],
    [s.sym, shares, borrowUsd],
  );
  const activeOps = operations.filter((o) => !o.skipped);
  const totalGas = activeOps.reduce((a, o) => a + o.gas, 0);

  // ── action handlers ─────────────────────────────────────────────────
  const handleConnect = () => {
    const c = connectors[0];
    if (c) connect({ connector: c, chainId: ROBINHOOD_CHAIN_TESTNET_ID });
  };

  const handleApprove = () => {
    if (!tokenAddr) return;
    setStage("approving");
    writeContract({
      abi: ERC20_ABI,
      address: tokenAddr,
      functionName: "approve",
      args: [spender, maxUint256],
      chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    });
  };

  const handleLock = () => {
    if (!tokenAddr || !spender) return;
    resetWrite();
    setStage("locking");
    const borrowUsdScaled =
      borrowUsd > 0 ? parseUnits(borrowUsd.toFixed(18), 18) : 0n;
    writeContract({
      abi: EQUIFLOW_VAULT_ABI,
      address: spender,
      functionName: "pledgeAndBorrow",
      args: [tokenAddr, shareAmountRaw, borrowUsdScaled],
      chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    });
  };

  // ── AA bundled flow: approve + pledgeAndBorrow in ONE UserOperation ─
  const [aaTxHash, setAaTxHash] = useState<Hex | null>(null);
  const [aaError, setAaError] = useState<string | null>(null);
  /// Gas-payment mode for the bundled UserOp:
  ///   - "sponsored" : Alchemy paymaster pays in native (default)
  ///   - "usdg"      : ERC20 paymaster, user pays in USDG (Tier 5)
  ///   - "self"      : user pays in native ETH
  const [gasMode, setGasMode] = useState<GasMode>("sponsored");
  const usdgGasAvailable = GAS_POLICY_ID_USDG.length > 0;

  const handleBundle = async () => {
    if (!tokenAddr || !spender || !smartAccount) return;
    setAaError(null);
    setStage("bundling");
    try {
      // For 7702 mode: prompt the user to sign the authorization tuple if
      // their EOA isn't delegated yet. No-op once delegated.
      await prepareForSubmit();
      const borrowUsdScaled =
        borrowUsd > 0 ? parseUnits(borrowUsd.toFixed(18), 18) : 0n;

      const calls = [];
      // Only include approve when allowance is insufficient — saves gas on
      // repeat pledges of the same asset.
      if (
        allowance === undefined ||
        shareAmountRaw > (allowance as bigint)
      ) {
        calls.push({
          to: tokenAddr,
          data: encodeFunctionData({
            abi: ERC20_ABI,
            functionName: "approve",
            args: [spender, maxUint256],
          }),
        });
      }
      calls.push({
        to: spender as Address,
        data: encodeFunctionData({
          abi: EQUIFLOW_VAULT_ABI,
          functionName: "pledgeAndBorrow",
          args: [tokenAddr, shareAmountRaw, borrowUsdScaled],
        }),
      });

      const { txHash } = await sendUserOp({
        smartAccount,
        calls,
        gasMode,
      });
      setAaTxHash(txHash);
      setStage("sealed");
      refetchAllowance();
      refetchBalance();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[PledgeClient] UserOp failed:", err);
      setAaError(msg);
      setStage("idle");
    }
  };

  const handleReset = () => {
    setStage("idle");
    resetWrite();
  };

  // submit button label + handler
  const composing = stage === "idle";
  const busy =
    stage === "approving" ||
    stage === "locking" ||
    stage === "bundling" ||
    writePending ||
    receiptPending;

  // For non-live (mock) tokens, keep legacy animation: signing → bundling → sealed
  useEffect(() => {
    if (live) return;
    if (stage === "approving") {
      const t = setTimeout(() => setStage("locking"), 900);
      return () => clearTimeout(t);
    }
    if (stage === "locking") {
      const t = setTimeout(() => setStage("sealed"), 1500);
      return () => clearTimeout(t);
    }
  }, [stage, live]);

  let ctaLabel: string;
  let ctaAction: (() => void) | null;
  let ctaDisabled = false;

  if (!isConnected) {
    ctaLabel = "Connect wallet to pledge";
    ctaAction = handleConnect;
  } else if (!onCorrectChain) {
    ctaLabel = "Switch to Robinhood Chain";
    ctaAction = () => switchChain({ chainId: ROBINHOOD_CHAIN_TESTNET_ID });
  } else if (!live) {
    if (stage === "sealed") {
      ctaLabel = "Bundle sealed — pledge another";
      ctaAction = handleReset;
    } else if (busy) {
      ctaLabel =
        stage === "approving" ? "Awaiting signature…" : "Bundling…";
      ctaAction = null;
      ctaDisabled = true;
    } else {
      ctaLabel = "Sign once · execute bundle (demo)";
      ctaAction = () => setStage("approving");
    }
  } else if (borrowBelowMinimum) {
    ctaLabel = `Minimum borrow is $${MIN_BORROW_USD} — increase collateral or set borrow to 0`;
    ctaAction = null;
    ctaDisabled = true;
  } else if (borrowExceedsLiquidity) {
    ctaLabel = `Insufficient vault liquidity — only ${fmt.usd(vaultLiquidityUsd ?? 0, 0)} ${vault.borrowSymbol} available`;
    ctaAction = null;
    ctaDisabled = true;
  } else if (insufficient) {
    ctaLabel =
      aaActive && aaMode === "factory"
        ? `Smart wallet has 0 ${s.sym} — transfer in or switch to 7702`
        : "Insufficient balance — get tokens from faucet";
    ctaAction = () =>
      aaActive && aaMode === "factory"
        ? null
        : window.open(FAUCET_URL, "_blank");
  } else if (busy) {
    if (stage === "bundling") {
      ctaLabel = "Bundling UserOperation…";
    } else {
      ctaLabel =
        stage === "approving"
          ? writePending
            ? "Sign approval in wallet…"
            : "Mining approval…"
          : writePending
            ? "Sign lock in wallet…"
            : "Mining lock…";
    }
    ctaAction = null;
    ctaDisabled = true;
  } else if (stage === "sealed") {
    ctaLabel = "Pledge sealed · open another";
    ctaAction = handleReset;
  } else if (aaActive) {
    // ── AA mode: SINGLE CTA, single signature, batched UserOp ─────────
    if (!AA_CONFIGURED) {
      ctaLabel = "Add Alchemy API key to enable AA flow";
      ctaDisabled = true;
      ctaAction = null;
    } else {
      ctaLabel = "Sign once · bundle approve + pledge";
      ctaAction = handleBundle;
    }
  } else if (stage === "lock") {
    ctaLabel = "Lock collateral · sign in wallet";
    ctaAction = handleLock;
  } else if (needsApproval || stage === "approve") {
    ctaLabel = "Approve & lock · sign in wallet";
    ctaAction = handleApprove;
  } else {
    ctaLabel = "Lock collateral · sign in wallet";
    ctaAction = handleLock;
  }

  if (shares <= 0) ctaDisabled = true;

  const balanceDisplay =
    balance !== undefined && dec
      ? Number(balance as bigint) / 10 ** dec
      : null;

  return (
    <div className="flex flex-col min-h-screen">
      <PageNav
        current="pledge"
        rightExtras={
          <div className="flex items-center gap-2 px-2.5 py-[5px] border border-amber bg-amber-soft rounded-[2px]">
            <span className="w-1.5 h-1.5 rounded-full bg-amber" />
            <span className="font-mono" style={{ fontSize: 11 }}>
              {live ? "Live · RBN Testnet" : "Demo mode"}
            </span>
          </div>
        }
      />

      <div
        className="max-w-[1320px] w-full mx-auto grid grid-cols-1 lg:[grid-template-columns:1fr_420px]"
      >
        {/* LEFT: tx summary + bundle stage + detail panels */}
        <div
          className="overflow-auto flex flex-col bg-paper"
        >
          <TxSummary
            stock={s}
            livePrice={livePrice}
            shares={shares}
            collateralUsd={collateralUsd}
            borrowUsd={borrowUsd}
            ltvActual={ltvActual}
            netApy={netApy}
            yearlyNet={yearlyNet}
            healthFactor={healthFactor}
            autoVault={autoVault}
            stage={stage}
          />
          <BundleStage
            operations={activeOps}
            stage={stage}
            totalGas={totalGas}
            stockSym={s.sym}
            borrowUsd={borrowUsd}
            txHash={txHash}
            live={live}
          />
          <div
            className="grid grid-cols-1 sm:grid-cols-2"
            style={{
              borderTop: "1px solid var(--hairline)",
            }}
          >
            <LiqRiskPanel
              stock={s}
              livePrice={livePrice}
              liqPrice={liqPrice}
              liqAt={liqAt}
              ltvActual={ltvActual}
              ltvCap={ltvCap}
            />
            <OracleAttestationsPanel
              stock={s}
              livePrice={livePrice}
              priceIsLive={priceIsLive}
            />
            <FeeBreakdownPanel
              stock={s}
              borrowUsd={borrowUsd}
              autoVault={autoVault}
              netApy={netApy}
              yearlyNet={yearlyNet}
              totalGas={totalGas}
            />
            <RecentActivityPanel
              stage={stage}
              stock={s}
              borrowUsd={borrowUsd}
            />
          </div>
        </div>

        {/* RIGHT: composer (shows first on mobile via order) */}
        <div
          className="px-4 sm:px-8 py-7 lg:border-l border-hairline overflow-auto bg-paper order-first lg:order-none"
        >
          <div className="eyebrow mb-2 flex items-center gap-3">
            <span>Compose a pledge</span>
            <VaultSelector compact />
          </div>
          <h1
            className="font-serif font-medium m-0"
            style={{
              fontSize: 28,
              letterSpacing: "-0.025em",
              lineHeight: 1.1,
            }}
          >
            {live ? (
              <>
                Pledge real <em>{s.sym}</em> tokens.
              </>
            ) : (
              <>
                Four steps. <em>One signature.</em>
              </>
            )}
          </h1>

          {/* Asset chooser */}
          <div className="mt-6">
            <div className="flex justify-between items-baseline mb-2">
              <span className="eyebrow">Asset</span>
              <span
                className="font-mono text-ink-mute"
                style={{ fontSize: 10 }}
              >
                ◆ live on Robinhood Chain
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {STOCKS.map((x) => {
                const xLive = isLive(x.sym);
                const selected = x.sym === stock;
                return (
                  <button
                    key={x.sym}
                    onClick={() => composing && setStock(x.sym)}
                    disabled={!composing}
                    className="px-1.5 py-2 font-mono font-medium border rounded-[2px] relative flex flex-col items-center gap-1"
                    style={{
                      fontSize: 11,
                      background: selected ? "var(--ink)" : "transparent",
                      color: selected ? "var(--paper)" : "var(--ink-soft)",
                      borderColor: selected ? "var(--ink)" : "var(--hairline)",
                      opacity: !composing ? 0.5 : 1,
                    }}
                  >
                    <span
                      className="inline-flex items-center justify-center"
                      style={{
                        width: 18,
                        height: 18,
                        background: selected ? "var(--paper)" : "transparent",
                        borderRadius: 2,
                      }}
                    >
                      <AssetLogo sym={x.sym} size={16} />
                    </span>
                    {x.sym}
                    {xLive && (
                      <span
                        className="absolute top-1 right-1"
                        style={{
                          color: selected ? "var(--paper)" : "var(--up)",
                          fontSize: 8,
                        }}
                      >
                        ◆
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {tokenAddr && (
              <div
                className="font-mono text-ink-mute mt-2"
                style={{ fontSize: 10 }}
              >
                token · {shortAddr(tokenAddr)}
              </div>
            )}
            {live && balanceDisplay !== null && (
              <div
                className="font-mono mt-1 flex justify-between"
                style={{ fontSize: 10 }}
              >
                <span className="text-ink-mute">your balance</span>
                <span className="tabular">
                  {fmt.num(balanceDisplay, balanceDisplay < 1 ? 4 : 2)} {s.sym}
                </span>
              </div>
            )}
          </div>

          {/* Shares input */}
          <div className="mt-5">
            <div className="flex justify-between items-baseline mb-1.5">
              <span className="eyebrow">Shares to pledge</span>
              <span
                className="font-mono tabular text-ink-mute"
                style={{ fontSize: 11 }}
              >
                ≈ {fmt.usd(collateralUsd, 0)}
              </span>
            </div>
            <div className="flex items-center gap-3 px-4 py-3.5 border border-ink rounded-[2px]">
              <input
                type="number"
                value={shares}
                onChange={(e) =>
                  composing && setShares(Math.max(0, +e.target.value || 0))
                }
                disabled={!composing}
                className="flex-1 bg-transparent outline-none font-serif font-medium tracking-tight"
                style={{ fontSize: 24, border: "none" }}
              />
              <span
                className="font-mono text-ink-soft"
                style={{ fontSize: 13 }}
              >
                {s.sym}
              </span>
            </div>
            {live && balanceDisplay !== null && balanceDisplay > 0 && (
              <div className="flex gap-1.5 mt-1.5">
                {[0.25, 0.5, 1].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() =>
                      composing &&
                      setShares(Math.floor(balanceDisplay * p * 1e4) / 1e4)
                    }
                    className="px-2 py-1 border border-hairline rounded-[2px] font-mono"
                    style={{ fontSize: 10 }}
                    disabled={!composing}
                  >
                    {p === 1 ? "MAX" : `${p * 100}%`}
                  </button>
                ))}
              </div>
            )}
            {insufficient && (
              <div
                className="text-down font-mono mt-1.5"
                style={{ fontSize: 10 }}
              >
                insufficient balance — visit faucet for testnet tokens
              </div>
            )}
          </div>

          {/* Borrow % slider */}
          <div className="mt-5">
            <div className="flex justify-between items-baseline mb-2">
              <span className="eyebrow">Borrow {borrowPct}% of max</span>
              <span
                className="font-mono tabular text-ink-mute"
                style={{ fontSize: 11 }}
              >
                LTV {(s.ltv * 100).toFixed(0)}% cap
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={borrowPct}
              disabled={!composing}
              onChange={(e) => setBorrowPct(+e.target.value)}
              className="w-full cursor-pointer"
            />
            {borrowBelowMinimum && (
              <div
                className="font-mono mt-2 rounded-[2px]"
                style={{
                  fontSize: 11,
                  padding: "6px 10px",
                  background: "var(--down-soft)",
                  color: "var(--down)",
                  border: "1px solid var(--down)",
                }}
              >
                Minimum borrow is ${MIN_BORROW_USD}. Increase collateral or set
                borrow slider to 0% to pledge without borrowing.
              </div>
            )}
            {borrowExceedsLiquidity && (
              <div
                className="font-mono mt-2 rounded-[2px]"
                style={{
                  fontSize: 11,
                  padding: "6px 10px",
                  background: "var(--down-soft)",
                  color: "var(--down)",
                  border: "1px solid var(--down)",
                }}
              >
                Vault only has {fmt.usd(vaultLiquidityUsd ?? 0, 2)} {vault.borrowSymbol} available.
                Reduce borrow amount or deposit LP first.
              </div>
            )}
            <div className="flex justify-between items-end mt-2">
              <span className="font-mono tabular" style={{ fontSize: 12 }}>
                You receive
              </span>
              <div className="text-right">
                {isWethVault && borrowTokenAmount != null ? (
                  <>
                    <div
                      className="font-serif tabular font-medium"
                      style={{ fontSize: 22, letterSpacing: "-0.02em" }}
                    >
                      {borrowTokenAmount < 0.001 && borrowTokenAmount > 0
                        ? borrowTokenAmount.toFixed(6)
                        : borrowTokenAmount.toFixed(4)}{" "}
                      <span
                        className="font-mono text-ink-mute ml-1"
                        style={{ fontSize: 11 }}
                      >
                        WETH
                      </span>
                    </div>
                    <div
                      className="font-mono tabular text-ink-mute"
                      style={{ fontSize: 11, marginTop: 2 }}
                    >
                      ≈ {fmt.usd(borrowUsd, 2)} · ETH @ {fmt.usd(ethPrice ?? 0, 0)}
                    </div>
                  </>
                ) : (
                  <div
                    className="font-serif tabular font-medium"
                    style={{ fontSize: 22, letterSpacing: "-0.02em" }}
                  >
                    {fmt.usd(borrowUsd, 2)}{" "}
                    <span
                      className="font-mono text-ink-mute ml-1"
                      style={{ fontSize: 11 }}
                    >
                      {vault.borrowSymbol}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Auto-vault toggle — DISABLED. Aave V3 routing is on the roadmap
              but no Aave call sites exist in the vault or bundle path yet. */}
          <div
            aria-disabled
            className="mt-4 w-full flex justify-between items-center px-4 py-3.5 rounded-[2px] text-left"
            style={{
              border: "1px solid var(--hairline)",
              background: "var(--paper-alt)",
              cursor: "not-allowed",
              opacity: 0.7,
            }}
          >
            <div>
              <div
                className="font-medium inline-flex items-center gap-2"
                style={{ fontSize: 13 }}
              >
                Route to Aave V3 vault
                <span
                  className="font-mono inline-flex items-center"
                  style={{
                    fontSize: 9,
                    letterSpacing: "0.08em",
                    padding: "2px 6px",
                    border: "1px solid var(--hairline)",
                    background: "var(--paper)",
                    color: "var(--ink-mute)",
                    borderRadius: 2,
                  }}
                >
                  COMING SOON
                </span>
              </div>
              <div
                className="text-ink-mute mt-0.5"
                style={{ fontSize: 11 }}
              >
                Auto-deposit borrowed {vault.borrowSymbol} into Aave V3 in the same
                bundle. Vault integration not yet live on Robinhood Chain testnet.
              </div>
            </div>
            <div
              className="w-8 h-[18px] rounded-full relative"
              style={{ background: "var(--hairline)" }}
            >
              <div
                className="absolute top-0.5 w-[14px] h-[14px] bg-paper rounded-full"
                style={{ left: 2 }}
              />
            </div>
          </div>

          {/* Health summary */}
          <div className="mt-5 px-4 py-3.5 bg-paper-alt border border-hairline-soft">
            <div
              className="flex justify-between mb-1.5"
              style={{ fontSize: 12 }}
            >
              <span className="text-ink-soft">Position LTV</span>
              <span className="font-mono tabular">
                {ltvActual.toFixed(1)}% / {(s.ltv * 100).toFixed(0)}% cap
              </span>
            </div>
            <div className="h-1 bg-paper relative border border-hairline">
              <div
                className="absolute left-0 top-0 bottom-0"
                style={{
                  width: `${Math.min(100, (ltvActual / (s.ltv * 100)) * 100)}%`,
                  background:
                    ltvActual / (s.ltv * 100) > 0.85
                      ? "var(--down)"
                      : "var(--ink)",
                }}
              />
            </div>
            <div className="flex justify-between mt-2.5">
              <span className="text-ink-soft" style={{ fontSize: 12 }}>
                Health factor
              </span>
              <span
                className="font-mono tabular font-medium"
                style={{
                  fontSize: 12,
                  color:
                    healthFactor > 1.5 ? "var(--up)" : "var(--amber)",
                }}
              >
                {healthFactor > 10 ? "∞" : healthFactor.toFixed(2)}
              </span>
            </div>
          </div>

          {/* CTA */}
          <button
            type="button"
            onClick={() => {
              if (ctaAction && !ctaDisabled) ctaAction();
            }}
            disabled={ctaDisabled || !ctaAction}
            className="mt-5 w-full px-5 py-4 border border-ink rounded-[2px] font-medium flex justify-between items-center"
            style={{
              fontSize: 14,
              background: stage === "sealed" ? "var(--paper)" : "var(--ink)",
              color: stage === "sealed" ? "var(--ink)" : "var(--paper)",
              opacity: ctaDisabled ? 0.5 : 1,
              cursor: ctaDisabled ? "not-allowed" : "pointer",
            }}
          >
            <span>{ctaLabel}</span>
            {isConnected && onCorrectChain && composing && !ctaDisabled && (
              <span
                className="font-mono opacity-75"
                style={{ fontSize: 11 }}
              >
                {live ? "2 onchain steps" : `${activeOps.length} ops → 1 sig`}
              </span>
            )}
            {busy && (
              <span
                className="font-mono inline-block"
                style={{
                  fontSize: 14,
                  animation: "ef-spin 1.6s linear infinite",
                }}
              >
                ⟳
              </span>
            )}
            {stage === "sealed" && (
              <span
                className="font-mono text-up"
                style={{ fontSize: 11 }}
              >
                ✓ Sealed
              </span>
            )}
          </button>
          {writeError && (
            <div
              className="text-down font-mono mt-2"
              style={{ fontSize: 10, wordBreak: "break-word" }}
            >
              {writeError.message.slice(0, 180)}
            </div>
          )}
          {aaError && (
            <div
              className="text-down font-mono mt-2"
              style={{ fontSize: 10, wordBreak: "break-word" }}
            >
              UserOp: {aaError.slice(0, 180)}
            </div>
          )}
          {aaActive && AA_CONFIGURED && (
            <div className="mt-2.5 flex justify-center gap-1">
              {(["sponsored", "usdg", "self"] as GasMode[]).map((m) => {
                const disabled = m === "usdg" && !usdgGasAvailable;
                const label =
                  m === "sponsored"
                    ? "Sponsored"
                    : m === "usdg"
                      ? "USDG"
                      : "Self · ETH";
                return (
                  <button
                    key={m}
                    type="button"
                    disabled={disabled}
                    onClick={() => setGasMode(m)}
                    className="font-mono px-2 py-1 rounded-[2px] border transition-colors"
                    style={{
                      fontSize: 10,
                      borderColor:
                        gasMode === m ? "var(--ink)" : "var(--hairline)",
                      background:
                        gasMode === m ? "var(--ink)" : "transparent",
                      color:
                        gasMode === m
                          ? "var(--paper)"
                          : disabled
                            ? "var(--ink-mute)"
                            : "var(--ink-soft)",
                      opacity: disabled ? 0.4 : 1,
                      cursor: disabled ? "not-allowed" : "pointer",
                    }}
                    title={
                      disabled
                        ? "Set NEXT_PUBLIC_ALCHEMY_GAS_POLICY_ID_USDG to enable"
                        : ""
                    }
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}
          <div
            className="mt-2 text-center"
            style={{ fontSize: 11 }}
          >
            {aaActive && AA_CONFIGURED ? (
              <span className="text-up font-mono">
                {gasMode === "sponsored" && (
                  <>
                    ⛽ Gas: Sponsored by Alchemy Gas Manager
                    {aaMode === "eip7702" && " · via EIP-7702"}
                  </>
                )}
                {gasMode === "usdg" && (
                  <>⛽ Gas: Paid in USDG via ERC20 paymaster</>
                )}
                {gasMode === "self" && (
                  <>⛽ Gas: Paid in ETH from your smart wallet</>
                )}
              </span>
            ) : aaActive && !AA_CONFIGURED ? (
              <span className="text-amber font-mono">
                ⚠ Set NEXT_PUBLIC_ALCHEMY_API_KEY to enable sponsored gas
              </span>
            ) : (
              <span className="text-ink-mute">
                {live
                  ? `Gas (~${totalGas.toFixed(5)} ETH) paid by your EOA · enable smart wallet for sponsorship`
                  : `⛽ Gas (~${totalGas.toFixed(5)} ETH) sponsored by EquiFlow Gas Manager (demo)`}
              </span>
            )}
          </div>
        </div>
      </div>

      <SiteFooter />
    </div>
  );
}

function BundleStage({
  operations,
  stage,
  totalGas,
  stockSym,
  borrowUsd,
  txHash,
  live,
}: {
  operations: Operation[];
  stage: Stage;
  totalGas: number;
  stockSym: string;
  borrowUsd: number;
  txHash?: `0x${string}`;
  live: boolean;
}) {
  const { vault } = useVaultContext();
  const started =
    stage === "approving" ||
    stage === "lock" ||
    stage === "locking" ||
    stage === "sealed";
  const bundled = stage === "locking" || stage === "sealed";
  const sealed = stage === "sealed";
  const COLS = 4;

  // ── Live mode: collapse the 4 op-cards into the 2 real on-chain
  // transactions the user will sign. Tx 1 is the ERC-20 approve, Tx 2 is
  // EquiFlowVault.pledgeAndBorrow — which locks the collateral *and* mints
  // USDG atomically. (Aave routing, when enabled, is performed by the
  // vault keeper *after* settlement, not by either tx the user signs.)
  const approveOp = operations.find((o) => o.op === "approve");
  const tx2Ops = operations.filter((o) => o.op === "lock" || o.op === "borrow");
  const routeOp = operations.find((o) => o.op === "route");

  const step1State: StepState =
    stage === "idle"
      ? "pending"
      : stage === "approving"
        ? "active"
        : "done";
  const step2State: StepState =
    stage === "idle" || stage === "approving"
      ? "pending"
      : stage === "lock"
        ? "ready"
        : stage === "locking"
          ? "active"
          : "done";

  const headline = sealed
    ? "Sealed pledge"
    : stage === "locking"
      ? "Mining Tx 2 · pledge + borrow…"
      : stage === "lock"
        ? "Tx 1 confirmed · sign Tx 2 to seal"
        : stage === "approving"
          ? "Mining Tx 1 · approval…"
          : "Pending pledge";

  return (
    <div className="px-8 py-7 overflow-auto flex flex-col">
      <div className="eyebrow mb-2">
        {live
          ? "Robinhood Chain · on-chain settlement"
          : "Account Abstraction · ERC-4337 (demo)"}
      </div>
      <div
        className="font-serif font-medium"
        style={{ fontSize: 22, letterSpacing: "-0.02em" }}
      >
        {live
          ? headline
          : sealed
            ? "Sealed pledge"
            : bundled
              ? "Locking on chain…"
              : started
                ? "Awaiting approval…"
                : "Pending pledge"}
      </div>
      <div className="text-ink-soft mb-6" style={{ fontSize: 12 }}>
        {live ? (
          <>
            Two signatures. <em>Tx 1</em> approves the vault · <em>Tx 2</em>{" "}
            locks collateral and borrows {vault.borrowSymbol} atomically.
          </>
        ) : (
          "EntryPoint 0xEntr·yPoiNt7 · Bundler · Paymaster (Gas Manager)"
        )}
      </div>

      {live ? (
        <div className="flex flex-col gap-3">
          <div
            className="grid items-stretch gap-3"
            style={{ gridTemplateColumns: "1fr 28px 1fr" }}
          >
            <LiveStepCard
              n={1}
              of={2}
              title="Approve"
              blurb={`Authorize EquiFlowVault to move your ${stockSym}.`}
              ops={approveOp ? [approveOp] : []}
              state={step1State}
              txHash={stage === "approving" ? txHash : undefined}
            />
            <StepArrow done={step1State === "done"} />
            <LiveStepCard
              n={2}
              of={2}
              title="Pledge + borrow"
              blurb={`Lock collateral and borrow ${fmt.usd(borrowUsd, 2)} ${vault.borrowSymbol} — one atomic call.`}
              ops={tx2Ops}
              state={step2State}
              txHash={
                stage === "locking" || stage === "sealed" ? txHash : undefined
              }
              footer={
                routeOp
                  ? `After settle · auto-route ${vault.borrowSymbol} to Aave V3 (+${routeOp.gas.toFixed(5)} ETH, keeper-paid)`
                  : undefined
              }
            />
          </div>
        </div>
      ) : (
        <div className="relative" style={{ minHeight: 220 }}>
          <div
            className="absolute left-6 right-6 bg-hairline"
            style={{ top: 32, height: 1 }}
          />

          <div
            className="absolute border-[1.4px] border-ink rounded-[2px] transition-all duration-300"
            style={{
              left: "50%",
              top: 152,
              transform: "translateX(-50%)",
              width: 360,
              padding: "14px 18px",
              background: sealed ? "var(--ink)" : "var(--paper)",
              color: sealed ? "var(--paper)" : "var(--ink)",
              opacity: started ? 1 : 0.4,
            }}
          >
            <div className="flex justify-between items-center">
              <span
                className="font-mono opacity-70"
                style={{ fontSize: 10, letterSpacing: "0.08em" }}
              >
                USER OPERATION
              </span>
              <span
                className="font-mono opacity-70"
                style={{ fontSize: 10 }}
              >
                {operations.length} → 1
              </span>
            </div>
            <div
              className="font-serif font-medium mt-1.5"
              style={{ fontSize: 17, letterSpacing: "-0.02em" }}
            >
              Pledge {stockSym} · borrow {fmt.usd(borrowUsd, 2)} {vault.borrowSymbol}
            </div>
            <div
              className="font-mono opacity-70 mt-1.5 flex gap-3"
              style={{ fontSize: 10 }}
            >
              {txHash ? (
                <a
                  href={explorerTx(txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="no-underline"
                  style={{ color: "inherit" }}
                >
                  tx: {shortAddr(txHash, 8, 6)} ↗
                </a>
              ) : (
                <span>tx: pending</span>
              )}
              {sealed && <span className="text-up">✓ included</span>}
            </div>
          </div>

          <div
            className="grid gap-3.5 relative"
            style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}
          >
            {operations.map((op, i) => {
              const collapsed = bundled;
              return (
                <div
                  key={op.id}
                  className="px-3.5 py-3 bg-paper border border-hairline rounded-[2px] relative"
                  style={{
                    transform: collapsed
                      ? `translate(${(COLS / 2 - 0.5 - i) * 100 - 50}%, 120px) scale(0.7)`
                      : "none",
                    opacity: collapsed ? 0 : 1,
                    transition:
                      "transform .9s cubic-bezier(.7,0,.2,1), opacity .6s ease-in .3s",
                    zIndex: collapsed ? 0 : 2,
                  }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span
                      className="font-mono text-ink-mute"
                      style={{ fontSize: 9, letterSpacing: "0.1em" }}
                    >
                      OP·{op.id}
                    </span>
                    <div
                      className="w-3.5 h-3.5 rounded-full border-[1.5px] border-ink flex items-center justify-center"
                      style={{
                        background: started ? "var(--ink)" : "var(--paper)",
                      }}
                    >
                      {started && (
                        <span
                          className="text-paper leading-none"
                          style={{ fontSize: 8 }}
                        >
                          ✓
                        </span>
                      )}
                    </div>
                  </div>
                  <div
                    className="font-semibold mb-1 uppercase"
                    style={{ fontSize: 11, letterSpacing: "0.06em" }}
                  >
                    {op.op}
                  </div>
                  <div
                    className="font-mono text-ink-soft"
                    style={{ fontSize: 10, lineHeight: 1.4 }}
                  >
                    {op.contract}
                  </div>
                  <div
                    className="font-mono text-ink-mute mt-0.5 break-all"
                    style={{ fontSize: 10, lineHeight: 1.4 }}
                  >
                    {op.fn}
                  </div>
                  <div className="mt-2.5 pt-2 border-t border-dashed border-hairline-soft flex justify-between">
                    <span
                      className="font-mono text-ink-mute"
                      style={{ fontSize: 10 }}
                    >
                      gas
                    </span>
                    <span
                      className="font-mono tabular text-ink-mute"
                      style={{ fontSize: 10 }}
                    >
                      {op.gas.toFixed(5)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Comparison panel — what bundling buys you */}
      <div
        className={`${live ? "mt-6" : "mt-14"} px-5 py-4 border border-amber bg-amber-soft grid grid-cols-1 sm:grid-cols-3`}
      >
        <div className="sm:border-r border-b sm:border-b-0 border-dashed border-amber pr-0 sm:pr-4 pb-3 sm:pb-0">
          <div className="eyebrow text-ink mb-1.5">Without bundling</div>
          <div
            className="font-serif tabular font-medium"
            style={{ fontSize: 22, letterSpacing: "-0.02em" }}
          >
            {operations.length} signatures
          </div>
          <div
            className="font-mono tabular text-ink-soft mt-1"
            style={{ fontSize: 11 }}
          >
            ~{totalGas.toFixed(5)} ETH · {operations.length} wallet popups
          </div>
        </div>
        <div className="sm:border-r border-b sm:border-b-0 border-dashed border-amber px-0 sm:px-4 py-3 sm:py-0">
          <div className="eyebrow text-ink mb-1.5">With EquiFlow</div>
          <div
            className="font-serif tabular font-medium"
            style={{ fontSize: 22, letterSpacing: "-0.02em" }}
          >
            {live ? "2 signatures" : "1 signature"}
          </div>
          <div
            className="font-mono tabular text-ink-soft mt-1"
            style={{ fontSize: 11 }}
          >
            {live
              ? "approve · then atomic pledge + borrow"
              : "0 ETH from your wallet — paid by Gas Manager"}
          </div>
        </div>
        <div className="pl-0 sm:pl-4 pt-3 sm:pt-0">
          <div className="eyebrow text-ink mb-1.5">You save</div>
          <div
            className="font-serif tabular font-medium text-up"
            style={{ fontSize: 22, letterSpacing: "-0.02em" }}
          >
            {live ? `${Math.max(0, operations.length - 2)}×` : "100%"}
          </div>
          <div
            className="font-mono tabular text-ink-soft mt-1"
            style={{ fontSize: 11 }}
          >
            {live ? "fewer popups vs. one-by-one" : "Funded from borrow-rate margin"}
          </div>
        </div>
      </div>

      <div
        className="mt-5 px-4 py-3.5 bg-ink text-paper rounded-[2px] font-mono flex-1"
        style={{ fontSize: 11, lineHeight: 1.7 }}
      >
        <div
          className="opacity-50 mb-1.5"
          style={{ letterSpacing: "0.08em", fontSize: 10 }}
        >
          {">>"} {live ? "CHAIN LOG" : "BUNDLER LOG"}
        </div>
        {live ? (
          <>
            <LogLine line="[t+0.0s] Pledge composed" show={started} />
            <LogLine
              line={`[t+0.3s] Tx 1 · approve(${stockSym}, EquiFlowVault) submitted`}
              show={started}
            />
            {stage === "approving" && txHash && (
              <LogLine
                line={`         · tx ${shortAddr(txHash, 10, 8)}`}
                show
              />
            )}
            <LogLine
              line={`[t+0.9s] Tx 1 confirmed · allowance set`}
              show={
                stage === "lock" || stage === "locking" || stage === "sealed"
              }
            />
            <LogLine
              line={`[t+1.2s] Tx 2 · pledgeAndBorrow(${stockSym}, ${fmt.usd(borrowUsd, 2)}) submitted`}
              show={stage === "locking" || stage === "sealed"}
            />
            {(stage === "locking" || stage === "sealed") && txHash && (
              <LogLine
                line={`         · tx ${shortAddr(txHash, 10, 8)}`}
                show
              />
            )}
            <LogLine
              line={`[t+1.8s] sealed · ${stockSym} locked · ${fmt.usd(borrowUsd, 2)} ${vault.borrowSymbol} borrowed`}
              show={sealed}
              highlight
            />
          </>
        ) : (
          <>
            <LogLine line="[t+0.0s] Pledge composed" show={started} />
            <LogLine
              line={`[t+0.3s] approve(${stockSym}, EquiFlowVault) submitted`}
              show={started}
            />
            <LogLine
              line={`[t+1.2s] locking ${stockSym} · transfer to vault`}
              show={bundled}
            />
            <LogLine
              line={`[t+1.6s] sealed · pledge complete · +${fmt.usd(borrowUsd, 2)} ${vault.borrowSymbol} routed`}
              show={sealed}
              highlight
            />
          </>
        )}
      </div>
    </div>
  );
}

type StepState = "pending" | "ready" | "active" | "done";

function LiveStepCard({
  n,
  of,
  title,
  blurb,
  ops,
  state,
  txHash,
  footer,
}: {
  n: number;
  of: number;
  title: string;
  blurb: string;
  ops: Operation[];
  state: StepState;
  txHash?: `0x${string}`;
  footer?: string;
}) {
  const isActive = state === "active";
  const isDone = state === "done";
  const isReady = state === "ready";
  const isPending = state === "pending";

  const totalGas = ops.reduce((a, o) => a + o.gas, 0);

  const statusLabel = isDone
    ? "✓ INCLUDED"
    : isActive
      ? "SIGNING…"
      : isReady
        ? "SIGN NEXT"
        : "PENDING";

  const statusBg = isDone
    ? "var(--up)"
    : isActive
      ? "var(--amber)"
      : isReady
        ? "var(--ink)"
        : "var(--hairline-soft)";
  const statusFg =
    isDone || isActive || isReady ? "var(--paper)" : "var(--ink-mute)";

  return (
    <div
      className="rounded-[2px] flex flex-col"
      style={{
        border: `1.4px solid ${
          isActive
            ? "var(--amber)"
            : isReady
              ? "var(--ink)"
              : isDone
                ? "var(--ink)"
                : "var(--hairline)"
        }`,
        background: isDone
          ? "var(--ink)"
          : isActive
            ? "var(--amber-soft)"
            : isReady
              ? "var(--paper-alt)"
              : "var(--paper)",
        color: isDone ? "var(--paper)" : "var(--ink)",
        opacity: isPending ? 0.6 : 1,
        padding: "14px 16px",
        transition: "all .25s ease",
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <span
          className="font-mono"
          style={{ fontSize: 10, letterSpacing: "0.12em", opacity: 0.7 }}
        >
          TX {n} / {of}
        </span>
        <span
          className="font-mono rounded-[2px]"
          style={{
            fontSize: 9,
            letterSpacing: "0.1em",
            padding: "3px 7px",
            background: statusBg,
            color: statusFg,
            fontWeight: 500,
          }}
        >
          {statusLabel}
        </span>
      </div>

      <div
        className="font-serif font-medium"
        style={{ fontSize: 17, letterSpacing: "-0.02em", lineHeight: 1.1 }}
      >
        {title}
      </div>
      <div
        className="mt-1"
        style={{ fontSize: 11.5, opacity: 0.78, lineHeight: 1.4 }}
      >
        {blurb}
      </div>

      <div
        className="mt-3 pt-2.5"
        style={{ borderTop: "1px dashed var(--hairline-soft)" }}
      >
        {ops.length > 1 && (
          <div
            className="font-mono uppercase mb-1.5"
            style={{ fontSize: 9, letterSpacing: "0.1em", opacity: 0.55 }}
          >
            Atomic calls ({ops.length})
          </div>
        )}
        {ops.map((op) => (
          <div
            key={op.id}
            className="font-mono"
            style={{
              fontSize: 10.5,
              padding: "1.5px 0",
              lineHeight: 1.45,
              wordBreak: "break-all",
            }}
          >
            <span style={{ opacity: 0.55, marginRight: 4 }}>·</span>
            <span style={{ opacity: 0.85 }}>{op.contract}</span>{" "}
            <span style={{ opacity: 0.55 }}>{op.fn}</span>
          </div>
        ))}
      </div>

      <div
        className="mt-2.5 pt-2 flex justify-between items-center"
        style={{ borderTop: "1px dashed var(--hairline-soft)" }}
      >
        <span className="font-mono" style={{ fontSize: 10, opacity: 0.55 }}>
          gas
        </span>
        <span className="font-mono tabular" style={{ fontSize: 10, opacity: 0.78 }}>
          ~{totalGas.toFixed(5)} ETH
        </span>
      </div>

      {txHash && (
        <a
          href={explorerTx(txHash)}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono no-underline mt-2 block"
          style={{
            fontSize: 10,
            color: "inherit",
            opacity: 0.85,
            wordBreak: "break-all",
          }}
        >
          tx {shortAddr(txHash, 8, 6)} ↗
        </a>
      )}

      {footer && (
        <div
          className="font-mono mt-2 pt-2"
          style={{
            fontSize: 10,
            opacity: 0.7,
            borderTop: "1px dashed var(--hairline-soft)",
            lineHeight: 1.4,
          }}
        >
          {footer}
        </div>
      )}
    </div>
  );
}

function StepArrow({ done }: { done: boolean }) {
  return (
    <div
      className="flex items-center justify-center"
      style={{ minWidth: 24 }}
    >
      <span
        className="font-mono"
        style={{
          fontSize: 22,
          color: done ? "var(--ink)" : "var(--ink-mute)",
          opacity: done ? 1 : 0.5,
          transition: "all .2s ease",
        }}
      >
        →
      </span>
    </div>
  );
}

function LogLine({
  line,
  show,
  highlight,
}: {
  line: string;
  show: boolean;
  highlight?: boolean;
}) {
  return (
    <div
      className="transition-opacity duration-300"
      style={{
        opacity: show ? 1 : 0.18,
        color: highlight ? "var(--amber)" : undefined,
      }}
    >
      {line}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   TRANSACTION SUMMARY (banner above bundle stage)
   ────────────────────────────────────────────────────────── */
function TxSummary({
  stock: s,
  livePrice,
  shares,
  collateralUsd,
  borrowUsd,
  ltvActual,
  netApy,
  yearlyNet,
  healthFactor,
  autoVault,
  stage,
}: {
  stock: ReturnType<typeof findStock>;
  livePrice: number;
  shares: number;
  collateralUsd: number;
  borrowUsd: number;
  ltvActual: number;
  netApy: number;
  yearlyNet: number;
  healthFactor: number;
  autoVault: boolean;
  stage: Stage;
}) {
  const { vault } = useVaultContext();
  const sealed = stage === "sealed";
  const statusLabel =
    stage === "idle"
      ? "READY TO SIGN"
      : stage === "approve" || stage === "approving"
        ? "SIGNING"
        : stage === "lock" || stage === "locking"
          ? "BUNDLING"
          : "✓ INCLUDED";

  return (
    <section
      style={{
        padding: "24px 32px",
        borderBottom: "1px solid var(--ink)",
      }}
    >
      <div className="flex items-end justify-between" style={{ marginBottom: 14 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            Transaction preview
          </div>
          <h2
            className="font-serif font-medium m-0"
            style={{
              fontSize: 26,
              letterSpacing: "-0.025em",
              lineHeight: 1.05,
            }}
          >
            {sealed ? "Pledge sealed." : "Pledge "}
            <span
              className="font-mono tabular bg-paper-alt rounded-[2px]"
              style={{
                fontSize: 22,
                fontWeight: 500,
                padding: "0 6px",
                marginLeft: 4,
              }}
            >
              {shares} {s.sym}
            </span>
            <em> · borrow</em>
            <span
              className="font-mono tabular rounded-[2px] bg-ink text-paper"
              style={{
                fontSize: 22,
                fontWeight: 500,
                padding: "0 6px",
                marginLeft: 6,
              }}
            >
              {fmt.usd(borrowUsd, 2)}
            </span>
          </h2>
        </div>
        <span
          className="font-mono rounded-[2px]"
          style={{
            fontSize: 10,
            padding: "4px 8px",
            background: sealed ? "var(--up)" : "var(--hairline-soft)",
            color: sealed ? "var(--paper)" : "var(--ink-soft)",
            letterSpacing: "0.08em",
          }}
        >
          {statusLabel}
        </span>
      </div>

      <div className="grid grid-cols-4" style={{ border: "1px solid var(--hairline)" }}>
        <SumCell
          label="Collateral pledged"
          value={fmt.usd(collateralUsd, 0)}
          sub={`${shares} ${s.sym} · ${fmt.usd(livePrice, 2)}/share`}
        />
        <SumCell
          label={`Borrow · ${vault.borrowSymbol}`}
          value={fmt.usd(borrowUsd, 2)}
          sub={`@ ${ltvActual.toFixed(1)}% LTV`}
        />
        <SumCell
          label="Net APY (you keep)"
          value={fmt.signedPct(netApy, 2)}
          valueColor={netApy > 0 ? "var(--up)" : "var(--down)"}
          sub={
            autoVault
              ? `via Aave V3 · ${fmt.usd(yearlyNet, 0)}/yr`
              : "Vault routing off · costs only"
          }
        />
        <SumCell
          label="Health factor"
          value={healthFactor > 99 ? "∞" : healthFactor.toFixed(2)}
          valueColor={
            healthFactor > 2.5
              ? "var(--up)"
              : healthFactor > 1.5
                ? "var(--amber)"
                : "var(--down)"
          }
          sub="liquidates at 1.00"
          last
        />
      </div>
    </section>
  );
}

function SumCell({
  label,
  value,
  valueColor,
  sub,
  last,
}: {
  label: string;
  value: string;
  valueColor?: string;
  sub: string;
  last?: boolean;
}) {
  return (
    <div
      style={{
        padding: "14px 18px",
        borderRight: last ? "none" : "1px solid var(--hairline-soft)",
      }}
    >
      <div className="eyebrow" style={{ marginBottom: 6 }}>
        {label}
      </div>
      <div
        className="font-serif font-medium tabular"
        style={{
          fontSize: 24,
          letterSpacing: "-0.025em",
          lineHeight: 1,
          color: valueColor ?? "var(--ink)",
        }}
      >
        {value}
      </div>
      <div
        className="font-mono tabular text-ink-mute"
        style={{ fontSize: 10, marginTop: 6 }}
      >
        {sub}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   DETAIL PANELS · 2x2 grid
   ────────────────────────────────────────────────────────── */
function DetailPanel({
  title,
  kicker,
  children,
  borderRight,
  borderTop,
}: {
  title: string;
  kicker?: string;
  children: React.ReactNode;
  borderRight?: boolean;
  borderTop?: boolean;
}) {
  return (
    <div
      style={{
        padding: "18px 22px",
        borderRight: borderRight ? "1px solid var(--hairline)" : "none",
        borderTop: borderTop ? "1px solid var(--hairline)" : "none",
      }}
    >
      <div className="flex items-baseline justify-between" style={{ marginBottom: 12 }}>
        <h3
          className="font-serif font-medium m-0"
          style={{ fontSize: 16, letterSpacing: "-0.02em" }}
        >
          {title}
        </h3>
        {kicker && (
          <span
            className="font-mono text-ink-mute text-right"
            style={{ fontSize: 10 }}
          >
            {kicker}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function PanelRow({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div
      className="flex justify-between items-baseline"
      style={{
        padding: "8px 0",
        borderBottom: "1px dashed var(--hairline-soft)",
      }}
    >
      <span
        className="font-mono text-ink-mute uppercase"
        style={{ fontSize: 11, letterSpacing: "0.04em" }}
      >
        {label}
      </span>
      <div className="text-right">
        <div
          className="font-mono tabular font-medium"
          style={{ fontSize: 12, color: color ?? "var(--ink)" }}
        >
          {value}
        </div>
        {sub && (
          <div
            className="font-mono text-ink-mute"
            style={{ fontSize: 10, marginTop: 2 }}
          >
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}

function LiqRiskPanel({
  stock: s,
  livePrice,
  liqPrice,
  liqAt,
  ltvActual,
  ltvCap,
}: {
  stock: ReturnType<typeof findStock>;
  livePrice: number;
  liqPrice: number;
  liqAt: number;
  ltvActual: number;
  ltvCap: number;
}) {
  const W = 380,
    H = 90;
  const drop = ltvActual > 0 ? (livePrice - liqPrice) / livePrice : 0;
  const dropPct = drop * 100;

  /// Real 24h price series from /api/markets/sparkline (Upstash-backed Pyth
  /// keeper ticks). Falls back to a deterministic seed-walk only when the
  /// backend has no data yet (fresh keeper, RBN testnet warmup, etc).
  const spark = useMarketsSparkline([s.sym], 48);
  const data = useMemo(() => {
    const real = spark.data?.series?.[s.sym];
    if (real && real.length >= 2) {
      // Snap last point to current livePrice so chart visually agrees with
      // the "NOW" label — keeper tick & client read can lag by a few seconds.
      const cloned = real.slice();
      cloned[cloned.length - 1] = livePrice;
      return cloned;
    }
    // Seed walk fallback (only when Upstash returns nothing).
    const out: number[] = [];
    let v = livePrice * 0.94;
    let seed = s.sym.charCodeAt(0) * 7 + 1;
    for (let i = 0; i < 24; i++) {
      seed = (seed * 9301 + 49297) % 233280;
      const r = seed / 233280 - 0.5;
      v = v + r * livePrice * 0.01 + (livePrice - v) * 0.08;
      out.push(v);
    }
    out[out.length - 1] = livePrice;
    return out;
  }, [s.sym, livePrice, spark.data]);
  const dataIsReal = !!spark.data?.series?.[s.sym] && spark.data.series[s.sym].length >= 2;
  const minV = Math.min(liqPrice, Math.min(...data)) * 0.97;
  const maxV = Math.max(livePrice, Math.max(...data)) * 1.02;
  const y = (v: number) => H - ((v - minV) / (maxV - minV)) * (H - 12) - 6;
  const path = data
    .map(
      (v, i) =>
        `${i === 0 ? "M" : "L"} ${(i / (data.length - 1)) * W},${y(v).toFixed(
          1,
        )}`,
    )
    .join(" ");
  const liqY = y(liqPrice);

  return (
    <DetailPanel
      title="Liquidation risk"
      kicker={`Drop ${dropPct.toFixed(1)}% before liquidation · ${
        dataIsReal ? "24h Pyth history" : "no history yet · simulated"
      }`}
      borderRight
    >
      <div style={{ marginTop: 4 }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="block">
          <rect
            x="0"
            y={liqY}
            width={W}
            height={H - liqY}
            fill="var(--down-soft)"
            opacity="0.65"
          />
          <line
            x1="0"
            x2={W}
            y1={liqY}
            y2={liqY}
            stroke="var(--down)"
            strokeWidth="1.2"
            strokeDasharray="4 3"
          />
          <text
            x={W - 4}
            y={liqY - 5}
            fontFamily="JetBrains Mono"
            fontSize="9"
            fill="var(--down)"
            textAnchor="end"
            letterSpacing="0.04em"
          >
            LIQ {fmt.usd(liqPrice, 2)}
          </text>
          <path d={path} fill="none" stroke="var(--ink)" strokeWidth="1.4" />
          <circle cx={W} cy={y(livePrice)} r="3.5" fill="var(--ink)" />
          <text
            x={W - 8}
            y={y(livePrice) - 6}
            fontFamily="JetBrains Mono"
            fontSize="9"
            fontWeight="600"
            fill="var(--ink)"
            textAnchor="end"
          >
            NOW {fmt.usd(livePrice, 2)}
          </text>
        </svg>
      </div>
      <PanelRow
        label="LTV (current / cap)"
        value={`${ltvActual.toFixed(1)}% / ${ltvCap.toFixed(0)}%`}
      />
      <PanelRow label="Liquidation LTV" value={`${liqAt.toFixed(0)}%`} />
      <PanelRow
        label="Drop until liquidation"
        value={`−${dropPct.toFixed(1)}%`}
        color="var(--down)"
      />
    </DetailPanel>
  );
}

function OracleAttestationsPanel({
  stock: s,
  livePrice,
  priceIsLive,
}: {
  stock: ReturnType<typeof findStock>;
  livePrice: number;
  priceIsLive: boolean;
}) {
  /// Real adapter data for the target stock — adapter address, last-push
  /// timestamp, and the stale-after window the vault enforces.
  const adapter = useAdapterPrice(s.sym);
  const ageSec =
    adapter.updatedAt > 0
      ? Math.max(0, Math.floor(Date.now() / 1000) - adapter.updatedAt)
      : null;
  /// Stale window for THIS asset's adapter — published via vault.assets().
  /// Loaded by useAdapterPrice as the 4th tuple element; we re-read it via a
  /// dedicated tuple read here to keep the panel self-contained.
  const staleWindowSec = useAdapterStaleWindow(s.sym);
  const isFresh =
    ageSec != null && staleWindowSec != null && ageSec <= staleWindowSec;
  return (
    <DetailPanel
      title="Oracle attestations"
      kicker={`Pyth adapter backing ${s.sym} collateral`}
    >
      <div style={{ marginTop: 4 }}>
        {/* Pair / price row */}
        <div
          className="grid items-center gap-3"
          style={{
            gridTemplateColumns: "1fr auto",
            padding: "10px 0",
            borderBottom: "1px dashed var(--hairline-soft)",
          }}
        >
          <div>
            <div className="font-mono font-medium" style={{ fontSize: 12 }}>
              {s.sym} / USD
            </div>
            <div
              className="font-mono text-ink-mute flex items-center gap-1.5"
              style={{ fontSize: 10, marginTop: 2 }}
            >
              <span
                className="rounded-full inline-block"
                style={{
                  width: 5,
                  height: 5,
                  background: priceIsLive ? "var(--up)" : "var(--ink-mute)",
                  animation: priceIsLive
                    ? "ef-breathe 2.2s ease-in-out infinite"
                    : undefined,
                }}
              />
              {priceIsLive ? "Pyth · on-chain" : "Off-chain · sim"}
            </div>
          </div>
          <div className="text-right">
            <div
              className="font-mono tabular font-medium"
              style={{ fontSize: 12 }}
            >
              {fmt.usd(livePrice, 2)}
            </div>
            <div
              className="font-mono text-ink-mute"
              style={{ fontSize: 10, marginTop: 2 }}
            >
              {ageSec != null ? `pushed ${formatAge(ageSec)} ago` : "—"}
            </div>
          </div>
        </div>

        {/* Adapter contract row */}
        <div
          className="grid items-center gap-3"
          style={{
            gridTemplateColumns: "1fr auto",
            padding: "10px 0",
            borderBottom: "1px dashed var(--hairline-soft)",
          }}
        >
          <div>
            <div className="font-mono font-medium" style={{ fontSize: 12 }}>
              Price adapter
            </div>
            <div
              className="font-mono text-ink-mute"
              style={{ fontSize: 10, marginTop: 2 }}
            >
              PythPriceAdapter · normalize 1e8 → 1e18
            </div>
          </div>
          <div className="text-right">
            {adapter.adapterAddr ? (
              <a
                href={explorerAddr(adapter.adapterAddr)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono tabular text-ink no-underline hover:underline"
                style={{ fontSize: 12 }}
              >
                {shortAddr(adapter.adapterAddr)}
              </a>
            ) : (
              <span
                className="font-mono text-ink-mute"
                style={{ fontSize: 12 }}
              >
                unconfigured
              </span>
            )}
            <div
              className="font-mono text-ink-mute"
              style={{ fontSize: 10, marginTop: 2 }}
            >
              view on explorer ↗
            </div>
          </div>
        </div>

        {/* Stale window row */}
        <div
          className="grid items-center gap-3"
          style={{
            gridTemplateColumns: "1fr auto",
            padding: "10px 0",
          }}
        >
          <div>
            <div className="font-mono font-medium" style={{ fontSize: 12 }}>
              Stale window
            </div>
            <div
              className="font-mono text-ink-mute"
              style={{ fontSize: 10, marginTop: 2 }}
            >
              Borrow/withdraw revert past this age
            </div>
          </div>
          <div className="text-right">
            <div
              className="font-mono tabular font-medium"
              style={{ fontSize: 12 }}
            >
              {staleWindowSec != null
                ? formatAge(staleWindowSec)
                : "—"}
            </div>
            <div
              className="font-mono"
              style={{
                fontSize: 10,
                marginTop: 2,
                color: isFresh ? "var(--up)" : "var(--down)",
              }}
            >
              {ageSec == null
                ? "no data yet"
                : isFresh
                  ? "✓ fresh"
                  : "⚠ stale"}
            </div>
          </div>
        </div>
      </div>
    </DetailPanel>
  );
}

/// Fetches vault.assets(token).staleAfter for the given symbol — the per-asset
/// freshness budget the price adapter enforces. Returns seconds or null while
/// loading / when the asset is not listed.
function useAdapterStaleWindow(sym: string): number | null {
  const { vault } = useVaultContext();
  const vaultAddr = vault.address ?? EQUIFLOW_VAULT_ADDRESS;
  const tokenAddr = STOCK_TOKEN_ADDRESSES[sym];
  const { data } = useReadContract({
    abi: EQUIFLOW_VAULT_ABI,
    address: vaultAddr,
    functionName: "assets",
    args: tokenAddr ? [tokenAddr] : undefined,
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: {
      enabled: !!vaultAddr && !!tokenAddr,
      staleTime: 60_000,
    },
  });
  if (!data) return null;
  const tuple = data as readonly [Address, bigint, bigint, bigint, boolean];
  return Number(tuple[3]);
}

function formatAge(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  if (sec < 86400) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${Math.floor(sec / 86400)}d`;
}

function FeeBreakdownPanel({
  stock: s,
  borrowUsd,
  autoVault,
  netApy,
  yearlyNet,
  totalGas,
}: {
  stock: ReturnType<typeof findStock>;
  borrowUsd: number;
  autoVault: boolean;
  netApy: number;
  yearlyNet: number;
  totalGas: number;
}) {
  /// Borrow and supply APR read from vault.borrowApyBps() / vault.lpApyBps().
  /// Falls back to 0 while the first multicall is in flight.
  const listedAddrs = useMemo(
    () =>
      Object.values(STOCK_TOKEN_ADDRESSES).filter(
        (a): a is Address => !!a,
      ),
    [],
  );
  const stats = useProtocolStats(listedAddrs);
  const borrowApr = stats.derived
    ? stats.derived.borrowAprBps / 100
    : 0;
  const vaultApr = stats.derived
    ? stats.derived.supplyAprBps / 100
    : 0;
  const aprIsLive = !!stats.derived;
  const yearlyBorrow = borrowUsd * (borrowApr / 100);
  const yearlyVault = autoVault ? borrowUsd * (vaultApr / 100) : 0;
  return (
    <DetailPanel
      title="Rate & fee breakdown"
      kicker={`Annualized · ${
        aprIsLive ? "live IRM rates" : "loading on-chain rates…"
      }`}
      borderRight
      borderTop
    >
      <PanelRow
        label="Borrow rate"
        value={`−${borrowApr.toFixed(2)}% APR`}
        sub={`−${fmt.usd(yearlyBorrow, 2)}/yr · util ${
          stats.utilizationPct != null
            ? stats.utilizationPct.toFixed(1) + "%"
            : "…"
        }`}
        color="var(--down)"
      />
      <PanelRow
        label="Vault yield"
        value={autoVault ? `+${vaultApr.toFixed(2)}% APR` : "off"}
        sub={autoVault ? `+${fmt.usd(yearlyVault, 2)}/yr` : "—"}
        color={autoVault ? "var(--up)" : "var(--ink-mute)"}
      />
      <PanelRow
        label="Protocol fee"
        value="0.20% / yr"
        sub={`−${fmt.usd(borrowUsd * 0.002, 2)}/yr`}
        color="var(--ink-soft)"
      />
      <PanelRow
        label="Gas (sponsored)"
        value="0.00"
        sub={`~${totalGas.toFixed(5)} ETH · paid by Gas Manager`}
        color="var(--up)"
      />
      <div
        className="flex justify-between items-baseline"
        style={{
          padding: "12px 0 4px",
          borderTop: "1px solid var(--ink)",
          marginTop: 6,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 500 }}>Net to you</span>
        <div className="text-right">
          <div
            className="font-serif font-medium tabular"
            style={{
              fontSize: 22,
              letterSpacing: "-0.025em",
              color: netApy > 0 ? "var(--up)" : "var(--down)",
            }}
          >
            {(netApy > 0 ? "+" : "") + netApy.toFixed(2)}% APY
          </div>
          <div
            className="font-mono tabular text-ink-mute"
            style={{ fontSize: 10, marginTop: 2 }}
          >
            {(yearlyNet > 0 ? "+" : "") + fmt.usd(yearlyNet, 2)} / yr
          </div>
        </div>
      </div>
    </DetailPanel>
  );
}

function RecentActivityPanel({
  stage,
}: {
  stage: Stage;
  /// Kept for backwards compatibility with the caller — `stock` and
  /// `borrowUsd` were used by the mock implementation to inject a "you just
  /// pledged" row. The real on-chain feed picks up the user's own pledge
  /// automatically once the event lands, so we don't need those props
  /// anymore.
  stock?: ReturnType<typeof findStock>;
  borrowUsd?: number;
}) {
  /// Caller passes `stage` so we know to bump refetch right after a sealed
  /// pledge — the just-confirmed tx might not yet be in the indexer's cached
  /// query window when the panel mounts.
  const { events, isLoading, isError } = useRecentVaultEvents();
  const { address: viewer } = useAccount();
  const viewerLower = viewer?.toLowerCase();

  return (
    <DetailPanel
      title="Recent pledges"
      kicker={`Last 30 minutes · protocol-wide${
        stage === "sealed" ? " · your pledge sealed" : ""
      }`}
      borderTop
    >
      {isLoading && (
        <div
          className="font-mono text-ink-mute"
          style={{ fontSize: 11, padding: "12px 0" }}
        >
          Scanning vault events…
        </div>
      )}
      {isError && !isLoading && (
        <div
          className="font-mono"
          style={{ fontSize: 11, padding: "12px 0", color: "var(--down)" }}
        >
          RPC error — couldn&apos;t fetch recent events.
        </div>
      )}
      {!isLoading && !isError && events.length === 0 && (
        <div
          className="font-mono text-ink-mute"
          style={{ fontSize: 11, padding: "12px 0" }}
        >
          No activity in the last 30 minutes.
        </div>
      )}
      <div style={{ marginTop: 4 }}>
        {events.map((e, i) => {
          const isYou = viewerLower
            ? e.actor.toLowerCase() === viewerLower
            : false;
          const badgeLabel =
            e.kind === "liquidated"
              ? "LIQUIDATED"
              : e.kind === "repay"
                ? "REPAY"
                : "✓ SEALED";
          const badgeColor =
            e.kind === "liquidated"
              ? { bg: "var(--down-soft)", fg: "var(--down)" }
              : e.kind === "repay"
                ? { bg: "var(--amber-soft)", fg: "var(--amber)" }
                : { bg: "var(--up-soft)", fg: "var(--up)" };
          return (
            <div
              key={`${e.txHash}-${i}`}
              className="grid items-center gap-3"
              style={{
                gridTemplateColumns: "54px 1fr auto",
                padding: "9px 0",
                borderBottom:
                  i < events.length - 1
                    ? "1px dashed var(--hairline-soft)"
                    : "none",
              }}
            >
              <span
                className="font-mono text-ink-mute"
                style={{ fontSize: 10, letterSpacing: "0.04em" }}
              >
                {compactAge(e.timestamp)}
              </span>
              <div>
                <div
                  className="text-ink"
                  style={{ fontSize: 12, lineHeight: 1.3 }}
                >
                  {e.label}
                </div>
                <div
                  className="font-mono text-ink-mute flex gap-2"
                  style={{ fontSize: 10, marginTop: 2 }}
                >
                  {isYou ? (
                    <span className="text-up font-medium">YOU</span>
                  ) : (
                    <span>{shortAddr(e.actor)}</span>
                  )}
                  <span>·</span>
                  <a
                    href={explorerTx(e.txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="no-underline text-ink-mute hover:text-ink"
                  >
                    {shortAddr(e.txHash, 6, 4)}
                  </a>
                </div>
              </div>
              <span
                className="font-mono font-medium"
                style={{
                  fontSize: 9,
                  padding: "3px 7px",
                  borderRadius: 2,
                  background: badgeColor.bg,
                  color: badgeColor.fg,
                  letterSpacing: "0.08em",
                }}
              >
                {badgeLabel}
              </span>
            </div>
          );
        })}
      </div>
    </DetailPanel>
  );
}

/// Compact age for the protocol-wide feed where space is tight. Always
/// returns 4 chars max: "now", "5m", "2h", "1d".
function compactAge(d: Date): string {
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}
