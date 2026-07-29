import { useState, useEffect, useCallback } from 'react';
import { Save, X, Loader2, AlertCircle, ExternalLink } from 'lucide-react';
import { api } from '../../api.js';
import { C, FONT } from '../../constants.js';
import SearchableSelect from '../SearchableSelect.jsx';

const OPS = [
  { key: 'read',   label: 'Read',   desc: 'Look up existing rows' },
  { key: 'append', label: 'Append', desc: 'Add a new row' },
  { key: 'update', label: 'Update', desc: 'Overwrite a specific range' },
  { key: 'upsert', label: 'Upsert (recommended for logging)', desc: 'Find a row by a key column (e.g. phone) and update it, or add it if new — no duplicate rows, no column tracking' },
];

// Scopes that let us list the account's PRE-EXISTING spreadsheets. Mirrors the
// backend's canListDriveFiles: an account connected with only drive.file can't
// see them, so the picker is empty — we prompt a reconnect instead of showing
// a blank dropdown with no explanation.
const DRIVE_LIST_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive',
];
const accountCanListSheets = (account) =>
  Array.isArray(account?.scopes) && account.scopes.some(s => DRIVE_LIST_SCOPES.includes(s));

/**
 * Picker / editor for one Google Sheets agent tool. Step-by-step UX:
 *  1. Pick the connected Google account.
 *  2. Pick the spreadsheet (lists via Drive API).
 *  3. Pick the tab inside it.
 *  4. Choose which ops the agent is allowed to call.
 *
 * When editing an existing tool, fields are pre-populated and the user can
 * change any of them — saving re-encodes the whole config.
 */
export default function GoogleSheetsToolConfig({ agentId, existingTool, onCancel, onSaved }) {
  const isEdit = !!existingTool;
  const initial = existingTool?.config || {};

  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState(initial.google_account_id || '');
  const [spreadsheets, setSpreadsheets] = useState([]);
  const [spreadsheetId, setSpreadsheetId] = useState(initial.spreadsheet_id || '');
  const [spreadsheetName, setSpreadsheetName] = useState(initial.spreadsheet_name || '');
  const [tabs, setTabs] = useState([]);
  const [sheetName, setSheetName] = useState(initial.sheet_name || '');
  const [ops, setOps] = useState(Array.isArray(initial.ops) ? initial.ops : ['read', 'append']);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingSheets, setLoadingSheets] = useState(false);
  const [loadingTabs, setLoadingTabs] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState('');

  // Load connected Google accounts on mount.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await api.googleIntegrations.list();
        if (!alive) return;
        setAccounts(list);
        if (list.length === 1 && !accountId) setAccountId(list[0].id);
      } catch (e) {
        setError(pretty(e));
      } finally {
        if (alive) setLoadingAccounts(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the account changes, load that account's spreadsheets.
  const loadSpreadsheets = useCallback(async (id) => {
    if (!id) return;
    setLoadingSheets(true); setError('');
    try {
      const list = await api.googleIntegrations.listSpreadsheets(id);
      setSpreadsheets(list);
    } catch (e) {
      setError(pretty(e));
    } finally {
      setLoadingSheets(false);
    }
  }, []);

  useEffect(() => {
    const acc = accounts.find(a => String(a.id) === String(accountId));
    // Only hit the picker endpoint for accounts that can actually list sheets;
    // otherwise we'd just get a 409 and a blank dropdown. The reconnect prompt
    // (rendered below) handles the missing-scope case.
    if (accountId && accountCanListSheets(acc)) {
      loadSpreadsheets(accountId);
    } else {
      setSpreadsheets([]);
    }
  }, [accountId, accounts, loadSpreadsheets]);

  // Re-run the OAuth consent for this account to add the drive.readonly scope.
  // Full-window navigation (Google's consent screen misbehaves in popups); the
  // callback lands back on Settings, and reconnecting the same email updates the
  // existing credential in place so this agent's tool binding stays valid.
  const handleReconnect = async () => {
    setReconnecting(true); setError('');
    try {
      const { authUrl } = await api.googleIntegrations.authorize();
      if (authUrl) window.location.href = authUrl;
      else throw new Error('Could not start Google authorization.');
    } catch (e) {
      setError(pretty(e));
      setReconnecting(false);
    }
  };

  // When the spreadsheet changes, load its tabs.
  useEffect(() => {
    if (!accountId || !spreadsheetId) return;
    let alive = true;
    setLoadingTabs(true); setError('');
    (async () => {
      try {
        const list = await api.googleIntegrations.listTabs(accountId, spreadsheetId);
        if (!alive) return;
        setTabs(list);
        // If the previously-saved tab isn't in the list (renamed?), clear.
        if (sheetName && !list.find(t => t.title === sheetName)) setSheetName(list[0]?.title || '');
        if (!sheetName) setSheetName(list[0]?.title || '');
      } catch (e) {
        if (alive) setError(pretty(e));
      } finally {
        if (alive) setLoadingTabs(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, spreadsheetId]);

  const handleSpreadsheetSelect = (id) => {
    setSpreadsheetId(id);
    const sel = spreadsheets.find(s => s.id === id);
    setSpreadsheetName(sel?.name || '');
    setSheetName('');
    setTabs([]);
  };

  const toggleOp = (key) => {
    setOps(prev => prev.includes(key) ? prev.filter(o => o !== key) : [...prev, key]);
  };

  const handleSave = async () => {
    if (!accountId || !spreadsheetId || !sheetName || ops.length === 0) {
      setError('Pick an account, spreadsheet, tab, and at least one operation.');
      return;
    }
    setSaving(true); setError('');
    try {
      const payload = {
        toolType: 'google_sheets',
        isEnabled: existingTool?.isEnabled !== false,
        config: {
          google_account_id: Number(accountId),
          spreadsheet_id: spreadsheetId,
          spreadsheet_name: spreadsheetName,
          sheet_name: sheetName,
          ops,
        },
      };
      if (isEdit) {
        await api.agents.updateTool(agentId, existingTool.id, payload);
      } else {
        await api.agents.addTool(agentId, payload);
      }
      onSaved();
    } catch (e) {
      setError(pretty(e));
    } finally {
      setSaving(false);
    }
  };

  if (loadingAccounts) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: C.textMuted, fontSize: 12 }}>
        <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', verticalAlign: 'middle', marginRight: 6 }} />
        Loading Google accounts…
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div style={{ padding: 16, background: C.surfaceAlt, borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12, fontFamily: FONT }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.text, fontWeight: 600, marginBottom: 6 }}>
          <AlertCircle size={14} /> No Google account connected
        </div>
        <div style={{ color: C.textSecondary, lineHeight: 1.5 }}>
          Connect a Google account in <strong>Settings → Google Integrations</strong> first, then come back here.
        </div>
        <button onClick={onCancel} style={cancelBtn}>Close</button>
      </div>
    );
  }

  const selectedAccount = accounts.find(a => String(a.id) === String(accountId));
  const needsReconnect = !!selectedAccount && !accountCanListSheets(selectedAccount);

  return (
    <div style={{
      padding: 16, background: C.surfaceAlt, borderRadius: 10,
      border: `1px solid ${C.border}`, fontFamily: FONT,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
          {isEdit ? 'Edit Google Sheets tool' : 'Add Google Sheets tool'}
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

      <Field label="Google account">
        <SearchableSelect
          value={accountId}
          onChange={(val) => setAccountId(val)}
          options={accounts.map(a => ({ value: String(a.id), label: a.accountLabel }))}
          placeholder="— Select —"
          searchPlaceholder="Search…"
        />
      </Field>

      <Field label="Spreadsheet" hint={needsReconnect ? undefined : "Lists the Google Sheets in your connected Drive, newest first. Don't see a recent one? Reconnect, or pick another account."}>
        {needsReconnect ? (
          <ReconnectCard account={selectedAccount} onReconnect={handleReconnect} reconnecting={reconnecting} />
        ) : loadingSheets ? (
          <div style={{ fontSize: 12, color: C.textMuted, padding: '8px 0' }}>
            <Loader2 size={12} style={{ animation: 'spin 1s linear infinite', verticalAlign: 'middle' }} /> Loading spreadsheets…
          </div>
        ) : (
          <>
            <SearchableSelect
              value={spreadsheetId}
              onChange={(val) => handleSpreadsheetSelect(val)}
              options={spreadsheets.map(s => ({ value: String(s.id), label: s.name }))}
              placeholder="— Select —"
              searchPlaceholder="Search…"
              disabled={!accountId}
            />
            {accountId && spreadsheets.length === 0 && (
              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 6, lineHeight: 1.45 }}>
                No spreadsheets found in this account’s Drive yet.
              </div>
            )}
          </>
        )}
      </Field>

      <Field label="Sheet tab">
        {loadingTabs ? (
          <div style={{ fontSize: 12, color: C.textMuted, padding: '8px 0' }}>
            <Loader2 size={12} style={{ animation: 'spin 1s linear infinite', verticalAlign: 'middle' }} /> Loading tabs…
          </div>
        ) : (
          <SearchableSelect
            value={sheetName}
            onChange={(val) => setSheetName(val)}
            options={tabs.map(t => ({ value: t.title, label: t.title }))}
            placeholder="— Select —"
            searchPlaceholder="Search…"
            disabled={!spreadsheetId}
          />
        )}
      </Field>

      <Field label="Allowed operations" hint="What the agent's LLM is allowed to do on this sheet. The model only ever sees the ops you enable here — extra safety on top of any prompt instructions.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {OPS.map(o => (
            <label key={o.key} style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              padding: '10px 12px', borderRadius: 8,
              border: ops.includes(o.key) ? `1.5px solid ${C.primary}` : `1px solid ${C.border}`,
              background: ops.includes(o.key) ? '#FEF1F1' : C.cardBg,
              cursor: 'pointer',
            }}>
              <input type="checkbox" checked={ops.includes(o.key)} onChange={() => toggleOp(o.key)}
                style={{ marginTop: 3 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{o.label}</div>
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{o.desc}</div>
              </div>
            </label>
          ))}
        </div>
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

// Shown in place of the spreadsheet dropdown when the selected Google account
// was connected without drive.readonly — so its existing sheets can't be listed.
function ReconnectCard({ account, onReconnect, reconnecting }) {
  return (
    <div style={{ padding: 14, borderRadius: 8, background: C.cardBg, border: `1px dashed ${C.border}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.text, fontWeight: 700, fontSize: 12.5, marginBottom: 6 }}>
        <AlertCircle size={14} color="#B45309" /> Can’t list this account’s spreadsheets
      </div>
      <div style={{ fontSize: 12, color: C.textSecondary, lineHeight: 1.55, marginBottom: 12 }}>
        <strong>{account?.accountLabel || 'This account'}</strong> was connected without permission to read your
        Google Drive, so your existing sheets don’t show up here. Reconnect it to grant read-only Drive access —
        the same account is updated in place, so this agent’s other tools keep working.
      </div>
      <button
        type="button"
        onClick={onReconnect}
        disabled={reconnecting}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '9px 14px', borderRadius: 8, border: 'none',
          background: C.primary, color: '#fff', fontSize: 12.5, fontFamily: FONT, fontWeight: 700,
          cursor: reconnecting ? 'wait' : 'pointer', opacity: reconnecting ? 0.7 : 1,
        }}
      >
        {reconnecting ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <ExternalLink size={13} />}
        Reconnect Google account
      </button>
      <div style={{ fontSize: 11, color: C.textMuted, marginTop: 8, lineHeight: 1.45 }}>
        You’ll be taken to Google and returned to Settings. Reopen this tool afterwards to pick a sheet.
      </div>
    </div>
  );
}

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
