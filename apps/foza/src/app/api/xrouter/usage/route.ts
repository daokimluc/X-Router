import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/xrouter/admin";
import { ledger } from "@/lib/xrouter/ledger";

/**
 * Platform-wide usage totals (spend + margin). ADMIN ONLY — `totalMargin` is the
 * platform's revenue and must not be exposed publicly. The proxy matcher skips
 * /api, so the gate lives here.
 */
export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const s = ledger.summary();
  return NextResponse.json({
    totalRequests: s.totalRequests,
    totalSpend: `$${s.totalSpendUsd.toFixed(2)}`,
    totalMargin: `$${s.totalMarginUsd.toFixed(2)}`,
  });
}
