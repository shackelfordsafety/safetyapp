-- The real Shackelford roles.
--
-- The archive shipped with three roles ('field', 'safety', 'hr') because
-- those were the only ones the first cut needed. The company actually has
-- six job families, and until now the PM -- who owns the company and is
-- the one asking for this system -- had no role that could see anything he
-- files. A new account defaulting to 'field' would have left him staring
-- at an empty archive.
--
-- Who sees everything, company-wide, including disciplinary and separation
-- paperwork on every employee: safety, hr, pm, clerk. Confirmed with the
-- owner 2026-09-09. Clerk is on that list deliberately -- the clerks type
-- up and file the personnel paperwork, so withholding it from them would
-- stop the work rather than protect anybody.
--
-- Superintendents and foremen see only what they filed themselves. That
-- matches the board decision already made for JSAs (no cross-super
-- visibility) and is the conservative default for the rest.
--
-- 'field' is kept, and stays the column default, on purpose: a brand-new
-- account should land on the LEAST access until a human assigns it a real
-- role, not inherit anything by accident.

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('field', 'safety', 'hr', 'pm', 'superintendent', 'foreman', 'clerk'));

create or replace function private.can_see_all_documents()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('safety', 'hr', 'pm', 'clerk')
  );
$$;
