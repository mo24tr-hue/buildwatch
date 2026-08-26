-- Meeting location / address
alter table public.meetings add column if not exists location text;
