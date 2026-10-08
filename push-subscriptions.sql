create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  company_id uuid,
  endpoint text not null unique,
  p256dh text,
  auth text,
  created_at timestamptz default now()
);

alter table public.push_subscriptions enable row level security;

drop policy if exists "own push row" on public.push_subscriptions;
create policy "own push row" on public.push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
