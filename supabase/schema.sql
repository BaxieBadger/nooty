-- Kør denne fil én gang i Supabase: Project -> SQL Editor -> New query -> Run.

create table if not exists children (
  slug text primary key,
  name text not null
);

insert into children (slug, name) values
  ('amy', 'Amy'),
  ('josefina', 'Josefina')
on conflict (slug) do nothing;

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  child_slug text not null references children(slug),
  account_type text not null check (account_type in ('lommepenge', 'toejpenge')),
  amount numeric not null check (amount <> 0),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists transactions_child_slug_idx on transactions (child_slug);

alter table children enable row level security;
alter table transactions enable row level security;

-- Alle (også børnene, uden login) må se navne, saldi og bevægelser.
create policy "Alle kan læse children" on children
  for select using (true);

create policy "Alle kan læse transactions" on transactions
  for select using (true);

-- Kun logget ind (forældre) må tilføje eller slette bevægelser.
create policy "Logget ind kan tilføje transactions" on transactions
  for insert with check (auth.role() = 'authenticated');

create policy "Logget ind kan slette transactions" on transactions
  for delete using (auth.role() = 'authenticated');
