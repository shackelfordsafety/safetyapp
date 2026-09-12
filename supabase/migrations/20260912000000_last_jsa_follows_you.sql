/* "Same info as last time?" has to work on whichever device you picked up.

   Fonzo, 2026-09-12: "gang i need it across devices wherever you're
   signed in". He builds a JSA on his phone at 6am and picks up the iPad
   later; the snapshot that answers "same as last time?" lived in one
   browser's localStorage, so the second device offered him nothing and he
   retyped the lot.

   Rides on user_sync, which already carries this person's templates and
   settings between their devices. One more column rather than a new
   table: it is the same thing (this user's stuff, on this user's
   devices), the same row, the same policies, and it travels on a round
   trip that was already happening.

   ONLY THE JSA. The other five documents take the same kind of snapshot,
   and those are NOT going in here -- a separation form names an employee
   and says why they were let go, and a disciplinary notice is worse. That
   content belongs in the archive, which is append-only and locked down by
   role. A JSA is job info: the site, the tasks, the hazards. */
alter table public.user_sync
  add column if not exists last_jsa jsonb;

comment on column public.user_sync.last_jsa is
  'Snapshot of the most recently published JSA, for "same info as last time?" on any device. Day-specific fields and crew signatures are stripped before it is stored -- see stripForRepeat() in src/sync/userSync.js. JSA only, never the five documents that carry employee content.';
