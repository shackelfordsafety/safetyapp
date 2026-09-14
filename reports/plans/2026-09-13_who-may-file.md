# Who is allowed to file a document — DECIDED, no change

Asked 2026-09-13 overnight, answered by Fonzo 2026-09-14.

## The decision

> "Safety should only be able to submit their own JSAs, everything else
> requires the PM/HR approval, bc a safety could write up an incident
> report and the PM not like it."

**No change.** The database already does exactly this. The last open
finding from the 2026-09-11 audit is closed as "working as intended",
not as a bug deferred.

## Why the finding was wrong

The audit called it a hole that "safety cannot file ANY non-JSA
document". That reads as though a safety coordinator cannot report an
incident. He can. Filing and submitting are two different gates, and
only one of them is about roles:

| Step | What it means | Who may |
|---|---|---|
| Start / submit (`open_documents`) | Write it and hand it up for sign-off | anyone signed in — the policy only checks `created_by = auth.uid()` |
| File (`documents`) | "This is final, into the archive" | `private.can_file_doc_type` — JSA anyone, incident/medical/uncontrolled pm+hr, disciplinary/separation hr, owner and admin everything |

So the safety coordinator writes the incident report and sends it; it
waits in the PM's queue until the PM signs it off. A report the PM does
not agree with cannot be filed over his head. That is the rule Fonzo
described, and it is the rule that is running.

The proposed "filing follows whoever wrote it" change from the original
draft of this document is **rejected** — it would have let safety file
his own incident report without a PM ever seeing it, which is the exact
thing this is meant to prevent.

## Do not re-open this without

A specific case where somebody is genuinely blocked from doing their
job — not a role matrix that merely looks asymmetric. The asymmetry is
the point.

## One thing still worth knowing

Nobody holds the `pm` role. Two of the six document types list `pm` as
an approver and no such person exists, so incident / medical /
uncontrolled are Pat (`hr`) and the two owners only. Not a bug, but if
the intent is that a PM approves incident reports, somebody has to be
given that role.
