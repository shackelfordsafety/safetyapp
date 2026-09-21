# Retired check scripts

Scripts in here are **not run by anything**. `npm run check` has its own named
list, and `npm run check:all` reads `tools/testing/` without recursing, so a
file moved into this folder leaves both.

They are kept rather than deleted because each one is a readable record of what
a change was actually supposed to do, and the commit that retired it says why.
That history is worth more than the disk space. Nothing in here should be
"fixed" — if the behaviour matters again, write a new check for how the app
works now.

## Why a script lands here

Most of these were headed `THROWAWAY verification script` by the person who
wrote them. They proved one change on the day it shipped and were never meant
to be permanent. A script belongs here once the screen it drives is gone —
**not** when it is merely out of date.

The difference matters, and the two get confused:

- **A renamed button is a bug in the script.** Fix the string. The screen still
  exists and somebody still wants it covered.
- **A deleted screen is the end of the script.** No string fixes it, and
  rewriting it to drive whatever replaced the screen is a new check with a new
  name, not a repair.

The failure mode this folder exists to prevent is the middle ground: a check
left in the list that goes red every run for a reason nobody remembers. People
learn to skim past red, and then a real failure gets skimmed past too. A check
that cannot pass is worse than no check.

Worth knowing: a dead check does not always go red. Some of these kept
**passing** against screens that were not on the page at all — an assertion
like `count() === 0` is perfectly true when the thing being counted was
deleted. Green is not proof a check is still doing its job.

## What is in here

| Script | Retired | Why |
| --- | --- | --- |
| `verify-jsa-review-reorder.mjs` | 2026-09-21 | Asserted the JSA's 6-step nav — `Job Info / Meeting Info / Tasks / Hazards / Review / Signatures / Finish & Export`. `STEPS` in `main.jsx` is four steps now (`job / meeting / work / finish`); the separate Review and Signatures steps are gone, which was this script's entire subject. |
| `verify-kiosk-flow-overhaul.mjs` | 2026-09-21 | Same deleted Signatures step, plus it asserted that "Done Signing" sets `signatureLineCount` to 20. That write was removed in the same commit that retired this — `signInLineTotal()` has ignored the number since the 2026-09-11 "boxes should only populate how many people signed" change, so the script was testing a promise the printed sheet could not keep. |
