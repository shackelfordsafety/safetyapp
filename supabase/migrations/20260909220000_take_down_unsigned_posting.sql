-- Let a superintendent take his own posting down, but only while nobody
-- has signed it.
--
-- Fonzo published a night-shift JSA with Time Expired set to 5:00 PM
-- instead of 5:00 AM, spotted it himself within seconds, and then had no
-- way to fix it -- he had to message me to delete the row by hand. A man
-- who catches his own mistake immediately should not need anybody's help
-- to undo it.
--
-- The line is signatures, not time. An unsigned posting is a mistake and
-- deleting it costs nothing. The moment one man has signed, it is a record
-- of who agreed to what, and it stays -- that is the same principle the
-- archive is built on. Fixing a signed posting means publishing a revision
-- instead, which keeps the old one and whoever signed it.
--
-- The count goes through a SECURITY DEFINER function on purpose. Written
-- as a plain EXISTS against jsa_signatures, the check would run under the
-- caller's own row-level security -- so if a future policy change ever
-- narrowed who can read signatures, the subquery would quietly find none
-- and this policy would start allowing deletion of signed postings. A
-- guard that fails open when an unrelated policy changes is not a guard.

create or replace function private.publication_signature_count(pub uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select count(*)::int from public.jsa_signatures where publication_id = pub;
$$;

create policy "take down your own unsigned posting"
  on public.jsa_publications
  for delete
  to authenticated
  using (
    board_owner = auth.uid()
    and private.publication_signature_count(id) = 0
  );
