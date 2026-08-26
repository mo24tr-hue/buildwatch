-- Project construction cost tracking (contractor + customer only in the app UI)
-- base_cost: original contract total set by contractor
-- amount_paid: total payments recorded by contractor
-- Displayed total = base_cost + sum(approved change_orders.amount)
-- Remaining = total - amount_paid

alter table public.projects
  add column if not exists base_cost numeric(12, 2),
  add column if not exists amount_paid numeric(12, 2) default 0;

comment on column public.projects.base_cost is 'Original construction contract amount before change orders';
comment on column public.projects.amount_paid is 'Total amount customer has paid (updated by contractor)';
