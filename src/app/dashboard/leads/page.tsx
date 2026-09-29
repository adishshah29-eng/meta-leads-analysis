"use client";

import { useEffect, useState, useMemo } from "react";
import {
  RefreshCw,
  Search,
  Calendar,
  Users,
  Download,
  BarChart3,
  Table as TableIcon
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { motion } from "framer-motion";
import { addDays, dayRangeToInstants, todayInAppTz } from "@/lib/dates";

interface LeadRow {
  id: string;
  lead_id: string;
  created_time: string;
  ad_name: string;
  campaign_name: string;
  project_name: string;
  field_data: Record<string, string>;
  status?: string;
}

export default function LeadsPage() {
  const searchParams = useSearchParams();
  const currentProject = searchParams.get("project") || "all";

  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState("all");
  const [selectedAd, setSelectedAd] = useState("all");
  const [selectedProjectFilter, setSelectedProjectFilter] = useState("all");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [viewMode, setViewMode] = useState<"table" | "insights">("table");

  // Since time_created is what matters for leads, let's keep it simple with a date range
  const [dateRange, setDateRange] = useState<"today" | "yesterday" | "7d" | "30d" | "all">("30d");
  const [selectedStatus, setSelectedStatus] = useState("all");

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchLeads = async () => {
    setLoading(true);
    try {
      let startDateStr = "";
      let endDateStr = "";

      // IST calendar days (same definition as the Ads dashboard presets)
      if (dateRange !== "all") {
        const today = todayInAppTz();
        const startDay =
          dateRange === "yesterday" ? addDays(today, -1)
          : dateRange === "7d" ? addDays(today, -6)
          : dateRange === "30d" ? addDays(today, -29)
          : today;
        const endDay = dateRange === "yesterday" ? addDays(today, -1) : today;
        const { from, toExclusive } = dayRangeToInstants(startDay, endDay);
        startDateStr = from;
        endDateStr = toExclusive;
      }

      const params = new URLSearchParams();
      if (currentProject !== "all") params.set("project", currentProject);
      if (startDateStr) params.set("startDate", startDateStr);
      if (endDateStr) params.set("endDate", endDateStr);

      const res = await fetch(`/api/leads?${params.toString()}`);
      const json = await res.json();
      
      if (!json.success) {
        throw new Error(json.error || "Failed to load leads");
      }
      
      setLeads(json.leads || []);
    } catch (err: any) {
      console.error(err);
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProject, dateRange]);

  const handleSyncLeads = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const res = await fetch(`/api/leads/fetch?days=7`, { method: "POST" });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      // Partial failures still saved the leads from ads that succeeded
      showToast(json.message ?? `Synced ${json.upserted} leads.`, json.success ? "success" : "error");
      await fetchLeads();
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setRefreshing(false);
    }
  };

  const handleDownloadCSV = () => {
    if (filteredLeads.length === 0) {
      showToast("No leads to download", "error");
      return;
    }

    const headers = ["Time", "Project", "Campaign", "Ad", ...dynamicColumns];
    const rows = filteredLeads.map(lead => {
      return [
        new Date(lead.created_time).toLocaleString(),
        lead.project_name || "",
        lead.campaign_name || "",
        lead.ad_name || "",
        ...dynamicColumns.map(col => lead.field_data?.[col] || "")
      ].map(val => `"${String(val).replace(/"/g, '""')}"`).join(",");
    });

    const csvContent = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `leads_export_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast("Download started", "success");
  };

  const handleStatusChange = async (leadId: string, newStatus: string) => {
    // Optimistic UI update
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status: newStatus } : l));
    
    try {
      const res = await fetch("/api/leads", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: leadId, status: newStatus })
      });
      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error || "Failed to update status");
      }
      showToast("Status updated", "success");
    } catch (err: any) {
      showToast(err.message, "error");
      // Revert optimistic update on failure (requires a re-fetch or storing old state)
      fetchLeads();
    }
  };

  // Reset dependent filters when parent filter changes
  useEffect(() => {
    setSelectedCampaign("all");
    setSelectedAd("all");
  }, [selectedProjectFilter]);

  useEffect(() => {
    setSelectedAd("all");
  }, [selectedCampaign]);

  const availableProjects = useMemo(() => {
    const projs = leads.map((lead) => lead.project_name?.trim()).filter(Boolean);
    const unique = Array.from(new Set(projs));
    return unique.sort((a, b) => a.localeCompare(b));
  }, [leads]);

  const availableCampaigns = useMemo(() => {
    let filtered = leads;
    if (selectedProjectFilter !== "all") {
      filtered = filtered.filter(l => l.project_name?.trim() === selectedProjectFilter);
    }
    const camps = filtered.map((lead) => lead.campaign_name?.trim()).filter(Boolean);
    const unique = Array.from(new Set(camps));
    return unique.sort((a, b) => a.localeCompare(b));
  }, [leads, selectedProjectFilter]);

  const availableAds = useMemo(() => {
    let filtered = leads;
    if (selectedProjectFilter !== "all") {
      filtered = filtered.filter(l => l.project_name?.trim() === selectedProjectFilter);
    }
    if (selectedCampaign !== "all") {
      filtered = filtered.filter(l => l.campaign_name?.trim() === selectedCampaign);
    }
    const ads = filtered.map((lead) => lead.ad_name?.trim()).filter(Boolean);
    const unique = Array.from(new Set(ads));
    return unique.sort((a, b) => a.localeCompare(b));
  }, [leads, selectedProjectFilter, selectedCampaign]);

  const filteredLeads = useMemo(() => {
    let result = leads;
    if (selectedProjectFilter !== "all") {
      result = result.filter(lead => lead.project_name?.trim() === selectedProjectFilter);
    }
    if (selectedCampaign !== "all") {
      result = result.filter(lead => lead.campaign_name?.trim() === selectedCampaign);
    }
    if (selectedAd !== "all") {
      result = result.filter(lead => lead.ad_name?.trim() === selectedAd);
    }
    if (selectedStatus !== "all") {
      result = result.filter(lead => (lead.status || "New").toLowerCase() === selectedStatus.toLowerCase());
    }
    return result;
  }, [leads, selectedProjectFilter, selectedCampaign, selectedAd, selectedStatus]);

  // Extract all unique field keys to form dynamic columns
  const dynamicColumns = useMemo(() => {
    const keys = new Set<string>();
    leads.forEach(lead => {
      if (lead.field_data) {
        Object.keys(lead.field_data).forEach(k => keys.add(k));
      }
    });
    return Array.from(keys);
  }, [leads]);

  const insightFields = useMemo(() => {
    return dynamicColumns.filter(c => !["email", "full_name", "phone_number"].includes(c.toLowerCase()));
  }, [dynamicColumns]);

  const generateChartData = (field: string) => {
    const counts: Record<string, number> = {};
    filteredLeads.forEach(lead => {
      let val = lead.field_data?.[field];
      if (val) {
        val = String(val).trim();
        counts[val] = (counts[val] || 0) + 1;
      }
    });
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  };

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto space-y-10">
      {toast && (
        <div className={`fixed top-4 right-4 px-4 py-3 rounded-lg shadow-lg z-50 text-white ${toast.type === "error" ? "bg-red-500" : "bg-emerald-500"} animate-in fade-in slide-in-from-top-2`}>
          {toast.message}
        </div>
      )}

      {/* Header */}
      <motion.div 
        initial={{ opacity: 0, y: -10 }} 
        animate={{ opacity: 1, y: 0 }} 
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm"
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center">
            <Users className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
              Lead Center
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              {currentProject === "all" ? "All Projects" : currentProject}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          {/* View Toggle */}
          <div className="flex bg-slate-100/80 p-1.5 rounded-xl w-full sm:w-auto shadow-sm border border-slate-200/50">
            <button
              onClick={() => setViewMode("table")}
              className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2 text-sm font-medium rounded-lg transition-all ${
                viewMode === "table"
                  ? "bg-white text-slate-900 shadow-sm border border-slate-200/50"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/50"
              }`}
            >
              <TableIcon className="w-4 h-4" />
              Table
            </button>
            <button
              onClick={() => setViewMode("insights")}
              className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2 text-sm font-medium rounded-lg transition-all ${
                viewMode === "insights"
                  ? "bg-white text-slate-900 shadow-sm border border-slate-200/50"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/50"
              }`}
            >
              <BarChart3 className="w-4 h-4" />
              Insights
            </button>
          </div>

          <div className="flex bg-slate-100/80 p-1 rounded-xl">
            {(["today", "yesterday", "7d", "30d", "all"] as const).map((range) => (
              <button
                key={range}
                onClick={() => setDateRange(range)}
                className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg transition-all ${
                  dateRange === range
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/50"
                }`}
              >
                {range === "today" ? "Today" : 
                 range === "yesterday" ? "Yesterday" : 
                 range === "7d" ? "7D" : 
                 range === "30d" ? "30D" : "All Time"}
              </button>
            ))}
          </div>

          <button
            onClick={handleDownloadCSV}
            className="flex-1 sm:flex-none flex justify-center items-center gap-2 px-4 py-2.5 sm:py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-300 text-sm font-medium text-slate-700 transition-all shadow-sm h-[44px] sm:h-auto"
          >
            <Download className="w-4 h-4" />
            <span className="inline">Download CSV</span>
          </button>

          <button
            onClick={handleSyncLeads}
            disabled={refreshing}
            className="flex-1 sm:flex-none flex justify-center items-center gap-2 px-4 py-2.5 sm:py-2 rounded-xl bg-blue-600 hover:bg-blue-700 border border-transparent text-sm font-medium text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm h-[44px] sm:h-auto"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            <span className="inline">{refreshing ? "Syncing..." : "Sync Today's Leads"}</span>
          </button>
        </div>
      </motion.div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col">
        {/* Search & Filters */}
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row gap-4 justify-end flex-wrap">
          
          <div className="relative flex-1 sm:max-w-xs min-w-[200px]">
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="w-full appearance-none bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-xl px-4 py-2 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all cursor-pointer truncate"
            >
              <option value="all">All Statuses</option>
              <option value="new">New</option>
              <option value="contacted">Contacted</option>
              <option value="qualified">Qualified</option>
              <option value="junk">Junk</option>
            </select>
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
              <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>

          {currentProject === "all" && (
            <div className="relative flex-1 sm:max-w-xs min-w-[200px]">
              <select
                value={selectedProjectFilter}
                onChange={(e) => setSelectedProjectFilter(e.target.value)}
                disabled={availableProjects.length === 0}
                className="w-full appearance-none bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-xl px-4 py-2 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed truncate"
              >
                <option value="all">All Projects</option>
                {availableProjects.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
          )}

          <div className="relative flex-1 sm:max-w-xs min-w-[200px]">
            <select
              value={selectedCampaign}
              onChange={(e) => setSelectedCampaign(e.target.value)}
              disabled={availableCampaigns.length === 0}
              className="w-full appearance-none bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-xl px-4 py-2 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed truncate"
            >
              <option value="all">All Campaigns</option>
              {availableCampaigns.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
              <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>

          <div className="relative flex-1 sm:max-w-xs min-w-[200px]">
            <select
              value={selectedAd}
              onChange={(e) => setSelectedAd(e.target.value)}
              disabled={availableAds.length === 0}
              className="w-full appearance-none bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-xl px-4 py-2 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed truncate"
            >
              <option value="all">All Ads</option>
              {availableAds.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
              <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="overflow-x-auto min-h-[400px]">
          {loading ? (
            <div className="flex items-center justify-center h-64 text-slate-400">
              <RefreshCw className="w-6 h-6 animate-spin mb-2" />
            </div>
          ) : filteredLeads.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-500 space-y-3">
              <Users className="w-12 h-12 text-slate-300" />
              <p>No leads found for the selected criteria.</p>
            </div>
          ) : viewMode === "insights" ? (
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {insightFields.map(field => {
                const data = generateChartData(field);
                if (data.length === 0) return null;
                
                // If there are many categories, use BarChart, else PieChart
                const isMany = data.length > 5;
                
                return (
                  <div key={field} className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm flex flex-col h-[300px]">
                    <h3 className="text-sm font-semibold text-slate-700 capitalize mb-4 truncate text-center" title={field.replace(/_/g, " ")}>
                      {field.replace(/_/g, " ")}
                    </h3>
                    <div className="flex-1 min-h-0">
                      <ResponsiveContainer width="100%" height="100%">
                        {isMany ? (
                          <BarChart data={data} layout="vertical" margin={{ left: 20, right: 20, top: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#e2e8f0" />
                            <XAxis type="number" hide />
                            <YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
                            <RechartsTooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                            <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]}>
                              {data.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                              ))}
                            </Bar>
                          </BarChart>
                        ) : (
                          <PieChart>
                            <Pie
                              data={data}
                              cx="50%"
                              cy="50%"
                              innerRadius={60}
                              outerRadius={80}
                              paddingAngle={5}
                              dataKey="value"
                            >
                              {data.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                              ))}
                            </Pie>
                            <RechartsTooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                            <Legend iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
                          </PieChart>
                        )}
                      </ResponsiveContainer>
                    </div>
                  </div>
                );
              })}
              {insightFields.length === 0 && (
                 <div className="col-span-full flex items-center justify-center h-48 text-slate-500">
                   No dynamic fields available for insights.
                 </div>
              )}
            </div>
          ) : (
            <table className="w-full text-left border-collapse whitespace-nowrap text-sm">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-medium">
                  <th className="px-6 py-3">Time</th>
                  <th className="px-6 py-3">Status</th>
                  {currentProject === "all" && <th className="px-6 py-3">Project</th>}
                  <th className="px-6 py-3">Campaign</th>
                  {dynamicColumns.map(col => (
                    <th key={col} className="px-6 py-3 capitalize">{col.replace(/_/g, " ")}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredLeads.map((lead) => (
                  <tr key={lead.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      {new Date(lead.created_time).toLocaleString()}
                    </td>
                    <td className="px-6 py-4">
                      <select
                        value={lead.status || "New"}
                        onChange={(e) => handleStatusChange(lead.id, e.target.value)}
                        className={`text-xs font-semibold px-2.5 py-1 rounded-full border cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all ${
                          lead.status === 'Contacted' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                          lead.status === 'Qualified' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                          lead.status === 'Junk' ? 'bg-rose-50 text-rose-700 border-rose-200' :
                          'bg-blue-50 text-blue-700 border-blue-200'
                        }`}
                      >
                        <option value="New" className="bg-white text-slate-900">New</option>
                        <option value="Contacted" className="bg-white text-slate-900">Contacted</option>
                        <option value="Qualified" className="bg-white text-slate-900">Qualified</option>
                        <option value="Junk" className="bg-white text-slate-900">Junk</option>
                      </select>
                    </td>
                    {currentProject === "all" && (
                      <td className="px-6 py-4 font-medium text-slate-900">
                        {lead.project_name}
                      </td>
                    )}
                    <td className="px-6 py-4 text-slate-600">
                      <div className="max-w-[200px] truncate" title={lead.campaign_name}>
                        {lead.campaign_name}
                      </div>
                    </td>
                    {dynamicColumns.map(col => (
                      <td key={col} className="px-6 py-4 text-slate-900">
                        {lead.field_data?.[col] || "-"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
