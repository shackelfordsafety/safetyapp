/* Filing a document is office work, and a stranger was being offered the
   door -- then correctly refused by the function's own first line.

   Found stress-testing 2026-09-12. Both functions answered an anonymous
   caller with "Not signed in." rather than "no such function", which is a
   live endpoint confirming to anybody asking that it exists.

   THE TRAP, worth writing down: revoking from `anon` alone did nothing.
   Postgres grants EXECUTE on every new function to PUBLIC, and anon
   inherits that. The grant list still read `=X/postgres` afterwards --
   that leading empty grantee IS PUBLIC. So the revoke has to name PUBLIC,
   and then the roles that ARE allowed have to be granted back explicitly.

   Verified by calling both as a stranger: "permission denied for
   function", not "Not signed in."

   board_for and publication_is_open keep their anon grant on purpose: a
   crew member scanning the QR on the trailer has no account, and those
   two are how he reads the JSA and signs it. Re-checked after this
   change -- the board still answers an anonymous reader. */
revoke execute on function public.file_reviewed_document(uuid) from anon;
revoke execute on function public.link_edits_to_filed(uuid, uuid) from anon;

revoke execute on function public.file_reviewed_document(uuid) from public;
revoke execute on function public.link_edits_to_filed(uuid, uuid) from public;

grant execute on function public.file_reviewed_document(uuid) to authenticated, service_role;
grant execute on function public.link_edits_to_filed(uuid, uuid) to authenticated, service_role;
