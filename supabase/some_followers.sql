-- Nooty: SoMe-følgertal og -mål (Vækst-fanen under SoMe).
-- Kør denne fil én gang i Supabase for Nooty-projektet:
-- Project -> SQL Editor -> New query -> indsæt -> Run.
--
-- Tabellen følger samme mønster som some_posts: én række pr. post med JSON i "data".
-- data.kind = 'snapshot' -> { dato, orgEnhed, platform, foelgere }
-- data.kind = 'goal'     -> { orgEnhed, platform, maal, deadline }

create table if not exists some_followers (
  id bigint primary key,
  data jsonb not null,
  created_at timestamptz not null default now()
);

-- Samme adgang som Nooty's øvrige tabeller: app'en læser og skriver med anon-nøglen.
alter table some_followers enable row level security;

drop policy if exists "Nooty anon adgang" on some_followers;
create policy "Nooty anon adgang" on some_followers
  for all using (true) with check (true);
