import { useState, useRef, useEffect } from 'react';
import { Filter, ChevronDown, Check, X } from 'lucide-react';
import { C, FONT } from '../constants.js';

/**
 * Multi-select tag filter dropdown. Mirrors the look of the old single <select>
 * (Filter icon + label + chevron) but lets the user pick several tags via
 * checkboxes, grouped by category. `selectedIds` is an array of tag ids;
 * `onChange(nextArray)` is called on every toggle. Filter semantics are OR
 * (a contact matches if it has ANY selected tag) — applied by the caller.
 */
export default function TagMultiSelect({ categories = [], tags = [], selectedIds = [], onChange, minWidth = 200, placeholder = 'All tags' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const selected = new Set(selectedIds);
  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(Array.from(next));
  };

  const count = selected.size;
  const label = count === 0 ? placeholder
    : count === 1 ? (tags.find(t => String(t.id) === String([...selected][0]))?.name || '1 tag')
    : `${count} tags`;

  const groups = categories
    .map(cat => ({ cat, catTags: tags.filter(t => t.category_id === cat.id) }))
    .filter(g => g.catTags.length > 0);
  const uncategorized = tags.filter(t => !categories.some(c => c.id === t.category_id));

  const Row = ({ tag }) => {
    const on = selected.has(tag.id);
    return (
      <div
        onClick={() => toggle(tag.id)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px',
          borderRadius: 6, cursor: 'pointer', fontFamily: FONT,
          background: on ? '#FDF6F6' : 'transparent',
        }}
        onMouseEnter={e => { if (!on) e.currentTarget.style.background = '#F5F5F0'; }}
        onMouseLeave={e => { if (!on) e.currentTarget.style.background = 'transparent'; }}
      >
        <span style={{
          width: 16, height: 16, borderRadius: 4, flexShrink: 0,
          border: `1.5px solid ${on ? C.primary : C.border}`,
          background: on ? C.primary : 'var(--c-cardBg)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {on && <Check size={11} color="#fff" />}
        </span>
        <span style={{ width: 10, height: 10, borderRadius: 3, background: tag.color || C.textMuted, flexShrink: 0 }} />
        <span style={{ fontSize: 13, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tag.name}</span>
      </div>
    );
  };

  return (
    <div ref={ref} style={{ position: 'relative', minWidth }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 10px', borderRadius: 8,
          border: `1px solid ${count ? C.primary : C.border}`, background: C.cardBg,
          cursor: 'pointer', fontFamily: FONT,
        }}
      >
        <Filter size={14} color={count ? C.primary : C.textMuted} style={{ flexShrink: 0 }} />
        <span style={{ flex: 1, textAlign: 'left', fontSize: 13, color: count ? C.text : C.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {label}
        </span>
        {count > 0 && (
          <span
            role="button"
            title="Clear tag filter"
            onClick={(e) => { e.stopPropagation(); onChange([]); }}
            style={{ display: 'flex', alignItems: 'center', color: C.textMuted, flexShrink: 0 }}
          >
            <X size={13} />
          </span>
        )}
        <ChevronDown size={14} color={C.textMuted} style={{ flexShrink: 0 }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0,
          minWidth: Math.max(minWidth, 220), background: 'var(--c-cardBg)',
          border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: C.shadowLg,
          zIndex: 60, maxHeight: 320, overflowY: 'auto', padding: 6, fontFamily: FONT,
        }}>
          {groups.length === 0 && uncategorized.length === 0 && (
            <div style={{ padding: 12, color: C.textMuted, fontSize: 12 }}>No tags available</div>
          )}
          {groups.map(({ cat, catTags }) => (
            <div key={cat.id} style={{ marginBottom: 2 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', padding: '6px 8px 2px' }}>
                {cat.name}
              </div>
              {catTags.map(tag => <Row key={tag.id} tag={tag} />)}
            </div>
          ))}
          {uncategorized.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', padding: '6px 8px 2px' }}>
                Other
              </div>
              {uncategorized.map(tag => <Row key={tag.id} tag={tag} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
