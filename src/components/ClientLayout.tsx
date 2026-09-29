"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { AlertTriangle, Menu, XCircle, Zap } from "lucide-react";
import { Sidebar } from "@/components/Sidebar";

type Level = "ok" | "warn" | "error";

export function ClientLayout({
  children,
  projects,
}: {
  children: React.ReactNode;
  projects: string[];
}) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const onDashboard = pathname.startsWith("/dashboard");

  // Sync-health summary for the banner + sidebar badge (checked once per page)
  const [health, setHealth] = useState<{ overall: Level; issues: Array<{ level: Level; text: string }> } | null>(null);
  useEffect(() => {
    if (!onDashboard) return;
    let cancelled = false;
    fetch("/api/health", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && j?.overall) setHealth(j); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [onDashboard, pathname]);

  const showBanner = onDashboard && pathname !== "/dashboard/health" && health && health.overall !== "ok" && health.issues.length > 0;
  const qs = searchParams.toString();

  return (
    <div className="flex min-h-screen relative">
      {/* Mobile Header with Hamburger Menu */}
      <div className="lg:hidden fixed top-0 left-0 w-full h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 z-40 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-md shadow-blue-500/20">
            <Zap className="w-4 h-4 text-white" />
          </div>
          <p className="text-sm font-bold text-slate-900 leading-tight">Meta Ads Dashboard</p>
        </div>
        <button
          onClick={() => setIsSidebarOpen(true)}
          className="p-2 -mr-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <Menu className="w-6 h-6" />
        </button>
      </div>

      {/* Sidebar Overlay (Mobile) */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40 lg:hidden transition-opacity"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <Sidebar
        projects={projects}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        healthLevel={health?.overall ?? null}
      />

      {/* Main Content Area */}
      <main className="flex-1 lg:ml-64 min-h-screen pt-16 lg:pt-0 w-full max-w-full overflow-x-hidden">
        {showBanner && (
          <div
            role="alert"
            className={`flex items-start sm:items-center gap-2 px-4 py-2.5 text-sm border-b ${
              health.overall === "error" ? "bg-red-50 border-red-200 text-red-800" : "bg-amber-50 border-amber-200 text-amber-900"
            }`}
          >
            {health.overall === "error" ? <XCircle className="w-4 h-4 shrink-0 mt-0.5 sm:mt-0" aria-hidden /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 sm:mt-0" aria-hidden />}
            <span className="flex-1 min-w-0">
              <strong className="font-semibold">Numbers may be incomplete:</strong> {health.issues[0].text}
              {health.issues.length > 1 ? ` (+${health.issues.length - 1} more)` : ""}
            </span>
            <Link href={`/dashboard/health${qs ? `?${qs}` : ""}`} className="font-semibold underline underline-offset-2 whitespace-nowrap">
              View details
            </Link>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
