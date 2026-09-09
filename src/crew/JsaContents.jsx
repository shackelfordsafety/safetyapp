import { readableColumns } from './board';
import { formatPhone, isDialable, phoneDigits } from '../shared/phone';
import './jsaContents.css';

/* ── The JSA, readable ───────────────────────────────────────────────────
   Shared by the crew sign-in page (a man reading what he is about to sign)
   and the superintendent's board (checking what he actually published).
   One component so the two can never drift into showing different things
   about the same document.

   Laid out plainly and in full rather than behind tabs or an inner
   scrollbar: nested scrolling on a phone hides content from exactly the
   people least likely to go looking for it. */

/* A universal maps link. Google's URL opens the Google Maps app on
   Android, and on iOS opens either the app or the browser -- both get a
   man driving. In an emergency nobody should be retyping a hospital name
   into their phone with one hand. */
function mapsHref(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function MapLine({ label, name, address }) {
  const hasName = String(name || '').trim();
  const hasAddress = String(address || '').trim();
  if (!hasName && !hasAddress) return null;
  return (
    <div className="jsaLine">
      <span>{label}</span>
      <strong>
        {hasName}
        {hasAddress && (
          <a className="jsaMapLink" href={mapsHref(hasAddress)} target="_blank" rel="noopener noreferrer">
            {hasName ? `${hasAddress} — directions` : `${hasAddress} — directions`}
          </a>
        )}
      </strong>
    </div>
  );
}

/* A tappable phone number, shown the way a phone number is written.
   Everything that decides both -- what reads, what dials, and what is left
   alone because we don't understand it -- lives in shared/phone.js, so the
   printed JSA and this screen can never disagree about the same field. */
function PhoneLine({ label, value }) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (!isDialable(text)) return <Line label={label} value={formatPhone(text)} />;
  return (
    <div className="jsaLine">
      <span>{label}</span>
      <strong>
        <a className="jsaTelLink" href={`tel:${phoneDigits(text)}`}>{formatPhone(text)}</a>
      </strong>
    </div>
  );
}

function Line({ label, value }) {
  if (!String(value || '').trim()) return null;
  return <div className="jsaLine"><span>{label}</span><strong>{value}</strong></div>;
}

/* One column of the JSA, listed. Numbered so a man on the phone can say
   "number four" to his foreman and be understood. */
function ListBox({ title, items }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="jsaBox">
      <div className="jsaBoxTitle">{title}</div>
      <ol className="jsaBoxList">
        {items.map((t, i) => <li key={i}>{t}</li>)}
      </ol>
    </div>
  );
}

export default function JsaContents({ jsa, title = 'The JSA' }) {
  if (!jsa) return null;
  const cols = readableColumns(jsa);
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
      <PhoneLine label="Superintendent" value={jsa.siteContactPhone} />
      <PhoneLine label="Emergency" value={jsa.emergencyPhone} />
      <MapLine label="Nearest medical" name={jsa.nearestMedicalFacility} address={jsa.nearestMedicalAddress} />
      <Line label="Muster point" value={jsa.musterPoint} />
      <Line label="Tailgate topic" value={jsa.tailgateTopic} />

      <ListBox title="Today's tasks" items={cols.tasks} />
      <ListBox title="Hazards" items={cols.hazards} />
      <ListBox title="Controls" items={cols.controls} />

      {String(jsa.acknowledgement || '').trim() && (
        <>
          <div className="jsaDocTitle">What you are signing</div>
          <p className="jsaAck">{jsa.acknowledgement}</p>
        </>
      )}
    </div>
  );
}
