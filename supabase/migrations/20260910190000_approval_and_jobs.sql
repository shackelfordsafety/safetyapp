-- Sign-off, and a real list of jobs.
--
-- An incident report can end up in front of a client. Somebody senior has
-- to own that it is right before it leaves, and until now anybody who
-- could fill one in could also file it -- permanently, since the archive
-- cannot edit or delete.
--
-- WHO SIGNS OFF (Fonzo, 2026-09-10):
--   incident / medicalEvent / uncontrolledEvent -> the PM, with HR able to
--     stand in. HR already reads every document, so the backstop widens
--     nothing they cannot already see; it stops a report sitting unfiled
--     for a week because one man is offsite.
--   disciplinary / separation -> HR. Personnel paperwork is theirs, and
--     the PM has no part in it.
--   jsa -> nobody. It files itself when a published one expires, and it is
--     complete by definition at that point: the shift ended and the crew
--     signed.
--
-- Enforced HERE and not only in the app. A rule that lives in a screen is
-- a convention, and this one decides whether a document a client reads was
-- ever checked by anyone.

create or replace function private.my_role()
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select role from public.profiles where id = auth.uid();
$$;

/* Who may put THIS kind of document into the archive. Not a general
   "can approve" -- the answer differs by document, which is the whole
   point. */
create or replace function private.can_file_doc_type(kind text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    -- Files itself on expiry; the app does this on the owner's behalf.
    when kind = 'jsa' then true
    when kind in ('incident', 'medicalEvent', 'uncontrolledEvent')
      then private.my_role() in ('pm', 'hr')
    when kind in ('disciplinary', 'separation')
      then private.my_role() = 'hr'
    else false
  end;
$$;

drop policy if exists "file a document" on public.documents;

create policy "file a document once it is signed off"
  on public.documents for insert
  to authenticated
  with check (
    submitted_by = auth.uid()
    and private.can_file_doc_type(doc_type)
  );

-- ── Where a document sits while it waits ────────────────────────────────
-- 'open'      : somebody is still working on it
-- 'submitted' : sent for sign-off, waiting on the PM or HR
--
-- Three states rather than the two originally scoped, and this time earned
-- by a real process rather than copied from enterprise software.
alter table public.open_documents
  add column if not exists state text not null default 'open'
    check (state in ('open', 'submitted')),
  add column if not exists submitted_at timestamptz,
  add column if not exists submitted_by uuid references auth.users(id),
  -- Sending it back is half of approving. Approval with no way to say
  -- "not yet, and here is why" is just a delay button.
  add column if not exists returned_at timestamptz,
  add column if not exists returned_by uuid references auth.users(id),
  add column if not exists returned_note text;

-- ── Jobs ────────────────────────────────────────────────────────────────
-- A PM wants his own work, not everyone's. This is also exactly what the
-- equipment checklist needs for its job-number dropdown -- free-typed job
-- numbers are what broke the Smartsheet rollout, with the same job spelled
-- four ways and no way to filter. Built once, used twice.
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  job_number text not null,
  name text not null,
  location text,
  client text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create unique index if not exists jobs_number_idx on public.jobs (lower(job_number));

alter table public.jobs enable row level security;

-- Everybody signed in can read the job list: it is what makes a dropdown
-- possible, and a job number is not a secret.
create policy "read the job list"
  on public.jobs for select
  to authenticated
  using (true);

-- Only the office keeps the list. A job typed in by whoever happens to be
-- filling a form is the exact problem this table exists to end.
create policy "the office maintains jobs"
  on public.jobs for insert
  to authenticated
  with check (private.my_role() in ('pm', 'hr', 'safety', 'clerk'));

create policy "the office edits jobs"
  on public.jobs for update
  to authenticated
  using (private.my_role() in ('pm', 'hr', 'safety', 'clerk'))
  with check (private.my_role() in ('pm', 'hr', 'safety', 'clerk'));

-- ── Which jobs are mine ─────────────────────────────────────────────────
-- Self-service on purpose: Fonzo is not reliably told who is running what
-- day to day, and he does not want to be the bottleneck keeping a mapping
-- current. Same reasoning as foremen choosing their own superintendent.
create table if not exists public.my_jobs (
  user_id uuid not null references auth.users(id),
  job_id uuid not null references public.jobs(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (user_id, job_id)
);

alter table public.my_jobs enable row level security;

create policy "see your own job picks"
  on public.my_jobs for select
  to authenticated
  using (user_id = auth.uid());

create policy "pick your own jobs"
  on public.my_jobs for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "unpick your own jobs"
  on public.my_jobs for delete
  to authenticated
  using (user_id = auth.uid());
