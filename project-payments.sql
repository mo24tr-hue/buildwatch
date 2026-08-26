-- Payment history + receipts (contractor records; contractor + customer can read)

alter table public.projects
  add column if not exists base_cost numeric(12, 2),
  add column if not exists amount_paid numeric(12, 2) default 0;

create table if not exists public.project_payments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  note text,
  total_at_payment numeric(12, 2),
  paid_after numeric(12, 2),
  remaining_after numeric(12, 2),
  recorded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists project_payments_project_idx on public.project_payments (project_id, created_at desc);

alter table public.project_payments enable row level security;

drop policy if exists "project_payments_select" on public.project_payments;
create policy "project_payments_select" on public.project_payments
  for select to authenticated
  using (
    company_id = public.my_company_id()
    and (
      public.is_admin()
      or exists (
        select 1 from public.project_customers pc
        where pc.project_id = project_payments.project_id
          and pc.user_id = auth.uid()
      )
    )
  );

drop policy if exists "project_payments_insert" on public.project_payments;
create policy "project_payments_insert" on public.project_payments
  for insert to authenticated
  with check (
    company_id = public.my_company_id()
    and public.is_admin()
  );

drop policy if exists "project_payments_delete" on public.project_payments;
create policy "project_payments_delete" on public.project_payments
  for delete to authenticated
  using (
    company_id = public.my_company_id()
    and public.is_admin()
  );
