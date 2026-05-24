import { C, FONT } from '../constants.js';

// Maps a field definition's field_type to an <input type>. textarea is handled
// separately. Unknown types fall back to plain text.
const TYPE_INPUT = {
  number: 'number',
  phone: 'tel',
  email: 'email',
  date: 'date',
  url: 'url',
  text: 'text',
};

// Editable list of custom-field inputs.
// - fields:  field definitions [{ id, name, description, field_type }]
// - values:  current values keyed by field id ({ [id]: value })
// - onChange(nextValues): called with the full updated values object
export function CustomFieldEditor({ fields, values, onChange }) {
  if (!fields || fields.length === 0) return null;
  const v = values || {};
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: C.textSecondary, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        Custom Fields
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {fields.map(f => {
          const val = v[f.id] ?? '';
          const set = (val2) => onChange({ ...v, [f.id]: val2 });
          const inputStyle = {
            width: '100%', padding: '9px 12px', borderRadius: 8,
            border: `1px solid ${C.border}`, fontSize: 13, fontFamily: FONT,
            color: C.text, outline: 'none', boxSizing: 'border-box', background: 'var(--c-cardBg)',
          };
          return (
            <div key={f.id}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 4 }}>
                {f.name}
              </label>
              {f.field_type === 'textarea' ? (
                <textarea
                  rows={3}
                  value={val}
                  onChange={e => set(e.target.value)}
                  placeholder={f.description || ''}
                  style={{ ...inputStyle, resize: 'vertical' }}
                />
              ) : (
                <input
                  type={TYPE_INPUT[f.field_type] || 'text'}
                  value={val}
                  onChange={e => set(e.target.value)}
                  placeholder={f.description || ''}
                  style={inputStyle}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Read-only viewer — shows only fields that have a value.
export function CustomFieldView({ fields, values }) {
  const v = values || {};
  const populated = (fields || []).filter(f => v[f.id] != null && String(v[f.id]).trim() !== '');
  if (populated.length === 0) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: C.textSecondary, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        Custom Fields
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {populated.map(f => (
          <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
            <span style={{ fontSize: 12, color: C.textSecondary, flexShrink: 0 }}>{f.name}</span>
            <span style={{ fontSize: 13, color: C.text, fontWeight: 600, textAlign: 'right', wordBreak: 'break-word' }}>
              {String(v[f.id])}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
