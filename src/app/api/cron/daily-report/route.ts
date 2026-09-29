/**
 * GET /api/cron/daily-report
 *
 * Emails a CSV of all leads created YESTERDAY in IST (00:00–24:00 IST).
 * Optional ?date=YYYY-MM-DD to resend a specific day.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabase, fetchAllRows } from "@/lib/supabase";
import { sendDailyReport } from "@/lib/email";
import { addDays, dayRangeToInstants, todayInAppTz } from "@/lib/dates";
import { trackRun, triggerOf } from "@/lib/syncRuns";

export async function GET(req: NextRequest) {
  const dateStr = new URL(req.url).searchParams.get("date") ?? addDays(todayInAppTz(), -1);

  const outcome = await trackRun("daily_report", triggerOf(req), async () => {
    const { from, toExclusive } = dayRangeToInstants(dateStr, dateStr);
    const leads = await fetchAllRows<Record<string, unknown>>(() =>
      supabase
        .from("leads")
        .select("*")
        .gte("created_time", from)
        .lt("created_time", toExclusive)
        .order("created_time", { ascending: true })
        .order("lead_id", { ascending: true }) as never
    );

    if (leads.length === 0) {
      return { status: "ok", rows: 0, message: `No leads on ${dateStr}, email skipped.` };
    }

    const sent = await sendDailyReport(leads, dateStr);
    if (!sent) throw new Error(`Failed to send daily report email for ${dateStr} (${leads.length} leads).`);
    return { status: "ok", rows: leads.length, message: `Report sent for ${dateStr} with ${leads.length} leads.` };
  });

  const ok = outcome.status === "ok";
  if (!ok) console.error("Daily report cron error:", outcome.message);
  return NextResponse.json(
    { success: ok, message: outcome.message, error: ok ? undefined : outcome.message },
    { status: ok ? 200 : 500 }
  );
}
