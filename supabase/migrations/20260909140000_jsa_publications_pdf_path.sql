-- The JSA as published, stored as a real PDF beside the board row.
--
-- "See the JSA" could only ever show a readable summary, because
-- publishing stored the JSA's data and nothing else. Fonzo, 2026-09-09:
-- "i need the actual PDF to pop up when tapping to see."
--
-- The file goes into the documents bucket under the publisher's own
-- folder, which the existing storage policy already permits -- no new
-- access is granted here. The crew sign-in page deliberately does NOT use
-- it: a phone in a gravel lot is better served by the readable view, and
-- handing anonymous visitors a stored file would be a real change to who
-- can read what.
alter table public.jsa_publications
  add column if not exists pdf_path text;

comment on column public.jsa_publications.pdf_path is
  'Storage path of the JSA as published, in the documents bucket under the publisher''s own folder. Null for publications made before this existed, and for any publish where the PDF could not be generated -- the board still works, callers fall back to the readable view.';
