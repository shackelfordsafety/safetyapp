-- ═══════════════════════════════════════════════════════════════════════
-- JSA board + crew sign-in
-- ═══════════════════════════════════════════════════════════════════════
-- The spine for QR crew sign-in. Two tables and, more importantly, the
-- first access rules in this project that let somebody with NO ACCOUNT
-- read and write. Everything shipped before this required a login.
--
-- How it works: a superintendent has one permanent QR. It does not point
-- at a JSA -- it points at that super's BOARD, which lists every JSA live
-- right now. A crew member scans, picks the area he's working, types his
-- name, signs. A job needing five JSAs is five rows on one board, one QR.
--
-- Nothing here is editable after the fact. Publishing locks a JSA; a
-- revision is a NEW ROW (a new version), never an update. Same append-only
-- rule as the document archive, for the same reason: this is a signed
-- safety record and history must not be quietly rewritable.
-- ═══════════════════════════════════════════════════════════════════════


-- ── The board ──────────────────────────────────────────────────────────
-- One row = one JSA published to one superintendent's board.
create table if not exists public.jsa_publications (
  id uuid primary key,

  -- WHOSE BOARD this lands on. Not necessarily who published it: a foreman
  -- publishes onto his superintendent's board, and it follows him when he
  -- moves between supers. Foremen do not get their own QR.
  board_owner   uuid not null references auth.users(id) on delete restrict,
  published_by  uuid not null references auth.users(id) on delete restrict,

  -- Ties every version of the same JSA together. Mirrors documents.client_doc_id.
  client_doc_id text,
  version       integer not null default 1,
  supersedes    uuid references public.jsa_publications(id),

  -- The JSA exactly as it was published. Frozen: this is what the crew
  -- signed, and it must stay readable even if the source draft on the
  -- device is later changed or deleted.
  data jsonb not null,

  -- What the crew actually reads on the board to find their line.
  area_label text,
  job_site   text,
  location   text,
  job_number text,
  doc_date   date,

  published_at timestamptz not null default now(),

  -- When it stops being live. Comes from the JSA's own expiry time, which
  -- is real safety practice: the JSA is good for a window, and work past
  -- that window needs a new one. Falls back to end of day when the super
  -- left the time blank. Night shifts are why this is a timestamp and not
  -- a "clear at midnight" rule -- a 6pm-4am JSA keeps its board all night.
  expires_at timestamptz not null,

  constraint jsa_publications_version_positive check (version >= 1)
);

-- The crew's read: "what is live on this super's board right now."
create index if not exists jsa_publications_board_live_idx
  on public.jsa_publications (board_owner, expires_at desc);
create index if not exists jsa_publications_doc_version_idx
  on public.jsa_publications (client_doc_id, version desc);

-- NOTE: there is deliberately no `status` column. Whether a board entry is
-- live is derived from expires_at vs now(), so closing one out needs no
-- UPDATE -- which is what lets this table stay strictly append-only.


-- ── The signatures ─────────────────────────────────────────────────────
create table if not exists public.jsa_signatures (
  id uuid primary key,
  publication_id uuid not null
    references public.jsa_publications(id) on delete restrict,

  -- Null for kiosk signatures, and that is correct, not missing data. The
  -- iPad kiosk has always been numbered-only with no names, by design, for
  -- a 100-person crew. Names come from the phone path only.
  signer_name text,

  signature_data text not null,
  source text not null check (source in ('phone', 'kiosk')),
  signed_at timestamptz not null default now(),

  -- Signed after the JSA expired. Recorded and flagged, never refused --
  -- blocking a late signer leaves an unsigned worker on a job, which is
  -- worse than a signature stamped "late".
  is_late boolean not null default false,

  constraint jsa_signatures_phone_has_name
    check (source <> 'phone' or nullif(btrim(signer_name), '') is not null)
);

create index if not exists jsa_signatures_publication_idx
  on public.jsa_signatures (publication_id, signed_at);


-- ── Access rules ───────────────────────────────────────────────────────
alter table public.jsa_publications enable row level security;
alter table public.jsa_signatures  enable row level security;

-- READING A BOARD IS PUBLIC, ON PURPOSE.
-- Fonzo, 2026-09-08: "anyone in our work area needs to sign it anyway."
-- A crew member has no account and never will, so the anon role has to be
-- able to read a published JSA. Note this makes any published JSA readable
-- by anyone holding the link -- an accepted, deliberate trade.
drop policy if exists "anyone can read a published jsa" on public.jsa_publications;
create policy "anyone can read a published jsa"
  on public.jsa_publications for select
  to anon, authenticated
  using (true);

-- Publishing requires an account, and you may only record yourself as the
-- publisher. board_owner is intentionally NOT constrained to the publisher
-- -- that is what lets a foreman publish onto his super's board.
drop policy if exists "signed-in users publish" on public.jsa_publications;
create policy "signed-in users publish"
  on public.jsa_publications for insert
  to authenticated
  with check (published_by = auth.uid());

-- SIGNING IS PUBLIC, ON PURPOSE -- this is the whole feature.
-- Constrained to signatures against a publication that actually exists.
-- Worth stating plainly: anyone with a board link can add a signature, so
-- a bad actor could add junk ones. Accepted for now; a paper sign-in sheet
-- left on a truck hood has exactly the same property. Revisit if it ever
-- becomes a real problem rather than pre-building for it.
drop policy if exists "anyone can sign a published jsa" on public.jsa_signatures;
create policy "anyone can sign a published jsa"
  on public.jsa_signatures for insert
  to anon, authenticated
  with check (
    exists (select 1 from public.jsa_publications p where p.id = publication_id)
  );

-- Reading signatures back is for the office side: the super watching his
-- count climb, and Safety/HR/PM reviewing later. Crew members do not need
-- to read the list of who else signed, so anon is deliberately excluded.
--
-- GOTCHA, verified the hard way 2026-09-08: because anon cannot SELECT
-- here, an anonymous `insert ... returning` FAILS -- and Postgres reports
-- it as "new row violates row-level security policy", which reads like the
-- insert itself was rejected when it wasn't. The plain insert works fine.
-- So the crew sign-in page must NOT ask for the row back: in supabase-js,
-- `.insert(row)` alone is correct and `.insert(row).select()` will break
-- for a crew member with no account. Same applies to the kiosk.
drop policy if exists "signed-in users read signatures" on public.jsa_signatures;
create policy "signed-in users read signatures"
  on public.jsa_signatures for select
  to authenticated
  using (
    exists (
      select 1 from public.jsa_publications p
      where p.id = publication_id
        and (p.board_owner = auth.uid()
             or p.published_by = auth.uid()
             or private.can_see_all_documents())
    )
  );

-- No UPDATE and no DELETE policies on either table, anywhere, for anybody.
-- That absence IS the append-only guarantee. A published JSA cannot be
-- edited (revise = publish a new version), and a signature can never be
-- removed or altered by anyone using the app.
