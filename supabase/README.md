# The plans for the document archive

This folder is the written record of how the cloud filing cabinet is built.

The app itself — everything a superintendent or foreman fills out — does not
need any of this. It runs on the device, works with no signal, and does not
care whether this folder exists. **The only part of the app that uses the
cloud is the Archive**, where finished documents get filed and looked up.

## What's in here

`migrations/` holds the instructions that built the archive, in the order
they were run. Each file was applied once and never changed afterward. Read
together, they describe the whole thing: what gets stored, and who is allowed
to see what.

If the cloud account were ever wiped, or somebody new took this over, these
files are how it gets rebuilt exactly as it was. Without them there'd be a
locked filing cabinet and no idea how it was put together.

## The rules, in plain words

- Anybody signed in can **file** a document. It gets stamped with their name.
- A superintendent or foreman **sees only the documents they filed.**
- **Safety and HR see everything.**
- **Nobody can edit or delete a filed document** — not a super, not HR, not
  Safety. This is not a hidden button; the cloud database itself refuses.
  Badly worded reports get fixed in the normal review chain *before* they're
  filed, not in the archive afterward.
- Every document is stored twice: the **data** (which makes it searchable by
  employee, job site and date) and the **PDF** that was actually printed and
  signed. The PDF is the real record — re-creating a document years later
  from its data isn't guaranteed to match what somebody actually signed.

## Where it lives

Supabase project **"SCH Safety App"**, in the **Shackelford Safety**
organization. Whoever runs this needs access to that account — it holds the
billing and the master keys. The plan needs to stay paid; on the free plan
the whole thing goes to sleep after about a week of nobody filing anything,
and then the next upload fails.

## A note on the key in the app's code

`src/archive/ArchiveView.jsx` contains a key in plain text. That is on
purpose and it is safe: it is the *publishable* key, which is built to sit in
a web page where anyone can read it. It only names the project — it opens
nothing. The rules described above are what actually protect the documents.
The dangerous key (the master one) is not in this repository anywhere, and
should never be put here.
