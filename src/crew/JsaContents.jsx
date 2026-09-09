import { readableColumns } from './board';
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

/* A tappable phone number. Every device that can open this page is a
   phone, so a printed number a man has to memorise and retype is a number
   he gets wrong at the worst possible moment.

   Only ONE number gets linked, though. These fields are free text and
   supers really do write "911 / 601-555-0199" in them -- stripping the
   punctuation out of that gives 13 digits of nonsense, and a tap-to-call
   that dials nonsense in an emergency is worse than no link at all. So
   anything that isn't a single plausible number stays plain printed text.

   Three digits counts, and it is the most important case here: real JSAs
   have "911" sitting in the emergency field on its own, and that is the
   one number on this whole page that has to be one tap away. An earlier
   version of this rule allowed only 7, 10 and 11 digits and quietly
   refused to link 911 -- caught on Fonzo's own live JSA, not in a
   fixture. */
const DIALABLE_LENGTHS = [3, 7, 10, 11];

function PhoneLine({ label, value }) {
  const text = String(value || '').trim();
  if (!text) return null;
  const dialable = text.replace(/[^\d+]/g, '');
  const digitCount = dialable.replace(/\D/g, '').length;
  if (!DIALABLE_LENGTHS.includes(digitCount)) {
    return <Line label={label} value={text} />;
  }
  return (
    <div className="jsaLine">
      <span>{label}</span>
      <strong><a className="jsaTelLink" href={`tel:${dialable}`}>{text}</a></strong>
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
