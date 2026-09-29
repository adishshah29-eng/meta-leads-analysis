/**
 * GET /api/health
 *
 * Sync health for the Data Health page and the dashboard banner:
 * last run / last success per background job, Meta token status, and how
 * fresh the stored data is per project.
 */

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { checkTokenHealth, type TokenHealth } from "@/lib/meta";
import { getAdAccounts } from "@/lib/syncAds";
import { JOB_LABELS, type JobName, type RunStatus } from "@/lib/syncRuns";
import { addDays, todayInAppTz } from "@/lib/dates";

export const dynamic = "force-dynamic";

type Level = "ok" | "warn" | "error";

interface RunRow {
  job: JobName;
  trigger: string;
  status: RunStatus;
  started_at: string;
  finished_at: string | null;
  rows_processed: number | null;
  message: string | null;
}

/** How long each job may go without a successful run before it's flagged. */
const MAX_AGE_HOURS: Record<JobName, number> = {
  ads: 26,
  leads: 26,
  daily_report: 26,
  weekly: 24 * 8,
};

/** A run still "running" after this long was killed (e.g. function timeout). */
const STUCK_AFTER_MIN = 15;

const worst = (levels: Level[]): Level =>
  levels.includes("error") ? "error" : levels.includes("warn") ? "warn" : "ok";

// Token status changes slowly; avoid calling Meta on every page load
let tokenCache: { at: number; value: TokenHealth } | null = null;
async function cachedTokenHealth(): Promise<TokenHealth> {
  if (tokenCache && Date.now() - tokenCache.at < 10 * 60 * 1000) return tokenCache.value;
  const value = await checkTokenHealth();
  tokenCache = { at: Date.now(), value };
  return value;
}

export async function GET() {
  const issues: Array<{ level: Level; text: string }> = [];
  const now = Date.now();

  // --- Job runs -------------------------------------------------------------
  const since = new Date(now - 14 * 86400000).toISOString();
  const { data: runData, error: runError } = await supabase
    .from("sync_runs")
    .select("job, trigger, status, started_at, finished_at, rows_processed, message")
    .gte("started_at", since)
    .order("started_at", { ascending: false })
    .limit(500);

  const trackingMissing = Boolean(runError);
  if (runError) {
    issues.push({
      level: "warn",
      text: /does not exist|relation|schema cache/i.test(runError.message)
        ? "Sync history table is missing: run supabase/migrations/2026_09_sync_health.sql"
        : `Could not read sync history: ${runError.message}`,
    });
  }

  const runs = ((runData ?? []) as RunRow[]).map((r) =>
    r.status === "running" && now - new Date(r.started_at).getTime() > STUCK_AFTER_MIN * 60000
      ? { ...r, status: "failed" as RunStatus, message: r.message ?? "Run never finished (timed out or crashed)" }
      : r
  );

  const jobs = (Object.keys(JOB_LABELS) as JobName[]).map((job) => {
    const jobRuns = runs.filter((r) => r.job === job);
    const lastRun = jobRuns[0] ?? null;
    const lastSuccess = jobRuns.find((r) => r.status === "ok") ?? null;
    const hoursSinceSuccess = lastSuccess ? (now - new Date(lastSuccess.started_at).getTime()) / 3600000 : null;

    let level: Level = "ok";
    let reason = "";
    if (trackingMissing) {
      level = "warn";
      reason = "No history available";
    } else if (!lastRun) {
      level = "warn";
      reason = "No runs in the last 14 days";
    } else if (lastRun.status === "failed") {
      level = "error";
      reason = "Last run failed";
    } else if (hoursSinceSuccess === null || hoursSinceSuccess > MAX_AGE_HOURS[job] * 2) {
      level = "error";
      reason = "No successful run recently";
    } else if (lastRun.status === "partial") {
      level = "warn";
      reason = "Last run partly failed";
    } else if (hoursSinceSuccess > MAX_AGE_HOURS[job]) {
      level = "warn";
      reason = "Overdue";
    }

    if (level !== "ok" && !trackingMissing) {
      issues.push({ level, text: `${JOB_LABELS[job]}: ${reason.toLowerCase()}${lastRun?.message && lastRun.status !== "ok" ? ` (${lastRun.message.slice(0, 160)})` : ""}` });
    }

    return {
      job,
      label: JOB_LABELS[job],
      level,
      reason,
      lastRun,
      lastSuccess,
      history: jobRuns.slice(0, 14).map((r) => ({ status: r.status, started_at: r.started_at, trigger: r.trigger })),
    };
  });

  // --- Meta token -------------------------------------------------------------
  const token = await cachedTokenHealth();
  let tokenLevel: Level = "ok";
  if (token.checked && !token.valid) {
    tokenLevel = "error";
    issues.push({ level: "error", text: `Meta access token is invalid${token.error ? `: ${token.error}` : ""}` });
  } else if (token.daysLeft !== null && token.daysLeft <= 7) {
    tokenLevel = token.daysLeft <= 2 ? "error" : "warn";
    issues.push({ level: tokenLevel, text: `Meta access token expires in ${token.daysLeft} day(s)` });
  } else if (token.missingScopes.length) {
    tokenLevel = "warn";
    issues.push({ level: "warn", text: `Meta token is missing permissions: ${token.missingScopes.join(", ")}` });
  } else if (!token.checked) {
    tokenLevel = "warn";
  }

  // --- Data freshness ---------------------------------------------------------
  const yesterday = addDays(todayInAppTz(), -1);
  const freshness = await Promise.all(
    getAdAccounts().map(async (a) => {
      const { data } = await supabase
        .from("daily_ad_snapshots")
        .select("snapshot_date")
        .eq("project_name", a.name)
        .order("snapshot_date", { ascending: false })
        .limit(1);
      const latest = (data?.[0]?.snapshot_date as string | undefined) ?? null;
      // No rows at all is normal for an account that isn't spending
      const level: Level = latest && latest < addDays(yesterday, -2) ? "warn" : "ok";
      return { project: a.name, latestDay: latest, level };
    })
  );

  const { data: leadData } = await supabase
    .from("leads")
    .select("created_time")
    .order("created_time", { ascending: false })
    .limit(1);

  const overall = worst([...jobs.map((j) => j.level), tokenLevel, ...issues.map((i) => i.level)]);

  return NextResponse.json({
    overall,
    checkedAt: new Date().toISOString(),
    issues,
    jobs,
    token: { ...token, level: tokenLevel },
    freshness,
    latestLeadAt: (leadData?.[0]?.created_time as string | undefined) ?? null,
  });
}
