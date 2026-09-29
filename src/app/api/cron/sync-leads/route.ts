/**
 * GET /api/cron/sync-leads
 *
 * Syncs recent lead-form leads from Meta into the `leads` table.
 * Query params: ?days=N  how far back to look (default 7, max 90 — Meta only
 * keeps leads retrievable for 90 days). Use ?days=90 once to backfill.
 */

import { NextRequest, NextResponse } from "next/server";
import { syncLeads } from "@/lib/syncLeads";

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const days = Math.min(Math.max(parseInt(new URL(req.url).searchParams.get("days") ?? "7", 10) || 7, 1), 90);

  try {
    const r = await syncLeads(days);
    const message =
      `Synced ${r.totalSynced} leads from ${r.adsChecked} ads (${r.newLeadsCount} new).` +
      (r.errors.length ? ` ${r.errors.length} ad(s) failed.` : "");
    return NextResponse.json({ success: r.errors.length === 0, ...r, message, upserted: r.totalSynced });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/sync-leads] Error:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
