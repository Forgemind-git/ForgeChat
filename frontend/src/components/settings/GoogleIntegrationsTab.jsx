import { useState, useEffect, useCallback } from 'react';
import {
  Plug, Trash2, RefreshCw, CheckCircle2, AlertCircle, Check,
  Key, Eye, EyeOff, Loader2, Copy,
} from 'lucide-react';
import { api } from '../../api.js';
import { C, FONT, MONO } from '../../constants.js';
import DeleteConfirmModal from '../DeleteConfirmModal.jsx';

/**
 * Settings → Google Integrations tab.
 *
 * Two layers live here:
 *   1. The workspace's Google OAuth *app* credentials (Client ID / Secret /
 *      Redirect URI) — configured by an admin directly in this UI and stored
 *      encrypted server-side. No env vars, no restart.
 *   2. The signed-in user's connected Google *accounts* — created by sending
 *      the user through Google's consent screen (full-window redirect).
 *
 * v1 surfaces Google Sheets only; the same credential row is reused for Gmail +
 * Calendar in a later release with no schema change.
 *
 * Reads ?google=connected|error from the URL after the OAuth callback redirects
 * back, so the UI can show a one-shot success / error banner.
 */

// The canonical callback Google must redirect to. Derived from the current
// origin so it's correct on every deployment without configuration.
const DEFAULT_REDIRECT = `${window.location.origin}/api/google-integrations/callback`;

export default function GoogleIntegrationsTab() {
  const [creds, setCreds] = useState(null); // { configured, clientId?, redirectUri? }
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [banner, setBanner] = useState(null); // { kind: 'ok'|'err', msg }

  const configured = creds ? !!creds.configured : null;
  const canManage = creds ? creds.canManage !== false : false;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      let c;
      try {
        // Admins get the full credential view including the saved Client Secret
        // (reveal=1) so the form shows exactly what is currently integrated.
        c = { ...(await api.googleIntegrations.getCredentials(true)), canManage: true };
      } catch (e) {
        // Non-admins may have access to this tab but not to manage the shared
        // app credentials — fall back to the public status probe so they can
        // still connect their own account once an admin has configured it.
        if (String(e?.message || '').startsWith('403')) {
          const s = await api.googleIntegrations.status();
          c = { configured: !!s.configured, redirectUri: s.redirectUri || '', canManage: false };
        } else {
          throw e;
        }
      }
      setCreds(c);
      setAccounts(c.configured ? await api.googleIntegrations.list() : []);
    } catch (e) {
      setError(prettyError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Surface ?google=connected|error from the OAuth callback redirect. The hash
  // route looks like #/admin-settings/integrations/google?google=connected&label=foo@x
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
      <div style={{ width: '100%' }}>
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

        {creds && canManage && <CredentialsCard creds={creds} onSaved={refresh} />}

        {creds && !canManage && configured === false && (
          <div style={{
            padding: 20, borderRadius: 12, background: C.cardBg,
            border: `1px solid ${C.border}`, marginBottom: 20, fontFamily: FONT,
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <AlertCircle size={16} color={C.textMuted} />
            <span style={{ fontSize: 13, color: C.textSecondary }}>
              Google isn't set up yet. Ask an admin to add the Google credentials under Settings → Integrations → Google.
            </span>
          </div>
        )}

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

      <DeleteConfirmModal
        open={!!pendingDelete}
        title="Disconnect Google account?"
        message={pendingDelete ? `This will revoke ForgeChat's access to ${pendingDelete.accountLabel}. Any agent tools using this account will stop working until reconnected.` : ''}
        confirmText="Disconnect"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => handleDisconnect(pendingDelete.id)}
      />
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
          Add your Google OAuth credentials, then connect accounts so AI Agents can read and write Google Sheets. Gmail and Calendar arrive in a future release.
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
 * The workspace's Google OAuth app credentials, shown as an always-populated
 * form so an admin can see exactly what is currently integrated.
 *
 * - Client ID is shown in full (it's not a secret — Google embeds it in the
 *   consent URL).
 * - Client Secret is pre-filled with the saved value (fetched with reveal=1,
 *   admin-only) and masked behind an eye toggle.
 * - The "Authorized redirect URI" is shown read-only with a Copy button so the
 *   admin can paste it verbatim into Google Cloud Console — a mismatch there is
 *   the #1 cause of the redirect_uri_mismatch error on the consent screen.
 */
function CredentialsCard({ creds, onSaved }) {
  const configured = !!creds.configured;
  const [form, setForm] = useState({
    clientId: creds.clientId || '',
    clientSecret: creds.clientSecret || '',
    redirectUri: creds.redirectUri || DEFAULT_REDIRECT,
  });
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [copied, setCopied] = useState(false);

  // Re-sync the form whenever the saved credentials change underneath (e.g.
  // after a save + refresh), so the fields always reflect what is integrated.
  useEffect(() => {
    setForm({
      clientId: creds.clientId || '',
      clientSecret: creds.clientSecret || '',
      redirectUri: creds.redirectUri || DEFAULT_REDIRECT,
    });
  }, [creds.clientId, creds.clientSecret, creds.redirectUri]);

  const copyRedirect = async () => {
    try {
      await navigator.clipboard.writeText(form.redirectUri || DEFAULT_REDIRECT);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {/* clipboard blocked — ignore */}
  };

  const save = async () => {
    setOkMsg('');
    if (!form.clientId.trim()) { setErr('Client ID is required.'); return; }
    if (!form.clientSecret.trim()) { setErr('Client Secret is required.'); return; }
    if (!form.redirectUri.trim()) { setErr('Redirect URI is required.'); return; }
    try {
      setSaving(true);
      setErr('');
      await api.googleIntegrations.saveCredentials({
        clientId: form.clientId.trim(),
        clientSecret: form.clientSecret.trim(),
        redirectUri: form.redirectUri.trim(),
      });
      await onSaved();
      setOkMsg('Credentials saved.');
      setTimeout(() => setOkMsg(''), 2500);
    } catch (e) {
      setErr(prettyError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      background: C.cardBg, border: `1px solid ${C.border}`,
      borderRadius: 12, padding: 20, marginBottom: 20, fontFamily: FONT,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <Key size={16} color={C.primary} />
        <div style={{ fontWeight: 600, fontSize: 14, color: C.text }}>Google API credentials</div>
        {configured
          ? <span style={{ fontSize: 11, padding: '2px 8px', background: '#dcfce7', color: '#15803d', borderRadius: 6, fontWeight: 700, letterSpacing: '.02em' }}>SAVED</span>
          : <span style={{ fontSize: 11, padding: '2px 8px', background: '#fef9c3', color: '#854d0e', borderRadius: 6, fontWeight: 700, letterSpacing: '.02em' }}>REQUIRED</span>}
      </div>

      <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 14, lineHeight: 1.6 }}>
        Create an OAuth 2.0 Client ID at{' '}
        <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" style={{ color: C.primary }}>
          console.cloud.google.com/apis/credentials
        </a>{' '}
        → choose <b>Web application</b> → add the redirect URI below to <b>Authorized redirect URIs</b> → enable the{' '}
        <b>Google Sheets</b> and <b>Google Drive</b> APIs in the same project.
      </div>

      {/* Read-only canonical redirect URI — the exact string that must be
          registered in Google Cloud, with a Copy button. */}
      <div style={{ marginBottom: 14 }}>
        <div style={labelStyle()}>Authorized redirect URI (paste this into Google Cloud)</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={form.redirectUri || DEFAULT_REDIRECT}
            readOnly
            style={{ ...inputStyle(), background: 'var(--c-surfaceAlt)', fontFamily: MONO, fontSize: 12 }}
          />
          <button onClick={copyRedirect} style={{ ...btnSecondary(), whiteSpace: 'nowrap' }}>
            {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
          </button>
        </div>
        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 6, lineHeight: 1.5 }}>
          This must be listed <b>exactly</b> under your OAuth client's Authorized redirect URIs, or Google
          shows <span style={{ fontFamily: MONO }}>redirect_uri_mismatch</span> on the consent screen.
        </div>
      </div>

      {err && (
        <div style={{
          padding: '8px 12px', borderRadius: 8, margin: '0 0 12px',
          background: '#FCEBEB', color: '#A32D2D', border: '1px solid #FBC8C8', fontSize: 12,
        }}>
          {err}
        </div>
      )}
      {okMsg && (
        <div style={{
          padding: '8px 12px', borderRadius: 8, margin: '0 0 12px',
          background: '#ECFDF5', color: '#065F46', border: '1px solid #A7F3D0', fontSize: 12,
        }}>
          {okMsg}
        </div>
      )}

      <div style={{ marginBottom: 12 }}>
        <div style={labelStyle()}>Client ID</div>
        <input
          value={form.clientId}
          onChange={e => setForm({ ...form, clientId: e.target.value })}
          placeholder="e.g. 123456789-abc.apps.googleusercontent.com"
          style={inputStyle()}
        />
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={labelStyle()}>Client Secret</div>
        <div style={{ position: 'relative' }}>
          <input
            type={showSecret ? 'text' : 'password'}
            value={form.clientSecret}
            onChange={e => setForm({ ...form, clientSecret: e.target.value })}
            placeholder="GOCSPX-..."
            style={{ ...inputStyle(), paddingRight: 38, fontFamily: showSecret ? MONO : FONT }}
          />
          <button
            type="button"
            onClick={() => setShowSecret(s => !s)}
            style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 0, cursor: 'pointer', color: C.textMuted, display: 'flex' }}
            title={showSecret ? 'Hide' : 'Show'}
          >
            {showSecret ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
      </div>

      <button onClick={save} disabled={saving} style={btnPrimary(saving)}>
        {saving
          ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</>
          : <><Check size={13} /> Save credentials</>}
      </button>
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
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, minWidth: 0, flex: 1 }}>
            <HealthDot status={a.healthStatus} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {a.accountLabel}
              </div>
              <ScopeChips scopes={a.scopes} />
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

/**
 * Renders every granted scope as a small chip with a friendly label and a
 * tooltip showing the full URL, so an admin can audit exactly what was granted.
 */
function ScopeChips({ scopes }) {
  const list = Array.isArray(scopes) ? scopes : [];
  if (list.length === 0) {
    return <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2, fontFamily: MONO }}>no scopes granted</div>;
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
      {list.map(s => (
        <span
          key={s}
          title={s}
          style={{
            fontSize: 10, fontWeight: 600,
            padding: '3px 8px', borderRadius: 999,
            background: 'var(--c-surfaceAlt)',
            border: `1px solid ${C.border}`,
            color: C.textSecondary,
            fontFamily: MONO, letterSpacing: '-.005em',
          }}
        >
          {friendlyScopeLabel(s)}
        </span>
      ))}
    </div>
  );
}

function friendlyScopeLabel(s) {
  if (s === 'openid') return 'openid';
  if (s === 'email') return 'email';
  if (s === 'profile') return 'profile';
  const m = s.match(/^https?:\/\/www\.googleapis\.com\/auth\/(.+)$/);
  if (m) return m[1];
  return s;
}

function HealthDot({ status }) {
  const ok = status === 'ok';
  return (
    <span
      title={ok ? 'Healthy' : (status || 'Unknown')}
      style={{
        width: 8, height: 8, borderRadius: '50%',
        background: ok ? '#10B981' : '#EF4444', flexShrink: 0, marginTop: 5,
      }}
    />
  );
}

// ── Shared inline-style helpers (kept local — this is the only screen that
//    renders an inline credentials form) ─────────────────────────────────────
function labelStyle() {
  return {
    display: 'block', fontSize: 11, fontWeight: 600,
    color: C.textSecondary, textTransform: 'uppercase',
    letterSpacing: '.04em', marginBottom: 6,
  };
}

function inputStyle() {
  return {
    width: '100%', padding: '9px 11px',
    border: `1px solid ${C.border}`, borderRadius: 8,
    fontSize: 13, fontFamily: FONT, color: C.text, background: C.cardBg,
    outline: 'none', boxSizing: 'border-box',
  };
}

function btnPrimary(disabled) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '8px 14px', background: disabled ? '#b0b0aa' : C.primary,
    color: '#fff', border: 0, borderRadius: 8, fontSize: 13, fontWeight: 600,
    fontFamily: FONT, cursor: disabled ? 'not-allowed' : 'pointer',
  };
}

function btnSecondary() {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '8px 12px', background: C.cardBg, color: C.text,
    border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontWeight: 500,
    fontFamily: FONT, cursor: 'pointer',
  };
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
