# Safety App — Handover

The app: **shackelfordsafety.github.io/safetyapp/**

It is a website. Nothing to install and nothing to update. It costs $25 a
month to run — section 15.

Last checked: 26 September 2026.

---

## 1. What it does

Builds and stores six safety forms.

| Form | Used for |
| --- | --- |
| Job Safety Analysis (JSA) | Daily. The work, the hazards, the controls. Crew signs it each morning. |
| Incident Report | Somebody was hurt or something went wrong. |
| Uncontrolled Event | Near miss, spill, weather, equipment failure. Nobody hurt. |
| Medical Event | A medical issue at work and the response. |
| Disciplinary Notice | Written warning or write-up. |
| Employee Separation | Somebody leaving, and the circumstances. |

Fill a form in on a phone, tablet or computer. Then either print it and
sign on paper, or send it round for signatures on phones and it files
itself.

---

## 2. What needs a login and what does not

**No login, no signal needed:**

- Filling in any of the six forms
- Printing any of them
- Crew members signing a JSA (scan QR, read, sign with a finger, done)

**Login required:**

- Publishing a JSA to the board so the crew can scan it
- Filing a document into Records
- Approving documents
- Opening Records at all

A superintendent who publishes JSAs needs an account. A crew member who
only signs them does not.

---

## 3. The two systems behind it

| Name | What it is | When you touch it |
| --- | --- | --- |
| **Supabase** | The filing cabinet. Stores filed documents, signatures, accounts. "The dashboard" means Supabase's website. | Creating accounts. Resetting passwords. Nothing else. |
| **GitHub** | Where the app's instructions are kept, and where the website is built from. | Almost never. |

**Filed documents can never be edited or deleted. By anybody.** Not HR,
not an owner, not whoever holds every password. The filing cabinet itself
refuses. A wrong document or a blurry photo stays too — check before
filing.

---

## 4. A normal JSA day

1. ~6am — superintendent writes the JSA on a phone. No signal needed.
2. Puts it on the board. Needs an account and signal.
3. QR code on the trailer door. Same code every day, never reprinted.
4. Tailgate meeting — crew scan it, read it, sign with a finger.
5. Anybody without a phone signs on the superintendent's device.
6. End of shift — it files itself into Records with all signatures on it.

Paper instead: print it, sign it, somebody in the office uploads the scan
(section 7).

---

## 5. Roles

Eight accounts today. Everyone has a role. These are the app's own words.

| Role | Can see | Can file and approve |
| --- | --- | --- |
| Not assigned yet | only their own documents | JSAs |
| Superintendent | their own, plus every disciplinary notice | JSAs |
| Foreman | their own, plus every disciplinary notice | JSAs |
| Clerk | every filed document | JSAs |
| Project Manager | every filed document | incidents, medical events, uncontrolled events |
| HR | every filed document | everything |
| Safety | every filed document | JSAs |
| Owner | every filed document | everything |

- HR and owners can change roles. Nobody else. Nobody can change their own.
- Only an owner can make somebody an owner.
- Every role change is recorded permanently.

---

## 6. Adding an account

Most people never need one — see section 2.

### Part 1 — make the login (Supabase)

1. **supabase.com** → **Sign in with GitHub** → use the `schsafety` account.
2. Open the project **SCH Safety App**.
3. Left menu → **Authentication** → **Users**.
4. **Add user** → **Create new user**.
5. Enter their **work email** and a **password**. Write the password down —
   nothing anywhere keeps a copy.
6. **Switch on "Auto Confirm User".** Leave it off and Supabase tries to
   email a confirmation link. The app has no email set up, so the email
   never arrives, they cannot sign in, and nothing on screen says why.
7. **Create user**.
8. Give them the email and password. Tell them to change it under
   **Settings › Your Profile**.

### Part 2 — set their role (in the app)

New accounts start at "Not assigned yet" and can barely do anything.

1. Sign in to the app.
2. **Settings › People**.
3. Find them. They show as "Name not set yet" until they type their name.
4. Pick from the **Can see** dropdown. Each choice explains itself below.
5. **Save role**.

**Do this every time you add somebody.** Nothing looks broken if you
forget — the person just quietly cannot do their job. If unsure which role,
pick the smaller one.

### Locked out

**Authentication → Users** → find them → set a new password → tell them.
Nothing is emailed.

---

## 7. Uploading paper documents

1. Sign in → **Records**.
2. Add a document that already exists as a file.
3. Pick the file. PDF or photo both work.
4. Say what kind, who it is about, which job, and when.
5. File it.

- Records shows the **uploader** as who filed it, not the person who wrote
  the form. Put their name in the note field if it matters.
- Cannot be undone. Check the photo is readable first.

Who can upload what follows the same table as section 5.

---

## 8. When somebody leaves

**Do not try to delete the account. It will not work, on purpose** — every
filed document names who submitted it, and the filing cabinet will not let
a record end up with no author.

1. Change their password (section 6, "Locked out"). They are out
   immediately.
2. Set their role to "Not assigned yet" in Settings › People.

---

## 9. Changing the app

The app is changed by working with Claude, an AI assistant. No programmer
required for most things.

**Setup, once:** get the project folder from GitHub (`schsafety` account),
open Claude Code in it. There is a file called `CLAUDE.md` in there that
Claude reads by itself — you never have to explain this app to it, and you
never have to read that file.

**Include these four lines in every request:**

1. "Read CLAUDE.md and HANDOVER.md first."
2. "Do not change anything about printing or the PDFs unless that is what
   I am asking for."
3. "Run `npm run check` when you are done and tell me the result."
4. "Show me screenshots of the actual app before and after."

The fourth matters most. This app's printed forms have come out wrong
while looking perfect on screen.

### Copy-paste prompts

**Understand something first:**

> Read CLAUDE.md and HANDOVER.md. Then explain to me, in plain English
> with no technical jargon, how [the thing] currently works and what would
> have to change to [what you want]. Do not change anything yet.

**Small change — wording, a field, a label:**

> Read CLAUDE.md and HANDOVER.md first. I want to [describe it in your own
> words]. Make the smallest change that does this. Do not touch printing
> or PDF code. When you are done, run `npm run check`, show me
> before-and-after screenshots of the real app, and tell me anything you
> were unsure about.

**Add a new form:**

> Read CLAUDE.md and HANDOVER.md first. I want to add a new document type
> called [name]. Follow the same pattern as the Employee Separation
> document, which is the newest and cleanest one.
>
> Important: `can_file_doc_type()` in the database lists document types by
> name, and a new type falls through to `else false`. If you skip that,
> the app will look correct in the browser and the database will silently
> refuse to file anything. Add the new type in a migration and ask me
> which roles should be allowed to file it.
>
> Before writing any code, show me a plan and what the form's fields will
> be. Do not invent any safety wording — I will supply that.

Paste that middle paragraph even though it means nothing to you. It is the
most expensive mistake available here.

**Something looks wrong:**

> Read CLAUDE.md first. [Describe what you are seeing.] Find out why
> before changing anything, and show me what you found. If it is a
> printing or PDF problem, generate a real PDF and look at the actual
> image inside it — do not judge it from the preview on screen.

---

## 10. Rules that must not be broken

1. **Never let anything invent safety wording.** Hazards, controls and task
   descriptions end up on a signed legal document. They come from actual
   regulations and a qualified safety person approves them line by line.
2. **What the employee wrote, the employer cannot change.** Their
   statement, signature and date lock when given. Legal requirement,
   applies to any new form.
3. **Filed documents can never be edited or deleted.** A request for an
   "edit a filed record" button is a legal conversation, not a software one.
4. **Crew sign-in never records names.** Numbered only — person 1, person
   43. Built for a hundred people signing a few seconds each.
5. **Filling in and printing must never require a login.** Crews work where
   there is no signal.
6. **Write about people neutrally.** No "he" or "him" in anything a person
   reads. Use "they" or address them directly.

---

## 11. Checking nothing is broken

```
npm run check
```

22 tests, each named after what would go wrong in plain words. All 22
passing as of 26 September 2026. **If it says anything other than all
clear, do not put that change live.**

- `npm run check:all` (67 scripts) is **not reliable** — scripts report
  CRASHED there that pass on their own. Do not "fix" things based on it.
- A passing test is not always proof. Some old tests kept passing while
  checking a screen that had been deleted. If a change feels risky, look
  at the real app.

**Putting a change live** = sending it to GitHub, which rebuilds the
website by itself. No second approval step, no safety net beyond those
tests.

---

## 12. Troubleshooting

| What you see | What it is | What to do |
| --- | --- | --- |
| A printed form looks wrong | The most fragile part of the app | Get the actual PDF. Do not trust the on-screen preview. |
| The website will not load | The last change broke it | Ask Claude: "the site is down, find the last change that went live and tell me if it can be undone." |
| Somebody cannot sign in | Account problem | Set a new password — section 6. |
| A **brand new** person cannot sign in | "Auto Confirm User" was left off | Section 6, step 6. A new password clears it. |
| Somebody wants a filed record deleted | Not possible, by design | Legal conversation, not a software task. |
| Works on a computer, not an iPad | iPads genuinely behave differently | Say so explicitly when asking for the fix. |

---

## 13. Get a real programmer for

- Anything touching printed forms or PDFs.
- Anything about who is allowed to see what.
- Deciding whether to keep this app at all.

---

## 14. Accounts

**One login opens everything: the GitHub account `schsafety`**, on a
company email, ordinary password, no two-factor.

- **GitHub** — the app's instructions and the website.
- **Supabase** — the filing cabinet. **No separate password.** You open it
  with "Sign in with GitHub".

Because it is on a company mailbox, the company can always recover it:
reset the email password, then reset the GitHub password from that mailbox.

There is also a **service key** inside Supabase — a master key, not written
down anywhere in the app. Normal work never needs it.

**Make sure more than one person has the `schsafety` password and has
signed in with it at least once.**

---

## 15. What it costs

| What | Cost | Paid by |
| --- | --- | --- |
| Supabase (Pro plan) | $25 a month, plus usage above the included limits | Company card |
| GitHub | nothing | — |
| The website itself | nothing | — |

The $25 is the filing cabinet — every filed document, every signature, every
account. Pro also keeps daily backups and stops the project being paused for
sitting idle, which the free plan does after about a week of no use.

**If that card ever fails, the records go offline.** Filling in and printing
keep working, because they need nothing. Filing, Records and crew sign-in stop
until billing is sorted out. Nothing is deleted.

Keep a current company card on the account, and make sure the receipts go
somewhere other than one person's inbox.

---

## 16. Planned, never built

- **Equipment inspection checklists.** Part of this same app. Operator
  scans a QR sticker on the machine, fills in the checklist, no login.
  Lands in Records where only management can browse.
- **Template sharing.** A company shelf — safety or the office posts a
  template, everybody pulls a copy. Not person to person.
- **Email.** The app cannot send any. Needs a company internet record
  nobody set up. Any notification feature starts there.
- **Start on one device, finish on another.** Needs a decision about what
  happens when both were changed.
- **HR adding accounts from inside the app.** Built and deliberately not
  kept — it needs a server nobody is maintaining. Section 6 does the same
  job with nothing to go wrong.

---

## 17. Glossary

| Word | Meaning |
| --- | --- |
| Supabase | The filing cabinet. Stores records and accounts. |
| The dashboard | Supabase's website, where accounts get created. |
| GitHub | Where the app's instructions are kept. |
| Repository / repo | The project folder plus a record of every change to it. |
| Deploy / push live | Making a change appear on the real website. |
| Build | Packaging the app so a browser can run it. "The build failed" means the website cannot update. |
| Commit | One saved change, with a note on why. |
| Migration | A change to how the filing cabinet is organised. |

---

## 18. Finding out why something is the way it is

Every change ever made has a written explanation attached. There is no
ticket system and no design documents — that history is the record.

> Look through the project history and find out why [the odd thing] is the
> way it is. Explain what you find in plain English.
