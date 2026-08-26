-- Acme Builders showcase workspace with custom logo, home covers, phase-matched photos
-- Images ship in the app at /acme/*.jpg (deployed with Vercel)

alter table public.companies
  add column if not exists is_showcase boolean not null default false;

alter table public.projects
  add column if not exists base_cost numeric(12, 2),
  add column if not exists amount_paid numeric(12, 2) default 0,
  add column if not exists cover_photo_url text;

alter table public.photos
  add column if not exists public_url text,
  add column if not exists storage_path text,
  add column if not exists media_type text default 'image',
  add column if not exists phase_id uuid,
  add column if not exists project_id uuid,
  add column if not exists uploaded_by uuid;

alter table public.photos alter column storage_path drop not null;

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
  ph record;
  logo text := '/acme/logo.jpg';
  c1 text := '/acme/cover-maple.jpg';
  c2 text := '/acme/cover-oak.jpg';
  c3 text := '/acme/cover-birch.jpg';
  u text;
  u2 text;
  n text;
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
    insert into public.companies (name, header_color, logo_url)
    values ('Acme Builders', '#0B1C2C', logo)
    returning id into cid;
    update public.companies set is_showcase = true where id = cid;
  else
    update public.companies
    set name = 'Acme Builders',
        logo_url = logo,
        header_color = '#0B1C2C'
    where id = cid;
  end if;

  update public.profiles
  set company_id = cid,
      role = 'admin'
  where id = auth.uid();

  delete from public.photos
  where project_id in (select id from public.projects where company_id = cid);
  delete from public.phases
  where project_id in (select id from public.projects where company_id = cid);
  delete from public.change_orders
  where project_id in (select id from public.projects where company_id = cid);
  delete from public.projects where company_id = cid;

  insert into public.projects (
    company_id, address, style, status, start_date, end_date, created_by,
    base_cost, amount_paid, cover_photo_url
  ) values (
    cid, '142 Maple Street', 'Remodel', 'active', current_date - 40, null, auth.uid(),
    98000, 40000, c1
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
    company_id, address, style, status, start_date, end_date, created_by,
    base_cost, amount_paid, cover_photo_url
  ) values (
    cid, '88 Oak Avenue', 'Addition', 'active', current_date - 90, null, auth.uid(),
    210000, 120000, c2
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
    company_id, address, style, status, start_date, end_date, created_by,
    base_cost, amount_paid, cover_photo_url
  ) values (
    cid, '21 Birch Lane', 'Kitchen', 'done', current_date - 120, current_date - 10, auth.uid(),
    42000, 42000, c3
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

  for ph in
    select id, project_id, name from public.phases
    where project_id in (p1, p2, p3)
    order by project_id, sort_order
  loop
    n := lower(ph.name);
    if n like '%demo%' then
      u := '/acme/phase-demo.jpg'; u2 := '/acme/phase-demo.jpg';
    elsif n like '%excav%' then
      u := '/acme/phase-excavation.jpg'; u2 := '/acme/phase-excavation.jpg';
    elsif n like '%foot%' or n like '%found%' then
      u := '/acme/phase-foundation.jpg'; u2 := '/acme/phase-foundation.jpg';
    elsif n like '%fram%' then
      u := '/acme/phase-framing.jpg'; u2 := '/acme/phase-framing.jpg';
    elsif n like '%roof%' then
      u := '/acme/phase-roofing.jpg'; u2 := '/acme/phase-roofing.jpg';
    elsif n like '%plumb%' then
      u := '/acme/phase-plumbing.jpg'; u2 := '/acme/phase-plumbing.jpg';
    elsif n like '%electr%' then
      u := '/acme/phase-electrical.jpg'; u2 := '/acme/phase-electrical.jpg';
    elsif n like '%insul%' then
      u := '/acme/phase-insulation.jpg'; u2 := '/acme/phase-insulation.jpg';
    elsif n like '%drywall%' then
      u := '/acme/phase-drywall.jpg'; u2 := '/acme/phase-drywall.jpg';
    elsif n like '%paint%' then
      u := '/acme/phase-paint.jpg'; u2 := '/acme/phase-paint.jpg';
    elsif n like '%floor%' then
      u := '/acme/phase-flooring.jpg'; u2 := '/acme/phase-flooring.jpg';
    elsif n like '%cabinet%' then
      u := '/acme/phase-cabinets.jpg'; u2 := '/acme/phase-cabinets.jpg';
    elsif n like '%counter%' then
      u := '/acme/phase-countertops.jpg'; u2 := '/acme/phase-countertops.jpg';
    elsif n like '%appliance%' then
      u := '/acme/phase-appliances.jpg'; u2 := '/acme/phase-appliances.jpg';
    elsif n like '%finish%' then
      u := '/acme/phase-finishings.jpg'; u2 := '/acme/phase-finishings.jpg';
    else
      u := '/acme/phase-finishings.jpg'; u2 := '/acme/phase-framing.jpg';
    end if;

    insert into public.photos (project_id, phase_id, public_url, storage_path, media_type, uploaded_by)
    values
      (ph.project_id, ph.id, u, 'showcase/' || ph.id::text || '/a.jpg', 'image', auth.uid()),
      (ph.project_id, ph.id, u2, 'showcase/' || ph.id::text || '/b.jpg', 'image', auth.uid());
  end loop;

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
  update public.profiles
  set company_id = null
  where id = auth.uid()
    and public.is_platform_admin();
end;
$$;

grant execute on function public.leave_showcase_workspace() to authenticated;
