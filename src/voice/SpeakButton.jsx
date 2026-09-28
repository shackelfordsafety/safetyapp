import { useRef } from 'react';
import { useSpeechToText } from './useSpeechToText';
import { normalizeSpokenList, appendSpokenListItems } from './spokenListFormatting';

function joinText(base, chunk) {
  const trimmedBase = (base || '').replace(/\s+$/u, '');
  const trimmedChunk = (chunk || '').replace(/^\s+/u, '');
  if (!trimmedChunk) return base || '';
  if (!trimmedBase) return trimmedChunk;
  return `${trimmedBase} ${trimmedChunk}`;
}

// Sits inline next to a field's label (see .fieldLabelRow in voice.css).
// Never disables or replaces the textarea it sits beside -- typing always
// keeps working regardless of listening/error/unsupported state. Witness
// and employee-statement fields rely on this being a pure passthrough: the
// hook hands back exactly what SpeechRecognition returns, nothing here
// rewrites or cleans up wording.
//
// mode="narrative" (default) is that passthrough, unchanged. mode="list" is
// for JSA Tasks/Hazards/Controls only: real dictation essentially never
// contains punctuation -- pauses don't produce periods -- so list mode
// can't wait for punctuation to show up in a "final transcript." Instead it
// keys off newFinalChunks: the browser itself finalizes each pause-separated
// phrase as its own entry independent of punctuation, so each newly-final
// phrase is committed as its own line the moment the browser finalizes it
// (still also split internally via normalizeSpokenList, so an explicit
// period/semicolon/"next item" *within* one finalized phrase still works).
// The still-in-progress tail previews live as plain text after the
// committed lines, and gets folded into a clean line once it finalizes.
export default function SpeakButton({ value, onChange, disabled = false, mode = 'narrative' }) {
  // Snapshot of the field's value at the moment listening started, so each
  // interim/final result replaces "base + transcript-so-far" as one string
  // instead of compounding on every partial result -- that's what prevents
  // both duplication across interim events and "existingtextnewtext"
  // collisions when the user types, speaks, types, speaks again.
  const baseValueRef = useRef('');
  // List mode only: rolls forward permanently each time the browser
  // finalizes a new phrase, so a phrase already committed as a line is
  // never re-processed by a later event in the same session.
  const committedBaseRef = useRef('');
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const { isSupported, isListening, error, start, stop } = useSpeechToText({
    onResult: ({ combinedText, newFinalChunks, interimText }) => {
      if (mode === 'list') {
        if (newFinalChunks.length) {
          let base = committedBaseRef.current;
          for (const chunk of newFinalChunks) base = appendSpokenListItems(base, normalizeSpokenList(chunk));
          committedBaseRef.current = base;
        }
        onChangeRef.current(interimText ? joinText(committedBaseRef.current, interimText) : committedBaseRef.current);
      } else {
        onChangeRef.current(joinText(baseValueRef.current, combinedText));
      }
    },
  });

  if (!isSupported) {
    return <span className="voiceHint">Tip: use your keyboard's dictation mic to fill this in by voice.</span>;
  }

  const handleClick = () => {
    if (isListening) {
      stop();
      return;
    }
    baseValueRef.current = value || '';
    committedBaseRef.current = value || '';
    start();
  };

  return (
    <span className="voiceControl">
      <span className="voiceControlRow">
        <button
          type="button"
          className={`voiceBtn${isListening ? ' listening' : ''}`}
          onClick={handleClick}
          disabled={disabled}
          aria-label={isListening ? 'Stop dictating this field' : 'Dictate this field'}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4M9 22h6" />
          </svg>
          {isListening ? 'Stop' : 'Speak'}
        </button>
        {isListening && !error && <span className="voiceStatus" role="status" aria-live="polite">Listening… tap Stop when finished.</span>}
        {error && <span className="voiceStatus voiceError" role="status" aria-live="polite">{error.message}</span>}
      </span>
      {/* "Speak clearly for the best results." used to sit under every mic
          button, up to 7 times a page (tidiness audit, 2026-09-28). Only
          the list tip is worth a line. */}
      {!isListening && !error && mode === 'list' && (
        <span className="voiceGuidanceHint">
          Say each item as its own sentence, or say &ldquo;next item.&rdquo;
        </span>
      )}
    </span>
  );
}
