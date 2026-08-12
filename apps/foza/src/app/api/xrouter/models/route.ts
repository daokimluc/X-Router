import { NextResponse } from "next/server";
import { xrouter } from "@/lib/xrouter/adapter";

export async function GET() {
  try {
    const models = await xrouter.listModels();
    return NextResponse.json({ data: models });
  } catch (err) {
    console.error("[/api/xrouter/models] error:", err);
    return NextResponse.json(
      { error: String((err as Error)?.message ?? err) },
      { status: 500 },
    );
  }
}
