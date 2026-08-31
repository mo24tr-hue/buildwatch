-- Contractor job costs. Run the full block even if you already created the table.

create table if not exists public.project_job_costs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  phase_id uuid references public.phases(id) on delete cascade,
  kind text not null default 'extra' check (kind in ('phase', 'extra', 'receipt')),
  amount numeric not null default 0,
  quoted_amount numeric,
  actual_amount numeric,
  note text,
  public_url text,
  storage_path text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.project_job_costs add column if not exists quoted_amount numeric;
alter table public.project_job_costs add column if not exists actual_amount numeric;

update public.project_job_costs
set quoted_amount = amount
where kind = 'phase' and quoted_amount is null and amount is not null;

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
