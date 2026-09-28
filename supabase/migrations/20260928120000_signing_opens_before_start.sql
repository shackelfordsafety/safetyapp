-- Signing opens 30 minutes before the shift starts.
--
-- Fonzo, 2026-09-28: "if you're publishing JSA's early, let's say the night
-- prior, i think you can only sign the JSA like 30 mins prior to the start
-- time, that way someone can't check the board the night before and sign
-- early". A test JSA for the next morning was sitting on a board reading
-- "expires in 33 hours" -- signable all night.
--
-- This reverses the 2026-09-09 reading that "upcoming" was a label, not a
-- lock (see boardStatus in src/crew/board.js). It is a lock now, and like
-- the expiry lock (20260911010000_signing_stops_at_expiry.sql) it lives in
-- the database, because the app is not a rule: the publishable key ships
-- in the page and anyone can post straight at the API.
--
-- WHY A COLUMN AND NOT date + timeIssued FROM data: those are wall-clock
-- times with no timezone. The publisher's device knows its timezone; the
-- database does not. So the device works the instant out once, at publish,
-- and stores it -- same way expires_at already is.
--
-- NULL means "no start time was known" and keeps today's behaviour: open
-- from publish until expiry. Every posting that exists before this runs is
-- NULL, so nothing already on a board changes.

alter table public.jsa_publications
  add column if not exists opens_at timestamptz;

comment on column public.jsa_publications.opens_at is
  'When crew signing opens: 30 minutes before Time Issued, worked out on the publishing device. NULL = open from publish.';

-- The one function the insert policy on jsa_signatures calls. Replaced in
-- place, same name and signature, so the policy itself is untouched (see
-- 20260911020000_board_is_a_lookup_not_a_list.sql for why the lookup has
-- to be a SECURITY DEFINER function in public).
create or replace function public.publication_is_open(pub uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.jsa_publications p
    where p.id = pub
      and p.expires_at > now()
      and (p.opens_at is null or p.opens_at <= now())
  );
$$;

grant execute on function public.publication_is_open(uuid) to anon, authenticated;
