/**
 * GET /api/cron/sync-leads
 *
 * Syncs recent lead-form leads from Meta into the `leads` table.
 * Query params: ?days=N  how far back to look (default 7, max 90 — Meta only
 * keeps leads retrievable for 90 days). Use ?days=90 once to backfill.
 */

import { NextRequest, NextResponse } from "next/server";
import { syncLeads, type LeadSyncResult } from "@/lib/syncLeads";
import { trackRun, triggerOf } from "@/lib/syncRuns";

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const days = Math.min(Math.max(parseInt(new URL(req.url).searchParams.get("days") ?? "7", 10) || 7, 1), 90);

  let r: LeadSyncResult | null = null;
  const outcome = await trackRun("leads", triggerOf(req), async () => {
    r = await syncLeads(days);
    const failed = r.errors.length;
    return {
      status: failed === 0 ? "ok" : failed >= r.adsChecked ? "failed" : "partial",
      rows: r.totalSynced,
      message:
        `Synced ${r.totalSynced} leads from ${r.adsChecked} ads (${r.newLeadsCount} new).` +
        (failed ? ` ${failed} ad(s) failed, e.g. ${r.errors[0].error}` : ""),
      details: { days, ...r, errors: r.errors.slice(0, 20) },
    };
  });

  const result = r as LeadSyncResult | null;
  return NextResponse.json(
    {
      success: outcome.status === "ok",
      ...(result ?? {}),
      upserted: result?.totalSynced ?? 0,
      message: outcome.message,
      error: outcome.status === "failed" ? outcome.message : undefined,
    },
    { status: outcome.status === "failed" ? 500 : 200 }
  );
}

export async function POST(req: NextRequest) {
  return GET(req);
}
