-- Superintendents and foremen can read every disciplinary and separation
-- form, company-wide.
--
-- The reason, in Fonzo's words: a superintendent inherits a man from
-- another super's crew and needs to know what he is getting. A written
-- warning for tying off wrong is exactly the thing the next supervisor
-- must know before putting him in a lift, and today that history is
-- invisible unless the same person happened to file it.
--
-- Scope is deliberately narrow. This does NOT make supers and foremen
-- full archive readers: they still see only their own JSAs, incidents,
-- medical events and uncontrolled events. The two personnel document
-- types are the entire exception.
--
-- The storage half matters as much as the table half. Document rows and
-- the actual PDF files are guarded separately, and the files are filed
-- under the submitter's own user id -- so without the second policy below
-- a super would see a disciplinary form listed and get an error opening
-- it. is_personnel_history_pdf() is SECURITY DEFINER so the lookup can
-- see the document row it is asked about; it answers exactly one
-- question, "is this file a disciplinary or separation PDF", and leaks
-- nothing else.

create or replace function private.can_see_personnel_history()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('superintendent', 'foreman')
  );
$$;

create or replace function private.is_personnel_history_pdf(path text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.documents
    where pdf_path = path
      and doc_type in ('disciplinary', 'separation')
  );
$$;

drop policy if exists "read own documents, or all if safety/hr" on public.documents;

create policy "read own documents, all if office, personnel history if super"
  on public.documents
  for select
  to authenticated
  using (
    submitted_by = auth.uid()
    or private.can_see_all_documents()
    or (
      doc_type in ('disciplinary', 'separation')
      and private.can_see_personnel_history()
    )
  );

drop policy if exists "read own document pdf, or all if safety/hr" on storage.objects;

create policy "read own document pdf, all if office, personnel history if super"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'documents'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or private.can_see_all_documents()
      or (
        private.can_see_personnel_history()
        and private.is_personnel_history_pdf(name)
      )
    )
  );
