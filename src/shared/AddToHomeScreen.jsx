import { useEffect, useState } from 'react';

/* ── "Put this on your home screen" ──────────────────────────────────────
   Fonzo, 2026-09-28: "an add to homescreen button would be killer". For
   the crew it answers their one real complaint -- scanning the QR every
   morning; for supers it makes the app open like an app.

   What a website is ALLOWED to do here differs by phone, and pretending
   otherwise would be a button that does nothing:
   - Android / Chrome, on a page with the app manifest: the browser hands
     us a real install prompt (beforeinstallprompt). One tap.
   - iPhone / iPad (Safari): Apple gives websites no way to add themselves.
     The best a button can do is show the three taps. So it does.
   - Android on the crew page: that page deliberately has no manifest (see
     index.html -- iOS would save the wrong address), so no prompt either;
     same three-taps approach, Chrome's version.
   - Already on the home screen, or a desktop: nothing is shown.

   Dismissable, and remembered, so it asks once rather than every visit. */

let deferredPrompt = null;
const listeners = new Set();
if (typeof window !== 'undefined') {
  /* Registered when this module loads, not when the button mounts: Chrome
     fires the event once, early, and a listener added after it has gone
     simply never hears it. */
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    listeners.forEach(fn => fn());
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    listeners.forEach(fn => fn());
  });
}

function isInstalled() {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  } catch { return false; }
}

function platform() {
  const ua = navigator.userAgent || '';
  /* iPadOS reports itself as a Mac; a Mac with a touchscreen is an iPad. */
  if (/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'other';
}

const TEXT = {
  en: {
    title: 'Put this on your home screen',
    body: { crew: 'Open it with one tap tomorrow — no scanning.', home: 'Open the app with one tap, like any other app.' },
    install: 'Add to Home Screen',
    how: 'Show me how',
    notNow: 'Not now',
    ios: ['Tap the Share button (the square with the arrow). On an iPhone it’s at the bottom; on an iPad, top right.', 'Scroll down and tap “Add to Home Screen”.', 'Tap “Add”.'],
    android: ['Tap the ⋮ menu in the top-right corner of Chrome.', 'Tap “Add to Home screen”.', 'Tap “Add”.'],
  },
  es: {
    title: 'Póngalo en su pantalla de inicio',
    body: { crew: 'Mañana lo abre con un toque — sin escanear.', home: 'Abra la aplicación con un toque, como cualquier otra.' },
    install: 'Agregar a inicio',
    how: 'Muéstreme cómo',
    notNow: 'Ahora no',
    ios: ['Toque el botón de Compartir (el cuadrito con la flecha). En iPhone está abajo; en iPad, arriba a la derecha.', 'Baje y toque “Agregar a pantalla de inicio”.', 'Toque “Agregar”.'],
    android: ['Toque el menú ⋮ arriba a la derecha en Chrome.', 'Toque “Agregar a la pantalla principal”.', 'Toque “Agregar”.'],
  },
};

export default function AddToHomeScreen({ lang = 'en', where = 'home' }) {
  const key = `sdc.a2hs.dismissed.${where}`;
  const [, rerender] = useState(0);
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(key) === '1'; } catch { return false; }
  });

  useEffect(() => {
    const fn = () => rerender(n => n + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);

  if (hidden || isInstalled()) return null;
  const os = platform();
  const canPrompt = Boolean(deferredPrompt);
  if (!canPrompt && os === 'other') return null;

  const t = TEXT[lang] || TEXT.en;
  const steps = os === 'ios' ? t.ios : t.android;

  function dismiss() {
    setHidden(true);
    try { localStorage.setItem(key, '1'); } catch { /* private mode */ }
  }

  async function install() {
    if (!deferredPrompt) { setOpen(o => !o); return; }
    const ev = deferredPrompt;
    deferredPrompt = null;
    ev.prompt();
    try {
      const choice = await ev.userChoice;
      if (choice?.outcome === 'accepted') dismiss();
    } catch { /* the browser closed its own dialog */ }
    rerender(n => n + 1);
  }

  return (
    <div className={`a2hs a2hs--${where}`}>
      <div className="a2hsText">
        <strong>{t.title}</strong>
        <span>{t.body[where] || t.body.home}</span>
      </div>
      <div className="a2hsActions">
        <button type="button" className="a2hsGo" onClick={install}>
          {canPrompt ? t.install : t.how}
        </button>
        <button type="button" className="a2hsNo" onClick={dismiss}>{t.notNow}</button>
      </div>
      {open && !canPrompt && (
        <ol className="a2hsSteps">
          {steps.map(s => <li key={s}>{s}</li>)}
        </ol>
      )}
    </div>
  );
}
