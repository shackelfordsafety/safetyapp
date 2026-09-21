# Continuing this app

**You do not need to know how to write code to use this page.**

If you have never opened a code file in your life, you are the person this
was written for. Shackelford already uses Claude for project management
work, and Claude can do the actual building here. Your job is to know what
you have, what must never be broken, and what to ask for.

Written 2026-09-21, when Alfonso "Fonzo" Hernandez — the safety
professional who designed and built this — left the company.

---

## First, the important part

Fonzo's own words on his last day:

> *"To me it's already 100% done. Could have more modules, but this already
> helps a ton."*

**This app is finished. It is not a half-built thing somebody walked away
from.** Six safety documents, filled out in the field, printed or filed
away. 371 real signatures from real crews have already gone through it.

If nobody ever touches it again, **it keeps working.** Nothing expires,
nothing needs maintenance, nobody has to babysit it.

So do not read this page as a to-do list. Read it as: *if we ever want
more, here is how.*

---

## What you actually have

Think of it like a filing cabinet that a superintendent carries in his
pocket.

**Six forms** the app builds: the JSA (the daily job safety analysis),
Incident Report, Uncontrolled Event, Medical Event, Disciplinary Notice,
and Employee Separation.

**Two halves**, and this is the one thing worth understanding about how it
is put together:

| | The field half | The office half |
| --- | --- | --- |
| **Who uses it** | Superintendents, foremen, crew | Safety, HR, owners, office |
| **Needs a login?** | **No. Never.** | Yes |
| **Needs cell signal?** | **No. Never.** | Yes |
| **What it does** | Build, fill out and print any of the six forms | Records, approvals, publishing a JSA for the crew to sign |

The field half works in a gravel pit with no bars on your phone. That is
not a nice-to-have — it is the entire reason the app exists instead of a
website somebody has to log into.

**Where the paperwork lives:** finished documents go into a database
(a service called Supabase — think of it as the locked filing cabinet in
the office). Documents filed there **cannot be edited or deleted by
anyone, at any permission level, ever.** That was deliberate, for legal
reasons.

---

## How to actually get something done

You will not edit anything yourself. You will ask Claude, and Claude will
do it.

### Setting Claude up on this, once

1. Get the project folder onto a computer (see `HANDOVER.md` — it lives on
   GitHub, and the company account already has access).
2. Open Claude Code in that folder.
3. That is it. **There is already a file called `CLAUDE.md` in there that
   Claude reads automatically.** It explains the whole project, the house
   rules, and every trap somebody has already fallen into. You do not have
   to explain the project to Claude — it reads itself in.

### The four things to say every time

Whatever you are asking for, include these. They are the difference
between a change that works and a change that quietly breaks something:

1. **"Read CLAUDE.md and CONTINUING.md first."**
2. **"Do not change anything about printing or the PDFs unless that is
   specifically what I am asking for."**
3. **"Run `npm run check` when you are done and tell me the result."**
4. **"Show me screenshots of the actual app before and after."**

That fourth one matters more than it sounds. This app's printed output has
broken before in ways that looked perfectly fine on screen. **Never accept
"it should work" — ask to see it.**

### Prompts you can copy

**To understand something before you change it:**

> Read CLAUDE.md and CONTINUING.md. Then explain to me, in plain English
> with no technical jargon, how [the thing] currently works and what would
> have to change to [what you want]. Do not change anything yet — I want to
> understand the tradeoffs first.

**To make a small change (wording, a field, a label):**

> Read CLAUDE.md and CONTINUING.md first. I want to [describe it in your
> own words]. Make the smallest change that does this. Do not touch
> printing or PDF code. When you're done, run `npm run check`, show me
> before-and-after screenshots of the real app, and tell me anything you
> were unsure about.

**To add a whole new form — the big one:**

> Read CLAUDE.md and CONTINUING.md first. I want to add a new document
> type called [name]. Follow the same pattern as the Employee Separation
> document, which is the newest and cleanest one.
>
> Important: `can_file_doc_type()` in the database lists document types by
> name, and a new type falls through to `else false`. If you skip that, the
> app will look correct in the browser and the database will silently
> refuse to file anything. Add the new type in a migration and ask me which
> roles should be allowed to file it.
>
> Before writing any code, show me a plan and what the form's fields will
> be. Do not invent any safety wording — I will supply that.

You do not need to understand that middle paragraph. Claude does. Paste it
anyway — it is the single most expensive mistake available here, and it
costs an afternoon to find.

**When something looks wrong:**

> Read CLAUDE.md first. [Describe what you're seeing.] Find out why before
> changing anything, and show me what you found. If it's a printing or PDF
> problem, generate a real PDF and look at the actual image inside it —
> don't judge it from the preview on screen.

---

## Six rules you must never let anyone break

Every one of these came from a real problem, a legal requirement, or a
direct instruction from Fonzo. They are the ones most likely to get
"tidied up" by somebody who does not know why they are there — including
an AI that is trying to be helpful.

**1. Never let anything invent safety wording.**
The hazards, controls and task descriptions in this app end up on a signed
legal document. Do not let Claude write them. Do not let anyone pad the
lists with reasonable-sounding entries. When new wording is needed, it
comes from actual regulations and a qualified safety person approves it
line by line. *This is the most important rule on this page.*

**2. What the employee wrote, the employer cannot change.**
Fonzo's words: *"make sure everything the employee does can't be changed by
the employer, for legal reasons."* An employee's statement, signature and
date are locked the moment they are given. This applies to any new form
anybody adds later, not just the ones that have it today.

**3. Filed documents can never be edited or deleted.**
Not by HR, not by an owner, not by anybody. The database itself refuses —
it is not just a hidden button. That is on purpose. If someone asks for an
"edit filed record" feature, that is a legal conversation, not a software
request.

**4. The crew sign-in never records names.**
It is numbered only — person 1, person 2, person 43. It was built for a
hundred men signing in a few seconds each. Every single design mockup ever
made for this app got this wrong and showed a list of names to tap. If
someone proposes that, they have not understood the workflow.

**5. The field half never needs a login.**
If a change would require a superintendent to sign in before filling out a
form, the answer is no. Crews work where there is no signal.

**6. Write about people neutrally.**
No "he/him/his" in anything a person reads — use "they", or speak to the
person directly. Fonzo's reason was simple professionalism: *"not
everybody's he."*

---

## If you want more: what was already planned

These are not loose ideas. They were thought through and decided, and then
time ran out. They are written here because they existed nowhere else —
they were going to be lost entirely.

### Equipment inspection checklists

The intended next piece, and the most worked-out.

- It would be **part of this same app**, sharing one login — not a separate
  program to buy and manage.
- An operator **scans a QR sticker on the machine** and fills out the
  checklist. **No login, no account, no app to install** — exactly like the
  crew sign-in works today.
- Those checklists land in the database, where **only management can browse
  them**.
- The shape is deliberate: effortless and anonymous out in the field, a
  real permanent record in the office.

### The crew QR sign-in — decisions worth keeping

Mostly built already. If anyone changes it, these were deliberate:

- The QR code points at the **superintendent's board**, not at one specific
  JSA. That is what handles a five-JSA day and a JSA that gets revised at
  10am — a code pointing at one document goes stale the moment it changes.
- **One permanent QR code per superintendent**, not one per job. A sticker
  that never changes is a sticker nobody reprints.
- If there are several JSAs going that day, the crew member picks by
  **location**.

### Sharing templates between people

Decided, not built, and smaller than it sounds — the plumbing already
exists.

- A **company shelf**: safety or the office posts a template, and everyone
  pulls their own copy. Not people sending templates to each other.

### Two things that are blocked

- **The app cannot send email.** Not a bug — it needs a company DNS record
  that was never set up. Any feature involving notifications starts there.
- **Starting a form on one device and finishing on another** needs somebody
  to decide what happens when both have changes. Guessing wrong loses
  somebody's morning of work.

---

## How to check nothing is broken

The app can test itself. Ask Claude to run this, or type it yourself:

```
npm run check
```

It runs **22 tests, each named after what would go wrong** rather than
some technical label — things like *"the last thing you typed is not lost
when you leave"* and *"the employer cannot change what the employee wrote
or signed."* You can read the results without knowing any code.

**It was passing 22 out of 22 on 21 September 2026. If it ever says
anything other than all clear, do not put that change live.**

Two things worth knowing about those tests:

- **A test passing is not always proof.** Some old tests here kept
  "passing" while checking a screen that had been deleted — they were
  asking a question about something that was not there, and technically
  getting the right answer. If a change feels risky, look at the real app,
  not just the green checkmarks.
- **A test that is always failing is worse than no test.** People start
  ignoring the red, and then they ignore a real one. If a test breaks
  because something was deliberately removed, it should be retired properly
  — there is a folder for that, with instructions.

---

## When something goes wrong

| What you see | What it probably is | What to do |
| --- | --- | --- |
| Somebody says a printed form looks wrong | This is the single most fragile part of the app | Get the actual PDF they printed. Do not trust the preview on screen — it has looked right while the print was wrong. |
| The website won't load at all | The last change broke the build | Ask Claude: *"the site is down, find the last change that went live and tell me if it can be undone."* |
| A person can't sign in | Account issue, not an app issue | See `HANDOVER.md` — passwords are reset from the Supabase dashboard |
| Someone wants a filed record deleted | The app cannot do this, by design | This is a legal decision, not a software task. See rule 3. |
| A change works on a computer but not an iPad | iPads genuinely behave differently here | Say so explicitly when asking for the fix. It has bitten this project repeatedly. |

---

## When to get an actual developer

Claude can handle most of what this app will ever need. Bring in a real
developer for:

- **Anything touching the printed output or PDFs.** This has broken more
  times than everything else combined, and the failures are subtle — it
  looks perfect on screen and comes out wrong on paper.
- **Anything about who is allowed to see what.** The permission rules are
  enforced by the database, and getting them wrong could expose a
  disciplinary notice to the wrong person.
- **Deciding whether to keep this app at all.** If the company ever
  considers replacing it, that is a business decision worth an expert
  opinion — and `README.md` has an honest section about what is worth
  keeping.

---

## Words you will run into

| Word | What it actually means |
| --- | --- |
| **Repo / repository** | The project folder, with a complete history of every change ever made |
| **GitHub** | The website where that folder lives, so it is not on one person's laptop |
| **Commit** | One saved change, with a note explaining *why* it was made |
| **Deploy / push live** | Making a change visible to real users on the real site |
| **Supabase** | The company's database — the locked filing cabinet with all the records |
| **Build** | Packaging the app so a browser can run it. "The build failed" means the site cannot update |
| **Migration** | A change to the database's structure, written down so it can be repeated |

---

## Where the real answers are

**Every change ever made to this app has a written explanation attached to
it.** Not a description of what changed — an explanation of *why*. There is
no ticket system and no design documents, so that history is the actual
record of this project.

If something looks strange or wrong, it is worth asking Claude:

> Look through the project history and find out why [the odd thing] is the
> way it is. Explain what you find in plain English.

A surprising amount of the odd-looking stuff is there because something
went wrong once and this was the fix.

**Four documents, four jobs:**

- **`README.md`** — what this app is
- **`HANDOVER.md`** — who owns the accounts, and what to do if you want to
  stop using it
- **`CONTINUING.md`** — this page
- **`CLAUDE.md`** — the technical detail. You do not need to read it.
  Claude does, automatically.
