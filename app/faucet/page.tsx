"use client";

import { useState } from "react";
import Link from "next/link";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { type Address, parseUnits } from "viem";
import { PageNav } from "@/components/PageNav";
import { SiteFooter } from "@/components/SiteFooter";
import { AssetLogo } from "@/components/AssetLogo";
import { ERC20_ABI } from "@/lib/contracts/abi";
import {
  STOCK_TOKEN_ADDRESSES,
  USDC_ADDRESS,
} from "@/lib/contracts/addresses";
import { explorerAddr, shortAddr } from "@/lib/contracts";
import { FAUCET_URL, ROBINHOOD_CHAIN_TESTNET_ID } from "@/lib/config/chain";
import { STOCKS, isLive } from "@/lib/config/stocks";

const NATIVE_FAUCETS: { name: string; url: string; note: string }[] = [
  {
    name: "Robinhood Chain · Official",
    url: FAUCET_URL,
    note: "Get testnet ETH for gas. ~0.05 ETH per request, 24h cooldown.",
  },
];

export default function FaucetPage() {
  const { address, isConnected } = useAccount();

  return (
    <div className="flex flex-col min-h-screen">
      <PageNav current="faucet" />

      {/* Hero */}
      <section className="border-b border-ink">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-8 pt-6 pb-5">
          <div className="eyebrow mb-2">
            Testnet faucet · Robinhood Chain
          </div>
          <h1
            className="font-serif font-medium m-0"
            style={{
              fontSize: "clamp(22px, 4vw, 30px)",
              letterSpacing: "-0.025em",
              lineHeight: 1.05,
            }}
          >
            Get test tokens to <em>try EquiFlow</em>.
          </h1>
          <p
            className="text-ink-soft mt-2 max-w-[640px]"
            style={{ fontSize: 13, lineHeight: 1.55 }}
          >
            EquiFlow runs on Robinhood Chain testnet. You'll need three things:
            <strong className="text-ink"> ETH</strong> for gas,{" "}
            <strong className="text-ink">USDG</strong> if you want to act as an LP,
            and at least one <strong className="text-ink">Stock Token</strong> to
            pledge as collateral. All three are free and reset on every testnet
            redeploy.
          </p>
        </div>
      </section>

      {/* Wallet status banner */}
      <section className="border-b border-hairline-soft bg-paper-alt">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-8 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span
              className="rounded-full inline-block"
              style={{
                width: 8,
                height: 8,
                background: isConnected ? "var(--up)" : "var(--ink-mute)",
              }}
            />
            <span
              className="font-mono text-ink-soft"
              style={{ fontSize: 11, letterSpacing: "0.06em" }}
            >
              {isConnected
                ? `WALLET CONNECTED · ${shortAddr(address!)}`
                : "CONNECT WALLET TO MINT DIRECTLY"}
            </span>
          </div>
          {address && (
            <button
              type="button"
              onClick={() => {
                if (address) navigator.clipboard.writeText(address);
              }}
              className="font-mono text-ink-soft border border-hairline rounded-[2px] bg-transparent hover:border-ink hover:text-ink transition-colors"
              style={{ fontSize: 10, padding: "4px 10px" }}
            >
              Copy address
            </button>
          )}
        </div>
      </section>

      {/* Step 1: Native ETH */}
      <StepSection
        n="01"
        title="Get testnet ETH"
        subtitle="Required for gas — every on-chain action needs a small amount."
        accent="amber"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {NATIVE_FAUCETS.map((f) => (
            <a
              key={f.url}
              href={f.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block bg-paper border border-hairline rounded-[2px] hover:border-ink transition-colors no-underline text-ink"
              style={{ padding: "16px 18px" }}
            >
              <div className="flex items-baseline justify-between mb-1.5">
                <div
                  className="font-serif font-medium"
                  style={{ fontSize: 15, letterSpacing: "-0.015em" }}
                >
                  {f.name}
                </div>
                <span
                  className="font-mono text-ink-mute"
                  style={{ fontSize: 10 }}
                >
                  open ↗
                </span>
              </div>
              <p
                className="text-ink-soft m-0"
                style={{ fontSize: 12, lineHeight: 1.5 }}
              >
                {f.note}
              </p>
            </a>
          ))}
        </div>
        <Tip>
          Paste your wallet address into the faucet form. ETH usually arrives in
          under 30 seconds. The faucet has a 24h cooldown per address.
        </Tip>
      </StepSection>

      {/* Step 2: USDG */}
      <StepSection
        n="02"
        title="Mint test USDG"
        subtitle="Use USDG to provide liquidity (LP), repay debt, or trial the borrow flow."
        accent="brand"
      >
        {USDC_ADDRESS ? (
          <MintCard
            label="USDG · vault stablecoin"
            sym="USDG"
            address={USDC_ADDRESS}
            decimals={6}
            defaultAmount={1000}
            isConnected={isConnected}
            walletAddress={address}
          />
        ) : (
          <NotConfigured asset="USDG (NEXT_PUBLIC_USDC_ADDRESS)" />
        )}
      </StepSection>

      {/* Step 3: Stock Tokens */}
      <StepSection
        n="03"
        title="Mint Stock Tokens"
        subtitle="These are the collateral assets. Pick at least one — pledge it on /markets to start borrowing."
        accent="up"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {STOCKS.filter((s) => isLive(s.sym)).map((s) => {
            const addr = STOCK_TOKEN_ADDRESSES[s.sym];
            if (!addr) return null;
            return (
              <MintCard
                key={s.sym}
                label={`${s.sym} · ${s.name}`}
                sym={s.sym}
                address={addr}
                decimals={18}
                defaultAmount={10}
                isConnected={isConnected}
                walletAddress={address}
              />
            );
          })}
        </div>
        <Tip>
          Each Stock Token is an ERC-20 with public <code className="font-mono">mint(to, amount)</code>{" "}
          on the contract. You can mint any quantity — there's no rate limit on
          testnet stock faucets, only the native ETH faucet has one.
        </Tip>
      </StepSection>

      {/* Step 4: How to add to wallet */}
      <section className="border-b border-hairline">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-8 py-6">
          <div className="eyebrow mb-2" style={{ color: "var(--ink-mute)" }}>
            04 · Optional
          </div>
          <h2
            className="font-serif font-medium m-0 mb-1"
            style={{ fontSize: 18, letterSpacing: "-0.02em" }}
          >
            Add tokens to your wallet
          </h2>
          <p
            className="text-ink-soft m-0 mb-4"
            style={{ fontSize: 12, lineHeight: 1.55 }}
          >
            MetaMask and similar wallets don't auto-discover ERC-20 balances. To
            see your tokens in the wallet UI, click "Import token" in your wallet
            and paste the contract address below.
          </p>
          <div
            className="bg-paper-alt border border-hairline-soft rounded-[2px] overflow-hidden"
          >
            <div
              className="grid font-mono text-ink-mute uppercase border-b border-hairline-soft"
              style={{
                gridTemplateColumns: "1.4fr 1fr 90px",
                fontSize: 9,
                letterSpacing: "0.1em",
                padding: "8px 14px",
              }}
            >
              <div>Token</div>
              <div>Address</div>
              <div className="text-right">Decimals</div>
            </div>
            {USDC_ADDRESS && (
              <AddressRow
                sym="USDG"
                name="EquiFlow Stablecoin"
                address={USDC_ADDRESS}
                decimals={6}
              />
            )}
            {STOCKS.filter((s) => isLive(s.sym)).map((s) => {
              const addr = STOCK_TOKEN_ADDRESSES[s.sym];
              if (!addr) return null;
              return (
                <AddressRow
                  key={s.sym}
                  sym={s.sym}
                  name={s.name}
                  address={addr}
                  decimals={18}
                />
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-b border-hairline bg-paper-alt">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-8 py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <div className="eyebrow mb-1">Ready</div>
            <h3
              className="font-serif font-medium m-0"
              style={{ fontSize: 18, letterSpacing: "-0.02em" }}
            >
              Got your tokens? <em>Time to pledge.</em>
            </h3>
          </div>
          <div className="flex gap-2">
            <Link
              href="/markets"
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-ink text-paper rounded-[2px] no-underline font-medium"
              style={{ fontSize: 13 }}
            >
              Browse markets
              <span className="font-mono opacity-70" style={{ fontSize: 11 }}>→</span>
            </Link>
            <Link
              href="/portfolio"
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-paper text-ink border border-ink rounded-[2px] no-underline font-medium"
              style={{ fontSize: 13 }}
            >
              View portfolio
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}

/* ─── Step section wrapper ──────────────────────────────────────────── */
function StepSection({
  n,
  title,
  subtitle,
  accent,
  children,
}: {
  n: string;
  title: string;
  subtitle: string;
  accent: "amber" | "brand" | "up";
  children: React.ReactNode;
}) {
  const colorMap = {
    amber: "var(--amber)",
    brand: "var(--brand)",
    up: "var(--up)",
  };
  return (
    <section className="border-b border-hairline-soft">
      <div className="max-w-[1320px] mx-auto px-4 sm:px-8 py-6">
        <div className="flex items-baseline gap-3 mb-1">
          <span
            className="font-mono"
            style={{
              fontSize: 11,
              letterSpacing: "0.12em",
              color: colorMap[accent],
              fontWeight: 500,
            }}
          >
            {n}
          </span>
          <h2
            className="font-serif font-medium m-0"
            style={{ fontSize: 18, letterSpacing: "-0.02em" }}
          >
            {title}
          </h2>
        </div>
        <p
          className="text-ink-soft m-0 mb-4"
          style={{ fontSize: 12, lineHeight: 1.55 }}
        >
          {subtitle}
        </p>
        {children}
      </div>
    </section>
  );
}

/* ─── Tip box ──────────────────────────────────────────────────────── */
function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mt-4 px-4 py-2.5 bg-paper-alt border-l-2"
      style={{
        borderLeftColor: "var(--ink-mute)",
        fontSize: 11,
        lineHeight: 1.55,
        color: "var(--ink-soft)",
      }}
    >
      <span
        className="font-mono uppercase mr-2"
        style={{
          fontSize: 9,
          letterSpacing: "0.1em",
          color: "var(--ink-mute)",
        }}
      >
        Tip
      </span>
      {children}
    </div>
  );
}

/* ─── Address row ──────────────────────────────────────────────────── */
function AddressRow({
  sym,
  name,
  address,
  decimals,
}: {
  sym: string;
  name: string;
  address: Address;
  decimals: number;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      className="grid items-center border-b border-hairline-soft last:border-b-0"
      style={{
        gridTemplateColumns: "1.4fr 1fr 90px",
        padding: "10px 14px",
      }}
    >
      <div className="flex items-center gap-2.5">
        <div
          className="border border-hairline-soft bg-paper rounded-[2px] flex items-center justify-center shrink-0"
          style={{ width: 24, height: 24 }}
        >
          {sym !== "USDG" && <AssetLogo sym={sym} size={16} />}
          {sym === "USDG" && (
            <span
              className="font-mono font-semibold"
              style={{ fontSize: 9, color: "var(--brand)" }}
            >
              U
            </span>
          )}
        </div>
        <div>
          <div className="font-mono font-semibold" style={{ fontSize: 12 }}>
            {sym}
          </div>
          <div className="text-ink-mute" style={{ fontSize: 10 }}>
            {name}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 min-w-0">
        <a
          href={explorerAddr(address)}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-ink-soft no-underline hover:text-ink truncate"
          style={{ fontSize: 11 }}
        >
          {shortAddr(address, 8, 6)}
        </a>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(address);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="font-mono text-ink-mute hover:text-ink bg-transparent border-0 shrink-0"
          style={{ fontSize: 10, padding: "0 4px" }}
        >
          {copied ? "✓" : "copy"}
        </button>
      </div>
      <div
        className="font-mono text-ink-mute text-right tabular"
        style={{ fontSize: 11 }}
      >
        {decimals}
      </div>
    </div>
  );
}

/* ─── Mint card ──────────────────────────────────────────────────── */
function NotConfigured({ asset }: { asset: string }) {
  return (
    <div
      className="bg-amber-soft border border-amber rounded-[2px]"
      style={{ padding: "12px 16px", fontSize: 12 }}
    >
      <span
        className="font-mono text-ink-soft"
        style={{ fontSize: 10, letterSpacing: "0.06em" }}
      >
        NOT CONFIGURED ·{" "}
      </span>
      <span className="text-ink-soft">
        {asset} is not set in environment. Contact the operator to wire the
        token address.
      </span>
    </div>
  );
}

function MintCard({
  label,
  sym,
  address,
  decimals,
  defaultAmount,
  isConnected,
  walletAddress,
}: {
  label: string;
  sym: string;
  address: Address;
  decimals: number;
  defaultAmount: number;
  isConnected: boolean;
  walletAddress: Address | undefined;
}) {
  const [amount, setAmount] = useState<number>(defaultAmount);
  const { writeContract, data: txHash, isPending, reset } = useWriteContract();
  const { isLoading: mining, isSuccess: sealed } = useWaitForTransactionReceipt({
    hash: txHash,
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
  });

  const busy = isPending || mining;

  const handleMint = () => {
    if (!walletAddress) return;
    const raw = parseUnits(amount.toString(), decimals);
    writeContract({
      abi: ERC20_ABI,
      address,
      functionName: "mint",
      args: [walletAddress, raw],
      chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    });
  };

  return (
    <div
      className="bg-paper border border-hairline-soft rounded-[2px]"
      style={{ padding: "14px 16px" }}
    >
      <div className="flex items-center gap-3 mb-3">
        <div
          className="border border-hairline-soft bg-paper-alt rounded-[2px] flex items-center justify-center shrink-0"
          style={{ width: 32, height: 32 }}
        >
          {sym !== "USDG" && <AssetLogo sym={sym} size={22} />}
          {sym === "USDG" && (
            <span
              className="font-serif font-medium"
              style={{ fontSize: 14, color: "var(--brand)" }}
            >
              U
            </span>
          )}
        </div>
        <div>
          <div
            className="font-serif font-medium"
            style={{ fontSize: 14, letterSpacing: "-0.015em" }}
          >
            {label}
          </div>
          <a
            href={explorerAddr(address)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-ink-mute no-underline hover:text-ink"
            style={{ fontSize: 10 }}
          >
            {shortAddr(address)} ↗
          </a>
        </div>
      </div>

      <div className="flex gap-2 items-center mb-2">
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
          disabled={busy}
          className="bg-paper-alt border border-hairline rounded-[2px] flex-1 outline-none font-mono tabular text-ink min-w-0"
          style={{ fontSize: 13, padding: "7px 10px" }}
        />
        <span
          className="font-mono text-ink-mute shrink-0"
          style={{ fontSize: 11 }}
        >
          {sym}
        </span>
      </div>

      <button
        type="button"
        disabled={!isConnected || busy || amount <= 0}
        onClick={handleMint}
        className="w-full font-medium rounded-[2px] transition-colors"
        style={{
          padding: "8px 12px",
          fontSize: 12,
          background: sealed ? "var(--up)" : "var(--ink)",
          color: "var(--paper)",
          border: "none",
          opacity: !isConnected || busy || amount <= 0 ? 0.5 : 1,
          cursor: !isConnected || busy || amount <= 0 ? "not-allowed" : "pointer",
        }}
      >
        {!isConnected
          ? "Connect wallet to mint"
          : sealed
            ? "✓ Minted"
            : busy
              ? "Minting…"
              : `Mint ${amount} ${sym}`}
      </button>

      {sealed && txHash && (
        <a
          href={`https://explorer.testnet.chain.robinhood.com/tx/${txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-ink-mute no-underline hover:text-ink mt-2 block text-center"
          style={{ fontSize: 10 }}
        >
          View tx: {shortAddr(txHash, 8, 6)} ↗
        </a>
      )}
      {sealed && (
        <button
          type="button"
          onClick={reset}
          className="font-mono text-ink-mute hover:text-ink bg-transparent border-0 w-full mt-1"
          style={{ fontSize: 10, padding: 0 }}
        >
          Mint another batch
        </button>
      )}
    </div>
  );
}
