import { useCallback, useEffect, useState } from 'react';
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

export default function useWaitingCount() {
  const [state, setState] = useState({ count: 0, items: [] });

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
    return () => {
      dead = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', run);
    };
  }, [refresh]);

  return { ...state, refresh };
}
