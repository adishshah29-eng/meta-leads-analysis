/**
 * POST|GET /api/reports/weekly
 *
 * Computes a week-over-week report from daily_ad_snapshots,
 * optionally calls Claude for a narrative, and upserts into weekly_reports.
 *
 * Query params:
 *   ?week_start=YYYY-MM-DD  (Monday of the week to compute; default: last completed week, IST)
 *   ?project=<name>|all     (one project, or "all" for the Portfolio report)
 *   If `project` is omitted (e.g. the Vercel cron), the Portfolio report AND a
 *   report for every configured project are computed.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabase, fetchAllRows } from "@/lib/supabase";
import { computeWeeklySummary, rowToSnapshot } from "@/lib/compute";
import { addDays, lastCompletedWeek } from "@/lib/dates";
import { generateWeeklyNarrative } from "@/lib/claude";
import { getAdAccounts } from "@/lib/syncAds";
import { trackRun, triggerOf } from "@/lib/syncRuns";

export const maxDuration = 300;

const PORTFOLIO = "Portfolio";

function loadWeek(start: string, end: string, projectName: string) {
  return fetchAllRows<Record<string, unknown>>(() => {
    let q = supabase
      .from("daily_ad_snapshots")
      .select("*")
      .gte("snapshot_date", start)
      .lte("snapshot_date", end);
    if (projectName !== PORTFOLIO) q = q.eq("project_name", projectName);
    return q.order("snapshot_date", { ascending: true }).order("id", { ascending: true }) as never;
  });
}

async function computeAndStore(projectName: string, weekStart: string, weekEnd: string) {
  const [thisWeekRows, prevWeekRows] = await Promise.all([
    loadWeek(weekStart, weekEnd, projectName),
    loadWeek(addDays(weekStart, -7), addDays(weekStart, -1), projectName),
  ]);

  const summary = computeWeeklySummary(
    thisWeekRows.map(rowToSnapshot),
    prevWeekRows.map(rowToSnapshot),
    weekStart,
    weekEnd
  );

  // Skip the (paid) AI call for projects with no activity this week
  const aiSummary =
    summary.totalSpend > 0
      ? await generateWeeklyNarrative({
          weekStart,
          weekEnd,
          totalSpend: summary.totalSpend,
          totalResults: summary.totalResults,
          avgCTR: summary.avgCTR,
          avgCPA: summary.avgCPA,
          spendChangePct: summary.spendChangePct,
          cpaChangePct: summary.cpaChangePct,
          resultsChangePct: summary.resultsChangePct,
          topAds: summary.topAds.map((a) => ({
            ad_name: a.ad_name,
            results: a.results,
            cost_per_result: a.cost_per_result,
          })),
          bottomAds: summary.bottomAds.map((a) => ({
            ad_name: a.ad_name,
            spend: a.spend,
            results: a.results,
          })),
        })
      : null;

  const { error } = await supabase.from("weekly_reports").upsert(
    {
      week_start: weekStart,
      week_end: weekEnd,
      project_name: projectName,
      total_spend: summary.totalSpend,
      total_results: summary.totalResults,
      avg_ctr: summary.avgCTR,
      avg_cpa: summary.avgCPA,
      spend_change_pct: summary.spendChangePct,
      cpa_change_pct: summary.cpaChangePct,
      results_change_pct: summary.resultsChangePct,
      top_ads: summary.topAds,
      bottom_ads: summary.bottomAds,
      campaigns: summary.campaigns,
      ai_summary: aiSummary,
    },
    { onConflict: "week_start,project_name" }
  );
  if (error) throw new Error(`weekly_reports upsert (${projectName}): ${error.message}`);

  return { summary, aiSummary };
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const providedStart = searchParams.get("week_start");
  const project = searchParams.get("project");

  const { weekStart, weekEnd } = providedStart
    ? { weekStart: providedStart, weekEnd: addDays(providedStart, 6) }
    : lastCompletedWeek();

  try {
    if (project !== null) {
      const projectName = project && project !== "all" ? project : PORTFOLIO;
      const { summary, aiSummary } = await computeAndStore(projectName, weekStart, weekEnd);
      return NextResponse.json({ success: true, weekStart, weekEnd, summary, aiSummary });
    }

    // Cron / batch mode: Portfolio + every configured project
    const results: Array<{ project: string; ok: boolean; error?: string }> = [];
    const outcome = await trackRun("weekly", triggerOf(req), async () => {
      const names = [PORTFOLIO, ...getAdAccounts().map((a) => a.name)];
      for (const name of names) {
        try {
          await computeAndStore(name, weekStart, weekEnd);
          results.push({ project: name, ok: true });
        } catch (err) {
          results.push({ project: name, ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      }
      const failed = results.filter((r) => !r.ok);
      return {
        status: failed.length === 0 ? "ok" : failed.length === results.length ? "failed" : "partial",
        rows: results.length - failed.length,
        message:
          `Weekly reports for ${weekStart} → ${weekEnd}: ${results.length - failed.length}/${results.length} built.` +
          (failed.length ? ` Failed: ${failed.map((f) => `${f.project} (${f.error})`).join("; ")}` : ""),
        details: { weekStart, weekEnd, results },
      };
    });
    return NextResponse.json(
      { success: outcome.status === "ok", weekStart, weekEnd, results, message: outcome.message },
      { status: outcome.status === "ok" ? 200 : 500 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[weekly-report] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
