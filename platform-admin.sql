-- Platform admin + in-app feedback for BuildWatch
-- Run once in Supabase SQL Editor

-- Flag on profiles (optional; email list also works in the app)
alter table public.profiles
  add column if not exists is_platform_admin boolean not null default false;

-- Mark your account (change email to your login):
-- update public.profiles set is_platform_admin = true where lower(email) = lower('you@example.com');

create table if not exists public.app_feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  message text not null,
  email text,
  user_id uuid references public.profiles(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  company_name text,
  user_role text,
  status text not null default 'new', -- new | reviewed | archived
  reviewed_at timestamptz
);

create index if not exists app_feedback_created_at_idx on public.app_feedback (created_at desc);
create index if not exists app_feedback_status_idx on public.app_feedback (status);

alter table public.app_feedback enable row level security;

-- Helper: platform admin by email or flag
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        p.is_platform_admin = true
        or lower(coalesce(p.email, '')) in (
          'buildwatchfeedback@gmail.com'
        )
      )
  );
$$;

grant execute on function public.is_platform_admin() to authenticated;

-- Anyone signed in can submit feedback
drop policy if exists "app_feedback_insert" on public.app_feedback;
create policy "app_feedback_insert" on public.app_feedback
  for insert to authenticated
  with check (auth.uid() is not null);

-- Only platform admins read / update feedback
drop policy if exists "app_feedback_select" on public.app_feedback;
create policy "app_feedback_select" on public.app_feedback
  for select to authenticated
  using (public.is_platform_admin());

drop policy if exists "app_feedback_update" on public.app_feedback;
create policy "app_feedback_update" on public.app_feedback
  for update to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

drop policy if exists "app_feedback_delete" on public.app_feedback;
create policy "app_feedback_delete" on public.app_feedback
  for delete to authenticated
  using (public.is_platform_admin());

-- Platform admin can list all companies
drop policy if exists "companies_select_platform" on public.companies;
create policy "companies_select_platform" on public.companies
  for select to authenticated
  using (public.is_platform_admin());

-- Platform admin can list all profiles (counts + oversight)
drop policy if exists "profiles_select_platform" on public.profiles;
create policy "profiles_select_platform" on public.profiles
  for select to authenticated
  using (public.is_platform_admin());

-- Platform admin can list all projects (counts)
drop policy if exists "projects_select_platform" on public.projects;
create policy "projects_select_platform" on public.projects
  for select to authenticated
  using (public.is_platform_admin());
