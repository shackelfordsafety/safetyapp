-- Remove the saved-job list entirely.
--
-- The feature let somebody pick a job instead of retyping its number, and it
-- was kept in two tables: `jobs` (the company list) and `my_jobs` (which of
-- them a given person marked as theirs).
--
-- Why it is going, rather than being left dormant:
--
--   The screen that added and removed jobs lived on Settings, and that card
--   was removed on 2026-09-21. That left a picker nothing could ever be added
--   to -- so the list could only shrink, never grow. By the next morning it
--   held exactly two rows, both created the same day, both with no client and
--   no location, and one of them ('480-20') a transposition typo of the other
--   ('480-02'). A picker whose entire contents are one bare job number is
--   worse than no picker: it is a control that promises a shortcut and does
--   not have one.
--
-- What is NOT affected: job numbers are still typed by hand on the Job Info
-- step, exactly as they always were. That field binds straight to
-- jsa.jobNumber and never went through this table -- the picker only ever
-- filled the same field in. No document, filed or draft, referenced a job
-- row; the only foreign key into `jobs` was from `my_jobs`, and it held zero
-- rows at the time of writing.
--
-- If a job list is ever wanted again, build it fresh rather than reviving
-- this: the thing that killed it was having no way to maintain the list, and
-- that is a product decision to make up front, not a table to restore.

drop table if exists public.my_jobs;
drop table if exists public.jobs;

-- These two guarded the office's ability to maintain the list. With the
-- tables gone they reference nothing, but private.my_role() stays -- it is
-- used by other policies across the schema.
--   "the office maintains jobs" (INSERT on jobs)
--   "the office edits jobs"     (UPDATE on jobs)
-- Both are dropped automatically with their table; named here so the reason
-- they vanished is findable later.
