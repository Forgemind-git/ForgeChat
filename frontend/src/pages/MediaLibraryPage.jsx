import { useEffect, useRef, useState } from 'react';
import {
  Upload, Image as ImageIcon, Video, FileText, Music, RefreshCw,
  Trash2, Copy, AlertTriangle, Power,
} from 'lucide-react';
import { api } from '../api.js';
import { C, FONT, MONO, maskPhone } from '../constants.js';

const TYPE_META = {
  image:    { Icon: ImageIcon, label: 'Image',    color: '#3B82F6' },
  video:    { Icon: Video,     label: 'Video',    color: '#8B5CF6' },
  audio:    { Icon: Music,     label: 'Audio',    color: '#10B981' },
  document: { Icon: FileText,  label: 'Document', color: '#F59E0B' },
};

const STATUS_META = {
  pending: { label: 'Not synced',   bg: '#F3F4F6', fg: '#6B7280' },
  syncing: { label: 'Syncing…',     bg: '#EFF6FF', fg: '#3B82F6' },
  synced:  { label: 'Synced',       bg: '#ECFDF5', fg: '#059669' },
  failed:  { label: 'Failed',       bg: '#FEF2F2', fg: '#DC2626' },
  expired: { label: 'Expired',      bg: '#FEF3C7', fg: '#B45309' },
};

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short', day: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function daysUntil(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.round(ms / (24 * 3600 * 1000));
}

export default function MediaLibraryPage() {
  const [media, setMedia] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [previewMedia, setPreviewMedia] = useState(null);
  const [syncingKey, setSyncingKey] = useState(null);  // `${mediaId}:${accountId}`
  const [toast, setToast] = useState(null);

  const selectedAccount = accounts.find(a => Number(a.id) === Number(selectedAccountId)) || null;

  const showToast = (msg, kind = 'info') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3500);
  };

  // Load accounts once; the default account is the initial connected account.
  useEffect(() => {
    api.whatsappAccounts.list()
      .then(aRes => {
        const accs = aRes.accounts || aRes || [];
        setAccounts(accs);
        const def = accs.find(a => a.isDefault) || accs[0];
        setSelectedAccountId(def ? def.id : null);
        if (!def) setLoading(false);
      })
      .catch(err => { setError(err.message); setLoading(false); });
  }, []);

  // Load media. When an account is selected we scope to it (the backend also
  // includes any unassigned media); with no account configured we list all
  // media so uploads are still visible.
  const load = async () => {
    setLoading(true);
    try {
      const mRes = await api.mediaLibrary.list(selectedAccountId);
      setMedia(mRes.media || []);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [selectedAccountId]);

  const handleSync = async (mediaId, accountId) => {
    const key = `${mediaId}:${accountId}`;
    setSyncingKey(key);
    try {
      await api.mediaLibrary.sync(mediaId, accountId);
      showToast('Synced to Meta', 'ok');
      await load();
    } catch (err) {
      showToast(`Sync failed: ${err.message}`, 'err');
    } finally {
      setSyncingKey(null);
    }
  };

  const handleToggleAutoResync = async (m) => {
    try {
      await api.mediaLibrary.update(m.id, { autoResync: !m.autoResync });
      await load();
    } catch (err) { showToast(err.message, 'err'); }
  };

  const handleDelete = async (m) => {
    const displayName = m.name || m.originalName;
    if (!window.confirm(`Delete "${displayName}"? Synced Meta IDs will also be invalidated.`)) return;
    try {
      await api.mediaLibrary.delete(m.id);
      showToast('Deleted', 'ok');
      await load();
    } catch (err) { showToast(err.message, 'err'); }
  };

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
    showToast('Copied to clipboard', 'ok');
  };

  return (
    <div style={{ padding: 24, fontFamily: FONT, color: C.text, width: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 20, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>Media Library</h1>
          <p style={{ fontSize: 13, color: C.textSecondary, margin: '6px 0 0' }}>
            Media belongs to the connected WhatsApp account. Meta media IDs expire after 28 days —
            toggle <strong>Auto-resync</strong> to keep them fresh.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {accounts.length > 1 && (
            <select
              value={selectedAccountId || ''}
              onChange={e => setSelectedAccountId(e.target.value || null)}
              title="Connected account"
              style={{ padding: '9px 12px', borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT, fontSize: 13, background: C.cardBg, color: C.text, cursor: 'pointer' }}
            >
              {accounts.map(a => (
                <option key={a.id} value={a.id}>
                  {(a.displayName || maskPhone(a.displayPhoneNumber) || `Account ${a.id}`)}{a.isDefault ? ' · default' : ''}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => setUploadOpen(true)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '10px 16px', background: C.primary, color: '#fff',
              border: 'none', borderRadius: 8, fontFamily: FONT, fontWeight: 600,
              fontSize: 13, cursor: 'pointer',
            }}
          >
            <Upload size={15} /> Upload Media
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: 12, background: '#FEF2F2', color: '#991B1B', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 60, textAlign: 'center', color: C.textMuted }}>Loading…</div>
      ) : media.length === 0 ? (
        <EmptyState onUpload={() => setUploadOpen(true)} />
      ) : (
        <div style={{ background: C.cardBg, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
          {media.map((m, idx) => (
            <MediaRow
              key={m.id}
              media={m}
              account={selectedAccount}
              syncingKey={syncingKey}
              isLast={idx === media.length - 1}
              onSync={handleSync}
              onToggleAutoResync={() => handleToggleAutoResync(m)}
              onDelete={() => handleDelete(m)}
              onCopy={handleCopy}
              onPreview={() => setPreviewMedia(m)}
            />
          ))}
        </div>
      )}

      {uploadOpen && (
        <UploadModal
          accountId={selectedAccountId}
          onClose={() => setUploadOpen(false)}
          onUploaded={async () => { setUploadOpen(false); await load(); showToast('Uploaded', 'ok'); }}
          onError={(msg) => showToast(msg, 'err')}
        />
      )}

      {previewMedia && (
        <PreviewModal media={previewMedia} onClose={() => setPreviewMedia(null)} />
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, padding: '10px 16px',
          background: toast.kind === 'err' ? '#991B1B' : toast.kind === 'ok' ? '#065F46' : '#111',
          color: '#fff', borderRadius: 8, fontSize: 13, fontWeight: 600,
          boxShadow: C.shadowLg, zIndex: 1000,
        }}>{toast.msg}</div>
      )}
    </div>
  );
}

function MediaRow({ media, account, syncingKey, isLast, onSync, onToggleAutoResync, onDelete, onCopy, onPreview }) {
  const meta = TYPE_META[media.mediaType] || TYPE_META.document;
  const Icon = meta.Icon;
  // Media belongs to exactly one connected account, so a single sync row is
  // relevant (the list endpoint already scopes syncs to the owning account).
  const sync = (media.syncs && media.syncs[0]) || { status: 'pending' };
  const s = STATUS_META[sync.status] || STATUS_META.pending;
  const days = daysUntil(sync.expiresAt);
  const isSyncing = !!account && syncingKey === `${media.id}:${account.id}`;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 18px', borderBottom: isLast ? 'none' : `1px solid ${C.border}` }}>
      <div style={{
        width: 44, height: 44, borderRadius: 8, background: `${meta.color}18`,
        color: meta.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        overflow: 'hidden', position: 'relative',
      }}>
        {media.mediaType === 'image' ? (
          <img
            src={api.mediaLibrary.downloadUrl(media.id)}
            alt={media.originalName}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : media.mediaType === 'video' ? (
          <video
            src={api.mediaLibrary.downloadUrl(media.id)}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            preload="metadata"
            muted
          />
        ) : (
          <Icon size={20} />
        )}
        {media.mediaType === 'video' && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none',
          }}>
            <div style={{
              width: 18, height: 18, borderRadius: '50%', background: 'rgba(0,0,0,.5)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <div style={{
                width: 0, height: 0, borderStyle: 'solid', borderWidth: '4px 0 4px 6px',
                borderColor: 'transparent transparent transparent #fff', marginLeft: 2,
              }} />
            </div>
          </div>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          onClick={onPreview}
          title={media.name || media.originalName}
          style={{
            fontWeight: 600, fontSize: 14, marginBottom: 2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            color: C.primary, cursor: 'pointer', textDecoration: 'underline',
            textUnderlineOffset: 2,
          }}
        >
          {media.name || media.originalName}
        </div>
        <div style={{ fontSize: 12, color: C.textSecondary, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{meta.label}</span>
          <span>•</span>
          <span>{fmtBytes(media.sizeBytes)}</span>
          <span>•</span>
          <span>Uploaded {fmtDate(media.uploadedAt)}</span>
          <span>•</span>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '2px 8px', borderRadius: 4, background: s.bg, color: s.fg, fontWeight: 600,
          }}>
            {s.label}
            {sync.status === 'synced' && days != null && (
              <span style={{ color: days < 3 ? '#B45309' : s.fg }}>&nbsp;· expires in {days}d</span>
            )}
          </span>
          {sync.metaMediaId && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: MONO, fontSize: 11 }}>
              {sync.metaMediaId.length > 18 ? sync.metaMediaId.slice(0, 16) + '…' : sync.metaMediaId}
              <button
                onClick={() => onCopy(sync.metaMediaId)}
                title="Copy media ID"
                style={{ padding: 2, border: 'none', background: 'transparent', cursor: 'pointer', color: C.textSecondary }}
              >
                <Copy size={11} />
              </button>
            </span>
          )}
          {sync.lastError && (
            <span style={{ color: '#991B1B', display: 'inline-flex', alignItems: 'center', gap: 4 }} title={sync.lastError}>
              <AlertTriangle size={11} /> {sync.lastError.slice(0, 50)}
            </span>
          )}
        </div>
      </div>

      {/* Auto-resync toggle */}
      <button
        onClick={onToggleAutoResync}
        title={media.autoResync ? 'Disable auto-resync' : 'Enable auto-resync (refresh ~24h before expiry)'}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '7px 12px', borderRadius: 6,
          background: media.autoResync ? '#ECFDF5' : 'var(--c-hover)',
          color: media.autoResync ? '#059669' : '#6B7280',
          border: `1px solid ${media.autoResync ? '#A7F3D0' : '#E5E7EB'}`,
          cursor: 'pointer', fontFamily: FONT, fontSize: 12, fontWeight: 600,
        }}
      >
        <Power size={13} /> Auto-resync {media.autoResync ? 'ON' : 'OFF'}
      </button>

      {/* Single sync to the connected account */}
      <button
        onClick={() => account && onSync(media.id, account.id)}
        disabled={!account || isSyncing}
        title={account ? 'Sync this media to Meta for the connected account' : 'No connected account'}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '7px 12px', borderRadius: 6,
          background: sync.status === 'synced' ? 'var(--c-cardBg)' : C.primary,
          color: sync.status === 'synced' ? C.text : '#fff',
          border: sync.status === 'synced' ? `1px solid ${C.border}` : 'none',
          cursor: !account || isSyncing ? 'wait' : 'pointer',
          fontFamily: FONT, fontSize: 12, fontWeight: 600,
          opacity: !account || isSyncing ? 0.6 : 1,
        }}
      >
        <RefreshCw size={12} className={isSyncing ? 'spin' : ''} />
        {isSyncing ? 'Syncing…' : sync.status === 'synced' ? 'Re-sync' : 'Sync to Meta'}
      </button>

      <button
        onClick={onDelete}
        title="Delete"
        style={{
          padding: 8, borderRadius: 6, background: 'var(--c-cardBg)',
          border: `1px solid ${C.border}`, cursor: 'pointer', color: '#991B1B',
        }}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function EmptyState({ onUpload }) {
  return (
    <div style={{
      background: C.cardBg, border: `1px dashed ${C.border}`, borderRadius: 12,
      padding: 60, textAlign: 'center',
    }}>
      <ImageIcon size={36} style={{ color: C.textMuted, marginBottom: 12 }} />
      <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>No media yet</div>
      <div style={{ fontSize: 13, color: C.textSecondary, marginBottom: 18 }}>
        Upload images, videos, audio or documents. Sync to Meta when you're ready to use them in chats or broadcasts.
      </div>
      <button
        onClick={onUpload}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '10px 18px', background: C.primary, color: '#fff',
          border: 'none', borderRadius: 8, fontFamily: FONT, fontWeight: 600,
          fontSize: 13, cursor: 'pointer',
        }}
      >
        <Upload size={15} /> Upload your first media
      </button>
    </div>
  );
}

function UploadModal({ accountId, onClose, onUploaded, onError }) {
  const [file, setFile] = useState(null);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef(null);

  const handleFileChange = (f) => {
    setFile(f);
    if (f) {
      // Pre-fill name from filename without extension
      const base = f.name.replace(/\.[^/.]+$/, '');
      setName(base);
    } else {
      setName('');
    }
  };

  const submit = async () => {
    if (!file) return;
    setUploading(true);
    try {
      await api.mediaLibrary.upload(file, name || null, notes || null, accountId);
      await onUploaded();
    } catch (err) {
      onError(err.message);
      setUploading(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--c-cardBg)', borderRadius: 12, padding: 24, width: 480,
          boxShadow: C.shadowLg,
        }}
      >
        <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700 }}>Upload Media</h2>

        <div
          onClick={() => inputRef.current?.click()}
          style={{
            border: `2px dashed ${file ? C.primary : C.border}`,
            borderRadius: 8, padding: 28, textAlign: 'center', cursor: 'pointer',
            background: file ? '#FFF7F7' : '#FAFAF8',
          }}
        >
          <Upload size={28} style={{ color: file ? C.primary : C.textMuted, marginBottom: 8 }} />
          <div style={{ fontWeight: 600, fontSize: 13 }}>
            {file ? file.name : 'Click to choose a file'}
          </div>
          {file && (
            <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 4 }}>
              {fmtBytes(file.size)} · {file.type || 'unknown'}
            </div>
          )}
          {!file && (
            <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 4 }}>
              Image, Video, Audio, or Document (max 50 MB)
            </div>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
            style={{ display: 'none' }}
            onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
          />
        </div>

        <div style={{ marginTop: 14 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.textSecondary, marginBottom: 4 }}>
            Name <span style={{ fontWeight: 400, color: C.textMuted }}>(optional)</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Diwali greeting v2"
            style={{
              width: '100%', padding: '8px 10px', borderRadius: 6,
              border: `1px solid ${C.border}`, fontFamily: FONT, fontSize: 13,
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ marginTop: 12 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.textSecondary, marginBottom: 4 }}>
            Notes <span style={{ fontWeight: 400, color: C.textMuted }}>(optional)</span>
          </label>
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Internal notes about this media"
            style={{
              width: '100%', padding: '8px 10px', borderRadius: 6,
              border: `1px solid ${C.border}`, fontFamily: FONT, fontSize: 13,
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button
            onClick={onClose}
            disabled={uploading}
            style={{
              padding: '9px 14px', borderRadius: 6, background: 'var(--c-cardBg)',
              border: `1px solid ${C.border}`, cursor: 'pointer',
              fontFamily: FONT, fontSize: 13, fontWeight: 600, color: C.text,
            }}
          >Cancel</button>
          <button
            onClick={submit}
            disabled={!file || uploading}
            style={{
              padding: '9px 16px', borderRadius: 6,
              background: !file ? 'var(--c-hover)' : C.primary,
              color: '#fff', border: 'none',
              cursor: !file || uploading ? 'not-allowed' : 'pointer',
              fontFamily: FONT, fontSize: 13, fontWeight: 600,
            }}
          >{uploading ? 'Uploading…' : 'Upload'}</button>
        </div>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } } .spin { animation: spin 1s linear infinite; }`}</style>
    </div>
  );
}


function PreviewModal({ media, onClose }) {
  const displayName = media.name || media.originalName;
  const isImage = media.mediaType === 'image';
  const isVideo = media.mediaType === 'video';
  const isAudio = media.mediaType === 'audio';
  const downloadUrl = api.mediaLibrary.downloadUrl(media.id);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
        padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--c-cardBg)', borderRadius: 12, maxWidth: 720, width: '100%',
          maxHeight: '90vh', display: 'flex', flexDirection: 'column',
          boxShadow: '0 24px 48px rgba(0,0,0,.35)',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', borderBottom: `1px solid ${C.border}`,
        }}>
          <div style={{ fontWeight: 700, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {displayName}
          </div>
          <button
            onClick={onClose}
            style={{
              padding: '4px 10px', borderRadius: 6, background: 'var(--c-hover)',
              border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: 12, fontWeight: 600,
              color: C.text,
            }}
          >Close</button>
        </div>

        {/* Media viewport */}
        <div style={{
          flex: 1, overflow: 'auto', padding: 18,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#0f0f0f',
          minHeight: 200,
        }}>
          {isImage ? (
            <img
              src={downloadUrl}
              alt={displayName}
              style={{ maxWidth: '100%', maxHeight: '60vh', borderRadius: 8, objectFit: 'contain' }}
            />
          ) : isVideo ? (
            <video
              src={downloadUrl}
              controls
              style={{ maxWidth: '100%', maxHeight: '60vh', borderRadius: 8 }}
            />
          ) : isAudio ? (
            <div style={{ textAlign: 'center', color: '#fff' }}>
              <div style={{ fontSize: 13, marginBottom: 12, opacity: .8 }}>{displayName}</div>
              <audio src={downloadUrl} controls style={{ width: 320 }} />
            </div>
          ) : (
            <div style={{ textAlign: 'center', color: '#fff' }}>
              <FileText size={48} style={{ opacity: .5, marginBottom: 12 }} />
              <div style={{ fontSize: 14, marginBottom: 4 }}>{displayName}</div>
              <div style={{ fontSize: 12, opacity: .6 }}>{media.mimeType} · {fmtBytes(media.sizeBytes)}</div>
            </div>
          )}
        </div>

        {/* Footer info */}
        <div style={{
          padding: '12px 18px', borderTop: `1px solid ${C.border}`,
          fontSize: 12, color: C.textSecondary, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center',
        }}>
          <span><strong>Type:</strong> {(TYPE_META[media.mediaType] || TYPE_META.document).label}</span>
          <span><strong>Size:</strong> {fmtBytes(media.sizeBytes)}</span>
          <span><strong>Uploaded:</strong> {fmtDate(media.uploadedAt)}</span>
          {media.notes && <span style={{ color: C.textMuted }}><strong>Notes:</strong> {media.notes}</span>}
          <a
            href={downloadUrl}
            download={displayName}
            style={{ marginLeft: 'auto', color: C.primary, fontWeight: 600, textDecoration: 'none' }}
          >
            Download
          </a>
        </div>
      </div>
    </div>
  );
}
