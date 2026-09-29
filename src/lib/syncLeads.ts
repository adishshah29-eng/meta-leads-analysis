/**
 * Pull lead-form leads from Meta and upsert them into the `leads` table.
 *
 * - Ads are taken from every ad that SPENT in the window (not only ads whose
 *   snapshot already shows results — a mid-day snapshot can show 0 results
 *   for an ad that later received leads).
 * - Only leads created in the last `days` days are requested, so each sync is
 *   small and finishes within the function time limit.
 * - `status` is never written here, so statuses set by the team survive syncs.
 */

import { fetchLeadDetails } from "@/lib/meta";
import { supabase, fetchAllRows } from "@/lib/supabase";
import { addDays, todayInAppTz } from "@/lib/dates";

export interface LeadSyncResult {
  adsChecked: number;
  totalSynced: number;
  newLeadsCount: number;
  errors: Array<{ ad_id: string; error: string }>;
}

const CONCURRENCY = 5;
const CHUNK = 200;

async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export async function syncLeads(days = 7): Promise<LeadSyncResult> {
  const sinceDay = addDays(todayInAppTz(), -days);
  const sinceUnix = Math.floor(Date.now() / 1000) - days * 86400;

  const adRows = await fetchAllRows<{ id: string; ad_id: string; project_name: string }>(() =>
    supabase
      .from("daily_ad_snapshots")
      .select("id, ad_id, project_name")
      .gte("snapshot_date", sinceDay)
      .gt("spend", 0)
      .order("id", { ascending: true }) as never
  );

  const uniqueAds = new Map<string, string>();
  for (const row of adRows) if (row.ad_id) uniqueAds.set(row.ad_id, row.project_name);

  const result: LeadSyncResult = { adsChecked: uniqueAds.size, totalSynced: 0, newLeadsCount: 0, errors: [] };

  await mapWithConcurrency(Array.from(uniqueAds.entries()), CONCURRENCY, async ([adId, projectName]) => {
    try {
      const leads = await fetchLeadDetails(adId, sinceUnix);
      if (leads.length === 0) return;

      const rows = leads.map((l) => ({
        lead_id: l.id,
        created_time: l.created_time,
        ad_id: l.ad_id,
        ad_name: l.ad_name,
        campaign_name: l.campaign_name,
        project_name: projectName,
        form_id: l.form_id,
        field_data: l.field_data,
      }));

      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const { data: existing, error: existingError } = await supabase
          .from("leads")
          .select("lead_id")
          .in("lead_id", chunk.map((r) => r.lead_id));
        if (existingError) throw new Error(existingError.message);
        result.newLeadsCount += chunk.length - (existing?.length ?? 0);

        const { error } = await supabase.from("leads").upsert(chunk, { onConflict: "lead_id" });
        if (error) throw new Error(`Supabase upsert: ${error.message}`);
        result.totalSynced += chunk.length;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[syncLeads] ad ${adId} failed:`, message);
      result.errors.push({ ad_id: adId, error: message });
    }
  });

  return result;
}
