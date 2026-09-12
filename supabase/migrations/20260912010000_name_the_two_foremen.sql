/* Kris Taute and Jake Lytle are foremen.

   Both accounts existed with no name on them and the default `field`
   role, so either of them logging in would have met an app that knew
   nothing about who they were -- and `field` sees only its own documents,
   where a foreman should see what a superintendent sees.

   Fonzo named them 2026-09-12. Roles are never guessed: a role decides
   what somebody can read in the archive, and guessing wrong either hides
   a man's own paperwork from him or shows him somebody's write-up.

   Written as a migration because it was applied straight to the live
   database, and the repo has to be able to rebuild what is actually
   there -- the same drift that left profiles.is_admin uncommitted. */
update public.profiles p
set full_name = v.name, role = 'foreman'
from (values
  ('kris@shackelfordconst.com', 'Kris Taute'),
  ('jake@shackelfordconst.com', 'Jake Lytle')
) as v(email, name)
where p.id = (select id from auth.users u where u.email = v.email)
  and (p.full_name is null or p.full_name = '');
