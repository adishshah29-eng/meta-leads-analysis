-- ============================================================
-- Data-accuracy migration (safe to run multiple times).
-- Run in the Supabase SQL Editor. Does NOT drop or rewrite data.
-- ============================================================

-- 1. Lead status column (the app reads/writes it, but it was missing
--    from setup_leads_table.sql). New leads default to 'New'; lead sync
--    never writes this column, so statuses set by the team are preserved.
alter table public.leads add column if not exists status text;
alter table public.leads alter column status set default 'New';
update public.leads set status = 'New' where status is null;

-- 2. Indexes for the queries the dashboard / syncs now run
create index if not exists idx_daily_ad_snapshots_date_id
  on public.daily_ad_snapshots (snapshot_date, id);
create index if not exists idx_daily_ad_snapshots_campaign
  on public.daily_ad_snapshots (campaign_id);
create index if not exists idx_leads_status on public.leads (status);

-- 3. Sanity check: rows per day. After deploying, backfill with
--    /api/ads/fetch-today?since=YYYY-MM-DD&until=YYYY-MM-DD (max 90 days per call)
--    and compare these totals with Ads Manager for the same days.
-- select snapshot_date, project_name, count(*) as ads, sum(spend) as spend, sum(results) as results
-- from public.daily_ad_snapshots
-- where snapshot_date >= current_date - 30
-- group by 1, 2 order by 1 desc, 2;
