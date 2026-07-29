import { useState } from 'react';
import { Plus, Trash2, FileSpreadsheet, AlertCircle, Power, Globe } from 'lucide-react';
import { api } from '../../api.js';
import { C, FONT, MONO } from '../../constants.js';
import GoogleSheetsToolConfig from './GoogleSheetsToolConfig.jsx';
import HttpToolConfig from './HttpToolConfig.jsx';

/**
 * Tool roster for an agent. Each tool type has an entry in TOOL_TYPES (icon +
 * menu copy), a config component (rendered when adding/editing), and a ToolRow
 * summary. Add a new type by extending all three.
 */
const TOOL_TYPES = [
  { type: 'google_sheets', label: 'Google Sheets', desc: 'Read, append, or update rows in a sheet.',
    icon: FileSpreadsheet, iconColor: '#0F7A38', iconBg: '#E6F4EA' },
  { type: 'http_request', label: 'HTTP request', desc: 'Call an external API / device / webhook.',
    icon: Globe, iconColor: '#2563EB', iconBg: '#E6EEFC' },
];

const toolMeta = (type) => TOOL_TYPES.find(t => t.type === type) || TOOL_TYPES[0];

export default function AgentToolsList({ agentId, tools, onChange }) {
  const [adding, setAdding] = useState(false);   // false | tool-type string
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(null); // tool row when editing existing
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  const handleToggle = async (t) => {
    setBusy(t.id); setError('');
    try {
      await api.agents.updateTool(agentId, t.id, { isEnabled: !t.isEnabled });
      await onChange();
    } catch (e) {
      setError(pretty(e));
    } finally {
      setBusy(null);
    }
  };

  const handleRemove = async (t) => {
    if (!window.confirm(`Remove this tool from the agent?`)) return;
    setBusy(t.id); setError('');
    try {
      await api.agents.removeTool(agentId, t.id);
      await onChange();
    } catch (e) {
      setError(pretty(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ fontFamily: FONT }}>
      {error && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 12px', borderRadius: 8,
          background: '#FCEBEB', color: '#A32D2D', border: '1px solid #FBC8C8', fontSize: 12, marginBottom: 12 }}>
          <AlertCircle size={13} /> {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tools.length === 0 && !adding && (
          <div style={{ padding: 16, background: C.surfaceAlt, borderRadius: 8,
            border: `1px dashed ${C.border}`, textAlign: 'center', fontSize: 12, color: C.textSecondary }}>
            No tools attached. Add a tool to let the agent do more during a chat.
          </div>
        )}

        {tools.map(t => (
          <ToolRow
            key={t.id}
            tool={t}
            busy={busy === t.id}
            onToggle={() => handleToggle(t)}
            onEdit={() => setEditing(t)}
            onRemove={() => handleRemove(t)}
          />
        ))}
      </div>

      {!adding && !editing && (
        <div style={{ position: 'relative', marginTop: 12, display: 'inline-block' }}>
          <button
            onClick={() => setMenuOpen(o => !o)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '9px 14px', borderRadius: 8,
              border: `1px dashed ${C.border}`, background: C.cardBg,
              color: C.text, fontSize: 13, fontFamily: FONT, fontWeight: 600,
              cursor: 'pointer',
            }}>
            <Plus size={13} /> Add tool
          </button>
          {menuOpen && (
            <>
              <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
              <div style={{
                position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 50,
                background: C.cardBg, border: `1px solid ${C.border}`, borderRadius: 10,
                boxShadow: C.shadowLg, padding: 6, minWidth: 240,
              }}>
                {TOOL_TYPES.map(t => {
                  const Icon = t.icon;
                  return (
                    <div key={t.type}
                      onClick={() => { setMenuOpen(false); setAdding(t.type); }}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 7, cursor: 'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#F5F5F0'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <div style={{ width: 30, height: 30, borderRadius: 7, background: t.iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Icon size={15} color={t.iconColor} />
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{t.label}</div>
                        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 1 }}>{t.desc}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {(adding || editing) && (() => {
        const activeType = editing ? editing.toolType : adding;
        const ConfigComp = activeType === 'http_request' ? HttpToolConfig : GoogleSheetsToolConfig;
        const close = () => { setAdding(false); setEditing(null); };
        return (
          <div style={{ marginTop: 16 }}>
            <ConfigComp
              agentId={agentId}
              existingTool={editing}
              onCancel={close}
              onSaved={async () => { close(); await onChange(); }}
            />
          </div>
        );
      })()}
    </div>
  );
}

function ToolRow({ tool, busy, onToggle, onEdit, onRemove }) {
  const cfg = tool.config || {};
  const meta = toolMeta(tool.toolType);
  const Icon = meta.icon;
  const isHttp = tool.toolType === 'http_request';
  const title = isHttp
    ? (cfg.label || 'HTTP request')
    : `${cfg.spreadsheet_name || cfg.spreadsheet_id} · ${cfg.sheet_name}`;
  const subtitle = isHttp
    ? `${cfg.method || 'GET'} · ${cfg.url || ''}`
    : `${(cfg.ops || []).join(' · ') || 'no ops enabled'} · acct #${cfg.google_account_id}`;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      padding: '12px 14px', background: C.cardBg, borderRadius: 8,
      border: `1px solid ${C.border}`, opacity: tool.isEnabled ? 1 : 0.55,
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: 8, background: meta.iconBg,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <Icon size={16} color={meta.iconColor} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {title}
        </div>
        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 3, fontFamily: MONO, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {subtitle}
        </div>
      </div>
      <button onClick={onToggle} disabled={busy} title={tool.isEnabled ? 'Disable' : 'Enable'}
        style={iconBtn}>
        <Power size={14} color={tool.isEnabled ? '#0F7A38' : C.textMuted} />
      </button>
      <button onClick={onEdit} disabled={busy}
        style={{ ...iconBtn, fontSize: 12, fontWeight: 600, padding: '6px 10px' }}>
        Edit
      </button>
      <button onClick={onRemove} disabled={busy}
        style={{ ...iconBtn, color: C.primary }}>
        <Trash2 size={14} />
      </button>
    </div>
  );
}

const iconBtn = {
  background: 'transparent', border: `1px solid ${C.border}`,
  borderRadius: 8, cursor: 'pointer', padding: '6px',
  color: C.textSecondary, display: 'flex', alignItems: 'center',
  fontFamily: FONT,
};

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
