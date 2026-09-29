/**
 * GET /api/reconcile?since=YYYY-MM-DD&until=YYYY-MM-DD
 *
 * Compares, per ad account and day, Meta's own account-level totals (which
 * include every ad — the numbers Ads Manager shows) against the sum of the
 * ad-level rows stored in daily_ad_snapshots. Any gap means rows are missing
 * or stale and that day should be re-synced.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabase, fetchAllRows } from "@/lib/supabase";
import { fetchAccountDailyTotals } from "@/lib/meta";
import { getAdAccounts } from "@/lib/syncAds";
import { addDays, daysBetweenInclusive, todayInAppTz } from "@/lib/dates";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 31;

/** Spend differences below this are rounding noise (paisa-level per ad). */
const spendTolerance = (metaSpend: number) => Math.max(1, metaSpend * 0.005);

export type ReconcileStatus = "match" | "mismatch" | "missing" | "live";

export interface ReconcileDay {
  date: string;
  metaSpend: number;
  dbSpend: number;
  metaResults: number;
  dbResults: number;
  metaImpressions: number;
  dbImpressions: number;
  status: ReconcileStatus;
}

export interface ReconcileAccount {
  project: string;
  accountId: string;
  error?: string;
  totals: { metaSpend: number; dbSpend: number; metaResults: number; dbResults: number };
  mismatchedDays: number;
  days: ReconcileDay[];
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const today = todayInAppTz();
  const until = searchParams.get("until") ?? today;
  const since = searchParams.get("since") ?? addDays(until, -6);

  if (!DAY_RE.test(since) || !DAY_RE.test(until) || since > until) {
    return NextResponse.json({ error: "Invalid date range." }, { status: 400 });
  }
  if (daysBetweenInclusive(since, until) > MAX_DAYS) {
    return NextResponse.json({ error: `Range too large; max ${MAX_DAYS} days.` }, { status: 400 });
  }

  try {
    // Stored rows, summed per account + day
    const rows = await fetchAllRows<{ id: string; snapshot_date: string; account_id: string; spend: number; results: number; impressions: number }>(() =>
      supabase
        .from("daily_ad_snapshots")
        .select("id, snapshot_date, account_id, spend, results, impressions")
        .gte("snapshot_date", since)
        .lte("snapshot_date", until)
        .order("id", { ascending: true }) as never
    );
    const db = new Map<string, { spend: number; results: number; impressions: number }>();
    for (const r of rows) {
      const key = `${String(r.account_id).replace(/^act_/, "")}|${r.snapshot_date}`;
      const cur = db.get(key) ?? { spend: 0, results: 0, impressions: 0 };
      cur.spend += Number(r.spend) || 0;
      cur.results += Number(r.results) || 0;
      cur.impressions += Number(r.impressions) || 0;
      db.set(key, cur);
    }

    const accounts: ReconcileAccount[] = await Promise.all(
      getAdAccounts().map(async (acc): Promise<ReconcileAccount> => {
        const accountId = acc.id.replace(/^act_/, "");
        const base: ReconcileAccount = {
          project: acc.name,
          accountId,
          totals: { metaSpend: 0, dbSpend: 0, metaResults: 0, dbResults: 0 },
          mismatchedDays: 0,
          days: [],
        };

        let meta;
        try {
          meta = await fetchAccountDailyTotals(since, until, acc.id);
        } catch (err) {
          return { ...base, error: err instanceof Error ? err.message : String(err) };
        }
        const metaByDay = new Map(meta.map((m) => [m.date, m]));

        for (let d = since; d <= until; d = addDays(d, 1)) {
          const m = metaByDay.get(d);
          const s = db.get(`${accountId}|${d}`);
          const metaSpend = m?.spend ?? 0;
          const dbSpend = s?.spend ?? 0;
          const metaResults = m?.results ?? 0;
          const dbResults = s?.results ?? 0;
          if (!m && !s) continue; // no delivery that day

          let status: ReconcileStatus = "match";
          if (d === today) status = "live"; // today is still accumulating
          else if (!s && metaSpend > 0) status = "missing";
          else if (Math.abs(metaSpend - dbSpend) > spendTolerance(metaSpend) || metaResults !== dbResults) status = "mismatch";

          if (status === "missing" || status === "mismatch") base.mismatchedDays++;
          base.totals.metaSpend += metaSpend;
          base.totals.dbSpend += dbSpend;
          base.totals.metaResults += metaResults;
          base.totals.dbResults += dbResults;
          base.days.push({
            date: d,
            metaSpend,
            dbSpend,
            metaResults,
            dbResults,
            metaImpressions: m?.impressions ?? 0,
            dbImpressions: s?.impressions ?? 0,
            status,
          });
        }
        base.days.reverse(); // newest first
        return base;
      })
    );

    return NextResponse.json({ since, until, today, accounts });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[reconcile] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
