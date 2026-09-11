-- What the approver changed, and proof the author was told.
--
-- Fonzo, 2026-09-11: an approver can fix a typo or reword something, "but
-- the sender has to receive some type of notification that something was
-- changed or whatever yk, so someone can't be like 'i never saw that' type
-- shi". And the approver is the end of the line -- "if they make changes
-- the sender just hits got it and that's it. got it doesn't hold up the
-- document."
--
-- So this is a record, not a gate. Filing never waits on an acknowledgement.
--
-- WHY ITS OWN TABLE. The notice has to outlive the thing it is about. An
-- open document is DELETED the moment it is filed, and the author may well
-- not look at his phone until after that has happened. A column on
-- open_documents would take the evidence with it.
--
-- It is also deliberately not part of public.documents. The archive has no
-- UPDATE policy at all, by design, and an acknowledgement is written later
-- -- putting it there would mean opening an edit door in the one table
-- whose whole value is that it has none.

create table if not exists public.document_edits (
  id uuid primary key default gen_random_uuid(),
  open_document_id uuid,
  filed_document_id uuid,
  doc_type text not null,
  edited_by uuid not null references auth.users(id),
  edited_at timestamptz not null default now(),
  notify_user uuid not null references auth.users(id),
  -- [{ field, label, before, after }] -- enough to show a real before and
  -- after, not just "something changed".
  changes jsonb not null default '[]'::jsonb,
  acknowledged_at timestamptz
);

create index if not exists document_edits_notify_idx
  on public.document_edits (notify_user, acknowledged_at);

alter table public.document_edits enable row level security;

create policy "see edits you made or need to know about"
  on public.document_edits for select to authenticated
  using (
    notify_user = auth.uid()
    or edited_by = auth.uid()
    or private.can_see_all_documents()
  );

create policy "record your own edit"
  on public.document_edits for insert to authenticated
  with check (edited_by = auth.uid());

create policy "acknowledge a change addressed to you"
  on public.document_edits for update to authenticated
  using (notify_user = auth.uid())
  with check (notify_user = auth.uid());

-- RLS cannot see the OLD row, so it cannot express "only acknowledged_at
-- may move" -- same lesson as the open_documents created_by tautology.
-- filed_document_id is settable exactly once, while still null, because
-- the link is made at filing time (see link_edits_to_filed below).
create or replace function private.only_acknowledgement_moves()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
begin
  new.id                := old.id;
  new.open_document_id  := old.open_document_id;
  new.doc_type          := old.doc_type;
  new.edited_by         := old.edited_by;
  new.edited_at         := old.edited_at;
  new.notify_user       := old.notify_user;
  new.changes           := old.changes;

  if old.filed_document_id is not null then
    new.filed_document_id := old.filed_document_id;
  end if;

  -- Stamped here, not sent by the client, so it cannot be back-dated.
  if old.acknowledged_at is not null then
    new.acknowledged_at := old.acknowledged_at;
  elsif new.acknowledged_at is not null then
    new.acknowledged_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists only_acknowledgement_moves on public.document_edits;
create trigger only_acknowledgement_moves
  before update on public.document_edits
  for each row execute function private.only_acknowledgement_moves();

-- Pointing an outstanding notice at the filed document, at filing time.
--
-- Through a function rather than a direct update, because of something
-- that would otherwise have failed SILENTLY: the UPDATE policy above
-- allows only notify_user, i.e. the author, and the person filing is the
-- approver. His update would match no rows and come back clean.
create or replace function public.link_edits_to_filed(open_id uuid, filed_id uuid)
returns integer
language plpgsql security definer set search_path to 'public'
as $$
declare touched integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  if not private.can_see_all_documents() then
    raise exception 'You are not allowed to file documents.';
  end if;

  update public.document_edits
     set filed_document_id = filed_id
   where open_document_id = open_id
     and filed_document_id is null;

  get diagnostics touched = row_count;
  return touched;
end;
$$;

grant execute on function public.link_edits_to_filed(uuid, uuid) to authenticated;
