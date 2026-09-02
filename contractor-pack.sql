-- Contractor pack: directory, daily logs, permits, selections,
-- invoices, estimates, plan pins, schedule confirms, closeout, onboarding.

alter table public.companies
  add column if not exists onboarding_complete boolean not null default true;

create table if not exists public.directory_contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  kind text not null default 'trade' check (kind in ('trade', 'supplier')),
  trade text,
  phone text,
  email text,
  insurance_expires date,
  notes text,
  created_at timestamptz not null default now()
);
alter table public.directory_contacts enable row level security;
drop policy if exists "dir_select" on public.directory_contacts;
create policy "dir_select" on public.directory_contacts for select to authenticated
  using (company_id = public.my_company_id());
drop policy if exists "dir_admin" on public.directory_contacts;
create policy "dir_admin" on public.directory_contacts for all to authenticated
  using (company_id = public.my_company_id() and public.is_admin())
  with check (company_id = public.my_company_id() and public.is_admin());

create table if not exists public.daily_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  log_date date not null,
  crew text,
  weather text,
  delays text,
  deliveries text,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.daily_logs enable row level security;
drop policy if exists "dlog_select" on public.daily_logs;
create policy "dlog_select" on public.daily_logs for select to authenticated
  using (company_id = public.my_company_id());
drop policy if exists "dlog_write" on public.daily_logs;
create policy "dlog_write" on public.daily_logs for all to authenticated
  using (company_id = public.my_company_id() and public.is_admin())
  with check (company_id = public.my_company_id() and public.is_admin());

create table if not exists public.permits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  number text,
  office text,
  filed_on date,
  approved_on date,
  inspection_on date,
  result text not null default 'pending' check (result in ('pending', 'pass', 'fail')),
  notes text,
  created_at timestamptz not null default now()
);
alter table public.permits enable row level security;
drop policy if exists "perm_select" on public.permits;
create policy "perm_select" on public.permits for select to authenticated
  using (company_id = public.my_company_id());
drop policy if exists "perm_admin" on public.permits;
create policy "perm_admin" on public.permits for all to authenticated
  using (company_id = public.my_company_id() and public.is_admin())
  with check (company_id = public.my_company_id() and public.is_admin());

create table if not exists public.selections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  phase_id uuid references public.phases(id) on delete set null,
  category text,
  item_name text not null,
  option_label text,
  notes text,
  photo_url text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'locked')),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.selections enable row level security;
drop policy if exists "sel_select" on public.selections;
create policy "sel_select" on public.selections for select to authenticated
  using (company_id = public.my_company_id());
drop policy if exists "sel_admin" on public.selections;
create policy "sel_admin" on public.selections for all to authenticated
  using (company_id = public.my_company_id() and public.is_admin())
  with check (company_id = public.my_company_id() and public.is_admin());
drop policy if exists "sel_customer_update" on public.selections;
create policy "sel_customer_update" on public.selections for update to authenticated
  using (company_id = public.my_company_id())
  with check (company_id = public.my_company_id());

create table if not exists public.customer_invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  number text,
  title text not null default 'Invoice',
  amount numeric,
  due_date date,
  status text not null default 'sent' check (status in ('draft', 'sent', 'paid')),
  notes text,
  created_at timestamptz not null default now()
);
alter table public.customer_invoices enable row level security;
drop policy if exists "inv_select" on public.customer_invoices;
create policy "inv_select" on public.customer_invoices for select to authenticated
  using (company_id = public.my_company_id());
drop policy if exists "inv_admin" on public.customer_invoices;
create policy "inv_admin" on public.customer_invoices for all to authenticated
  using (company_id = public.my_company_id() and public.is_admin())
  with check (company_id = public.my_company_id() and public.is_admin());

create table if not exists public.estimates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  title text not null,
  address text,
  style text,
  status text not null default 'draft' check (status in ('draft', 'converted')),
  project_id uuid references public.projects(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);
create table if not exists public.estimate_lines (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  label text not null,
  amount numeric,
  sort_order int not null default 0
);
alter table public.estimates enable row level security;
alter table public.estimate_lines enable row level security;
drop policy if exists "est_admin" on public.estimates;
create policy "est_admin" on public.estimates for all to authenticated
  using (company_id = public.my_company_id() and public.is_admin())
  with check (company_id = public.my_company_id() and public.is_admin());
drop policy if exists "estl_admin" on public.estimate_lines;
create policy "estl_admin" on public.estimate_lines for all to authenticated
  using (exists (
    select 1 from public.estimates e
    where e.id = estimate_id and e.company_id = public.my_company_id() and public.is_admin()
  ))
  with check (exists (
    select 1 from public.estimates e
    where e.id = estimate_id and e.company_id = public.my_company_id() and public.is_admin()
  ));

create table if not exists public.plan_pins (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  phase_id uuid references public.phases(id) on delete set null,
  file_url text not null,
  x_pct numeric not null,
  y_pct numeric not null,
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.plan_pins enable row level security;
drop policy if exists "pin_select" on public.plan_pins;
create policy "pin_select" on public.plan_pins for select to authenticated
  using (company_id = public.my_company_id());
drop policy if exists "pin_write" on public.plan_pins;
create policy "pin_write" on public.plan_pins for all to authenticated
  using (company_id = public.my_company_id() and public.is_admin())
  with check (company_id = public.my_company_id() and public.is_admin());

create table if not exists public.schedule_asks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  phase_id uuid references public.phases(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  ask_date date not null,
  status text not null default 'pending' check (status in ('pending', 'yes', 'no')),
  note text,
  created_at timestamptz not null default now()
);
alter table public.schedule_asks enable row level security;
drop policy if exists "ask_select" on public.schedule_asks;
create policy "ask_select" on public.schedule_asks for select to authenticated
  using (company_id = public.my_company_id() and (public.is_admin() or user_id = auth.uid()));
drop policy if exists "ask_admin" on public.schedule_asks;
create policy "ask_admin" on public.schedule_asks for all to authenticated
  using (company_id = public.my_company_id() and public.is_admin())
  with check (company_id = public.my_company_id() and public.is_admin());
drop policy if exists "ask_trade_update" on public.schedule_asks;
create policy "ask_trade_update" on public.schedule_asks for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create table if not exists public.closeout_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null default 'note' check (kind in ('warranty', 'manual', 'photo', 'note')),
  title text not null,
  detail text,
  file_url text,
  created_at timestamptz not null default now()
);
alter table public.closeout_items enable row level security;
drop policy if exists "co_select" on public.closeout_items;
create policy "co_select" on public.closeout_items for select to authenticated
  using (company_id = public.my_company_id());
drop policy if exists "co_admin" on public.closeout_items;
create policy "co_admin" on public.closeout_items for all to authenticated
  using (company_id = public.my_company_id() and public.is_admin())
  with check (company_id = public.my_company_id() and public.is_admin());
