create table public.email_registrations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text not null,
  created_at timestamptz not null default now()
);

alter table public.email_registrations enable row level security;

create policy "Allow public insert"
  on public.email_registrations
  for insert
  to anon
  with check (true);
