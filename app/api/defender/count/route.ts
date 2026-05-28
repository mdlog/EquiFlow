import { NextResponse } from "next/server";
import { countActive } from "@/lib/web3/defender-store";
import { withErrorHandler } from "@/lib/api/handler";
import { requireRateLimit } from "@/lib/api/security";

/// GET /api/defender/count → { count: number }
export const GET = withErrorHandler(async (req: Request) => {
  await requireRateLimit(req, { bucket: "defender-count", max: 60, windowSeconds: 60 });
  const count = await countActive();
  return NextResponse.json(
    { count },
    { headers: { "Cache-Control": "public, max-age=30, s-maxage=30" } },
  );
});
