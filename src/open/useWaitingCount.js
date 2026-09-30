import { useCallback, useEffect, useRef, useState } from 'react';
import { loadModule } from '../shared/loadModule';

/* ── How many things are waiting on you ──────────────────────────────────
   The gap Fonzo kept running into all day: the review queue worked, and
   nobody knew anything was in it. Pat only found out about a separation
   form because he rang her. A queue you have to remember to go and look at
   is not a workflow, it is a filing cabinet.

   No email yet -- that is still stuck behind DNS -- so this is the honest
   version: a count on the My Work button, visible from every screen the
   moment the app is open.

   Counts two things, because they are the two things that are actually
   somebody's move:
     a document submitted for sign-off that THIS person can approve
     a change an approver made to THIS person's document, not yet seen

   Deliberately quiet about everything else. A count that includes things
   you cannot act on is a count people learn to ignore.

   Never throws and never blocks. Signed out, no signal, no account -- the
   answer is zero and the app carries on, because every one of those is the
   normal state for a superintendent building a JSA in a dead zone. */

const APPROVERS = {
  incident: ['pm', 'hr', 'owner'],
  medicalEvent: ['pm', 'hr', 'owner'],
  uncontrolledEvent: ['pm', 'hr', 'owner'],
  disciplinary: ['hr', 'owner'],
  separation: ['hr', 'owner'],
};

/* Long enough to know what it is, short enough to fit on one line of a
   phone. "Incident Report" is what OpenDocsView calls it, so the words a
   man reads on Home are the words he finds when he taps through. */
const DOC_LABELS = {
  jsa: 'JSA',
  incident: 'Incident Report',
  disciplinary: 'Disciplinary Notice',
  separation: 'Employee Separation',
  medicalEvent: 'Medical Event',
  uncontrolledEvent: 'Uncontrolled Event',
};

function label(kind) {
  return DOC_LABELS[kind] || 'Document';
}

/* ── Desktop alerts (opt-in) ─────────────────────────────────────────────
   HR, 2026-09-30: "is there a way for it to notify me when someone
   submits a doc?" Email needs a mail service and DNS nobody has set up.
   What CAN be done in the browser: once somebody switches alerts on for
   this computer (Settings), the app checks every two minutes while it is
   open in a tab -- even in the background -- and shows a normal Windows /
   Mac notification when something NEW lands on them. Nothing happens on a
   device where alerts were never switched on, so the iPads keep the
   no-timer, save-the-battery behaviour described below. */
const ALERT_POLL_MS = 2 * 60 * 1000;

export function alertsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}
export function alertsOn() {
  return alertsSupported() && window.Notification.permission === 'granted';
}
export async function turnAlertsOn() {
  if (!alertsSupported()) return 'unsupported';
  try { return await window.Notification.requestPermission(); } catch { return 'denied'; }
}

function announce(fresh) {
  if (!alertsOn() || !fresh.length) return;
  const first = fresh[0];
  const what = [first.type, first.title].filter(Boolean).join(' — ');
  const title = fresh.length === 1
    ? (first.kind === 'change' ? 'Somebody changed your document' : 'A document is waiting on you')
    : `${fresh.length} documents are waiting on you`;
  const body = fresh.length === 1
    ? `${what}${first.from ? ` from ${first.from}` : ''}`
    : fresh.map(i => i.type).join(', ');
  try {
    const n = new window.Notification(title, { body, tag: 'sdc-waiting', icon: './icons/apple-touch-icon.png' });
    n.onclick = () => { try { window.focus(); n.close(); } catch { /* ignore */ } };
  } catch { /* some browsers only allow notifications from a service worker; skip */ }
}

export default function useWaitingCount() {
  const [state, setState] = useState({ count: 0, items: [] });
  // Keys already seen, so an alert fires for NEW items only. Null until
  // the first successful check -- what is waiting at start-up is already
  // on screen as the badge and is not "news".
  const seenRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const mod = await loadModule(() => import('./openDocs'));
      if (!mod) return;
      const [me, rows, notices] = await Promise.all([
        mod.whoAmI(),
        mod.listOpenDocuments(),
        mod.myUnacknowledgedChanges(),
      ]);
      const mine = (rows || []).filter((r) => {
        if (r.state === 'submitted') {
          return (APPROVERS[r.doc_type] || []).includes(me?.role) || me?.is_admin;
        }
        return r.state === 'open' && r.assigned_to === me?.id;
      });

      /* The same set the count has always covered, now carrying enough to
         say WHICH document and WHO it came from. The count is unchanged --
         the badges on the nav read this too, and a badge that disagrees
         with the list under it is worse than no list.

         Named by the person on it where there is one, because that is how
         Pat thinks of a separation form -- it is "Kameron's", not
         "separation #4". A JSA has no person, so it falls back to the job
         site. */
      const items = [
        ...mine.map((r) => ({
          key: `doc:${r.id}`,
          kind: r.state === 'submitted' ? 'signoff' : 'yours',
          type: label(r.doc_type),
          title: r.employee_name || r.job_site || null,
          from: r.state === 'submitted'
            ? (r.submittedByName || r.createdByName || null)
            : (r.updatedByName || r.createdByName || null),
          at: r.state === 'submitted' ? (r.submitted_at || r.updated_at) : r.updated_at,
        })),
        ...(notices || []).map((n) => ({
          key: `edit:${n.id}`,
          kind: 'change',
          type: label(n.doc_type),
          title: null,
          from: n.editedByName || null,
          at: n.edited_at,
        })),
      ].sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));

      setState({ count: mine.length + (notices || []).length, items });
      const keys = new Set(items.map(i => i.key));
      if (seenRef.current) announce(items.filter(i => !seenRef.current.has(i.key)));
      seenRef.current = keys;
    } catch {
      setState({ count: 0, items: [] });
    }
  }, []);

  useEffect(() => {
    let dead = false;
    const run = () => { if (!dead) refresh(); };
    run();

    /* Checked when the app is brought back to the front rather than on a
       timer. A superintendent's iPad sits locked in a truck for hours; a
       poll would spend his battery to learn nothing, and the moment that
       actually matters is the moment he picks it up. */
    const onVisible = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', run);
    // Only for somebody who switched desktop alerts on -- see ALERT_POLL_MS.
    const poll = setInterval(() => { if (alertsOn()) run(); }, ALERT_POLL_MS);
    return () => {
      dead = true;
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', run);
    };
  }, [refresh]);

  return { ...state, refresh };
}
