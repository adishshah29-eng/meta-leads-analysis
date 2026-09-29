"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  BarChart3,
  Calendar,
  MessageCircle,
  RefreshCw,
  TrendingUp,
  Zap,
  ChevronDown,
  Building2,
  LayoutGrid,
  Check,
  X,
  Users,
  Activity
} from "lucide-react";
import { useState, useRef, useEffect } from "react";

const navItems = [
  {
    label: "Daily Dashboard",
    href: "/dashboard",
    icon: BarChart3,
  },
  {
    label: "Weekly Report",
    href: "/dashboard/weekly",
    icon: Calendar,
  },
  {
    label: "Leads",
    href: "/dashboard/leads",
    icon: Users,
  },
  {
    label: "Data Health",
    href: "/dashboard/health",
    icon: Activity,
  },
];


export function Sidebar({ 
  projects = [],
  isOpen = false,
  onClose = () => {},
  healthLevel = null,
}: { 
  projects?: string[];
  isOpen?: boolean;
  onClose?: () => void;
  healthLevel?: "ok" | "warn" | "error" | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentProject = searchParams.get("project") || "all";

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleProjectSelect = (val: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (val === "all") {
      params.delete("project");
    } else {
      params.set("project", val);
    }
    router.push(`${pathname}?${params.toString()}`);
    setDropdownOpen(false);
    onClose();
  };

  const createHref = (basePath: string) => {
    const params = new URLSearchParams(searchParams.toString());
    return `${basePath}${params.toString() ? `?${params.toString()}` : ""}`;
  };

  return (
    <aside className={`fixed left-0 top-0 h-full w-64 bg-white border-r border-slate-200 flex flex-col z-50 shadow-sm transition-transform duration-300 transform lg:translate-x-0 ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
      {/* Logo */}
      <div className="p-6 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-md shadow-blue-500/20">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900 leading-tight">Meta Ads</p>
            <p className="text-xs text-slate-500">Dashboard</p>
          </div>
        </div>
        <button onClick={onClose} className="lg:hidden p-2 -mr-2 text-slate-500 hover:bg-slate-100 rounded-lg">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Project Selector */}
      <div className="p-4 border-b border-slate-100">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 px-1">
          Active Portfolio
        </p>
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="w-full bg-white border border-slate-200 hover:border-blue-400 hover:bg-slate-50 transition-all rounded-xl p-3 flex items-center justify-between shadow-sm group focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center shrink-0 group-hover:bg-white group-hover:shadow-sm transition-all">
                {currentProject === "all" ? (
                  <LayoutGrid className="w-4 h-4 text-blue-500" />
                ) : (
                  <Building2 className="w-4 h-4 text-indigo-500" />
                )}
              </div>
              <span className="text-sm font-semibold text-slate-800 truncate">
                {currentProject === "all" ? "Portfolio Overview" : currentProject}
              </span>
            </div>
            <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform duration-200 ${dropdownOpen ? "rotate-180" : ""}`} />
          </button>

          {dropdownOpen && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden py-1 max-h-[300px] overflow-y-auto animate-in fade-in slide-in-from-top-2 duration-200">
              <button
                onClick={() => handleProjectSelect("all")}
                className={`w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors ${currentProject === "all" ? "bg-blue-50/50" : ""}`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-md bg-blue-50 text-blue-600 flex items-center justify-center">
                    <LayoutGrid className="w-3.5 h-3.5" />
                  </div>
                  <span className={`text-sm ${currentProject === "all" ? "font-semibold text-blue-700" : "font-medium text-slate-700"}`}>
                    Portfolio Overview
                  </span>
                </div>
                {currentProject === "all" && <Check className="w-4 h-4 text-blue-600" />}
              </button>
              
              <div className="h-px bg-slate-100 my-1 mx-3" />
              
              {projects.map((p) => (
                <button
                  key={p}
                  onClick={() => handleProjectSelect(p)}
                  className={`w-full flex items-center justify-between px-4 py-2.5 hover:bg-slate-50 transition-colors ${currentProject === p ? "bg-indigo-50/50" : ""}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-md bg-indigo-50 text-indigo-600 flex items-center justify-center">
                      <Building2 className="w-3.5 h-3.5" />
                    </div>
                    <span className={`text-sm truncate max-w-[140px] ${currentProject === p ? "font-semibold text-indigo-700" : "font-medium text-slate-700"}`}>
                      {p}
                    </span>
                  </div>
                  {currentProject === p && <Check className="w-4 h-4 text-indigo-600" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-3 mb-3">
          Dashboards
        </p>
        {navItems.map(({ label, href, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={createHref(href)}
              onClick={onClose}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                active
                  ? "bg-blue-50 text-blue-700 border border-blue-100 shadow-sm"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
              {href === "/dashboard/health" && healthLevel && healthLevel !== "ok" && (
                <span
                  className={`ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded ${healthLevel === "error" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}
                >
                  {healthLevel === "error" ? "ISSUE" : "CHECK"}
                </span>
              )}
            </Link>
          );
        })}


      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-slate-100 bg-slate-50/50 mt-auto">
        <p className="text-xs text-slate-400 text-center font-medium">
          Automated Meta Ads v2.0
        </p>
      </div>
    </aside>
  );
}
