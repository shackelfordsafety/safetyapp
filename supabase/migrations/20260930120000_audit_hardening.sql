-- 2026-09-30 code audit: database hardening.
--
-- NOT YET APPLIED. Written during the hand-over audit (see
-- reports/audits/2026-09-30_full-code-audit.md, section "Database"). Every
-- item below was checked against the final state of the earlier
-- migrations, but nothing here has been run against the live project.
-- Read it, then run it in the Supabase SQL editor the same way the earlier
-- files were. Each block says what it closes and what it changes for
-- people; nothing here changes what a superintendent, foreman, HR or the
-- crew can do through the app.
--
-- Three of the blocks add constraints. They are added NOT VALID so that
-- rows already in the tables are never the reason the migration fails;
-- run the `validate constraint` lines afterwards, and if one fails, that
-- is a real row worth looking at, not a reason to skip the rule.

------------------------------------------------------------------------
-- 1. A JSA posting can only be filed into the archive once.
--
-- The auto-archive runs on every device the board owner is signed in on.
-- Two devices seeing the same posting expire within the same minute both
-- filed it -- and the archive is append-only, so the duplicate was
-- permanent. The app now scopes its "already filed" check properly, but
-- the database is the only thing that can actually stop the race.
--
-- If this index refuses to build, duplicates already exist. Find them:
--   select data->>'archivedPublicationId', count(*) from public.documents
--   where doc_type = 'jsa' group by 1 having count(*) > 1;
-- They cannot be deleted through the app (by design); note them in the
-- hand-over and create the index with the duplicates' ids excluded.
------------------------------------------------------------------------
create unique index if not exists documents_one_record_per_publication
  on public.documents ((data->>'archivedPublicationId'))
  where doc_type = 'jsa' and (data->>'archivedPublicationId') is not null;

------------------------------------------------------------------------
-- 2. Filed documents and crew signatures cannot be changed or removed,
--    even from the SQL editor.
--
-- HANDOVER.md says "not whoever holds every password. The filing cabinet
-- itself refuses." That was true of the app's keys (no update/delete
-- policy exists) but not of the dashboard login, which runs as postgres.
-- A trigger that always raises makes the refusal real for casual edits
-- too. (A determined postgres can still drop the trigger -- that is
-- deliberate, and visible in the logs.)
------------------------------------------------------------------------
create or replace function private.archive_is_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Filed documents cannot be changed or removed. File a corrected copy instead.';
end
$$;

drop trigger if exists documents_immutable on public.documents;
create trigger documents_immutable
  before update or delete on public.documents
  for each row execute function private.archive_is_immutable();

drop trigger if exists jsa_signatures_immutable on public.jsa_signatures;
create trigger jsa_signatures_immutable
  before update or delete on public.jsa_signatures
  for each row execute function private.archive_is_immutable();

------------------------------------------------------------------------
-- 3. Size limits on the two tables anyone with the board link can write to.
--
-- jsa_signatures takes inserts from the anon key (that is how a crew phone
-- signs). Nothing capped the size of a row, and nothing can delete one.
-- A real signature PNG from the pad is a few KB; 200 KB is well clear of
-- any genuine drawing and well short of a storage bill.
------------------------------------------------------------------------
alter table public.jsa_signatures
  add constraint jsa_signatures_size
  check (length(signature_data) between 100 and 200000
         and (signer_name is null or length(signer_name) <= 80))
  not valid;

alter table public.employee_requests
  add constraint employee_requests_size
  check ((statement is null or length(statement) <= 20000)
         and (signature_data is null or length(signature_data) <= 200000))
  not valid;

------------------------------------------------------------------------
-- 4. A board posting cannot be made to live for years.
--
-- Any login could insert a jsa_publications row with expires_at in 2099
-- onto anyone's board; one anonymous signature then made it un-removable
-- (the take-down policy needs zero signatures). Night shifts published
-- the evening before need under a day; 48 hours leaves room.
------------------------------------------------------------------------
alter table public.jsa_publications
  add constraint jsa_publications_expiry_window
  check (expires_at <= published_at + interval '48 hours'
         and (opens_at is null or opens_at <= expires_at))
  not valid;

------------------------------------------------------------------------
-- 5. A hand-off request starts blank and lives two hours, whatever the
--    client says.
--
-- The employee_requests insert policy only checked requested_by. The
-- link lifetime, and the employee's own statement/signature/responded_at,
-- were all insertable by the requester -- so the "employee's words are
-- written once, by the employee" rule was a default, not a rule.
------------------------------------------------------------------------
create or replace function private.new_handoff_is_blank()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  new.created_at := now();
  new.expires_at := now() + interval '2 hours';
  new.statement := null;
  new.signature_data := null;
  new.responded_at := null;
  return new;
end
$$;

drop trigger if exists new_handoff_is_blank on public.employee_requests;
create trigger new_handoff_is_blank
  before insert on public.employee_requests
  for each row execute function private.new_handoff_is_blank();

------------------------------------------------------------------------
-- 6. set_person_role is not a public endpoint.
--
-- Same fix 20260912020000 made for the filing functions: Postgres grants
-- EXECUTE on every new function to PUBLIC, and anon inherits that. It
-- fails with "Not signed in." for anon today, but it should not answer
-- at all.
------------------------------------------------------------------------
revoke execute on function public.set_person_role(uuid, text) from public;
revoke execute on function public.set_person_role(uuid, text) from anon;
grant execute on function public.set_person_role(uuid, text) to authenticated;

------------------------------------------------------------------------
-- 7. link_edits_to_filed has no caller left.
--
-- file_reviewed_document does the linking itself (20260911040000). The
-- old function let safety/clerk stamp any edit notice with any uuid.
------------------------------------------------------------------------
drop function if exists public.link_edits_to_filed(uuid, uuid);

------------------------------------------------------------------------
-- 8. Any JSA draft submitted for review can only be filed by someone who
--    can see it.
--
-- can_file_doc_type('jsa') is true for every role, and
-- file_reviewed_document runs as definer, so a field user who learned an
-- open-document uuid could file it. The function is replaced whole,
-- identical to 20260911040000 except for the one added check.
------------------------------------------------------------------------
-- (Left as a TODO for whoever applies this: copy the body of
--  public.file_reviewed_document from 20260911040000 and add, right after
--  the `for update` fetch:
--    if doc.doc_type = 'jsa'
--       and not (doc.created_by = auth.uid() or doc.assigned_to = auth.uid()
--                or private.can_see_all_documents()) then
--      raise exception 'Not yours to file.';
--    end if;
--  It is not reproduced here so this file cannot silently drift from the
--  live function text.)

------------------------------------------------------------------------
-- 9. Validate the NOT VALID constraints against existing rows. If any of
--    these fails, look at the offending rows before deciding anything.
------------------------------------------------------------------------
alter table public.jsa_signatures validate constraint jsa_signatures_size;
alter table public.employee_requests validate constraint employee_requests_size;
alter table public.jsa_publications validate constraint jsa_publications_expiry_window;
