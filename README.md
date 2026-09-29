# Meta Ads CRM

Next.js dashboard for Meta (Facebook/Instagram) lead-gen campaigns across multiple ad accounts, backed by Supabase. See `PRODUCT.md` for the product brief.

## Setup

```bash
npm ci
npm run dev
```

Run `supabase/schema.sql` + `supabase/setup_leads_table.sql` on a new project, then `supabase/migrations/*.sql` (safe to re-run on an existing project).

### Environment variables

| Variable | Purpose |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Database (server-side only) |
| `META_ACCESS_TOKEN` | Graph API token with `ads_read` + `leads_retrieval` |
| `META_AD_ACCOUNTS` | JSON: `[{"id":"act_123","name":"Client A"}]` — `name` becomes the project |
| `META_RESULT_ACTION_TYPE` | Action type(s) counted as "results", comma-separated in priority order. Default `lead`. For instant-form ads, Ads Manager's Results usually matches `onsite_conversion.lead_grouped` |
| `DASHBOARD_PASSWORD` | Password for `/dashboard` and `/api`. **If unset, everything is open** |
| `CRON_SECRET` | **Required in production.** Vercel Cron sends it as a Bearer token; API calls without it (or a login cookie) get 401 |
| `RESEND_API_KEY`, `ALERT_EMAIL_ADDRESS` | Daily leads email |
| `META_APP_ID`, `META_APP_SECRET` | Optional; lets the Data Health page check the token's expiry reliably |
| `ANTHROPIC_API_KEY` | Optional AI weekly summary (`ANTHROPIC_MODEL` to override the model) |
| `NEXT_PUBLIC_APP_TIMEZONE`, `NEXT_PUBLIC_APP_UTC_OFFSET` | Business timezone, default `Asia/Kolkata` / `+05:30` |

## Data Health page (`/dashboard/health`)

- **Background syncs**: last run, last success and recent history of every cron job (recorded in `sync_runs`; run `supabase/migrations/2026_09_sync_health.sql`). Failed or partial cron runs email `ALERT_EMAIL_ADDRESS`.
- **Meta token**: validity, expiry and permissions; the daily ad sync emails a warning 7 days before expiry.
- **Meta vs stored numbers**: compares Meta's account-level daily totals (what Ads Manager shows) with the stored ad-level rows, flags missing or mismatched days, and re-syncs them with one click.
- Every dashboard page shows a banner when something needs attention.

## Data pipeline (Vercel Cron, times in IST)

| Time | Route | What it does |
|---|---|---|
| 01:30 daily | `/api/ads/fetch-today` | Re-fetches the **last 7 days** of ad insights (completes yesterday, picks up Meta's late restatements) |
| 02:30 daily | `/api/cron/sync-leads` | Syncs leads from the last 7 days for every ad that spent |
| 09:00 daily | `/api/cron/daily-report` | Emails yesterday's leads (IST day) as CSV |
| 09:00 Monday | `/api/reports/weekly` | Weekly report for the portfolio and each project |

### One-time backfill after deploying the data-accuracy fixes

While logged in (or with `Authorization: Bearer $CRON_SECRET`):

```
/api/ads/fetch-today?since=2026-07-01&until=2026-09-28   # max 90 days per call
/api/cron/sync-leads?days=90                             # Meta keeps leads for 90 days
```

Then compare totals with Ads Manager using the query at the bottom of `supabase/migrations/2026_09_data_accuracy.sql`.
