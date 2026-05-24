import { useState } from 'react';
import { maskPhone } from '../constants.js';

// Renders a phone number masked by default (e.g. 93*****678); click to reveal /
// hide the full number. stopPropagation so revealing inside a clickable row
// (contact list, deal card) doesn't also trigger the row's onClick.
export default function MaskedNumber({ number, prefix = '', style, title }) {
  const [revealed, setRevealed] = useState(false);
  if (number === null || number === undefined || number === '') return null;
  return (
    <span
      onClick={(e) => { e.stopPropagation(); setRevealed(r => !r); }}
      title={title || (revealed ? 'Click to hide number' : 'Click to reveal number')}
      style={{ cursor: 'pointer', ...style }}
    >
      {prefix}{revealed ? String(number) : maskPhone(number)}
    </span>
  );
}
