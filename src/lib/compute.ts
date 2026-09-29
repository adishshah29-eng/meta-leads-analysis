/**
 * Shared computation utilities.
 * Deterministic number-crunching — no API calls, no side effects.
 */

export { addDays } from "./dates";

export interface AdSnapshot {
  ad_id: string;
  ad_name: string;
  campaign_name: string;
  adset_name: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  results: number;
  cost_per_result: number;
  snapshot_date?: string;
  campaign_id?: string;
  project_name?: string;
}

/** Map a daily_ad_snapshots row (numeric columns arrive as strings) to an AdSnapshot. */
export function rowToSnapshot(row: Record<string, unknown>): AdSnapshot {
  return {
    ad_id: String(row.ad_id),
    ad_name: String(row.ad_name ?? ""),
    campaign_id: row.campaign_id ? String(row.campaign_id) : undefined,
    campaign_name: String(row.campaign_name ?? ""),
    adset_name: String(row.adset_name ?? ""),
    project_name: row.project_name ? String(row.project_name) : undefined,
    snapshot_date: row.snapshot_date ? String(row.snapshot_date) : undefined,
    spend: Number(row.spend) || 0,
    impressions: Number(row.impressions) || 0,
    clicks: Number(row.clicks) || 0,
    ctr: Number(row.ctr) || 0,
    cpc: Number(row.cpc) || 0,
    cpm: Number(row.cpm) || 0,
    results: Number(row.results) || 0,
    cost_per_result: Number(row.cost_per_result) || 0,
  };
}

export function formatNum(n: number, decimals = 2) {
  return n.toFixed(decimals);
}

export interface DailySummary {
  date: string;
  totalSpend: number;
  totalImpressions: number;
  totalClicks: number;
  totalResults: number;
  avgCTR: number;
  avgCPC: number;
  avgCPM: number;
  avgCPA: number;
  spendChangePct: number | null;
  cpaChangePct: number | null;
  resultsChangePct: number | null;
  bestAd: AdSnapshot | null;
  worstAd: AdSnapshot | null;
  topAds: AdSnapshot[];
  bottomAds: AdSnapshot[];
  ads: AdSnapshot[];
  campaigns: Array<{
    campaign_name: string;
    spend: number;
    impressions: number;
    clicks: number;
    results: number;
    cost_per_result: number;
    ctr: number;
    cpc: number;
    top_ads: AdSnapshot[];
    bottom_ads: AdSnapshot[];
  }>;
}

export interface WeeklySummary {
  weekStart: string;
  weekEnd: string;
  totalSpend: number;
  totalResults: number;
  avgCTR: number;
  avgCPA: number;
  spendChangePct: number | null;
  cpaChangePct: number | null;
  resultsChangePct: number | null;
  topAds: AdSnapshot[];
  bottomAds: AdSnapshot[];
  campaigns: Array<{
    campaign_name: string;
    spend: number;
    results: number;
    cost_per_result: number;
    top_ads: AdSnapshot[];
    bottom_ads: AdSnapshot[];
  }>;
}

/** Threshold: ad is flagged as "wasted spend" if spend > this and 0 results */
const WASTE_SPEND_THRESHOLD = 500; // INR — adjust to your currency

/** Compute % change, returns null if previous value is 0 */
export function aggregateSnapshots(snapshots: AdSnapshot[]): AdSnapshot[] {
  const adMap = new Map<string, AdSnapshot>();
  for (const snap of snapshots) {
    const existing = adMap.get(snap.ad_id);
    if (existing) {
      existing.spend += snap.spend;
      existing.impressions += snap.impressions;
      existing.clicks += snap.clicks;
      existing.results += snap.results;
    } else {
      adMap.set(snap.ad_id, { ...snap });
    }
  }

  // Recalculate derived metrics for aggregated ads
  return Array.from(adMap.values()).map((a) => ({
    ...a,
    ctr: a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0,
    cpc: a.clicks > 0 ? a.spend / a.clicks : 0,
    cpm: a.impressions > 0 ? (a.spend / a.impressions) * 1000 : 0,
    cost_per_result: a.results > 0 ? a.spend / a.results : 0,
  }));
}

/** Compute % change, returns null if previous value is 0 */
export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

/** Format to 2 decimal places, preserving null */
export function round2(n: number | null): number | null {
  if (n === null) return null;
  return Math.round(n * 100) / 100;
}

/** Compute daily summary from a list of snapshots for one day */
export function computeDailySummary(
  snapshots: AdSnapshot[],
  date: string,
  priorSnapshots: AdSnapshot[] | null = null
): DailySummary {
  if (snapshots.length === 0) {
    return {
      date,
      totalSpend: 0,
      totalImpressions: 0,
      totalClicks: 0,
      totalResults: 0,
      avgCTR: 0,
      avgCPC: 0,
      avgCPM: 0,
      avgCPA: 0,
      spendChangePct: null,
      cpaChangePct: null,
      resultsChangePct: null,
      bestAd: null,
      worstAd: null,
      topAds: [],
      bottomAds: [],
      ads: [],
      campaigns: [],
    };
  }

  const totalSpend = snapshots.reduce((s, a) => s + a.spend, 0);
  const totalImpressions = snapshots.reduce((s, a) => s + a.impressions, 0);
  const totalClicks = snapshots.reduce((s, a) => s + a.clicks, 0);
  const totalResults = snapshots.reduce((s, a) => s + a.results, 0);

  const avgCTR =
    totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
  const avgCPC = totalClicks > 0 ? totalSpend / totalClicks : 0;
  const avgCPM = totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0;
  const avgCPA = totalResults > 0 ? totalSpend / totalResults : 0;

  let spendChangePct = null;
  let cpaChangePct = null;
  let resultsChangePct = null;

  if (priorSnapshots) {
    const priorSpend = priorSnapshots.reduce((s, a) => s + a.spend, 0);
    const priorResults = priorSnapshots.reduce((s, a) => s + a.results, 0);
    const priorCPA = priorResults > 0 ? priorSpend / priorResults : 0;
    spendChangePct = pctChange(totalSpend, priorSpend);
    cpaChangePct = pctChange(avgCPA, priorCPA);
    resultsChangePct = pctChange(totalResults, priorResults);
  }

  // Best ad: lowest cost-per-result among ads with at least 1 result
  const adsWithResults = snapshots.filter((a) => a.results > 0);
  const bestAd =
    adsWithResults.length > 0
      ? adsWithResults.reduce((best, a) =>
          a.cost_per_result < best.cost_per_result ? a : best
        )
      : null;

  // Worst ad: highest spend with 0 results (above waste threshold)
  const wastedAds = snapshots.filter(
    (a) => a.results === 0 && a.spend > WASTE_SPEND_THRESHOLD
  );
  const worstAd =
    wastedAds.length > 0
      ? wastedAds.reduce((worst, a) => (a.spend > worst.spend ? a : worst))
      : null;

  // Top 3 ads: most results (then lowest CPA)
  const topAds = [...snapshots]
    .filter((a) => a.results > 0)
    .sort((a, b) => {
      if (b.results !== a.results) return b.results - a.results;
      return a.cost_per_result - b.cost_per_result;
    })
    .slice(0, 3);

  // Bottom 3 ads: highest spend with fewest results
  const bottomAds = [...snapshots]
    .filter((a) => a.spend > WASTE_SPEND_THRESHOLD)
    .sort((a, b) => {
      if (a.results !== b.results) return a.results - b.results;
      return b.spend - a.spend;
    })
    .slice(0, 3);

  // Aggregate by campaign
  // Group by campaign_id (names are not unique across accounts / over time)
  const campMap = new Map<string, any>();
  for (const a of snapshots) {
    const cName = a.campaign_name || "Unknown Campaign";
    const cKey = a.campaign_id || `name:${a.project_name ?? ""}:${cName}`;
    const existing = campMap.get(cKey) || {
      campaign_name: cName,
      spend: 0,
      impressions: 0,
      clicks: 0,
      results: 0,
      ads: [],
    };
    existing.spend += a.spend;
    existing.impressions += a.impressions;
    existing.clicks += a.clicks;
    existing.results += a.results;
    existing.ads.push(a);
    campMap.set(cKey, existing);
  }

  return {
    date,
    totalSpend,
    totalImpressions,
    totalClicks,
    totalResults,
    avgCTR: round2(avgCTR) ?? 0,
    avgCPC: round2(avgCPC) ?? 0,
    avgCPM: round2(avgCPM) ?? 0,
    avgCPA: round2(avgCPA) ?? 0,
    spendChangePct: round2(spendChangePct),
    cpaChangePct: round2(cpaChangePct),
    resultsChangePct: round2(resultsChangePct),
    bestAd,
    worstAd,
    topAds,
    bottomAds,
    ads: snapshots,
    campaigns: Array.from(campMap.values()).map(c => {
      const campTopAds = [...c.ads]
        .filter((a: AdSnapshot) => a.results > 0)
        .sort((a: AdSnapshot, b: AdSnapshot) => {
          if (b.results !== a.results) return b.results - a.results;
          return a.cost_per_result - b.cost_per_result;
        })
        .slice(0, 3);
      
      const campBottomAds = [...c.ads]
        .filter((a: AdSnapshot) => a.spend > WASTE_SPEND_THRESHOLD)
        .sort((a: AdSnapshot, b: AdSnapshot) => {
          if (a.results !== b.results) return a.results - b.results;
          return b.spend - a.spend;
        })
        .slice(0, 3);
        
      return {
        campaign_name: c.campaign_name,
        spend: c.spend,
        impressions: c.impressions,
        clicks: c.clicks,
        results: c.results,
        cost_per_result: c.results > 0 ? c.spend / c.results : 0,
        ctr: c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0,
        cpc: c.clicks > 0 ? c.spend / c.clicks : 0,
        top_ads: campTopAds,
        bottom_ads: campBottomAds,
      };
    }).sort((a, b) => b.spend - a.spend),
  };
}

/** Compute week-over-week summary from two sets of daily snapshots */
export function computeWeeklySummary(
  thisWeekSnapshots: AdSnapshot[],
  lastWeekSnapshots: AdSnapshot[],
  weekStart: string,
  weekEnd: string
): WeeklySummary {
  const sumSpend = (s: AdSnapshot[]) => s.reduce((t, a) => t + a.spend, 0);
  const sumResults = (s: AdSnapshot[]) => s.reduce((t, a) => t + a.results, 0);
  const sumImpressions = (s: AdSnapshot[]) => s.reduce((t, a) => t + a.impressions, 0);
  const sumClicks = (s: AdSnapshot[]) => s.reduce((t, a) => t + a.clicks, 0);

  const thisSpend = sumSpend(thisWeekSnapshots);
  const lastSpend = sumSpend(lastWeekSnapshots);
  const thisResults = sumResults(thisWeekSnapshots);
  const lastResults = sumResults(lastWeekSnapshots);
  const thisImpressions = sumImpressions(thisWeekSnapshots);
  const thisClicks = sumClicks(thisWeekSnapshots);

  const avgCTR = thisImpressions > 0 ? (thisClicks / thisImpressions) * 100 : 0;
  const avgCPA = thisResults > 0 ? thisSpend / thisResults : 0;
  const lastCPA = lastResults > 0 ? lastSpend / lastResults : 0;

  // Aggregate by ad_id across all days this week
  const adMap = new Map<string, AdSnapshot>();
  for (const snap of thisWeekSnapshots) {
    const existing = adMap.get(snap.ad_id);
    if (existing) {
      existing.spend += snap.spend;
      existing.impressions += snap.impressions;
      existing.clicks += snap.clicks;
      existing.results += snap.results;
    } else {
      adMap.set(snap.ad_id, { ...snap });
    }
  }

  // Recalculate derived metrics for aggregated ads
  const aggregatedAds = Array.from(adMap.values()).map((a) => ({
    ...a,
    ctr: a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0,
    cpc: a.clicks > 0 ? a.spend / a.clicks : 0,
    cpm: a.impressions > 0 ? (a.spend / a.impressions) * 1000 : 0,
    cost_per_result: a.results > 0 ? a.spend / a.results : 0,
  }));

  // Top 3 ads: most results (then lowest CPA)
  const topAds = [...aggregatedAds]
    .filter((a) => a.results > 0)
    .sort((a, b) => {
      if (b.results !== a.results) return b.results - a.results;
      return a.cost_per_result - b.cost_per_result;
    })
    .slice(0, 3);

  // Bottom 3 ads: highest spend with fewest results
  const bottomAds = [...aggregatedAds]
    .filter((a) => a.spend > WASTE_SPEND_THRESHOLD)
    .sort((a, b) => {
      if (a.results !== b.results) return a.results - b.results;
      return b.spend - a.spend;
    })
    .slice(0, 3);

  // Campaign breakdown
  const campMap = new Map<string, { name: string; spend: number; results: number; ads: AdSnapshot[] }>();
  for (const a of aggregatedAds) {
    const name = a.campaign_name || "Unknown";
    const key = a.campaign_id || `name:${a.project_name ?? ""}:${name}`;
    const existing = campMap.get(key);
    if (existing) {
      existing.spend += a.spend;
      existing.results += a.results;
      existing.ads.push(a);
    } else {
      campMap.set(key, { name, spend: a.spend, results: a.results, ads: [a] });
    }
  }

  const campaigns = Array.from(campMap.values()).map(({ name, ...data }) => {
    const campTopAds = [...data.ads]
      .filter((a) => a.results > 0)
      .sort((a, b) => {
        if (b.results !== a.results) return b.results - a.results;
        return a.cost_per_result - b.cost_per_result;
      })
      .slice(0, 3);

    const campBottomAds = [...data.ads]
      .filter((a) => a.spend > WASTE_SPEND_THRESHOLD)
      .sort((a, b) => {
        if (a.results !== b.results) return a.results - b.results;
        return b.spend - a.spend;
      })
      .slice(0, 3);

    return {
      campaign_name: name,
      spend: data.spend,
      results: data.results,
      cost_per_result: data.results > 0 ? data.spend / data.results : 0,
      top_ads: campTopAds,
      bottom_ads: campBottomAds,
    };
  }).sort((a, b) => b.spend - a.spend);

  return {
    weekStart,
    weekEnd,
    totalSpend: round2(thisSpend) ?? 0,
    totalResults: thisResults,
    avgCTR: round2(avgCTR) ?? 0,
    avgCPA: round2(avgCPA) ?? 0,
    spendChangePct: round2(pctChange(thisSpend, lastSpend)),
    cpaChangePct: round2(pctChange(avgCPA, lastCPA)),
    resultsChangePct: round2(pctChange(thisResults, lastResults)),
    topAds,
    bottomAds,
    campaigns,
  };
}

/** Format currency in INR (adjust locale/currency as needed) */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Format a percentage to 2 decimal places with % sign */
export function formatPct(value: number): string {
  return `${value.toFixed(2)}%`;
}

/** Format pct change with arrow and color hint */
export function formatChange(
  value: number | null,
  invertGood = false
): { label: string; positive: boolean } {
  if (value === null) return { label: "N/A", positive: true };
  const positive = invertGood ? value < 0 : value > 0;
  const arrow = value > 0 ? "↑" : value < 0 ? "↓" : "→";
  return {
    label: `${arrow} ${Math.abs(value).toFixed(1)}%`,
    positive,
  };
}
