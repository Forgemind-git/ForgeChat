import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, X, Upload, Loader2, AlertCircle, Image, Video, Music, FileText, File as FileIcon, Link2 } from 'lucide-react';
import { api } from '../../api.js';
import { C, FONT } from '../../constants.js';
import SearchableSelect from '../SearchableSelect.jsx';

/**
 * Editor for an agent's media groups. Each group is a
 * { description, mediaIds[], links[] }: the description tells the agent WHEN to
 * send these, and the agent (via its send_media tool) delivers all of the
 * group's media files AND links when the conversation matches. Media items come
 * from the bound number's Media Library (pick existing OR upload here); links
 * are any URL (sent as a message with a link preview). Multiple groups can be
 * added.
 */
export default function AgentMediaGroups({ waAccountId, value = [], onChange }) {
  const [mediaItems, setMediaItems] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(null); // group index currently uploading
  const [linkDraft, setLinkDraft] = useState({});   // per-group in-progress link text
  const [error, setError] = useState('');

  const loadMedia = useCallback(async () => {
    if (!waAccountId) { setMediaItems([]); return; }
    setLoading(true);
    try {
      const res = await api.mediaLibrary.list(waAccountId);
      // The endpoint returns { media: [...] }; tolerate a bare array too.
      const items = Array.isArray(res) ? res : (Array.isArray(res?.media) ? res.media : []);
      setMediaItems(items.map(m => ({ ...m, id: parseInt(m.id, 10) })));
    } catch (e) {
      setError(pretty(e));
    } finally {
      setLoading(false);
    }
  }, [waAccountId]);

  useEffect(() => { loadMedia(); }, [loadMedia]);

  // Approved templates on THIS number — offerable as a "send template" per group.
  // Account-scoped so the agent never tries to send a template approved on a
  // different WABA (Meta #132001).
  useEffect(() => {
    let alive = true;
    if (!waAccountId) { setTemplates([]); return; }
    (async () => {
      try {
        const res = await api.templates.list({ accountId: waAccountId, status: 'APPROVED' });
        if (alive) setTemplates(Array.isArray(res) ? res : (res?.templates || []));
      } catch { if (alive) setTemplates([]); }
    })();
    return () => { alive = false; };
  }, [waAccountId]);

  const byId = (id) => mediaItems.find(m => String(m.id) === String(id));

  const updateGroup = (gi, patch) => onChange(value.map((g, i) => (i === gi ? { ...g, ...patch } : g)));
  const addGroup = () => onChange([...value, { description: '', mediaIds: [], links: [] }]);
  const removeGroup = (gi) => onChange(value.filter((_, i) => i !== gi));
  const addMedia = (gi, id) => {
    const n = parseInt(id, 10);
    if (!Number.isInteger(n)) return;
    const cur = value[gi]?.mediaIds || [];
    if (!cur.includes(n)) updateGroup(gi, { mediaIds: [...cur, n] });
  };
  const removeMedia = (gi, id) => updateGroup(gi, { mediaIds: (value[gi]?.mediaIds || []).filter(m => m !== id) });

  const addLink = (gi, raw) => {
    let url = String(raw || '').trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url; // tolerate "example.com"
    const cur = value[gi]?.links || [];
    if (!cur.includes(url)) updateGroup(gi, { links: [...cur, url] });
    setLinkDraft(d => ({ ...d, [gi]: '' }));
  };
  const removeLink = (gi, url) => updateGroup(gi, { links: (value[gi]?.links || []).filter(l => l !== url) });

  const setTemplate = (gi, templateId) => {
    if (!templateId) { updateGroup(gi, { templateId: null, templateName: null, templateLanguage: null }); return; }
    const t = templates.find(x => String(x.id) === String(templateId));
    updateGroup(gi, { templateId: parseInt(templateId, 10), templateName: t?.name || null, templateLanguage: t?.language || null });
  };

  const handleUpload = async (gi, file) => {
    if (!file) return;
    setUploading(gi); setError('');
    try {
      const created = await api.mediaLibrary.upload(file, file.name, '', waAccountId);
      await loadMedia();
      if (created?.id != null) addMedia(gi, created.id);
    } catch (e) {
      setError(pretty(e));
    } finally {
      setUploading(null);
    }
  };

  // Ctrl+V paste: if the clipboard holds a file, upload it into this group.
  const handlePaste = (gi) => (e) => {
    const item = [...(e.clipboardData?.items || [])].find(it => it.kind === 'file');
    if (item) {
      e.preventDefault();
      const file = item.getAsFile();
      if (file) handleUpload(gi, file);
    }
  };

  if (!waAccountId) {
    return (
      <div style={{ padding: 16, background: 'var(--c-surfaceAlt)', borderRadius: 8, border: `1px dashed ${C.border}`, fontSize: 12.5, color: C.textSecondary, lineHeight: 1.55, fontFamily: FONT }}>
        Bind a <strong>WhatsApp account</strong> in the Identity section first — media is tied to a number, so the agent can only send files from that number’s Media Library.
      </div>
    );
  }

  return (
    <div style={{ fontFamily: FONT }}>
      {error && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 12px', borderRadius: 8, background: '#FCEBEB', color: '#A32D2D', border: '1px solid #FBC8C8', fontSize: 12, marginBottom: 12 }}>
          <AlertCircle size={13} /> {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {value.length === 0 && (
          <div style={{ padding: 16, background: 'var(--c-surfaceAlt)', borderRadius: 8, border: `1px dashed ${C.border}`, textAlign: 'center', fontSize: 12.5, color: C.textSecondary }}>
            No media yet. Add a group to let the agent send files (e.g. a price list, a brochure) at the right moment.
          </div>
        )}

        {value.map((group, gi) => {
          const selected = group.mediaIds || [];
          const available = mediaItems.filter(m => !selected.includes(m.id));
          return (
            <div key={gi} style={{ padding: 14, borderRadius: 10, border: `1px solid ${C.border}`, background: C.cardBg }} onPaste={handlePaste(gi)}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                  Media group {gi + 1}
                </div>
                <button type="button" onClick={() => removeGroup(gi)} title="Remove group"
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: C.primary, display: 'flex', padding: 4 }}>
                  <Trash2 size={15} />
                </button>
              </div>

              <textarea
                value={group.description}
                onChange={e => updateGroup(gi, { description: e.target.value })}
                rows={2}
                placeholder="When should the agent send these? e.g. “When the customer asks for the price list or fees.”"
                style={{ ...inputStyle, resize: 'vertical', minHeight: 56, marginBottom: 10 }}
              />

              {/* Selected media chips */}
              {selected.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                  {selected.map(id => {
                    const m = byId(id);
                    return (
                      <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 8px 5px 9px', borderRadius: 99, background: 'var(--c-surfaceAlt)', border: `1px solid ${C.border}`, fontSize: 12, color: C.text, maxWidth: 240 }}>
                        <MediaTypeIcon type={m?.mediaType} />
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {m ? (m.name || m.originalName || m.filename) : `media #${id} (not in this number’s library)`}
                        </span>
                        <button type="button" onClick={() => removeMedia(gi, id)} title="Remove"
                          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: C.textMuted, display: 'flex', padding: 0 }}>
                          <X size={13} />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Selected link chips */}
              {(group.links || []).length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                  {(group.links || []).map((url, li) => (
                    <span key={li} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 8px 5px 9px', borderRadius: 99, background: 'var(--c-surfaceAlt)', border: `1px solid ${C.border}`, fontSize: 12, color: C.text, maxWidth: 280 }}>
                      <Link2 size={13} color={C.textMuted} style={{ flexShrink: 0 }} />
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{url}</span>
                      <button type="button" onClick={() => removeLink(gi, url)} title="Remove"
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: C.textMuted, display: 'flex', padding: 0 }}>
                        <X size={13} />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Add media: pick from library or upload */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                  <SearchableSelect
                    value=""
                    onChange={(val) => addMedia(gi, val)}
                    options={available.map(m => ({ value: String(m.id), label: m.name || m.originalName || m.filename, sublabel: (m.mediaType || '').toUpperCase() }))}
                    placeholder={loading ? 'Loading media…' : (available.length ? '+ Add from Media Library' : 'No more library media')}
                    searchPlaceholder="Search media…"
                  />
                </div>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 14px', borderRadius: 8, border: `1px dashed ${C.border}`, background: C.cardBg, color: C.text, fontSize: 12.5, fontWeight: 600, cursor: uploading === gi ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}>
                  {uploading === gi ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Upload size={13} />}
                  Upload
                  <input
                    type="file"
                    accept="image/*,video/*,audio/*,application/pdf"
                    style={{ display: 'none' }}
                    disabled={uploading === gi}
                    onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; handleUpload(gi, f); }}
                  />
                </label>
              </div>
              {/* Add a link to send (delivered as a message with a link preview) */}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <input
                  value={linkDraft[gi] || ''}
                  onChange={e => setLinkDraft(d => ({ ...d, [gi]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLink(gi, linkDraft[gi]); } }}
                  placeholder="Paste a link to send (https://…)"
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button type="button" onClick={() => addLink(gi, linkDraft[gi])} disabled={!String(linkDraft[gi] || '').trim()}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 14px', borderRadius: 8, border: `1px dashed ${C.border}`, background: C.cardBg, color: C.text, fontSize: 12.5, fontWeight: 600, cursor: String(linkDraft[gi] || '').trim() ? 'pointer' : 'not-allowed', opacity: String(linkDraft[gi] || '').trim() ? 1 : 0.55, whiteSpace: 'nowrap' }}>
                  <Link2 size={13} /> Add link
                </button>
              </div>
              <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 6 }}>
                Tip: paste (Ctrl+V) a copied image here to upload it. Links are sent as a message with a preview.
              </div>

              {/* Send an approved WhatsApp template as part of this group */}
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>
                  Template to send (optional)
                </div>
                <SearchableSelect
                  value={group.templateId ? String(group.templateId) : ''}
                  onChange={(val) => setTemplate(gi, val)}
                  options={[
                    { value: '', label: '— No template —' },
                    ...templates.map(t => ({ value: String(t.id), label: t.name, sublabel: `${(t.language || '').toUpperCase()}${t.category ? ' · ' + t.category : ''}` })),
                  ]}
                  placeholder={templates.length ? 'Pick an approved template…' : 'No approved templates on this number'}
                  searchPlaceholder="Search templates…"
                />
                <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 6 }}>
                  Sent along with this group's files/links. Use a static template (no <code>{'{{1}}'}</code> variables) — it's sent without parameters.
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={addGroup}
        style={{
          marginTop: 14, display: 'flex', alignItems: 'center', gap: 8,
          padding: '9px 14px', borderRadius: 8,
          border: `1px dashed ${C.border}`, background: C.cardBg,
          color: C.text, fontSize: 13, fontFamily: FONT, fontWeight: 600, cursor: 'pointer',
        }}>
        <Plus size={14} /> Add media group
      </button>
    </div>
  );
}

function MediaTypeIcon({ type }) {
  const p = { size: 13, color: C.textMuted, style: { flexShrink: 0 } };
  if (type === 'image') return <Image {...p} />;
  if (type === 'video') return <Video {...p} />;
  if (type === 'audio') return <Music {...p} />;
  if (type === 'document') return <FileText {...p} />;
  return <FileIcon {...p} />;
}

const inputStyle = {
  width: '100%', padding: '9px 12px', borderRadius: 8,
  border: `1px solid ${C.border}`, fontSize: 13, fontFamily: FONT,
  color: C.text, background: C.cardBg, outline: 'none', boxSizing: 'border-box',
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
