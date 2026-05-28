import { useState, useEffect, useCallback } from 'react';
import { Plug, Trash2, RefreshCw, ExternalLink, CheckCircle2, AlertCircle, Check } from 'lucide-react';
import { api } from '../../api.js';
import { C, FONT, MONO } from '../../constants.js';
import DeleteConfirmModal from '../DeleteConfirmModal.jsx';

/**
 * Settings → Google Integrations tab.
 *
 * Lists Google accounts the signed-in user has connected, lets them connect a
 * new one (full-window redirect to Google's consent screen), and disconnect
 * existing ones. v1 surfaces Google Sheets only — the underlying credential
 * row is reusable for Gmail + Calendar in a later release without changes
 * here other than UI copy.
 *
 * Reads ?google=connected|error from the URL after the OAuth callback redirects
 * back, so the UI can show a one-shot success / error banner.
 */
export default function GoogleIntegrationsTab() {
  const [configured, setConfigured] = useState(null);
  const [redirectUri, setRedirectUri] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [banner, setBanner] = useState(null); // { kind: 'ok'|'err', msg }

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const status = await api.googleIntegrations.status();
      setConfigured(!!status.configured);
      setRedirectUri(status.redirectUri || '');
      if (status.configured) {
        const rows = await api.googleIntegrations.list();
        setAccounts(rows);
      } else {
        setAccounts([]);
      }
    } catch (e) {
      setError(prettyError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Surface ?google=connected|error from the OAuth callback redirect. The hash
  // route looks like #/admin-settings/google-integrations?google=connected&label=foo@x
  useEffect(() => {
    const hash = window.location.hash || '';
    const qIdx = hash.indexOf('?');
    if (qIdx < 0) return;
    const params = new URLSearchParams(hash.slice(qIdx + 1));
    const status = params.get('google');
    if (!status) return;
    if (status === 'connected') {
      const label = params.get('label');
      setBanner({ kind: 'ok', msg: label ? `Connected ${label}` : 'Connected successfully' });
    } else if (status === 'error') {
      setBanner({ kind: 'err', msg: params.get('error') || 'Failed to connect Google account' });
    }
    // Strip the query so refreshes don't re-fire the banner.
    const cleanHash = hash.slice(0, qIdx);
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${cleanHash}`);
  }, []);

  const handleConnect = async () => {
    setConnecting(true);
    setError('');
    try {
      const { authUrl } = await api.googleIntegrations.authorize();
      // Full-window navigation, not a popup: Google's consent screen breaks
      // in popups in many browser configs, and the callback redirects cleanly
      // back to this same hash route.
      window.location.assign(authUrl);
    } catch (e) {
      setError(prettyError(e));
      setConnecting(false);
    }
  };

  const handleDisconnect = async (id) => {
    try {
      await api.googleIntegrations.disconnect(id);
      setPendingDelete(null);
      await refresh();
    } catch (e) {
      setError(prettyError(e));
    }
  };

  return (
    <div style={{ flex: 1, padding: '32px 40px', overflowY: 'auto', fontFamily: FONT }}>
      <div style={{ maxWidth: 900 }}>
        <Header onRefresh={refresh} loading={loading} />

        {banner && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 14px', borderRadius: 8, marginBottom: 16,
            background: banner.kind === 'ok' ? '#ECFDF5' : '#FCEBEB',
            color: banner.kind === 'ok' ? '#065F46' : '#A32D2D',
            border: `1px solid ${banner.kind === 'ok' ? '#A7F3D0' : '#FBC8C8'}`,
            fontSize: 13, fontFamily: FONT, fontWeight: 500,
          }}>
            {banner.kind === 'ok' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
            <span>{banner.msg}</span>
          </div>
        )}

        {error && (
          <div style={{
            padding: '10px 14px', borderRadius: 8, marginBottom: 16,
            background: '#FCEBEB', color: '#A32D2D',
            border: '1px solid #FBC8C8', fontSize: 13, fontFamily: FONT,
          }}>
            {error}
          </div>
        )}

        {redirectUri && <RedirectUriCard redirectUri={redirectUri} />}

        {configured === false && <NotConfiguredCard />}

        {configured === true && (
          <>
            <ConnectCard
              onConnect={handleConnect}
              connecting={connecting}
              hasAccounts={accounts.length > 0}
            />
            <AccountsList
              accounts={accounts}
              loading={loading}
              onDelete={(a) => setPendingDelete(a)}
            />
          </>
        )}
      </div>

      {pendingDelete && (
        <DeleteConfirmModal
          title="Disconnect Google account?"
          message={`This will revoke ForgeChat's access to ${pendingDelete.accountLabel}. Any agent tools using this account will stop working until reconnected.`}
          confirmLabel="Disconnect"
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => handleDisconnect(pendingDelete.id)}
        />
      )}
    </div>
  );
}

function Header({ onRefresh, loading }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 24 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: 0, letterSpacing: '-.02em', fontFamily: FONT }}>
          Google Integrations
        </h1>
        <p style={{ fontSize: 12, color: C.textMuted, margin: '4px 0 0', fontFamily: FONT }}>
          Connect Google accounts so AI Agents can read and write Google Sheets. Gmail and Calendar arrive in a future release.
        </p>
      </div>
      <button
        onClick={onRefresh}
        disabled={loading}
        title="Refresh"
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '8px 12px', borderRadius: 8,
          border: `1px solid ${C.border}`, background: C.cardBg,
          color: C.text, fontSize: 12, fontFamily: FONT, fontWeight: 600,
          cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.6 : 1,
        }}
      >
        <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} /> Refresh
      </button>
    </div>
  );
}

/**
 * Always-visible reference card showing the exact callback URL that needs to
 * be authorized in Google Cloud Console. Mismatches between this string and
 * what's listed under the OAuth Client's "Authorized redirect URIs" are the
 * single most common reason "Connect Google" fails with redirect_uri_mismatch
 * — surfacing it here (with a copy button) removes the guesswork.
 */
function RedirectUriCard({ redirectUri }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(redirectUri);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {/* clipboard blocked — fall through silently */}
  };
  return (
    <div style={{
      padding: 14, borderRadius: 10, marginBottom: 16,
      background: 'var(--c-surfaceAlt)', border: `1px solid ${C.border}`,
      fontFamily: FONT,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <strong style={{ fontSize: 12, color: C.text, letterSpacing: '-.01em' }}>
          Authorized redirect URI
        </strong>
        <span style={{ fontSize: 11, color: C.textMuted }}>
          — add this to your Google Cloud OAuth Client
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <code style={{
          flex: 1, padding: '8px 10px', borderRadius: 6,
          background: C.cardBg, border: `1px solid ${C.border}`,
          fontFamily: MONO, fontSize: 12, color: C.text,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          userSelect: 'all',
        }}>
          {redirectUri}
        </code>
        <button onClick={handleCopy}
          style={{
            padding: '8px 12px', borderRadius: 8,
            border: `1px solid ${C.border}`, background: C.cardBg,
            color: copied ? '#065F46' : C.text,
            fontSize: 12, fontFamily: FONT, fontWeight: 600,
            cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
          }}>
          {copied ? <><Check size={12} style={{ verticalAlign: 'middle' }} /> Copied</> : 'Copy'}
        </button>
      </div>
      <div style={{ fontSize: 11, color: C.textSecondary, marginTop: 8, lineHeight: 1.45 }}>
        Paste this <strong>exactly</strong> (including <code style={{ fontFamily: MONO }}>https://</code>) into
        Google Cloud Console → APIs &amp; Services → Credentials → your OAuth 2.0 Client →
        <strong> Authorized redirect URIs</strong>, then click Save. Without this, Google
        returns <code style={{ fontFamily: MONO }}>redirect_uri_mismatch</code> on consent.
      </div>
    </div>
  );
}

function NotConfiguredCard() {
  return (
    <div style={{
      padding: 20, borderRadius: 12, background: C.cardBg,
      border: `1px solid ${C.border}`, fontFamily: FONT,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <AlertCircle size={16} color={C.amber} />
        <strong style={{ fontSize: 14, color: C.text }}>Google OAuth isn't configured</strong>
      </div>
      <p style={{ fontSize: 13, color: C.textSecondary, margin: '0 0 12px', lineHeight: 1.55 }}>
        Set up an OAuth 2.0 Client in Google Cloud Console, then add these to <code style={{ fontFamily: MONO, fontSize: 12 }}>backend/.env</code> and restart ForgeChat:
      </p>
      <pre style={{
        margin: 0, padding: '12px 14px',
        background: 'var(--c-surfaceAlt)', borderRadius: 8,
        border: `1px solid ${C.border}`,
        fontFamily: MONO, fontSize: 12, color: C.text,
        overflowX: 'auto',
      }}>{`GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=https://<your-domain>/api/google-integrations/callback`}</pre>
      <a
        href="https://console.cloud.google.com/apis/credentials"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          marginTop: 12, fontSize: 12, color: C.primary, fontWeight: 600,
          textDecoration: 'none',
        }}
      >
        Open Google Cloud Credentials <ExternalLink size={12} />
      </a>
    </div>
  );
}

function ConnectCard({ onConnect, connecting, hasAccounts }) {
  return (
    <div style={{
      padding: 18, borderRadius: 12, background: C.cardBg,
      border: `1px solid ${C.border}`, marginBottom: 20,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
      fontFamily: FONT,
    }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 4 }}>
          {hasAccounts ? 'Connect another Google account' : 'Connect your first Google account'}
        </div>
        <div style={{ fontSize: 12, color: C.textSecondary }}>
          You'll be sent to Google to approve access. The app only sees files you explicitly grant.
        </div>
      </div>
      <button
        onClick={onConnect}
        disabled={connecting}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 16px', borderRadius: 8,
          background: C.primary, color: '#fff', border: 'none',
          fontSize: 13, fontFamily: FONT, fontWeight: 700,
          cursor: connecting ? 'wait' : 'pointer',
          opacity: connecting ? 0.7 : 1, whiteSpace: 'nowrap',
        }}
      >
        <Plug size={14} /> {connecting ? 'Redirecting…' : 'Connect Google'}
      </button>
    </div>
  );
}

function AccountsList({ accounts, loading, onDelete }) {
  if (loading && accounts.length === 0) {
    return <div style={{ fontSize: 13, color: C.textMuted, fontFamily: FONT }}>Loading…</div>;
  }
  if (accounts.length === 0) {
    return (
      <div style={{
        padding: 24, borderRadius: 12,
        background: 'var(--c-surfaceAlt)', border: `1px dashed ${C.border}`,
        textAlign: 'center', fontSize: 13, color: C.textSecondary, fontFamily: FONT,
      }}>
        No Google accounts connected yet.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {accounts.map(a => (
        <div
          key={a.id}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 16px', background: C.cardBg, borderRadius: 10,
            border: `1px solid ${C.border}`, fontFamily: FONT,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <HealthDot status={a.healthStatus} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {a.accountLabel}
              </div>
              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2, fontFamily: MONO }}>
                {a.scopes && a.scopes.length > 0
                  ? a.scopes.filter(s => s.includes('googleapis.com')).map(s => s.split('/').pop()).join(' · ')
                  : 'no scopes'}
              </div>
              {a.healthStatus === 'error' && a.lastErrorMessage && (
                <div style={{ fontSize: 11, color: '#A32D2D', marginTop: 4 }}>
                  {a.lastErrorMessage}
                </div>
              )}
            </div>
          </div>
          <button
            onClick={() => onDelete(a)}
            title="Disconnect"
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 10px', borderRadius: 8,
              border: '1px solid #FBC8C8', background: '#fff',
              color: C.primary, fontSize: 12, fontFamily: FONT, fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Trash2 size={13} /> Disconnect
          </button>
        </div>
      ))}
    </div>
  );
}

function HealthDot({ status }) {
  const ok = status === 'ok';
  return (
    <span
      title={ok ? 'Healthy' : (status || 'Unknown')}
      style={{
        width: 8, height: 8, borderRadius: '50%',
        background: ok ? '#10B981' : '#EF4444', flexShrink: 0,
      }}
    />
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
