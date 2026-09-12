# Plan for 2026-09-12 — make the accounts actually carry something

Written 2026-09-11 night, to be executed the next working day with as few
questions to Fonzo as possible.

## The one sentence

The accounts identify people correctly and do almost nothing to follow
them — tomorrow is about making a login mean "your work is wherever you
are", not just "you are allowed to look at this".

## Ground rules for the day

- Work lands on `dev`, tested and committed. **I cannot merge or push to
  `main`** — auto mode blocks it as a production deploy. Every finished
  piece ends with two commands for Fonzo to paste:
  `git merge dev --ff-only` then `git push origin main`.
- Never invent safety content (standing rule). Nothing in this plan
  writes hazard/control/task wording.
- Never invent business data either. Job numbers, job names and people's
  names are Fonzo's to supply — build the box, leave it empty.
- Each item ships on its own. A day that finishes one thing properly
  beats a day that half-finishes three.

---

## 1. "Same info as before?" follows you between devices  ← START HERE

**Why first:** it is the thing he actually asked for, it is small, and
the plumbing already exists.

**What is true now:** `sdc.jsa.lastFinished.v1` is written by
`snapshotFinished()` in `src/shared/handOff.js` and read when starting a
new JSA. It is localStorage, so it lives on exactly one device. Templates
and settings already ride between devices through `user_sync`
(`src/sync/userSync.js`), which is per-account and merges rather than
overwrites.

**Build:**
- Add the JSA last-finished snapshot to the `user_sync` payload, beside
  templates and settings.
- **JSA only.** The same snapshot exists for separation and disciplinary,
  and those name an employee and say why they were let go. That content
  belongs in the archive, which is locked down by RLS — not in
  `user_sync`. Decided, do not widen without asking.
- **Strip before uploading:** crew signature images, and anything
  day-specific that a repeat would overwrite anyway (date, times,
  tailgate topic, previous-day note). Same treatment a template gets —
  reuse `makeTodayFromTemplate`'s idea rather than writing a second one.
  Keeps the payload small and keeps signature images off a table that
  does not need them.
- **Newest wins**, by the snapshot's own `savedAt`. Not "last device to
  open the app wins" — that exact bug was just fixed for settings, do not
  reintroduce it here.
- Sign-out still wipes the local copy (it is in `CONTENT_KEYS`); the
  cloud copy comes back on next sign-in. That is correct behaviour on a
  shared trailer iPad and should stay.

**Prove it:** a new `verify-*.mjs` that seeds a finished JSA snapshot as
device A, syncs, and confirms device B is offered it — and that a
separation snapshot is NOT uploaded.

**Explicitly NOT in this item:** syncing the live, in-progress draft.
That needs a real "there is a newer version, which do you want"
conversation, and `handOff.js` deferred it on purpose. Raise it as its
own decision; do not sneak it in.

---

## 2. The `jobs` table that nothing uses

**What is true now:** `public.jobs` (id, job_number, name, location,
client, active, created_at, created_by) and `public.my_jobs` (user_id,
job_id, added_at) both exist in the live database with **zero rows**, and
**zero lines of app code touch either of them** (verified by grep). They
were built and abandoned.

**Why it matters:** job numbers are free-typed on every JSA, so the same
job is spelled three ways and the archive cannot group by job. Fonzo
already asked for job number over job site in the archive because
"easier to notice which jobs we have" — this is the real version of that.

**Build:**
- A job picker on JSA job info: choose an existing job, or add one.
  Typing stays possible — a superintendent at 6am must never be blocked
  because a job is not in a list yet.
- Seed offer, not seed action: read the distinct job numbers already
  typed into filed documents and OFFER them as jobs to create. Fonzo
  confirms; I do not invent or auto-create.
- `my_jobs` is the "my jobs" shortlist so a super sees his own four jobs
  first instead of the whole company's list.
- Check the RLS on both tables before building on them — they were
  created outside the migrations that this repo can rebuild from, same
  drift problem as `profiles.is_admin`. If policies are missing or wrong,
  write the migration first.

**Ask Fonzo once, cheaply:** whether a job should be pickable by anyone
or only by whoever it is assigned to. Default if he is unavailable:
anyone can pick, matching how the app works today.

---

## 3. Nobody gets told anything

**What is true now:** the review chain relies entirely on somebody
opening the app and noticing a number on the My Work tab. Pat only
reviewed Kameron Grover's separation form today because Fonzo phoned
her. There is no email anywhere in the codebase.

**Blocked half:** real email needs a sending domain, which needs the DNS
letter to Hunter. Do not start the edge function and provider setup
until that lands — it cannot be tested end to end and untested email is
worse than none.

**Autonomous half, worth doing tomorrow:**
- Make "waiting on you" impossible to miss once the app IS open: surface
  it on Home, not only as a tab badge, with the document named and who
  it came from.
- Make it survive a closed app on the same device: the service worker
  (`public/sw.js`) already exists; check whether a local notification on
  next open is worth it, or whether that is just the Home change again.
- Write down exactly what the email piece will be, so it is a one-sitting
  job the day DNS lands: who gets told, for which document types, and the
  wording.

---

## 4. Two accounts that would embarrass us

kris@ and jake@ have **no name** and defaulted to `field`. Hunter, Reeves,
kris and jake have **never signed in**. If any of them logged in tomorrow
they would see an app that knows nothing about them.

**Needs Fonzo, 30 seconds:** who kris and jake are, and what each should
be — superintendent (`field`), safety, PM, or owner. Then it is one
migration and done. Do not guess a person's role.

---

## Not tomorrow, but next

- **Incident photos never leave the device** (IndexedDB, gone on sign-out;
  only the flattened copies inside the PDF survive). Real work — storage
  bucket, RLS, and injury photos are about as sensitive as this app gets.
  Deserves its own day and its own decisions.
- **Equipment checklists** — the next module, and the one Fonzo wanted
  "by the weekend". A module, not a task. Plan it properly before
  starting; see the equipment-checklist-system-plan memory, which is
  already decided in shape.

## Order of the day

1, then 2, then 3's autonomous half. Item 4 whenever Fonzo answers.
Stop and report if 1 and 2 both land — that is a good day, and each ends
with two commands he can paste from his phone.
