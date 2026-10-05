create table if not exists public.plan_markups (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  project_id uuid,
  file_url text,
  page int default 1,
  data jsonb,
  updated_at timestamptz default now(),
  unique (project_id, file_url, page)
);

alter table public.plan_markups enable row level security;

drop policy if exists plan_markups_rw on public.plan_markups;
create policy plan_markups_rw on public.plan_markups
  for all using (true) with check (true);
