import { useState } from 'react';
import { Info } from 'lucide-react';
import { C, FONT } from '../constants.js';

/**
 * Small info icon shown next to a field/section label. Hovering reveals the
 * description in a tooltip — used so forms don't carry a paragraph of helper
 * text under every input.
 */
export default function InfoDot({ text, size = 13, width = 230 }) {
  const [show, setShow] = useState(false);
  if (!text) return null;
  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'help', marginLeft: 5, verticalAlign: 'middle' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShow(s => !s); }}
    >
      <Info size={size} color={C.textMuted} />
      {show && (
        <span
          role="tooltip"
          style={{
            position: 'absolute', bottom: 'calc(100% + 7px)', left: '50%', transform: 'translateX(-50%)',
            background: '#1F1F23', color: '#fff', fontFamily: FONT, fontSize: 11.5, lineHeight: 1.45,
            fontWeight: 500, padding: '8px 11px', borderRadius: 8, width, maxWidth: '72vw',
            boxShadow: '0 8px 24px rgba(0,0,0,.20)', zIndex: 90,
            textTransform: 'none', letterSpacing: 0, whiteSpace: 'normal', textAlign: 'left', pointerEvents: 'none',
          }}
        >
          {text}
          <span style={{ position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', borderWidth: 5, borderStyle: 'solid', borderColor: '#1F1F23 transparent transparent transparent' }} />
        </span>
      )}
    </span>
  );
}
