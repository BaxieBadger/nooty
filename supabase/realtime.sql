-- Slår Supabase Realtime til for de tabeller, wall.html og cover.html lytter på.
-- Kør én gang i Nooty-projektet: SQL Editor → New query → indsæt → Run.
-- Kan køres igen uden fejl (springer tabeller over, der allerede er med).

do $$
declare t text;
begin
  foreach t in array array['projects', 'some_posts'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Tjek: begge tabeller skal stå på listen.
select tablename from pg_publication_tables where pubname = 'supabase_realtime';
