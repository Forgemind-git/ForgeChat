import { Bot, MessageSquare, Edit3, Plus } from 'lucide-react';
import { C, FONT, MONO } from '../../constants.js';

/**
 * Read-only agent list. Each row: name + description + provider/model + bound
 * WA account + active status. Edit jumps into AgentEditor.
 */
export default function AgentList({ agents, waAccounts, onEdit, onCreate }) {
  if (agents.length === 0) {
    return <EmptyState onCreate={onCreate} />;
  }
  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {agents.map(a => (
          <Row key={a.id} agent={a} waAccounts={waAccounts} onEdit={() => onEdit(a.id)} />
        ))}
      </div>
    </div>
  );
}

function Row({ agent, waAccounts, onEdit }) {
  const wa = waAccounts.find(w => String(w.id) === String(agent.waAccountId));
  return (
    <div
      onClick={onEdit}
      style={{
        display: 'flex', alignItems: 'center', gap: 16,
        padding: '14px 18px', background: C.cardBg, borderRadius: 12,
        border: `1px solid ${C.border}`, cursor: 'pointer',
        transition: 'box-shadow .15s, border-color .15s',
        fontFamily: FONT,
      }}
      onMouseEnter={e => {
        e.currentTarget.style.boxShadow = C.shadowMd;
        e.currentTarget.style.borderColor = '#D6D6CE';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.boxShadow = 'none';
        e.currentTarget.style.borderColor = C.border;
      }}
    >
      <div style={{
        width: 36, height: 36, borderRadius: 10,
        background: agent.isActive ? '#FEF1F1' : '#F2F2EC',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <Bot size={18} color={agent.isActive ? C.primary : C.textMuted} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{agent.name}</div>
          <StatusPill active={agent.isActive} />
        </div>
        {agent.description && (
          <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {agent.description}
          </div>
        )}
        <div style={{ display: 'flex', gap: 14, marginTop: 6, fontSize: 11, color: C.textMuted, fontFamily: MONO }}>
          <span>{agent.llmProvider} · {agent.llmModel}</span>
          <span>· {agent.toolCount || 0} tool{(agent.toolCount || 0) === 1 ? '' : 's'}</span>
          {wa && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <MessageSquare size={11} /> {wa.displayName}
          </span>}
          {agent.lastRunAt && <span>· last run {formatRelative(agent.lastRunAt)}</span>}
        </div>
      </div>

      <button
        onClick={(e) => { e.stopPropagation(); onEdit(); }}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '7px 12px', borderRadius: 8,
          border: `1px solid ${C.border}`, background: C.cardBg,
          color: C.text, fontSize: 12, fontFamily: FONT, fontWeight: 600,
          cursor: 'pointer', flexShrink: 0,
        }}
      >
        <Edit3 size={12} /> Edit
      </button>
    </div>
  );
}

function StatusPill({ active }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '.04em',
      textTransform: 'uppercase',
      padding: '3px 8px', borderRadius: 999,
      background: active ? '#ECFDF5' : '#F2F2EC',
      color: active ? '#065F46' : C.textSecondary,
    }}>
      {active ? 'Active' : 'Paused'}
    </span>
  );
}

function EmptyState({ onCreate }) {
  return (
    <div style={{
      maxWidth: 560, margin: '64px auto', padding: 40,
      borderRadius: 16, background: C.cardBg, border: `1px solid ${C.border}`,
      textAlign: 'center', fontFamily: FONT,
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: 14, margin: '0 auto 16px',
        background: '#FEF1F1', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Bot size={28} color={C.primary} />
      </div>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: C.text, margin: '0 0 8px' }}>
        No agents yet
      </h2>
      <p style={{ fontSize: 13, color: C.textSecondary, margin: '0 0 22px', lineHeight: 1.55 }}>
        Create an AI agent to auto-reply to inbound WhatsApp messages.
        Attach a Google Sheet so the agent can look up bookings, save leads, or update orders.
      </p>
      <button
        onClick={onCreate}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '10px 18px', borderRadius: 8, border: 'none',
          background: C.primary, color: '#fff', cursor: 'pointer',
          fontSize: 13, fontFamily: FONT, fontWeight: 700,
        }}
      >
        <Plus size={14} /> Create your first agent
      </button>
    </div>
  );
}

function formatRelative(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}
