# Safety Documentation Center

Safety paperwork for **Shackelford Construction and Hauling** — civil earthwork
crews in Yazoo City, Mississippi. Six documents, filled out on a phone or an
iPad in a job trailer, printed or sent for review, and filed where they cannot
be quietly edited later.

Built by Alfonso "Fonzo" Hernandez (safety) with Claude. If you have just
inherited this, read **`HANDOVER.md`** first — what has to change hands, and
what to do if you want to stop using it — then this page, then `CLAUDE.md`.

---

## Is this worth keeping?

Read this honestly before you invest a week in it.

**What it genuinely does today, in production, with real crews:** a
superintendent writes the morning JSA on his phone, publishes it to a board,
and the crew scans one QR code on the trailer door and signs on their own
phones. 371 real signatures have gone through it. The signed JSA files itself
to a permanent archive the next time somebody opens the app.

**What it is not:** a product. There is one safety person using it, no
onboarding, no email, no billing, no support. It was built to solve one
company's problem and to stop years of safety records living on one laptop.

**If you want to scrap it,** the thing worth salvaging is the printed output —
`src/documents/pdfDraw.js` and the JSA print CSS reproduce Shackelford's actual
paper forms very precisely, which took months. Everything else is replaceable.

---

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # -> dist/
npm run check      # the 22 checks that matter (see below)
```

You need Node 20+. No other setup: the app runs entirely in the browser and
needs no server, no signal, and no account to fill out any document.

## Shipping it

Push to `main`. GitHub Actions builds and deploys to GitHub Pages
(`.github/workflows/deploy-pages.yml`). There is no staging gate and no review
requirement beyond a successful build — so run `npm run check` first.

The `testing` branch is mirrored at a Cloudflare preview URL. On that host
every write to the cloud is refused at the source (`src/shared/demoMode.js`),
so it is safe to hand to somebody to poke at.

---

## How it is built

**One React app, no router, no state library.** `src/main.jsx` is ~6,400 lines
and holds the root component, all navigation state, the JSA's own workflow, and
the hazard/control/task libraries. This is not an accident anybody is proud of,
but splitting it has repeatedly broken printing, so it is done carefully or not
at all.

```
src/
  main.jsx            the app, JSA workflow, print/PDF pipeline
  documents/          the four Superintendent forms + shared form parts
  incident/           Incident Report (deliberately self-contained)
  crew/               the board, the QR page crew members actually scan
  open/               submit-for-review and approval
  archive/            Records — the permanent, append-only filing cabinet
  sync/               templates and settings following an account between devices
  sim/                the simulator (only with ?sim=1)
supabase/migrations/  24 migrations; the database can be rebuilt from these
tools/testing/        115 scripts; the 22 that matter are wired into `npm run check`
```

**Two halves, and the split is the whole design.**

*Offline half* — creating, filling in and printing any of the six documents.
No login, no network, everything in `localStorage`. This must never start
needing an account: crews work where there is no signal.

*Office half* — Records, the review chain, publishing to a board. Needs a
login, lazily loaded, so a superintendent never downloads it.

**Six document types:** JSA, Incident Report, Uncontrolled Event, Medical
Event, Disciplinary Notice, Employee Separation.

---

## The database

Supabase project `adqhuueugwbbudekpkiw` ("SCH Safety App"). Postgres with
row-level security doing the real work — the app hides buttons, but the
**database** is what says no.

- `documents` — the archive. **No UPDATE or DELETE policy at all.** A filed
  record cannot be changed or removed from the app by anybody, on purpose.
  Removing one takes a migration and a good reason.
- `open_documents` — documents in the middle of the review chain
- `jsa_publications` / `jsa_signatures` — the board and the crew's signatures
- `profiles` — who somebody is and what they may see
- `user_sync` — templates, settings and the last JSA, per account

Seven accounts: two owners, safety, HR, a clerk, two foremen. Roles decide
what Records shows.

**The publishable key in `src/archive/archiveClient.js` is meant to ship in
browser code.** It grants nothing on its own. The service key is not in this
repo and must never be.

---

## `npm run check`

Twenty-two checks, named by what goes wrong rather than by filename:

> the last thing you typed is not lost when you leave · a document you got
> rid of stays gone · signing out takes the paperwork off the device · the
> phone shows what the paper says · submitting hands the document over
> properly · no document can be finished by the person who wrote it · a
> whole document, end to end, into a real PDF · the sign-in sheet says who
> signed · the 5PM/5AM typo is caught, real night shifts are not · templates
> are not lost when two devices meet · an old device cannot overwrite newer
> settings · everything the outside tester found stays fixed · the site-type
> hazard packs are intact · picking a job never blocks one being typed in by
> hand · a bad value saved on the device cannot kill the app · typing a
> hazard and pausing does not kill the app · a drawn signature cannot be
> walked away from · speaking into a field does not kill the app · the app
> names roles, never people · the simulator fills documents and stays hidden
> otherwise · fields appear and hide when they should · the employer cannot
> change what the employee wrote or signed

The other scripts in `tools/testing/` are evidence, not a suite — each was
written to prove one change when it was made. Several exercise screens that no
longer exist. `npm run check:all` runs everything if you want it; expect noise.

Four more need a real login and are run by hand — publishing, the
"same info as last time?" sync, the whole review chain with two accounts, and
the employee doing their own part on their own phone.
`core-checks.mjs` prints the commands.

---

## Things that will bite you

- **Printing is the most fragile thing here.** `html2canvas` does not always
  render what the live DOM says, and the difference is not always measurable
  from the DOM either. Never certify a print change from the preview — extract
  the real raster from a generated PDF. `CLAUDE.md` has the full history.
- **One error boundary, at the root** (`src/shared/ErrorBoundary.jsx`). It
  catches a crash, shows something a human can act on, and from the second
  reload offers to set the saved drafts aside — because a wrong-shaped value in
  `localStorage` crashes on every render and would otherwise brick the device
  for that user. It never deletes; it renames to a timestamped backup key.
  There are no per-section boundaries, so one bad value still takes down the
  whole screen — just visibly, instead of white.
- **The PDF machinery no longer ships to everybody** — pdf-lib (438 KB) and
  html2canvas (201 KB) are split out and fetched only when somebody actually
  prints, and the login-only half is split out again. What a crew downloads to
  read a JSA is the 482 KB entry chunk (140 KB gzipped). Further shrinking it
  means breaking up `main.jsx`, which is the one thing that keeps breaking
  printing — weigh that carefully.
- **The archive loads every row into the browser** and searches client-side. It
  pages through the whole thing now, but it will want real server-side search
  before it holds years of paperwork.
- **28 row-level-security policies re-check who you are for every row.** Fine
  at today's size, slow at thousands.

## Not built yet

Equipment inspection checklists (the next module, already designed — see the
memory notes and `reports/plans/`), email notification of anything (blocked on
a company DNS record), and syncing an in-progress draft between devices, which
needs a real "there is a newer version, which do you want" conversation.

---

## Where the reasoning lives

Commit messages are long on purpose and explain *why*, not what. `git log` is
the real documentation. Beyond that:

- `HANDOVER.md` — who owns what, and what to transfer
- `CLAUDE.md` — how to work in this repo, and the hard-won gotchas
- `reports/audits/` — outside review, database security audit, wording audit
- `reports/plans/` — what was going to be built next
- `CHANGELOG.md` — older history

301 commits, last one 2026-09-15.
