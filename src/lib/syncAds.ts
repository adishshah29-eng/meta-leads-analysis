/**
 * Pull ad insights from Meta and upsert into daily_ad_snapshots.
 *
 * Each account is fetched and saved independently so one failing account
 * (expired token, rate limit) never discards the others' data.
 */

import { fetchAdInsights } from "@/lib/meta";
import { supabase } from "@/lib/supabase";

export interface AdAccountConfig {
  id: string;
  name: string;
}

export function getAdAccounts(): AdAccountConfig[] {
  const raw = process.env.META_AD_ACCOUNTS || "[]";
  try {
    const parsed = JSON.parse(raw) as AdAccountConfig[];
    return Array.isArray(parsed) ? parsed.filter((a) => a && a.id && a.name) : [];
  } catch {
    throw new Error("META_AD_ACCOUNTS is not valid JSON. Expected [{\"id\":\"act_123\",\"name\":\"Client\"}]");
  }
}

export interface AccountSyncResult {
  account: string;
  upserted: number;
  error?: string;
}

const UPSERT_CHUNK = 500;

export async function syncAdSnapshots(since: string, until: string): Promise<AccountSyncResult[]> {
  const accounts = getAdAccounts();
  if (accounts.length === 0) throw new Error("No META_AD_ACCOUNTS configured.");

  const results: AccountSyncResult[] = [];

  for (const account of accounts) {
    try {
      const insights = await fetchAdInsights(since, until, account.id);
      const rows = insights.map((ad) => ({
        snapshot_date: ad.snapshot_date,
        account_id: ad.account_id || account.id.replace(/^act_/, ""),
        account_name: ad.account_name,
        project_name: account.name,
        ad_id: ad.ad_id,
        ad_name: ad.ad_name,
        campaign_id: ad.campaign_id,
        campaign_name: ad.campaign_name,
        adset_id: ad.adset_id,
        adset_name: ad.adset_name,
        spend: ad.spend,
        impressions: ad.impressions,
        clicks: ad.clicks,
        ctr: ad.ctr,
        cpc: ad.cpc,
        cpm: ad.cpm,
        results: ad.results,
        cost_per_result: ad.cost_per_result,
      }));

      for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
        const { error } = await supabase
          .from("daily_ad_snapshots")
          .upsert(rows.slice(i, i + UPSERT_CHUNK), { onConflict: "snapshot_date,account_id,ad_id" });
        if (error) throw new Error(`Supabase upsert: ${error.message}`);
      }

      results.push({ account: account.name, upserted: rows.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[syncAdSnapshots] ${account.name} (${account.id}) failed:`, message);
      results.push({ account: account.name, upserted: 0, error: message });
    }
  }

  return results;
}
