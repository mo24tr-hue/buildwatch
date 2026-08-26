-- Meetings: company-wide (calendar) or attached to a project
create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  title text not null,
  notes text,
  meet_date date not null,
  meet_time time,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists meetings_company_date_idx on public.meetings (company_id, meet_date);
create index if not exists meetings_project_idx on public.meetings (project_id, meet_date);

alter table public.meetings enable row level security;

drop policy if exists "meetings_select" on public.meetings;
create policy "meetings_select" on public.meetings
  for select to authenticated
  using (
    company_id = public.my_company_id()
    and (
      public.is_admin()
      or project_id is null
      or exists (
        select 1 from public.project_customers pc
        where pc.project_id = meetings.project_id and pc.user_id = auth.uid()
      )
      or exists (
        select 1 from public.project_team pt
        where pt.project_id = meetings.project_id and pt.user_id = auth.uid()
      )
      or exists (
        select 1 from public.phase_team pht
        join public.phases ph on ph.id = pht.phase_id
        where ph.project_id = meetings.project_id and pht.user_id = auth.uid()
      )
    )
  );

drop policy if exists "meetings_insert" on public.meetings;
create policy "meetings_insert" on public.meetings
  for insert to authenticated
  with check (
    company_id = public.my_company_id()
    and (
      public.is_admin()
      or (
        project_id is not null
        and (
          exists (
            select 1 from public.project_team pt
            where pt.project_id = meetings.project_id and pt.user_id = auth.uid()
          )
          or exists (
            select 1 from public.phase_team pht
            join public.phases ph on ph.id = pht.phase_id
            where ph.project_id = meetings.project_id and pht.user_id = auth.uid()
          )
        )
      )
    )
  );

drop policy if exists "meetings_update" on public.meetings;
create policy "meetings_update" on public.meetings
  for update to authenticated
  using (company_id = public.my_company_id() and public.is_admin())
  with check (company_id = public.my_company_id() and public.is_admin());

drop policy if exists "meetings_delete" on public.meetings;
create policy "meetings_delete" on public.meetings
  for delete to authenticated
  using (
    company_id = public.my_company_id()
    and (public.is_admin() or created_by = auth.uid())
  );

grant select, insert, update, delete on public.meetings to authenticated;
