-- ── Filed PDFs ──────────────────────────────────────────────────────────
-- The archive stores BOTH the document's data and the PDF that was actually
-- generated, printed and signed (Fonzo, 2026-09-08). The data is what makes
-- the archive searchable; the PDF is the record. Re-rendering a document
-- from its data years later, on a newer build of the app, is not guaranteed
-- to reproduce what somebody actually signed -- for a disciplinary that ends
-- up in a dispute, "here is the file" beats "we regenerated it".
--
-- Files are keyed <user id>/<document id>.pdf so ownership is in the path,
-- which is what the policies below match on.

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- where the pdf for a row lives; null until one is uploaded
alter table public.documents add column if not exists pdf_path text;

-- Same access model as the documents table itself. Note there are again no
-- UPDATE or DELETE policies: a filed PDF cannot be replaced or removed from
-- the app by anybody, safety and hr included.
drop policy if exists "file a document pdf" on storage.objects;
drop policy if exists "read own document pdf, or all if safety/hr" on storage.objects;

create policy "file a document pdf"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "read own document pdf, or all if safety/hr"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'documents'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or private.can_see_all_documents()
    )
  );
