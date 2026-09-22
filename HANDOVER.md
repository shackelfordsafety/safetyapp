# The Safety App — everything you need to know

**You do not need to know anything about computers to read this.** If you
have never written a line of code in your life, you are exactly the person
this was written for. There is no jargon in here, and anything that sounds
technical gets explained in plain words the first time it shows up.

This is the only document there is. Everything is on this page.

Last checked: 22 September 2026.

---

## 1. Where this came from

It started as one person's problem.

The safety person at Shackelford was filling out the same paperwork by
hand, every morning, on job sites with no signal — job safety analyses,
incident reports, write-ups. Forms that had to be filled in, signed by a
crew, and then kept somewhere they would not get lost. The whole thing ran
on paper and on one laptop.

So they built something to make their own job easier. Just their own.

Somewhere in the middle of building it, it became obvious the rest of the
company had the same problem. Superintendents were doing the same forms.
HR was chasing the same signatures. The records were scattered across
whoever happened to be holding them. What started as a personal shortcut
turned into something the whole company could use — and that is what it
grew into.

**It got there by going back and forth with an AI assistant called
Claude.** The problem gets described in ordinary words, Claude builds it,
you say what is wrong, Claude fixes it. Over and over. It did not come out
right the first time, or the fifth. What made it work was sticking with it
and being clear about what was actually wrong.

That matters to you, because **that is still how you change it.** Section
10.

**As of today it is finished.** Not abandoned — finished. It does the job
it was built for, and 371 real signatures from real crews have already
gone through it. If nobody ever opens this document again, the app keeps
working. Nothing expires, nothing needs maintaining, nothing breaks on its
own.

There are things you *could* add. There is nothing you *have to*.

---

## 2. What the app actually does

It builds six safety forms, and it keeps them.

| Form | What it is for |
| --- | --- |
| **Job Safety Analysis (JSA)** | The daily one. What work is happening, what could hurt somebody, and what stops that. The crew signs it every morning. |
| **Incident Report** | Somebody got hurt, or something went wrong. What happened and what is being done about it. |
| **Uncontrolled Event** | A near miss, a spill, weather, equipment failure — something that got away from you, but nobody was hurt. |
| **Medical Event** | An employee had a medical issue at work, and what the response was. |
| **Disciplinary Notice** | A written warning or write-up. |
| **Employee Separation** | Somebody leaving the company, and the circumstances. |

You fill a form in on a phone, a tablet or a computer. Then you either
**print it** and sign it on paper the old way, or you **send it round for
signatures on people's phones** and it files itself.

The app lives at:

> **shackelfordsafety.github.io/safetyapp/**

It is a website. There is nothing to install, no app store, nothing to
update. You open that link and it works.

---

## 3. The two halves — the important bit

Some of this app needs an account, and some of it does not. Getting this
straight saves a lot of confusion.

### The part that needs nothing at all

**Filling in and printing any of the six forms.** No login, no account, no
cell signal.

That is deliberate, and it is the whole reason this exists instead of a
normal website. Crews work in gravel pits and on rail sidings where phones
have no bars. A superintendent can sit in a truck with no service, write
the morning JSA, and print it. **That must never change.**

**Crew members signing a JSA** also need nothing. They scan a QR code
stuck to the trailer door with their phone camera, read the JSA, sign with
a finger, and walk off. No account, no app, no password.

### The part that needs an account

Anything that leaves the device:

- **Publishing a JSA to the board**, so the crew can scan and sign it
- **Filing a finished document into Records** — the permanent archive
- **Approving** documents
- **Looking at Records** at all

So a superintendent who publishes JSAs for a crew needs an account. A crew
member who only signs them never does.

---

## 4. Where the paperwork is kept

Two words you will keep seeing. Here is what they actually mean.

**Supabase** is the filing cabinet. It is a company that stores this app's
information on their computers — every filed document, every signature,
every account. When this page says "the dashboard", it means Supabase's
own website, where somebody with the right login can look inside that
filing cabinet directly. You do not need it for day-to-day work. It is
where accounts get created, and that is about it.

**GitHub** is where the app's instructions are kept — the recipe the
website is built from. You will almost certainly never need to touch it.
It matters only because it is the thing the company must not lose.

### One thing about Records that cannot be undone

**Once a document is filed, it can never be edited or deleted. By anybody.
Ever.**

Not by HR, not by an owner, not by whoever holds every password. This is
not a setting somebody forgot to switch on — the filing cabinet itself
refuses.

That was deliberate. A safety record that could be quietly changed
afterwards is worth nothing on the day it actually matters. The
consequence is that a wrong document, or a blurry photo, stays too. **Tell
people to check before they file.**

---

## 5. How a normal day works

This is the JSA, the one that runs every morning.

1. **Around 6am** the superintendent writes the JSA on a phone — the work,
   the hazards, the controls. No signal needed.
2. They choose to **put it on the board**. That publishes it so the crew can
   reach it. This step needs an account and signal.
3. A **QR code** goes up on the trailer door. It is the same code every
   day — it never gets reprinted.
4. **At the tailgate meeting** the crew scan it with their phones, read it,
   and sign with a finger. Fifty people take a couple of minutes.
5. Anybody without a phone on them signs on **the superintendent's own
   device**, passed round.
6. When the JSA runs out at the end of the shift, **it files itself** into
   Records with everyone's signatures on it.

Nobody chases paper, and the signed record ends up somewhere permanent
without anybody having to remember to put it there.

If a crew would rather work on paper, they still can — print it, sign it,
and somebody in the office puts the scan into Records. That is section 8.

---

## 6. Who can do what

Everybody with an account has a **role**. The role decides what they can
see and what they are allowed to do. There are eight accounts today.

These are the exact words you will see in the app, in the order they
appear in the list:

| What the app calls it | They can see | They can file and approve |
| --- | --- | --- |
| **Not assigned yet** | only documents they filed themselves | JSAs |
| **Superintendent** | their own, plus every disciplinary notice | JSAs |
| **Foreman** | their own, plus every disciplinary notice | JSAs |
| **Clerk** | every filed document | JSAs |
| **Project Manager** | every filed document | incidents, medical events, uncontrolled events |
| **HR** | every filed document | disciplinary notices and separations |
| **Safety** | every filed document | JSAs |
| **Owner** | every filed document | everything |

Two of those surprise people:

- **Clerk** and **Safety** can read every document in the company but
  cannot approve anything.
- **Superintendent** and **Foreman** see almost nothing — except every
  disciplinary notice.

**Who may change somebody's role:** HR and owners. Nobody else, and nobody
can change their own. **Only an owner can make somebody an owner** — for
everybody else that option is greyed out.

Every role change is written into a history that nobody can edit or
delete, so there is always a record of who changed what.

---

## 7. Adding somebody to the app

**Most people never need an account.** Read section 3 before you make one.
Filling in and printing needs no login, and a crew member signing a JSA
needs no login. An account is for somebody who publishes JSAs, files
documents, or approves them.

It is two jobs in two places. Both are quick.

### Part 1 — make the login

This part happens in Supabase, the filing cabinet from section 4.

1. Go to **supabase.com** and choose **Sign in with GitHub**. Use the
   `schsafety` account.
2. Open the project called **SCH Safety App**.
3. In the menu down the left, choose **Authentication**, then **Users**.
4. Click **Add user**, then **Create new user**.
5. Type their **work email** and a **password**. **Write the password
   down** — you are going to read it out to them, and nothing anywhere
   keeps a copy of it.
6. **Switch on "Auto Confirm User".**

   This matters more than it looks. Leave it off and Supabase tries to
   email them a confirmation link. That email will never arrive, because
   this app has no email set up at all. They simply will not be able to
   sign in, and nothing on screen will tell you why.

7. Click **Create user**.
8. Tell them their email and password, and ask them to change it once they
   are in, under **Settings › Your Profile**.

### Part 2 — say what they can see

This part happens in the app itself.

A brand new account starts at **"Not assigned yet"**, which means they can
barely do anything. Until you do this, they are stuck.

1. Open the app and sign in as yourself.
2. Go to **Settings › People**.
3. Find them in the list. They show as **"Name not set yet"** until they
   type their own name in.
4. Pick what they can see from the **Can see** dropdown. A line underneath
   tells you what each choice means, so you do not have to guess.
5. Click **Save role**.

Done.

### Which one to pick

If you are unsure, **choose the smaller one.** Somebody with too little
access will come and ask you. Somebody with too much can read every
disciplinary notice and separation in the company.

**Check the role every single time you add somebody.** Nothing looks
broken if you forget — the person just quietly cannot do their job. It has
already happened once: a project manager was added and left at "Not
assigned yet". He could not have approved a single incident, those
approvals would have had nowhere to go, and nobody would have seen an
error message.

### If somebody is locked out

Same place as Part 1: **Authentication → Users**, find them, and set a new
password. Then tell them what it is. Nothing is emailed, so you have to
pass it on yourself.

---

## 8. Putting paper documents into Records

Somebody fills a form in with no account, prints it, gets it signed on
paper, then scans or photographs it. That is a completely normal way to
use this app.

Anybody with an account can put it into Records:

1. Sign in and go to **Records**.
2. Choose to **add a document that already exists as a file**.
3. Pick the file — **a PDF or a photo of the paperwork both work**.
4. Say which kind of document it is, who it is about, which job, and when.
5. File it.

Two things to know:

- **Records will say the person who uploaded it filed it**, not the
  superintendent who wrote it. That is true as far as it goes, and the
  form itself carries their signature. If it matters, put their name in
  the note field.
- **It cannot be undone.** Check the photo is readable first.

**HR can file all six kinds of document.** Owners can too. A project
manager can file incidents, medical events and uncontrolled events.
Everybody else can file JSAs only.

---

## 9. When somebody leaves

**Do not try to delete their account. It will not work, and that is on
purpose.**

Every filed document records the person who submitted it. The filing
cabinet refuses to remove anybody while a record still carries their name
— a signed JSA can never end up with no author. It is the same promise as
"a filed record cannot be edited", protected the same way.

Do this instead:

1. **Change their password** — section 7, "If somebody is locked out".
   They are out immediately.
2. **Set their role to "Not assigned yet"** in Settings › People, which
   drops them to their own documents only.

Their account stays, because their name has to. The only thing a deletion
would actually take is their own saved templates and settings — personal
convenience, not records.

---

## 10. Changing the app, or adding to it

**You do not need to hire anybody to make changes.** This entire app was
built by somebody who was not a programmer, working with an AI assistant
called Claude. That is still how you change it.

### The setup, once

1. Get the project folder onto a computer. It lives on GitHub under the
   `schsafety` account.
2. Open Claude Code in that folder.
3. That is the whole setup. **There is a file in there called `CLAUDE.md`
   that Claude reads by itself** — the history of the project, the rules,
   and every mistake anybody has already made. You never have to explain
   this app to Claude, and you never have to read that file yourself.

### The honest part about working this way

**Claude will not get it right the first time.** Sometimes not the third.
That is normal, and it is not a sign it is going badly.

What made this app work was going back and forth: describe the problem in
ordinary words, look at what comes back, say plainly what is wrong, go
again. Not technical knowledge — **persistence, and being clear about what
is actually wrong.**

You do not need to know the right words for things. *"The names are cut
off at the bottom of the printed page"* is a perfectly good description of
a problem, and a better one than most.

### Say these four things every single time

Whatever you are asking for, include all four. They are the difference
between a change that works and one that quietly breaks something else.

1. **"Read CLAUDE.md and HANDOVER.md first."**
2. **"Do not change anything about printing or the PDFs unless that is
   specifically what I am asking for."**
3. **"Run `npm run check` when you are done and tell me the result."**
4. **"Show me screenshots of the actual app before and after."**

The fourth matters most. This app's printed forms have come out wrong
before while looking perfect on the screen. **Never accept "it should
work" — ask to see it.**

### Things you can copy and paste

**To understand something before changing it:**

> Read CLAUDE.md and HANDOVER.md. Then explain to me, in plain English
> with no technical jargon, how [the thing] currently works and what would
> have to change to [what you want]. Do not change anything yet — I want
> to understand first.

**For a small change — some wording, a field, a label:**

> Read CLAUDE.md and HANDOVER.md first. I want to [describe it in your own
> words]. Make the smallest change that does this. Do not touch printing
> or PDF code. When you are done, run `npm run check`, show me
> before-and-after screenshots of the real app, and tell me anything you
> were unsure about.

**To add a whole new form — the big one:**

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

You do not need to understand that middle paragraph. Claude does. **Paste
it anyway** — it is the single most expensive mistake available here, and
it costs an afternoon to find.

**When something looks wrong:**

> Read CLAUDE.md first. [Describe what you are seeing.] Find out why
> before changing anything, and show me what you found. If it is a
> printing or PDF problem, generate a real PDF and look at the actual
> image inside it — do not judge it from the preview on screen.

---

## 11. Six rules nobody should break

Every one came from a real problem or a legal requirement. These are the
ones most likely to get tidied away by somebody who does not know why they
are there — including an AI trying to be helpful.

**1. Never let anything invent safety wording.**
The hazards, controls and task descriptions in this app end up on a signed
legal document. Do not let Claude write them. Do not let anybody pad the
lists with reasonable-sounding entries. When new wording is needed it
comes from actual regulations, and a qualified safety person approves it
line by line. *This is the most important rule on this page.*

**2. What the employee wrote, the employer cannot change.**
An employee's own statement, signature and date lock the moment they are
given. That is a legal requirement, and it applies to any new form
anybody adds later.

**3. Filed documents can never be edited or deleted.**
If somebody asks for an "edit a filed record" button, that is a legal
conversation, not a software request.

**4. The crew sign-in never records names.**
It is numbered only — person 1, person 2, person 43. It was built for a
hundred people signing a few seconds each. Every design anybody ever drew for
this app got that wrong and showed a list of names to tap. If somebody
proposes that, they have not understood how a tailgate meeting works.

**5. Filling in and printing a form must never require a login.**
Crews work where there is no signal.

**6. Write about people neutrally.**
No "he" or "him" in anything a person reads — use "they", or speak to them
directly. Simple professionalism: not everybody is a he.

---

## 12. Things that were planned but never built

Not loose ideas. These were thought through and decided, and then time ran
out. They are written down here because they existed nowhere else.

**Equipment inspection checklists.** The intended next piece. It would be
part of this same app, not a separate program to buy. An operator scans a
QR sticker on the machine and fills in the checklist — no login, no
account, nothing to install, exactly like crew sign-in works today. Those
checklists land in Records, where only management can browse them.

**Sharing templates between people.** A company shelf: safety or the
office posts a template and everybody pulls their own copy. Not people
sending templates to each other.

**Two things that are blocked.** The app cannot send email — that is not a
bug, it needs a company internet record nobody ever set up, and any
notification feature starts there. And starting a form on one device and
finishing it on another needs somebody to decide what happens when both
have been changed; guessing wrong loses somebody's morning of work.

**Letting HR add accounts from inside the app** was built and deliberately
not kept. It would have meant a piece of machinery that can create logins,
running on a server nobody is maintaining. The steps in section 7 do the
same job with nothing to go wrong.

---

## 13. Checking that nothing is broken

The app can test itself. Ask Claude to run this, or type it:

```
npm run check
```

It runs **22 tests, each named after what would go wrong** rather than
some technical label — things like *"the last thing you typed is not lost
when you leave"* and *"the employer cannot change what the employee wrote
or signed."* You can read the results without knowing any code.

**All 22 were passing on 22 September 2026. If it ever says anything other
than all clear, do not put that change live.**

Two things worth knowing:

- **A test passing is not always proof.** Some old tests here kept
  "passing" while checking a screen that had been deleted — asking a
  question about something that was not there and getting the right answer
  by accident. If a change feels risky, look at the real app.
- **A test that always fails is worse than no test.** People start
  ignoring the red, and then they ignore a real one.

**Putting a change live** means sending it to GitHub, which rebuilds the
website by itself. There is no second approval step and no safety net
beyond those tests — so run them first, every time.

---

## 14. When something goes wrong

| What you see | What it probably is | What to do |
| --- | --- | --- |
| A printed form looks wrong | The most fragile part of the app | Get the actual PDF they printed. **Do not trust the preview** — it has looked right while the print was wrong. |
| The website will not load at all | The last change broke it | Ask Claude: *"the site is down, find the last change that went live and tell me if it can be undone."* |
| Somebody cannot sign in | An account problem, not an app problem | Set them a new password — section 7. |
| A brand new person cannot sign in | "Auto Confirm User" was left switched off | Section 7, step 6. Setting them a new password clears it. |
| Somebody wants a filed record deleted | The app cannot do this, by design | A legal conversation, not a software task. |
| It works on a computer but not an iPad | iPads genuinely behave differently here | Say so explicitly when asking for the fix. It has caught this project out repeatedly. |

---

## 15. When to get an actual programmer

Claude can handle most of what this app will ever need. Get a real
developer for:

- **Anything to do with the printed forms or PDFs.** This has broken more
  times than everything else put together, and the failures are sneaky —
  it looks perfect on screen and comes out wrong on paper.
- **Anything about who is allowed to see what.** Getting it wrong could
  show a disciplinary notice to the wrong person.
- **Deciding whether to keep this app at all.** If the company ever
  considers replacing it, that is a business decision worth an expert
  opinion.

---

## 16. The accounts that hold all of this

Three things sit behind the app. They are all on company email and the
company card — nothing is tied to anybody's personal account.

**One login opens everything.** There is a single GitHub account,
**`schsafety`**, on a company email address, opened with an ordinary
password. No codes, no second device.

That one account gets you both of the things this app runs on:

1. **GitHub** — the app's instructions, and the website built from them.
2. **Supabase** — the filing cabinet. **It has no separate password of its
   own.** You open it by clicking *"Sign in with GitHub"*. So the GitHub
   login is also the filing cabinet login.

Because it sits on a company mailbox, the company can always get it back
without anybody's help: reset the email password, then reset the GitHub
password from that mailbox.

**Whoever holds the `schsafety` login holds this entire app. Treat it
accordingly.**

There is also a **service key** inside Supabase — a master key for the
filing cabinet, deliberately not written down anywhere in the app. Treat
it like a safe combination. Normal work never needs it.

### The one thing worth doing

**Make sure more than one person at the company has the `schsafety`
password**, and that somebody has signed in with it at least once. It
opens the app's instructions, the website and every record together. It
should not live with one person.

---

## 17. Words you will run into

| Word | What it actually means |
| --- | --- |
| **Supabase** | The filing cabinet. A company that stores this app's records and accounts. |
| **The dashboard** | Supabase's own website, where accounts get created. |
| **GitHub** | Where the app's instructions are kept, so they are not on one person's laptop. |
| **Repository, or repo** | The project folder, with a record of every change ever made to it. |
| **Deploy, or push live** | Making a change appear on the real website. |
| **Build** | Packaging the app so a browser can run it. "The build failed" means the website cannot update. |
| **Commit** | One saved change, with a note explaining why it was made. |
| **Migration** | A change to how the filing cabinet is organised, written down so it can be repeated. |

---

## 18. Where the real answers are

**Every single change ever made to this app has a written explanation
attached to it** — not what changed, but *why*. There is no ticket system
and no design documents, so that history is the real record of this
project.

If something looks strange or wrong, ask Claude:

> Look through the project history and find out why [the odd thing] is the
> way it is. Explain what you find in plain English.

A surprising amount of the odd-looking stuff is there because something
went wrong once, and that was the fix.
