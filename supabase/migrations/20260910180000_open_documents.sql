-- Documents that aren't finished yet.
--
-- Until now a document was in one of two places: on one man's iPad where
-- nobody else could see it and where it dies with the device, or in the
-- archive, permanently, with no edit and no delete. There was nothing in
-- between -- and "nobody has all the information yet" is the normal case
-- on an incident report waiting for a witness statement, not the
-- exception.
--
-- This is that in-between. It is WORKING STATE, and it is deliberately a
-- separate table from public.documents rather than a status column on it.
-- The archive's guarantee is that it has no UPDATE and no DELETE policy at
-- all; adding an editable row type to it would put an edit door into the
-- one system whose entire value is that it has no edit door, and doors get
-- widened later. Two tables means the guarantee stays structural.
--
-- WHO CAN SEE ONE. The person who created it, the person it has been
-- handed to, and the office roles that already see the whole archive
-- (safety, hr, pm, clerk).
--
-- Note what that does NOT include: superintendents and foremen can read
-- every FILED disciplinary form, but they cannot read another
-- superintendent's half-written one. A finished write-up is a record the
-- next supervisor needs; a draft is somebody mid-thought, and the two are
-- not the same thing.
--
-- Unlike the archive this table has UPDATE and DELETE, on purpose. That is
-- what working state means: a document here is meant to change, and
-- abandoning a draft is a legitimate thing to do. Once it is filed it
-- moves to public.documents and becomes permanent.

create table if not exists public.open_documents (
  id uuid primary key default gen_random_uuid(),
  doc_type text not null check (doc_type in ('jsa', 'incident', 'disciplinary', 'uncontrolledEvent', 'medicalEvent', 'separation')),

  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),

  -- Who is holding it right now. Null means nobody in particular, which is
  -- normal -- most documents are finished by the person who started them.
  assigned_to uuid references auth.users(id),

  -- Free text, deliberately: "waiting on Chris's witness statement", "need
  -- the doctor's note". A fixed list would have to be guessed correctly up
  -- front, and the day it doesn't fit, people pick Other and type it
  -- anyway. A few months of real answers will write the list if one is
  -- ever wanted.
  waiting_on text,

  -- Denormalised so the list screen can show and search without opening
  -- every document. Same three fields the archive summarises by.
  employee_name text,
  job_site text,
  doc_date date,

  -- The document itself, in the same shape its workflow already uses.
  data jsonb not null,
  client_doc_id text,

  -- Soft lock. Not enforcement -- a hint so two people don't unknowingly
  -- work on the same report at once. Real conflicts should be rare because
  -- documents get handed over deliberately.
  locked_by uuid references auth.users(id),
  locked_at timestamptz
);

create index if not exists open_documents_mine_idx
  on public.open_documents (created_by, updated_at desc);
create index if not exists open_documents_assigned_idx
  on public.open_documents (assigned_to, updated_at desc);

alter table public.open_documents enable row level security;

create policy "see open documents you are part of"
  on public.open_documents for select
  to authenticated
  using (
    created_by = auth.uid()
    or assigned_to = auth.uid()
    or private.can_see_all_documents()
  );

create policy "start an open document"
  on public.open_documents for insert
  to authenticated
  with check (created_by = auth.uid());

-- Anyone who can see it can work on it: that is the entire point. What
-- somebody must NOT be able to do is change who created it.
create policy "work on an open document"
  on public.open_documents for update
  to authenticated
  using (
    created_by = auth.uid()
    or assigned_to = auth.uid()
    or private.can_see_all_documents()
  )
  with check (created_by = created_by);

-- Abandoning a draft is legitimate; the person who started it and the
-- office can. Somebody it was merely handed to cannot throw away another
-- man's work.
create policy "abandon an open document"
  on public.open_documents for delete
  to authenticated
  using (
    created_by = auth.uid()
    or private.can_see_all_documents()
  );
