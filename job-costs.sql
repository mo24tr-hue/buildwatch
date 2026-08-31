-- Contractor job costs: per-phase amounts, extras, and receipt photos.
-- Profit = quoted total (base_cost + approved change orders) minus these costs.

create table if not exists public.project_job_costs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  phase_id uuid references public.phases(id) on delete cascade,
  kind text not null default 'extra' check (kind in ('phase', 'extra', 'receipt')),
  amount numeric not null default 0,
  note text,
  public_url text,
  storage_path text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists project_job_costs_project_idx on public.project_job_costs (project_id);
create index if not exists project_job_costs_phase_idx on public.project_job_costs (phase_id);

alter table public.project_job_costs enable row level security;

drop policy if exists "job_costs_select" on public.project_job_costs;
create policy "job_costs_select" on public.project_job_costs
  for select using (
    company_id in (select company_id from public.profiles where id = auth.uid())
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin' and p.company_id = project_job_costs.company_id
    )
  );

drop policy if exists "job_costs_write" on public.project_job_costs;
create policy "job_costs_write" on public.project_job_costs
  for all using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin' and p.company_id = project_job_costs.company_id
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin' and p.company_id = project_job_costs.company_id
    )
  );
