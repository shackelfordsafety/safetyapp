import { db } from '../archive/archiveClient';
import { blockInDemo } from '../shared/demoMode';

/* ── Handing the employee's part to the employee's own phone ─────────────
   Management fills in their side, then asks for one QR code that carries
   everything the employee owes: his statement, his signature, and the
   notice itself so he can read what he is signing.

   Imported ONLY from lazily loaded code, like everything that talks to the
   cloud, so building a document stays login-free and offline. */

/* The secret in the QR. 32 bytes of real randomness -- not derived from the
   document, the employee, or the account, because anything derived from
   those can be worked out by somebody who knows them. base64url so it
   survives being a URL and a QR without escaping. */
function newToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let s = '';
  bytes.forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function employeeUrlFor(token) {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#/me/${token}`;
}

/* A SNAPSHOT of the document goes up, not a live link to the draft. What he
   signs has to be what was in front of him, and it must not change while he
   is reading it. */
export async function createHandoff({ docType, model, employeeName, needs }) {
  blockInDemo('Sending a document to an employee');
  const { data: userData } = await db.auth.getUser();
  const user = userData?.user;
  if (!user) throw new Error('Sign in to send this to an employee.');

  const { data: prof } = await db
    .from('profiles').select('full_name').eq('id', user.id).maybeSingle();

  const token = newToken();
  const { error } = await db.from('employee_requests').insert({
    token,
    doc_type: docType,
    requested_by: user.id,
    requested_by_name: prof?.full_name || null,
    employee_name: employeeName || null,
    document: model,
    needs: needs && needs.length ? needs : ['statement', 'signature'],
  });
  if (error) throw new Error(error.message);
  return { token, url: employeeUrlFor(token) };
}

/* Has he sent it back yet? Returns null while nothing has come back, so a
   caller can poll without having to tell "not yet" apart from "failed". */
export async function checkHandoff(token) {
  const { data, error } = await db
    .from('employee_requests')
    .select('statement, signature_data, responded_at, expires_at')
    .eq('token', token)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  if (!data.responded_at) {
    return { waiting: true, expired: new Date(data.expires_at) <= new Date() };
  }
  return {
    waiting: false,
    statement: data.statement || '',
    signatureData: data.signature_data || null,
    respondedAt: data.responded_at,
  };
}

/* Called off before he answers -- he walked out, or it is being done on
   paper after all. Refused by the database once he HAS answered: at that
   point it is a record of what he did, not a pending request. */
export async function cancelHandoff(token) {
  blockInDemo('Cancelling an employee request');
  const { error } = await db.from('employee_requests').delete().eq('token', token);
  if (error) throw new Error(error.message);
}
