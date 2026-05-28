import { useState, useEffect, useCallback } from 'react';
import { Save, Trash2, Eye, EyeOff, Loader2, Plus, AlertCircle } from 'lucide-react';
import { api } from '../../api.js';
import { C, FONT, MONO } from '../../constants.js';
import DeleteConfirmModal from '../DeleteConfirmModal.jsx';
import AgentToolsList from './AgentToolsList.jsx';
import AgentRunsViewer from './AgentRunsViewer.jsx';

const PROVIDERS = [
  {
    value: 'anthropic',
    label: 'Anthropic Claude',
    models: [
      { value: 'claude-opus-4-7', label: 'Claude Opus 4.7 (most capable)' },
      { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (balanced)' },
      { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (fastest)' },
    ],
  },
  {
    value: 'openai',
    label: 'OpenAI',
    models: [
      { value: 'gpt-4o', label: 'GPT-4o' },
      { value: 'gpt-4o-mini', label: 'GPT-4o mini' },
      { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
    ],
  },
];

const BLANK = {
  name: '',
  description: '',
  systemPrompt: 'You are a helpful WhatsApp assistant. Keep replies concise.',
  llmProvider: 'anthropic',
  llmModel: 'claude-sonnet-4-6',
  llmApiKey: '',
  waAccountId: '',
  isActive: false,
  contextWindowMessages: 20,
  maxToolIterations: 6,
};

export default function AgentEditor({ agentId, waAccounts, user, onDone, onCancel }) {
  const isCreate = agentId == null;
  const [form, setForm] = useState(BLANK);
  const [tools, setTools] = useState([]);
  const [loading, setLoading] = useState(!isCreate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (isCreate) return;
    setLoading(true);
    setError('');
    try {
      const a = await api.agents.get(agentId);
      setForm({
        name: a.name || '',
        description: a.description || '',
        systemPrompt: a.systemPrompt || '',
        llmProvider: a.llmProvider,
        llmModel: a.llmModel,
        llmApiKey: '',
        waAccountId: a.waAccountId || '',
        isActive: !!a.isActive,
        contextWindowMessages: a.contextWindowMessages || 20,
        maxToolIterations: a.maxToolIterations || 6,
        hasOwnApiKey: !!a.hasOwnApiKey,
        llmApiKeyMasked: a.llmApiKeyMasked || '',
      });
      setTools(a.tools || []);
    } catch (e) {
      setError(prettyError(e));
    } finally {
      setLoading(false);
    }
  }, [agentId, isCreate]);

  useEffect(() => { refresh(); }, [refresh]);

  // If switching provider, snap model to the new provider's first model.
  const setProvider = (provider) => {
    const p = PROVIDERS.find(x => x.value === provider);
    setForm(f => ({
      ...f,
      llmProvider: provider,
      llmModel: p?.models[0]?.value || f.llmModel,
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const payload = { ...form };
      // Don't send the key field if the user didn't touch it (otherwise we'd
      // wipe the saved encrypted key on every edit).
      if (!payload.llmApiKey) delete payload.llmApiKey;
      if (isCreate) {
        const created = await api.agents.create(payload);
        // After create, switch to "edit" mode for this new agent so the user
        // can add tools without losing context. We do that by calling onDone()
        // and trusting the parent to navigate; but to keep the flow simple in
        // v1, return to the list.
        onDone(created.id);
      } else {
        await api.agents.update(agentId, payload);
        onDone(agentId);
      }
    } catch (e) {
      setError(prettyError(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      await api.agents.delete(agentId);
      setPendingDelete(false);
      onDone();
    } catch (e) {
      setError(prettyError(e));
      setPendingDelete(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60, gap: 8, color: C.textMuted, fontSize: 13 }}>
        <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Loading…
      </div>
    );
  }

  const provider = PROVIDERS.find(p => p.value === form.llmProvider) || PROVIDERS[0];
  const isAdmin = user?.role === 'admin';

  return (
    <div style={{ padding: '24px 24px 80px', maxWidth: 920, margin: '0 auto', fontFamily: FONT }}>
      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 16,
          background: '#FCEBEB', color: '#A32D2D', border: '1px solid #FBC8C8', fontSize: 13 }}>
          {error}
        </div>
      )}

      <Section title="Identity" subtitle="Shown in the agents list.">
        <FieldRow>
          <Field label="Name *">
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Booking Assistant" style={inputStyle} />
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="Description">
            <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="What does this agent do?" style={inputStyle} />
          </Field>
        </FieldRow>
      </Section>

      <Section title="Behavior" subtitle="The agent uses this as its system prompt on every turn.">
        <textarea
          value={form.systemPrompt}
          onChange={e => setForm(f => ({ ...f, systemPrompt: e.target.value }))}
          rows={8}
          placeholder="You are a helpful WhatsApp assistant..."
          style={{ ...inputStyle, fontFamily: MONO, fontSize: 13, lineHeight: 1.5, resize: 'vertical', minHeight: 140 }}
        />
      </Section>

      <Section title="Model" subtitle="Pick a provider and model. Each agent can BYOK its own API key.">
        <FieldRow>
          <Field label="Provider *">
            <div style={{ display: 'flex', gap: 8 }}>
              {PROVIDERS.map(p => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setProvider(p.value)}
                  style={{
                    flex: 1, padding: '10px 14px', borderRadius: 8,
                    border: form.llmProvider === p.value
                      ? `1.5px solid ${C.primary}`
                      : `1px solid ${C.border}`,
                    background: form.llmProvider === p.value ? '#FEF1F1' : C.cardBg,
                    color: form.llmProvider === p.value ? C.primary : C.text,
                    fontSize: 13, fontWeight: 600, fontFamily: FONT, cursor: 'pointer',
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="Model *">
            <select value={form.llmModel} onChange={e => setForm(f => ({ ...f, llmModel: e.target.value }))} style={inputStyle}>
              {provider.models.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label={`${provider.label} API Key`} hint={form.hasOwnApiKey && !form.llmApiKey
            ? `Currently set (${form.llmApiKeyMasked}). Leave blank to keep it, or paste a new key to rotate.`
            : `Leave blank to use the server-wide ${form.llmProvider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'} from backend/.env.`}>
            <div style={{ position: 'relative' }}>
              <input
                type={showKey ? 'text' : 'password'}
                value={form.llmApiKey}
                onChange={e => setForm(f => ({ ...f, llmApiKey: e.target.value }))}
                placeholder={form.llmApiKey ? '' : 'sk-... or sk-ant-...'}
                style={{ ...inputStyle, fontFamily: MONO, paddingRight: 38 }}
                autoComplete="off"
              />
              <button type="button" onClick={() => setShowKey(s => !s)}
                style={{
                  position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: C.textMuted, display: 'flex', padding: 6, borderRadius: 4,
                }}>
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </Field>
        </FieldRow>
      </Section>

      <Section title="WhatsApp" subtitle="The agent handles inbound messages on this number. Only one agent can be active per number.">
        <FieldRow>
          <Field label="Bound WhatsApp account">
            <select value={form.waAccountId || ''} onChange={e => setForm(f => ({ ...f, waAccountId: e.target.value }))} style={inputStyle}>
              <option value="">— None —</option>
              {waAccounts.map(w => (
                <option key={w.id} value={w.id}>{w.displayName} {w.displayPhoneNumber ? `(+${w.displayPhoneNumber})` : ''}</option>
              ))}
            </select>
          </Field>
        </FieldRow>
        <FieldRow>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
              style={{ width: 16, height: 16, cursor: 'pointer' }}
            />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Active</div>
              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
                When on, every inbound message on the bound number that isn't caught by a keyword automation runs this agent.
              </div>
            </div>
          </label>
        </FieldRow>
      </Section>

      <Section
        title="Advanced"
        subtitle="Tune memory window and tool-loop cost ceiling."
        rightSlot={
          <button type="button" onClick={() => setAdvancedOpen(o => !o)}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontSize: 12, color: C.primary, fontWeight: 600,
            }}>
            {advancedOpen ? 'Hide' : 'Show'}
          </button>
        }
      >
        {advancedOpen && (
          <>
            <FieldRow>
              <Field label="Context window (messages)" hint="How many recent chat_history rows to feed the model on each turn.">
                <input type="number" min={1} max={100}
                  value={form.contextWindowMessages}
                  onChange={e => setForm(f => ({ ...f, contextWindowMessages: parseInt(e.target.value, 10) || 20 }))}
                  style={inputStyle} />
              </Field>
              <Field label="Max tool iterations" hint="Hard cap on the LLM ↔ tool round-trips per inbound message.">
                <input type="number" min={1} max={20}
                  value={form.maxToolIterations}
                  onChange={e => setForm(f => ({ ...f, maxToolIterations: parseInt(e.target.value, 10) || 6 }))}
                  style={inputStyle} />
              </Field>
            </FieldRow>
          </>
        )}
      </Section>

      {!isCreate && (
        <Section title="Tools" subtitle="Attach Google Sheets so the agent can read/write rows during a conversation.">
          <AgentToolsList agentId={agentId} tools={tools} onChange={refresh} />
        </Section>
      )}
      {isCreate && (
        <Section title="Tools" subtitle="Save the agent first, then attach tools.">
          <div style={{ padding: 16, background: C.surfaceAlt, borderRadius: 8, fontSize: 12, color: C.textSecondary }}>
            You'll be able to add Google Sheets tools after the initial save.
          </div>
        </Section>
      )}

      {!isCreate && (
        <Section title="Recent runs" subtitle="Every inbound message that hit this agent. Click a row to see the LLM + tool trace.">
          <AgentRunsViewer agentId={agentId} />
        </Section>
      )}

      <ActionBar
        isCreate={isCreate}
        saving={saving}
        onSave={handleSave}
        onCancel={onCancel}
        onDelete={isAdmin && !isCreate ? () => setPendingDelete(true) : null}
      />

      {pendingDelete && (
        <DeleteConfirmModal
          title="Delete this agent?"
          message="This permanently removes the agent and its run history. WhatsApp messages to its bound number will fall back to keyword automations only."
          confirmLabel="Delete agent"
          onCancel={() => setPendingDelete(false)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}

/* ---------- shared bits ---------- */

const inputStyle = {
  width: '100%', padding: '10px 12px', borderRadius: 8,
  border: `1px solid ${C.border}`, fontSize: 14, fontFamily: FONT,
  color: C.text, background: C.cardBg, outline: 'none',
  boxSizing: 'border-box',
};

function Section({ title, subtitle, children, rightSlot }) {
  return (
    <div style={{ marginBottom: 28, padding: 20, background: C.cardBg, borderRadius: 12, border: `1px solid ${C.border}` }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, gap: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text, letterSpacing: '-.01em' }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12, color: C.textMuted, marginTop: 3 }}>{subtitle}</div>}
        </div>
        {rightSlot}
      </div>
      {children}
    </div>
  );
}

function FieldRow({ children }) {
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
      {children}
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div style={{ flex: '1 1 240px', minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.textSecondary,
        textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 6, lineHeight: 1.45 }}>{hint}</div>}
    </div>
  );
}

function ActionBar({ isCreate, saving, onSave, onCancel, onDelete }) {
  return (
    <div style={{
      position: 'sticky', bottom: 0, marginTop: 16,
      background: C.pageBg, padding: '14px 0',
      borderTop: `1px solid ${C.border}`,
      display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end',
    }}>
      {onDelete && (
        <button type="button" onClick={onDelete}
          style={{
            marginRight: 'auto',
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '10px 14px', borderRadius: 8,
            border: '1px solid #FBC8C8', background: '#fff',
            color: C.primary, fontSize: 13, fontFamily: FONT, fontWeight: 600,
            cursor: 'pointer',
          }}>
          <Trash2 size={13} /> Delete
        </button>
      )}
      <button type="button" onClick={onCancel}
        style={{
          padding: '10px 14px', borderRadius: 8,
          border: `1px solid ${C.border}`, background: C.cardBg,
          color: C.text, fontSize: 13, fontFamily: FONT, fontWeight: 600,
          cursor: 'pointer',
        }}>
        Cancel
      </button>
      <button type="button" onClick={onSave} disabled={saving}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '10px 18px', borderRadius: 8,
          border: 'none', background: C.primary, color: '#fff',
          fontSize: 13, fontFamily: FONT, fontWeight: 700,
          cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1,
        }}>
        {saving ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={13} />}
        {isCreate ? 'Create agent' : 'Save changes'}
      </button>
    </div>
  );
}

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
