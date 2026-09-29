"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  KeyRound,
  Loader2,
  RefreshCw,
  Scale,
  XCircle,
} from "lucide-react";
import { addDays, todayInAppTz } from "@/lib/dates";

// ---------- Types (mirror /api/health and /api/reconcile) ----------

type Level = "ok" | "warn" | "error";
type RunStatus = "running" | "ok" | "partial" | "failed";

interface RunInfo {
  status: RunStatus;
  trigger: string;
  started_at: string;
  finished_at: string | null;
  rows_processed: number | null;
  message: string | null;
}

interface HealthData {
  overall: Level;
  checkedAt: string;
  issues: Array<{ level: Level; text: string }>;
  jobs: Array<{
    job: "ads" | "leads" | "daily_report" | "weekly";
    label: string;
    level: Level;
    reason: string;
    lastRun: RunInfo | null;
    lastSuccess: RunInfo | null;
    history: Array<{ status: RunStatus; started_at: string; trigger: string }>;
  }>;
  token: {
    checked: boolean;
    valid: boolean;
    expiresAt: string | null;
    daysLeft: number | null;
    missingScopes: string[];
    error?: string;
    level: Level;
  };
  freshness: Array<{ project: string; latestDay: string | null; level: Level }>;
  latestLeadAt: string | null;
}

type DayStatus = "match" | "mismatch" | "missing" | "live";

interface ReconcileData {
  since: string;
  until: string;
  today: string;
  accounts: Array<{
    project: string;
    accountId: string;
    error?: string;
    totals: { metaSpend: number; dbSpend: number; metaResults: number; dbResults: number };
    mismatchedDays: number;
    days: Array<{
      date: string;
      metaSpend: number;
      dbSpend: number;
      metaResults: number;
      dbResults: number;
      status: DayStatus;
    }>;
  }>;
  error?: string;
}

// ---------- Formatting ----------

const inr = (n: number, decimals = 0) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: decimals, minimumFractionDigits: decimals }).format(n);

const signedInr = (n: number) => {
  const abs = Math.abs(n);
  const s = inr(abs, abs < 10 && abs > 0 ? 2 : 0);
  return n > 0 ? `+${s}` : n < 0 ? `−${s}` : s;
};

const signedInt = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0");

const istDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const dayLabel = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

function relative(iso: string | null | undefined): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} days ago`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json as T;
}

// ---------- Small building blocks ----------

const LEVEL_STYLE: Record<Level, { text: string; bg: string; border: string; label: string; Icon: typeof CheckCircle2 }> = {
  ok: { text: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200", label: "Healthy", Icon: CheckCircle2 },
  warn: { text: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200", label: "Check", Icon: AlertTriangle },
  error: { text: "text-red-700", bg: "bg-red-50", border: "border-red-200", label: "Problem", Icon: XCircle },
};

function LevelPill({ level, label }: { level: Level; label?: string }) {
  const s = LEVEL_STYLE[level];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-semibold border ${s.bg} ${s.text} ${s.border}`}>
      <s.Icon className="w-3.5 h-3.5" aria-hidden />
      {label ?? s.label}
    </span>
  );
}

const RUN_STYLE: Record<RunStatus, { cls: string; label: string; short: string }> = {
  ok: { cls: "bg-emerald-500", label: "Success", short: "✓" },
  partial: { cls: "bg-amber-400", label: "Partial", short: "!" },
  failed: { cls: "bg-red-500", label: "Failed", short: "✕" },
  running: { cls: "bg-slate-300", label: "Running", short: "…" },
};

const DAY_STYLE: Record<DayStatus, { cls: string; label: string }> = {
  match: { cls: "text-emerald-700 bg-emerald-50 border-emerald-200", label: "Match" },
  mismatch: { cls: "text-red-700 bg-red-50 border-red-200", label: "Mismatch" },
  missing: { cls: "text-red-700 bg-red-50 border-red-200", label: "Missing" },
  live: { cls: "text-slate-600 bg-slate-50 border-slate-200", label: "Today (live)" },
};

const isProblem = (s: DayStatus) => s === "mismatch" || s === "missing";

// ---------- Page ----------

const RANGES = [7, 14, 30] as const;

export default function DataHealthPage() {
  const searchParams = useSearchParams();
  const currentProject = searchParams.get("project") || "all";

  const [health, setHealth] = useState<HealthData | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [recon, setRecon] = useState<ReconcileData | null>(null);
  const [reconLoading, setReconLoading] = useState(true);
  const [rangeDays, setRangeDays] = useState<(typeof RANGES)[number]>(7);
  const [problemsOnly, setProblemsOnly] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 6000);
  };

  const reconRange = useCallback(() => {
    const until = todayInAppTz();
    return { since: addDays(until, -(rangeDays - 1)), until };
  }, [rangeDays]);

  // Loaders only touch state inside promise callbacks, so they're safe in effects.
  // Loading flags are raised by the event handlers (initial state is "loading").
  const loadHealth = useCallback(
    () =>
      fetchJson<HealthData>("/api/health")
        .then(setHealth)
        .catch((err) => showToast(`Could not load sync health: ${err.message}`, "error"))
        .finally(() => setHealthLoading(false)),
    []
  );

  const loadRecon = useCallback(() => {
    const { since, until } = reconRange();
    return fetchJson<ReconcileData>(`/api/reconcile?since=${since}&until=${until}`)
      .then(setRecon)
      .catch((err) => {
        setRecon(null);
        showToast(`Could not compare with Meta: ${err.message}`, "error");
      })
      .finally(() => setReconLoading(false));
  }, [reconRange]);

  useEffect(() => { loadHealth(); }, [loadHealth]);
  useEffect(() => { loadRecon(); }, [loadRecon]);

  const accounts = useMemo(
    () => (recon?.accounts ?? []).filter((a) => currentProject === "all" || a.project === currentProject),
    [recon, currentProject]
  );
  const problemDays = accounts.flatMap((a) => a.days.filter((d) => isProblem(d.status)).map((d) => d.date));
  const totalProblemDays = accounts.reduce((s, a) => s + a.mismatchedDays, 0);

  /** Re-fetch a date range from Meta (all accounts), then re-check. */
  const resync = async (key: string, since: string, until: string) => {
    setBusy(key);
    try {
      const res = await fetch(`/api/ads/fetch-today?since=${since}&until=${until}`, { method: "POST" });
      const json = await res.json();
      showToast(json.message ?? json.error ?? "Re-sync finished", json.success ? "success" : "error");
    } catch (err) {
      showToast(`Re-sync failed: ${err instanceof Error ? err.message : err}`, "error");
    } finally {
      setBusy(null);
      setReconLoading(true);
      await Promise.all([loadRecon(), loadHealth()]);
    }
  };

  const runJob = async (job: "ads" | "leads") => {
    setBusy(`job:${job}`);
    try {
      const url = job === "ads" ? "/api/ads/fetch-today" : "/api/leads/fetch?days=7";
      const res = await fetch(url, { method: "POST" });
      const json = await res.json();
      showToast(json.message ?? json.error ?? "Done", json.success ? "success" : "error");
    } catch (err) {
      showToast(`Run failed: ${err instanceof Error ? err.message : err}`, "error");
    } finally {
      setBusy(null);
      if (job === "ads") setReconLoading(true);
      await Promise.all([loadHealth(), job === "ads" ? loadRecon() : Promise.resolve()]);
    }
  };

  const sortedProblemDays = [...problemDays].sort();
  const fixAllRange = sortedProblemDays.length
    ? { since: sortedProblemDays[0], until: sortedProblemDays[sortedProblemDays.length - 1] }
    : null;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
            <Activity className="w-7 h-7 text-blue-600" aria-hidden />
            Data Health
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Are the syncs running, and do the stored numbers match Meta?
          </p>
        </div>
        <button
          onClick={() => { setHealthLoading(true); setReconLoading(true); loadHealth(); loadRecon(); }}
          disabled={healthLoading || reconLoading}
          className="flex justify-center items-center gap-2 px-4 py-2.5 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-sm font-medium text-slate-700 shadow-sm disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${healthLoading || reconLoading ? "animate-spin" : ""}`} aria-hidden />
          Re-check
        </button>
      </div>

      {/* Overall + issues */}
      {health && (
        <div className={`rounded-xl border p-4 ${LEVEL_STYLE[health.overall].bg} ${LEVEL_STYLE[health.overall].border}`}>
          <div className="flex items-center gap-2">
            <LevelPill level={health.overall} label={health.overall === "ok" ? "All systems healthy" : health.overall === "warn" ? "Needs a look" : "Action needed"} />
            <span className="text-xs text-slate-500">Checked {relative(health.checkedAt)}</span>
          </div>
          {health.issues.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {health.issues.map((i, idx) => (
                <li key={idx} className="flex items-start gap-2 text-sm text-slate-800">
                  {i.level === "error" ? <XCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" aria-label="Problem" /> : <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" aria-label="Warning" />}
                  <span>{i.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Sync jobs */}
      <section>
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Background syncs</h2>
        {healthLoading && !health ? (
          <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {health?.jobs.map((j) => (
              <div key={j.job} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-slate-900 text-sm">{j.label}</p>
                  <LevelPill level={j.level} label={j.level === "ok" ? "Healthy" : j.reason} />
                </div>
                <dl className="text-xs space-y-1">
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Last success</dt>
                    <dd className="font-medium text-slate-800 tabular-nums" title={j.lastSuccess ? istDateTime(j.lastSuccess.started_at) : undefined}>
                      {relative(j.lastSuccess?.started_at)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Last run</dt>
                    <dd className="font-medium text-slate-800 tabular-nums">
                      {j.lastRun ? `${RUN_STYLE[j.lastRun.status].label} · ${relative(j.lastRun.started_at)}` : "—"}
                    </dd>
                  </div>
                </dl>
                {j.lastRun?.message && (
                  <p className="text-xs text-slate-600 bg-slate-50 rounded-lg p-2 break-words" title={j.lastRun.message}>
                    <span className="line-clamp-3">{j.lastRun.message}</span>
                  </p>
                )}
                {/* Run history, newest on the right; each mark also carries a symbol */}
                {j.history.length > 0 && (
                  <div className="flex items-center gap-1" aria-label="Recent runs, oldest to newest">
                    {[...j.history].reverse().map((h, idx) => (
                      <span
                        key={idx}
                        title={`${RUN_STYLE[h.status].label} · ${istDateTime(h.started_at)} · ${h.trigger}`}
                        className={`w-4 h-4 rounded-sm text-[9px] leading-4 text-center text-white font-bold ${RUN_STYLE[h.status].cls}`}
                      >
                        {RUN_STYLE[h.status].short}
                      </span>
                    ))}
                  </div>
                )}
                {(j.job === "ads" || j.job === "leads") && (
                  <button
                    onClick={() => runJob(j.job as "ads" | "leads")}
                    disabled={busy !== null}
                    className="mt-auto inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${busy === `job:${j.job}` ? "animate-spin" : ""}`} aria-hidden />
                    Run now
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Token + freshness */}
      {health && (
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="font-semibold text-slate-900 text-sm flex items-center gap-2"><KeyRound className="w-4 h-4 text-slate-500" aria-hidden /> Meta access token</p>
              <LevelPill level={health.token.level} />
            </div>
            <dl className="text-xs space-y-1">
              <div className="flex justify-between"><dt className="text-slate-500">Valid</dt><dd className="font-medium">{!health.token.checked ? "Could not check" : health.token.valid ? "Yes" : "No"}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Expires</dt><dd className="font-medium tabular-nums">{health.token.expiresAt ? `${istDateTime(health.token.expiresAt)} (${health.token.daysLeft} days)` : health.token.checked ? "Never" : "—"}</dd></div>
              {health.token.missingScopes.length > 0 && (
                <div className="flex justify-between"><dt className="text-slate-500">Missing</dt><dd className="font-medium text-red-700">{health.token.missingScopes.join(", ")}</dd></div>
              )}
            </dl>
            {health.token.error && <p className="text-xs text-slate-500 mt-2 break-words">{health.token.error}</p>}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 lg:col-span-2">
            <p className="font-semibold text-slate-900 text-sm flex items-center gap-2 mb-3"><Clock className="w-4 h-4 text-slate-500" aria-hidden /> Latest stored data</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs">
              {health.freshness.map((f) => (
                <div key={f.project} className="flex justify-between gap-2 py-1 border-b border-slate-100">
                  <span className="text-slate-700 truncate">{f.project}</span>
                  <span className={`font-medium tabular-nums ${f.level === "warn" ? "text-amber-700" : "text-slate-800"}`}>
                    {f.latestDay ? dayLabel(f.latestDay) : "No data"}{f.level === "warn" ? " · stale" : ""}
                  </span>
                </div>
              ))}
              <div className="flex justify-between gap-2 py-1 border-b border-slate-100">
                <span className="text-slate-700">Newest lead</span>
                <span className="font-medium tabular-nums text-slate-800">{health.latestLeadAt ? istDateTime(health.latestLeadAt) : "No leads"}</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Reconciliation */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="p-4 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900 flex items-center gap-2"><Scale className="w-4 h-4 text-slate-500" aria-hidden /> Meta vs stored numbers</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Meta&apos;s account totals (same as Ads Manager) compared with what the dashboard has stored. Differences under ₹1 or 0.5% are ignored.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex bg-slate-100/80 p-1 rounded-xl">
              {RANGES.map((r) => (
                <button
                  key={r}
                  onClick={() => { if (r !== rangeDays) { setReconLoading(true); setRangeDays(r); } }}
                  className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg ${rangeDays === r ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
                >
                  {r}D
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs sm:text-sm text-slate-700 px-2 cursor-pointer">
              <input type="checkbox" checked={problemsOnly} onChange={(e) => setProblemsOnly(e.target.checked)} className="rounded" />
              Only show problems
            </label>
            {fixAllRange && (
              <button
                onClick={() => resync("all", fixAllRange.since, fixAllRange.until)}
                disabled={busy !== null}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-medium shadow-sm disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${busy === "all" ? "animate-spin" : ""}`} aria-hidden />
                Re-sync {dayLabel(fixAllRange.since)} → {dayLabel(fixAllRange.until)}
              </button>
            )}
          </div>
        </div>

        {reconLoading ? (
          <div className="p-6 flex items-center gap-2 text-sm text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Asking Meta for account totals…</div>
        ) : !recon ? (
          <div className="p-6 text-sm text-slate-500">Comparison unavailable.</div>
        ) : (
          <>
            <div className="px-4 py-3 text-sm border-b border-slate-100 flex items-center gap-2">
              {totalProblemDays === 0 ? (
                <><CheckCircle2 className="w-4 h-4 text-emerald-600" aria-hidden /><span className="text-slate-800">Every day in the last {rangeDays} days matches Meta.</span></>
              ) : (
                <><XCircle className="w-4 h-4 text-red-600" aria-hidden /><span className="text-slate-800"><strong>{totalProblemDays}</strong> account-day(s) don&apos;t match Meta. Re-sync them to correct the dashboard.</span></>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 uppercase tracking-wider border-b border-slate-100">
                    <th className="px-3 md:px-4 py-2 font-semibold">Project</th>
                    <th className="px-3 md:px-4 py-2 font-semibold text-right">Meta spend</th>
                    <th className="px-3 md:px-4 py-2 font-semibold text-right">Stored</th>
                    <th className="px-3 md:px-4 py-2 font-semibold text-right">Gap</th>
                    <th className="hidden md:table-cell px-4 py-2 font-semibold text-right">Meta results</th>
                    <th className="hidden md:table-cell px-4 py-2 font-semibold text-right">Stored</th>
                    <th className="hidden md:table-cell px-4 py-2 font-semibold">Status</th>
                    <th className="px-3 md:px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((a) => {
                    const open = expanded[a.accountId] ?? a.mismatchedDays > 0;
                    const days = problemsOnly ? a.days.filter((d) => isProblem(d.status)) : a.days;
                    const bad = a.days.filter((d) => isProblem(d.status)).map((d) => d.date).sort();
                    const spendGap = a.totals.dbSpend - a.totals.metaSpend;
                    const resultGap = a.totals.dbResults - a.totals.metaResults;
                    return (
                      <Fragment key={a.accountId}>
                        <tr className="border-b border-slate-100 hover:bg-slate-50/60">
                          <td className="px-3 md:px-4 py-3">
                            <button
                              onClick={() => setExpanded((e) => ({ ...e, [a.accountId]: !open }))}
                              className="flex items-center gap-1.5 font-medium text-slate-900 text-left"
                              aria-expanded={open}
                            >
                              {open ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                              <span className="truncate max-w-[180px]">{a.project}</span>
                            </button>
                            {!a.error && (
                              <div className="md:hidden mt-1.5 ml-5 flex flex-wrap items-center gap-1.5 text-xs">
                                {a.mismatchedDays === 0 ? <LevelPill level="ok" label="Matches" /> : <LevelPill level="error" label={`${a.mismatchedDays} day(s) off`} />}
                                <span className={resultGap !== 0 ? "text-red-700 font-medium" : "text-slate-500"}>
                                  Results {a.totals.dbResults}/{a.totals.metaResults}
                                </span>
                              </div>
                            )}
                          </td>
                          {a.error ? (
                            <td colSpan={6} className="px-3 md:px-4 py-3 text-xs text-red-700">Meta error: {a.error}</td>
                          ) : (
                            <>
                              <td className="px-3 md:px-4 py-3 text-right tabular-nums">{inr(a.totals.metaSpend)}</td>
                              <td className="px-3 md:px-4 py-3 text-right tabular-nums">{inr(a.totals.dbSpend)}</td>
                              <td className={`px-3 md:px-4 py-3 text-right tabular-nums font-medium ${Math.abs(spendGap) > Math.max(1, a.totals.metaSpend * 0.005) ? "text-red-700" : "text-slate-500"}`}>{signedInr(spendGap)}</td>
                              <td className="hidden md:table-cell px-4 py-3 text-right tabular-nums">{a.totals.metaResults}</td>
                              <td className={`hidden md:table-cell px-4 py-3 text-right tabular-nums ${resultGap !== 0 ? "text-red-700 font-medium" : ""}`}>
                                {a.totals.dbResults}{resultGap !== 0 ? ` (${signedInt(resultGap)})` : ""}
                              </td>
                              <td className="hidden md:table-cell px-4 py-3">
                                {a.mismatchedDays === 0 ? <LevelPill level="ok" label="Matches" /> : <LevelPill level="error" label={`${a.mismatchedDays} day(s) off`} />}
                              </td>
                            </>
                          )}
                          <td className="px-3 md:px-4 py-3 text-right">
                            {bad.length > 0 && (
                              <button
                                onClick={() => resync(a.accountId, bad[0], bad[bad.length - 1])}
                                disabled={busy !== null}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-white disabled:opacity-50 whitespace-nowrap"
                              >
                                <RefreshCw className={`w-3.5 h-3.5 ${busy === a.accountId ? "animate-spin" : ""}`} aria-hidden />
                                Re-sync
                              </button>
                            )}
                          </td>
                        </tr>
                        {open && !a.error && (
                          days.length === 0 ? (
                            <tr className="border-b border-slate-100 bg-slate-50/40">
                              <td colSpan={8} className="px-10 py-2 text-xs text-slate-500">{problemsOnly ? "No problem days." : "No delivery in this range."}</td>
                            </tr>
                          ) : days.map((d) => (
                            <tr key={d.date} className="border-b border-slate-100 bg-slate-50/40 text-xs">
                              <td className="pl-6 md:pl-10 pr-4 py-2 text-slate-600 tabular-nums whitespace-nowrap">
                                {dayLabel(d.date)}
                                <span className={`md:hidden ml-1.5 inline-block px-1.5 rounded border font-semibold ${DAY_STYLE[d.status].cls}`}>{DAY_STYLE[d.status].label}</span>
                              </td>
                              <td className="px-3 md:px-4 py-2 text-right tabular-nums">{inr(d.metaSpend, 2)}</td>
                              <td className="px-3 md:px-4 py-2 text-right tabular-nums">{inr(d.dbSpend, 2)}</td>
                              <td className={`px-3 md:px-4 py-2 text-right tabular-nums ${isProblem(d.status) ? "text-red-700 font-medium" : "text-slate-500"}`}>{signedInr(d.dbSpend - d.metaSpend)}</td>
                              <td className="hidden md:table-cell px-4 py-2 text-right tabular-nums">{d.metaResults}</td>
                              <td className={`hidden md:table-cell px-4 py-2 text-right tabular-nums ${d.dbResults !== d.metaResults && d.status !== "live" ? "text-red-700 font-medium" : ""}`}>{d.dbResults}</td>
                              <td className="hidden md:table-cell px-4 py-2">
                                <span className={`inline-block px-2 py-0.5 rounded-md border font-semibold ${DAY_STYLE[d.status].cls}`}>{DAY_STYLE[d.status].label}</span>
                              </td>
                              <td />
                            </tr>
                          ))
                        )}
                      </Fragment>
                    );
                  })}
                  {accounts.length === 0 && (
                    <tr><td colSpan={8} className="px-3 md:px-4 py-6 text-sm text-slate-500">No ad accounts configured.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {toast && (
        <div
          role="status"
          className={`fixed bottom-4 right-4 left-4 sm:left-auto sm:max-w-md z-50 rounded-xl px-4 py-3 text-sm shadow-lg border ${
            toast.type === "success" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-800"
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
