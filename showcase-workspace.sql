-- Showcase workspace for platform owner (real company data, no "demo" labels)
-- Run in Supabase SQL Editor

alter table public.companies
  add column if not exists is_showcase boolean not null default false;

create or replace function public.ensure_showcase_workspace()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  cid uuid;
  p1 uuid;
  p2 uuid;
  p3 uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'Not allowed';
  end if;

  select id into cid
  from public.companies
  where is_showcase = true
  order by created_at asc
  limit 1;

  if cid is null then
    insert into public.companies (name, header_color)
    values ('Acme Builders', '#000000')
    returning id into cid;

    update public.companies set is_showcase = true where id = cid;
  else
    update public.companies
    set name = 'Acme Builders'
    where id = cid;
  end if;

  -- Platform owner becomes contractor on this workspace
  update public.profiles
  set company_id = cid,
      role = 'admin'
  where id = auth.uid();

  -- Seed projects only when empty
  if not exists (select 1 from public.projects where company_id = cid) then
    insert into public.projects (
      company_id, address, style, status, start_date, end_date, created_by, base_cost, amount_paid
    ) values (
      cid, '142 Maple Street', 'Remodel', 'active', current_date - 40, null, auth.uid(), 98000, 40000
    ) returning id into p1;

    insert into public.phases (project_id, name, sort_order, status, trade) values
      (p1, 'Demo', 0, 'done', ''),
      (p1, 'Framing', 1, 'done', ''),
      (p1, 'Electrical', 2, 'done', ''),
      (p1, 'Insulation', 3, 'done', ''),
      (p1, 'Drywall', 4, 'done', ''),
      (p1, 'Paint', 5, 'active', ''),
      (p1, 'Flooring', 6, 'pending', ''),
      (p1, 'Finishings', 7, 'pending', '');

    insert into public.projects (
      company_id, address, style, status, start_date, end_date, created_by, base_cost, amount_paid
    ) values (
      cid, '88 Oak Avenue', 'Addition', 'active', current_date - 90, null, auth.uid(), 210000, 120000
    ) returning id into p2;

    insert into public.phases (project_id, name, sort_order, status, trade) values
      (p2, 'Excavation', 0, 'done', ''),
      (p2, 'Footings & Foundation', 1, 'done', ''),
      (p2, 'Framing', 2, 'done', ''),
      (p2, 'Roofing', 3, 'active', ''),
      (p2, 'Plumbing', 4, 'pending', ''),
      (p2, 'Electrical', 5, 'pending', ''),
      (p2, 'Insulation', 6, 'pending', ''),
      (p2, 'Drywall', 7, 'pending', '');

    insert into public.projects (
      company_id, address, style, status, start_date, end_date, created_by, base_cost, amount_paid
    ) values (
      cid, '21 Birch Lane', 'Kitchen', 'done', current_date - 120, current_date - 10, auth.uid(), 42000, 42000
    ) returning id into p3;

    insert into public.phases (project_id, name, sort_order, status, trade) values
      (p3, 'Demo', 0, 'done', ''),
      (p3, 'Plumbing Rough-in', 1, 'done', ''),
      (p3, 'Electrical Rough-in', 2, 'done', ''),
      (p3, 'Drywall', 3, 'done', ''),
      (p3, 'Cabinets', 4, 'done', ''),
      (p3, 'Countertops', 5, 'done', ''),
      (p3, 'Appliances', 6, 'done', ''),
      (p3, 'Finishings', 7, 'done', '');
  end if;

  return cid;
end;
$$;

grant execute on function public.ensure_showcase_workspace() to authenticated;

create or replace function public.leave_showcase_workspace()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Not allowed';
  end if;
  -- Detach from company so platform panel stays project-free by default
  update public.profiles
  set company_id = null
  where id = auth.uid()
    and public.is_platform_admin();
end;
$$;

grant execute on function public.leave_showcase_workspace() to authenticated;
