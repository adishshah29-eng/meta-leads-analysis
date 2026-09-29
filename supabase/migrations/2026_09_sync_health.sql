-- ============================================================
-- Sync health: one row per run of each background job.
-- Safe to run multiple times.
-- ============================================================

create table if not exists public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null,                 -- 'ads' | 'leads' | 'daily_report' | 'weekly'
  trigger text not null default 'manual', -- 'cron' | 'manual'
  status text not null default 'running', -- 'running' | 'ok' | 'partial' | 'failed'
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  rows_processed integer default 0,
  message text,
  details jsonb
);

create index if not exists idx_sync_runs_job_started on public.sync_runs (job, started_at desc);

-- Keep ~90 days of history (optional; run manually or via pg_cron):
-- delete from public.sync_runs where started_at < now() - interval '90 days';
