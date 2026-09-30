# Full code audit — 2026-09-30, branch `claude/code-audit-bugs-vdsrbk`

Commissioned by Fonzo the day before leaving the company: "audit the entire
code and make sure there's no bugs." Whole-app read of `src/` (every file),
`supabase/migrations/` (all 26, reasoned to final state), `public/sw.js`,
`index.html`, the deploy workflow, and the check suite in `tools/testing/`.
Seven independent reviewers each took a slice; every finding below was then
re-checked against the actual code by the lead before being acted on. The
main.jsx pager crash and the pagination over-count were also reproduced in a
real browser against the built app.

Status key: **FIXED** (changed on this branch), **MIGRATION** (SQL written
under `supabase/migrations/20260930120000_audit_hardening.sql`, NOT applied
to the live project), **OPEN** (real, deliberately not changed — needs a
product decision, a real account to test against, or a visual PDF review),
**STALE CHECK** (the app was fine; the test script was out of date).

Checks: `npm run build` passes. `npm run check` was 17/22 on the original
code; the 5 failures were all stale scripts (see section E), now updated.
After the fixes and the script updates: 21 of 22 pass; the one left
(`verify-send-for-review`) is also a stale script, not an app failure.

**Pushing this branch failed with a 403** from GitHub: the Claude GitHub App
is not connected to the `shackelfordsafety` org from this session. The
commits are on the branch locally in the session container. Whoever picks
this up needs to reconnect GitHub (claude.ai → Settings → Connectors) or
pull the branch some other way before it is lost with the container.

---

## What matters most, in one screen

1. **The app crashed on any big JSA when you opened the print preview
   pager** — `rows is not defined`, whole app replaced by the crash screen.
   FIXED.
2. **Every date in the app was the UTC date.** After ~7pm Central, new
   JSAs, write-ups, separations, medical/uncontrolled events and every
   signature date said *tomorrow*. Worse: the JSA board builds the signing
   window from the JSA's date, so a night-shift JSA started at 7:30pm could
   not be signed until the following evening. FIXED (one shared helper).
3. **A single arrow, emoji, tab or odd accent in any field killed the
   PDF** for the four HR documents ("WinAnsi cannot encode"). The document
   could not be printed or submitted. FIXED.
4. **Kiosk signatures could be recorded twice, or dropped silently.**
   Two flushes overlapping sent the same man twice; a signature the
   database refused (JSA closed) vanished with the count still showing it.
   FIXED.
5. **Sign-out offline could wipe the paperwork but leave the person signed
   in** on a shared iPad. FIXED.
6. **The archive could get permanent duplicate JSA records** (two devices,
   or the "already filed" query silently capped at 1,000 rows). FIXED in
   the app; the database-level guarantee is in the MIGRATION.
7. **The database has no size limit on anonymous signature rows, no
   expiry cap on board postings, and lets the requester pre-fill an
   employee's hand-off answer.** MIGRATION (review, then run).

---

## Round 2 (same day) — section C, fixed

Fonzo, after round 1 shipped: "fix it all please, tomorrow is my last day".
Everything in section C below was fixed except where marked. Each piece
was checked against real output: rendered PDF pages looked at by eye,
browser runs against a faked Supabase that records every call, and the
repo's own checks.

| Section C item | Status |
| --- | --- |
| 1. Approver corrections on an incident were lost | FIXED. "Approve & file" now works for incidents: it makes the printout from the corrected form, saves the corrections, notifies the author and files. Verified against a faked server (the corrected name and a fresh PDF are what get filed). My Work's "Sign off & file" warns before filing the original of a document you picked up to correct. |
| 2. Incident photos never left the device | FIXED. Submit (and Approve & file) upload the photos into the author's storage folder; picking the report up downloads any that are missing. A PDF can no longer be made with a photo missing — it stops with "N photos aren't on this device yet…". Photo appendix pages are JPEG now (a 3-photo report went from 6.4 MB to 1.8 MB). |
| 3. Employee/witness phone hand-off lost | FIXED. The pending code is saved on the document; leaving the step, going Home, or reloading resumes waiting on the SAME code. Expired codes stop polling and say so. |
| 4. Witness statement contradicted the employee line | FIXED. If the employee's signed/refused answer flips after the witness signed, the witness signature is taken off with a note saying why. Only that flip — a phone answer landing later, or switching device/phone, leaves the witness alone because their sentence is still true. |
| 5. PDF layout overflows | FIXED. Signature labels and "Other — …" text wrap inside their column; section headings move with their box; medical's two signature rows stay together. 18 of 21 existing fixtures render pixel-identical; the 3 that differ each had an orphaned heading. Incident page-2 remarks now have a limit (about 1,700 characters) so the body diagram cannot be squeezed away. |
| 6. Offline resilience | FIXED. Each on-demand screen has its own safety net (SafeSuspense) instead of the app-wide crash screen; the four HR forms, My Work and the PDF libraries are downloaded quietly in the background while online; ViewAsPicker only loads when signed in. |
| 7. Templates/settings leaking between accounts on a shared iPad | FIXED. The device records whose templates it holds (`sdc.sync.owner.v1`); when somebody else signs in, nothing of the previous person's is pushed to them, and the previous person's copy is set aside on the device (`sdc.sync.stash.v1`), not deleted. Settings now carry their own timestamp in the cloud. Signing in syncs immediately. |
| 8. Hidden per-keystroke measuring | FIXED. The measuring rig only mounts with `?debug=print` (its result was always discarded). The incident export's re-centering only runs when the incident changes. PDF render scale is 2 on every device (desktop was 2.5 — more work than the iPads). JSA PDF: same look at 3x zoom, 25% smaller. |
| 9. Upload refused after the file was already stored | FIXED. Type list filtered by what the role may file, re-checked before upload, 25 MB cap, unknown types refused instead of stored as "PDF", HEIC converted to JPEG where the browser can. |
| 10. Crew/kiosk messages and refresh | FIXED. "Not open yet" is no longer reported as "expired" (and the kiosk keeps retrying those instead of dropping them); the crew page re-checks every 30 s so Scheduled turns into Sign on its own. Signatures taken on the device before publishing are now included when the JSA files itself (they used to be dropped). |
| 11. Smaller items | FIXED: non-string snapshot trim, Finish step keeps its PDF panel, shared dialog focus trap, Records banner for PM/clerk/owner, password no-signal message, sim documents mark every name, "(blank) → (blank)" change notices. NOT FIXED: `pdf-lib` still bundles into each HR form's chunk (performance only); iPad voice input untested. |
| Ctrl+P on non-JSA forms printed a blank JSA | FIXED. Ctrl+P shows "use Print a copy"; printing from the browser menu prints a one-page note instead of a blank JSA. |
| HR alerts | ADDED. Settings → "Alerts on this computer": once turned on, the app checks every two minutes while open in a tab and pops up a desktop notification for new documents waiting on you. No email (needs a mail service + DNS). |

Still requires a person: **run the migration** (Supabase → SQL Editor → paste
`supabase/migrations/20260930120000_audit_hardening.sql` → Run). It now also
strips signature images from the anonymous board lookup and restricts JSA
filing, and is written in full — no TODOs left in it.

---

## A. Fixed on this branch

### JSA (main.jsx)

- **Print-preview pager crashes the app.** `JsaPreviewPagerModal` built
  its page list with a variable (`rows`) that no longer exists after the
  column-layout change in cd0a150; opening the pager on any JSA with a
  continuation sheet threw a `ReferenceError` in render and the root
  ErrorBoundary took the whole app down. Even fixed, it passed `rows=` to
  a component that reads `columns=`, so the continuation page was blank.
  Both fixed. CRITICAL.
- **Fit badge / "continuation sheet required" / preview page counts read
  the wrong array.** The printer renders `continuationColumns`; the badge,
  the Finish banner, the preview bar, the debug panel and the heads-up
  toast counted `continuationPages` (the old row model), which over-counts
  routinely — a JSA that fit on one sheet was told a continuation page
  would be generated, and the preview bar said "1 + 1 + 4 = 5" over a
  4-page PDF. All now read `continuationColumns`. HIGH.
- **PDF export collected continuation-page elements from the wrong array
  too.** Works today only because rows ≥ columns; if that ever inverted
  a sheet would silently drop from the PDF and the page-count self-check
  would not notice. Fixed. LOW (latent).
- **UTC dates** — `todayISO()` and the template-share filename. See above.
- **Templates and settings were written to localStorage with no
  try/catch** inside effects. A full-storage error (drafts with kiosk
  signature images run to 2–3 MB against Safari's ~5 MB) would unmount
  the app and lose the template that only existed in memory. Same for the
  draft-import write and the QuickPanel recent/favourite writes (where a
  throw also meant the tapped suggestion was never added). All guarded.
- **Saving a template under an existing name resurrected the old one via
  sync.** The replaced template was filtered locally with no deletion
  marker, so the next sync unioned it back — duplicates accumulating on
  every device. `replaceTemplateByName` now records a tombstone per
  replaced template (both Save and Import).
- **"Same info as last time?" / Load template bypassed sanitisation** for
  `taskRows` (used the raw data instead of the sanitised copy), so a
  template with a null row — which the comments say has happened — threw
  in the click handler with no toast. Fixed.
- **Making the printout undid "Mark Ready"** (`saveDraft` forced
  `status: 'draft'`). Fixed to preserve `ready`.
- **Auto-archive could file the same posting twice or wedge.** The effect
  depended on the user's own PDF phase; re-running mid-filing marked the
  work "cancelled", skipped advancing the queue, and then filed the same
  publication again. Now waits for the user's PDF via a ref instead of a
  dependency and always advances past the item it worked on.
- **Settings sync: a fresh or emptied device pushed defaults over the
  account's real settings.** The first-mount write of defaults stamped
  "this device just changed settings", so the empty iPad won the
  newest-wins merge. The stamp is now skipped when nothing was stored
  before.
- **Crash-screen reload flag never cleared**, so weeks later an unrelated
  first crash in the same tab jumped straight to "Still broken — set the
  document aside". Cleared 20 s after a stable mount.

### The four HR documents (`src/documents/`)

- **PDF text sanitiser** in `pdfDraw.js`: every string that reaches the
  page now passes `toPdfText()`. Known symbols get readable stand-ins
  (`→` → `->`, `≥` → `>=`, `✓` → `x`, tab → spaces, nbsp → space),
  decomposed accents are recomposed, anything the font still cannot draw
  becomes `?`. Verified by generating real disciplinary and separation
  PDFs from the fixtures with arrows, emoji, `≥`, tabs, curly quotes and a
  decomposed `x̃` injected: both render, no throw.
- **UTC dates** in all four models' `todayISO()`, the three workflows'
  `today()`, the two inline stamps in Uncontrolled Event, and the draft
  filename in `draftTransfer.js`.
- **Autosave ghost draft.** Typing a character and deleting it inside the
  900 ms window left the deleted text in `pending`; leaving the screen
  (Home, app switch, tab close) then wrote that ghost to storage as a
  draft, and the header stuck on "Saving…" with Save now disabled. The
  hook now clears `pending` and resets the status when the model becomes
  empty or matches what is saved.
- **"Delete this draft" left the deleted draft in memory**, so the next
  tap on that tile asked "replace the current draft?" about a draft the
  person had just deleted (Cancel = no way into the form). `discard()` now
  resets the model and step.

### Incident (`src/incident/`)

- **Page 3 clipped Witness 2's signature row.** `allocateFlexibleSections`
  raised each box to its floor without re-checking the sum; one long
  witness statement next to an empty second slot could exceed the page
  budget by up to ~93 px, and the page is `overflow: hidden` — the
  signature/date row was cut off the printed page with no overflow
  warning. Excess is now taken back from boxes above their floor
  (verified: `[470, 19]` on a 500 budget → `[370, 130]`).
- **Export wrote a stale snapshot back over edits.** The post-generation
  save used the report captured before the multi-second `await`; anything
  typed during generation was reverted and persisted as reverted. Now
  merges onto the latest report via a ref.
- **Photos stuck on "Loading photo…" forever** (and printed that way).
  A per-effect cancel flag abandoned in-flight reads when a second photo
  arrived, and the next run skipped ids that already had an entry. Late
  results are now accepted while the entry is still `loading`.
- **IndexedDB connection cached forever.** iOS Safari closes IDB
  connections in the background; the dead connection stayed cached and
  every photo read/write failed until a full reload. `onclose` /
  `onversionchange` now drop the cached promise.
- **UTC signature dates** on witness and investigation-team signatures.

### Crew board, sign-in and review chain

- **Signature queue flushes overlapped** (`signatureQueue.js`). The kiosk
  fires a flush per signature without awaiting; two overlapping flushes
  read the same queue and inserted the same signature twice under fresh
  ids — a phantom signer on the count and on the filed sign-in sheet. Now
  single-flight, and the queued item's own id is passed through to the
  insert so a retry after a timed-out reply hits the primary key instead
  of duplicating (a `duplicate key` reply counts as sent).
- **Refused signatures dropped silently** (`MyBoard.jsx`). A signature the
  database refused (JSA closed while the iPad sat open, or clock skew
  around the 30-minute opening) was dropped, counted as "stuck", and the
  message then cleared because the queue was empty — the man watched the
  count go up and walked off. Refusals are now counted separately, the
  on-pad count is corrected, and the bar says "N signature(s) could not be
  recorded — this JSA had already closed. Have them sign the paper sheet."
  The pending bar also renders when the kiosk is not open, so signatures
  queued in an earlier session are visible the moment the board opens.
- **"Already filed" query was unscoped** (`board.js`). It read the marker
  off every JSA in the archive the caller could see; PostgREST caps at
  1,000 rows, so past that size older markers went missing and filed
  postings would have been re-filed forever. Now `.in()` on the candidate
  ids only.
- **Publishing yesterday's draft made an already-expired posting** ("Live
  on your board", nothing on the board, auto-filed with zero signatures).
  `PublishToBoardButton` now refuses when `computeExpiry(jsa)` is in the
  past and says to fix the date.
- **Assignee's submit created a second open document.**
  `SendForReviewButton` always sent `id: null`, and the server-side reuse
  only matched rows the submitter created — so a witness/assignee
  finishing a hand-off made a new row: the author's original sat "with
  <assignee>" forever and the approver filed the copy under the wrong
  author. Submit now reuses the picked-up link's `openDocumentId` when it
  describes the same document.
- **`is_admin` honoured inconsistently.** `SubmitArea` picked "approve"
  mode for an admin, but `ApproveAndFileButton` and `OpenDocsView`
  checked role only — an admin whose role is not pm/hr/owner got no
  button at all, and the Home badge disagreed with the My Work list. All
  three now match `can_file_doc_type()`.
- **Approve-with-edits ignored the notice insert error** and then told the
  approver the author "has been told". The error is now returned and the
  wording says the author could NOT be notified.

### Sign-out, sync, offline (`src/shared/`, `src/account/`)

- **Autosave timers now stop when sign-out has wiped the device.** The
  three 900 ms autosave timers (JSA, incident, the four shared documents)
  wrote to storage without checking the sign-out flag; only the
  pagehide/visibility flush did. Sign-out calls `reload()`, and the old
  page keeps running until the new one commits -- with the service worker
  going network-first, that is seconds in a dead zone -- so a timer armed
  just before Sign out could put the wiped draft back. Not reproduced in
  the browser here (the reload commits too fast on localhost); guarded as
  hardening. The existing `verify-signout-still-clears` check passes on
  both the original and the fixed code once it runs on a clean server (see
  section E).
- **Sign-out could leave the session on the device.** supabase-js's
  `signOut()` *returns* an error (does not throw) when the token has
  expired and cannot refresh offline — and does not remove the stored
  session. Both sign-out buttons wiped the paperwork, reloaded, and the
  same person was still signed in. New `clearStoredSession()` removes the
  `sb-*-auth-token` keys directly, always.
- **Sign-out left more behind:** the ErrorBoundary's `.broken.*` rescue
  copies (whole documents), the completed-incident record list, and the
  sync stamp/tombstones (which made the *next* person's first sync treat
  this iPad's stamp as theirs). All cleared now. (Templates and settings
  still stay on the device by design — see OPEN.)
- **Offline, an uncached lazy screen reloaded the page and then crashed
  the app.** `loadModule` treated "Failed to fetch" as a stale deploy;
  offline it force-reloaded (losing the step you were on) and on the
  second try threw into `React.lazy`, which only the root boundary
  catches. It now checks `navigator.onLine` first and throws a plain "this
  part needs a signal the first time it is opened" error instead of
  reloading. (Per-screen error boundaries and pre-warming the chunk cache
  are still OPEN, below.)

---

## B. Database — `supabase/migrations/20260930120000_audit_hardening.sql`

Written, **not applied**. Every earlier promise mostly holds: no
update/delete path exists on `documents` for any API role, storage objects
cannot be overwritten, nobody can change their own role, anon cannot read
signatures or PDFs, `search_path` is pinned on every definer function. The
migration closes what does not hold:

1. Unique partial index on `documents (data->>'archivedPublicationId')`
   for JSAs — the only real stop for the two-device auto-archive race.
   **If it refuses to build, duplicates already exist**; the file says how
   to find them.
2. `before update or delete` triggers that always raise on `documents` and
   `jsa_signatures`, so "the filing cabinet itself refuses" is also true
   of the dashboard SQL editor (today it is only true of the app's keys —
   HANDOVER §3's wording is stronger than the schema).
3. Size limits on `jsa_signatures` (anon-insertable, undeletable, no cap
   today) and `employee_requests`. Added `NOT VALID`, validated at the end.
4. `expires_at <= published_at + 48h` on `jsa_publications`: any login
   could plant a 2099 posting on anyone's board and one anonymous
   signature made it un-removable.
5. `employee_requests` insert trigger that blanks the answer columns and
   forces the 2-hour expiry, so the "employee's words are written once by
   the employee" rule is a rule, not a default.
6. `revoke execute … from public, anon` on `set_person_role` (same fix
   20260912020000 made for the filing functions).
7. `drop function link_edits_to_filed` — no caller left, and it let
   safety/clerk stamp any edit notice with any uuid.
8. **Left as a written TODO in the file:** `file_reviewed_document` should
   refuse to file a submitted JSA the caller cannot see (any login can
   today, given the uuid). Not reproduced in SQL so the file cannot drift
   from the live function text.

Also found, **not in the migration** (decide first):

- Audit columns on the append-only tables (`submitted_at`, `filed_by`,
  `signed_at`, `is_late`, `source`, `published_at`, `edited_at`,
  `notify_user`) are whatever the client posts. A server-side `before
  insert` stamp is the fix, but it would overwrite the queued-offline
  capture time on kiosk signatures; add a `client_signed_at` first.
- `pdf_path` is never checked against the uploader's folder, and the
  storage policy that lets supers/foremen open disciplinary PDFs trusts
  it — HR/owner could point a `disciplinary` row at any object and widen
  access to it. Fix sketched in the reviewer notes (policy + trigger +
  a check inside `file_reviewed_document`).
- `is_admin` is an undocumented super-flag: manages roles and files
  anything regardless of `role`, survives demotion to "Not assigned yet",
  and nothing in-app can clear it. HANDOVER §5/§8 do not mention it.
- `board_for` returns the full JSA `data` to anon, including any kiosk
  `crewSignatures` captured before publishing and the superintendent's
  signature image. Strip those at publish or in the function.
- Migration 20260912010000 changed two roles with a raw `update` and no
  `role_changes` row; dashboard edits are equally unrecorded. Say so in
  HANDOVER §5 or back-fill the log.
- Verify in the dashboard that **"Allow new users to sign up" is off**;
  if on, anyone can make a `field` account with the shipped key.
- HANDOVER §10.4 says crew sign-in "never records names"; the phone path
  *requires* a name (constraint `jsa_signatures_phone_has_name`) and
  prints it on the sheet. Only the kiosk is nameless.
- Functional: a foreman publishing onto a super's board uploads the PDF
  under the foreman's folder, so the board owner cannot open it; a
  document filed by an approver gets `pdf_path` under the approver's
  folder, so the author cannot open their own filed PDF.

---

## C. OPEN after round 1 — see "Round 2" above: all fixed except where noted there

Ordered by how much I would worry about each.

1. **An approver who picks up an Incident Report or JSA to fix wording has
   no way to save it.** `SubmitArea` shows only `ApproveAndFileButton` in
   approve mode; for incident/jsa that renders helper text and nothing
   else, and `saveApproverEdit` has no caller. "Sign off & file" from My
   Work then files the *server* copy — the corrections die on the iPad and
   the archive gets the uncorrected text and PDF. Needs a product call
   (save-and-send-back vs. re-submit) and two real accounts to test.
2. **Incident photos never leave the device.** Blobs live in IndexedDB
   only; draft files, submissions, pick-ups and the last-finished snapshot
   carry metadata only, so any cross-device PDF prints "Photo unavailable"
   frames — and generation does not treat that as an error. After Submit,
   the author's blobs are deleted, so a send-back cannot re-attach them.
   Minimum: block export when any photo is not `ready`. Real fix: ship
   the JPEG bytes with the document or upload them beside the PDF.
3. **Employee/witness hand-off answer is lost if the panel unmounts** (tap
   Next, Home, app reload) before the poll sees it — the token lives only
   in component state. The employee sees "Sent", the manager gets a fresh
   QR and makes them sign again. Persist the token on the model and resume
   polling on mount; also stop polling on `expired`.
4. **Witness statement can contradict the employee line** on
   disciplinary/separation: `witnessStatement` is frozen when the witness
   signs from the employee toggle *as it stood then*; flipping "They are
   not signing" afterwards prints "…signed to acknowledge receipt" above
   "Refused / Unavailable to Sign". Either re-stamp on change or clear the
   witness signature with a toast.
5. **PDF layout (needs a visual review pass, per CLAUDE.md):**
   - `multiSignatureRow` labels overflow into the next column at ≥ ~35
     characters ("Alfonso Hernandez - Safety Director — MANAGEMENT" is
     230 pt in a 183 pt column).
   - `checkboxGrid` "Other — <free text>" runs off the right page edge
     from column 2 (Separation "Property returned", Medical attachments).
   - Section captions (`numberedBar`, `grayBar`, `textBox` titles) can be
     orphaned at the foot of a page with their box on the next.
   - Incident page 2: `injuryRemarks` has no overflow protection; a long
     dictated remark shrinks or removes the body diagram silently.
   - Incident photo appendix pages are embedded as full-page PNG rasters
     (4–8 MB each) instead of the JPEGs the photo pipeline already made.
6. **Offline resilience beyond the loadModule fix:** each lazy screen
   should have its own small error boundary, and the service worker (or
   an idle-time `import()` from App) should pre-warm the six workflow
   chunks — today a chunk is cached only after it has been fetched once,
   so a first visit to Separation in a dead zone after a deploy fails.
   `ViewAsPicker` is mounted for everyone in Settings; gate it on admin.
7. **Templates and settings follow the device, not the account**, on a
   shared iPad (by design per `clearOnSignOut.js`). B's first sync after
   A signs out merges A's templates (job sites, crew leads, phone numbers)
   into B's account. Namespace by user id, or drop the device copy on
   sign-out when the account has a sync row. Related: settings
   newest-wins compares against the row-wide `updated_at`, which a
   template save also bumps, so an older settings edit can win.
8. **`PaginationMeasureRig` measures two Letter pages in hidden DOM on
   every keystroke** for a result `resolvePagePlan` throws away (measured
   plans never carry `continuationColumns`). Per-keystroke layout thrash
   on older iPads; unmount it until measured pagination is rebuilt.
9. **Uploading a scanned document a role may not file** uploads the file
   first, then the row insert is refused by RLS — raw Postgres error on
   screen, orphan in the bucket, another orphan per retry. Filter the type
   list by role; cap file size before upload.
10. `Kiosk error text says "expired" when the DB refused because signing
    has not *opened* yet (clock skew); the crew page never re-evaluates
    "Scheduled" without a reload; `board_for` … see B.
11. Smaller: `importTemplateFile` crashes on a non-string `templateName`;
    `SameAsLastDialog` `.trim()`s unsanitised cloud data; StepFinish
    forgets its route on remount so a ready PDF panel disappears until
    "On paper" is tapped again; `useFocusTrapDialog` re-runs on every
    parent render (keyboard users); signing in never triggers a sync (only
    focus/edit/reload); `sdc.*` rescue path can leave keys half-moved on
    quota; sim seeds carry unmarked real-looking names; Records banner
    says "documents you filed" to PM/clerk/owner who see everything;
    `ChangePassword` reports no-signal as "wrong password"; HEIC uploads
    stored as-is will not open on the office PC; `pdf-lib` is bundled
    into every workflow chunk despite `pdfLibs.js`; voice on iPadOS ≥14.5
    is a live, untested path (`webkitSpeechRecognition` exists).

---

## D. Checked and found OK (so nobody re-audits it)

- `sanitizeJsa`, `safeJson`, `asStoredList`, every `emptyX()` spread:
  wrong-shaped localStorage cannot crash Home or a workflow.
- JSA autosave / `flushPendingAutosaves` / `stopJsaAutosave` ordering on
  clear, publish hand-off, submit hand-off and sign-out: no resurrection.
- `getContentColumns` is the single source for print, preview and the
  crew phone page — the crew signs what prints.
- Board time maths: `computeExpiry` / `computeOpens` build local `Date`s
  (no UTC-midnight trap), midnight-crossing shifts add a day, DST keeps
  wall-clock, `opens_at`/`expires_at` are enforced in the database.
- `signPublication` has no `.select()` (anon cannot read back);
  `takeDownPublication` verifies the 0-row delete; `file_reviewed_document`
  is one locked transaction; `submit_employee_response` is one-shot.
- SignaturePad: pointer/touch split, `touch-action: none`, no resize wipe
  once a stroke exists, DPR-consistent export. BodyDiagram marks are % of
  the image on screen and in print.
- Readiness checks and step locks across all six documents; no inverted
  conditions found. Migrations for old separation/uncontrolled/incident
  drafts are idempotent.
- No `dangerouslySetInnerHTML` anywhere; filenames sanitised; hash routes
  anchored; hand-off tokens 256-bit, one-shot, fragment-only.
- All nine tables have RLS; `private` schema is invisible to PostgREST
  and anon; storage bucket private, first path segment must be own uid.

---

## E. The check suite

`npm run check` in this container: 3 scripts first failed because
Playwright 1.62's pinned browser was not installed (symlinked to the
preinstalled Chromium). Then 5/22 were red, **all stale scripts**, not
app bugs, all from the last three tidiness/signature commits:

- `verify-discard-stays-discarded` — Document Options moved under the
  collapsed "More options" on Finish. Script now opens it first.
- `verify-disciplinary` / `verify-employee-parts-are-his` — labels renamed
  to "Your Signature" / "Their Signature"; the statement moved to the
  Signatures step; wording is "Done on their phone". Scripts updated.
- `verify-people-roles` — `.peopleLocked` became `.peopleNow`, the role
  meaning moved into the `.peopleConfirm` strip, "Save role" became
  "Save". Updated; 12/12.
- `verify-discard-stays-discarded` also expected the Home count row, which
  is now hidden when every number is zero. Updated; 4/4.
- `verify-send-for-review` — looks for a "paper copy first" button that
  the "cleaner Submit" commit reworded. **Not updated** (the read of the
  new label was blocked in this session); it needs the current secondary
  button's text. Its first three assertions pass.

**A trap for whoever runs the suite next, in this container or on a
laptop:** `killTree` did not kill the Vite servers the scripts spawn.
The first (browserless) run left a `vite --port 4357` dev server alive;
every later run of `verify-signout-still-clears` then failed to start its
own (`--strictPort`) and silently drove the stale server, whose module
cache never picked up file edits — so the check "failed" identically with
and without the fixes, and "passed" the moment the stray process was
killed. If a check fails the same way no matter what you change, look for
a leftover `vite` process on its port before believing it.

Final state: 21/22 green (`verify-send-for-review` stale as above).
Both suite runs were done with Playwright pointed at the preinstalled
Chromium via symlinks under `/opt/pw-browsers/`; nothing in the repo
changed for that.
