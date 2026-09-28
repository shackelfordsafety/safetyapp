import { useCallback, useState } from 'react';

/* ── The crew page, in English or Spanish ────────────────────────────────
   Fonzo, 2026-09-28: "a possible translate to spanish setting for our
   hispanic brothers and sisters". Started here, on the page a crew member
   actually uses -- scan, read the JSA, sign -- because that is where most
   of the crew touches the app at all.

   WHAT IS TRANSLATED: every word the APP says -- buttons, labels, headings,
   instructions, errors, and the standard acknowledgement.
   WHAT IS NOT: what the superintendent TYPED into the JSA -- the tasks,
   hazards, controls, job site. Those are shown exactly as written. A
   machine translation of "Struck by equipment" that came out wrong is a
   safety problem, not a convenience, and this page works offline-ish in a
   gravel lot with no translation service to call anyway.

   THE ACKNOWLEDGEMENT: the Spanish version is shown so a man can
   understand what he is agreeing to, with the English original right under
   it, because the English is what prints on the company's record. Have a
   fluent Spanish speaker at Shackelford read ES.ackStandard once before
   relying on it -- it was written carefully, but a signature is on it.

   The choice is remembered on the phone. First visit follows the phone's
   own language setting. */

export const STANDARD_ACK_EN = 'I have reviewed and understand the conditions of this JSA and its attached plans and will comply. I will report hazardous conditions or acts identified on this job site to my supervisor and/or Shackelford representative so they can be corrected if necessary. I will conduct a last minute risk assessment before each task and will exercise stop work authority for any unsafe act, condition, or hazard.';

const EN = {
  langName: 'English',
  switchTo: 'Español',
  switchToLabel: 'Ver en español',
  brandAlt: 'Shackelford Construction and Hauling',
  eyebrow: 'Job Safety Analysis',
  listTitle: 'Where are you working?',
  listLead: 'Tap yours to read it. Ask your foreman if you’re not sure.',
  loading: 'Loading…',
  loadError: 'Could not load the board. Check your signal and try again.',
  tryAgain: 'Try again',
  emptyTitle: 'Nothing published yet',
  emptyBody: 'Your superintendent hasn’t put today’s JSA up. Ask them.',
  checkAgain: 'Check again',
  tagOpen: 'Live',
  tagUpcoming: 'Starts soon',
  tagScheduled: 'Scheduled',
  tagClosed: 'Closed',
  starts: t => `starts ${t}`,
  signingOpens: t => `signing opens ${t}`,
  closedAt: t => `Signing closed at ${t}. Ask your superintendent for today’s JSA.`,
  closedNoTime: 'Signing is closed. Ask your superintendent for today’s JSA.',
  revised: v => `Revised — version ${v}`,
  scheduledNote: t => <>Not open yet. You can read it now. Signing opens at <strong>{t}</strong>, 30 minutes before the shift starts.</>,
  closedNote: 'This one’s finished for the day. You can still read it, but it can’t be signed.',
  signButton: 'Sign the JSA',
  yourName: 'Your name',
  namePlaceholder: 'First and last',
  yourSignature: 'Your signature',
  signFirst: 'Sign in the box before you finish.',
  signing: 'Signing…',
  finish: 'Finish',
  notYet: 'Not yet — go back',
  backToList: 'Back to the list',
  signError: 'Could not record your signature. Check your signal and try again.',
  doneTitle: 'You’re signed in',
  seeAgain: 'See the JSA again',
  // JsaContents
  docTitle: 'The JSA',
  area: 'Area',
  jobSite: 'Job site',
  location: 'Location',
  jobNumber: 'Job #',
  supervisor: 'Supervisor',
  overallTask: 'Overall task',
  goodFrom: 'Good from',
  to: 'to',
  superintendent: 'Superintendent',
  emergency: 'Emergency',
  nearestMedical: 'Nearest medical',
  directions: 'directions',
  musterPoint: 'Muster point',
  tailgateTopic: 'Tailgate topic',
  tasks: 'Today’s tasks',
  hazards: 'Hazards',
  controls: 'Controls',
  whatYouSign: 'What you are signing',
  typedAsWritten: null,
  ackStandard: null,
  ackOriginal: null,
};

const ES = {
  langName: 'Español',
  switchTo: 'English',
  switchToLabel: 'View in English',
  brandAlt: 'Shackelford Construction and Hauling',
  eyebrow: 'Análisis de Seguridad del Trabajo (JSA)',
  listTitle: '¿Dónde está trabajando hoy?',
  listLead: 'Toque el suyo para leerlo. Pregúntele a su foreman si no está seguro.',
  loading: 'Cargando…',
  loadError: 'No se pudo cargar. Revise su señal e intente de nuevo.',
  tryAgain: 'Intentar de nuevo',
  emptyTitle: 'Todavía no hay nada publicado',
  emptyBody: 'Su superintendente todavía no ha puesto el JSA de hoy. Pregúntele.',
  checkAgain: 'Revisar de nuevo',
  tagOpen: 'Abierto',
  tagUpcoming: 'Empieza pronto',
  tagScheduled: 'Programado',
  tagClosed: 'Cerrado',
  starts: t => `empieza a las ${t}`,
  signingOpens: t => `se puede firmar desde las ${t}`,
  closedAt: t => `Se cerró para firmar a las ${t}. Pídale a su superintendente el JSA de hoy.`,
  closedNoTime: 'Ya no se puede firmar. Pídale a su superintendente el JSA de hoy.',
  revised: v => `Corregido — versión ${v}`,
  scheduledNote: t => <>Todavía no está abierto. Puede leerlo ahora. Se puede firmar desde las <strong>{t}</strong>, 30 minutos antes de que empiece el turno.</>,
  closedNote: 'Este ya terminó por hoy. Todavía lo puede leer, pero ya no se puede firmar.',
  signButton: 'Firmar el JSA',
  yourName: 'Su nombre',
  namePlaceholder: 'Nombre y apellido',
  yourSignature: 'Su firma',
  signFirst: 'Firme en el cuadro antes de terminar.',
  signing: 'Firmando…',
  finish: 'Terminar',
  notYet: 'Todavía no — regresar',
  backToList: 'Regresar a la lista',
  signError: 'No se pudo guardar su firma. Revise su señal e intente de nuevo.',
  doneTitle: 'Ya firmó',
  seeAgain: 'Ver el JSA otra vez',
  // JsaContents
  docTitle: 'El JSA',
  area: 'Área',
  jobSite: 'Obra',
  location: 'Ubicación',
  jobNumber: 'Trabajo #',
  supervisor: 'Supervisor',
  overallTask: 'Trabajo general',
  goodFrom: 'Válido de',
  to: 'a',
  superintendent: 'Superintendente',
  emergency: 'Emergencia',
  nearestMedical: 'Clínica más cercana',
  directions: 'cómo llegar',
  musterPoint: 'Punto de reunión',
  tailgateTopic: 'Tema de la charla',
  tasks: 'Tareas de hoy',
  hazards: 'Peligros',
  controls: 'Controles',
  whatYouSign: 'Lo que está firmando',
  typedAsWritten: 'Las tareas, peligros y controles se muestran tal como los escribió su supervisor (en inglés). Si no entiende algo, pregúntele antes de firmar.',
  ackStandard: 'He revisado y entiendo las condiciones de este JSA y sus planes adjuntos, y voy a cumplir con ellos. Voy a reportar a mi supervisor y/o al representante de Shackelford cualquier condición o acto peligroso que vea en esta obra, para que se pueda corregir si es necesario. Voy a hacer una evaluación de riesgos de último minuto antes de cada tarea y voy a usar mi autoridad para detener el trabajo ante cualquier acto, condición o peligro inseguro.',
  ackOriginal: 'Texto original en inglés (es el que queda en el registro):',
};

const LANG_KEY = 'sdc.crew.lang.v1';

function initialLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'en' || saved === 'es') return saved;
  } catch { /* private mode */ }
  const nav = (typeof navigator !== 'undefined' && (navigator.language || '')) || '';
  return /^es\b/i.test(nav) ? 'es' : 'en';
}

export function useCrewLang() {
  const [lang, setLangState] = useState(initialLang);
  const setLang = useCallback((next) => {
    setLangState(next);
    try { localStorage.setItem(LANG_KEY, next); } catch { /* private mode */ }
  }, []);
  return { lang, setLang, t: lang === 'es' ? ES : EN };
}

export const CREW_TEXT_EN = EN;
