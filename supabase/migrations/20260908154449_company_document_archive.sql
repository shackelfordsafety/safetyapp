-- ── Company document archive ────────────────────────────────────────────
-- One append-only table of filed safety documents, plus a profiles table
-- that says who is allowed to see everything.
--
-- Access model (Fonzo, 2026-09-08):
--   field  -> can file documents, sees only what they filed
--   safety -> sees everything
--   hr     -> sees everything
--
-- Nobody can edit or delete a filed document, INCLUDING safety and hr.
-- Badly worded reports are corrected in the existing review chain before
-- filing, not in the archive afterward. The absence of UPDATE and DELETE
-- policies below is what enforces that -- it is deliberate, not an
-- oversight.

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text,
  role       text not null default 'field'
             check (role in ('field', 'safety', 'hr')),
  created_at timestamptz not null default now()
);

-- doc_type values match KNOWN_DOC_TYPES in src/shared/draftTransfer.js
-- exactly, so an exported draft envelope drops straight in with no mapping.
create table public.documents (
  id            uuid primary key default gen_random_uuid(),
  doc_type      text not null
                check (doc_type in ('jsa', 'incident', 'disciplinary',
                                    'uncontrolledEvent', 'medicalEvent', 'separation')),
  submitted_by  uuid not null references auth.users (id),
  submitted_at  timestamptz not null default now(),

  -- lifted out of `data` purely so the office can search: "everything about
  -- this employee", "every JSA on this job site in August"
  doc_date      date,
  job_site      text,
  employee_name text,

  -- the document exactly as the app already stores it in localStorage
  data          jsonb not null,

  -- the app's own document id, so a double submit is detectable later
  client_doc_id text,
  app_version   text
);

create index documents_submitted_by_idx  on public.documents (submitted_by);
create index documents_doc_type_idx      on public.documents (doc_type);
create index documents_doc_date_idx      on public.documents (doc_date desc);
create index documents_employee_name_idx on public.documents (lower(employee_name));
create index documents_job_site_idx      on public.documents (lower(job_site));

-- security definer so the documents policy can check a role without
-- recursing back through profiles' own row level security
create or replace function public.can_see_all_documents()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('safety', 'hr')
  );
$$;

-- every new signup gets a profile row, defaulting to 'field'
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles  enable row level security;
alter table public.documents enable row level security;

create policy "read own profile, or all if safety/hr"
  on public.profiles for select
  to authenticated
  using (id = auth.uid() or public.can_see_all_documents());

create policy "file a document"
  on public.documents for insert
  to authenticated
  with check (submitted_by = auth.uid());

create policy "read own documents, or all if safety/hr"
  on public.documents for select
  to authenticated
  using (submitted_by = auth.uid() or public.can_see_all_documents());
