-- The board stops being a list anyone can read end to end.
--
-- The rule was `USING (true)` for anon, written to mean "a crew member
-- with the link can read the JSA". What it actually meant: anybody holding
-- the publishable key -- which ships inside the page, by design, because
-- that is how a no-login QR works -- could ask for the whole table and get
-- every JSA the company has ever published. Job sites, locations, job
-- numbers, tasks, hazards, controls, superintendent names, emergency
-- numbers. Not personal information (crew sign-in records no names) but a
-- complete list of where Shackelford is working.
--
-- The fix answers one question instead of handing over the cabinet: tell
-- me whose board you want. The crew page already knows -- the board owner
-- is in the QR link -- so nothing changes for a man scanning it.
--
-- TWO TRAPS, both hit while building this, both worth keeping written
-- down because either one breaks signing for an entire crew while
-- continuing to work perfectly for anyone signed in:
--
--   1. The insert rule on jsa_signatures looked the publication up with a
--      plain `exists (select 1 from jsa_publications ...)`. That subquery
--      is subject to RLS like any other read. Remove anon's SELECT and the
--      EXISTS silently returns false for every anonymous signer. The
--      lookup has to move into a SECURITY DEFINER function first.
--
--   2. That function cannot live in the `private` schema. anon has no
--      USAGE there -- has_schema_privilege('anon','private','USAGE') is
--      false -- so the policy raises "permission denied for schema
--      private" instead. It lives in public, with EXECUTE granted
--      explicitly. It returns one boolean about a publication whose id the
--      caller already has, so it cannot be used to enumerate anything.

create or replace function public.publication_is_open(pub uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.jsa_publications p
    where p.id = pub and p.expires_at > now()
  );
$$;

grant execute on function public.publication_is_open(uuid) to anon, authenticated;

drop policy if exists "anyone can sign a jsa that is still open" on public.jsa_signatures;

create policy "anyone can sign a jsa that is still open"
  on public.jsa_signatures
  for insert
  to anon, authenticated
  with check (public.publication_is_open(publication_id));

-- One board, by owner. The only way an anonymous caller reads a
-- publication now. Capped at 36 hours so the link cannot be used to walk a
-- superintendent's history -- the crew page only ever wants today, and it
-- applies its own local-midnight filter on top, where the device's clock
-- and timezone actually are.
create or replace function public.board_for(owner uuid)
returns table (
  id uuid,
  area_label text,
  job_site text,
  location text,
  job_number text,
  doc_date date,
  published_at timestamptz,
  expires_at timestamptz,
  version integer,
  data jsonb,
  pdf_path text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select p.id, p.area_label, p.job_site, p.location, p.job_number,
         p.doc_date, p.published_at, p.expires_at, p.version, p.data, p.pdf_path
  from public.jsa_publications p
  where p.board_owner = owner
    and p.expires_at > now() - interval '36 hours'
  order by p.published_at asc;
$$;

grant execute on function public.board_for(uuid) to anon, authenticated;

-- The blanket read goes away. Signed-in users keep reading their own
-- board; the office roles that already see the whole archive keep seeing
-- every board.
drop policy if exists "anyone can read a published jsa" on public.jsa_publications;

create policy "read your own board, or every board if office"
  on public.jsa_publications
  for select
  to authenticated
  using (
    board_owner = auth.uid()
    or published_by = auth.uid()
    or private.can_see_all_documents()
  );
