import { readableRows } from './board';
import './jsaContents.css';

/* ── The JSA, readable ───────────────────────────────────────────────────
   Shared by the crew sign-in page (a man reading what he is about to sign)
   and the superintendent's board (checking what he actually published).
   One component so the two can never drift into showing different things
   about the same document.

   Laid out plainly and in full rather than behind tabs or an inner
   scrollbar: nested scrolling on a phone hides content from exactly the
   people least likely to go looking for it. */

function Line({ label, value }) {
  if (!String(value || '').trim()) return null;
  return <div className="jsaLine"><span>{label}</span><strong>{value}</strong></div>;
}

export default function JsaContents({ jsa, title = 'The JSA' }) {
  if (!jsa) return null;
  const rows = readableRows(jsa);
  return (
    <div className="jsaDoc">
      <div className="jsaDocTitle">{title}</div>

      <Line label="Area" value={jsa.area} />
      <Line label="Job site" value={jsa.jobSite} />
      <Line label="Location" value={jsa.location} />
      <Line label="Job #" value={jsa.jobNumber} />
      <Line label="Supervisor" value={jsa.superintendentForeman} />
      <Line label="Overall task" value={jsa.overallWorkTask} />
      <Line label="Good from" value={[jsa.timeIssued, jsa.timeExpired].filter(Boolean).join(' to ')} />
      <Line label="Emergency" value={jsa.emergencyPhone} />
      <Line label="Nearest medical" value={jsa.nearestMedicalFacility} />
      <Line label="Muster point" value={jsa.musterPoint} />
      <Line label="Tailgate topic" value={jsa.tailgateTopic} />

      {rows.length > 0 && (
        <>
          <div className="jsaDocTitle">Steps, hazards and controls</div>
          {rows.map((r, i) => (
            <div className="jsaStep" key={i}>
              {r.step && <strong>{r.step}</strong>}
              {r.hazards && <p><span>Hazards</span>{r.hazards}</p>}
              {r.controls && <p><span>Controls</span>{r.controls}</p>}
            </div>
          ))}
        </>
      )}

      {String(jsa.acknowledgement || '').trim() && (
        <>
          <div className="jsaDocTitle">What you are signing</div>
          <p className="jsaAck">{jsa.acknowledgement}</p>
        </>
      )}
    </div>
  );
}
