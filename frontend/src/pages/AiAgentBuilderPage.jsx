import { useState, useEffect, useCallback } from 'react';
import { Bot, Plus, Loader2 } from 'lucide-react';
import { api } from '../api.js';
import { C, FONT } from '../constants.js';
import AgentEditor from '../components/agents/AgentEditor.jsx';
import AgentList from '../components/agents/AgentList.jsx';

/**
 * AI Agents top-level page.
 *
 * Two views, toggled by local state:
 *   - list view: table of all agents with an "Edit" button per row + "New agent" CTA
 *   - editor view: full agent CRUD (settings, tools, runs)
 *
 * No nested routing — keeping it intentionally simple. The editor view writes
 * back to the same agents list on save, so users get an instant refresh.
 */
export default function AiAgentBuilderPage({ user, navigate }) {
  const [agents, setAgents] = useState([]);
  const [waAccounts, setWaAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null); // null = list view, 'new' = create, <number> = edit

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [a, w] = await Promise.all([
        api.agents.list(),
        api.whatsappAccounts.list().catch(() => []),
      ]);
      setAgents(a);
      setWaAccounts(w);
    } catch (e) {
      setError(prettyError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', background: C.pageBg, fontFamily: FONT, overflow: 'hidden' }}>
      <Header
        editing={editingId !== null}
        onBack={() => { setEditingId(null); refresh(); }}
        onNew={() => setEditingId('new')}
        agentCount={agents.length}
      />

      {error && (
        <div style={{ padding: '10px 16px', margin: '12px 24px 0', borderRadius: 8,
          background: '#FCEBEB', color: '#A32D2D', border: '1px solid #FBC8C8',
          fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto' }}>
        {editingId === null && (
          loading
            ? <Loading />
            : <AgentList
                agents={agents}
                waAccounts={waAccounts}
                onEdit={(id) => setEditingId(id)}
                onCreate={() => setEditingId('new')}
              />
        )}
        {editingId !== null && (
          <AgentEditor
            agentId={editingId === 'new' ? null : editingId}
            waAccounts={waAccounts}
            user={user}
            navigate={navigate}
            onDone={() => { setEditingId(null); refresh(); }}
            onCancel={() => setEditingId(null)}
          />
        )}
      </div>
    </div>
  );
}

function Header({ editing, onBack, onNew, agentCount }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '16px 24px', background: C.cardBg, borderBottom: `1px solid ${C.border}`,
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Bot size={18} color={C.primary} />
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text, letterSpacing: '-.01em' }}>
            AI Agents
          </div>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>
            LLM-driven WhatsApp assistants · {agentCount} configured
          </div>
        </div>
      </div>
      {!editing && (
        <button
          onClick={onNew}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '9px 14px', borderRadius: 8, border: 'none',
            background: C.primary, color: '#fff', cursor: 'pointer',
            fontSize: 13, fontFamily: FONT, fontWeight: 700,
          }}
        >
          <Plus size={14} /> New agent
        </button>
      )}
      {editing && (
        <button
          onClick={onBack}
          style={{
            padding: '9px 14px', borderRadius: 8,
            border: `1px solid ${C.border}`, background: C.cardBg,
            color: C.text, cursor: 'pointer',
            fontSize: 13, fontFamily: FONT, fontWeight: 600,
          }}
        >
          Back to agents
        </button>
      )}
    </div>
  );
}

function Loading() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60, gap: 8, color: C.textMuted, fontSize: 13 }}>
      <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Loading agents…
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
