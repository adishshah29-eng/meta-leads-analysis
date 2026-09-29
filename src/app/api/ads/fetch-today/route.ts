/**
 * POST|GET /api/ads/fetch-today
 *
 * Pulls ad insights from Meta Marketing API and upserts them into
 * daily_ad_snapshots. By default re-fetches the last 7 days (IST), because
 * a single mid-day fetch leaves the day incomplete and Meta keeps restating
 * results for several days as late conversions are attributed.
 *
 * Query params (all optional):
 *   ?date=YYYY-MM-DD                   single day
 *   ?since=YYYY-MM-DD&until=YYYY-MM-DD backfill a range
 *   ?days=N                            last N days ending today (default 7)
 */

import { NextRequest, NextResponse } from "next/server";
import { syncAdSnapshots } from "@/lib/syncAds";
import { addDays, daysBetweenInclusive, todayInAppTz } from "@/lib/dates";

export const maxDuration = 300;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_DAYS = 7;
const MAX_RANGE_DAYS = 90;

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const today = todayInAppTz();

  let since: string;
  let until: string;
  const date = searchParams.get("date");
  if (date) {
    since = until = date;
  } else if (searchParams.get("since")) {
    since = searchParams.get("since")!;
    until = searchParams.get("until") ?? today;
  } else {
    const days = Math.min(
      Math.max(parseInt(searchParams.get("days") ?? String(DEFAULT_DAYS), 10) || DEFAULT_DAYS, 1),
      MAX_RANGE_DAYS
    );
    until = today;
    since = addDays(today, -(days - 1));
  }

  if (!DAY_RE.test(since) || !DAY_RE.test(until) || since > until) {
    return NextResponse.json({ success: false, error: "Invalid date range." }, { status: 400 });
  }
  if (daysBetweenInclusive(since, until) > MAX_RANGE_DAYS) {
    return NextResponse.json(
      { success: false, error: `Range too large; max ${MAX_RANGE_DAYS} days per request.` },
      { status: 400 }
    );
  }

  try {
    const accounts = await syncAdSnapshots(since, until);
    const upserted = accounts.reduce((s, a) => s + a.upserted, 0);
    const failed = accounts.filter((a) => a.error);

    const message =
      failed.length === 0
        ? `Fetched ${upserted} ad-day rows for ${since} → ${until}.`
        : `Fetched ${upserted} rows; ${failed.length} account(s) failed: ${failed
            .map((f) => `${f.account} (${f.error})`)
            .join("; ")}`;

    return NextResponse.json(
      { success: failed.length === 0, partial: failed.length > 0 && upserted > 0, upserted, since, until, accounts, message, error: failed.length ? message : undefined },
      { status: failed.length === accounts.length ? 502 : 200 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[fetch-today] Error:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// Vercel cron uses GET
export async function GET(req: NextRequest) {
  return POST(req);
}
