"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  RefreshCw,
  MessageCircle,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Target,
  MousePointerClick,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Share2,
} from "lucide-react";
import { StatCard } from "@/components/StatCard";
import { ShareButton } from "@/components/ShareButton";
import { SnapshotStatCards, SnapshotTable } from "@/components/snapshots/SnapshotComponents";
import { useSearchParams } from "next/navigation";
import { addDays, lastCompletedWeek } from "@/lib/dates";
import { ChevronLeft, ChevronRight } from "lucide-react";

function getMostRecentWeekStart(): string {
  return lastCompletedWeek().weekStart;
}

interface WeeklyReport {
  week_start: string;
  week_end: string;
  total_spend: number;
  total_results: number;
  avg_ctr: number;
  avg_cpa: number;
  spend_change_pct: number | null;
  cpa_change_pct: number | null;
  results_change_pct: number | null;
  top_ads: Array<{ ad_name: string; results: number; cost_per_result: number; spend: number }>;
  bottom_ads: Array<{ ad_name: string; results: number; spend: number }>;
  campaigns?: Array<{
    campaign_name: string;
    spend: number;
    results: number;
    cost_per_result: number;
    top_ads: Array<{ ad_name: string; results: number; cost_per_result: number; spend: number }>;
    bottom_ads: Array<{ ad_name: string; results: number; spend: number }>;
  }>;
  ai_summary: string | null;
}

interface WeeklyHistoryPoint {
  week_start: string;
  total_spend: number;
  total_results: number;
  avg_cpa: number;
}

function formatINR(n: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

function ChangeChip({
  value,
  invertGood = false,
}: {
  value: number | null;
  invertGood?: boolean;
}) {
  if (value === null) {
    return <span className="text-slate-400 text-xs">N/A</span>;
  }
  const good = invertGood ? value < 0 : value > 0;
  const sign = value > 0 ? "+" : "";
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
        good
          ? "bg-emerald-50 text-emerald-600 border border-emerald-100"
          : "bg-red-50 text-red-600 border border-red-100"
      }`}
    >
      {value > 0 ? (
        <TrendingUp className="w-3 h-3" />
      ) : (
        <TrendingDown className="w-3 h-3" />
      )}
      {sign}{Math.abs(value).toFixed(1)}%
    </span>
  );
}

function WeeklyDashboardClient() {
  const searchParams = useSearchParams();
  const currentProject = searchParams.get("project") || "all";

  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [history, setHistory] = useState<WeeklyHistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [activeHistoryMetric, setActiveHistoryMetric] = useState<"total_spend" | "total_results" | "avg_cpa">("total_spend");
  const [weekStart, setWeekStart] = useState<string | null>(null);
  const [adScope, setAdScope] = useState<"overall" | "per-campaign">("overall");

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const qs = `project=${encodeURIComponent(currentProject)}${weekStart ? `&week_start=${weekStart}` : ""}`;
      const res = await fetch(`/api/reports/weekly-read?${qs}`);
      const json = await res.json();
      if (json.report) setReport(json.report);
      else setReport(null); // Clear report if not found for this week
      if (json.history) setHistory(json.history);
    } catch {
      // Report may not exist yet — that's OK
    } finally {
      setLoading(false);
    }
  }, [currentProject, weekStart]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const handleCompute = async () => {
    setComputing(true);
    try {
      const qs = `project=${encodeURIComponent(currentProject)}${weekStart ? `&week_start=${weekStart}` : ""}`;
      const res = await fetch(`/api/reports/weekly?${qs}`, { method: "POST" });
      const json = await res.json();
      if (json.success) {
        showToast("✓ Weekly report computed", "success");
        setReport({
          week_start: json.weekStart,
          week_end: json.weekEnd,
          total_spend: json.summary.totalSpend,
          total_results: json.summary.totalResults,
          avg_ctr: json.summary.avgCTR,
          avg_cpa: json.summary.avgCPA,
          spend_change_pct: json.summary.spendChangePct,
          cpa_change_pct: json.summary.cpaChangePct,
          results_change_pct: json.summary.resultsChangePct,
          top_ads: json.summary.topAds,
          bottom_ads: json.summary.bottomAds,
          campaigns: json.summary.campaigns,
          ai_summary: json.aiSummary,
        });
      } else {
        showToast(json.error ?? "Failed to compute weekly report", "error");
      }
    } catch {
      showToast("Network error computing report", "error");
    } finally {
      setComputing(false);
    }
  };

  const handleNativeShare = async () => {
    if (!report) return;
    const { generateWeeklyWhatsAppText } = await import("@/lib/whatsappFormat");
    const text = generateWeeklyWhatsAppText(report, currentProject);
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Weekly Meta Ads Report",
          text: text,
        });
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          showToast("Failed to share", "error");
        }
      }
    } else {
      try {
        await navigator.clipboard.writeText(text);
        showToast("Report copied to clipboard! You can paste it anywhere.", "success");
      } catch {
        showToast("Sharing not supported on this browser", "error");
      }
    }
  };


  const historyMetrics = [
    { key: "total_spend" as const, label: "Spend", color: "#3b82f6" },
    { key: "total_results" as const, label: "Leads", color: "#10b981" },
    { key: "avg_cpa" as const, label: "Avg Cost/Lead", color: "#8b5cf6" },
  ];
  const activeMetric = historyMetrics.find((m) => m.key === activeHistoryMetric)!;

  const weekLabel = report
    ? `${new Date(report.week_start).toLocaleDateString("en-IN", { month: "short", day: "numeric" })} – ${new Date(report.week_end).toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric" })}`
    : "Last Week";

  const isAllProjects = currentProject === "all";

  return (
    <div className="p-8 min-h-screen pb-20">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-6 right-6 z-50 px-5 py-3.5 rounded-xl shadow-2xl text-sm font-medium flex items-center gap-3 transition-all animate-in slide-in-from-top-2 duration-300 ${
            toast.type === "success"
              ? "bg-emerald-50 border border-emerald-200 text-emerald-800 shadow-emerald-500/10"
              : "bg-red-50 border border-red-200 text-red-800 shadow-red-500/10"
          }`}
        >
          {toast.type === "success" ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-red-600" />
          )}
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
            Weekly Report
            <span className="text-slate-400 font-normal text-xl">
              {isAllProjects ? "Portfolio" : currentProject}
            </span>
          </h1>
          <div className="flex items-center gap-4 mt-1.5">
            <p className="text-slate-500 text-sm font-medium min-w-[200px]" suppressHydrationWarning>{weekLabel}</p>
            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
              <button
                onClick={() => {
                  const target = report ? report.week_start : weekStart || getMostRecentWeekStart();
                  setWeekStart(addDays(target, -7));
                }}
                className="p-1 rounded-md text-slate-500 hover:text-slate-900 hover:bg-white transition-colors"
                title="Previous Week"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  const target = report ? report.week_start : weekStart || getMostRecentWeekStart();
                  setWeekStart(addDays(target, 7));
                }}
                disabled={(report?.week_start || weekStart || getMostRecentWeekStart()) >= getMostRecentWeekStart()}
                className="p-1 rounded-md text-slate-500 hover:text-slate-900 hover:bg-white transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
                title="Next Week"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleCompute}
            disabled={computing}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-300 text-sm font-medium text-slate-700 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          >
            <RefreshCw className={`w-4 h-4 ${computing ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">{computing ? "Computing…" : "Compute Report"}</span>
          </button>

          <button
            onClick={handleNativeShare}
            disabled={!report}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-sm font-medium text-white transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm shadow-blue-600/20"
          >
            <Share2 className="w-4 h-4" />
            <span className="hidden sm:inline">Share Report</span>
          </button>


        </div>
      </div>

      {/* AI Summary */}
      {report?.ai_summary && (
        <div className="mb-8 rounded-2xl bg-gradient-to-br from-indigo-50/50 to-purple-50/50 border border-indigo-100 p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-indigo-500" />
            <span className="text-sm font-semibold text-indigo-700">AI Analysis</span>
          </div>
          <p className="text-slate-700 text-sm leading-relaxed">{report.ai_summary}</p>
        </div>
      )}

      {/* Stat Cards */}
      <div className="flex items-center justify-between mb-4 mt-8">
        <h3 className="font-semibold text-slate-900">Top-Level Metrics</h3>
        <ShareButton elementId="snapshot-weekly-stats" fileName="weekly-stats" title="Top-Level Metrics" subtitle={weekLabel} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5 mb-8">
        <StatCard
          label="Total Spend"
          value={report ? formatINR(report.total_spend) : "—"}
          change={report?.spend_change_pct}
          icon={<DollarSign className="w-4 h-4" />}
          loading={loading}
        />
        <StatCard
          label="Total Leads"
          value={report ? String(report.total_results) : "—"}
          change={report?.results_change_pct}
          icon={<Target className="w-4 h-4" />}
          loading={loading}
        />
        <StatCard
          label="Avg Cost/Lead"
          value={report ? formatINR(report.avg_cpa) : "—"}
          change={report?.cpa_change_pct}
          invertGood
          icon={<MousePointerClick className="w-4 h-4" />}
          loading={loading}
        />
        <StatCard
          label="Avg CTR"
          value={report ? `${report.avg_ctr.toFixed(2)}%` : "—"}
          icon={<TrendingUp className="w-4 h-4" />}
          loading={loading}
        />
      </div>

      {/* Week-over-week change summary */}
      {report && (
        <div className="grid grid-cols-3 gap-5 mb-8">
          {[
            { label: "Spend Change", value: report.spend_change_pct, invertGood: false },
            { label: "Leads Change", value: report.results_change_pct, invertGood: false },
            { label: "Cost/Lead Change", value: report.cpa_change_pct, invertGood: true },
          ].map(({ label, value, invertGood }) => (
            <div key={label} className="rounded-2xl bg-white border border-slate-200 p-5 flex items-center justify-between shadow-sm">
              <span className="text-sm font-semibold text-slate-500">{label}</span>
              <ChangeChip value={value} invertGood={invertGood} />
            </div>
          ))}
        </div>
      )}

      {/* Campaign Performance Table */}
      {report?.campaigns && report.campaigns.length > 0 && (
        <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden shadow-sm mb-8">
          <div className="p-4 sm:p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
            <div>
              <h3 className="font-semibold text-slate-900">Campaign Performance</h3>
              <p className="text-xs text-slate-500 mt-1">Rollup by campaign for this week</p>
            </div>
            <ShareButton elementId="snapshot-weekly-campaigns" fileName="weekly-campaigns" title="Campaign Performance" subtitle={weekLabel} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-slate-200 bg-white">
                  <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider bg-slate-50/30">Campaign</th>
                  <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider bg-slate-50/30">Spend</th>
                  <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider bg-slate-50/30">Leads</th>
                  <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider bg-slate-50/30">Cost/Lead</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.campaigns.map((camp) => (
                  <tr key={camp.campaign_name} className="group hover:bg-slate-50/70 transition-colors">
                    <td className="px-5 py-2.5 sticky left-0 bg-white group-hover:bg-slate-50/70 shadow-[4px_0_12px_rgba(0,0,0,0.03)] sm:shadow-none z-10 transition-colors">
                      <p className="font-medium text-slate-900 text-sm max-w-[120px] sm:max-w-[280px] truncate">
                        {camp.campaign_name}
                      </p>
                    </td>
                    <td className="px-5 py-2.5 font-medium text-slate-700 whitespace-nowrap">
                      {formatINR(camp.spend)}
                    </td>
                    <td className="px-5 py-2.5">
                      <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-semibold min-w-[28px] ${camp.results > 0 ? "bg-blue-50 text-blue-700 border border-blue-100" : "bg-slate-100 text-slate-500 border border-slate-200"}`}>
                        {camp.results}
                      </span>
                    </td>
                    <td className="px-5 py-2.5 font-semibold whitespace-nowrap">
                      <span className={camp.results === 0 ? "text-slate-400" : "text-slate-900"}>
                        {camp.results === 0 ? "—" : formatINR(camp.cost_per_result)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Top + Bottom Ads Section */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-bold text-lg text-slate-800">Ads Performance</h2>
        <div className="flex gap-4 items-center">
          <ShareButton elementId="snapshot-weekly-ads" fileName="weekly-ads-performance" title="Ads Performance" subtitle={weekLabel} />
          <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          <button
            onClick={() => setAdScope("overall")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              adScope === "overall"
                ? "bg-white text-slate-900 shadow-sm border border-slate-200/60"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Overall
          </button>
          <button
            onClick={() => setAdScope("per-campaign")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              adScope === "per-campaign"
                ? "bg-white text-slate-900 shadow-sm border border-slate-200/60"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Per-Campaign
          </button>
        </div>
      </div>
      </div>

      <div className="space-y-8 mb-8">
        {(adScope === "overall" || !report?.campaigns
          ? [{ campaign_name: "Overall", top_ads: report?.top_ads ?? [], bottom_ads: report?.bottom_ads ?? [] }]
          : report.campaigns
        ).map((group, groupIdx) => (
          <div key={groupIdx} className="space-y-4">
            {adScope === "per-campaign" && (
              <h3 className="text-sm font-semibold text-slate-700 border-b border-slate-200 pb-2">{group.campaign_name}</h3>
            )}
            <div className="grid grid-cols-2 gap-6">
              {/* Top Ads */}
              <div className="rounded-2xl bg-white border border-slate-200 p-6 shadow-sm">
                <div className="flex items-center gap-2 mb-5">
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center border border-emerald-100">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  </div>
                  <h3 className="font-semibold text-slate-900 text-sm">Top Performing Ads</h3>
                </div>
                {loading ? (
                  <div className="space-y-3">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="h-14 bg-slate-50 rounded-xl animate-pulse" />
                    ))}
                  </div>
                ) : group.top_ads.length === 0 ? (
                  <p className="text-slate-400 text-sm">No data yet.</p>
                ) : (
                  <div className="space-y-3">
                    {group.top_ads.map((ad, i) => (
                      <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-slate-50/50 hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-100">
                        <span className="text-lg font-bold text-emerald-500 w-6 text-center">
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-900 truncate">{ad.ad_name}</p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            <span className="font-medium text-slate-700">{ad.results} leads</span> · {formatINR(ad.cost_per_result)}/lead
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Bottom Ads */}
              <div className="rounded-2xl bg-white border border-slate-200 p-6 shadow-sm">
                <div className="flex items-center gap-2 mb-5">
                  <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center border border-amber-100">
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                  </div>
                  <h3 className="font-semibold text-slate-900 text-sm">Underperforming Ads</h3>
                </div>
                {loading ? (
                  <div className="space-y-3">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="h-14 bg-slate-50 rounded-xl animate-pulse" />
                    ))}
                  </div>
                ) : group.bottom_ads.length === 0 ? (
                  <p className="text-slate-400 text-sm">No underperformers detected.</p>
                ) : (
                  <div className="space-y-3">
                    {group.bottom_ads.map((ad, i) => (
                      <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-slate-50/50 hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-100">
                        <span className="text-lg font-bold text-amber-500 w-6 text-center">
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-900 truncate">{ad.ad_name}</p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            <span className="font-medium text-slate-700">{formatINR(ad.spend)} spend</span> · {ad.results} leads
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 4-Week History Chart */}
      <div className="rounded-2xl bg-white border border-slate-200 p-6 shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <h3 className="font-semibold text-slate-900">4-Week History</h3>
          <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
            {historyMetrics.map((m) => (
              <button
                key={m.key}
                onClick={() => setActiveHistoryMetric(m.key)}
                className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${
                  activeHistoryMetric === m.key
                    ? "bg-white text-slate-900 shadow-sm border border-slate-200/60"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {loading || history.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-400">
            {loading ? (
              <div className="h-full w-full bg-slate-50 rounded-xl animate-pulse" />
            ) : (
              <p className="text-sm">No history yet — compute reports for previous weeks.</p>
            )}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={history} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorMetric" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={activeMetric.color} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={activeMetric.color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis
                dataKey="week_start"
                tick={{ fill: "#64748b", fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                dy={10}
                tickFormatter={(v) =>
                  new Date(v).toLocaleDateString("en-IN", { month: "short", day: "numeric" })
                }
              />
              <YAxis
                tick={{ fill: "#64748b", fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                dx={-10}
                tickFormatter={(v) =>
                  activeHistoryMetric === "total_spend" || activeHistoryMetric === "avg_cpa"
                    ? `₹${(v / 1000).toFixed(0)}k`
                    : String(v)
                }
              />
              <Tooltip
                contentStyle={{
                  background: "#ffffff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "8px",
                  fontSize: "13px",
                  boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                }}
                labelStyle={{ color: "#475569", marginBottom: "4px" }}
                itemStyle={{ color: activeMetric.color, fontWeight: 600 }}
              />
              <Area
                type="monotone"
                dataKey={activeHistoryMetric}
                stroke={activeMetric.color}
                strokeWidth={3}
                fill="url(#colorMetric)"
                dot={{ fill: "#ffffff", stroke: activeMetric.color, strokeWidth: 2, r: 4 }}
                activeDot={{ r: 6, fill: activeMetric.color, stroke: "#ffffff", strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {report && (
        <>
          <SnapshotStatCards
            id="snapshot-weekly-stats"
            title={`Weekly ${isAllProjects ? 'Portfolio' : currentProject} Performance`}
            subtitle={weekLabel}
            stats={[
              { label: "Total Spend", value: formatINR(report.total_spend), icon: "spend" },
              { label: "Total Leads", value: String(report.total_results), icon: "leads" },
              { label: "Cost Per Lead", value: formatINR(report.avg_cpa), icon: "cpa" },
              { label: "Avg CTR", value: `${report.avg_ctr.toFixed(2)}%`, icon: "ctr" },
            ]}
          />
          {report.campaigns && report.campaigns.length > 0 && (
            <SnapshotTable
              id="snapshot-weekly-campaigns"
              title={`Weekly ${isAllProjects ? 'Portfolio' : currentProject} Campaigns`}
              subtitle={weekLabel}
              columns={["Campaign", "Spend", "Leads", "Cost/Lead"]}
              data={report.campaigns}
              renderRow={(camp, i) => (
                <tr key={i}>
                  <td className="px-5 py-2.5 font-medium">{camp.campaign_name}</td>
                  <td className="px-5 py-2.5">{formatINR(camp.spend)}</td>
                  <td className="px-5 py-2.5">{camp.results}</td>
                  <td className="px-5 py-2.5">{formatINR(camp.cost_per_result)}</td>
                </tr>
              )}
            />
          )}
          {adScope === "overall" && (report.top_ads.length > 0 || report.bottom_ads.length > 0) && (
            <SnapshotTable
              id="snapshot-weekly-ads"
              title={`Weekly ${isAllProjects ? 'Portfolio' : currentProject} Ads`}
              subtitle={weekLabel}
              columns={["Ad", "Performance", "Spend", "Leads"]}
              data={[...report.top_ads.map(a => ({...a, type: 'top'})), ...report.bottom_ads.map(a => ({...a, type: 'bottom'}))]}
              renderRow={(ad, i) => (
                <tr key={i}>
                  <td className="px-5 py-2.5 font-medium">{ad.ad_name}</td>
                  <td className="px-5 py-2.5">{ad.type === 'top' ? '✅ Top' : '⚠️ Bottom'}</td>
                  <td className="px-5 py-2.5">{formatINR(ad.spend)}</td>
                  <td className="px-5 py-2.5">{ad.results}</td>
                </tr>
              )}
            />
          )}
        </>
      )}
    </div>
  );
}

export default function WeeklyDashboard() {
  return (
    <Suspense fallback={<div className="p-8 text-slate-500">Loading Dashboard...</div>}>
      <WeeklyDashboardClient />
    </Suspense>
  );
}
