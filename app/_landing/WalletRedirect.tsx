"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useConnectionEffect } from "wagmi";

/// Sends a visitor into the app the moment they connect on the landing page.
/// Uses wagmi's connection effect instead of a manual isConnected ref: with
/// `ssr: true` + reconnect-on-mount, isConnected is always false on first
/// render and flips true asynchronously when a stored session is restored —
/// a ref-based guard reads that restore as a fresh connect and bounces every
/// returning visitor off the landing page. `isReconnected` distinguishes the
/// two: only genuinely new connections trigger the redirect.
export function WalletRedirect() {
  const router = useRouter();

  const onConnect = useCallback(
    ({ isReconnected }: { isReconnected: boolean }) => {
      if (!isReconnected) router.push("/markets");
    },
    [router],
  );

  useConnectionEffect({ onConnect });

  return null;
}
