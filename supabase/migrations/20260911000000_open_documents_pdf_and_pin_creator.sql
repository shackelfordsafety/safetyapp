-- Two things, both on public.open_documents.
--
-- 1. pdf_path. Written the night open documents was built and never
--    applied -- Supabase was down that evening. An open document that has
--    been submitted for sign-off carries its PDF with it, made once by its
--    author, rather than being regenerated at filing time by an approver
--    who never opened the workflow.
--
-- 2. Pin created_by. The UPDATE policy's WITH CHECK reads
--    `(created_by = created_by)`, which is a tautology -- it compares the
--    new row's column to itself and is true for every row. It looks like a
--    guard and is not one. RLS cannot see the OLD row, so the real fix is
--    a trigger.
--
--    What it actually let through: anybody who can update an open document
--    (its creator, the person it is handed to, or an office role) could
--    rewrite created_by. Handing a document to somebody therefore let them
--    make themselves the creator -- and the DELETE policy is
--    `created_by = auth.uid()`, so they could then abandon a document that
--    was never theirs. Found 2026-09-11 reading the policies; small blast
--    radius today because nothing in the app links to this table yet,
--    which is exactly why it was worth closing before it goes live.

alter table public.open_documents add column if not exists pdf_path text;

create or replace function private.pin_open_document_creator()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Who started a document is a fact about the past. Nothing edits it.
  if new.created_by is distinct from old.created_by then
    new.created_by := old.created_by;
  end if;
  if new.created_at is distinct from old.created_at then
    new.created_at := old.created_at;
  end if;
  -- Bookkeeping the client should not have to be trusted to set.
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists pin_open_document_creator on public.open_documents;
create trigger pin_open_document_creator
  before update on public.open_documents
  for each row execute function private.pin_open_document_creator();
