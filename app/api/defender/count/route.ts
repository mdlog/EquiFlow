import { NextResponse } from "next/server";
import { countActive } from "@/lib/web3/defender-store";

/// GET /api/defender/count → { count: number }
/// Exposed so the landing page can render "Auto-defenders active: N".
export async function GET() {
  const count = await countActive();
  return NextResponse.json({ count });
}
