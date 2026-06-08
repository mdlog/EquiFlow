"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useBalance, useReadContract } from "wagmi";
import { formatUnits, type Address } from "viem";
import { FAUCET_URL, ROBINHOOD_CHAIN_TESTNET_ID } from "@/lib/config/chain";
import { explorerAddr, ERC20_ABI } from "@/lib/contracts";
import { useSmartWallet, type AAMode } from "@/lib/aa/use-smart-wallet";
import { shortAddr } from "@/lib/contracts";
import { useVaultContext } from "@/lib/hooks/use-vault-context";
import { EmptySmartWalletButton } from "@/components/EmptySmartWalletButton";

/// wagmi 3.x's `useBalance` returns `{ value, decimals, symbol }` — it dropped
/// the `formatted` field that RainbowKit 2.x relies on for its
/// `account.displayBalance` string. Without a formatter, RainbowKit prints
/// "NaN ETH". We bypass that by reading the balance directly and formatting
/// it ourselves.
function useDisplayBalance(address: Address | undefined): string | null {
  const { data } = useBalance({
    address,
    query: { enabled: !!address, refetchInterval: 30_000 },
  });
  return useMemo(() => {
    if (!data) return null;
    const raw = formatUnits(data.value, data.decimals);
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n)) return null;
    /// Mirror RainbowKit's "< 1 → 3dp, < 100 → 2dp, else 1dp" cadence so the
    /// reading stays readable even when the balance grows large.
    const dp = n < 1 ? 4 : n < 100 ? 2 : 1;
    return `${n.toFixed(dp)} ${data.symbol}`;
  }, [data]);
}

/// USDG (the vault's borrowable ERC-20) balance for `address`. The native
/// `useBalance` above answers "can I pay gas?"; this answers "did my borrow
/// land?". Without this the navbar only ever showed the native coin, so a
/// successful borrow never changed the displayed number.
function useUsdgBalance(address: Address | undefined): string | null {
  const { vault } = useVaultContext();
  const token = vault.tokenAddress;
  const { data: balRaw } = useReadContract({
    abi: ERC20_ABI,
    address: token,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { enabled: !!address && !!token, refetchInterval: 30_000 },
  });
  const { data: decRaw } = useReadContract({
    abi: ERC20_ABI,
    address: token,
    functionName: "decimals",
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { enabled: !!token, staleTime: Infinity },
  });
  return useMemo(() => {
    if (balRaw == null) return null;
    const dec = typeof decRaw === "number" ? decRaw : vault.tokenDecimals;
    const n = Number.parseFloat(formatUnits(balRaw as bigint, dec));
    if (!Number.isFinite(n)) return null;
    const dp = n < 1 ? 4 : n < 100 ? 2 : 1;
    return `${n.toFixed(dp)} ${vault.borrowSymbol}`;
  }, [balRaw, decRaw, vault.tokenDecimals, vault.borrowSymbol]);
}

export function WalletButton() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const { mode, smartAddress, isConfigured, isLoading, setMode } =
    useSmartWallet();

  useEffect(() => {
    function close(e: MouseEvent) {
      if (wrap.current && !wrap.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        openAccountModal,
        openChainModal,
        openConnectModal,
        authenticationStatus,
        mounted,
      }) => {
        const ready = mounted && authenticationStatus !== "loading";
        const connected =
          ready &&
          account &&
          chain &&
          (!authenticationStatus || authenticationStatus === "authenticated");

        if (!ready) {
          return (
            <button
              type="button"
              aria-hidden
              className="bg-ink/30 text-paper rounded-[2px] px-3.5 py-[7px] font-medium"
              style={{ fontSize: 12, opacity: 0, pointerEvents: "none" }}
            >
              Connect wallet
            </button>
          );
        }

        if (!connected) {
          return (
            <button
              type="button"
              onClick={openConnectModal}
              className="bg-ink text-paper rounded-[2px] px-3.5 py-[7px] font-medium"
              style={{ fontSize: 12 }}
            >
              Connect wallet
            </button>
          );
        }

        if (chain.unsupported) {
          return (
            <button
              type="button"
              onClick={openChainModal}
              className="bg-amber-soft border border-amber text-ink rounded-[2px] px-3 py-[7px] font-medium"
              style={{ fontSize: 12 }}
            >
              Switch to Robinhood Chain
            </button>
          );
        }

        const aaActive = mode !== "off" && smartAddress != null;
        const displayLabel =
          aaActive && smartAddress
            ? shortAddr(smartAddress)
            : account.displayName;
        /// Read balance for whichever address is "active" — the AA address
        /// when AA mode is on, otherwise the EOA. account.displayBalance from
        /// RainbowKit is unusable because of the wagmi 3.x mismatch.
        const balanceAddress =
          aaActive && smartAddress
            ? smartAddress
            : (account.address as Address);

        return (
          <WalletButtonInner
            account={account}
            chain={chain}
            balanceAddress={balanceAddress}
            displayLabel={displayLabel}
            aaActive={aaActive}
            mode={mode}
            smartAddress={smartAddress}
            isConfigured={isConfigured}
            isLoading={isLoading}
            setMode={setMode}
            open={open}
            setOpen={setOpen}
            wrap={wrap}
            openAccountModal={openAccountModal}
            openChainModal={openChainModal}
          />
        );
      }}
    </ConnectButton.Custom>
  );
}

interface WalletButtonInnerProps {
  account: {
    address: string;
    displayName: string;
  };
  chain: { name?: string; id: number };
  balanceAddress: Address;
  displayLabel: string;
  aaActive: boolean;
  mode: AAMode;
  smartAddress: Address | null;
  isConfigured: boolean;
  isLoading: boolean;
  setMode: (m: AAMode) => void;
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  wrap: React.RefObject<HTMLDivElement | null>;
  openAccountModal: () => void;
  openChainModal: () => void;
}

/// Inner component so we can call `useBalance` (a hook) — render-props from
/// RainbowKit don't allow hooks inside the callback body.
function WalletButtonInner({
  account,
  chain,
  balanceAddress,
  displayLabel,
  aaActive,
  mode,
  smartAddress,
  isConfigured,
  isLoading,
  setMode,
  open,
  setOpen,
  wrap,
  openAccountModal,
  openChainModal,
}: WalletButtonInnerProps) {
  const displayBalance = useDisplayBalance(balanceAddress);
  const usdgBalance = useUsdgBalance(balanceAddress);

  return (
    <div className="relative" ref={wrap}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2.5 bg-ink text-paper rounded-[2px] px-3 py-[7px]"
        style={{ fontSize: 12 }}
      >
        {aaActive && (
          <span
            className="rounded-[2px] px-1.5 py-[1px] font-mono"
            style={{
              fontSize: 9,
              background: "#C8A47D55",
              color: "#FAF7F0",
              letterSpacing: "0.04em",
            }}
          >
            AA
          </span>
        )}
        <span className="font-mono">{displayLabel}</span>
        {(usdgBalance ?? displayBalance) && (
          <>
            <span className="w-px h-3 bg-white/20" />
            <span className="font-mono tabular">
              {usdgBalance ?? displayBalance}
            </span>
          </>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-1.5 w-[300px] bg-paper border border-ink rounded-[2px] shadow-[0_12px_28px_rgba(20,18,14,0.12)] z-50">
          <div className="px-3 pt-3 pb-2 border-b border-hairline-soft">
            <div className="eyebrow mb-1" style={{ fontSize: 9 }}>
              Connected · {chain.name ?? `Chain ${chain.id}`}
            </div>
            <div
              className="font-mono break-all"
              style={{ fontSize: 11, lineHeight: 1.45 }}
            >
              {aaActive && smartAddress ? smartAddress : account.address}
            </div>
            {aaActive && smartAddress && (
              <div
                className="font-mono opacity-50 mt-0.5"
                style={{ fontSize: 9.5 }}
              >
                EOA owner · {shortAddr(account.address as `0x${string}`)}
              </div>
            )}
            {(usdgBalance || displayBalance) && (
              <div className="mt-2">
                {usdgBalance && (
                  <div
                    className="font-serif tabular font-medium"
                    style={{ fontSize: 18, letterSpacing: "-0.02em" }}
                  >
                    {usdgBalance}
                  </div>
                )}
                {displayBalance && (
                  <div
                    className="font-mono text-ink-mute mt-0.5"
                    style={{ fontSize: 10 }}
                  >
                    {usdgBalance ? `${displayBalance} · gas` : displayBalance}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Smart Wallet section ── */}
          <div className="px-3 pt-2.5 pb-1 border-b border-hairline-soft">
            <div
              className="eyebrow flex items-center justify-between"
              style={{ fontSize: 9 }}
            >
              <span>Account abstraction</span>
              {!isConfigured && (
                <span
                  className="text-amber"
                  style={{ fontSize: 9, fontWeight: 500 }}
                >
                  ⚠ key missing
                </span>
              )}
            </div>
            <ModePicker
              current={mode}
              onPick={(next) => setMode(next)}
              isLoading={isLoading}
            />
            {mode === "factory" && (
              <p
                className="opacity-60 mt-1.5 leading-snug"
                style={{ fontSize: 10 }}
              >
                New smart-wallet address with sponsored gas. To pledge tokens
                you currently hold at your EOA, send them to the smart-wallet
                address shown above first (one-time L1 tx, costs a small ETH
                gas fee).
              </p>
            )}
          </div>

          {/* Re-mount on mode change so internal state + wagmi subscriptions
              reset cleanly. Combined with queryClient.invalidateQueries() in
              useSmartWallet.setMode, balances always reflect the new active
              address instead of bleeding through from the previous mode. */}
          <EmptySmartWalletButton key={mode} />

          <div className="p-1">
            <button
              type="button"
              onClick={() => {
                openAccountModal();
                setOpen(false);
              }}
              className="w-full text-left px-2.5 py-2 rounded-[2px] hover:bg-paper-alt"
              style={{ fontSize: 12 }}
            >
              Account details
            </button>
            <button
              type="button"
              onClick={() => {
                openChainModal();
                setOpen(false);
              }}
              className="w-full text-left px-2.5 py-2 rounded-[2px] hover:bg-paper-alt"
              style={{ fontSize: 12 }}
            >
              Switch network
            </button>
            <a
              href={
                aaActive && smartAddress
                  ? explorerAddr(smartAddress)
                  : account.address
                    ? explorerAddr(account.address as Address)
                    : "#"
              }
              target="_blank"
              rel="noopener noreferrer"
              className="block px-2.5 py-2 rounded-[2px] hover:bg-paper-alt no-underline text-ink"
              style={{ fontSize: 12 }}
            >
              View on explorer ↗
            </a>
            <a
              href={FAUCET_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="block px-2.5 py-2 rounded-[2px] hover:bg-paper-alt no-underline text-ink"
              style={{ fontSize: 12 }}
            >
              Open testnet faucet ↗
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

interface ModePickerProps {
  current: AAMode;
  onPick: (next: AAMode) => void;
  isLoading: boolean;
}

function ModePicker({ current, onPick, isLoading }: ModePickerProps) {
  // EIP-7702 mode is intentionally hidden: per Alchemy docs and our own
  // testing, no major browser wallet (MetaMask, Rabby, Coinbase) currently
  // supports sponsored 7702 delegation to third-party contracts. The lib/aa
  // code paths remain in place for a future embedded-signer integration
  // (Privy / Magic / Turnkey).
  const options: Array<{ id: AAMode; label: string; sub: string }> = [
    { id: "off", label: "EOA only", sub: "Classic flow" },
    { id: "factory", label: "Smart wallet", sub: "Sponsored gas" },
  ];

  return (
    <div className="mt-2 grid grid-cols-2 gap-1">
      {options.map((opt) => {
        const active = current === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            disabled={isLoading}
            onClick={() => onPick(opt.id)}
            className="flex flex-col items-start text-left px-2 py-1.5 rounded-[2px] border transition-colors"
            style={{
              fontSize: 10,
              borderColor: active ? "#141210" : "rgba(20,18,14,0.12)",
              background: active ? "#141210" : "transparent",
              color: active ? "#FAF7F0" : "#141210",
              opacity: isLoading ? 0.5 : 1,
              cursor: isLoading ? "wait" : "pointer",
            }}
          >
            <span style={{ fontWeight: 500 }}>{opt.label}</span>
            <span
              style={{
                fontSize: 9,
                opacity: active ? 0.7 : 0.5,
                marginTop: 1,
              }}
            >
              {opt.sub}
            </span>
          </button>
        );
      })}
    </div>
  );
}
