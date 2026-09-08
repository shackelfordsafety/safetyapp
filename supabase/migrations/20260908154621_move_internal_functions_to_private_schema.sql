-- The role-check helper and the signup trigger are internal machinery for
-- policies and triggers -- never something a client should call. Living in
-- `public` meant PostgREST exposed both at /rest/v1/rpc/, which the security
-- advisor flagged. Move them to a `private` schema, outside the exposed API.

drop policy if exists "read own profile, or all if safety/hr" on public.profiles;
drop policy if exists "read own documents, or all if safety/hr" on public.documents;
drop policy if exists "file a document" on public.documents;
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
drop function if exists public.can_see_all_documents();

create schema if not exists private;

create or replace function private.can_see_all_documents()
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

create or replace function private.handle_new_user()
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
  for each row execute function private.handle_new_user();

-- policies still need to resolve and execute the helper
grant usage on schema private to authenticated;
grant execute on function private.can_see_all_documents() to authenticated;

create policy "read own profile, or all if safety/hr"
  on public.profiles for select
  to authenticated
  using (id = auth.uid() or private.can_see_all_documents());

create policy "file a document"
  on public.documents for insert
  to authenticated
  with check (submitted_by = auth.uid());

create policy "read own documents, or all if safety/hr"
  on public.documents for select
  to authenticated
  using (submitted_by = auth.uid() or private.can_see_all_documents());
