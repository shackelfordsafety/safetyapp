-- Makes this repository able to rebuild the live database.
--
-- An outside reviewer flagged 2026-09-11 that the app queries
-- profiles.is_admin and no committed migration creates it, so a database
-- rebuilt from this repo would fail that query and the review queue would
-- never load. Checking properly turned up more than that: THREE migrations
-- had been applied straight to the project and never written down --
-- profiles_are_a_company_directory, assigning_roles, and
-- the_admin_account_is_above_all.
--
-- That is a handover problem, not a tidiness one. The value of this repo to
-- Shackelford is that somebody can stand it back up from it; a schema that
-- exists only inside one Supabase project is a schema that dies with the
-- account it lives in.
--
-- Everything here is idempotent -- it reconciles the live project without
-- doing anything to it, and builds a fresh one correctly.

-- ── The admin flag ──────────────────────────────────────────────────────
-- One account carries it: the creator's. It is what lets him assign roles
-- while the safety ROLE cannot, and (since the_admin_account_is_above_all)
-- file any document type. It travels with the Shackelford login when that
-- is handed over, which is the whole point.
alter table public.profiles add column if not exists is_admin boolean not null default false;

-- ── The company directory ───────────────────────────────────────────────
-- Every signed-in person can read names and roles, so a document can say
-- "started by Nic Mann" instead of a uuid, and so there is somebody to pick
-- when handing work over. The table carries no email and no phone number,
-- which is why this is not an exposure.
alter table public.profiles enable row level security;
drop policy if exists "read the company directory" on public.profiles;
create policy "read the company directory"
  on public.profiles for select to authenticated using (true);

-- ── Who may assign roles ────────────────────────────────────────────────
-- Fonzo's instruction, 2026-09-09: "let HR and Owners assign roles... but
-- don't let safety assign roles". He can because of is_admin, not because
-- of his role.
create or replace function private.can_manage_people()
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and (is_admin or role in ('hr', 'owner'))
  );
$$;

create table if not exists public.role_changes (
  id uuid primary key default gen_random_uuid(),
  target_user uuid not null references auth.users(id),
  old_role text,
  new_role text not null,
  changed_by uuid not null references auth.users(id),
  changed_at timestamptz not null default now()
);
alter table public.role_changes enable row level security;
drop policy if exists "read the role history" on public.role_changes;
create policy "read the role history"
  on public.role_changes for select to authenticated
  using (private.can_manage_people());
-- No INSERT policy on purpose: rows are written only by set_person_role,
-- which is SECURITY DEFINER. Nothing can forge a role-change record.

create or replace function public.set_person_role(target uuid, new_role text)
returns text
language plpgsql security definer set search_path to 'public'
as $$
declare
  actor uuid := auth.uid();
  actor_role text;
  target_role text;
begin
  if actor is null then
    raise exception 'Not signed in.';
  end if;
  if not private.can_manage_people() then
    raise exception 'You are not allowed to change roles.';
  end if;
  if target = actor then
    raise exception 'You cannot change your own role. Ask an owner.';
  end if;
  if new_role not in ('field','safety','hr','pm','clerk','superintendent','foreman','owner') then
    raise exception 'That is not a role.';
  end if;

  select role into target_role from public.profiles where id = target;
  if target_role is null then
    raise exception 'No such person.';
  end if;

  select role into actor_role from public.profiles where id = actor;
  if (target_role = 'owner' or new_role = 'owner') and actor_role <> 'owner' then
    raise exception 'Only an owner can make or change an owner.';
  end if;

  update public.profiles set role = new_role where id = target;
  insert into public.role_changes (target_user, old_role, new_role, changed_by)
  values (target, target_role, new_role, actor);
  return new_role;
end;
$$;

grant execute on function public.set_person_role(uuid, text) to authenticated;

-- ── The admin account can file anything ─────────────────────────────────
-- Fonzo, 2026-09-11: "mine's the admin account... I should be able to see
-- anything and everything so that if somebody calls me, I can." This does
-- NOT loosen the safety role -- a safety coordinator still cannot decide a
-- report is final, which is the rule he set himself.
create or replace function private.can_file_doc_type(kind text)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select case
    when exists (select 1 from public.profiles where id = auth.uid() and is_admin) then true
    when private.my_role() = 'owner' then true
    when kind = 'jsa' then true
    when kind in ('incident', 'medicalEvent', 'uncontrolledEvent')
      then private.my_role() in ('pm', 'hr')
    when kind in ('disciplinary', 'separation')
      then private.my_role() = 'hr'
    else false
  end;
$$;
