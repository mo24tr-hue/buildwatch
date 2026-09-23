-- Permit photos + inspections reuse public.permits.inspection_on for the calendar.

alter table public.permits
  add column if not exists photo_url text;

create table if not exists public.permit_photos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  public_url text not null,
  storage_path text,
  file_name text,
  created_at timestamptz not null default now()
);

alter table public.permit_photos enable row level security;

drop policy if exists "pph_select" on public.permit_photos;
create policy "pph_select" on public.permit_photos for select to authenticated
  using (company_id = public.my_company_id());

drop policy if exists "pph_admin" on public.permit_photos;
create policy "pph_admin" on public.permit_photos for all to authenticated
  using (company_id = public.my_company_id() and public.is_admin())
  with check (company_id = public.my_company_id() and public.is_admin());
