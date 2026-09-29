CREATE TABLE IF NOT EXISTS public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id text NOT NULL UNIQUE,
  created_time timestamp with time zone NOT NULL,
  ad_id text,
  ad_name text,
  campaign_name text,
  project_name text,
  form_id text,
  field_data jsonb,
  status text DEFAULT 'New',
  created_at timestamp with time zone DEFAULT now()
);

-- Indexes for performance filtering
CREATE INDEX IF NOT EXISTS idx_leads_created_time ON public.leads(created_time);
CREATE INDEX IF NOT EXISTS idx_leads_ad_id ON public.leads(ad_id);
CREATE INDEX IF NOT EXISTS idx_leads_project_name ON public.leads(project_name);
