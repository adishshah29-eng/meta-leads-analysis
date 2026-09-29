"use client";

import { useEffect, useState, useCallback, Suspense, useMemo } from "react";
import {
  LineChart,
  Line,
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
  MousePointerClick,
  Target,
  Users,
  AlertTriangle,
  CheckCircle2,
  ChevronUp,
  ChevronDown,
  Minus,
  Share2,
  ChevronsUpDown,
  Calendar,
} from "lucide-react";
import { StatCard } from "@/components/StatCard";
import { SnapshotStatCards, SnapshotTable } from "@/components/snapshots/SnapshotComponents";
import { computeDailySummary, type AdSnapshot as AdRow, type DailySummary } from "@/lib/compute";
import { addDays, daysBetweenInclusive, previousMonthRange, todayInAppTz } from "@/lib/dates";
import { useSearchParams } from "next/navigation";
import { takeCombinedSnapshot } from "@/lib/snapshot";
import { ShareButton } from "@/components/ShareButton";
import { motion } from "framer-motion";

interface PortfolioRow {
  project_name: string;
  account_name?: string;
  spend: number;
  results: number;
  impressions: number;
  clicks: number;
  cost_per_result: number;
  ctr: number;
}

interface TrendPoint {
  date: string;
  spend: number;
  results: number;
  ctr: string;
}

type SortKey = keyof AdRow;
type SortDir = "asc" | "desc";

function formatINR(n: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatNum(n: number, decimals = 2) {
  return n.toFixed(decimals);
}

/** Resolve a preset to IST calendar days ("YYYY-MM-DD"). */
function resolveRange(range: string, sd?: string, ed?: string): { start: string; end: string } {
  const today = todayInAppTz();
  switch (range) {
    case "yesterday": return { start: addDays(today, -1), end: addDays(today, -1) };
    case "7d": return { start: addDays(today, -6), end: today };
    case "14d": return { start: addDays(today, -13), end: today };
    case "30d": return { start: addDays(today, -29), end: today };
    case "last_month": return previousMonthRange(today);
    case "custom": return sd && ed ? { start: sd, end: ed } : { start: today, end: today };
    default: return { start: today, end: today };
  }
}

function formatDateRangeLabel(range: string, sd?: string, ed?: string): string {
  // Day strings are formatted as UTC midnight so the label never shifts a day
  const fmt = (day: string) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const { start, end } = resolveRange(range, sd, ed);
  if (range === "today") return `Today · ${fmt(start)}`;
  if (range === "yesterday") return `Yesterday · ${fmt(start)}`;
  if (range === "custom" && !(sd && ed)) return "Custom Range";
  return `${fmt(start)} – ${fmt(end)}`;
}

const trendDaysFor = (range: string, sd?: string, ed?: string) => {
  if (range === "today" || range === "yesterday") return 14;
  const { start, end } = resolveRange(range, sd, ed);
  return Math.max(1, daysBetweenInclusive(start, end));
}

function DashboardClient() {
  const searchParams = useSearchParams();
  const currentProject = searchParams.get("project") || "all";

  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [activeChart, setActiveChart] = useState<"spend" | "results">("spend");
  const [adScope, setAdScope] = useState<"overall" | "per-campaign">("overall");
  const [dateRange, setDateRange] = useState<"today" | "yesterday" | "7d" | "14d" | "30d" | "last_month" | "custom">("today");
  const [customStartDate, setCustomStartDate] = useState<string>("");
  const [customEndDate, setCustomEndDate] = useState<string>("");
  const [activeAdsOnly, setActiveAdsOnly] = useState(false);
  const [activeCampOnly, setActiveCampOnly] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<string>("all");
  
  const ALL_COLUMNS = [
    { key: "spend", label: "Spend" },
    { key: "impressions", label: "Impr." },
    { key: "clicks", label: "Clicks" },
    { key: "ctr", label: "CTR" },
    { key: "cpc", label: "CPC" },
    { key: "results", label: "Leads" },
    { key: "cost_per_result", label: "Cost/Lead" }
  ];
  const [visibleColumns, setVisibleColumns] = useState<string[]>([
    "spend", "impressions", "clicks", "results", "cost_per_result"
  ]);

  const availableCampaigns = useMemo(() => {
    if (!summary) return [];
    const camps = summary.ads.map((ad) => ad.campaign_name).filter(Boolean);
    const unique = Array.from(new Set(camps));
    
    // Helper to extract a plausible date from campaign names
    const extractDate = (name: string): number => {
      const norm = name.replace(/\b(\d+)(st|nd|rd|th)\b/gi, "$1");
      
      // Match DD-MM-YYYY or DD.MM.YYYY
      const dmy = norm.match(/\b(\d{2})[-/.](\d{2})[-/.](\d{4})\b/);
      if (dmy) {
        const d = new Date(`${dmy[3]}-${dmy[2]}-${dmy[1]}`);
        if (!isNaN(d.getTime())) return d.getTime();
      }

      // Match YYYY-MM-DD
      const ymd = norm.match(/\b(\d{4})[-/.](\d{2})[-/.](\d{2})\b/);
      if (ymd) {
        const d = new Date(ymd[0]);
        if (!isNaN(d.getTime())) return d.getTime();
      }

      // Match "14 Jul 2024", "Jul 2024", "14 July"
      const alpha = norm.match(/\b(?:(\d{1,2})[-/\s]+)?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[-/\s]+(?:(\d{4})\b)?/i);
      if (alpha) {
        const day = alpha[1] || "1";
        const month = alpha[2];
        const year = alpha[3] || new Date().getFullYear();
        const d = new Date(`${day} ${month} ${year}`);
        if (!isNaN(d.getTime())) return d.getTime();
      }

      return 0;
    };

    return unique.sort((a, b) => {
      const dateA = extractDate(a);
      const dateB = extractDate(b);
      
      if (dateA > 0 && dateB > 0) return dateB - dateA; // Latest first
      if (dateA > 0) return -1; // Dates bubble to top
      if (dateB > 0) return 1;
      return a.localeCompare(b); // Alphabetical fallback
    });
  }, [summary]);

  const displayedSummary = useMemo(() => {
    if (!summary) return null;
    if (selectedCampaign === "all") return summary;
    const filteredAds = summary.ads.filter((ad) => ad.campaign_name === selectedCampaign);
    return computeDailySummary(filteredAds, summary.date);
  }, [summary, selectedCampaign]);

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // All presets are calendar days in IST, independent of the device clock's timezone
      const { start: startDate, end: endDate } = resolveRange(dateRange, customStartDate, customEndDate);
      const trendDays = trendDaysFor(dateRange, customStartDate, customEndDate);

      const res = await fetch(`/api/ads/summary?project=${encodeURIComponent(currentProject)}&startDate=${startDate}&endDate=${endDate}&days=${trendDays}`);
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
      if (json.summary) setSummary(json.summary);
      if (json.trend) setTrend(json.trend);
      if (json.portfolio) setPortfolio(json.portfolio);
    } catch (err) {
      showToast(`Failed to load dashboard data: ${err instanceof Error ? err.message : err}`, "error");
    } finally {
      setLoading(false);
    }
  }, [currentProject, dateRange, customStartDate, customEndDate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/ads/fetch-today", { method: "POST" });
      const json = await res.json();
      if (json.success) {
        showToast(`✓ Fetched ${json.upserted} ad-days from Meta (last 7 days)`, "success");
      } else {
        showToast(json.error ?? "Refresh failed", "error");
      }
      // Reload even on partial failure: accounts that succeeded were saved
      await loadData();
    } catch {
      showToast("Network error during refresh", "error");
    } finally {
      setRefreshing(false);
    }
  };

  const todayLabel = formatDateRangeLabel(dateRange, customStartDate, customEndDate);

  const handleNativeShare = async () => {
    if (!displayedSummary) return;
    const { generateDailyWhatsAppText } = await import("@/lib/whatsappFormat");
    const text = generateDailyWhatsAppText(displayedSummary, currentProject, todayLabel, selectedCampaign);
    
    // In secure contexts (HTTPS or localhost), try native share first
    if (navigator.share && window.isSecureContext) {
      try {
        await navigator.share({
          title: "Daily Meta Ads Report",
          text: text,
        });
        return; // Success
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          return; // User cancelled share dialog
        }
        // If it failed for another reason, fallback to clipboard
      }
    }
    
    // Fallback 1: Clipboard
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        // Legacy fallback for insecure contexts (e.g. testing on mobile via 192.168.x.x)
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        
        if (!successful) throw new Error("Fallback copy failed");
      }
      showToast("Report copied to clipboard! You can paste it anywhere.", "success");
    } catch (err) {
      // Fallback 2: Open WhatsApp directly
      try {
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
        showToast("Opened WhatsApp directly", "success");
      } catch (e) {
        showToast("Sharing not supported on this browser", "error");
      }
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key.toLowerCase() === 'r') {
        e.preventDefault();
        if (!refreshing) handleRefresh();
      } else if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (summary) handleNativeShare();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [refreshing, summary]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const filteredAds = (displayedSummary?.ads ?? []).filter((a) => !activeAdsOnly || a.spend > 0 || a.impressions > 0 || a.results > 0);
  const sortedAds = [...filteredAds].sort((a, b) => {
    const av = a[sortKey] as number | string;
    const bv = b[sortKey] as number | string;
    if (typeof av === "number" && typeof bv === "number") {
      return sortDir === "asc" ? av - bv : bv - av;
    }
    return sortDir === "asc"
      ? String(av).localeCompare(String(bv))
      : String(bv).localeCompare(String(av));
  });

  const [campSortKey, setCampSortKey] = useState<keyof DailySummary["campaigns"][0]>("spend");
  const [campSortDir, setCampSortDir] = useState<SortDir>("desc");

  const handleCampSort = (key: keyof DailySummary["campaigns"][0]) => {
    if (campSortKey === key) {
      setCampSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setCampSortKey(key);
      setCampSortDir("desc");
    }
  };

  const SortIcon = ({ col, isCamp = false }: { col: string; isCamp?: boolean }) => {
    const sKey = isCamp ? campSortKey : sortKey;
    const sDir = isCamp ? campSortDir : sortDir;
    return sKey === col ? (
      sDir === "asc" ? (
        <ChevronUp className="w-3 h-3 inline ml-1 text-blue-500" />
      ) : (
        <ChevronDown className="w-3 h-3 inline ml-1 text-blue-500" />
      )
    ) : (
      <ChevronsUpDown className="w-3 h-3 inline ml-1 text-slate-300/50" />
    );
  };

  const filteredCampaigns = (displayedSummary?.campaigns ?? []).filter(
    (c) => !activeCampOnly || c.spend > 0 || c.impressions > 0 || c.results > 0
  );
  const sortedCampaigns = [...filteredCampaigns].sort((a, b) => {
    const av = a[campSortKey] as number | string;
    const bv = b[campSortKey] as number | string;
    if (typeof av === "number" && typeof bv === "number") {
      return campSortDir === "asc" ? av - bv : bv - av;
    }
    return campSortDir === "asc"
      ? String(av).localeCompare(String(bv))
      : String(bv).localeCompare(String(av));
  });

  const isAllProjects = currentProject === "all";

  return (
    <div className="p-4 sm:p-8 min-h-screen pb-20 max-w-[1600px] mx-auto space-y-12">
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
      <motion.div 
        initial={{ opacity: 0, y: -10 }} 
        animate={{ opacity: 1, y: 0 }} 
        className="flex flex-col sm:flex-row sm:items-start justify-between gap-6"
      >
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
            {isAllProjects ? "Portfolio Dashboard" : currentProject}
          </h1>
          <p className="text-slate-500 text-sm mt-1.5 font-medium" suppressHydrationWarning>{todayLabel}</p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 w-full sm:w-auto">
          <div className="relative flex gap-2 w-full sm:w-auto">
            {dateRange !== "custom" && (
              <div className="relative flex-1 sm:flex-none">
                <select
                  value={dateRange}
                  onChange={(e) => setDateRange(e.target.value as any)}
                  className="appearance-none w-full pl-9 pr-8 py-2.5 sm:py-2 bg-white border border-slate-200 hover:border-slate-300 rounded-xl text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all cursor-pointer shadow-sm h-[44px] sm:h-auto"
                >
                  <option value="today">Today</option>
                  <option value="yesterday">Yesterday</option>
                  <option value="7d">Last 7 Days</option>
                  <option value="14d">Last 14 Days</option>
                  <option value="30d">Last 30 Days</option>
                  <option value="last_month">Last Month</option>
                </select>
                <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            )}

            {dateRange === "custom" && (
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 bg-white border border-slate-200 rounded-xl p-2 sm:p-1 shadow-sm w-full sm:w-auto h-auto">
                <input 
                  type="date" 
                  value={customStartDate} 
                  onChange={e => setCustomStartDate(e.target.value)}
                  className="w-full sm:flex-1 text-sm px-3 py-2 sm:py-1 bg-slate-50 sm:bg-transparent rounded-lg sm:rounded-none border border-slate-100 sm:border-0 text-slate-700 outline-none h-[44px] sm:h-auto" 
                />
                <span className="text-slate-400 text-sm hidden sm:block px-1">to</span>
                <input 
                  type="date" 
                  value={customEndDate} 
                  onChange={e => setCustomEndDate(e.target.value)}
                  className="w-full sm:flex-1 text-sm px-3 py-2 sm:py-1 bg-slate-50 sm:bg-transparent rounded-lg sm:rounded-none border border-slate-100 sm:border-0 text-slate-700 outline-none h-[44px] sm:h-auto" 
                />
                <button 
                  onClick={() => setDateRange("today")} 
                  className="w-full sm:w-auto px-3 py-2.5 sm:py-1 text-sm font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors border-t border-slate-100 sm:border-0 sm:border-l mt-1 sm:mt-0"
                >
                  Cancel
                </button>
              </div>
            )}

            {dateRange !== "custom" && (
              <button
                onClick={() => setDateRange("custom")}
                className="flex-1 sm:flex-none flex justify-center items-center gap-2 px-3 py-2.5 sm:py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-300 text-sm font-medium text-slate-700 transition-all duration-150 shadow-sm h-[44px] sm:h-auto whitespace-nowrap"
              >
                <Calendar className="w-4 h-4 text-slate-500" />
                <span className="inline">Custom</span>
              </button>
            )}
          </div>

          <div className="flex gap-2 w-full sm:w-auto mt-2 sm:mt-0">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex-1 sm:flex-none flex justify-center items-center gap-2 px-4 py-2.5 sm:py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-300 text-sm font-medium text-slate-700 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm h-[44px] sm:h-auto"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
              <span className="inline">{refreshing ? "Syncing..." : "Sync Now"}</span>
            </button>

            <button
              onClick={handleNativeShare}
              disabled={!summary}
              className="flex-1 sm:flex-none flex justify-center items-center gap-2 px-4 py-2.5 sm:py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-sm font-medium text-white transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm shadow-blue-600/20 h-[44px] sm:h-auto"
            >
              <MessageCircle className="w-4 h-4" />
              <span className="inline">Share<span className="hidden sm:inline"> via WhatsApp</span></span>
            </button>


          </div>
        </div>
      </motion.div>

      {/* Stat Cards */}
      <motion.div 
        initial={{ opacity: 0, y: 10 }} 
        animate={{ opacity: 1, y: 0 }} 
        transition={{ delay: 0.1 }}
      >
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-slate-900 tracking-tight">Top-Level Metrics</h3>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          label="Total Spend"
          value={displayedSummary ? formatINR(displayedSummary.totalSpend) : "₹0"}
          icon={<DollarSign className="w-4 h-4" />}
          change={displayedSummary?.spendChangePct}
          changeLabel="vs prior period"
          loading={loading}
        />
        <StatCard
          label="Total Leads / Results"
          value={displayedSummary ? String(displayedSummary.totalResults) : "0"}
          icon={<Target className="w-4 h-4" />}
          change={displayedSummary?.resultsChangePct}
          changeLabel="vs prior period"
          loading={loading}
        />
        <StatCard
          label="Avg Cost Per Lead"
          value={displayedSummary ? formatINR(displayedSummary.avgCPA) : "₹0"}
          icon={<Users className="w-4 h-4" />}
          change={displayedSummary?.cpaChangePct}
          changeLabel="vs prior period"
          loading={loading}
          invertGood
        />
        <StatCard
          label="Avg CTR"
          value={displayedSummary ? `${formatNum(displayedSummary.avgCTR)}%` : "0%"}
          icon={<MousePointerClick className="w-4 h-4" />}
          loading={loading}
        />
      </div>
      </motion.div>

      {/* Week-over-week change summary */}
      <motion.div 
        initial={{ opacity: 0, y: 10 }} 
        animate={{ opacity: 1, y: 0 }} 
        transition={{ delay: 0.15 }}
        id="snapshot-change-cards" 
        className="grid grid-cols-1 sm:grid-cols-3 gap-6"
      >
        {[
          { label: "Spend Change", value: displayedSummary?.spendChangePct ?? null, invertGood: false },
          { label: "Leads Change", value: displayedSummary?.resultsChangePct ?? null, invertGood: false },
          { label: "Cost/Lead Change", value: displayedSummary?.cpaChangePct ?? null, invertGood: true },
        ].map(({ label, value, invertGood }) => (
          <div key={label} className="rounded-2xl bg-white border border-slate-200 p-5 flex items-center justify-between shadow-sm">
            <span className="text-sm font-semibold text-slate-500">{label}</span>
            <ChangeChip value={value} invertGood={invertGood} />
          </div>
        ))}
      </motion.div>

      {/* Portfolio Breakdown (Only if "all" is selected) */}
      {isAllProjects && portfolio.length > 0 && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }} 
          animate={{ opacity: 1, y: 0 }} 
          transition={{ delay: 0.2 }}
          id="snapshot-portfolio" 
          className="rounded-2xl bg-white border border-slate-200 overflow-hidden shadow-sm"
        >
          <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
            <div>
              <h3 className="font-semibold text-slate-900">Portfolio Breakdown</h3>
              <p className="text-xs text-slate-500 mt-1">Cross-project comparison</p>
            </div>
            <ShareButton elementId="snapshot-portfolio" fileName="portfolio-breakdown" title="Portfolio Breakdown" subtitle={todayLabel} />
          </div>
          <div className="overflow-x-auto w-full">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50/30 border-b border-slate-100">
                <tr>
                  <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">Account Name</th>
                  {ALL_COLUMNS.filter(c => visibleColumns.includes(c.key)).map(col => (
                    <th key={col.key} className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {portfolio.map((p) => (
                  <tr key={`${p.project_name}::${p.account_name}`} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 font-medium text-slate-900 whitespace-nowrap">
                      <div className="max-w-[200px] truncate" title={p.account_name}>{p.account_name}</div>
                    </td>
                    {visibleColumns.includes("spend") && <td className="px-5 py-3 text-slate-600 whitespace-nowrap">{formatINR(p.spend)}</td>}
                    {visibleColumns.includes("impressions") && <td className="px-5 py-3 text-slate-600 whitespace-nowrap">{p.impressions?.toLocaleString("en-IN") || "0"}</td>}
                    {visibleColumns.includes("clicks") && <td className="px-5 py-3 text-slate-600 whitespace-nowrap">{p.clicks?.toLocaleString("en-IN") || "0"}</td>}
                    {visibleColumns.includes("ctr") && <td className="px-5 py-3 text-slate-600 whitespace-nowrap">{formatNum((p as any).ctr || 0)}%</td>}
                    {visibleColumns.includes("cpc") && <td className="px-5 py-3 text-slate-600 whitespace-nowrap">{formatINR((p as any).cpc || 0)}</td>}
                    {visibleColumns.includes("results") && (
                      <td className="px-5 py-3 whitespace-nowrap">
                        <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-semibold min-w-[28px] ${p.results > 0 ? "bg-blue-50 text-blue-700 border border-blue-100" : "bg-slate-100 text-slate-500 border border-slate-200"}`}>{p.results}</span>
                      </td>
                    )}
                    {visibleColumns.includes("cost_per_result") && <td className="px-5 py-3 font-semibold text-slate-900 whitespace-nowrap">
                        <span className={p.results === 0 ? "text-slate-400" : "text-slate-900"}>
                          {p.results === 0 ? "—" : formatINR(p.cost_per_result)}
                        </span>
                    </td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}

      {/* Trend Chart */}
      <motion.div 
        initial={{ opacity: 0, y: 10 }} 
        animate={{ opacity: 1, y: 0 }} 
        transition={{ delay: 0.25 }}
        className="rounded-2xl bg-white border border-slate-200 p-8 shadow-sm"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <h3 className="text-lg font-semibold text-slate-900 tracking-tight">Performance Trend (Last {trendDaysFor(dateRange, customStartDate, customEndDate)} Days)</h3>
          <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
            <button
              onClick={() => setActiveChart("spend")}
              className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${
                activeChart === "spend"
                  ? "bg-white text-slate-900 shadow-sm border border-slate-200/60"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Spend
            </button>
            <button
              onClick={() => setActiveChart("results")}
              className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${
                activeChart === "results"
                  ? "bg-white text-slate-900 shadow-sm border border-slate-200/60"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Results (Leads)
            </button>
          </div>
        </div>

        {loading || trend.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-400">
            {loading ? (
              <div className="h-full w-full bg-slate-50 rounded-xl animate-pulse" />
            ) : (
              <p className="text-sm">No trend data yet.</p>
            )}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={trend} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis
                dataKey="date"
                tick={{ fill: "#64748b", fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                dy={10}
              />
              <YAxis
                tick={{ fill: "#64748b", fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                dx={-10}
                tickFormatter={(v) =>
                  activeChart === "spend" ? `₹${(v / 1000).toFixed(0)}k` : String(v)
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
                itemStyle={{ color: "#0f172a", fontWeight: 600 }}
              />
              <Line
                type="monotone"
                dataKey={activeChart}
                stroke="#3b82f6"
                strokeWidth={3}
                isAnimationActive={false}
                dot={{ fill: "#ffffff", stroke: "#3b82f6", strokeWidth: 2, r: 4 }}
                activeDot={{ r: 6, fill: "#3b82f6", stroke: "#ffffff", strokeWidth: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </motion.div>

      {/* Campaign Performance Section */}
      <motion.div
        initial={{ opacity: 0, y: 10 }} 
        animate={{ opacity: 1, y: 0 }} 
        transition={{ delay: 0.3 }}
        className="space-y-6"
      >
        {/* Filters Row */}
        <div className="flex flex-col xl:flex-row gap-6">
        {/* Campaign Filter Dropdown */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 bg-white p-3 sm:p-4 rounded-xl border border-slate-200 shadow-sm flex-1">
          <span className="text-sm font-semibold text-slate-700 sm:ml-2 whitespace-nowrap">Campaign:</span>
          <div className="relative flex-1 w-full min-w-0">
            <select
              value={selectedCampaign}
              onChange={(e) => setSelectedCampaign(e.target.value)}
              disabled={availableCampaigns.length === 0}
              className="w-full appearance-none bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-lg pl-3 pr-10 py-2.5 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed truncate"
            >
              <option value="all">All Campaigns</option>
              {availableCampaigns.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        {/* Columns Toggle */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 bg-white p-3 sm:p-4 rounded-xl border border-slate-200 shadow-sm flex-1">
          <span className="text-sm font-semibold text-slate-700 sm:ml-2 whitespace-nowrap">Columns:</span>
          <div className="flex-1 flex flex-wrap gap-2">
            {ALL_COLUMNS.map(col => (
              <button
                key={col.key}
                onClick={() => setVisibleColumns(prev => prev.includes(col.key) ? prev.filter(k => k !== col.key) : [...prev, col.key])}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
                  visibleColumns.includes(col.key) 
                    ? 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100' 
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {col.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Campaign Performance Table */}
      <div id="snapshot-campaigns" className="rounded-2xl bg-white border border-slate-200 overflow-hidden shadow-sm">
        <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-6 bg-slate-50/50">
          <div>
            <h3 className="text-lg font-semibold text-slate-900 tracking-tight">Campaign Performance</h3>
            <p className="text-xs text-slate-500 mt-1">Rollup by campaign</p>
          </div>
          <div className="flex items-center gap-4">
            <ShareButton elementId="snapshot-campaigns" fileName="campaign-performance" title="Campaign Performance" subtitle={todayLabel} />
            <label className="text-sm font-medium text-slate-600 cursor-pointer flex items-center gap-2 select-none">
              <input 
                type="checkbox" 
                checked={activeCampOnly}
                onChange={(e) => setActiveCampOnly(e.target.checked)}
                className="w-4 h-4 rounded text-blue-600 border-slate-300 focus:ring-blue-500"
              />
              Active Campaigns Only (Activity &gt; 0)
            </label>
          </div>
        </div>

        <div className="overflow-x-auto w-full">
          {loading ? (
            <div className="p-6 space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-10 bg-slate-50 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : sortedCampaigns.length === 0 ? (
            <div className="p-16 text-center text-slate-400">
              <p className="text-sm font-medium text-slate-600">No campaign data for today.</p>
            </div>
          ) : (
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50/30 border-b border-slate-100">
                <tr>
                  <th
                    onClick={() => handleCampSort("campaign_name")}
                    className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 hover:text-slate-800 transition-colors whitespace-nowrap"
                  >
                    Campaign
                    <SortIcon col={"campaign_name"} isCamp={true} />
                  </th>
                  {ALL_COLUMNS.filter(c => visibleColumns.includes(c.key)).map(col => (
                    <th
                      key={col.key}
                      onClick={() => handleCampSort(col.key as any)}
                      className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 hover:text-slate-800 transition-colors whitespace-nowrap"
                    >
                      {col.label}
                      <SortIcon col={col.key as any} isCamp={true} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {sortedCampaigns.map((camp) => (
                  <tr
                    key={camp.campaign_name}
                    className="hover:bg-slate-50 transition-colors group"
                  >
                    <td className="px-5 py-3 border-b border-slate-50 bg-white whitespace-nowrap">
                      <div className="font-medium text-slate-900 max-w-[280px] truncate" title={camp.campaign_name}>
                        {camp.campaign_name}
                      </div>
                    </td>
                    {visibleColumns.includes("spend") && (
                      <td className="px-5 py-3 font-medium text-slate-700 whitespace-nowrap border-b border-slate-50">
                        {formatINR(camp.spend)}
                      </td>
                    )}
                    {visibleColumns.includes("impressions") && (
                      <td className="px-5 py-3 text-slate-500 whitespace-nowrap border-b border-slate-50">
                        {camp.impressions.toLocaleString("en-IN")}
                      </td>
                    )}
                    {visibleColumns.includes("clicks") && (
                      <td className="px-5 py-3 text-slate-500 whitespace-nowrap border-b border-slate-50">
                        {camp.clicks.toLocaleString("en-IN")}
                      </td>
                    )}
                    {visibleColumns.includes("ctr") && (
                      <td className="px-5 py-3 text-slate-500 whitespace-nowrap border-b border-slate-50">
                        {formatNum((camp as any).ctr || 0)}%
                      </td>
                    )}
                    {visibleColumns.includes("cpc") && (
                      <td className="px-5 py-3 text-slate-500 whitespace-nowrap border-b border-slate-50">
                        {formatINR((camp as any).cpc || 0)}
                      </td>
                    )}
                    {visibleColumns.includes("results") && (
                      <td className="px-5 py-3 border-b border-slate-50 whitespace-nowrap">
                        <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-semibold min-w-[28px] ${camp.results > 0 ? "bg-blue-50 text-blue-700 border border-blue-100" : "bg-slate-100 text-slate-500 border border-slate-200"}`}>
                          {camp.results}
                        </span>
                      </td>
                    )}
                    {visibleColumns.includes("cost_per_result") && (
                      <td className="px-5 py-3 font-semibold whitespace-nowrap border-b border-slate-50">
                        <span className={camp.results === 0 ? "text-slate-400" : "text-slate-900"}>
                          {camp.results === 0 ? "—" : formatINR(camp.cost_per_result)}
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Ad Performance Table */}
      <div id="snapshot-ads" className="rounded-2xl bg-white border border-slate-200 overflow-hidden shadow-sm">
        <div className="p-4 sm:p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50/50">
          <div>
            <h3 className="font-semibold text-slate-900">Ad Performance</h3>
            <p className="text-xs text-slate-500 mt-1">Click column headers to sort</p>
          </div>
          <div className="flex items-center gap-4">
            <ShareButton elementId="snapshot-ads" fileName="ad-performance" title="Ad Performance" subtitle={todayLabel} />
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
            <label className="text-sm font-medium text-slate-600 cursor-pointer flex items-center gap-2 select-none">
              <input 
                type="checkbox" 
                checked={activeAdsOnly}
                onChange={(e) => setActiveAdsOnly(e.target.checked)}
                className="w-4 h-4 rounded text-blue-600 border-slate-300 focus:ring-blue-500"
              />
              Active Ads Only (Activity &gt; 0)
            </label>
          </div>
        </div>

        <div className="p-4 sm:p-6 bg-slate-50/30 border-b border-slate-100">
          <div className="space-y-8">
            {(adScope === "overall" || !displayedSummary?.campaigns
              ? [{ campaign_name: "Overall", top_ads: displayedSummary?.topAds ?? [], bottom_ads: displayedSummary?.bottomAds ?? [] }]
              : displayedSummary.campaigns
            ).map((group, groupIdx) => (
              <div key={groupIdx} className="space-y-4">
                {adScope === "per-campaign" && (
                  <h3 className="text-sm font-semibold text-slate-700 border-b border-slate-200 pb-2">{group.campaign_name}</h3>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
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
        </div>

        <div className="overflow-x-auto w-full">
          {loading ? (
            <div className="p-6 space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-10 bg-slate-50 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : sortedAds.length === 0 ? (
            <div className="p-16 text-center text-slate-400">
              <Target className="w-12 h-12 mx-auto mb-4 text-slate-200" />
              <p className="text-sm font-medium text-slate-600">No ad data for today.</p>
              <p className="text-xs mt-1">Click &ldquo;Sync Now&rdquo; to pull from Meta.</p>
            </div>
          ) : (
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50/30 border-b border-slate-100">
                <tr>
                  <th
                    onClick={() => handleSort("ad_name")}
                    className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 hover:text-slate-800 transition-colors whitespace-nowrap"
                  >
                    Ad & Campaign
                    <SortIcon col={"ad_name"} />
                  </th>
                  {ALL_COLUMNS.filter(c => visibleColumns.includes(c.key)).map(col => (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key as any)}
                      className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 hover:text-slate-800 transition-colors whitespace-nowrap"
                    >
                      {col.label}
                      <SortIcon col={col.key as any} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {(adScope === "overall" 
                  ? sortedAds 
                  : Array.from(new Set(sortedAds.map(a => a.campaign_name)))
                      .map(campName => {
                        const campAds = sortedAds.filter(a => a.campaign_name === campName);
                        const campSpend = campAds.reduce((sum, a) => sum + a.spend, 0);
                        return { campName, campAds, campSpend };
                      })
                      .sort((a, b) => b.campSpend - a.campSpend)
                      .flatMap(({ campName, campAds }) => [
                        { isHeader: true, title: campName, id: `header-${campName}` },
                        ...campAds
                      ])
                ).map((item: any) => {
                  if (item.isHeader) {
                    return (
                      <tr key={item.id} className="bg-slate-50/80">
                        <td colSpan={1 + visibleColumns.length} className="px-5 py-2 font-bold text-slate-700 text-xs uppercase tracking-wider">
                          {item.title}
                        </td>
                      </tr>
                    );
                  }
                  
                  const ad = item;
                  return (
                    <tr
                      key={ad.ad_id}
                      className="hover:bg-slate-50 transition-colors group"
                    >
                      <td className="px-5 py-3 border-b border-slate-50 bg-white whitespace-nowrap">
                        <div className="max-w-[280px]">
                          <p className="font-medium text-slate-900 truncate text-sm" title={ad.ad_name}>
                            {ad.ad_name}
                          </p>
                          <p className="text-xs text-slate-500 truncate mt-0.5" title={ad.campaign_name}>
                            {isAllProjects && <span className="font-medium text-blue-600 mr-1">[{ad.project_name}]</span>}
                            {ad.campaign_name}
                          </p>
                        </div>
                      </td>
                      {visibleColumns.includes("spend") && (
                        <td className="px-5 py-3 font-medium text-slate-700 whitespace-nowrap border-b border-slate-50">
                          {formatINR(ad.spend)}
                        </td>
                      )}
                      {visibleColumns.includes("impressions") && (
                        <td className="px-5 py-3 text-slate-500 whitespace-nowrap border-b border-slate-50">
                          {ad.impressions.toLocaleString("en-IN")}
                        </td>
                      )}
                      {visibleColumns.includes("clicks") && (
                        <td className="px-5 py-3 text-slate-500 whitespace-nowrap border-b border-slate-50">
                          {ad.clicks.toLocaleString("en-IN")}
                        </td>
                      )}
                      {visibleColumns.includes("ctr") && (
                        <td className="px-5 py-3 text-slate-500 whitespace-nowrap border-b border-slate-50">
                          {formatNum(ad.ctr || 0)}%
                        </td>
                      )}
                      {visibleColumns.includes("cpc") && (
                        <td className="px-5 py-3 text-slate-500 whitespace-nowrap border-b border-slate-50">
                          {formatINR(ad.cpc || 0)}
                        </td>
                      )}
                      {visibleColumns.includes("results") && (
                        <td className="px-5 py-3 border-b border-slate-50 whitespace-nowrap">
                          <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-semibold min-w-[28px] ${ad.results > 0 ? "bg-blue-50 text-blue-700 border border-blue-100" : "bg-slate-100 text-slate-500 border border-slate-200"}`}>
                            {ad.results}
                          </span>
                        </td>
                      )}
                      {visibleColumns.includes("cost_per_result") && (
                        <td className="px-5 py-3 font-semibold whitespace-nowrap border-b border-slate-50">
                          <span className={ad.results === 0 ? "text-slate-400" : "text-slate-900"}>
                            {ad.results === 0 ? "—" : formatINR(ad.cost_per_result)}
                          </span>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
      </motion.div>
      {summary && (
        <>
          <SnapshotStatCards
            id="snapshot-stat-cards"
            title={`${isAllProjects ? 'Portfolio' : currentProject} Performance`}
            subtitle={todayLabel}
            stats={[
              { label: "Total Spend", value: displayedSummary ? formatINR(displayedSummary.totalSpend) : "₹0", icon: "spend" },
              { label: "Total Leads", value: displayedSummary ? String(displayedSummary.totalResults) : "0", icon: "leads" },
              { label: "Cost Per Lead", value: displayedSummary ? formatINR(displayedSummary.avgCPA) : "₹0", icon: "cpa" },
              { label: "Avg CTR", value: displayedSummary ? `${formatNum(displayedSummary.avgCTR)}%` : "0%", icon: "ctr" },
            ]}
          />
          {isAllProjects && portfolio.length > 0 && (
            <SnapshotTable
              id="snapshot-portfolio"
              title="Portfolio Breakdown"
              subtitle={todayLabel}
              columns={["Project Name", "Account Name", "Spend", "Leads", "Cost/Lead"]}
              data={portfolio}
              renderRow={(p, i) => (
                <tr key={i}>
                  <td className="px-5 py-2.5 font-medium">{p.project_name}</td>
                  <td className="px-5 py-2.5">{p.account_name}</td>
                  <td className="px-5 py-2.5">{formatINR(p.spend)}</td>
                  <td className="px-5 py-2.5">{p.results}</td>
                  <td className="px-5 py-2.5">{formatINR(p.cost_per_result)}</td>
                </tr>
              )}
            />
          )}
          {!isAllProjects && sortedCampaigns.length > 0 && (
            <SnapshotTable
              id="snapshot-campaigns"
              title={`${currentProject} Campaigns`}
              subtitle={todayLabel}
              columns={["Campaign", "Spend", "Leads", "Cost/Lead"]}
              data={sortedCampaigns}
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
          {!isAllProjects && sortedAds.length > 0 && (
            <SnapshotTable
              id="snapshot-ads"
              title={`${currentProject} Ads`}
              subtitle={todayLabel}
              columns={["Ad & Campaign", "Spend", "Leads", "Cost/Lead"]}
              data={sortedAds}
              renderRow={(ad, i) => (
                <tr key={i}>
                  <td className="px-5 py-2.5">
                    <p className="font-medium text-slate-900">{ad.ad_name}</p>
                    <p className="text-xs text-slate-500">{ad.campaign_name}</p>
                  </td>
                  <td className="px-5 py-2.5">{formatINR(ad.spend)}</td>
                  <td className="px-5 py-2.5">{ad.results}</td>
                  <td className="px-5 py-2.5">{formatINR(ad.cost_per_result)}</td>
                </tr>
              )}
            />
          )}
        </>
      )}
    </div>
  );
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

export default function DailyDashboard() {
  return (
    <Suspense fallback={<div className="p-8 text-slate-500">Loading Dashboard...</div>}>
      <DashboardClient />
    </Suspense>
  );
}
