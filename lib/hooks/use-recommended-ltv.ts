"use client";

import { useMemo } from "react";
import { findStock } from "@/lib/config/stocks";
import {
  computeRecommendedLtvBps,
  DEFAULT_LTV_CONFIG,
  type LtvRecommendation,
} from "@/lib/risk/ltv-model";

export function useRecommendedLtv(sym: string): LtvRecommendation {
  const stock = findStock(sym);
  return useMemo(
    () => computeRecommendedLtvBps(stock.volatility, DEFAULT_LTV_CONFIG),
    [stock.volatility],
  );
}
