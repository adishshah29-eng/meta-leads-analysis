/**
 * GET /api/ads/summary
 *
 * Returns computed summary for a date range (default: today, IST).
 * Reads from Supabase — never calls Meta directly.
 *
 * Query params:
 *   ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD  (or legacy ?date=)
 *   ?project=<name>|all
 *   ?days=14   number of days in the trend chart, ending at endDate
 */

import { NextRequest, NextResponse } from "next/server";
import { supabase, fetchAllRows } from "@/lib/supabase";
import { computeDailySummary, aggregateSnapshots, rowToSnapshot } from "@/lib/compute";
import { addDays, daysBetweenInclusive, todayInAppTz } from "@/lib/dates";

type Row = Record<string, unknown>;

function loadSnapshots(start: string, end: string, project: string | null, columns = "*") {
  return fetchAllRows<Row>(() => {
    let q = supabase
      .from("daily_ad_snapshots")
      .select(columns)
      .gte("snapshot_date", start)
      .lte("snapshot_date", end);
    if (project && project !== "all") q = q.eq("project_name", project);
    // Deterministic order so pages never overlap or skip rows
    return q.order("snapshot_date", { ascending: true }).order("id", { ascending: true }) as never;
  });
}

interface PortfolioAcc {
  project_name: string;
  account_name: string;
  spend: number;
  results: number;
  impressions: number;
  clicks: number;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const today = todayInAppTz();
  const date = searchParams.get("date"); // Legacy param
  const startDate = searchParams.get("startDate") ?? date ?? today;
  const endDate = searchParams.get("endDate") ?? date ?? today;
  const trendDays = Math.max(parseInt(searchParams.get("days") ?? "14", 10) || 14, 1);
  const project = searchParams.get("project");

  try {
    const diffDays = daysBetweenInclusive(startDate, endDate);
    const priorEnd = addDays(startDate, -1);
    const priorStart = addDays(priorEnd, -(diffDays - 1));
    const trendStart = addDays(endDate, -(trendDays - 1));

    const [currentRows, priorRows, trendRows] = await Promise.all([
      loadSnapshots(startDate, endDate, project),
      loadSnapshots(priorStart, priorEnd, project),
      loadSnapshots(trendStart, endDate, project, "id, snapshot_date, spend, results, impressions, clicks"),
    ]);

    const snapshots = currentRows.map(rowToSnapshot);

    // Portfolio breakdown (one row per project) when viewing "all"
    let portfolio: Array<PortfolioAcc & { cost_per_result: number; ctr: number }> = [];
    if (!project || project === "all") {
      const pMap = new Map<string, PortfolioAcc>();
      for (const row of currentRows) {
        const p = String(row.project_name);
        const existing = pMap.get(p) ?? {
          project_name: p,
          account_name: String(row.account_name ?? p),
          spend: 0,
          results: 0,
          impressions: 0,
          clicks: 0,
        };
        // Rows are ordered by date, so the latest account name wins
        if (row.account_name) existing.account_name = String(row.account_name);
        existing.spend += Number(row.spend) || 0;
        existing.results += Number(row.results) || 0;
        existing.impressions += Number(row.impressions) || 0;
        existing.clicks += Number(row.clicks) || 0;
        pMap.set(p, existing);
      }
      portfolio = Array.from(pMap.values())
        .map((p) => ({
          ...p,
          cost_per_result: p.results > 0 ? p.spend / p.results : 0,
          ctr: p.impressions > 0 ? (p.clicks / p.impressions) * 100 : 0,
        }))
        .sort((a, b) => b.spend - a.spend);
    }

    const summary = computeDailySummary(
      aggregateSnapshots(snapshots),
      `${startDate} to ${endDate}`,
      aggregateSnapshots(priorRows.map(rowToSnapshot))
    );

    // Trend: totals per day
    const trendMap = new Map<string, { spend: number; results: number; impressions: number; clicks: number }>();
    for (const row of trendRows) {
      const d = String(row.snapshot_date);
      const existing = trendMap.get(d) ?? { spend: 0, results: 0, impressions: 0, clicks: 0 };
      existing.spend += Number(row.spend) || 0;
      existing.results += Number(row.results) || 0;
      existing.impressions += Number(row.impressions) || 0;
      existing.clicks += Number(row.clicks) || 0;
      trendMap.set(d, existing);
    }

    const trend = Array.from(trendMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([d, v]) => ({
        date: d,
        spend: Math.round(v.spend),
        results: v.results,
        ctr: v.impressions > 0 ? ((v.clicks / v.impressions) * 100).toFixed(2) : "0",
      }));

    return NextResponse.json({ summary, trend, portfolio });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[summary] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
