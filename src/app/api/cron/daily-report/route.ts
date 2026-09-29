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

export async function GET(req: NextRequest) {
  try {
    const dateStr = new URL(req.url).searchParams.get("date") ?? addDays(todayInAppTz(), -1);
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
      console.log(`No leads found for ${dateStr}. Skipping report.`);
      return NextResponse.json({ success: true, message: `No leads on ${dateStr}, email skipped.` });
    }

    console.log(`Sending daily report for ${dateStr} with ${leads.length} leads...`);
    const success = await sendDailyReport(leads, dateStr);
    if (!success) throw new Error("Failed to send daily report email.");

    return NextResponse.json({ success: true, message: `Report sent for ${dateStr} with ${leads.length} leads.` });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Daily report cron error:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
