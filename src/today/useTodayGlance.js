import { useCallback, useEffect, useState } from 'react';
import { loadModule } from '../shared/loadModule';

/* ── What is actually happening today ────────────────────────────────────
   Fonzo, 2026-09-13: "home should be, like, everything that's been
   submitted... a dashboard of what's been submitted, what's open for the
   day, and all that."

   He was right that Home and My Work were doing each other's jobs, though
   not quite in the way he first described. Home listed "Not finished" and
   My Work listed "Saved Drafts" -- the same set of documents, rendered
   twice, on two screens. Meanwhile the thing Home never mentioned at all
   was the board: a JSA can be up, live, with half the crew signed, and the
   first screen of the app said nothing about it.

   So Home keeps the six start tiles -- the 6am JSA stays one tap away,
   which is how SafetyCulture and Raken lay out their field apps too -- and
   gains the counts. My Work keeps the lists. A number on Home, the rows
   behind it in My Work.

   This only fetches the counts. Everything it reads, My Work already shows
   in full, so nothing here is the only copy of anything.

   Never throws and never blocks, exactly like useWaitingCount: signed out,
   no signal, no account, the answer is "nothing to report" and the app
   carries on. That is the normal state for a superintendent in a dead
   zone, not an error. */

const EMPTY = { ready: false, signedIn: false, outForSigning: [], filedToday: 0 };

export default function useTodayGlance() {
  const [state, setState] = useState(EMPTY);

  const refresh = useCallback(async () => {
    try {
      const archive = await loadModule(() => import('../archive/fileToArchive'));
      if (!archive) return;

      /* Returns null rather than throwing when nobody is signed in, which
         is the cheapest possible way to ask "is the office half of this
         app available to me right now". */
      const filed = await archive.fetchFiledToday();
      if (filed === null) { setState({ ...EMPTY, ready: true }); return; }

      const board = await loadModule(() => import('../crew/board'));
      let rows = [];
      if (board) {
        /* A board is per-account. Somebody with an office role and no
           board of their own is not an error -- they just have nothing
           out for signing. */
        try { ({ rows } = await board.fetchMyBoard()); } catch { rows = []; }
      }

      const live = (rows || []).filter(r => r.live).map(r => ({
        id: r.id,
        label: board ? board.boardLabel(r.data || r) : 'Job Safety Analysis',
        signed: r.signed || 0,
        /* How many lines the sheet was built for. Shown only when the JSA
           actually carries a number -- "14 signed" is honest, "14 of 0" is
           not. */
        expected: Number(r.data?.signatureLineCount) || 0,
      }));

      setState({ ready: true, signedIn: true, outForSigning: live, filedToday: filed.length });
    } catch {
      /* Deliberately silent. Home must render with or without this. */
      setState(prev => ({ ...prev, ready: true }));
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { ...state, refresh };
}
