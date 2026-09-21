# Continuing this app

`README.md` says what this is. `HANDOVER.md` says who owns the accounts.
This page is for the person who wants to **keep building it**.

Written 2026-09-21, when Alfonso "Fonzo" Hernandez — the safety professional
who designed and built it — left the company.

---

## Read this first: it is finished, not abandoned

Fonzo's own words on the day he handed it over: *"to me it's already 100%
done, could have more modules but this already helps a ton."*

That is the right way to read this codebase. It is not a half-built thing
somebody walked away from. It is a working system that does a complete job:
six safety documents, built in the field, printed or filed, with a crew
sign-in flow that has taken **371 real signatures** on real job sites.

So do not open it looking for a to-do list to finish. There isn't one. If
you never touch it again, it keeps working.

What follows is for the case where somebody wants **more** — another module,
another document type. It tells you what was already decided, what the rules
are, and where the tripwires sit.

---

## The one architectural rule

**Half of this app must never require a login.**

Crews fill out paperwork in places with no cell signal. Creating, filling in
and printing all six document types works entirely offline, in the browser,
with no account. The office half — Records, the review chain, publishing a
JSA to a board — needs a login and is loaded separately, so a
superintendent's phone never downloads it.

Every other rule in this file is negotiable with the business. This one is
not, and the split is load-bearing in the code: the office half is behind
`lazy()` + `loadModule()` precisely so it stays out of the field bundle.

If you merge those halves, the app stops working for the people it was built
for, on the days it matters most.

---

## Adding a seventh document type

This is by far the most likely thing anybody wants to do, so here is the
real recipe. It is better-paved than it looks — four of the six types
already share the same scaffolding.

**1. Three files in `src/documents/<yourType>/`.** Copy `separation/` as the
model; it is the most recently built and the cleanest.

| File | What it holds |
| --- | --- |
| `<type>Model.js` | `empty<Type>()`, `has<Type>MeaningfulContent()`, `is<Type>Ready()`, `migrate<Type>Shape()`, step progress + hints |
| `<Type>Workflow.jsx` | The steps, built from `FormPrimitives.jsx` (fields, `StepNav`, `BuilderHeader`, `ReviewExportPanel`) |
| `<type>PdfDraw.js` | Draws the PDF with `pdf-lib`. **Not** html2canvas — see the printing section below |

**2. `src/documents/storage.js`** — add a `DOCUMENT_STORAGE_KEYS` entry. Use
a fresh `.v1` suffix; the suffix is the only schema-versioning mechanism
here and there is no migration runner.

**3. `src/documents/registry.js`** — add the metadata entry. This drives
Home, the Documents tab, Drafts and the mobile nav all at once. Keep it
plain data; it is deliberately importable without pulling in React.

**4. `src/main.jsx`** — the part that is still hand-written. You need: the
model imports, a `lazy()` workflow import, an icon component, a
`useDraftDocument({...})` call, a `usePdfExport({...})` call, a
`makeDraftEntryPoints(...)` call, and a routing branch. Search for
`separation` and you will find every one of them.

**5. The database — this is the step people miss.** `can_file_doc_type()`
enumerates the document types *by name*:

```sql
when kind = 'jsa' then true
when kind in ('incident','medicalEvent','uncontrolledEvent') then my_role() in ('pm','hr')
when kind in ('disciplinary','separation') then my_role() = 'hr'
else false
```

A new type falls through to `else false`. **Everything will look right in
the browser and filing will be silently refused by row-level security.** Add
your type to that function in a migration, and decide deliberately which
roles may file it.

> A note on effort: the registry is the source of truth for *what documents
> exist*, but routing is still per-type conditionals in `main.jsx`. That was
> a conscious trade — making it fully registry-driven would have meant
> touching the JSA's routing, and the JSA is the thing that must not break.
> If you are adding several types, that refactor may finally be worth it.
> Adding one, it is not.

---

## What was decided but never built

These are **not** ideas — they are settled designs, argued through with
Fonzo, that simply ran out of runway. They are recorded here because they
otherwise exist nowhere in this repository.

### Equipment inspection checklists

The intended next module, and the most fully specified.

- A **module of this app**, sharing one login system — not a separate app.
- A **public, no-login form** reached by QR code, the way crew sign-in
  works. An operator scans the sticker on the machine and fills it in with
  no account.
- That feeds a database only **management logins** can browse.
- Deliberately the same shape as JSA crew sign-in: the thing in the field
  is anonymous and frictionless; the thing in the office is the record.

### JSA QR sign-in, remaining decisions

Partly built. The decisions that were made and are worth honouring:

- The QR points at the **superintendent's board**, not at one JSA. This is
  what handles a five-JSA day and mid-day revisions — a sticker pointing at
  a single document goes stale the moment the JSA is revised.
- **One permanent QR per superintendent**, not per job. A sticker that never
  changes is a sticker nobody has to reprint.
- Multi-JSA days are disambiguated by **location**, chosen by the crew
  member.
- Foremen can freely switch which superintendent they are under.
- **No roster.** The kiosk records numbered signatures with no names, on
  purpose. Do not "fix" this by adding a name field — see below.
- Publishing **locks** the JSA.

### Template sharing

Decided, unbuilt, and smaller than it sounds because the plumbing exists.

- A **company shelf**: safety or admin posts a template, everyone pulls
  their own copy. **Not** person-to-person sharing.
- Templates already sync per-account through the `user_sync` table, so this
  is mostly a visibility and publishing question, not new infrastructure.

### Known-blocked

- **Email notifications of anything** — blocked on a company DNS record that
  was never created. Nothing in the app sends email, at all.
- **Syncing an in-progress draft between devices** — needs a real "there is
  a newer version, which one do you want?" conversation designed first.
  Silently picking one will lose somebody's morning.

---

## Rules that are not style preferences

Each of these came from a real incident, a legal requirement, or a direct
instruction. They are the ones most likely to get "cleaned up" by somebody
who does not know why they exist.

**Never invent safety content.** Hazard, control and task wording ends up on
a signed legal record. Do not auto-generate it, do not pad the built-in
libraries with plausible-sounding entries, and do not let an AI assistant
write it. When it needs extending: draft from named regulations, and have a
qualified safety person approve it line by line.

**The employee's own input is immutable.** Fonzo's words: *"make sure
everything the employee does can't be changed by the employer, for legal
reasons."* An employee's statement, signature and date are sealed once
given — see `EmployeeOwned` in the codebase. This applies to every future
document, not just the ones that have it today.

**The archive is append-only, by design.** `documents` has **no UPDATE and
no DELETE policy at all**. A filed record cannot be altered or removed from
the app by anybody, at any permission level. That is a deliberate legal
decision. Removing a record takes a migration and a good reason.

**The crew sign-in kiosk captures no names.** It is numbered only, and built
for ~100 people moving through in seconds. Every design mockup ever made for
this app got it wrong and showed a named tap-to-sign list. Read
`CrewSignInKiosk.jsx` before redesigning it.

**Neutral wording everywhere.** No he/him/his in anything a person reads —
use "they", or address the person directly. Fonzo's reason was
professionalism: *"not everybody's he."*

**Ask, don't lay out every option.** Where there is more than one way to do
something, the interface asks once and shows only the chosen path — with a
way back. The audience is superintendents and foremen who skew older and
not especially tech-savvy. Prefer visible labels over icon-only controls,
tooltips or hidden gestures.

---

## Printing is the fragile part

Treat any change to print CSS, pagination or PDF drawing as high-risk. The
short version of a long, painful history:

- **html2canvas does not always render what the live DOM says**, and the
  difference is not always measurable from the DOM either. Vertical
  centering that measures perfect in the browser can come out visibly
  top-biased in the actual exported raster.
- Therefore: **never certify a print change from the preview, a DOM
  screenshot, or DOM-measured slack.** Generate a real PDF and extract the
  embedded image — `tools/testing/output/extract-pdf-images.mjs` pulls the
  exact bytes a human will see.
- Some fixes in this codebase are **empirically calibrated constants**
  (`translateY(-4px)`, `-5px`, `COMPACT_CELL_SHIFT_PX`) arrived at by trial
  against real PDFs. They look arbitrary. They are not. Do not "clean them
  up" without re-verifying against a real export.
- The four Superintendent documents draw their PDFs with **pdf-lib**
  (`pdfDraw.js`), not html2canvas. That is the newer, better path. The JSA
  and Incident Report still use the older pipeline and have their own
  calibration — do not copy fixes between them without redoing the numbers.
- iPad and AirPrint must keep working. Desktop Chrome passing is not proof.

---

## How to know you did not break it

```bash
npm run check      # 22 checks, named by what goes wrong rather than by filename
```

That is the only automated safety net in the repo — there is no lint, no
type checker, no unit test framework. It was green on 2026-09-21. Keep it
that way, and keep it **honest**: a check that cannot pass is worse than no
check, because people learn to skim past red until they skim past a real
failure.

Four more checks need a real login and are run by hand; `npm run check`
prints those commands when it finishes.

Two things worth internalising about this suite:

- `tools/testing/retired/` holds scripts whose screen no longer exists.
  Nothing runs them. Its README explains when a script belongs there and,
  more usefully, when it does **not** — a renamed button is a bug in the
  script, not the end of it.
- **A dead check does not always go red.** Some kept *passing* against
  screens that were not on the page at all: `count() === 0` is perfectly
  true when the thing being counted was deleted. Green is not proof.

For anything touching a document's fields, layout or PDF output, generate
real evidence rather than describing the change — the `verify-*.mjs` and
`capture-*.mjs` scripts show the working pattern for each document type,
including how to seed a draft through `localStorage` instead of typing
through the UI.

---

## Security findings: all closed

A full row-level-security audit was done 2026-09-11 and raised three issues.
**All three were verified closed on 2026-09-21** — do not go chasing them:

| Finding | Status |
| --- | --- |
| Anonymous users could list every published JSA | Closed. `jsa_publications` SELECT now requires an authenticated, entitled user. |
| Expired JSAs still accepted signatures | Closed. `publication_is_open()` checks `expires_at > now()`. |
| The `safety` role could not file non-JSA documents | Resolved by the `is_admin` flag. Note this is a **role-design** question, not a bug — decide deliberately who should file what. |

The publishable key in `src/archive/archiveClient.js` is meant to ship in
browser code and grants nothing on its own. The service key is not in this
repository and must never be.

---

## Where the reasoning actually lives

**Commit messages are long on purpose and explain *why*, not what.** With no
issue tracker and no design documents, `git log` is the real documentation
of this project. When something looks strange, `git log -S'the odd thing'`
will usually find the commit that explains it.

Beyond that: `README.md` for what it is, `HANDOVER.md` for the accounts,
`CLAUDE.md` for working conventions and the full gotcha list,
`reports/audits/` for outside review and the security audit, and
`reports/plans/` for what was going to be built next.
