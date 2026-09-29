/**
 * Records every background job run in `sync_runs` and emails an alert when a
 * run fails or only partly succeeds. Tracking is best-effort: if the table is
 * missing (migration not run yet) the job itself still runs normally.
 */

import { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendSyncAlert } from "@/lib/email";

export type JobName = "ads" | "leads" | "daily_report" | "weekly";
export type RunStatus = "running" | "ok" | "partial" | "failed";

export const JOB_LABELS: Record<JobName, string> = {
  ads: "Ad data sync",
  leads: "Leads sync",
  daily_report: "Daily leads email",
  weekly: "Weekly reports",
};

export interface JobOutcome {
  status: Exclude<RunStatus, "running">;
  rows?: number;
  message: string;
  details?: unknown;
}

/** Cron calls carry the Bearer CRON_SECRET; browser calls use the login cookie. */
export function triggerOf(req: NextRequest): "cron" | "manual" {
  return req.headers.get("authorization")?.startsWith("Bearer ") ? "cron" : "manual";
}

export async function trackRun(
  job: JobName,
  trigger: "cron" | "manual",
  fn: () => Promise<JobOutcome>
): Promise<JobOutcome> {
  let runId: string | null = null;
  try {
    const { data, error } = await supabase
      .from("sync_runs")
      .insert({ job, trigger, status: "running" })
      .select("id")
      .single();
    if (error) console.warn(`[sync_runs] could not record start of ${job}:`, error.message);
    runId = data?.id ?? null;
  } catch (err) {
    console.warn(`[sync_runs] could not record start of ${job}:`, err);
  }

  let outcome: JobOutcome;
  try {
    outcome = await fn();
  } catch (err) {
    outcome = { status: "failed", message: err instanceof Error ? err.message : String(err) };
  }

  if (runId) {
    const { error } = await supabase
      .from("sync_runs")
      .update({
        status: outcome.status,
        finished_at: new Date().toISOString(),
        rows_processed: outcome.rows ?? 0,
        message: outcome.message.slice(0, 2000),
        details: outcome.details ?? null,
      })
      .eq("id", runId);
    if (error) console.warn(`[sync_runs] could not record end of ${job}:`, error.message);
  }

  // Manual runs show their errors on screen; only unattended cron runs email
  if (outcome.status !== "ok" && trigger === "cron") {
    await sendSyncAlert(`${JOB_LABELS[job]} ${outcome.status === "failed" ? "failed" : "partly failed"}`, [
      outcome.message,
    ]);
  }

  return outcome;
}
