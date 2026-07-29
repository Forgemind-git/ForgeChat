import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, ChevronRight, Loader2 } from 'lucide-react';
import { api } from '../../api.js';
import { C, FONT } from '../../constants.js';
import GoogleIntegrationsTab from './GoogleIntegrationsTab.jsx';
import AiModelsTab from './AiModelsTab.jsx';

/**
 * Settings → Integrations.
 *
 * A card grid of available integrations. Clicking a card drills into that
 * integration's own detail page (its API/credentials and what's connected),
 * routed via the hash: #/admin-settings/integrations/<key>. The two cards:
 *   - Google     → Google Sheets/Calendar/Gmail accounts (OAuth)
 *   - AI Models  → Anthropic / OpenAI provider keys
 *
 * Deep links (e.g. the Google OAuth callback redirecting to
 * .../integrations/google?google=connected) land directly on the detail view.
 */
export default function IntegrationsTab({ subParts = [], navigate }) {
  const selected = subParts[1] || null;
  const goCards = () => navigate && navigate('admin-settings', 'integrations');
  const goDetail = (key) => navigate && navigate('admin-settings', 'integrations', key);

  if (selected === 'google') {
    return <DetailShell title="Google" onBack={goCards}><GoogleIntegrationsTab /></DetailShell>;
  }
  if (selected === 'ai-models') {
    return <DetailShell title="AI Models" onBack={goCards}><AiModelsTab /></DetailShell>;
  }
  return <CardGrid onOpen={goDetail} />;
}

function DetailShell({ title, onBack, children }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '14px 40px 0', flexShrink: 0, fontFamily: FONT,
      }}>
        <button onClick={onBack}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 10px', borderRadius: 8, border: 'none',
            background: 'transparent', cursor: 'pointer',
            fontSize: 13, fontWeight: 600, color: C.textSecondary, fontFamily: FONT,
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#f0f2f5'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
        >
          <ArrowLeft size={15} /> Integrations
        </button>
        <ChevronRight size={14} color={C.textMuted} />
        <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{title}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {children}
      </div>
    </div>
  );
}

function CardGrid({ onOpen }) {
  const [google, setGoogle] = useState({ configured: null, count: 0 });
  const [modelCount, setModelCount] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [gStatus, models] = await Promise.all([
        api.googleIntegrations.status().catch(() => ({ configured: false })),
        api.aiModels.list().catch(() => []),
      ]);
      let count = 0;
      if (gStatus.configured) {
        const accts = await api.googleIntegrations.list().catch(() => []);
        count = Array.isArray(accts) ? accts.length : 0;
      }
      setGoogle({ configured: !!gStatus.configured, count });
      setModelCount(Array.isArray(models) ? models.length : 0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ flex: 1, padding: '32px 40px', overflowY: 'auto', fontFamily: FONT }}>
      <div style={{ width: '100%' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: 0, letterSpacing: '-.02em' }}>Integrations</h1>
        <p style={{ fontSize: 12, color: C.textMuted, margin: '4px 0 24px' }}>
          Connect the services your AI Agents and automations use. Click a card to manage it.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          <IntegrationCard
            title="Google"
            status={
              loading ? <Muted><Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> Checking…</Muted>
                : google.configured === false ? <Muted>Not configured</Muted>
                : google.count > 0 ? <Connected>{google.count} account{google.count === 1 ? '' : 's'} connected</Connected>
                : <Muted>No accounts connected</Muted>
            }
            onClick={() => onOpen('google')}
          />
          <IntegrationCard
            title="AI Models"
            status={
              loading ? <Muted><Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> Checking…</Muted>
                : modelCount > 0 ? <Connected>{modelCount} provider{modelCount === 1 ? '' : 's'} connected</Connected>
                : <Muted>No models connected</Muted>
            }
            onClick={() => onOpen('ai-models')}
          />
        </div>

        <div style={{ marginTop: 24, padding: 14, background: 'var(--c-surfaceAlt)', border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 12, color: C.textSecondary, lineHeight: 1.7 }}>
          <div style={{ fontWeight: 600, color: C.text, marginBottom: 4 }}>How your agents use these</div>
          Once connected, your AI Agents and automations can call into them:
          <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
            <li><b>Google Sheets</b> — agents read &amp; write rows during a conversation.</li>
            <li><b>AI Models</b> — agents run on your connected Anthropic / OpenAI provider.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function IntegrationCard({ title, status, onClick }) {
  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: 18, borderRadius: 12, background: C.cardBg,
        border: `1px solid ${C.border}`, cursor: 'pointer',
        transition: 'box-shadow .15s, border-color .15s', fontFamily: FONT,
      }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = C.shadowMd; e.currentTarget.style.borderColor = '#D6D6CE'; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.borderColor = C.border; }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{title}</div>
        <div style={{ marginTop: 8 }}>{status}</div>
      </div>
      <ChevronRight size={18} color={C.textMuted} style={{ flexShrink: 0 }} />
    </div>
  );
}

// Status pill — green when connected, muted grey otherwise (matches the
// FORGECHAT integrations card look).
function Connected({ children }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: '#dcfce7', color: '#15803d' }}>
      {children}
    </span>
  );
}

function Muted({ children }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: 'var(--c-surfaceAlt)', color: C.textMuted }}>
      {children}
    </span>
  );
}
