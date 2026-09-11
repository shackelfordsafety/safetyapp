-- Filing a reviewed document, atomically -- and fixing who owns it after.
--
-- Both problems found by an outside source review, 2026-09-11, and both
-- real.
--
-- ONE: it was two calls from the browser -- insert the archive row, then
-- delete the open row. Two approvers tapping at the same moment, or a
-- delete that fails after a successful insert and then gets retried,
-- produces DUPLICATE permanent records. public.documents has no UPDATE and
-- no DELETE policy by design, so a duplicate there can never be cleaned up
-- from the app.
--
-- TWO, and I would not have caught this one: the archive row recorded the
-- APPROVER as submitted_by, while the archive read policy uses
-- submitted_by = auth.uid() to mean "your own documents". So approving a
-- superintendent's incident report made it disappear from that
-- superintendent's own records. Authorship and approval are now separate:
-- submitted_by stays the AUTHOR; filed_by records who signed it off.
--
-- Verified end to end with two real accounts driving the real UI
-- (tools/testing/simulate-review-chain.mjs): one archive row, author =
-- the author, filed_by = the approver, zero rows left open, and no
-- duplicate after deliberately submitting twice.

alter table public.documents add column if not exists filed_by uuid references auth.users(id);

comment on column public.documents.submitted_by is
  'The person whose document this is -- the author. Drives "my own documents" in the read policy. NOT the approver.';
comment on column public.documents.filed_by is
  'The approver who signed it off and filed it. Null for documents filed directly by their own author.';

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

  -- Lock it. Two approvers racing means the second finds it already gone
  -- and is told so, instead of filing it twice.
  select * into doc from public.open_documents where id = open_id for update;
  if not found then
    raise exception 'That document is no longer waiting for sign-off — somebody may have just filed it.';
  end if;

  if doc.state is distinct from 'submitted' then
    raise exception 'That one has not been submitted for sign-off yet.';
  end if;

  -- The same rule the INSERT policy enforces, checked here because this
  -- function runs as its owner and bypasses that policy.
  if not private.can_file_doc_type(doc.doc_type) then
    raise exception 'You are not allowed to file a % document.', doc.doc_type;
  end if;

  insert into public.documents (
    doc_type, submitted_by, filed_by,
    employee_name, job_site, doc_date, data, client_doc_id, pdf_path
  ) values (
    doc.doc_type,
    doc.created_by,   -- the author keeps ownership, and keeps access
    auth.uid(),       -- who approved it
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

grant execute on function public.file_reviewed_document(uuid) to authenticated;
