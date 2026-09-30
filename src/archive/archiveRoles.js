/* ── Who may see and file what, as the screen needs to know it ────────────
   The DATABASE is what enforces all of this (row-level security and the
   private.* helper functions). These are copies of those rules for one
   reason only: so a screen can say the right thing, and not offer
   something the database is going to refuse. A mismatch here can never
   leak a document -- at worst a screen says the wrong sentence -- but
   keep them in step with the SQL named beside each one.

   Pure, no imports, so they can be checked in Node. */

/* private.can_see_all_documents()
   (supabase/migrations/20260910200000_owner_role.sql): role in owner,
   safety, hr, pm, clerk. is_admin is NOT part of it -- an admin with a
   field role sees only their own documents, same as the database says. */
const SEES_ALL = ['owner', 'safety', 'hr', 'pm', 'clerk'];

/* private.can_see_all_disciplinary()
   (20260909202000_supers_disciplinary_only.sql). */
const SEES_ALL_DISCIPLINARY = ['superintendent', 'foreman'];

export function seesAllDocuments(profile) {
  return SEES_ALL.includes(profile?.role);
}

export function seesAllDisciplinary(profile) {
  return SEES_ALL_DISCIPLINARY.includes(profile?.role);
}

/* private.can_file_doc_type(kind)
   (20260911050000_reconcile_repo_with_live_database.sql):
     is_admin or owner -> anything
     jsa               -> everyone
     incident, medicalEvent, uncontrolledEvent -> pm, hr
     disciplinary, separation                  -> hr */
export function canFileDocType(profile, kind) {
  if (!kind) return false;
  if (profile?.is_admin) return true;
  const role = profile?.role || 'field';
  if (role === 'owner') return true;
  if (kind === 'jsa') return true;
  if (['incident', 'medicalEvent', 'uncontrolledEvent'].includes(kind)) return role === 'pm' || role === 'hr';
  if (kind === 'disciplinary' || kind === 'separation') return role === 'hr';
  return false;
}

/* Who CAN file a kind, in words, for the message that tells somebody they
   cannot. */
export function whoCanFile(kind) {
  if (kind === 'disciplinary' || kind === 'separation') return 'HR or an owner';
  if (['incident', 'medicalEvent', 'uncontrolledEvent'].includes(kind)) return 'a PM, HR or an owner';
  return 'anybody signed in';
}
