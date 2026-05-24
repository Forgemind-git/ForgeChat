import { useState, useEffect, useMemo, useCallback } from 'react';
import { Trash2 } from 'lucide-react';
import { C, FONT } from '../constants.js';

/**
 * Reusable hook for table row selection with bulk delete.
 *
 * Usage:
 *   const sel = useTableSelection(filteredRows, r => r.id);
 *   ...
 *   <th><SelectAllCheckbox sel={sel} /></th>
 *   ...
 *   <td><RowCheckbox sel={sel} id={row.id} label={row.name} /></td>
 *   ...
 *   <BulkDeleteButton sel={sel} label="automation" onConfirm={ids => bulkDelete(ids)} />
 *
 * `items` is the currently visible/filtered list (so "select all" only ticks visible rows).
 * `getId` defaults to `r => r.id`.
 */
export function useTableSelection(items, getId = (r) => r.id) {
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const visibleIds = useMemo(() => items.map(getId), [items, getId]);

  // Prune selection when rows disappear (e.g. after delete or filter change that removes them)
  useEffect(() => {
    setSelectedIds(prev => {
      // If we're filtering, we don't want to drop selections that are merely hidden — only when items leave the source list.
      // Here we treat the passed `items` as authoritative for membership.
      const valid = new Set(visibleIds);
      const next = new Set();
      prev.forEach(id => { if (valid.has(id)) next.add(id); });
      return next.size === prev.size ? prev : next;
    });
  }, [visibleIds]);

  const toggleOne = useCallback((id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const allVisibleSelected = items.length > 0 && visibleIds.every(id => selectedIds.has(id));
  const someVisibleSelected = visibleIds.some(id => selectedIds.has(id));

  const toggleAllVisible = useCallback(() => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        visibleIds.forEach(id => next.delete(id));
      } else {
        visibleIds.forEach(id => next.add(id));
      }
      return next;
    });
  }, [visibleIds, allVisibleSelected]);

  const clear = useCallback(() => setSelectedIds(new Set()), []);

  return {
    selectedIds,
    selectedCount: selectedIds.size,
    toggleOne,
    toggleAllVisible,
    allVisibleSelected,
    someVisibleSelected,
    clear,
    isSelected: (id) => selectedIds.has(id),
  };
}

const checkboxStyle = {
  width: 15, height: 15, cursor: 'pointer', accentColor: C.primary, verticalAlign: 'middle',
};

export function SelectAllCheckbox({ sel, ariaLabel = 'Select all', style }) {
  return (
    <input
      type="checkbox"
      checked={sel.allVisibleSelected}
      ref={el => { if (el) el.indeterminate = !sel.allVisibleSelected && sel.someVisibleSelected; }}
      onChange={(e) => { e.stopPropagation(); sel.toggleAllVisible(); }}
      onClick={(e) => e.stopPropagation()}
      aria-label={ariaLabel}
      style={{ ...checkboxStyle, ...style }}
    />
  );
}

export function RowCheckbox({ sel, id, label, style }) {
  return (
    <input
      type="checkbox"
      checked={sel.isSelected(id)}
      onChange={(e) => { e.stopPropagation(); sel.toggleOne(id); }}
      onClick={(e) => e.stopPropagation()}
      aria-label={label ? `Select ${label}` : 'Select row'}
      style={{ ...checkboxStyle, ...style }}
    />
  );
}

/**
 * Red-outlined bulk-delete button. Only renders when the selection is non-empty.
 *
 * Props:
 *   - sel: the useTableSelection() return value
 *   - label: singular noun e.g. "automation", "contact"
 *   - onConfirm: async (ids) => void — called after the user confirms
 *   - confirmMessage?: custom message override
 */
export function BulkDeleteButton({ sel, label, onConfirm, confirmMessage, style }) {
  const [open, setOpen] = useState(false);
  const n = sel.selectedCount;
  if (n === 0) return null;

  const plural = n === 1 ? '' : 's';
  const title = `Delete ${n} ${label}${plural}`;
  const message = confirmMessage || `Are you sure you want to delete ${n} ${label}${plural}? This cannot be undone.`;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '8px 14px',
          background: 'var(--c-primaryLight)', color: '#A32D2D',
          border: '1.5px solid #A32D2D', borderRadius: 8,
          fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: FONT,
          transition: 'background .15s, color .15s',
          ...style,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = '#A32D2D'; e.currentTarget.style.color = '#fff'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = '#FCEBEB'; e.currentTarget.style.color = '#A32D2D'; }}
      >
        <Trash2 size={14} />
        Delete {n} selected
      </button>

      {open && (
        <BulkDeleteModal
          title={title}
          message={message}
          onConfirm={async () => {
            const ids = [...sel.selectedIds];
            setOpen(false);
            await onConfirm(ids);
            sel.clear();
          }}
          onCancel={() => setOpen(false)}
        />
      )}
    </>
  );
}

function BulkDeleteModal({ title, message, onConfirm, onCancel }) {
  return (
    <div
      onClick={onCancel}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 300,
               display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--c-cardBg)', borderRadius: 14, padding: '24px 26px', width: 420, maxWidth: '90vw',
                 boxShadow: '0 24px 60px rgba(0,0,0,.22)' }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--c-text)', marginBottom: 10 }}>{title}</div>
        <div style={{ fontSize: 13, color: '#555', lineHeight: 1.55, marginBottom: 22 }}>{message}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            onClick={onCancel}
            style={{ padding: '9px 18px', border: '1.5px solid #D5D5D0', background: 'var(--c-cardBg)', color: '#444',
                     borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}
          >Cancel</button>
          <button
            onClick={onConfirm}
            style={{ padding: '9px 18px', border: 'none', background: '#A32D2D', color: '#fff',
                     borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}
          >Delete</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Helper that runs an async delete for each id with Promise.allSettled and reports
 * partial failures. The returned function is suitable to pass as BulkDeleteButton.onConfirm.
 */
export async function runBulkDelete(ids, deleteFn, { onSuccess, label = 'row' } = {}) {
  if (!ids || ids.length === 0) return;
  const results = await Promise.allSettled(ids.map(id => deleteFn(id)));
  const succeededIds = [];
  const failures = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') succeededIds.push(ids[i]);
    else failures.push({ id: ids[i], err: r.reason });
  });
  if (onSuccess) await onSuccess(succeededIds);
  if (failures.length > 0) {
    const plural = failures.length === 1 ? '' : 's';
    alert(`Failed to delete ${failures.length} ${label}${plural}: ${failures[0].err?.message || 'unknown error'}`);
  }
}
