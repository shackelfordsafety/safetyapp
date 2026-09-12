/* ── "View as" ───────────────────────────────────────────────────────────
   Fonzo, 2026-09-11: "Add a view as to my account so I can view it as a
   PM. I can view it as HR. I can view it as an owner, view it as a super,
   view it as a foreman... that would be really good so that anybody that
   calls me and has a question, I can do that for them."

   He is the entire support desk. When a superintendent rings at 6am asking
   where a button is, the fastest answer is to look at the same screen the
   man is looking at.

   WHAT THIS IS, EXACTLY, AND WHAT IT IS NOT.

   It changes what the app SHOWS -- which buttons appear, which sections
   render, what the My Work count says. It does NOT change what the
   database gives him. Row-level security answers to his real account and
   nothing in a browser can talk it into doing otherwise, which is the
   whole point of enforcing rules there rather than in a screen.

   So "view as foreman" shows him a foreman's screen over his own data. It
   answers "where is the button" and "why can he not see that" perfectly
   well, and it does not answer "what exactly is in HIS list". Said plainly
   in the UI rather than left for somebody to discover.

   Only ever available to an admin account, and only ever NARROWS what is
   offered -- there is no role here that can do more than he already can. */

const KEY = 'sdc.viewAs.v1';

/* Roles, never people. This list named Hunter, Reeves, Pat and Nic until
   2026-09-11 -- Fonzo: "hunter and reeves dont need to be named, no one
   needs to be named". He is right, and not only because it reads cleaner:
   it sits on a settings screen anybody might be looking over his shoulder
   at, the names go stale the day somebody changes job, and what the
   picker is actually for is a ROLE's screen, not a person's. */
export const VIEW_AS_ROLES = [
  { id: '', label: 'Myself', hint: 'Everything. The account above all of it.' },
  { id: 'owner', label: 'See as an owner', hint: 'Sees and files everything' },
  { id: 'hr', label: 'See as HR', hint: 'Approves disciplinary and separation' },
  { id: 'pm', label: 'See as a PM', hint: 'Approves incident, medical and uncontrolled' },
  { id: 'safety', label: 'See as safety', hint: 'Sees everything, approves nothing' },
  { id: 'clerk', label: 'See as a clerk', hint: 'Sees everything, approves nothing' },
  { id: 'superintendent', label: 'See as a superintendent', hint: 'Own documents, plus every disciplinary' },
  { id: 'foreman', label: 'See as a foreman', hint: 'Same as a superintendent' },
  { id: 'field', label: 'See as a field employee', hint: 'Only their own documents' },
];

export function readViewAs() {
  try {
    const v = localStorage.getItem(KEY);
    return VIEW_AS_ROLES.some(r => r.id === v) ? v : '';
  } catch {
    return '';
  }
}

export function writeViewAs(role) {
  try {
    if (!role) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, role);
    return true;
  } catch {
    return false;
  }
}

/* Applied to whoAmI's answer. Non-admins get their real identity back
   untouched no matter what is sitting in localStorage -- the override is a
   convenience for one account, not a way for anybody else to claim a role
   by editing browser storage. It would not get them any data either, but
   a screen that lies about who you are is not something to leave lying
   around. */
export function applyViewAs(me) {
  if (!me || !me.is_admin) return me;
  const pretending = readViewAs();
  if (!pretending || pretending === me.role) return me;
  return { ...me, role: pretending, viewingAs: pretending, realRole: me.role };
}
