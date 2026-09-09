-- Your templates and settings, on every device you sign in on.
--
-- Fonzo works off an iPhone, a personal iPad and a work iPad. Until now
-- each of those held a completely separate pile of templates that never
-- met, because all of it lives in localStorage. Worse, iOS Safari evicts
-- a site's local storage after roughly seven days of not opening it -- so
-- the iPad that sits in a drawer over a long weekend can lose every
-- template on it with no warning and no copy anywhere.
--
-- One row per user, holding the whole set. Templates are a handful of
-- small objects, so there is nothing to gain from a row each and a lot to
-- lose: a single row means a device reads its whole world in one request
-- and writes it in one, which is what you want on a job-site connection
-- that may only hold for a second.
--
-- Unlike public.documents, this table HAS update. That is the point --
-- the archive is a record of what happened and must never change, this is
-- working state and changes constantly. The two are deliberately separate
-- tables so that distinction can never blur.
--
-- Deletions are carried as tombstones inside template_tombstones rather
-- than by removing entries, because a merge that only unions would
-- resurrect a template deleted on another device, forever, every time the
-- devices met. See mergeTemplates() in src/sync/userSync.js.
--
-- NOT synced here: the active draft. That is edited continuously, offline,
-- and needs a real conflict conversation rather than last-write-wins --
-- its own piece of work.

create table if not exists public.user_sync (
  user_id uuid primary key references auth.users(id) on delete cascade,
  templates jsonb not null default '[]'::jsonb,
  template_tombstones jsonb not null default '[]'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by_device text
);

alter table public.user_sync enable row level security;

-- Yours and only ever yours. No role sees anyone else's working state --
-- this is not archive material and nobody supervises it.
create policy "read own sync row"
  on public.user_sync for select
  to authenticated
  using (user_id = auth.uid());

create policy "create own sync row"
  on public.user_sync for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "update own sync row"
  on public.user_sync for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
