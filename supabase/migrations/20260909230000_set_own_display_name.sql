-- Let people fix their own name.
--
-- Fonzo is in here as "Fonzo Hernandez" because I typed it in by hand;
-- the company has him as Alfonso Hernandez Jr. Nic and Devin have no name
-- at all. That name is going to end up on company safety records, so the
-- man it belongs to should be the one who sets it -- not me, over a chat.
--
-- WHY A FUNCTION AND NOT AN UPDATE POLICY. profiles holds two very
-- different kinds of fact in one row: your NAME, which is yours to
-- correct, and your ROLE, which is permission and is somebody else's to
-- grant. A plain "update your own row" policy would hand both over, and a
-- foreman could set his own role to 'hr' and read every separation form
-- in the company. Row-level security has no clean way to say "this column
-- but not that one", so there is no UPDATE policy on profiles at all and
-- this function is the only door. It touches exactly one column and reads
-- the user id from the session rather than taking it as an argument, so
-- there is nothing to point at somebody else's row either.
--
-- Trimmed and length-capped here rather than trusting the screen: the
-- browser is not where a rule gets enforced.

create or replace function public.set_my_display_name(new_name text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  cleaned text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  cleaned := btrim(coalesce(new_name, ''));
  cleaned := regexp_replace(cleaned, '\s+', ' ', 'g');

  if length(cleaned) < 2 then
    raise exception 'Enter your full name.';
  end if;
  if length(cleaned) > 80 then
    raise exception 'That name is too long.';
  end if;

  update public.profiles set full_name = cleaned where id = auth.uid();
  return cleaned;
end;
$$;

revoke all on function public.set_my_display_name(text) from public, anon;
grant execute on function public.set_my_display_name(text) to authenticated;
