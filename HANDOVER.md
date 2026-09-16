# Handover

Alfonso "Fonzo" Hernandez built and ran this app while he was the safety person
at Shackelford Construction and Hauling. He has left. This page is what has to
change hands, written so that somebody who is not a programmer can still do the
parts that matter.

Last verified 2026-09-16.

---

## The short version

**Nothing breaks when Fonzo leaves.** The app is not running on his laptop and
it is not tied to his personal accounts. It lives at

> https://shackelfordsafety.github.io/safetyapp/

and it will keep serving that page whether or not anybody touches it again.
The records that have already been filed cannot be deleted from inside the
app, by design, so they are not at risk either.

There are still four things to hand over. Two are already done.

---

## If you are HR or management

Four accounts exist outside the app itself. Think of them as the keys to the
building, separate from the keys people use to get into their own office.

| What | Who holds it now | What to do |
| --- | --- | --- |
| **GitHub** — where the code lives and where the website is published from | The company org `shackelfordsafety`. Both `fonzohdz` (Fonzo's personal) and `schsafety` (the company account) are full owners. | ✅ **Already safe.** Remove `fonzohdz` from the org whenever you like. `schsafety` keeps everything. |
| **Supabase** — the database holding the filed records and signatures | An org called "Shackelford Safety", project "SCH Safety App". | ⚠️ **Check one thing:** log in as the company account and confirm it is an *Owner* of that org, not just a member. If Fonzo's personal email is the only owner, add the company account as an owner **before** removing him. |
| **The seven logins inside the app** — two owners, safety, HR, a clerk, two foremen | Wherever Fonzo kept the password list. | Get that list from him. Anybody who has left should have their password changed from the Supabase dashboard. |
| **Cloudflare preview** (`safetyapp.fonzohdz.workers.dev`) | Fonzo's personal Cloudflare account. | ❌ **Let it die.** It is only a scratch copy of the `testing` branch for trying things out. The real site does not use it and does not care. |

There is also a **service key** in the Supabase dashboard — a master password
for the database that is deliberately *not* stored anywhere in the code. Treat
it like the safe combination. It is not needed for day-to-day use.

### What you are actually inheriting

Real numbers as of 2026-09-16, read straight from the database:

- **371 crew signatures** collected on real job sites
- **8 documents** filed permanently in Records
- **7 accounts**, of which only a few were ever used

Filed records are append-only: there is no button anywhere in the app, for
anybody at any permission level, that edits or deletes a filed document. That
was a deliberate legal decision, not an oversight. Undoing it would take a
developer writing a database migration on purpose.

### If you decide to stop using it

Do this before you walk away, or you lose the paperwork:

1. Open Records, signed in as an owner, and export everything.
2. Keep a copy of the Supabase project, or at minimum export the `documents`
   table and the stored PDFs.
3. Only then cancel anything.

Do **not** just stop paying the bill and assume the files are somewhere else.
They are not.

---

## If you are the person maintaining it

Read `README.md` first — it explains what the app is, how it is built, and
what will bite you. Then `CLAUDE.md`, which is the accumulated hard-won
detail, especially about printing.

Practical starting points:

```bash
npm install
npm run dev      # http://localhost:5173 — works with no account and no network
npm run check    # 22 checks, all passing as of 2026-09-16
npm run build
```

Shipping is: push to `main`. GitHub Actions builds and publishes to GitHub
Pages. There is no review gate, so **run `npm run check` first** — it is the
only safety net this repo has.

Four more checks need a real login and are run by hand. `npm run check`
prints the exact commands at the end.

**The two things most likely to surprise you:**

1. **Printing is the fragile part.** The PDF engine does not always draw what
   the browser shows. Never approve a print change from a screenshot of the
   preview — generate a real PDF and look at the actual image inside it.
   `CLAUDE.md` has the full scar tissue on this.
2. **Half the app must never need a login.** Crews fill out documents where
   there is no cell signal. Creating, filling in and printing all six document
   types works entirely offline in the browser. The login-only half (Records,
   the review chain, publishing a JSA to a board) is loaded separately so a
   superintendent's phone never downloads it. Do not merge those halves.

**Branches:** `main` is live. `testing` is scratch. The ~20 other remote
branches are finished work from 2026 and can be deleted without thinking about
it.

**Where the reasoning is:** commit messages are long on purpose and say *why*.
`git log` is the real documentation. `reports/audits/` has outside review and a
database security audit; `reports/plans/` has what was going to be built next.
