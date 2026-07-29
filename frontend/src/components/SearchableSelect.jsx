import { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, Check, Search, Plus } from 'lucide-react';
import { C, FONT } from '../constants.js';

/**
 * Searchable single-select dropdown — a drop-in replacement for a native
 * <select> that adds a type-to-filter search box. Matches the Forge look of the
 * old selects (full-width trigger, 1.5px border, chevron on the right).
 *
 * Props:
 *  - value:            currently-selected option value (string)
 *  - onChange(val):    called with the chosen option's value
 *  - options:          [{ value, label, sublabel? }]
 *  - placeholder:      trigger text when nothing is selected
 *  - searchPlaceholder:search input placeholder
 *  - disabled:         greys out + blocks opening
 *  - createLabel:      optional row pinned at the bottom (e.g. "+ Create new template…")
 *  - onCreate():       called when the create row is clicked
 *  - emptyText:        shown when the filter matches nothing
 *  - searchThreshold:  hide the search box when options.length <= this (default 5)
 *  - triggerStyle:     style overrides merged into the trigger button (compact variants)
 *  - menuStyle:        style overrides merged into the popover (e.g. wider than trigger)
 */
export default function SearchableSelect({
  value,
  onChange,
  options = [],
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  disabled = false,
  createLabel,
  onCreate,
  emptyText = 'No matches',
  searchThreshold = 5,
  triggerStyle,
  menuStyle,
  style,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    // focus the search box as soon as the popover opens
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      clearTimeout(t);
    };
  }, [open]);

  // Reset the query each time we re-open so a stale filter doesn't hide options.
  useEffect(() => { if (open) setQuery(''); }, [open]);

  const selected = options.find(o => String(o.value) === String(value));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o =>
      String(o.label).toLowerCase().includes(q) ||
      String(o.sublabel || '').toLowerCase().includes(q)
    );
  }, [options, query]);

  const choose = (val) => { onChange(val); setOpen(false); };

  // Short lists don't need a filter — keep the box clutter-free but the trigger
  // identical, so the whole app still reads as one uniform dropdown style.
  const showSearch = options.length > searchThreshold;

  return (
    <div ref={ref} style={{ position: 'relative', ...style }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 32px 10px 12px', borderRadius: 8,
          border: `1.5px solid ${open ? C.primary : C.border}`,
          fontSize: 13, fontFamily: FONT, color: selected ? C.text : C.textMuted,
          background: disabled ? 'var(--c-hover)' : 'var(--c-cardBg)',
          cursor: disabled ? 'not-allowed' : 'pointer', textAlign: 'left',
          position: 'relative', outline: 'none', boxSizing: 'border-box',
          ...triggerStyle,
        }}
      >
        <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown size={14} color={C.textMuted} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          background: 'var(--c-cardBg)', border: `1px solid ${C.border}`,
          borderRadius: 10, boxShadow: C.shadowLg, zIndex: 60,
          overflow: 'hidden', fontFamily: FONT, ...menuStyle,
        }}>
          {/* Search box — only when the list is long enough to warrant it */}
          {showSearch && (
            <div style={{ padding: 8, borderBottom: `1px solid ${C.border}` }}>
              <div style={{ position: 'relative' }}>
                <Search size={13} color={C.textMuted} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder={searchPlaceholder}
                  style={{
                    width: '100%', padding: '7px 9px 7px 28px', borderRadius: 7,
                    border: `1px solid ${C.border}`, fontSize: 12.5, fontFamily: FONT,
                    color: C.text, outline: 'none', background: 'var(--c-cardBg)', boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>
          )}

          {/* Options */}
          <div style={{ maxHeight: 240, overflowY: 'auto', padding: 6 }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '10px 8px', color: C.textMuted, fontSize: 12 }}>{emptyText}</div>
            ) : filtered.map(o => {
              const on = String(o.value) === String(value);
              return (
                <div
                  key={o.value}
                  onClick={() => choose(o.value)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 8px',
                    borderRadius: 6, cursor: 'pointer',
                    background: on ? '#FDF6F6' : 'transparent',
                  }}
                  onMouseEnter={e => { if (!on) e.currentTarget.style.background = '#F5F5F0'; }}
                  onMouseLeave={e => { if (!on) e.currentTarget.style.background = 'transparent'; }}
                >
                  <Check size={13} color={C.primary} style={{ flexShrink: 0, opacity: on ? 1 : 0 }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.label}</div>
                    {o.sublabel && <div style={{ fontSize: 11, color: C.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.sublabel}</div>}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Create-new row (pinned) */}
          {createLabel && onCreate && (
            <div
              onClick={() => { setOpen(false); onCreate(); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 7, padding: '10px 12px',
                borderTop: `1px solid ${C.border}`, cursor: 'pointer',
                fontSize: 13, fontWeight: 600, color: C.primary, fontFamily: FONT,
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#FDF6F6'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <Plus size={14} /> {createLabel}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
