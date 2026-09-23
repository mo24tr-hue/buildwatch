-- Trial + complimentary / paid flags on companies.
-- Platform admin can grant free use (billing_exempt) or mark paid.

alter table public.companies
  add column if not exists plan text not null default 'trial',
  add column if not exists trial_ends_at timestamptz,
  add column if not exists billing_exempt boolean not null default false,
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text;

update public.companies
set trial_ends_at = created_at + interval '14 days'
where trial_ends_at is null;

create or replace function public.companies_set_trial()
returns trigger
language plpgsql
as $$
begin
  if new.trial_ends_at is null then
    new.trial_ends_at := now() + interval '14 days';
  end if;
  if new.plan is null or new.plan = '' then
    new.plan := 'trial';
  end if;
  return new;
end;
$$;

drop trigger if exists companies_set_trial on public.companies;
create trigger companies_set_trial
before insert on public.companies
for each row execute function public.companies_set_trial();

drop policy if exists "companies_update_platform_billing" on public.companies;
create policy "companies_update_platform_billing" on public.companies
  for update to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());
