-- Showcase workspace: Acme Builders only, seeded logo / covers / phase photos
-- Isolated from real companies. Run full script in Supabase SQL Editor.

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
  logo text := 'https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=256&h=256&q=80';
  c1 text := 'https://images.unsplash.com/photo-1484154218962-a197022b5858?auto=format&fit=crop&w=1200&q=80';
  c2 text := 'https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=1200&q=80';
  c3 text := 'https://images.unsplash.com/photo-1556912173-3bb406ef7e77?auto=format&fit=crop&w=1200&q=80';
  imgs text[] := array[
    'https://images.unsplash.com/photo-1504307651254-35680f356dfd?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1541888946425-d81bb19240f5?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1621905252507-b35492cc74b4?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=80'
  ];
  i int;
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
    values ('Acme Builders', '#000000', logo)
    returning id into cid;
    update public.companies set is_showcase = true where id = cid;
  else
    update public.companies
    set name = 'Acme Builders',
        logo_url = logo,
        header_color = coalesce(header_color, '#000000')
    where id = cid;
  end if;

  -- Platform owner becomes contractor on THIS workspace only
  update public.profiles
  set company_id = cid,
      role = 'admin'
  where id = auth.uid();

  -- Wipe prior showcase projects so we always reseed clean fake data
  delete from public.photos
  where project_id in (select id from public.projects where company_id = cid);
  delete from public.phases
  where project_id in (select id from public.projects where company_id = cid);
  delete from public.change_orders
  where project_id in (select id from public.projects where company_id = cid);
  delete from public.projects where company_id = cid;

  -- Project 1
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

  -- Project 2
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

  -- Project 3
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

  -- Photos on every phase (2 each) using public construction images
  i := 1;
  for ph in
    select id, project_id from public.phases
    where project_id in (p1, p2, p3)
    order by project_id, sort_order
  loop
    insert into public.photos (project_id, phase_id, public_url, media_type, uploaded_by)
    values
      (ph.project_id, ph.id, imgs[1 + ((i - 1) % array_length(imgs, 1))], 'image', auth.uid()),
      (ph.project_id, ph.id, imgs[1 + (i % array_length(imgs, 1))], 'image', auth.uid());
    i := i + 1;
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
