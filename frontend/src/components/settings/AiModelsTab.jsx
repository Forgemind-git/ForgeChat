import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Loader2, Eye, EyeOff, KeyRound, Bot, RefreshCw } from 'lucide-react';
import { api } from '../../api.js';
import { C, FONT, MONO } from '../../constants.js';
import DeleteConfirmModal from '../DeleteConfirmModal.jsx';

/**
 * Integrations → AI Models.
 *
 * Workspace-wide LLM provider credentials. Each row is one (provider, API key)
 * the workspace has connected; AI Agents reference a row instead of carrying
 * their own key, so a key is pasted once here and rotating it updates every
 * agent. v1 supports the two providers the engine has tool-use adapters for.
 */

const PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic Claude', hint: 'sk-ant-…' },
  { value: 'openai', label: 'OpenAI', hint: 'sk-…' },
];

const PROVIDER_LABELS = Object.fromEntries(PROVIDERS.map(p => [p.value, p.label]));

export default function AiModelsTab() {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setModels(await api.aiModels.list());
    } catch (e) {
      setError(prettyError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleDelete = async (id) => {
    try {
      await api.aiModels.delete(id);
      setPendingDelete(null);
      await refresh();
    } catch (e) {
      setError(prettyError(e));
      setPendingDelete(null);
    }
  };

  return (
    <div style={{ flex: 1, padding: '32px 40px', overflowY: 'auto', fontFamily: FONT }}>
      <div style={{ width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 24, gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: 0, letterSpacing: '-.02em' }}>AI Models</h1>
            <p style={{ fontSize: 12, color: C.textMuted, margin: '4px 0 0' }}>
              Connect an Anthropic or OpenAI key once. AI Agents pick a connected provider — no per-agent keys.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={refresh} disabled={loading} title="Refresh"
              style={ghostBtn(loading)}>
              <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} /> Refresh
            </button>
            {!showAdd && (
              <button onClick={() => setShowAdd(true)} style={primaryBtn}>
                <Plus size={14} /> Add AI model
              </button>
            )}
          </div>
        </div>

        {error && (
          <div style={{
            padding: '10px 14px', borderRadius: 8, marginBottom: 16,
            background: '#FCEBEB', color: '#A32D2D', border: '1px solid #FBC8C8', fontSize: 13,
          }}>
            {error}
          </div>
        )}

        {showAdd && (
          <AddModelForm
            onCancel={() => setShowAdd(false)}
            onCreated={async () => { setShowAdd(false); await refresh(); }}
            onError={setError}
          />
        )}

        {loading && models.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 40, color: C.textMuted, fontSize: 13 }}>
            <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> Loading…
          </div>
        ) : models.length === 0 && !showAdd ? (
          <EmptyState onAdd={() => setShowAdd(true)} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {models.map(m => (
              <ModelRow key={m.id} model={m} onDelete={() => setPendingDelete(m)} />
            ))}
          </div>
        )}
      </div>

      <DeleteConfirmModal
        open={!!pendingDelete}
        title="Remove this AI model?"
        message={pendingDelete ? `Agents using ${PROVIDER_LABELS[pendingDelete.provider] || pendingDelete.provider}${pendingDelete.label ? ` (${pendingDelete.label})` : ''} will be detached and need a new model selected before they can run.` : ''}
        confirmText="Remove"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => handleDelete(pendingDelete.id)}
      />
    </div>
  );
}

function AddModelForm({ onCancel, onCreated, onError }) {
  const [provider, setProvider] = useState('anthropic');
  const [label, setLabel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);

  const placeholder = PROVIDERS.find(p => p.value === provider)?.hint || 'sk-…';

  const handleSave = async () => {
    if (!apiKey.trim()) { onError('Paste an API key first.'); return; }
    setSaving(true);
    onError('');
    try {
      await api.aiModels.create({ provider, label: label.trim() || null, apiKey: apiKey.trim() });
      onCreated();
    } catch (e) {
      onError(prettyError(e));
      setSaving(false);
    }
  };

  return (
    <div style={{
      padding: 20, borderRadius: 12, background: C.cardBg,
      border: `1px solid ${C.border}`, marginBottom: 20,
    }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 16 }}>Add AI model</div>

      <div style={{ marginBottom: 14 }}>
        <FieldLabel>Provider *</FieldLabel>
        <div style={{ display: 'flex', gap: 8 }}>
          {PROVIDERS.map(p => (
            <button
              key={p.value}
              type="button"
              onClick={() => setProvider(p.value)}
              style={{
                flex: 1, padding: '10px 14px', borderRadius: 8,
                border: provider === p.value ? `1.5px solid ${C.primary}` : `1px solid ${C.border}`,
                background: provider === p.value ? '#FEF1F1' : C.cardBg,
                color: provider === p.value ? C.primary : C.text,
                fontSize: 13, fontWeight: 600, fontFamily: FONT, cursor: 'pointer',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <FieldLabel>Name (optional)</FieldLabel>
        <input
          value={label}
          onChange={e => setLabel(e.target.value)}
          placeholder="e.g. Production key"
          style={inputStyle}
        />
      </div>

      <div style={{ marginBottom: 18 }}>
        <FieldLabel>API key *</FieldLabel>
        <div style={{ position: 'relative' }}>
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
            style={{ ...inputStyle, fontFamily: MONO, paddingRight: 38 }}
          />
          <button type="button" onClick={() => setShowKey(s => !s)}
            title={showKey ? 'Hide' : 'Show'}
            style={{
              position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer',
              color: C.textMuted, display: 'flex', padding: 6, borderRadius: 4,
            }}>
            {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 6 }}>
          Stored encrypted (AES-256-GCM). Paste with ⌘/Ctrl+V — it never leaves your server in plaintext.
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onCancel} style={ghostBtn(false)}>Cancel</button>
        <button onClick={handleSave} disabled={saving} style={{ ...primaryBtn, opacity: saving ? 0.7 : 1 }}>
          {saving ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <KeyRound size={13} />}
          Save key
        </button>
      </div>
    </div>
  );
}

function ModelRow({ model, onDelete }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '14px 16px', background: C.cardBg, borderRadius: 10,
      border: `1px solid ${C.border}`, gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <div style={{
          width: 34, height: 34, borderRadius: 9, background: '#FEF1F1',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Bot size={17} color={C.primary} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>
            {PROVIDER_LABELS[model.provider] || model.provider}
            {model.label && <span style={{ color: C.textMuted, fontWeight: 500 }}> — {model.label}</span>}
          </div>
          <div style={{ fontSize: 11, color: C.textMuted, fontFamily: MONO, marginTop: 3 }}>
            {model.apiKeyMasked || '••••••••'}
          </div>
        </div>
      </div>
      <button onClick={onDelete} title="Remove"
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '7px 10px', borderRadius: 8,
          border: '1px solid #FBC8C8', background: '#fff',
          color: C.primary, fontSize: 12, fontFamily: FONT, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
        }}>
        <Trash2 size={13} /> Remove
      </button>
    </div>
  );
}

function EmptyState({ onAdd }) {
  return (
    <div style={{
      padding: 32, borderRadius: 12, background: 'var(--c-surfaceAlt)',
      border: `1px dashed ${C.border}`, textAlign: 'center',
    }}>
      <div style={{
        width: 52, height: 52, borderRadius: 13, margin: '0 auto 14px', background: '#FEF1F1',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Bot size={26} color={C.primary} />
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 6 }}>No AI models connected</div>
      <p style={{ fontSize: 13, color: C.textSecondary, margin: '0 0 18px', lineHeight: 1.55 }}>
        Add an Anthropic or OpenAI key so your AI Agents have a model to run.
      </p>
      <button onClick={onAdd} style={{ ...primaryBtn, margin: '0 auto' }}>
        <Plus size={14} /> Add AI model
      </button>
    </div>
  );
}

function FieldLabel({ children }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, color: C.textSecondary,
      textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6,
    }}>{children}</div>
  );
}

const inputStyle = {
  width: '100%', padding: '10px 12px', borderRadius: 8,
  border: `1px solid ${C.border}`, fontSize: 14, fontFamily: FONT,
  color: C.text, background: C.cardBg, outline: 'none', boxSizing: 'border-box',
};

const primaryBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '9px 14px', borderRadius: 8, border: 'none',
  background: C.primary, color: '#fff', fontSize: 13, fontFamily: FONT, fontWeight: 700, cursor: 'pointer',
};

const ghostBtn = (busy) => ({
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '9px 12px', borderRadius: 8, border: `1px solid ${C.border}`,
  background: C.cardBg, color: C.text, fontSize: 12, fontFamily: FONT, fontWeight: 600,
  cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1,
});

function prettyError(e) {
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
