# Who is allowed to file a document — one decision, then one migration

Written overnight 2026-09-13. **Nothing has been changed.** This is the
last open finding from the 2026-09-11 database audit, written up so it
takes about a minute to rule on.

## The one sentence

The database asks one question — "may you file this?" — where the company
has two: *may you fill this in* and *may you say it is final*. Because
those got answered together, the safety coordinator cannot file his own
incident report.

## What is true right now

`private.can_file_doc_type` allows, in this order:

| Who | May file |
|---|---|
| `is_admin` (one account: yours) | everything |
| `owner` (2 people) | everything |
| anyone at all | JSA |
| `pm` (**nobody holds this role**) + `hr` (1 person) | incident, medical, uncontrolled |
| `hr` (1 person) | disciplinary, separation |
| `safety`, `clerk`, `foreman`, `field` | **JSA only** |

Read that bottom row again. `safety` is your role. You can file things
today only because your account carries the admin flag, and that flag is
the one thing that goes to HR with the logins when you leave. The day
after the handover, the safety coordinator's account can file a JSA and
nothing else.

This is masked right now — `ARCHIVE_FILING_ENABLED` is `false`, so nobody
files anything but a JSA yet. It bites the moment that flag flips.

## Why it is wrong, plainly

Filing is not approval. Filing is "this paperwork is done, put it in the
cabinet." Approval is "I am the one who says this is final." The audit
found the code treating them as the same question, which means the only
way to let somebody file a form is to also let them sign it off.

The two are already separate in the app — `SendForReviewButton` and
`ApproveAndFileButton` are different buttons — and separate in your head.
They are one line in the database.

## What I would change (your call)

Split the question in two. **Who approves stays exactly as it is** — the
rule you set yourself, that a safety coordinator does not get to decide a
report is final, does not move. What changes is that filing follows the
document instead of the role:

> You may file a document if you created it, or if you are allowed to
> approve that kind of document.

| Kind | Approves it (unchanged) | Could also file it (new) |
|---|---|---|
| JSA | — | anyone, unchanged |
| Incident, Medical, Uncontrolled | pm, hr, owner | whoever wrote it |
| Disciplinary, Separation | hr, owner | whoever wrote it |

Effect: the safety coordinator files his own incident report. He still
cannot file Nic's, and he still cannot approve anyone's. Clerk — the role
that exists because the clerks type the paperwork up — gets the same.

## The thing to decide

**Should filing follow who wrote it?** Yes or no is enough.

- **Yes** → I write one migration, the matrix above, done in a sitting.
- **No** → tell me which roles should file which kinds and I will write
  that instead.
- **Third option worth naming:** leave it alone entirely. It costs
  nothing today and it only matters when `ARCHIVE_FILING_ENABLED` goes
  true. If that flag is not flipping before the handover, this can wait.

## The migration, ready to go

Not applied, and deliberately not saved under `supabase/migrations/` so
nothing can push it by accident. Say the word and it moves there.

```sql
-- Filing is "the paperwork is done", not "I say this is final".
create or replace function private.can_file_doc_type(kind text)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select case
    when exists (select 1 from public.profiles where id = auth.uid() and is_admin) then true
    when private.my_role() = 'owner' then true
    when kind = 'jsa' then true
    when kind in ('incident', 'medicalEvent', 'uncontrolledEvent')
      then private.my_role() in ('pm', 'hr')
    when kind in ('disciplinary', 'separation')
      then private.my_role() = 'hr'
    else false
  end;
$$;
-- ^ unchanged: this stays as the APPROVER test, renamed can_approve_doc_type.
-- The filing policy on public.documents then reads:
--     submitted_by = auth.uid()
--     and (created the document, or private.can_approve_doc_type(doc_type))
-- with "created the document" proven against open_documents.created_by
-- rather than taken on the client's word.
```

Note the last two lines — this is the part worth doing carefully rather
than quickly. "Whoever wrote it" has to be proven from a row the database
already holds, not from something the app sends up, or it is not a rule.

## One more thing the audit did not say

Nobody holds the `pm` role. Two of the six document types list `pm` as an
approver and no such person exists, so those three kinds are Pat and the
two owners only. Not a bug — just worth knowing that `pm` is currently a
rule about nobody.
