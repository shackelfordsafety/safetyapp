# Third-party source review — 2026-09-11, commit 2ac4d65

Read-only review by an outside reviewer (ChatGPT "Astra"), commissioned by
Fonzo. No files changed. Recorded here verbatim in substance so the
findings are not lost in chat scrollback, with my own status against each.

Status key: CONFIRMED (I verified it), MINE (introduced by me this
session), OPEN (not yet checked), DISPUTED (I think the reviewer is wrong).

## High

1. **Kiosk can report a signature that never saved.** Count increments and
   confirmation shows before the upload is known to have succeeded;
   failures ignored. Needs a durable pending queue and honest
   saved/pending/failed status. `src/crew/MyBoard.jsx#L120-129` — OPEN

2. **Review workflow not connected.** Clicking a shared report calls
   `goDocs`, which opens the document menu without loading the report.
   `src/today/TodayView.jsx#L156-164` — CONFIRMED, being fixed in the same
   session this review arrived; pick-up now loads the real record.

3. **Auto-archive backlog can stall forever.** Fetches the oldest 20
   expired postings then filters out already-archived ones. Once those 20
   are filed, posting 21 is never considered. `src/crew/board.js#L494-523`
   — OPEN, sounds right: the limit is applied before the filter.

4. **Crew phone view can omit hazards that print.** The reader uses
   detailed task rows only; the print path reconciles rows AND summary
   fields (`getContentRows`). An older template with rows plus newer
   summary hazards shows less on the phone than on paper.
   `board.js#L138-157` vs `main.jsx#L218-226` — OPEN. If true this is the
   worst one on the list: the crew signs what they read.

5. **Submitting twice creates duplicate reports.** `SendForReviewButton`
   always calls `shareOpenDocument({ id: null })`, so a retry after a
   failed upload, or reopening and submitting again, makes a second row.
   — MINE, real, introduced today.

6. **Filing is not atomic.** Archive insert and open-row delete are two
   calls; two approvers, or a failed delete then a retry, can produce
   duplicate permanent records in an append-only table. — MINE/CONFIRMED
   by inspection.

## Medium

7. Archive search only covers the newest 500 documents, filtered
   client-side; older paperwork silently never matches. Also downloads
   full document bodies to build a list. — FIXED 2026-09-11: pages through
   the whole archive instead of stopping at 500, says so on screen if it
   ever hits the ceiling, and asks the database for the one field it needed
   out of each body rather than downloading all of them. The body is
   fetched only for the document somebody opens.
8. Settings sync can let a stale device win: opening the app restamps
   local settings as newly changed. — FIXED 2026-09-11: the stamp is only
   written when the settings actually differ from what is stored, so
   "newest" no longer means "opened most recently".
   tools/testing/verify-settings-stamp.mjs
9. A slow sync can clobber a template edit made while it was in flight. —
   FIXED 2026-09-11: what the device held when the round trip started is
   compared against what it holds when the answer lands; if it moved, the
   merge rules run once more against the new list and the sync is left
   marked unsynced so it pushes again.
10. Auto-archive only runs on mount; no retry on expiry, reconnect or
    sign-in. — FIXED 2026-09-11: also looks again on focus, on reconnect,
    and every ten minutes, so a JSA that expires while the app sits open on
    a dashboard is filed the same day.
11. Overnight JSAs vanish from the superintendent's board at midnight —
    `fetchMyBoard` filters on published_at >= today, so a JSA published at
    5pm and good until 4am disappears while still live. — OPEN, and this
    one bites Fonzo's actual night-crew workflow.
12. Navigating away can discard the last edits: 900ms autosave debounce is
    cancelled on unmount. — FIXED 2026-09-11: the pending write is flushed
    rather than thrown away -- on leaving the document, on the tab closing,
    and when iOS hides the page. Sign-out is exempt, or it would put the
    paperwork straight back after wiping it.
    tools/testing/verify-autosave-flush.mjs, verify-signout-still-clears.mjs

## Database findings

- **`profiles.is_admin` is queried but no committed migration creates it.**
  A database rebuilt from this repo would fail the review-queue query. —
  CONFIRMED as drift: the column EXISTS in production (verified in the
  security audit; Fonzo's profile carries it) but was added outside the
  migrations. Repo cannot rebuild production.

- **Filing can remove the author's own access.** `signOffAndFile` records
  the APPROVER as `submitted_by`, and the archive read policy uses
  `submitted_by = auth.uid()` to mean "your own documents". A
  superintendent's incident or separation can disappear from his records
  the moment it is approved. Authorship and approval need separate
  fields. — CONFIRMED by inspection. This is the one I would have missed.

## Caveats the reviewer stated

Read-only source review with targeted in-memory checks. No live
submissions, no production database inspection, no iPad PDF verification.
The deploy workflow runs a build and no behavioural tests.
