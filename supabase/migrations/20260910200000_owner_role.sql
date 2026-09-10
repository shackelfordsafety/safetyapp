-- The owners.
--
-- Hunter and Reeves Shackelford own the company. Added 2026-09-10 so they
-- can use the app for real rather than borrowing somebody else's account.
--
-- An owner sits above every other role: sees every document, and can sign
-- off on anything -- both the safety documents a PM approves and the
-- personnel paperwork HR approves. Not because owners will routinely do
-- either, but because a system where the man who owns the company cannot
-- act on his own company's records is a system people work around.
--
-- What this deliberately does NOT include: changing anybody's role.
-- Nothing in this app can do that yet, for anyone -- roles are still set
-- by hand in the database. Making an owner able to hand out roles is the
-- "admin" half of the question and needs its own careful build, because a
-- door that grants privileges is the one door worth being slow about.

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('field', 'safety', 'hr', 'pm', 'clerk', 'superintendent', 'foreman', 'owner'));

create or replace function private.can_see_all_documents()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('owner', 'safety', 'hr', 'pm', 'clerk')
  );
$$;

create or replace function private.can_file_doc_type(kind text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when private.my_role() = 'owner' then true
    when kind = 'jsa' then true
    when kind in ('incident', 'medicalEvent', 'uncontrolledEvent')
      then private.my_role() in ('pm', 'hr')
    when kind in ('disciplinary', 'separation')
      then private.my_role() = 'hr'
    else false
  end;
$$;

drop policy if exists "the office maintains jobs" on public.jobs;
create policy "the office maintains jobs"
  on public.jobs for insert to authenticated
  with check (private.my_role() in ('owner', 'pm', 'hr', 'safety', 'clerk'));

drop policy if exists "the office edits jobs" on public.jobs;
create policy "the office edits jobs"
  on public.jobs for update to authenticated
  using (private.my_role() in ('owner', 'pm', 'hr', 'safety', 'clerk'))
  with check (private.my_role() in ('owner', 'pm', 'hr', 'safety', 'clerk'));
