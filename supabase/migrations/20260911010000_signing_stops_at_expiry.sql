-- Signing stops when the JSA expires.
--
-- The insert rule only checked that the publication existed. It never
-- looked at the clock, so a board link kept accepting signatures forever --
-- somebody could sign a JSA days after the shift it covered, and the record
-- would show them as having signed it.
--
-- The app already knew better (boardStatus() marks an expired board
-- "Closed"), but the app is not a rule. Anyone can post straight at the
-- API with the publishable key, which by design ships in the page. A
-- signature on a safety document is the kind of thing that gets read back
-- after somebody is hurt, so the clock belongs in the database.
--
-- This deliberately replaces the previous behaviour, which recorded late
-- signatures and flagged them rather than refusing. The reasoning then was
-- that refusing a man at 3:45 for a JSA that expired at 3:30 leaves an
-- unsigned worker on an active job. Fonzo's call, 2026-09-11: "I'd rather
-- no one be able to sign a JSA when it expires. No point in signing when
-- the work is done." The right answer to work running past its JSA is a
-- new JSA, not a signature against a hazard assessment whose window has
-- closed.
--
-- The is_late column stays. Signatures recorded under the old behaviour
-- are real and keep their flag.

drop policy if exists "anyone can sign a published jsa" on public.jsa_signatures;

create policy "anyone can sign a jsa that is still open"
  on public.jsa_signatures
  for insert
  to anon, authenticated
  with check (
    exists (
      select 1
      from public.jsa_publications p
      where p.id = jsa_signatures.publication_id
        and p.expires_at > now()
    )
  );
