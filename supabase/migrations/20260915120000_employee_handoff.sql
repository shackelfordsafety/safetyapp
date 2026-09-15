-- What the employee has to do, on the employee's own phone.
--
-- Fonzo, 2026-09-15: "management does their own stuff. And then once they
-- finish their part... it gets to a step in the workflow where it's like,
-- okay, this is what the employee needs to do, and it scans a QR code, and
-- it gives them everything he needs to do, his statement, a statement, the
-- signature, all the... everything that an employee needs to do goes under
-- one QR code."
--
-- And the reason it is his phone and not the company iPad, in his words:
-- "just in case they're disgruntled or upset or whatever, they can't, like,
-- trash the iPad." You do not hand your own device to somebody you have
-- just written up.
--
-- WHY THIS IS NOT THE CREW BOARD, THOUGH IT LOOKS LIKE IT
--
-- The crew sign-in solved the same shape of problem: a QR, no account, sign
-- on your own phone. Its address is PERMANENT and derived from the
-- superintendent's account id (boardUrlFor in crew/board.js), which is fine
-- for a JSA -- hazards and controls, nothing personal, and a man who loses
-- the sticker can be handed another.
--
-- A disciplinary notice is an accusation against a named person, and a
-- separation says why somebody was let go. Reachable at a guessable address
-- that never expires, that is a leak of an employment record. The 2026-09-11
-- audit found exactly this class of hole on jsa_publications -- anon could
-- list every published JSA company-wide -- so it is not hypothetical.
--
-- Hence: a random token, not an account id. A short life. Dead the moment it
-- is used. And anon never touches the table, only two functions that answer
-- one question about one token.

create extension if not exists pgcrypto;

create table if not exists public.employee_requests (
  id uuid primary key default gen_random_uuid(),
  -- The secret in the QR. 32 bytes of randomness, base64url -- not derived
  -- from the document, the employee, or the account, so it cannot be
  -- guessed from anything a person could know.
  token text not null unique,
  doc_type text not null,
  -- Who is asking. Used to show the employee who sent this, and to let that
  -- person (and only that person) read the answer back.
  requested_by uuid not null references auth.users(id),
  requested_by_name text,
  employee_name text,
  -- What the employee is being shown. A SNAPSHOT, not a live document:
  -- what he signs must be what was in front of him, and it must not change
  -- underneath him while he reads it.
  document jsonb not null,
  -- What he is being asked for: 'statement', 'signature'. A list so a future
  -- document can ask for something else without another table.
  needs text[] not null default array['statement','signature'],
  -- What came back.
  statement text,
  signature_data text,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  -- Deliberately short. This is handed over in a meeting and used within
  -- minutes; a link that works tomorrow is a link somebody forwards.
  expires_at timestamptz not null default now() + interval '2 hours'
);

create index if not exists employee_requests_requester_idx
  on public.employee_requests (requested_by, created_at desc);

alter table public.employee_requests enable row level security;

-- The person who asked can see their own, to watch for the answer coming
-- back. Nobody else, including other office roles -- a half-finished
-- write-up in progress is not archive material yet.
create policy "see the handoffs you asked for"
  on public.employee_requests for select
  to authenticated
  using (requested_by = auth.uid());

create policy "ask for a handoff as yourself"
  on public.employee_requests for insert
  to authenticated
  with check (requested_by = auth.uid());

-- Cancelling one you asked for, before it is answered. Once the employee has
-- responded it is a record of what he did and stops being yours to remove.
create policy "cancel your own unanswered handoff"
  on public.employee_requests for delete
  to authenticated
  using (requested_by = auth.uid() and responded_at is null);

-- NO anon policy at all, deliberately. Anonymous callers reach this table
-- only through the two functions below, each of which answers about a single
-- token it was already given. There is nothing here to enumerate.

/* What the employee sees when he scans. One row, by its secret, and only
   while it is alive and unanswered.

   SECURITY DEFINER and in `public`, not `private`: anon has no USAGE on the
   private schema, which is the trap board_for hit -- the policy raises
   "permission denied for schema private" instead of working. */
create or replace function public.employee_request_for(t text)
returns table (
  doc_type text,
  requested_by_name text,
  employee_name text,
  document jsonb,
  needs text[],
  expires_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select r.doc_type, r.requested_by_name, r.employee_name, r.document, r.needs, r.expires_at
  from public.employee_requests r
  where r.token = t
    and r.expires_at > now()
    and r.responded_at is null;
$$;

grant execute on function public.employee_request_for(text) to anon, authenticated;

/* His answer, written once.

   Once responded_at is set the token is spent: employee_request_for stops
   returning it and this refuses to write again. A signature that can be
   replaced by whoever still has the link is not a signature. */
create or replace function public.submit_employee_response(
  t text,
  in_statement text,
  in_signature text
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  hit public.employee_requests%rowtype;
begin
  select * into hit
  from public.employee_requests
  where token = t
  for update;

  if not found then
    raise exception 'That link is not valid.';
  end if;
  if hit.responded_at is not null then
    raise exception 'That has already been signed and sent.';
  end if;
  if hit.expires_at <= now() then
    raise exception 'That link has expired. Ask for a new one.';
  end if;

  update public.employee_requests
     set statement = nullif(btrim(coalesce(in_statement, '')), ''),
         signature_data = nullif(btrim(coalesce(in_signature, '')), ''),
         responded_at = now()
   where id = hit.id;

  return true;
end;
$$;

grant execute on function public.submit_employee_response(text, text, text) to anon, authenticated;
