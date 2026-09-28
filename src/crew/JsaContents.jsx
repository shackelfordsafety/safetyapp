import { readableColumns } from './board';
import { formatPhone, isDialable, phoneDigits } from '../shared/phone';
import './jsaContents.css';
import { CREW_TEXT_EN, STANDARD_ACK_EN } from './crewText';

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

function MapLine({ label, name, address, directions = 'directions' }) {
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
            {`${hasAddress} — ${directions}`}
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

/* `t` is the crew page's words (crewText.jsx) -- English unless the crew
   member picked Español. Everything the superintendent TYPED is shown as
   written, in whatever language he wrote it; only the app's own labels
   change. */
export default function JsaContents({ jsa, title, t = CREW_TEXT_EN }) {
  if (!jsa) return null;
  const cols = readableColumns(jsa);
  const ack = String(jsa.acknowledgement || '').trim();
  /* The Spanish acknowledgement is only shown for the company's standard
     wording -- a translation of text somebody edited would be a guess. */
  const ackIsStandard = ack.replace(/\s+/g, ' ') === STANDARD_ACK_EN;
  return (
    <div className="jsaDoc">
      <div className="jsaDocTitle">{title || t.docTitle}</div>

      <Line label={t.area} value={jsa.area} />
      <Line label={t.jobSite} value={jsa.jobSite} />
      <Line label={t.location} value={jsa.location} />
      <Line label={t.jobNumber} value={jsa.jobNumber} />
      <Line label={t.supervisor} value={jsa.superintendentForeman} />
      <Line label={t.overallTask} value={jsa.overallWorkTask} />
      <Line label={t.goodFrom} value={[jsa.timeIssued, jsa.timeExpired].filter(Boolean).join(` ${t.to} `)} />
      <PhoneLine label={t.superintendent} value={jsa.siteContactPhone} />
      <PhoneLine label={t.emergency} value={jsa.emergencyPhone} />
      <MapLine label={t.nearestMedical} name={jsa.nearestMedicalFacility} address={jsa.nearestMedicalAddress} directions={t.directions} />
      <Line label={t.musterPoint} value={jsa.musterPoint} />
      <Line label={t.tailgateTopic} value={jsa.tailgateTopic} />

      {t.typedAsWritten && <p className="jsaAsWritten">{t.typedAsWritten}</p>}
      <ListBox title={t.tasks} items={cols.tasks} />
      <ListBox title={t.hazards} items={cols.hazards} />
      <ListBox title={t.controls} items={cols.controls} />

      {ack && (
        <>
          <div className="jsaDocTitle">{t.whatYouSign}</div>
          {t.ackStandard && ackIsStandard ? (
            <>
              <p className="jsaAck">{t.ackStandard}</p>
              <p className="jsaAckOriginalLabel">{t.ackOriginal}</p>
              <p className="jsaAck jsaAckOriginal">{jsa.acknowledgement}</p>
            </>
          ) : (
            <p className="jsaAck">{jsa.acknowledgement}</p>
          )}
        </>
      )}
    </div>
  );
}
