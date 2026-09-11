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

export default function useWaitingCount() {
  const [count, setCount] = useState(0);

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
      setCount(mine.length + (notices || []).length);
    } catch {
      setCount(0);
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

  return { count, refresh };
}
