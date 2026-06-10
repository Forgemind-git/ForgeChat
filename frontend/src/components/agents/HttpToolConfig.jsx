import { useState } from 'react';
import { Save, X, Loader2, Plus, Trash2 } from 'lucide-react';
import { api } from '../../api.js';
import { C, FONT, MONO } from '../../constants.js';
import SearchableSelect from '../SearchableSelect.jsx';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const LOCATIONS = [
  { value: 'body',   label: 'Body',   sublabel: 'JSON body field' },
  { value: 'query',  label: 'Query',  sublabel: '?name=value' },
  { value: 'path',   label: 'Path',   sublabel: 'fills {name} in URL' },
  { value: 'header', label: 'Header', sublabel: 'request header' },
];
const TYPES = [
  { value: 'string',  label: 'Text' },
  { value: 'number',  label: 'Number' },
  { value: 'boolean', label: 'True/False' },
];

/**
 * HTTP request tool config for an agent. Lets the admin wire the agent to an
 * external system (device/hardware API, webhook, internal service): a fixed
 * method + URL + static headers (auth), plus a list of parameters the agent's
 * LLM fills at call time. Path params substitute {name} in the URL, query
 * params append to the querystring, body params build the JSON body.
 */
export default function HttpToolConfig({ agentId, ensureAgentId, existingTool, onCancel, onSaved }) {
  const isEdit = !!existingTool;
  const initial = existingTool?.config || {};

  const [label, setLabel] = useState(initial.label || '');
  const [description, setDescription] = useState(initial.description || '');
  const [method, setMethod] = useState(initial.method || 'POST');
  const [url, setUrl] = useState(initial.url || '');
  const [headers, setHeaders] = useState(
    Array.isArray(initial.headers) && initial.headers.length ? initial.headers : [],
  );
  const [params, setParams] = useState(
    Array.isArray(initial.params) ? initial.params : [],
  );
  const [timeoutMs, setTimeoutMs] = useState(initial.timeout_ms || 10000);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const addHeader = () => setHeaders(h => [...h, { k: '', v: '' }]);
  const setHeader = (i, key, val) => setHeaders(h => h.map((row, idx) => idx === i ? { ...row, [key]: val } : row));
  const removeHeader = (i) => setHeaders(h => h.filter((_, idx) => idx !== i));

  const addParam = () => setParams(p => [...p, { name: '', in: 'body', type: 'string', description: '', required: true }]);
  const setParam = (i, key, val) => setParams(p => p.map((row, idx) => idx === i ? { ...row, [key]: val } : row));
  const removeParam = (i) => setParams(p => p.filter((_, idx) => idx !== i));

  const handleSave = async () => {
    if (!label.trim()) { setError('Give the tool a name.'); return; }
    if (!description.trim()) { setError('Describe when the agent should use this tool.'); return; }
    if (!url.trim()) { setError('Enter the request URL.'); return; }
    setSaving(true); setError('');
    try {
      const payload = {
        toolType: 'http_request',
        isEnabled: existingTool?.isEnabled !== false,
        config: {
          label: label.trim(),
          description: description.trim(),
          method,
          url: url.trim(),
          headers: headers.filter(h => h.k.trim()),
          params: params
            .filter(p => p.name.trim())
            .map(p => ({
              name: p.name.trim(),
              in: p.in,
              type: p.type,
              description: (p.description || '').trim(),
              required: !!p.required,
            })),
          timeout_ms: Number(timeoutMs) || 10000,
        },
      };
      if (isEdit) {
        await api.agents.updateTool(agentId, existingTool.id, payload);
      } else {
        const id = agentId != null ? agentId : (ensureAgentId ? await ensureAgentId() : agentId);
        if (id == null) throw new Error('Save the agent first, then add tools.');
        await api.agents.addTool(id, payload);
      }
      onSaved();
    } catch (e) {
      setError(pretty(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      padding: 16, background: 'var(--c-surfaceAlt)', borderRadius: 10,
      border: `1px solid ${C.border}`, fontFamily: FONT,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
          {isEdit ? 'Edit HTTP tool' : 'Add HTTP tool'}
        </div>
        <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, display: 'flex', padding: 6 }}>
          <X size={14} />
        </button>
      </div>

      {error && (
        <div style={{ padding: '8px 12px', borderRadius: 8, marginBottom: 12,
          background: '#FCEBEB', color: '#A32D2D', border: '1px solid #FBC8C8', fontSize: 12 }}>
          {error}
        </div>
      )}

      <Field label="Tool name" hint="A short name for this action, e.g. “Turn on smart light”.">
        <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Control smart light" style={input} />
      </Field>

      <Field label="When to use it" hint="The AI reads this to decide when to call the tool. Be specific, e.g. “Call when the user asks to switch the light on or off.”">
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
          placeholder="Switches the smart light on or off." style={{ ...input, resize: 'vertical', lineHeight: 1.5 }} />
      </Field>

      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ width: 130, flexShrink: 0 }}>
          <Field label="Method">
            <SearchableSelect
              value={method}
              onChange={v => setMethod(v)}
              options={METHODS.map(m => ({ value: m, label: m }))}
              searchThreshold={99}
              triggerStyle={{ padding: '9px 32px 9px 12px', fontSize: 13 }}
            />
          </Field>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Field label="URL" hint="Use {name} to insert a path parameter, e.g. https://api.io/devices/{device_id}/state">
            <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://api.example.com/endpoint"
              style={{ ...input, fontFamily: MONO, fontSize: 12 }} />
          </Field>
        </div>
      </div>

      <Field label="Static headers" hint="Sent on every call — use for auth tokens / API keys the AI shouldn't see or change.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {headers.map((h, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input value={h.k} onChange={e => setHeader(i, 'k', e.target.value)} placeholder="Authorization"
                style={{ ...input, flex: 1, fontFamily: MONO, fontSize: 12 }} />
              <input value={h.v} onChange={e => setHeader(i, 'v', e.target.value)} placeholder="Bearer xxx"
                style={{ ...input, flex: 1, fontFamily: MONO, fontSize: 12 }} />
              <button onClick={() => removeHeader(i)} style={iconBtn}><Trash2 size={13} color={C.primary} /></button>
            </div>
          ))}
          <button onClick={addHeader} style={addBtn}><Plus size={12} /> Add header</button>
        </div>
      </Field>

      <Field label="Parameters" hint="Values the AI fills in when it calls the tool. Path params replace {name} in the URL; query params append to the URL; body params build the JSON body; header params become request headers.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {params.map((p, i) => (
            <div key={i} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, background: C.cardBg }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                <input value={p.name} onChange={e => setParam(i, 'name', e.target.value)} placeholder="param_name"
                  style={{ ...input, flex: 1, fontFamily: MONO, fontSize: 12 }} />
                <div style={{ width: 110, flexShrink: 0 }}>
                  <SearchableSelect value={p.in} onChange={v => setParam(i, 'in', v)} options={LOCATIONS}
                    searchThreshold={99} triggerStyle={{ padding: '8px 28px 8px 10px', fontSize: 12 }} menuStyle={{ minWidth: 180 }} />
                </div>
                <div style={{ width: 110, flexShrink: 0 }}>
                  <SearchableSelect value={p.type} onChange={v => setParam(i, 'type', v)} options={TYPES}
                    searchThreshold={99} triggerStyle={{ padding: '8px 28px 8px 10px', fontSize: 12 }} />
                </div>
                <button onClick={() => removeParam(i)} style={iconBtn}><Trash2 size={13} color={C.primary} /></button>
              </div>
              <input value={p.description} onChange={e => setParam(i, 'description', e.target.value)}
                placeholder="What this value means (the AI reads this)" style={{ ...input, fontSize: 12, marginBottom: 6 }} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.textSecondary, cursor: 'pointer' }}>
                <input type="checkbox" checked={!!p.required} onChange={e => setParam(i, 'required', e.target.checked)} />
                Required
              </label>
            </div>
          ))}
          <button onClick={addParam} style={addBtn}><Plus size={12} /> Add parameter</button>
        </div>
      </Field>

      <Field label="Timeout (ms)" hint="1000–30000. The call is aborted if the external system doesn't respond in time.">
        <input type="number" value={timeoutMs} min={1000} max={30000} step={500}
          onChange={e => setTimeoutMs(e.target.value)} style={{ ...input, width: 140, fontFamily: MONO, fontSize: 12 }} />
      </Field>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <button onClick={onCancel} style={cancelBtn}>Cancel</button>
        <button onClick={handleSave} disabled={saving} style={saveBtn(saving)}>
          {saving ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={13} />}
          {isEdit ? 'Save tool' : 'Add tool'}
        </button>
      </div>
    </div>
  );
}

const input = {
  width: '100%', padding: '9px 12px', borderRadius: 8,
  border: `1px solid ${C.border}`, fontSize: 13, fontFamily: FONT,
  color: C.text, background: C.cardBg, outline: 'none',
  boxSizing: 'border-box',
};
const iconBtn = {
  background: 'transparent', border: `1px solid ${C.border}`,
  borderRadius: 8, cursor: 'pointer', padding: '7px',
  color: C.textSecondary, display: 'flex', alignItems: 'center', flexShrink: 0,
};
const addBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
  padding: '7px 12px', borderRadius: 8, border: `1px dashed ${C.border}`,
  background: C.cardBg, color: C.text, fontSize: 12, fontFamily: FONT, fontWeight: 600, cursor: 'pointer',
};
const cancelBtn = {
  padding: '8px 14px', borderRadius: 8,
  border: `1px solid ${C.border}`, background: C.cardBg,
  color: C.text, fontSize: 12, fontFamily: FONT, fontWeight: 600,
  cursor: 'pointer',
};
const saveBtn = (busy) => ({
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '8px 16px', borderRadius: 8,
  border: 'none', background: C.primary, color: '#fff',
  fontSize: 12, fontFamily: FONT, fontWeight: 700,
  cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1,
});

function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.textSecondary,
        textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 6, lineHeight: 1.45 }}>{hint}</div>}
    </div>
  );
}

function pretty(e) {
  if (!e) return 'Unknown error';
  const msg = e.message || String(e);
  try {
    const m = msg.match(/^\d+\s+(.+)$/);
    if (m) {
      const body = JSON.parse(m[1]);
      if (body && body.error) return body.error;
    }
  } catch { /* fall through */ }
  return msg;
}
