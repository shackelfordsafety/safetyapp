-- 2026-09-30 code audit: database hardening.
--
-- APPLIED to the live project (SCH Safety App) on 2026-09-30 through the
-- Supabase connector, after checking the live functions matched this repo
-- and that no existing row breaks any rule below. Written during the
-- hand-over audit (see
-- reports/audits/2026-09-30_full-code-audit.md, section B). Each block
-- says what it closes; nothing here changes what a superintendent,
-- foreman, HR or the crew can do through the app.
--
-- Three blocks add constraints NOT VALID, then validate them at the end,
-- so an existing row that breaks a rule fails loudly rather than being
-- skipped. All three validated cleanly against the live data.

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
-- One duplicate already existed when this was applied: the TAPS JSA of
-- 2026-09-18 (publication 2ece0fc7-87fc-4fe0-a6ec-83f2da6d0d09), filed at
-- 10:41:37 and again at 10:41:43 on 2026-09-19 -- exactly the race this
-- closes. Filed records are never deleted, so the second copy
-- (784f3811-6384-4f12-b357-b92102d8e2a0) is left in place and simply left
-- out of the index; the first copy is the one the rule protects.
create unique index if not exists documents_one_record_per_publication
  on public.documents ((data->>'archivedPublicationId'))
  where doc_type = 'jsa'
    and (data->>'archivedPublicationId') is not null
    and id <> '784f3811-6384-4f12-b357-b92102d8e2a0'::uuid;

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
set search_path to ''
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
-- Real signatures on the live project ran 9.6 KB to 171 KB when this was
-- applied (high-resolution iPad pads are big), so the cap is 500 KB: clear
-- of any genuine drawing, far short of a storage bill.
------------------------------------------------------------------------
alter table public.jsa_signatures
  add constraint jsa_signatures_size
  check (length(signature_data) between 100 and 500000
         and (signer_name is null or length(signer_name) <= 80))
  not valid;

alter table public.employee_requests
  add constraint employee_requests_size
  check ((statement is null or length(statement) <= 20000)
         and (signature_data is null or length(signature_data) <= 500000))
  not valid;

------------------------------------------------------------------------
-- 4. A board posting cannot be made to live for years.
--
-- Any login could insert a jsa_publications row with expires_at in 2099
-- onto anyone's board; one anonymous signature then made it un-removable
-- (the take-down policy needs zero signatures). A night shift published
-- the morning before runs ~46 hours to its expiry; 72 leaves room.
------------------------------------------------------------------------
alter table public.jsa_publications
  add constraint jsa_publications_expiry_window
  check (expires_at <= published_at + interval '72 hours'
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
-- 8. A JSA submitted for review can only be filed by somebody who can see
--    it.
--
-- can_file_doc_type('jsa') is true for every role, and
-- file_reviewed_document runs as its owner, so a field user who learned an
-- open-document uuid could file it. Replaced whole: IDENTICAL to
-- 20260911040000_filing_is_one_transaction.sql (the only definition) except
-- for the one added check, marked below.
------------------------------------------------------------------------
create or replace function public.file_reviewed_document(open_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  doc public.open_documents%rowtype;
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  select * into doc from public.open_documents where id = open_id for update;
  if not found then
    raise exception 'That document is no longer waiting for sign-off — somebody may have just filed it.';
  end if;

  if doc.state is distinct from 'submitted' then
    raise exception 'That one has not been submitted for sign-off yet.';
  end if;

  if not private.can_file_doc_type(doc.doc_type) then
    raise exception 'You are not allowed to file a % document.', doc.doc_type;
  end if;

  -- ADDED 2026-09-30: every role may file a JSA, so for JSAs also require
  -- that the caller could see this one in the first place.
  if doc.doc_type = 'jsa'
     and not (doc.created_by = auth.uid()
              or doc.assigned_to = auth.uid()
              or private.can_see_all_documents()) then
    raise exception 'Not yours to file.';
  end if;

  insert into public.documents (
    doc_type, submitted_by, filed_by,
    employee_name, job_site, doc_date, data, client_doc_id, pdf_path
  ) values (
    doc.doc_type,
    doc.created_by,
    auth.uid(),
    nullif(btrim(coalesce(doc.employee_name, '')), ''),
    nullif(btrim(coalesce(doc.job_site, '')), ''),
    doc.doc_date,
    doc.data,
    doc.client_doc_id,
    doc.pdf_path
  )
  returning id into new_id;

  update public.document_edits
     set filed_document_id = new_id
   where open_document_id = open_id
     and filed_document_id is null;

  delete from public.open_documents where id = open_id;

  return new_id;
end;
$$;

-- create or replace keeps grants, but restate them so this file is safe
-- to run on its own (see 20260912020000 for why PUBLIC must be named).
revoke execute on function public.file_reviewed_document(uuid) from public;
revoke execute on function public.file_reviewed_document(uuid) from anon;
grant execute on function public.file_reviewed_document(uuid) to authenticated, service_role;

------------------------------------------------------------------------
-- 8b. The anonymous board lookup stops handing out signature images.
--
-- board_for returns each posting's whole JSA to anybody holding the board
-- link. When men signed on the superintendent's device BEFORE it was
-- published, their signature images were inside that JSA (crewSignatures)
-- and went out to every phone that scanned the code. The crew page never
-- reads them; filing reads jsa_publications directly, not through this
-- function, so the filed sheet keeps them. Identical to
-- 20260911020000_board_is_a_lookup_not_a_list.sql (the only definition)
-- except `p.data - 'crewSignatures'`.
------------------------------------------------------------------------
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
         p.doc_date, p.published_at, p.expires_at, p.version,
         p.data - 'crewSignatures',
         p.pdf_path
  from public.jsa_publications p
  where p.board_owner = owner
    and p.expires_at > now() - interval '36 hours'
  order by p.published_at asc;
$$;

grant execute on function public.board_for(uuid) to anon, authenticated;

------------------------------------------------------------------------
-- 9. Validate the NOT VALID constraints against existing rows. If any of
--    these fails, look at the offending rows before deciding anything.
------------------------------------------------------------------------
alter table public.jsa_signatures validate constraint jsa_signatures_size;
alter table public.employee_requests validate constraint employee_requests_size;
alter table public.jsa_publications validate constraint jsa_publications_expiry_window;
