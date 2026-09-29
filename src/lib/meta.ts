/**
 * Meta Marketing API (Graph API) client.
 * Fetches ad-level insights and lead-form leads.
 */

const BASE_URL = "https://graph.facebook.com/v20.0";

export interface MetaAdInsight {
  snapshot_date: string; // YYYY-MM-DD (ad account timezone)
  account_id: string;
  account_name: string;
  ad_id: string;
  ad_name: string;
  campaign_id: string;
  campaign_name: string;
  adset_id: string;
  adset_name: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  results: number;
  cost_per_result: number;
}

interface RawInsightAction {
  action_type: string;
  value: string;
}

interface RawInsight {
  date_start: string;
  account_id: string;
  account_name: string;
  ad_id: string;
  ad_name: string;
  campaign_id: string;
  campaign_name: string;
  adset_id: string;
  adset_name: string;
  spend: string;
  impressions: string;
  clicks: string;
  ctr: string;
  cpc: string;
  cpm: string;
  actions?: RawInsightAction[];
  cost_per_action_type?: RawInsightAction[];
}

interface GraphPage<T> {
  data?: T[];
  paging?: { next?: string };
  error?: { message: string; code: number };
}

/**
 * The conversion event(s) counted as a "result".
 * Comma-separated, in priority order: the first action type present on an ad
 * row is used (so the same lead is never counted twice under two names).
 *
 * For instant-form lead ads, Ads Manager's "Results" column usually matches
 * "onsite_conversion.lead_grouped"; "lead" also includes pixel/website leads.
 * Check a few ads in Ads Manager and set META_RESULT_ACTION_TYPE accordingly.
 */
const RESULT_ACTION_TYPES = (process.env.META_RESULT_ACTION_TYPE ?? "lead")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * By default Meta omits DELETED and ARCHIVED ads from ad-level insights, even
 * though their spend is included in the account total in Ads Manager.
 */
const ALL_AD_STATUSES = [
  "ACTIVE",
  "PAUSED",
  "DELETED",
  "ARCHIVED",
  "PENDING_REVIEW",
  "DISAPPROVED",
  "PREAPPROVED",
  "PENDING_BILLING_INFO",
  "CAMPAIGN_PAUSED",
  "ADSET_PAUSED",
  "IN_PROCESS",
  "WITH_ISSUES",
];

/** Graph error codes worth retrying (rate limits / transient). */
const RETRYABLE_CODES = new Set([1, 2, 4, 17, 32, 341, 613, 80000, 80003, 80004, 80014]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * GET a Graph URL with retries on network errors, 5xx, non-JSON bodies and
 * rate-limit error codes. Throws a descriptive error once retries run out.
 */
async function graphGet<T>(url: string, attempts = 4): Promise<GraphPage<T>> {
  let lastError = "unknown error";
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(1000 * 2 ** i);
    let res: Response;
    try {
      res = await fetch(url, { cache: "no-store" });
    } catch (err) {
      lastError = `network error: ${err instanceof Error ? err.message : String(err)}`;
      continue;
    }

    let json: GraphPage<T>;
    try {
      json = (await res.json()) as GraphPage<T>;
    } catch {
      lastError = `HTTP ${res.status} with non-JSON body`;
      if (res.status >= 500 || res.status === 429) continue;
      throw new Error(`Meta API ${lastError}`);
    }

    if (json.error) {
      lastError = `Meta API error ${json.error.code}: ${json.error.message}`;
      if (RETRYABLE_CODES.has(json.error.code) || res.status >= 500) continue;
      throw new Error(lastError);
    }
    if (!res.ok) {
      lastError = `HTTP ${res.status}`;
      if (res.status >= 500 || res.status === 429) continue;
      throw new Error(`Meta API ${lastError}`);
    }
    return json;
  }
  throw new Error(`${lastError} (after ${attempts} attempts)`);
}

function pickResult(raw: RawInsight): { results: number; costPerResult: number | null } {
  for (const type of RESULT_ACTION_TYPES) {
    const match = raw.actions?.find((a) => a.action_type === type);
    if (match) {
      const cost = raw.cost_per_action_type?.find((a) => a.action_type === type);
      return {
        results: Math.round(parseFloat(match.value)) || 0,
        costPerResult: cost ? parseFloat(cost.value) : null,
      };
    }
  }
  return { results: 0, costPerResult: null };
}

/**
 * Fetch ad-level insights for every day in [since, until] (inclusive),
 * one row per ad per day. Handles pagination and includes deleted/archived ads.
 */
export async function fetchAdInsights(
  since: string, // YYYY-MM-DD
  until: string, // YYYY-MM-DD
  accountId: string
): Promise<MetaAdInsight[]> {
  const token = process.env.META_ACCESS_TOKEN;

  if (!token || !accountId) {
    throw new Error("Missing META_ACCESS_TOKEN or accountId for Meta API fetch.");
  }

  const fields = [
    "account_id",
    "account_name",
    "ad_id",
    "ad_name",
    "campaign_id",
    "campaign_name",
    "adset_id",
    "adset_name",
    "spend",
    "impressions",
    "clicks",
    "ctr",
    "cpc",
    "cpm",
    "actions",
    "cost_per_action_type",
  ].join(",");

  const params = new URLSearchParams({
    fields,
    level: "ad",
    time_range: JSON.stringify({ since, until }),
    time_increment: "1",
    filtering: JSON.stringify([
      { field: "ad.effective_status", operator: "IN", value: ALL_AD_STATUSES },
    ]),
    access_token: token,
    limit: "500",
  });

  const allInsights: MetaAdInsight[] = [];
  let url = `${BASE_URL}/${accountId}/insights?${params.toString()}`;

  while (url) {
    const json = await graphGet<RawInsight>(url);

    for (const raw of json.data ?? []) {
      const spend = parseFloat(raw.spend ?? "0") || 0;
      const { results, costPerResult } = pickResult(raw);

      allInsights.push({
        snapshot_date: raw.date_start,
        account_id: raw.account_id,
        account_name: raw.account_name,
        ad_id: raw.ad_id,
        ad_name: raw.ad_name,
        campaign_id: raw.campaign_id,
        campaign_name: raw.campaign_name,
        adset_id: raw.adset_id,
        adset_name: raw.adset_name,
        spend,
        impressions: parseInt(raw.impressions ?? "0", 10) || 0,
        clicks: parseInt(raw.clicks ?? "0", 10) || 0,
        ctr: parseFloat(raw.ctr ?? "0") || 0,
        cpc: parseFloat(raw.cpc ?? "0") || 0,
        cpm: parseFloat(raw.cpm ?? "0") || 0,
        results,
        cost_per_result: costPerResult ?? (results > 0 ? spend / results : 0),
      });
    }

    url = json.paging?.next ?? "";
  }

  return allInsights;
}

export interface MetaLead {
  id: string;
  created_time: string;
  ad_id: string;
  ad_name: string;
  form_id: string;
  campaign_name: string;
  field_data: Record<string, string>;
}

interface RawLead {
  id: string;
  created_time: string;
  ad_id?: string;
  ad_name?: string;
  form_id?: string;
  campaign_name?: string;
  field_data?: Array<{ name: string; values?: string[] }>;
}

/**
 * Fetch leads for a specific ad from Meta Marketing API.
 * The token needs `leads_retrieval` permission.
 *
 * @param sinceUnix Only return leads created after this unix timestamp
 *                  (keeps each sync small instead of re-downloading all history).
 */
export async function fetchLeadDetails(adId: string, sinceUnix?: number): Promise<MetaLead[]> {
  const token = process.env.META_ACCESS_TOKEN;

  if (!token || !adId) {
    throw new Error("Missing META_ACCESS_TOKEN or adId for Meta Leads API fetch.");
  }

  const fields = ["id", "created_time", "ad_id", "ad_name", "form_id", "campaign_name", "field_data"].join(",");

  const params = new URLSearchParams({
    fields,
    access_token: token,
    limit: "500",
  });
  if (sinceUnix) {
    params.set(
      "filtering",
      JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: sinceUnix }])
    );
  }

  const allLeads: MetaLead[] = [];
  let url = `${BASE_URL}/${adId}/leads?${params.toString()}`;

  while (url) {
    const json = await graphGet<RawLead>(url);

    for (const raw of json.data ?? []) {
      // transform field_data from array of {name, values} to a simple object
      const fieldDataObj: Record<string, string> = {};
      if (Array.isArray(raw.field_data)) {
        for (const field of raw.field_data) {
          fieldDataObj[field.name] = field.values?.[0] ?? "";
        }
      }

      allLeads.push({
        id: raw.id,
        created_time: raw.created_time,
        ad_id: raw.ad_id || adId,
        ad_name: raw.ad_name || "",
        form_id: raw.form_id || "",
        campaign_name: raw.campaign_name || "",
        field_data: fieldDataObj,
      });
    }

    url = json.paging?.next ?? "";
  }

  return allLeads;
}
