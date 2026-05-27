"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";

export function WalletRedirect() {
  const { isConnected } = useAccount();
  const router = useRouter();
  const wasConnected = useRef(isConnected);

  useEffect(() => {
    if (!wasConnected.current && isConnected) {
      router.push("/markets");
    }
    wasConnected.current = isConnected;
  }, [isConnected, router]);

  return null;
}
