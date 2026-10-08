-- Trade portal: ready-for-you on a phase, bill status on a task,
-- and a notice that only the trade on that phase receives.

alter table public.phases add column if not exists ready_state text default 'not_ready';
alter table public.tasks add column if not exists bill_status text default 'asked';

update public.phases set ready_state = 'not_ready' where ready_state is null;
update public.tasks set bill_status = 'asked' where bill_status is null;
update public.tasks set bill_status = 'photo_in'
where bill_status = 'asked'
  and exists (select 1 from public.task_photos tp where tp.task_id = tasks.id);

create or replace function public.notify_phase_team(
  p_company_id uuid,
  p_project_id uuid,
  p_phase_id uuid,
  p_title text,
  p_body text,
  p_kind text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (company_id, user_id, project_id, title, body, kind)
  select distinct p_company_id, pt.user_id, p_project_id, p_title, p_body, p_kind
  from public.phase_team pt
  join public.profiles pr on pr.id = pt.user_id
  where pt.phase_id = p_phase_id
    and pr.role = 'team';
end;
$$;

grant execute on function public.notify_phase_team(uuid, uuid, uuid, text, text, text) to authenticated;
