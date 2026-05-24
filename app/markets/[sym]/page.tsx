import { notFound } from "next/navigation";
import { STOCKS } from "@/lib/config/stocks";
import { AssetDetailClient } from "./AssetDetailClient";

/// Asset detail route. Symbol is uppercased and validated against the STOCKS
/// catalogue server-side so deep links like /markets/foo render a real 404
/// instead of an empty client-side fallback.
interface Params {
  params: Promise<{ sym: string }>;
}

export async function generateMetadata({ params }: Params) {
  const { sym } = await params;
  const upper = sym.toUpperCase();
  const stock = STOCKS.find((s) => s.sym === upper);
  if (!stock) return { title: "Asset not found · EquiFlow" };
  return {
    title: `${stock.sym} · ${stock.name} · EquiFlow`,
    description: `Live price, risk parameters, and pledge calculator for ${stock.name} on EquiFlow.`,
  };
}

export default async function AssetDetailPage({ params }: Params) {
  const { sym } = await params;
  const upper = sym.toUpperCase();
  const stock = STOCKS.find((s) => s.sym === upper);
  if (!stock) notFound();
  return <AssetDetailClient sym={upper} />;
}
