import { useState, useEffect, useMemo } from 'react';
import { Send, ArrowLeft, Trash2, Loader2, Clock, Users, Phone, FileText, Repeat, X, CheckCircle, Eye, Search, ChevronDown, Filter, Plus, Play, Library, Music } from 'lucide-react';
import { api } from '../api.js';
import { C, FONT, formatDate, formatTime, maskPhone, darkenColor } from '../constants.js';
import MaskedNumber from '../components/MaskedNumber.jsx';
import WhatsAppPreview from '../components/WhatsAppPreview.jsx';
import DeleteConfirmModal from '../components/DeleteConfirmModal.jsx';
import TagMultiSelect from '../components/TagMultiSelect.jsx';
import { useTableSelection, SelectAllCheckbox, RowCheckbox, BulkDeleteButton, runBulkDelete } from '../components/TableSelection.jsx';

const FILTER_TABS = [
  { key: 'all', label: 'All' },
  { key: 'DRAFT', label: 'Draft' },
  { key: 'SENDING', label: 'Sending' },
  { key: 'SENT', label: 'Sent' },
  { key: 'PARTIAL', label: 'Partial' },
  { key: 'FAILED', label: 'Failed' },
];

function StatusBadge({ status }) {
  const config = {
    DRAFT:     { bg: '#f3f4f6', color: 'var(--c-textSecondary)', border: '#e5e7eb', dot: '#9ca3af' },
    SENDING:   { bg: '#dbeafe', color: '#1e40af', border: '#bfdbfe', dot: '#3b82f6' },
    SENT:      { bg: '#d1fae5', color: '#065f46', border: '#a7f3d0', dot: '#10b981' },
    PARTIAL:   { bg: '#fef3c7', color: '#92400e', border: '#fde68a', dot: '#f59e0b' },
    FAILED:    { bg: '#fee2e2', color: '#991b1b', border: '#fecaca', dot: '#ef4444' },
  };
  const c = config[status] || config.SENT;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 10px', borderRadius: 99,
      background: c.bg, color: c.color,
      fontSize: 11, fontWeight: 700, fontFamily: FONT,
      border: `1px solid ${c.border}`,
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: 99,
        background: c.dot,
        display: 'inline-block',
      }} />
      {status}
    </span>
  );
}

function ActionBadge({ action }) {
  const isTest = action === 'TEST';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 4,
      background: isTest ? '#fef3c7' : '#dbeafe',
      color: isTest ? '#92400e' : '#1e40af',
      fontSize: 11, fontWeight: 700, fontFamily: FONT,
      border: `1px solid ${isTest ? '#fde68a' : '#bfdbfe'}`,
      textTransform: 'uppercase', letterSpacing: '0.04em',
    }}>
      {isTest ? 'Test' : 'Broadcast'}
    </span>
  );
}

function LogStatusBadge({ status }) {
  const colors = {
    PENDING: { bg: '#f3f4f6', color: 'var(--c-textSecondary)', border: '#e5e7eb' },
    SENT: { bg: '#d1fae5', color: '#065f46', border: '#a7f3d0' },
    FAILED: { bg: '#fee2e2', color: '#991b1b', border: '#fecaca' },
  };
  const c = colors[status] || colors.PENDING;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 4,
      background: c.bg, color: c.color,
      fontSize: 11, fontWeight: 600, fontFamily: FONT,
      border: `1px solid ${c.border}`,
    }}>
      {status}
    </span>
  );
}

function TagBadge({ tag }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 8px', borderRadius: 4,
      background: darkenColor(tag.color),
      color: '#fff',
      border: `1px solid ${darkenColor(tag.color)}`,
      fontSize: 11, fontWeight: 700,
      fontFamily: FONT,
    }}>
      {tag.name}
    </span>
  );
}

function BroadcastMessagePreview({ messageType, body, url, mediaLibraryId, caption, mediaItems }) {
  const selectedMedia = mediaItems.find(m => String(m.id) === String(mediaLibraryId));
  const resolvedBody = (body || url || caption || '').replace(/\{\{name\}\}/g, 'John Doe').replace(/\{\{contact_number\}\}/g, '+91 98765 43210');

  return (
    <div style={{ width: 278, background: 'linear-gradient(155deg, #D8D8DE 0%, #A6A6AD 30%, #82828A 58%, #BFBFC5 82%, #6E6E76 100%)', borderRadius: 52, padding: 3.5, boxShadow: '0 22px 50px rgba(0,0,0,.28), 0 4px 10px rgba(0,0,0,.10), inset 0 0 0 0.5px rgba(255,255,255,.55), inset 0 -2px 4px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: '#000', borderRadius: 48.5, padding: 2, flex: 1, minHeight: 280, display: 'flex', flexDirection: 'column', boxShadow: 'inset 0 0 0 0.5px rgba(255,255,255,.12)' }}>
        <div style={{ flex: 1, minHeight: 0, position: 'relative', borderRadius: 46.5, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#075E54' }}>
          {/* Chat header */}
          <div style={{ background: '#075E54', paddingTop: 50, paddingBottom: 8, paddingLeft: 12, paddingRight: 12, color: '#fff', fontFamily: "-apple-system, 'SF Pro Display', system-ui, sans-serif", flexShrink: 0, position: 'relative', zIndex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#fff', fontSize: 20, lineHeight: 1, opacity: .9, marginRight: -2 }}>‹</span>
              <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg,#1D9E75,#0F6E56)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>F</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Your Business</div>
                <div style={{ fontSize: 10, opacity: .82, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>online</div>
              </div>
            </div>
          </div>
          {/* Chat body */}
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: 'var(--c-chatWall)', padding: '10px 7px', backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'%3E%3Cpath d='M20 20 L25 25 M55 55 L60 60' stroke='%23D9CFC4' stroke-width='1'/%3E%3C/svg%3E\")" }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
              <span style={{ background: '#E1F2FA', color: '#3C6678', fontSize: 9, padding: '2px 9px', borderRadius: 99, fontWeight: 600 }}>TODAY</span>
            </div>
            <div style={{ marginLeft: 'auto', maxWidth: '88%', minWidth: '55%' }}>
              <div style={{ background: '#DCF8C6', borderRadius: '7.5px 7.5px 0 7.5px', padding: '6px 7px 5px 9px', boxShadow: '0 1px 0.5px rgba(11,20,26,.13)', position: 'relative', marginRight: 8 }}>
                <div style={{ position: 'absolute', bottom: 0, right: -8, width: 0, height: 0, borderStyle: 'solid', borderWidth: '0 0 9px 9px', borderColor: 'transparent transparent #DCF8C6 transparent' }} />

                {messageType === 'image' && selectedMedia && (
                  <img src={api.mediaLibrary.downloadUrl(selectedMedia.id)} alt="" style={{ margin: '-6px -7px 6px -9px', borderRadius: '7.5px 7.5px 0 0', height: 120, width: 'calc(100% + 16px)', objectFit: 'cover', display: 'block' }} />
                )}
                {messageType === 'video' && selectedMedia && (
                  <div style={{ margin: '-6px -7px 6px -9px', borderRadius: '7.5px 7.5px 0 0', height: 120, position: 'relative', overflow: 'hidden' }}>
                    <video src={api.mediaLibrary.downloadUrl(selectedMedia.id)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} preload="metadata" muted />
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.3)' }}>
                      <div style={{ width: 38, height: 38, borderRadius: 99, background: 'rgba(255,255,255,.15)', border: '1.5px solid rgba(255,255,255,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Play size={16} color="white" fill="white" />
                      </div>
                    </div>
                  </div>
                )}
                {messageType === 'audio' && selectedMedia && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#0F6E56', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Music size={14} color="#fff" />
                    </div>
                    <div style={{ flex: 1, height: 4, background: 'rgba(0,0,0,0.1)', borderRadius: 2 }} />
                    <span style={{ fontSize: 10, color: 'var(--c-textSecondary)' }}>0:15</span>
                  </div>
                )}
                {messageType === 'document' && selectedMedia && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, padding: '6px 8px', background: 'rgba(0,0,0,.06)', borderRadius: 6 }}>
                    <div style={{ width: 34, height: 38, background: 'var(--c-cardBg)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 1px 3px rgba(0,0,0,.15)' }}>
                      <FileText size={16} color="#9e9e9e" />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--c-text)', fontFamily: FONT }}>{selectedMedia.name || 'Document'}</div>
                      <div style={{ fontSize: 9.5, color: 'var(--c-textMuted)', fontFamily: FONT }}>PDF</div>
                    </div>
                  </div>
                )}

                {resolvedBody && (
                  <div style={{ fontSize: 13.5, color: 'var(--c-text)', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: FONT }}>{resolvedBody}</div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 3, marginTop: 2, marginBottom: -1 }}>
                  <span style={{ fontSize: 10.5, color: 'var(--c-textSecondary)', fontFamily: FONT }}>9:41</span>
                  <svg width="16" height="11" viewBox="0 0 16 11" fill="none"><path d="M1 5.5L5 9.5L11.5 1" stroke="#53BDEB" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /><path d="M5 5.5L9 9.5L15.5 1" stroke="#53BDEB" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiCards({ metrics }) {
  const { totalRecipients, totalSent, totalDelivered, totalRead } = metrics;

  const cards = [
    { key: 'recipients', label: 'Recipients', value: totalRecipients, color: '#dc2626', bg: '#FCEBEB', icon: Users },
    { key: 'sent', label: 'Sent', value: totalSent, color: '#2563eb', bg: '#E3F2FD', icon: Send },
    { key: 'delivered', label: 'Received', value: totalDelivered, color: '#0F6E56', bg: '#E1F5EE', icon: CheckCircle },
    { key: 'read', label: 'Read', value: totalRead, color: '#7c3aed', bg: '#EDE9FE', icon: Eye },
  ];

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: 16,
      marginBottom: 24,
    }}>
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.key}
            style={{
              background: C.cardBg,
              borderRadius: 12,
              border: `1px solid ${C.border}`,
              padding: '20px 24px',
              display: 'flex',
              alignItems: 'center',
              gap: 16,
            }}
          >
            <div style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              background: card.bg,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}>
              <Icon size={20} color={card.color} />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4, fontFamily: FONT }}>
                {card.label}
              </div>
              <div style={{ fontSize: 24, fontWeight: 700, color: card.color, fontFamily: FONT, lineHeight: 1 }}>
                {card.value}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatSentTo(log) {
  if (log.action === 'TEST') {
    return `Test: ${log.sent_to}`;
  }
  // Aggregated broadcast log from backend already has formatted count
  if (log.sent_to && log.sent_to.includes('contact')) {
    return log.sent_to;
  }
  const count = log.sent_to ? log.sent_to.split(',').filter(Boolean).length : 0;
  if (count === 0) return 'Broadcast';
  if (count === 1) return '1 recipient';
  return `${count} recipients`;
}

export default function BulkMessagePage() {
  const [view, setView] = useState('list'); // 'list' | 'detail'
  const [broadcasts, setBroadcasts] = useState([]);
  const [filterStatus, setFilterStatus] = useState('all');
  const [loading, setLoading] = useState(false);
  const [selectedBroadcast, setSelectedBroadcast] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [repeatModal, setRepeatModal] = useState(false);
  const [repeatSending, setRepeatSending] = useState(false);
  const [repeatTestNumber, setRepeatTestNumber] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const [deleteModal, setDeleteModal] = useState({ open: false, broadcast: null });
  const [selectedLog, setSelectedLog] = useState(null);

  // ─── New Broadcast Modal State ──────────────────────────────────────────────
  const [newBroadcastModal, setNewBroadcastModal] = useState(false);
  const [newBroadcastFrom, setNewBroadcastFrom] = useState('');
  const [newBroadcastTemplateId, setNewBroadcastTemplateId] = useState('');
  const [newBroadcastName, setNewBroadcastName] = useState('');
  const [newBroadcastTestNumber, setNewBroadcastTestNumber] = useState('');
  const [newBroadcasting, setNewBroadcasting] = useState(false);
  const [newBroadcastSendingTest, setNewBroadcastSendingTest] = useState(false);
  const [newBroadcastVariableMapping, setNewBroadcastVariableMapping] = useState({});
  const [newBroadcastMessageType, setNewBroadcastMessageType] = useState('template');
  const [newBroadcastBody, setNewBroadcastBody] = useState('');
  const [newBroadcastUrl, setNewBroadcastUrl] = useState('');
  const [newBroadcastMediaLibraryId, setNewBroadcastMediaLibraryId] = useState('');
  const [newBroadcastMediaItems, setNewBroadcastMediaItems] = useState([]);
  const [newBroadcastCaption, setNewBroadcastCaption] = useState('');
  const [newBroadcastMediaLoading, setNewBroadcastMediaLoading] = useState(false);
  const [newTestNumberSearch, setNewTestNumberSearch] = useState('');
  const [newTestNumberOpen, setNewTestNumberOpen] = useState(false);

  const [numbers, setNumbers] = useState([]);
  const [selectedNumber, setSelectedNumber] = useState('');
  const [contacts, setContacts] = useState([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactSearch, setContactSearch] = useState('');
  const [contactFilterTagIds, setContactFilterTagIds] = useState([]);
  const [selectedContactNumbers, setSelectedContactNumbers] = useState(new Set());

  const [categories, setCategories] = useState([]);
  const [tags, setTags] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [contactFields, setContactFields] = useState([]);
  const [linkedAccount, setLinkedAccount] = useState(null); // { id, displayName, wabaId, ... }
  const [accountLookupDone, setAccountLookupDone] = useState(false);

  // Load numbers on mount
  useEffect(() => {
    api.numbers()
      .then(data => {
        setNumbers(data);
        if (data.length > 0) setSelectedNumber(data[0].wa_number);
      })
      .catch(() => setNumbers([]));
  }, []);

  // Load contacts when selectedNumber changes
  useEffect(() => {
    if (!selectedNumber) return;
    setContactsLoading(true);
    api.savedContacts(selectedNumber)
      .then(data => setContacts(data.map(c => ({ ...c, tags: c.tags || [] }))))
      .catch(() => setContacts([]))
      .finally(() => setContactsLoading(false));
  }, [selectedNumber]);

  // Load categories, tags, templates when modal opens
  useEffect(() => {
    if (!newBroadcastModal) return;
    Promise.all([
      api.categories.list().catch(() => []),
      api.tags.list().catch(() => []),
      api.templates.list().catch(() => []),
      api.contactFields.list().catch(() => []),
    ]).then(([cats, tgs, tpls, flds]) => {
      setCategories(cats);
      setTags(tgs);
      setTemplates(tpls.filter(t => t.status === 'APPROVED'));
      setContactFields(flds);
    });
  }, [newBroadcastModal]);

  // Resolve the WhatsApp account that owns the chosen "from" number, so we can
  // (1) filter templates to the matching WABA and (2) warn if the number isn't
  // registered. Re-runs whenever the from-number changes.
  useEffect(() => {
    if (!newBroadcastFrom) {
      setLinkedAccount(null);
      setAccountLookupDone(false);
      return;
    }
    setAccountLookupDone(false);
    fetch(`/api/whatsapp-accounts/by-phone/${encodeURIComponent(newBroadcastFrom)}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => setLinkedAccount(data))
      .catch(() => setLinkedAccount(null))
      .finally(() => setAccountLookupDone(true));
  }, [newBroadcastFrom]);

  // Filter approved templates to those belonging to the linked account's WABA.
  // If no linked account, show nothing (forces the user to fix the number).
  const eligibleTemplates = linkedAccount
    ? templates.filter(t => t.whatsappAccountId === linkedAccount.id)
    : [];

  const isBroadcastFormInvalid = () => {
    if (!newBroadcastFrom || selectedRecipients.length === 0 || newBroadcasting) return true;
    if (newBroadcastMessageType === 'template' && !selectedTemplate) return true;
    if (newBroadcastMessageType === 'text' && !newBroadcastBody.trim()) return true;
    return false;
  };

  // Reset modal state when closed
  const closeNewBroadcastModal = () => {
    setNewBroadcastModal(false);
    setNewBroadcastFrom('');
    setNewBroadcastTemplateId('');
    setNewBroadcastName('');
    setNewBroadcastTestNumber('');
    setNewBroadcastVariableMapping({});
    setNewBroadcastMessageType('template');
    setNewBroadcastBody('');
    setNewBroadcastUrl('');
    setNewBroadcastMediaLibraryId('');
    setNewBroadcastMediaItems([]);
    setNewBroadcastCaption('');
    setNewBroadcastMediaLoading(false);
    setNewTestNumberSearch('');
    setNewTestNumberOpen(false);
    setSelectedContactNumbers(new Set());
    setContactSearch('');
    setContactFilterTagIds([]);
  };

  const loadBroadcasts = async () => {
    setLoading(true);
    try {
      const data = await api.broadcasts.list(filterStatus === 'all' ? '' : filterStatus);
      setBroadcasts(data);
    } catch (err) {
      console.error('Failed to load broadcasts:', err);
      setBroadcasts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBroadcasts();
  }, [filterStatus]);

  // Load media library items when message type is a media type, OR when a
  // template with a media header (IMAGE/VIDEO/DOCUMENT) is selected — both need
  // a Media Library pick. Filter to the relevant media type.
  useEffect(() => {
    const mediaTypes = ['image', 'video', 'audio', 'document'];
    let neededType = null;
    if (mediaTypes.includes(newBroadcastMessageType)) {
      neededType = newBroadcastMessageType;
    } else if (newBroadcastMessageType === 'template') {
      const tpl = templates.find(t => t.id.toString() === newBroadcastTemplateId);
      const ht = String(tpl?.header_type || '').toLowerCase();
      if (['image', 'video', 'document'].includes(ht)) neededType = ht;
    }
    if (!neededType) {
      setNewBroadcastMediaItems([]);
      return;
    }
    setNewBroadcastMediaLoading(true);
    // Scope media to the connected (linked) account only.
    api.mediaLibrary.list(linkedAccount?.id)
      .then(res => {
        const filtered = (res.media || []).filter(m => m.mediaType === neededType);
        setNewBroadcastMediaItems(filtered);
      })
      .catch(() => setNewBroadcastMediaItems([]))
      .finally(() => setNewBroadcastMediaLoading(false));
  }, [newBroadcastMessageType, newBroadcastTemplateId, templates, linkedAccount]);

  const openDetail = async (broadcast) => {
    setDetailLoading(true);
    setView('detail');
    try {
      const data = await api.broadcasts.get(broadcast.id);
      setSelectedBroadcast(data);
    } catch (err) {
      alert('Failed to load broadcast details');
      setView('list');
    } finally {
      setDetailLoading(false);
    }
  };

  // Live-refresh the broadcast detail while the view is open. Meta sends
  // `sent` → `delivered` → `read` webhooks for each recipient over several
  // seconds/minutes; without polling, the Delivery Summary stays frozen at
  // whatever the values were when the modal opened. Stop polling when every
  // recipient has reached a terminal state (read or failed).
  useEffect(() => {
    if (view !== 'detail' || !selectedBroadcast?.id) return;
    const isTerminal = (b) => {
      const r = b?.statusRollup || {};
      const total = r.total || 0;
      if (total === 0) return false;
      const terminal = (r.read || 0) + (r.failed || 0);
      return terminal >= total;
    };
    if (isTerminal(selectedBroadcast)) return;
    const tick = async () => {
      try {
        const data = await api.broadcasts.get(selectedBroadcast.id);
        setSelectedBroadcast(prev => prev && prev.id === data.id ? data : prev);
      } catch { /* swallow — next tick retries */ }
    };
    const intervalId = setInterval(tick, 4000);
    return () => clearInterval(intervalId);
  }, [view, selectedBroadcast?.id, selectedBroadcast?.statusRollup?.read, selectedBroadcast?.statusRollup?.failed, selectedBroadcast?.statusRollup?.total]);

  const handleDelete = async () => {
    const b = deleteModal.broadcast;
    if (!b) return;
    try {
      await api.broadcasts.delete(b.id);
      setBroadcasts(prev => prev.filter(x => x.id !== b.id));
      setDeleteModal({ open: false, broadcast: null });
      if (selectedBroadcast?.id === b.id) {
        setView('list');
        setSelectedBroadcast(null);
      }
    } catch (err) {
      alert('Failed to delete broadcast: ' + err.message);
    }
  };

  const sel = useTableSelection(broadcasts);

  const handleBulkDelete = async (ids) => {
    await runBulkDelete(ids, (id) => api.broadcasts.delete(id), {
      label: 'broadcast',
      onSuccess: (deletedIds) => {
        const set = new Set(deletedIds);
        setBroadcasts(prev => prev.filter(b => !set.has(b.id)));
        if (selectedBroadcast?.id && set.has(selectedBroadcast.id)) {
          setView('list');
          setSelectedBroadcast(null);
        }
      },
    });
  };

  const handleRepeatBroadcast = async () => {
    if (!selectedBroadcast) return;
    setRepeatSending(true);
    try {
      const data = await api.broadcasts.send(selectedBroadcast.id);
      setSelectedBroadcast(data);
      setRepeatModal(false);
      setRepeatTestNumber('');
      loadBroadcasts();
    } catch (err) {
      alert('Failed to repeat broadcast: ' + err.message);
    } finally {
      setRepeatSending(false);
    }
  };

  const handleRepeatTest = async () => {
    if (!selectedBroadcast || !repeatTestNumber.trim()) return;
    setSendingTest(true);
    try {
      const data = await api.broadcasts.test(selectedBroadcast.id, repeatTestNumber.trim());
      setSelectedBroadcast(data);
      setRepeatTestNumber('');
      alert(`Test message sent to ${repeatTestNumber.trim()}`);
    } catch (err) {
      alert('Test failed: ' + err.message);
    } finally {
      setSendingTest(false);
    }
  };

  const recipientCount = (b) => {
    try {
      const arr = typeof b.recipient_numbers === 'string'
        ? JSON.parse(b.recipient_numbers)
        : b.recipient_numbers;
      return Array.isArray(arr) ? arr.length : 0;
    } catch { return 0; }
  };

  const formatRecipients = (b) => {
    const count = recipientCount(b);
    if (count === 0) return '0 contacts';
    if (count === 1) return '1 contact';
    return `${count} contacts`;
  };

  const templateForPreview = (b) => {
    if (!b) return null;
    return {
      header_type: b.header_type,
      header_text: b.header_text,
      body: b.template_body || b.body,
      footer: b.template_footer || b.footer,
      buttons: typeof b.template_buttons === 'string'
        ? JSON.parse(b.template_buttons || '[]')
        : (b.template_buttons || b.buttons || []),
    };
  };

  // Compute metrics from broadcast data — the backend's statusRollup now
  // returns cumulative funnel buckets (sent = ever-sent, delivered = ever-delivered,
  // read = read), so we use them directly. Don't sum — that double-counts.
  const getMetrics = (b) => {
    const totalRecipients = recipientCount(b);
    const r = b.statusRollup || b.status_rollup || {};
    return {
      totalRecipients,
      totalSent: r.sent || 0,
      totalDelivered: r.delivered || 0,
      totalRead: r.read || 0,
      totalFailed: r.failed || 0,
      totalPending: r.pending || 0,
      rollupTotal: r.total || totalRecipients,
    };
  };

  // ─── New Broadcast Modal Helpers ────────────────────────────────────────────
  // Extract template variables {{1}}, {{2}}, etc.
  const extractVars = (t) => {
    const m = [...(t || '').matchAll(/\{\{(\d+)\}\}/g)];
    return [...new Set(m.map(x => x[1]))].sort((a, b) => +a - +b);
  };

  // Resolve template variables using mapping + first selected contact for live preview
  const resolvePreviewText = (text, mapping, contact) => {
    if (!text || !contact) return text || '';
    return text.replace(/\{\{(\d+)\}\}/g, (_, v) => {
      const field = mapping[v];
      if (!field) return `{{${v}}}`;
      if (field === 'name') return contact.name || `{{${v}}}`;
      if (field === 'contact_number') return maskPhone(contact.contact_number) || `{{${v}}}`;
      if (field.startsWith('custom_fields.')) {
        const id = field.split('.')[1];
        return contact.custom_fields?.[id] || `{{${v}}}`;
      }
      if (field.startsWith('category_tag.')) {
        const catId = field.split('.')[1];
        const tag = contact.tags?.find(t => t.category_id == catId);
        return tag?.name || `{{${v}}}`;
      }
      return `{{${v}}}`;
    });
  };

  const selectedTemplate = templates.find(t => t.id.toString() === newBroadcastTemplateId);
  // 'image' | 'video' | 'document' when the selected template has a media header
  // (which requires a header image at send time), else null.
  const headerMediaType = (() => {
    if (newBroadcastMessageType !== 'template' || !selectedTemplate) return null;
    const ht = String(selectedTemplate.header_type || '').toUpperCase();
    return ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(ht) ? ht.toLowerCase() : null;
  })();
  const selectedRecipients = contacts.filter(c => selectedContactNumbers.has(c.contact_number));
  const previewTemplate = selectedTemplate ? {
    ...selectedTemplate,
    body: resolvePreviewText(selectedTemplate.body, newBroadcastVariableMapping, selectedRecipients[0]),
    header_text: selectedTemplate.header_type === 'TEXT' ? resolvePreviewText(selectedTemplate.header_text, newBroadcastVariableMapping, selectedRecipients[0]) : selectedTemplate.header_text,
  } : null;

  const templateVars = useMemo(() => {
    if (!selectedTemplate) return [];
    const bodyVars = extractVars(selectedTemplate.body);
    const headerVars = selectedTemplate.header_type === 'TEXT' ? extractVars(selectedTemplate.header_text) : [];
    return [...new Set([...headerVars, ...bodyVars])].sort((a, b) => +a - +b);
  }, [selectedTemplate]);

  // Available contact fields for variable mapping
  const contactFieldOptions = useMemo(() => {
    const opts = [
      { value: 'name', label: 'Contact Name' },
      { value: 'contact_number', label: 'Phone Number' },
    ];
    categories.forEach(cat => {
      opts.push({ value: `category_tag.${cat.id}`, label: cat.name });
    });
    contactFields.forEach(f => {
      opts.push({ value: `custom_fields.${f.id}`, label: f.name });
    });
    return opts;
  }, [categories, contactFields]);

  const filteredContacts = contacts.filter(c => {
    const matchesSearch = !contactSearch ||
      c.contact_number.includes(contactSearch) ||
      (c.name && c.name.toLowerCase().includes(contactSearch.toLowerCase()));
    const matchesTag = contactFilterTagIds.length === 0 || (c.tags || []).some(t => contactFilterTagIds.includes(t.id));
    return matchesSearch && matchesTag;
  });

  const allSelected = filteredContacts.length > 0 && filteredContacts.every(c => selectedContactNumbers.has(c.contact_number));
  const someSelected = filteredContacts.some(c => selectedContactNumbers.has(c.contact_number)) && !allSelected;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedContactNumbers(prev => {
        const next = new Set(prev);
        filteredContacts.forEach(c => next.delete(c.contact_number));
        return next;
      });
    } else {
      setSelectedContactNumbers(prev => {
        const next = new Set(prev);
        filteredContacts.forEach(c => next.add(c.contact_number));
        return next;
      });
    }
  };

  const toggleSelectOne = (contactNumber) => {
    setSelectedContactNumbers(prev => {
      const next = new Set(prev);
      if (next.has(contactNumber)) next.delete(contactNumber);
      else next.add(contactNumber);
      return next;
    });
  };

  const getTagInfo = (tagRef) => tags.find(t => t.id === tagRef.id) || tagRef;

  const handleNewBroadcastTest = async () => {
    if (!newBroadcastTestNumber.trim() || !newBroadcastFrom || selectedRecipients.length === 0) return;
    if (newBroadcastMessageType === 'template' && !selectedTemplate) return;
    if (newBroadcastMessageType === 'text' && !newBroadcastBody.trim()) return;
    setNewBroadcastSendingTest(true);
    try {
      const payload = {
        from_number: newBroadcastFrom,
        recipient_numbers: selectedRecipients.map(r => ({ contact_number: r.contact_number, name: r.name })),
        status: 'DRAFT',
        test_number: newBroadcastTestNumber.trim(),
        name: newBroadcastName.trim() || undefined,
        message_type: newBroadcastMessageType,
      };
      if (newBroadcastMessageType === 'template') {
        payload.template_id = selectedTemplate.id;
      } else if (newBroadcastMessageType === 'text') {
        payload.body = newBroadcastBody;
      }
      const broadcast = await api.broadcasts.create(payload);
      await api.broadcasts.test(broadcast.id, newBroadcastTestNumber.trim());
      alert(`Test message sent to ${newBroadcastTestNumber.trim()}`);
    } catch (err) {
      alert('Test failed: ' + err.message);
    } finally {
      setNewBroadcastSendingTest(false);
    }
  };

  const handleNewBroadcastSave = async (status) => {
    if (!newBroadcastFrom || selectedRecipients.length === 0) return;
    if (newBroadcastMessageType === 'template' && !selectedTemplate) return;
    if (newBroadcastMessageType === 'text' && !newBroadcastBody.trim()) return;
    setNewBroadcasting(true);
    try {
      const payload = {
        from_number: newBroadcastFrom,
        recipient_numbers: selectedRecipients.map(r => ({ contact_number: r.contact_number, name: r.name })),
        status,
        test_number: newBroadcastTestNumber || undefined,
        name: newBroadcastName.trim() || undefined,
        message_type: newBroadcastMessageType,
      };
      if (newBroadcastMessageType === 'template') {
        payload.template_id = selectedTemplate.id;
      } else if (newBroadcastMessageType === 'text') {
        payload.body = newBroadcastBody;
      }
      const broadcast = await api.broadcasts.create(payload);
      if (status === 'SENT') {
        await api.broadcasts.send(broadcast.id);
        alert(`Broadcast sent to ${selectedRecipients.length} contact(s) from ${newBroadcastFrom}!`);
      } else {
        alert('Broadcast saved as draft');
      }
      closeNewBroadcastModal();
      loadBroadcasts();
    } catch (err) {
      alert(status === 'SENT' ? 'Broadcast failed: ' + err.message : 'Save failed: ' + err.message);
    } finally {
      setNewBroadcasting(false);
    }
  };

  // ─── LIST VIEW ──────────────────────────────────────────────────────────────
  if (view === 'list') {
    return (
      <div style={{ padding: '24px 28px', fontFamily: FONT }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: 0, letterSpacing: '-.02em', fontFamily: FONT }}>Bulk Messages</h1>
            <p style={{ fontSize: 12, color: C.textMuted, margin: '4px 0 0', fontFamily: FONT }}>Manage your broadcast campaigns and drafts</p>
          </div>
          <button
            onClick={() => {
              setNewBroadcastModal(true);
              setNewBroadcastFrom(selectedNumber || '');
            }}
            style={{
              padding: '10px 18px', borderRadius: 8, border: 'none',
              background: C.primary, color: '#fff', cursor: 'pointer',
              fontSize: 13, fontWeight: 700, fontFamily: FONT,
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <Plus size={16} /> New Broadcast
          </button>
        </div>

        {/* Filter Tabs + bulk-delete */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6 }}>
          {FILTER_TABS.map(tab => {
            const active = filterStatus === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setFilterStatus(tab.key)}
                style={{
                  padding: '7px 16px', borderRadius: 8, border: `1.5px solid ${active ? C.primary : C.border}`,
                  background: active ? C.primary : 'var(--c-cardBg)', color: active ? '#fff' : C.textSecondary,
                  cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: FONT,
                }}
              >
                {tab.label}
                {tab.key !== 'all' && (
                  <span style={{
                    marginLeft: 6, fontSize: 11, fontWeight: 700,
                    background: active ? 'rgba(255,255,255,.2)' : C.primaryLight,
                    color: active ? '#fff' : C.primary,
                    padding: '1px 7px', borderRadius: 99,
                  }}>
                    {broadcasts.filter(b => b.status === tab.key).length}
                  </span>
                )}
              </button>
            );
          })}
          </div>
          <BulkDeleteButton sel={sel} label="broadcast" onConfirm={(ids) => handleBulkDelete(ids)} />
        </div>

        {/* Table */}
        <div style={{ background: C.cardBg, borderRadius: 12, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#fafaf9', borderBottom: `1px solid ${C.border}` }}>
                <th style={{ padding: '12px 16px', width: 40 }}><SelectAllCheckbox sel={sel} /></th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Broadcast</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em' }}>From</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Recipients</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Template</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Status</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Last Activity</th>
                <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} style={{ padding: 40, textAlign: 'center', color: C.textMuted }}>
                    <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', marginBottom: 8 }} />
                    <div style={{ fontSize: 13 }}>Loading broadcasts…</div>
                  </td>
                </tr>
              ) : broadcasts.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: 48, textAlign: 'center' }}>
                    <div style={{ fontSize: 32, marginBottom: 10 }}>📡</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 4 }}>No broadcasts yet</div>
                    <div style={{ fontSize: 12, color: C.textMuted }}>Click "New Broadcast" to create your first campaign</div>
                  </td>
                </tr>
              ) : (
                broadcasts.map(b => (
                  <tr
                    key={b.id}
                    onClick={() => openDetail(b)}
                    style={{
                      borderBottom: `1px solid ${C.border}`,
                      cursor: 'pointer',
                      transition: 'background .15s',
                      background: sel.isSelected(b.id) ? '#FDF6F6' : 'transparent',
                    }}
                    onMouseEnter={e => { if (!sel.isSelected(b.id)) e.currentTarget.style.background = '#fafaf9'; }}
                    onMouseLeave={e => { if (!sel.isSelected(b.id)) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <td style={{ padding: '12px 16px', width: 40 }} onClick={(e) => e.stopPropagation()}>
                      <RowCheckbox sel={sel} id={b.id} label={b.name || `Broadcast #${b.id}`} />
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ fontWeight: 600, color: C.text, fontSize: 13 }}>{b.name || b.template_name || 'Untitled'} #{b.id}</div>
                      <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{b.template_name || '—'} · {formatDate(b.created_at)}</div>
                    </td>
                    <td style={{ padding: '12px 16px', color: C.textSecondary }}><MaskedNumber number={b.from_number} prefix="+" /></td>
                    <td style={{ padding: '12px 16px', color: C.textSecondary }}>{formatRecipients(b)}</td>
                    <td style={{ padding: '12px 16px', color: C.textSecondary }}>{b.template_name || '—'}</td>
                    <td style={{ padding: '12px 16px' }}><StatusBadge status={b.status} /></td>
                    <td style={{ padding: '12px 16px', color: C.textSecondary, fontSize: 12 }}>
                      {b.last_activity ? (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Clock size={12} /> {formatDate(b.last_activity)} {formatTime(b.last_activity)}
                        </span>
                      ) : (
                        <span style={{ color: C.textMuted }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteModal({ open: true, broadcast: b }); }}
                        style={{
                          border: 'none', background: 'transparent', cursor: 'pointer',
                          color: C.primary, padding: 4, borderRadius: 4,
                        }}
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Delete Modal */}
        <DeleteConfirmModal
          open={deleteModal.open}
          title="Delete Broadcast"
          message={deleteModal.broadcast ? `Are you sure you want to delete broadcast "${deleteModal.broadcast.name || deleteModal.broadcast.template_name || 'Untitled'} #${deleteModal.broadcast.id}"? This action cannot be undone.` : ''}
          confirmText="Delete"
          onConfirm={handleDelete}
          onCancel={() => setDeleteModal({ open: false, broadcast: null })}
        />

        {/* ─── NEW BROADCAST MODAL ───────────────────────────────────────────── */}
        {newBroadcastModal && (
          <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 200, fontFamily: FONT,
          }}>
            <div style={{
              background: C.cardBg, borderRadius: 14,
              width: 1100, maxHeight: '92vh',
              boxShadow: C.shadowLg, overflowY: 'auto',
              display: 'flex', flexDirection: 'column',
            }}>
              {/* Modal Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px 0', flexShrink: 0 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>
                  <Send size={18} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: 8, color: C.primary }} />
                  New Broadcast
                </div>
                <button onClick={closeNewBroadcastModal} style={{
                  border: 'none', background: 'transparent', cursor: 'pointer', color: C.textMuted,
                }}><X size={20} /></button>
              </div>

              {/* Top section: Form + Preview */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 420px', gap: 24, padding: '20px 24px', flexShrink: 0 }}>
                {/* LEFT — Form */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                  {/* Broadcast Name */}
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.textSecondary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Broadcast Name</div>
                    <input
                      type="text"
                      value={newBroadcastName}
                      onChange={e => setNewBroadcastName(e.target.value)}
                      placeholder="e.g. April Fee Reminder"
                      style={{
                        width: '100%', padding: '10px 12px', borderRadius: 8,
                        border: `1.5px solid ${C.border}`, fontSize: 13,
                        fontFamily: FONT, color: C.text, outline: 'none',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>

                  {/* From */}
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.textSecondary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>From (Team Member Number)</div>
                    <div style={{ position: 'relative' }}>
                      <select
                        value={newBroadcastFrom}
                        onChange={e => { setNewBroadcastFrom(e.target.value); setSelectedNumber(e.target.value); setNewBroadcastTemplateId(''); }}
                        style={{
                          width: '100%', padding: '10px 32px 10px 12px', borderRadius: 8,
                          border: `1.5px solid ${C.border}`, fontSize: 13,
                          fontFamily: FONT, color: C.text, background: 'var(--c-cardBg)',
                          cursor: 'pointer', appearance: 'none', outline: 'none',
                        }}
                      >
                        <option value="">Select team member number...</option>
                        {numbers.map(n => (
                          <option key={n.wa_number} value={n.wa_number}>
                            {n.display_name || maskPhone(n.wa_number)}
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={14} color={C.textMuted} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                    </div>
                    {/* Linked account status — shown once the lookup resolves */}
                    {newBroadcastFrom && accountLookupDone && (
                      linkedAccount ? (
                        <div style={{ marginTop: 6, fontSize: 11, color: '#0F6E56', fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 4 }}>
                          ✓ Linked to <strong>{linkedAccount.displayName}</strong> · WABA {linkedAccount.wabaId}
                          {!linkedAccount.isActive && <span style={{ color: '#E65100', marginLeft: 6 }}>(inactive)</span>}
                        </div>
                      ) : (
                        <div style={{ marginTop: 6, padding: '8px 10px', background: '#FFF3E0', border: `1px solid #FFB74D`, borderRadius: 6, fontSize: 11, color: '#E65100', fontFamily: FONT }}>
                          ⚠ This number isn't linked to a WhatsApp Account. Broadcasts can't be sent until you register it in Settings → WhatsApp Accounts.
                        </div>
                      )
                    )}
                  </div>

                  {/* To */}
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.textSecondary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>To ({selectedRecipients.length} selected)</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 100, overflowY: 'auto', padding: '10px 12px', background: 'var(--c-hover)', borderRadius: 8, border: `1.5px solid ${C.border}` }}>
                      {selectedRecipients.length === 0 && (
                        <span style={{ fontSize: 12, color: C.textMuted, fontFamily: FONT }}>Select contacts from the table below</span>
                      )}
                      {selectedRecipients.map(c => (
                        <span key={c.contact_number} style={{ fontSize: 11, color: C.textSecondary, background: 'var(--c-cardBg)', padding: '3px 10px', borderRadius: 99, border: `1px solid ${C.border}`, fontFamily: FONT, fontWeight: 500 }}>
                          {c.name} (<MaskedNumber number={c.contact_number} prefix="+" />)
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Message Type */}
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.textSecondary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Message Type</div>
                    <div style={{ position: 'relative' }}>
                      <select
                        value={newBroadcastMessageType}
                        onChange={e => setNewBroadcastMessageType(e.target.value)}
                        style={{
                          width: '100%', padding: '10px 32px 10px 12px', borderRadius: 8,
                          border: `1.5px solid ${C.border}`, fontSize: 13,
                          fontFamily: FONT, color: C.text, background: 'var(--c-cardBg)',
                          cursor: 'pointer', appearance: 'none', outline: 'none',
                        }}
                      >
                        <option value="template">Template Message</option>
                        <option value="text">Text Message</option>
                      </select>
                      <ChevronDown size={14} color={C.textMuted} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                    </div>
                  </div>

                  {/* Template Fields */}
                  {newBroadcastMessageType === 'template' && (
                    <>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: C.textSecondary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Message Template</div>
                        <div style={{ position: 'relative' }}>
                          <select
                            value={newBroadcastTemplateId}
                            onChange={e => setNewBroadcastTemplateId(e.target.value)}
                            style={{
                              width: '100%', padding: '10px 32px 10px 12px', borderRadius: 8,
                              border: `1.5px solid ${C.border}`, fontSize: 13,
                              fontFamily: FONT, color: C.text, background: 'var(--c-cardBg)',
                              cursor: 'pointer', appearance: 'none', outline: 'none',
                            }}
                          >
                            <option value="">Select a template...</option>
                            {eligibleTemplates.map(t => (
                              <option key={t.id} value={t.id}>{t.name} ({t.category})</option>
                            ))}
                          </select>
                          <ChevronDown size={14} color={C.textMuted} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                        </div>
                        {!newBroadcastFrom ? (
                          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4, fontFamily: FONT }}>Pick a sending number first.</div>
                        ) : !linkedAccount && accountLookupDone ? (
                          <div style={{ fontSize: 11, color: '#E65100', marginTop: 4, fontFamily: FONT }}>Templates are scoped to a WhatsApp Account — register the number above first.</div>
                        ) : eligibleTemplates.length === 0 && linkedAccount ? (
                          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4, fontFamily: FONT }}>No approved templates for <strong>{linkedAccount.displayName}</strong>. Create one in Template Builder.</div>
                        ) : null}
                      </div>

                    </>
                  )}

                  {/* Text Fields */}
                  {newBroadcastMessageType === 'text' && (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: C.textSecondary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Message Text</div>
                      <textarea
                        value={newBroadcastBody}
                        onChange={e => setNewBroadcastBody(e.target.value)}
                        placeholder="Type your message here..."
                        rows={4}
                        style={{
                          width: '100%', padding: '10px 12px', borderRadius: 8,
                          border: `1.5px solid ${C.border}`, fontSize: 13,
                          fontFamily: FONT, color: C.text, outline: 'none',
                          boxSizing: 'border-box', resize: 'vertical',
                        }}
                      />
                    </div>
                  )}

                  {/* Test Number */}
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.textSecondary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Test Number</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {/* Single-owner system: enter the test recipient number directly */}
                      <input
                        type="tel"
                        value={newBroadcastTestNumber}
                        onChange={e => setNewBroadcastTestNumber(e.target.value)}
                        placeholder="Enter test number (e.g. 919342245724)"
                        style={{
                          flex: 1, padding: '10px 12px', borderRadius: 8,
                          border: `1.5px solid ${C.border}`, fontSize: 13,
                          fontFamily: FONT, color: C.text, background: 'var(--c-cardBg)',
                          outline: 'none', boxSizing: 'border-box',
                        }}
                      />
                      <button
                        onClick={handleNewBroadcastTest}
                        disabled={(() => {
                          if (!newBroadcastTestNumber.trim() || !newBroadcastFrom || selectedRecipients.length === 0 || newBroadcastSendingTest) return true;
                          if (newBroadcastMessageType === 'template' && !selectedTemplate) return true;
                          if (newBroadcastMessageType === 'text' && !newBroadcastBody.trim()) return true;
                          if (newBroadcastMessageType === 'link' && !newBroadcastUrl.trim()) return true;
                          if (['image', 'video', 'audio', 'document'].includes(newBroadcastMessageType) && !newBroadcastMediaLibraryId) return true;
                          if (headerMediaType && !newBroadcastMediaLibraryId) return true;
                          return false;
                        })()}
                        style={{
                          padding: '10px 16px', borderRadius: 8, border: 'none',
                          background: C.primary, color: '#fff',
                          cursor: (() => {
                            if (!newBroadcastTestNumber.trim() || !newBroadcastFrom || selectedRecipients.length === 0 || newBroadcastSendingTest) return 'not-allowed';
                            if (newBroadcastMessageType === 'template' && !selectedTemplate) return 'not-allowed';
                            if (newBroadcastMessageType === 'text' && !newBroadcastBody.trim()) return 'not-allowed';
                            if (newBroadcastMessageType === 'link' && !newBroadcastUrl.trim()) return 'not-allowed';
                            if (['image', 'video', 'audio', 'document'].includes(newBroadcastMessageType) && !newBroadcastMediaLibraryId) return 'not-allowed';
                            return 'pointer';
                          })(),
                          fontSize: 12, fontWeight: 700, fontFamily: FONT,
                          opacity: (() => {
                            if (!newBroadcastTestNumber.trim() || !newBroadcastFrom || selectedRecipients.length === 0 || newBroadcastSendingTest) return 0.5;
                            if (newBroadcastMessageType === 'template' && !selectedTemplate) return 0.5;
                            if (newBroadcastMessageType === 'text' && !newBroadcastBody.trim()) return 0.5;
                            if (newBroadcastMessageType === 'link' && !newBroadcastUrl.trim()) return 0.5;
                            if (['image', 'video', 'audio', 'document'].includes(newBroadcastMessageType) && !newBroadcastMediaLibraryId) return 0.5;
                            return 1;
                          })(),
                          display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
                        }}
                      >
                        {newBroadcastSendingTest ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={14} />}
                        Send Test
                      </button>
                    </div>
                  </div>
                </div>

                {/* RIGHT — WhatsApp Preview */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, paddingTop: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: '#888', fontFamily: FONT }}>Live Preview</div>
                  {newBroadcastMessageType === 'template' ? (
                    <WhatsAppPreview template={previewTemplate} minHeight={280} emptyText="Select a template&#10;to preview" />
                  ) : (
                    <BroadcastMessagePreview
                      messageType={newBroadcastMessageType}
                      body={newBroadcastBody}
                      url={newBroadcastUrl}
                      mediaLibraryId={newBroadcastMediaLibraryId}
                      caption={newBroadcastCaption}
                      mediaItems={newBroadcastMediaItems}
                    />
                  )}
                </div>
              </div>

              {/* Divider */}
              <div style={{ borderTop: `1px solid ${C.border}`, margin: '0 24px' }} />

              {/* Bottom section: Contacts Table */}
              <div style={{ padding: '20px 24px', flexShrink: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 12 }}>Select Recipients</div>

                {/* Toolbar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    background: 'var(--c-chatPanel)', borderRadius: 8,
                    padding: '8px 12px', flex: 1, minWidth: 200, maxWidth: 360,
                  }}>
                    <Search size={16} color={C.textMuted} />
                    <input
                      value={contactSearch}
                      onChange={e => setContactSearch(e.target.value)}
                      placeholder="Search contacts..."
                      style={{
                        flex: 1, border: 'none', background: 'transparent',
                        fontSize: 14, fontFamily: FONT, outline: 'none', color: C.text,
                      }}
                    />
                  </div>

                  <TagMultiSelect
                    categories={categories}
                    tags={tags}
                    selectedIds={contactFilterTagIds}
                    onChange={setContactFilterTagIds}
                    minWidth={180}
                  />

                  {(contactSearch || contactFilterTagIds.length > 0) && (
                    <button
                      onClick={() => { setContactSearch(''); setContactFilterTagIds([]); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        padding: '8px 12px', borderRadius: 8,
                        border: `1px solid ${C.border}`, background: 'var(--c-cardBg)',
                        cursor: 'pointer', fontSize: 12, fontWeight: 600,
                        color: C.textSecondary, fontFamily: FONT,
                      }}
                    >
                      <X size={12} /> Clear
                    </button>
                  )}

                  {selectedRecipients.length > 0 && (
                    <span style={{
                      fontSize: 12, fontWeight: 600, color: C.primary,
                      background: C.primaryLight, padding: '6px 12px', borderRadius: 8,
                    }}>
                      {selectedRecipients.length} selected
                    </span>
                  )}
                </div>

                {/* Contacts Table */}
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT, fontSize: 13 }}>
                      <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                        <tr style={{ background: 'var(--c-hover)' }}>
                          <th style={{ padding: '12px 8px 12px 16px', textAlign: 'center', fontWeight: 600, color: C.textSecondary, borderBottom: `1px solid ${C.border}`, width: 40 }}>
                            <input
                              type="checkbox"
                              checked={allSelected}
                              ref={el => { if (el) el.indeterminate = someSelected; }}
                              onChange={toggleSelectAll}
                              style={{ cursor: 'pointer', width: 16, height: 16 }}
                            />
                          </th>
                          <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: C.textSecondary, borderBottom: `1px solid ${C.border}` }}>Name</th>
                          <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: C.textSecondary, borderBottom: `1px solid ${C.border}` }}>Phone</th>
                          {categories.map(cat => (
                            <th key={cat.id} style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: C.textSecondary, borderBottom: `1px solid ${C.border}` }}>{cat.name}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {contactsLoading && contacts.length === 0 && (
                          <tr>
                            <td colSpan={3 + categories.length} style={{ padding: 40, textAlign: 'center', color: C.textMuted }}>
                              <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 8px' }} />
                              <div style={{ fontSize: 13 }}>Loading contacts…</div>
                            </td>
                          </tr>
                        )}
                        {!contactsLoading && filteredContacts.length === 0 && (
                          <tr>
                            <td colSpan={3 + categories.length} style={{ padding: 40, textAlign: 'center', color: C.textMuted, fontSize: 13 }}>
                              {contactSearch || contactFilterTagIds.length > 0 ? 'No contacts match your filters' : 'No saved contacts for this number'}
                            </td>
                          </tr>
                        )}
                        {filteredContacts.map(c => {
                          const isSelected = selectedContactNumbers.has(c.contact_number);
                          return (
                            <tr key={c.contact_number} style={{ background: isSelected ? 'var(--c-primaryLight)' : 'var(--c-cardBg)', borderBottom: `1px solid ${C.border}`, cursor: 'pointer' }}
                              onClick={() => toggleSelectOne(c.contact_number)}
                              onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#f9fafb'; }}
                              onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = '#fff'; }}
                            >
                              <td style={{ padding: '12px 8px 12px 16px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleSelectOne(c.contact_number)}
                                  style={{ cursor: 'pointer', width: 16, height: 16 }}
                                />
                              </td>
                              <td style={{ padding: '12px 16px', fontWeight: 600, color: C.text }}>{c.name}</td>
                              <td style={{ padding: '12px 16px', color: C.textSecondary }}><MaskedNumber number={c.contact_number} prefix="+" /></td>
                              {categories.map(cat => {
                                const tag = (c.tags || []).find(t => t.category_id === cat.id);
                                const info = tag ? getTagInfo(tag) : null;
                                return (
                                  <td key={cat.id} style={{ padding: '12px 16px' }}>
                                    {info ? <TagBadge tag={info} /> : <span style={{ color: C.textMuted, fontSize: 12 }}>—</span>}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Footer Buttons */}
              <div style={{
                display: 'flex', gap: 10, justifyContent: 'flex-end',
                padding: '16px 24px 20px', borderTop: `1px solid ${C.border}`, flexShrink: 0,
              }}>
                <button onClick={closeNewBroadcastModal} style={{
                  padding: '10px 18px', borderRadius: 8, border: `1px solid ${C.border}`,
                  background: 'transparent', cursor: 'pointer', fontSize: 13,
                  fontWeight: 600, color: C.textSecondary, fontFamily: FONT,
                }}>Cancel</button>
                <button
                  onClick={() => handleNewBroadcastSave('DRAFT')}
                  disabled={isBroadcastFormInvalid()}
                  style={{
                    padding: '10px 18px', borderRadius: 8, border: `1.5px solid ${C.primary}`,
                    background: 'var(--c-cardBg)', color: C.primary, cursor: isBroadcastFormInvalid() ? 'not-allowed' : 'pointer',
                    fontSize: 13, fontWeight: 700, fontFamily: FONT,
                    opacity: isBroadcastFormInvalid() ? 0.5 : 1,
                  }}
                >
                  Save as Draft
                </button>
                <button
                  onClick={() => handleNewBroadcastSave('SENT')}
                  disabled={isBroadcastFormInvalid()}
                  style={{
                    padding: '10px 18px', borderRadius: 8, border: 'none',
                    background: isBroadcastFormInvalid() ? '#ccc' : C.primary,
                    color: '#fff', cursor: isBroadcastFormInvalid() ? 'not-allowed' : 'pointer',
                    fontSize: 13, fontWeight: 700, fontFamily: FONT,
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}
                >
                  {newBroadcasting && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />}
                  <Send size={14} /> Broadcast Now
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── DETAIL VIEW ────────────────────────────────────────────────────────────
  const b = selectedBroadcast;
  const tpl = templateForPreview(b);
  const metrics = b ? getMetrics(b) : null;

  return (
    <div style={{ padding: '24px 28px', fontFamily: FONT }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => { setView('list'); setSelectedBroadcast(null); }}
            style={{
              border: `1px solid ${C.border}`, background: 'var(--c-cardBg)', borderRadius: 8,
              padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
              color: C.textSecondary, fontSize: 13, fontWeight: 600, fontFamily: FONT,
            }}
          >
            <ArrowLeft size={14} /> Back
          </button>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: 0, letterSpacing: '-.02em', fontFamily: FONT }}>
              {b?.name || b?.template_name || 'Broadcast'} #{b?.id}
            </h1>
            <p style={{ fontSize: 12, color: C.textMuted, margin: '4px 0 0', fontFamily: FONT }}>
              Created {b?.created_at ? formatDate(b.created_at) : '—'}
            </p>
          </div>
          {b && <StatusBadge status={b.status} />}
        </div>
        <button
          onClick={() => { setRepeatModal(true); setRepeatTestNumber(b?.test_number || ''); }}
          style={{
            padding: '10px 18px', borderRadius: 8, border: 'none',
            background: C.primary, color: '#fff', cursor: 'pointer',
            fontSize: 13, fontWeight: 700, fontFamily: FONT,
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <Repeat size={14} /> Repeat Broadcast
        </button>
      </div>

      {detailLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 80, flexDirection: 'column', gap: 12 }}>
          <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', color: C.textMuted }} />
          <div style={{ fontSize: 13, color: C.textMuted }}>Loading broadcast details…</div>
        </div>
      ) : !b ? (
        <div style={{ textAlign: 'center', padding: 60, color: C.textMuted }}>Broadcast not found</div>
      ) : (
        <>
          {/* KPI Cards */}
          <KpiCards metrics={metrics} />

          {/* Info + Preview Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 24, marginBottom: 28 }}>
            {/* Info Card */}
            <div style={{ background: C.cardBg, borderRadius: 12, border: `1px solid ${C.border}`, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 4 }}>Broadcast Details</div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 20px' }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.textSecondary, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>From</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: C.text }}>
                    <Phone size={12} color={C.textMuted} /> <MaskedNumber number={b.from_number} prefix="+" />
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.textSecondary, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Template</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: C.text }}>
                    <FileText size={12} color={C.textMuted} /> {b.template_name || '—'}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.textSecondary, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Recipients</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: C.text }}>
                    <Users size={12} color={C.textMuted} /> {formatRecipients(b)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.textSecondary, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Created</div>
                  <div style={{ fontSize: 13, color: C.text }}>{formatDate(b.created_at)} {formatTime(b.created_at)}</div>
                </div>
                {b.test_number && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.textSecondary, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Test Number</div>
                    <div style={{ fontSize: 13, color: C.text }}><MaskedNumber number={b.test_number} prefix="+" /></div>
                  </div>
                )}
              </div>
            </div>

            {/* Preview */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: '#888', fontFamily: FONT }}>Template Preview</div>
              <WhatsAppPreview template={tpl} />
            </div>
          </div>

          {/* Activity Log */}
          <div style={{ background: C.cardBg, borderRadius: 12, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Activity Log</div>
              <div style={{ fontSize: 12, color: C.textMuted }}>{(b.logs || []).length} entries</div>
            </div>

            {(b.logs || []).length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center' }}>
                <div style={{ fontSize: 24, marginBottom: 8 }}>📋</div>
                <div style={{ fontSize: 13, color: C.textMuted }}>No activity yet. Send a test or broadcast to see entries here.</div>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#fafaf9', borderBottom: `1px solid ${C.border}` }}>
                    <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Action</th>
                    <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Sent To</th>
                    <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Status</th>
                    <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Sent At</th>
                  </tr>
                </thead>
                <tbody>
                  {(b.logs || []).map(log => (
                    <tr
                      key={log.id}
                      onClick={() => setSelectedLog(log)}
                      style={{
                        borderBottom: `1px solid ${C.border}`,
                        cursor: 'pointer',
                        transition: 'background .15s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = '#fafaf9'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <td style={{ padding: '10px 16px' }}><ActionBadge action={log.action} /></td>
                      <td style={{ padding: '10px 16px', color: C.textSecondary, fontSize: 13 }}>{formatSentTo(log)}</td>
                      <td style={{ padding: '10px 16px' }}><LogStatusBadge status={log.status} /></td>
                      <td style={{ padding: '10px 16px', color: C.textSecondary, fontSize: 12 }}>
                        {formatDate(log.sent_at)} {formatTime(log.sent_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* Activity Log Detail Modal */}
      {selectedLog && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 200, fontFamily: FONT,
        }}>
          <div style={{
            background: C.cardBg, borderRadius: 14,
            width: 480, maxHeight: '80vh',
            boxShadow: C.shadowLg, overflowY: 'auto',
            display: 'flex', flexDirection: 'column',
            padding: '24px 24px 20px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Activity Details</div>
              <button onClick={() => setSelectedLog(null)} style={{
                border: 'none', background: 'transparent', cursor: 'pointer', color: C.textMuted,
              }}><X size={18} /></button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.textSecondary, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Action</div>
                <ActionBadge action={selectedLog.action} />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.textSecondary, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Sent To</div>
                <div style={{ fontSize: 13, color: C.text, fontFamily: FONT, wordBreak: 'break-all' }}>{selectedLog.sent_to}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.textSecondary, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Status</div>
                <LogStatusBadge status={selectedLog.status} />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.textSecondary, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Sent At</div>
                <div style={{ fontSize: 13, color: C.text, fontFamily: FONT }}>{formatDate(selectedLog.sent_at)} {formatTime(selectedLog.sent_at)}</div>
              </div>
              {selectedLog.action === 'BROADCAST' && b?.statusRollup && (
                <div style={{
                  background: '#fafaf9', borderRadius: 8, padding: 12, border: `1px solid ${C.border}`,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.textSecondary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Delivery Summary</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: 8 }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>{b.statusRollup.total || 0}</div>
                      <div style={{ fontSize: 10, color: C.textMuted }}>Total</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#3b82f6' }}>{b.statusRollup.sent || 0}</div>
                      <div style={{ fontSize: 10, color: C.textMuted }}>Sent</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#10b981' }}>{b.statusRollup.delivered || 0}</div>
                      <div style={{ fontSize: 10, color: C.textMuted }}>Delivered</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#059669' }}>{b.statusRollup.read || 0}</div>
                      <div style={{ fontSize: 10, color: C.textMuted }}>Read</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#ef4444' }}>{b.statusRollup.failed || 0}</div>
                      <div style={{ fontSize: 10, color: C.textMuted }}>Failed</div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
              <button onClick={() => setSelectedLog(null)} style={{
                padding: '8px 16px', borderRadius: 8, border: `1px solid ${C.border}`,
                background: 'transparent', cursor: 'pointer', fontSize: 13,
                fontWeight: 600, color: C.textSecondary, fontFamily: FONT,
              }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Repeat Broadcast Modal */}
      {repeatModal && b && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 200, fontFamily: FONT,
        }}>
          <div style={{
            background: C.cardBg, borderRadius: 14,
            width: 820, maxHeight: '90vh',
            boxShadow: C.shadowLg, overflowY: 'auto',
            display: 'flex', flexDirection: 'column',
          }}>
            {/* Modal Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px 0' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>
                <Repeat size={18} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: 8, color: C.primary }} />
                Repeat Broadcast
              </div>
              <button onClick={() => { setRepeatModal(false); setRepeatTestNumber(''); }} style={{
                border: 'none', background: 'transparent', cursor: 'pointer', color: C.textMuted,
              }}><X size={20} /></button>
            </div>

            {/* Two-column body */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 24, padding: '20px 24px' }}>
              {/* LEFT — Test number + actions */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Readonly summary */}
                <div style={{
                  background: '#fafaf9', borderRadius: 8, padding: 12, border: `1px solid ${C.border}`,
                  display: 'flex', flexDirection: 'column', gap: 8,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Broadcast Summary</div>
                  <div style={{ fontSize: 13, color: C.text, fontFamily: FONT }}>
                    <strong>From:</strong> <MaskedNumber number={b.from_number} prefix="+" />
                  </div>
                  <div style={{ fontSize: 13, color: C.text, fontFamily: FONT }}>
                    <strong>To:</strong> {formatRecipients(b)}
                  </div>
                  <div style={{ fontSize: 13, color: C.text, fontFamily: FONT }}>
                    <strong>Template:</strong> {b.template_name || '—'}
                  </div>
                </div>

                {/* Test Number */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.textSecondary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Test Number</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="text"
                      value={repeatTestNumber}
                      onChange={e => setRepeatTestNumber(e.target.value)}
                      placeholder="+919876543210"
                      style={{
                        flex: 1, padding: '10px 12px', borderRadius: 8,
                        border: `1.5px solid ${C.border}`, fontSize: 13,
                        fontFamily: FONT, color: C.text, outline: 'none',
                      }}
                    />
                    <button
                      onClick={handleRepeatTest}
                      disabled={!repeatTestNumber.trim() || sendingTest}
                      style={{
                        padding: '10px 16px', borderRadius: 8, border: 'none',
                        background: C.primary, color: '#fff',
                        cursor: (!repeatTestNumber.trim() || sendingTest) ? 'not-allowed' : 'pointer',
                        fontSize: 12, fontWeight: 700, fontFamily: FONT,
                        opacity: (!repeatTestNumber.trim() || sendingTest) ? 0.5 : 1,
                        display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
                      }}
                    >
                      {sendingTest ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={14} />}
                      Send Test
                    </button>
                  </div>
                </div>

                <div style={{ flex: 1 }} />

                {/* Bottom Buttons */}
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
                  <button onClick={() => { setRepeatModal(false); setRepeatTestNumber(''); }} style={{
                    padding: '10px 18px', borderRadius: 8, border: `1px solid ${C.border}`,
                    background: 'transparent', cursor: 'pointer', fontSize: 13,
                    fontWeight: 600, color: C.textSecondary, fontFamily: FONT,
                  }}>Cancel</button>
                  <button
                    onClick={handleRepeatBroadcast}
                    disabled={repeatSending}
                    style={{
                      padding: '10px 18px', borderRadius: 8, border: 'none',
                      background: repeatSending ? '#ccc' : C.primary,
                      color: '#fff', cursor: repeatSending ? 'not-allowed' : 'pointer',
                      fontSize: 13, fontWeight: 700, fontFamily: FONT,
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}
                  >
                    {repeatSending && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />}
                    <Send size={14} /> Broadcast Now
                  </button>
                </div>
              </div>

              {/* RIGHT — Preview */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, paddingTop: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: '#888', fontFamily: FONT }}>Template Preview</div>
                <WhatsAppPreview template={tpl} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
