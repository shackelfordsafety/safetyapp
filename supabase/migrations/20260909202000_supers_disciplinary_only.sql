-- Narrows what superintendents and foremen can read across crews:
-- every DISCIPLINARY form, and nothing else that isn't theirs.
--
-- The earlier version of this (same day, one migration back) also handed
-- them every separation form. Fonzo pulled that back, and he is right to:
-- the two documents look similar and aren't. A write-up is a live safety
-- fact about a man who is on your crew tomorrow -- the next supervisor
-- has to know he has been disciplined for tying off wrong before putting
-- him in a lift. A separation form is about somebody who is already gone,
-- and it carries the reason he left, which is the most legally loaded
-- paper in this system.
--
-- So: separation stays with safety, hr, pm and clerk. Superintendents and
-- foremen see their OWN separations (and their own everything else) plus
-- all disciplinary, company-wide.
--
-- The functions are renamed rather than reused. A predicate called
-- "personnel history" that in fact means "disciplinary only" is the kind
-- of thing that reads as a bug to whoever comes next, and these were
-- written hours ago with nothing else depending on them.

create or replace function private.can_see_all_disciplinary()
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

create or replace function private.is_disciplinary_pdf(path text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.documents
    where pdf_path = path
      and doc_type = 'disciplinary'
  );
$$;

drop policy if exists "read own documents, all if office, personnel history if super" on public.documents;

create policy "read own documents, all if office, all disciplinary if super"
  on public.documents
  for select
  to authenticated
  using (
    submitted_by = auth.uid()
    or private.can_see_all_documents()
    or (doc_type = 'disciplinary' and private.can_see_all_disciplinary())
  );

drop policy if exists "read own document pdf, all if office, personnel history if super" on storage.objects;

create policy "read own document pdf, all if office, disciplinary if super"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'documents'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or private.can_see_all_documents()
      or (
        private.can_see_all_disciplinary()
        and private.is_disciplinary_pdf(name)
      )
    )
  );

drop function if exists private.can_see_personnel_history();
drop function if exists private.is_personnel_history_pdf(text);
