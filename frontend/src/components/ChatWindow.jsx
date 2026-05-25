import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Search, Loader2, MoreVertical, Phone, Pencil, X, Send, Lock, Paperclip, Image as ImageIcon, FileText, Video, Music, Library, RefreshCw, CheckCircle2, AlertTriangle, Mic, Square, Trash2, User, Download, Forward, Reply, Tag, UserPlus, Check } from 'lucide-react';
import { usePolling } from '../hooks/usePolling.js';
import { api } from '../api.js';
import { C, FONT, MONO, maskPhone, darkenColor } from '../constants.js';
import MessageBubble, { quoteSnippet } from './MessageBubble.jsx';
import MaskedNumber from './MaskedNumber.jsx';
import { CustomFieldEditor } from './CustomFieldInputs.jsx';

// Forward a message to another contact on the same WhatsApp number.
function ForwardModal({ waNumber, message, onClose }) {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [sendingTo, setSendingTo] = useState(null);
  const [result, setResult] = useState(null);
  useEffect(() => {
    let alive = true;
    api.contacts(waNumber, '30d')
      .then(rows => { if (alive) setContacts(Array.isArray(rows) ? rows : (rows?.contacts || [])); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [waNumber]);
  const text = message?.message_body || '';
  const s = q.toLowerCase();
  const filtered = contacts.filter(c => {
    const nm = (c.name || c.profile_name || '').toLowerCase();
    return !s || nm.includes(s) || (c.contact_number || '').includes(s);
  });
  const send = async (c) => {
    setSendingTo(c.contact_number); setResult(null);
    try {
      await api.sendMessage({ fromNumber: waNumber, toNumber: c.contact_number, text });
      setResult({ ok: true, msg: `Forwarded to ${c.name || c.profile_name || maskPhone(c.contact_number)}` });
      setTimeout(onClose, 900);
    } catch (e) {
      setResult({ ok: false, msg: /window/i.test(e.message || '') ? 'That contact is outside their 24h window — needs a template.' : 'Failed to forward.' });
    } finally { setSendingTo(null); }
  };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 330, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--c-cardBg)', borderRadius: 14, boxShadow: C.shadowLg, width: 'min(420px,100%)', maxHeight: '80vh', display: 'flex', flexDirection: 'column', fontFamily: FONT, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: C.text }}>Forward message</div>
          <button onClick={onClose} style={{ border: 'none', background: C.pageBg, borderRadius: 8, width: 28, height: 28, cursor: 'pointer', color: C.textSecondary }}><X size={15} /></button>
        </div>
        <div style={{ padding: '10px 16px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 6 }}>Forwarding:</div>
          <div style={{ fontSize: 13, color: C.text, background: C.pageBg, borderRadius: 8, padding: '8px 10px', maxHeight: 60, overflow: 'hidden' }}>{text ? (text.length > 120 ? text.slice(0, 120) + '…' : text) : '[no text content]'}</div>
        </div>
        <div style={{ padding: '10px 16px' }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search contacts…" style={{ width: '100%', border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, fontFamily: FONT, outline: 'none', boxSizing: 'border-box' }} />
        </div>
        {result && <div style={{ margin: '0 16px 8px', fontSize: 12.5, color: result.ok ? C.green : '#A32D2D', background: result.ok ? '#E3F2EC' : C.primaryLight, borderRadius: 8, padding: '8px 10px' }}>{result.msg}</div>}
        <div style={{ overflowY: 'auto', padding: '0 8px 10px' }}>
          {loading ? <div style={{ padding: 18, color: C.textMuted, fontSize: 13 }}>Loading…</div>
            : filtered.length === 0 ? <div style={{ padding: 18, color: C.textMuted, fontSize: 13 }}>No contacts.</div>
              : filtered.map(c => (
                <button key={c.contact_number} disabled={!!sendingTo || !text} onClick={() => send(c)}
                  onMouseEnter={e => { e.currentTarget.style.background = C.pageBg; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', border: 'none', background: 'transparent', cursor: text ? 'pointer' : 'not-allowed', padding: '9px 10px', borderRadius: 8, fontFamily: FONT, textAlign: 'left' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name || c.profile_name || `+${maskPhone(c.contact_number)}`}</div>
                    <div style={{ fontSize: 11.5, color: C.textMuted }}>+{maskPhone(c.contact_number)}</div>
                  </div>
                  {sendingTo === c.contact_number ? <span style={{ fontSize: 12, color: C.textMuted }}>Sending…</span> : <Forward size={15} style={{ color: C.textSecondary, flexShrink: 0 }} />}
                </button>
              ))
          }
        </div>
      </div>
    </div>
  );
}

export default function ChatWindow({ waNumber, contactNumber, onContactSaved }) {
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [contactName, setContactName] = useState(null);
  const [contactTags, setContactTags] = useState([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const [fieldDefs, setFieldDefs] = useState([]);
  const [contactFieldValues, setContactFieldValues] = useState({});
  const scrollRef = useRef(null);
  const [hasScrolled, setHasScrolled] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  // Chat-header quick-actions: tag + assign
  const [assignedUserId, setAssignedUserId] = useState(null);
  const [assignableUsers, setAssignableUsers] = useState(null); // null = non-admin/unknown -> Assign hidden
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);
  const [assignPopoverOpen, setAssignPopoverOpen] = useState(false);
  const [headerSaving, setHeaderSaving] = useState(false);
  const tagMenuRef = useRef(null);
  const assignMenuRef = useRef(null);

  const fetchMessages = useCallback(() => {
    return api.messages({
      waNumber,
      contactNumber,
      page: String(page),
      limit: String(limit),
      search,
    });
  }, [waNumber, contactNumber, page, limit, search]);

  // deps make search/page/contact changes refetch immediately (not on the next poll tick)
  const { data, loading, refetch } = usePolling(fetchMessages, 15000, [waNumber, contactNumber, page, search]);

  // Outbound: 24h window status + composer state
  const [windowStatus, setWindowStatus] = useState(null);
  const [composerText, setComposerText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [optimisticMessages, setOptimisticMessages] = useState([]);
  const [businessAvatarUrl, setBusinessAvatarUrl] = useState(null);
  const [forwardMsg, setForwardMsg] = useState(null); // message being forwarded (opens picker)
  const [replyTo, setReplyTo] = useState(null); // message being quote-replied to
  const [myReactions, setMyReactions] = useState({}); // messageId -> emoji ('' = removed), optimistic
  const [starOverrides, setStarOverrides] = useState({}); // messageId -> bool, optimistic

  // Send/remove our reaction to a message. Optimistic; reverts on failure.
  const handleReact = async (msg, emoji) => {
    const id = msg.message_id;
    if (!id) return;
    const prev = myReactions[id];
    setMyReactions(r => ({ ...r, [id]: emoji }));
    try {
      await api.react(waNumber, contactNumber, id, emoji);
    } catch (e) {
      setMyReactions(r => ({ ...r, [id]: prev }));
      setSendError(/window/i.test(e.message || '') ? 'Reactions need the 24-hour window open.' : 'Failed to send reaction');
    }
  };

  // Star / unstar a message. Optimistic; reverts on failure.
  const handleStar = async (msg, starred) => {
    const id = msg.message_id;
    if (!id) return;
    const prev = starOverrides[id];
    setStarOverrides(s => ({ ...s, [id]: starred }));
    try {
      await api.star(waNumber, contactNumber, id, starred);
    } catch (e) {
      setStarOverrides(s => ({ ...s, [id]: prev }));
      setSendError('Failed to update star');
    }
  };

  useEffect(() => {
    if (!waNumber || !contactNumber) return;
    setOptimisticMessages([]);
    api.windowStatus(waNumber, contactNumber)
      .then(setWindowStatus)
      .catch(() => setWindowStatus({ canSendFreeForm: false, reason: 'lookup failed' }));
  }, [waNumber, contactNumber]);

  // Fetch business avatar for outgoing voice-message bubbles
  useEffect(() => {
    if (!waNumber) { setBusinessAvatarUrl(null); return; }
    api.numbers()
      .then(nums => {
        const normalized = waNumber.replace(/\D/g, '');
        const match = nums.find(n => n.wa_number === waNumber || n.wa_number === normalized);
        setBusinessAvatarUrl(match?.profile_picture_url || null);
      })
      .catch(() => setBusinessAvatarUrl(null));
  }, [waNumber]);

  // Re-check window status every 60s (the window may open or close while open)
  useEffect(() => {
    if (!waNumber || !contactNumber) return;
    const t = setInterval(() => {
      api.windowStatus(waNumber, contactNumber).then(setWindowStatus).catch(() => {});
    }, 60000);
    return () => clearInterval(t);
  }, [waNumber, contactNumber]);

  // Drop optimistic messages once they appear in the real polled list
  useEffect(() => {
    if (!data?.messages || optimisticMessages.length === 0) return;
    const realBodies = new Set(
      data.messages
        .filter(m => m.direction === 'outgoing' && m.message_body)
        .map(m => `${m.message_body}|${(m.contact_number || '').replace(/\D/g, '')}`)
    );
    setOptimisticMessages(prev => prev.filter(o =>
      !realBodies.has(`${o.message_body}|${(o.contact_number || '').replace(/\D/g, '')}`)
    ));
  }, [data]);

  // Media composer state
  const [pendingFile, setPendingFile] = useState(null);
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState(null);
  const [pendingCaption, setPendingCaption] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const attachFile = (file) => {
    if (!file) return;
    if (file.size > 16 * 1024 * 1024) { setSendError('File too large (max 16MB)'); return; }
    setPendingFile(file);
    setPendingCaption('');
    setSendError('');
    if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
      const url = URL.createObjectURL(file);
      setPendingPreviewUrl(url);
    } else {
      setPendingPreviewUrl(null);
    }
  };

  const clearPending = () => {
    setPendingFile(null);
    setPendingCaption('');
    if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
    setPendingPreviewUrl(null);
  };

  // Ctrl+V paste handler — Forge convention: file inputs must support paste
  useEffect(() => {
    if (!waNumber || !contactNumber) return;
    const onPaste = (e) => {
      const items = Array.from(e.clipboardData?.items || []);
      const fileItem = items.find(i => i.kind === 'file');
      if (fileItem) {
        const file = fileItem.getAsFile();
        if (file) attachFile(file);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [waNumber, contactNumber]);

  // ─── Media Library picker ──────────────────────────────────────────────
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [librarySending, setLibrarySending] = useState(false);

  const handleSendLibraryMedia = async ({ mediaLibraryId, caption, kind, originalName, mimeType }) => {
    setLibrarySending(true);
    const ctxId = replyTo?.message_id;
    setReplyTo(null);
    const tempId = `tmp-${Date.now()}`;
    setOptimisticMessages(prev => [...prev, {
      message_id: tempId, direction: 'outgoing', message_type: kind,
      message_body: caption || originalName, status: 'sending',
      timestamp: new Date().toISOString(),
      contact_number: contactNumber.replace(/\D/g, ''),
      wa_number: waNumber.replace(/\D/g, ''),
      media_mime_type: mimeType,
      context_message_id: ctxId || null,
    }]);
    try {
      await api.sendLibraryMedia({
        fromNumber: waNumber, toNumber: contactNumber,
        mediaLibraryId, caption: caption || undefined, contextMessageId: ctxId,
      });
      setLibraryOpen(false);
    } catch (err) {
      setSendError(err.message || 'Library send failed');
      setOptimisticMessages(prev => prev.map(o => o.message_id === tempId ? { ...o, status: 'failed' } : o));
    } finally {
      setLibrarySending(false);
    }
  };

  const handleSendMedia = async () => {
    if (!pendingFile || sending) return;
    setSendError('');
    setSending(true);
    const ctxId = replyTo?.message_id;
    setReplyTo(null);
    const tempId = `tmp-${Date.now()}`;
    const kind = pendingFile.type.startsWith('image/') ? 'image'
      : pendingFile.type.startsWith('video/') ? 'video'
      : pendingFile.type.startsWith('audio/') ? 'audio' : 'document';
    setOptimisticMessages(prev => [...prev, {
      message_id: tempId, direction: 'outgoing', message_type: kind,
      message_body: pendingCaption || pendingFile.name, status: 'sending',
      timestamp: new Date().toISOString(),
      contact_number: contactNumber.replace(/\D/g, ''),
      wa_number: waNumber.replace(/\D/g, ''),
      media_mime_type: pendingFile.type,
      context_message_id: ctxId || null,
    }]);
    const fileSnapshot = pendingFile;
    const captionSnapshot = pendingCaption;
    clearPending();
    try {
      await api.sendMedia({ fromNumber: waNumber, toNumber: contactNumber, caption: captionSnapshot, file: fileSnapshot, contextMessageId: ctxId });
    } catch (err) {
      setSendError(err.message || 'Media send failed');
      setOptimisticMessages(prev => prev.map(o => o.message_id === tempId ? { ...o, status: 'failed' } : o));
    } finally {
      setSending(false);
    }
  };

  // Audio recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState(null);
  const recorderRef = useRef(null);
  const recorderChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);

  const startRecording = async () => {
    setSendError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setSendError('Recording not supported in this browser');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Prefer ogg/opus if browser supports it (less work for our transcoder)
      const candidateTypes = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm'];
      const mimeType = candidateTypes.find(t => MediaRecorder.isTypeSupported(t)) || '';
      const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderChunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data?.size > 0) recorderChunksRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(recorderChunksRef.current, { type: rec.mimeType || 'audio/webm' });
        setAudioBlob(blob);
        setAudioPreviewUrl(URL.createObjectURL(blob));
        setIsRecording(false);
        if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
      };
      rec.start();
      recorderRef.current = rec;
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => setRecordingSeconds(s => s + 1), 1000);
    } catch (err) {
      setSendError(err.name === 'NotAllowedError' ? 'Microphone permission denied' : `Recording failed: ${err.message}`);
    }
  };

  const stopRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
  };

  const cancelRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    if (audioPreviewUrl) { URL.revokeObjectURL(audioPreviewUrl); }
    setAudioBlob(null);
    setAudioPreviewUrl(null);
    setIsRecording(false);
    setRecordingSeconds(0);
  };

  const sendAudio = async () => {
    if (!audioBlob || sending) return;
    setSendError('');
    setSending(true);
    const ctxId = replyTo?.message_id;
    setReplyTo(null);
    const tempId = `tmp-${Date.now()}`;
    setOptimisticMessages(prev => [...prev, {
      message_id: tempId, direction: 'outgoing', message_type: 'audio',
      message_body: 'Voice message', status: 'sending',
      timestamp: new Date().toISOString(),
      contact_number: contactNumber.replace(/\D/g, ''),
      wa_number: waNumber.replace(/\D/g, ''),
      media_mime_type: audioBlob.type,
      context_message_id: ctxId || null,
    }]);
    const blobSnapshot = audioBlob;
    cancelRecording();
    try {
      const file = new File([blobSnapshot], 'voice.webm', { type: blobSnapshot.type || 'audio/webm' });
      await api.sendAudio({ fromNumber: waNumber, toNumber: contactNumber, file, contextMessageId: ctxId });
    } catch (err) {
      setSendError(err.message || 'Voice send failed');
      setOptimisticMessages(prev => prev.map(o => o.message_id === tempId ? { ...o, status: 'failed' } : o));
    } finally {
      setSending(false);
    }
  };

  // Cleanup recording on unmount / chat switch
  useEffect(() => () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try { recorderRef.current.stop(); } catch {}
    }
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl);
  }, [waNumber, contactNumber]);

  const handleSend = async () => {
    if (audioBlob) return sendAudio();
    if (pendingFile) return handleSendMedia();
    const text = composerText.trim();
    if (!text || sending) return;
    setSendError('');
    setSending(true);
    const ctxId = replyTo?.message_id;
    setReplyTo(null);
    // Optimistic bubble shown immediately
    const tempId = `tmp-${Date.now()}`;
    const optimistic = {
      message_id: tempId,
      direction: 'outgoing',
      message_type: 'text',
      message_body: text,
      status: 'sending',
      timestamp: new Date().toISOString(),
      contact_number: contactNumber.replace(/\D/g, ''),
      wa_number: waNumber.replace(/\D/g, ''),
      context_message_id: ctxId || null,
    };
    setOptimisticMessages(prev => [...prev, optimistic]);
    setComposerText('');
    try {
      await api.sendMessage({ fromNumber: waNumber, toNumber: contactNumber, text, contextMessageId: ctxId });
    } catch (err) {
      setSendError(err.message || 'Send failed');
      setOptimisticMessages(prev => prev.map(o =>
        o.message_id === tempId ? { ...o, status: 'failed' } : o
      ));
    } finally {
      setSending(false);
    }
  };

  // Fetch contact name and tags
  const refreshContactName = useCallback(() => {
    if (!waNumber) { setContactName(null); return; }
    api.contactNames(waNumber)
      .then(map => setContactName(map[contactNumber] || null))
      .catch(() => setContactName(null));
    api.contact(waNumber, contactNumber)
      .then(data => {
        setContactTags(data.tags || []);
        setContactFieldValues(data.custom_fields || {});
        setAssignedUserId(data.assigned_user_id ?? null);
      })
      .catch(() => {
        setContactTags([]);
        setContactFieldValues({});
        setAssignedUserId(null);
      });
  }, [waNumber, contactNumber]);

  useEffect(() => {
    refreshContactName();
  }, [refreshContactName]);

  // Reset on number/contact change
  useEffect(() => {
    setPage(1);
    setSearch('');
    setSearchInput('');
    setSearchOpen(false);
    setMenuOpen(false);
    setHasScrolled(false);
    setIsEditing(false);
    setEditValue('');
    setContactTags([]);
    setContactFieldValues({});
    setReplyTo(null);
    setMyReactions({});
    setStarOverrides({});
    setAssignedUserId(null);
    setTagPopoverOpen(false);
    setAssignPopoverOpen(false);
  }, [waNumber, contactNumber]);

  // Mark this conversation read when opened (clears its unread badge)
  useEffect(() => {
    if (!waNumber || !contactNumber) return;
    api.markRead(waNumber, contactNumber).catch(() => {});
  }, [waNumber, contactNumber]);

  // Keep it read while open: re-mark whenever new messages arrive
  const lastMsgCountRef = useRef(0);
  useEffect(() => {
    const n = data?.messages?.length || 0;
    if (n > lastMsgCountRef.current && lastMsgCountRef.current !== 0 && waNumber && contactNumber) {
      api.markRead(waNumber, contactNumber).catch(() => {});
    }
    lastMsgCountRef.current = n;
  }, [data, waNumber, contactNumber]);

  // Load categories + tags when the contact edit modal opens.
  useEffect(() => {
    if (!isEditing) return;
    Promise.all([
      api.categories.list().catch(() => []),
      api.tags.list().catch(() => []),
      api.contactFields.list().catch(() => []),
    ]).then(([cats, tgs, flds]) => {
      setCategories(cats);
      setAllTags(tgs);
      setFieldDefs(flds);
    });
  }, [isEditing, waNumber, contactNumber]);

  // Load tag categories + assignable users for the header quick-actions.
  // api.users.list() is admin-only (403 for sales/viewer) -> assignableUsers stays
  // null and the Assign control is hidden, matching the existing admin-only UX.
  useEffect(() => {
    if (!waNumber || !contactNumber) return;
    Promise.all([
      api.categories.list().catch(() => []),
      api.tags.list().catch(() => []),
      api.users.list().catch(() => null),
    ]).then(([cats, tgs, usrs]) => {
      setCategories(cats);
      setAllTags(tgs);
      setAssignableUsers(usrs);
    });
  }, [waNumber, contactNumber]);

  // Auto-scroll to bottom on first load
  useEffect(() => {
    if (data?.messages?.length && !hasScrolled && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setHasScrolled(true);
    }
  }, [data, hasScrolled]);

  const handleSearch = () => {
    setPage(1);
    setSearch(searchInput);
  };

  // Debounced live search: fires ~250ms after typing pauses (min 2 chars). Paired with
  // usePolling's deps above, the result now appears immediately instead of on the next poll.
  useEffect(() => {
    const trimmed = searchInput.trim();
    const t = setTimeout(() => {
      if (trimmed.length >= 2 && trimmed !== search) {
        setPage(1);
        setSearch(trimmed);
      } else if (trimmed.length < 2 && search !== '') {
        setPage(1);
        setSearch('');
      }
    }, 250);
    return () => clearTimeout(t);
  }, [searchInput, search]);

  // Close the 3-dot menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  // Close the header tag/assign popovers on outside click
  useEffect(() => {
    if (!tagPopoverOpen && !assignPopoverOpen) return;
    const onDown = (e) => {
      if (tagMenuRef.current && !tagMenuRef.current.contains(e.target)) setTagPopoverOpen(false);
      if (assignMenuRef.current && !assignMenuRef.current.contains(e.target)) setAssignPopoverOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [tagPopoverOpen, assignPopoverOpen]);

  const handleLoadOlder = () => {
    setPage(p => p + 1);
    setHasScrolled(false);
  };

  const handleEditClick = () => {
    setEditValue(contactName || '');
    setIsEditing(true);
  };

  const toggleContactTag = (tag) => {
    const exists = contactTags.find(t => t.id === tag.id);
    if (exists) {
      setContactTags(prev => prev.filter(t => t.id !== tag.id));
    } else {
      // Only one tag per category: remove any other tag from the same category first
      setContactTags(prev => [
        ...prev.filter(t => t.category_id !== tag.category_id),
        { id: tag.id, name: tag.name, color: tag.color, category_id: tag.category_id }
      ]);
    }
  };

  // Persist a header quick-action. name '' = "don't touch the name" (backend
  // preserves it); customFields omitted (undefined) = preserve; assigned omitted
  // = preserve assignment, null = unassign, number = assign.
  const persistContact = async ({ tags = contactTags, assigned } = {}) => {
    await api.saveContact(waNumber, contactNumber, '', tags, undefined, assigned);
    if (onContactSaved) onContactSaved();
  };

  // Header tag toggle: optimistic update + persist, revert on failure.
  const handleHeaderToggleTag = async (tag) => {
    const prev = contactTags;
    const exists = prev.some(t => t.id === tag.id);
    const next = exists
      ? prev.filter(t => t.id !== tag.id)
      : [...prev.filter(t => t.category_id !== tag.category_id),
         { id: tag.id, name: tag.name, color: tag.color, category_id: tag.category_id }];
    setContactTags(next);
    setHeaderSaving(true);
    try {
      await persistContact({ tags: next });
    } catch (err) {
      setContactTags(prev);
      alert('Failed to update tags: ' + err.message);
    } finally {
      setHeaderSaving(false);
    }
  };

  // Header assign: optimistic update + persist, revert on failure.
  const handleHeaderAssign = async (userId) => {
    const prev = assignedUserId;
    setAssignedUserId(userId);
    setAssignPopoverOpen(false);
    setHeaderSaving(true);
    try {
      await persistContact({ assigned: userId });
    } catch (err) {
      setAssignedUserId(prev);
      alert('Failed to update assignment: ' + err.message);
    } finally {
      setHeaderSaving(false);
    }
  };

  const handleSaveName = async () => {
    const name = editValue.trim();
    if (!name) return;
    setSaving(true);
    try {
      await api.saveContact(waNumber, contactNumber, name, contactTags, contactFieldValues);
      setContactName(name);
      setIsEditing(false);
      if (onContactSaved) onContactSaved();
    } catch (err) {
      alert('Failed to save contact: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditValue('');
  };

  // Filter out any legacy reaction-type chat rows (never rendered as bubbles).
  // Apply optimistic reaction/star overrides to a message before render.
  const applyOverrides = (m) => {
    let out = m;
    const mine = myReactions[m.message_id];
    if (mine !== undefined) {
      const others = (m.reactions || []).filter(r => r.direction !== 'outgoing');
      out = { ...out, reactions: mine ? [...others, { emoji: mine, direction: 'outgoing' }] : others };
    }
    const star = starOverrides[m.message_id];
    if (star !== undefined) out = { ...out, starred: star };
    return out;
  };
  const messages = [...(data?.messages || []), ...optimisticMessages]
    .filter(m => m.message_type !== 'reaction')
    .map(applyOverrides);
  const totalPages = data?.totalPages || 1;

  // Lookup so a reply bubble can resolve the message it quotes (by wamid).
  const messagesById = new Map();
  messages.forEach(m => { if (m.message_id) messagesById.set(m.message_id, m); });

  // Group messages by date
  const groups = [];
  let currentDate = null;
  messages.forEach(msg => {
    const d = new Date(msg.timestamp);
    const dateStr = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    if (dateStr !== currentDate) {
      currentDate = dateStr;
      groups.push({ type: 'date', date: dateStr });
    }
    groups.push({ type: 'msg', msg });
  });

  const displayTitle = contactName || `+${contactNumber}`;

  const closeSearch = () => { setSearchOpen(false); setSearchInput(''); };

  // Export the currently-loaded conversation as a plain-text file
  const handleExportChat = () => {
    const lines = messages.map(m => {
      const t = new Date(m.timestamp).toLocaleString('en-IN');
      const who = m.direction === 'outgoing' ? 'You' : (contactName || `+${contactNumber}`);
      const body = m.message_body || `[${m.message_type || 'media'}]`;
      return `[${t}] ${who}: ${body}`;
    });
    const head = `Chat with ${displayTitle} (+${contactNumber})\nExported ${new Date().toLocaleString('en-IN')}\n${'='.repeat(44)}\n\n`;
    const blob = new Blob([head + lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-${contactNumber}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setMenuOpen(false);
  };

  const headerIconBtn = {
    width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'transparent',
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#fff', flexShrink: 0,
  };
  const menuItemStyle = {
    display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 14px',
    border: 'none', background: 'var(--c-cardBg)', cursor: 'pointer', fontSize: 13, fontWeight: 500,
    color: C.text, fontFamily: FONT, textAlign: 'left',
  };

  return (
    <div style={{
      flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
      background: 'var(--c-chatWall)',
    }}>
      {/* Chat header — WhatsApp dark green style */}
      <div style={{
        padding: '10px 16px',
        background: '#008069',
        display: 'flex', alignItems: 'center', gap: 12,
        flexShrink: 0,
      }}>
        {searchOpen ? (
          /* Search mode — input takes the full row so nothing can overlap */
          <>
            <Search size={16} color="#fff" style={{ opacity: 0.8, flexShrink: 0 }} />
            <input
              autoFocus
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSearch(); if (e.key === 'Escape') closeSearch(); }}
              placeholder="Search messages…"
              style={{
                flex: 1, minWidth: 0,
                padding: '8px 12px', borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.3)',
                fontSize: 13, fontFamily: FONT, outline: 'none',
                background: 'rgba(255,255,255,0.15)', color: '#fff',
              }}
            />
            <button onClick={closeSearch} title="Close search" style={headerIconBtn}>
              <X size={18} />
            </button>
          </>
        ) : (
          <>
            {/* Avatar */}
            <div style={{
              width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
              background: 'rgba(255,255,255,0.2)',
              color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, fontWeight: 700,
            }}>
              {contactName ? contactName.charAt(0).toUpperCase() : <Phone size={18} />}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 16, fontWeight: 600, color: '#fff',
                fontFamily: FONT,
                display: 'flex', alignItems: 'center', gap: 6, minWidth: 0,
              }}>
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                  {contactName || <MaskedNumber number={contactNumber} prefix="+" />}
                </span>
                <button
                  onClick={handleEditClick}
                  title="Edit contact name"
                  style={{
                    width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                    border: 'none', background: 'rgba(255,255,255,0.15)',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff',
                  }}
                >
                  <Pencil size={12} />
                </button>
              </div>
              <div style={{
                fontSize: 12, color: 'rgba(255,255,255,0.8)', fontFamily: FONT,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                <MaskedNumber number={contactNumber} prefix="+" />
              </div>
            </div>

            {/* Tag quick-action */}
            <div ref={tagMenuRef} style={{ position: 'relative', flexShrink: 0 }}>
              <button
                onClick={() => { setTagPopoverOpen(o => !o); setAssignPopoverOpen(false); }}
                title="Tags"
                style={{ ...headerIconBtn, position: 'relative', background: tagPopoverOpen ? 'rgba(255,255,255,0.22)' : 'transparent' }}
              >
                <Tag size={18} />
                {contactTags.length > 0 && (
                  <span style={{
                    position: 'absolute', top: -1, right: -1, minWidth: 15, height: 15, padding: '0 3px',
                    borderRadius: 8, background: '#fff', color: '#008069', fontSize: 10, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT,
                  }}>{contactTags.length}</span>
                )}
              </button>
              {tagPopoverOpen && (
                <div style={{
                  position: 'absolute', top: '112%', right: 0, width: 300, maxHeight: 380, overflowY: 'auto',
                  background: 'var(--c-cardBg)', borderRadius: 10, boxShadow: C.shadowLg, zIndex: 50,
                  fontFamily: FONT, border: `1px solid ${C.border}`, padding: '10px 12px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: C.text, textTransform: 'uppercase', letterSpacing: 0.4 }}>Tags</span>
                    {headerSaving && <Loader2 size={14} color={C.textMuted} style={{ animation: 'spin 1s linear infinite' }} />}
                  </div>
                  {allTags.length === 0 ? (
                    <div style={{ fontSize: 12.5, color: C.textMuted, padding: '6px 2px' }}>No tags defined yet.</div>
                  ) : categories.map(cat => {
                    const catTags = allTags.filter(t => t.category_id === cat.id);
                    if (catTags.length === 0) return null;
                    return (
                      <div key={cat.id} style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 5, fontWeight: 600 }}>{cat.name}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {catTags.map(tag => {
                            const isSel = contactTags.some(t => t.id === tag.id);
                            return (
                              <button
                                key={tag.id}
                                onClick={() => handleHeaderToggleTag(tag)}
                                style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 4,
                                  border: `1.5px solid ${isSel ? tag.color : C.border}`,
                                  background: isSel ? tag.color : 'var(--c-cardBg)',
                                  color: isSel ? '#fff' : C.textSecondary,
                                  borderRadius: 14, padding: '4px 10px', fontSize: 12, fontWeight: 600,
                                  cursor: 'pointer', fontFamily: FONT,
                                }}
                              >
                                {isSel && <Check size={11} />}{tag.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Assign quick-action (admin only) */}
            {Array.isArray(assignableUsers) && (
              <div ref={assignMenuRef} style={{ position: 'relative', flexShrink: 0 }}>
                <button
                  onClick={() => { setAssignPopoverOpen(o => !o); setTagPopoverOpen(false); }}
                  title="Assign to"
                  style={{ ...headerIconBtn, background: (assignPopoverOpen || assignedUserId) ? 'rgba(255,255,255,0.22)' : 'transparent' }}
                >
                  <UserPlus size={18} />
                </button>
                {assignPopoverOpen && (
                  <div style={{
                    position: 'absolute', top: '112%', right: 0, width: 260, maxHeight: 360, overflowY: 'auto',
                    background: 'var(--c-cardBg)', borderRadius: 10, boxShadow: C.shadowLg, zIndex: 50,
                    fontFamily: FONT, border: `1px solid ${C.border}`, overflow: 'hidden',
                  }}>
                    <div style={{ padding: '10px 14px', fontSize: 12, fontWeight: 700, color: C.text, textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: `1px solid ${C.border}` }}>Assign to</div>
                    <button
                      onClick={() => handleHeaderAssign(null)}
                      style={menuItemStyle}
                      onMouseEnter={e => { e.currentTarget.style.background = '#F3F4F6'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = '#fff'; }}
                    >
                      {assignedUserId == null
                        ? <Check size={15} color={C.primary} />
                        : <span style={{ width: 15, flexShrink: 0 }} />}
                      <span>Unassigned</span>
                    </button>
                    {assignableUsers.filter(u => u.isActive !== false).map(u => {
                      const sel = Number(assignedUserId) === Number(u.id);
                      const roleLabel = { admin: 'Admin', bda_sales: 'Sales', viewer: 'Viewer' }[u.role] || u.role;
                      return (
                        <button
                          key={u.id}
                          onClick={() => handleHeaderAssign(u.id)}
                          style={menuItemStyle}
                          onMouseEnter={e => { e.currentTarget.style.background = '#F3F4F6'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = '#fff'; }}
                        >
                          {sel
                            ? <Check size={15} color={C.primary} />
                            : <span style={{ width: 15, flexShrink: 0 }} />}
                          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {(u.displayName || u.username)} · {roleLabel}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Search toggle */}
            <button onClick={() => setSearchOpen(true)} title="Search messages" style={headerIconBtn}>
              <Search size={18} />
            </button>

            {/* 3-dot menu */}
            <div ref={menuRef} style={{ position: 'relative', flexShrink: 0 }}>
              <button onClick={() => setMenuOpen(o => !o)} title="More options" style={headerIconBtn}>
                <MoreVertical size={18} />
              </button>
              {menuOpen && (
                <div style={{
                  position: 'absolute', top: '110%', right: 0,
                  background: 'var(--c-cardBg)', borderRadius: 10, boxShadow: C.shadowLg,
                  minWidth: 180, zIndex: 50, overflow: 'hidden', fontFamily: FONT,
                  border: `1px solid ${C.border}`,
                }}>
                  <button
                    onClick={() => { handleEditClick(); setMenuOpen(false); }}
                    style={menuItemStyle}
                    onMouseEnter={e => { e.currentTarget.style.background = '#F3F4F6'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = '#fff'; }}
                  >
                    <User size={15} color={C.textSecondary} /><span>Contact info</span>
                  </button>
                  <button
                    onClick={() => { refetch(); setMenuOpen(false); }}
                    style={menuItemStyle}
                    onMouseEnter={e => { e.currentTarget.style.background = '#F3F4F6'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = '#fff'; }}
                  >
                    <RefreshCw size={15} color={C.textSecondary} /><span>Refresh</span>
                  </button>
                  <button
                    onClick={handleExportChat}
                    disabled={messages.length === 0}
                    style={{ ...menuItemStyle, opacity: messages.length === 0 ? 0.5 : 1, cursor: messages.length === 0 ? 'not-allowed' : 'pointer' }}
                    onMouseEnter={e => { if (messages.length) e.currentTarget.style.background = '#F3F4F6'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = '#fff'; }}
                  >
                    <Download size={15} color={C.textSecondary} /><span>Export chat</span>
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Messages area with WhatsApp background pattern */}
      <div ref={scrollRef} style={{
        flex: 1, overflowY: 'auto',
        background: 'var(--c-chatWall)',
        backgroundImage: `url("data:image/svg+xml,%3Csvg width='100' height='100' viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 0h50v50H0z' fill='%23d1d7db' fill-opacity='0.12'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'repeat',
        padding: '16px 20px',
        display: 'flex', flexDirection: 'column', gap: 2,
      }}>
        {loading && page === 1 && messages.length === 0 && (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: C.textMuted,
          }}>
            <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ marginLeft: 8, fontSize: 13 }}>Loading messages...</span>
          </div>
        )}

        {page < totalPages && (
          <button
            onClick={handleLoadOlder}
            style={{
              alignSelf: 'center',
              padding: '8px 16px', borderRadius: 8,
              border: `1px solid ${C.border}`,
              background: 'var(--c-cardBg)',
              cursor: 'pointer',
              fontSize: 12, fontWeight: 600, color: C.textSecondary,
              fontFamily: FONT, marginBottom: 8,
              boxShadow: C.shadowSm,
            }}
          >
            Load older messages
          </button>
        )}

        {groups.map((g, i) => {
          if (g.type === 'date') {
            return (
              <div key={`d-${i}`} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '12px 0',
              }}>
                <span style={{
                  fontSize: 11, fontWeight: 600, color: C.textMuted,
                  background: 'var(--c-cardBg)',
                  padding: '4px 12px', borderRadius: 99,
                  fontFamily: FONT,
                  boxShadow: C.shadowSm,
                }}>
                  {g.date}
                </span>
              </div>
            );
          }
          return (
            <MessageBubble
              key={g.msg.id || g.msg.message_id}
              message={g.msg}
              isOutgoing={g.msg.direction === 'outgoing'}
              senderAvatarUrl={businessAvatarUrl}
              contactName={contactName}
              onForward={setForwardMsg}
              onReply={setReplyTo}
              onReact={handleReact}
              canReact={windowStatus?.canSendFreeForm}
              onStar={handleStar}
              quotedMessage={g.msg.context_message_id ? messagesById.get(g.msg.context_message_id) : null}
            />
          );
        })}

        {messages.length === 0 && !loading && (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: C.textMuted, fontSize: 13,
          }}>
            No messages yet
          </div>
        )}
      </div>

      {/* Forward picker */}
      {forwardMsg && (
        <ForwardModal waNumber={waNumber} message={forwardMsg} onClose={() => setForwardMsg(null)} />
      )}

      {/* Reply composer */}
      <div style={{ borderTop: `1px solid ${C.borderDark}`, background: 'var(--c-chatPanel)', flexShrink: 0 }}>
        {windowStatus && !windowStatus.canSendFreeForm && (
          <div style={{ padding: '8px 16px', background: '#FFF3E0', borderBottom: `1px solid #FFB74D`, fontSize: 12, color: '#E65100', fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Lock size={13} />
            <span>
              {windowStatus.reason ? (
                // Couldn't resolve a sending account (e.g. this WhatsApp number
                // isn't registered, is inactive, or has no token) — NOT a 24h timeout.
                <>{windowStatus.reason}. Add or activate this number in Settings → WhatsApp Accounts to send.</>
              ) : windowStatus.lastIncomingSecondsAgo == null ? (
                <>No inbound message from this contact yet. Start the conversation with an approved template via Bulk Message.</>
              ) : (
                <>Outside the 24-hour reply window (last inbound {Math.floor(windowStatus.lastIncomingSecondsAgo / 3600)}h ago). Send an approved template via Bulk Message instead.</>
              )}
            </span>
          </div>
        )}
        {sendError && (
          <div style={{ padding: '6px 16px', background: 'var(--c-primaryLight)', color: '#A32D2D', fontSize: 12, fontFamily: FONT, borderBottom: `1px solid #F8C8C8` }}>
            {sendError}
          </div>
        )}
        {/* Reply preview bar — the message being quote-replied to */}
        {replyTo && (
          <div style={{ padding: '8px 16px', background: 'var(--c-cardBg)', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'stretch', gap: 10 }}>
            <Reply size={16} color={C.textMuted} style={{ alignSelf: 'center', flexShrink: 0 }} />
            <div style={{ width: 3, borderRadius: 3, flexShrink: 0, background: replyTo.direction === 'outgoing' ? '#06cf9c' : '#34b7f1' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, fontFamily: FONT, color: replyTo.direction === 'outgoing' ? '#06cf9c' : '#34b7f1' }}>
                {replyTo.direction === 'outgoing' ? 'You' : (contactName || `+${contactNumber}`)}
              </div>
              <div style={{ fontSize: 12, color: C.textSecondary, fontFamily: FONT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {quoteSnippet(replyTo)}
              </div>
            </div>
            <button onClick={() => setReplyTo(null)} title="Cancel reply" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: C.textMuted, padding: 4, alignSelf: 'center', flexShrink: 0 }}>
              <X size={16} />
            </button>
          </div>
        )}
        {/* Audio preview — recorded but not yet sent */}
        {audioBlob && !isRecording && (
          <div style={{ padding: '10px 16px', background: 'var(--c-cardBg)', borderBottom: `1px solid ${C.border}`, display: 'flex', gap: 12, alignItems: 'center' }}>
            <Mic size={20} color={C.primary} />
            <audio controls src={audioPreviewUrl} style={{ flex: 1, height: 36 }} />
            <button onClick={cancelRecording} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#A32D2D', padding: 4 }} title="Delete recording">
              <Trash2 size={16} />
            </button>
          </div>
        )}

        {/* Media preview row — appears once a file is attached */}
        {pendingFile && (
          <div style={{ padding: '10px 16px', background: 'var(--c-cardBg)', borderBottom: `1px solid ${C.border}`, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            {pendingPreviewUrl ? (
              pendingFile.type.startsWith('video/') ? (
                <video src={pendingPreviewUrl} style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8, background: '#000' }} />
              ) : (
                <img src={pendingPreviewUrl} alt="preview" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8 }} />
              )
            ) : (
              <div style={{ width: 80, height: 80, borderRadius: 8, background: 'var(--c-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <FileText size={32} color={C.purple} />
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.text, fontFamily: FONT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pendingFile.name}</div>
              <div style={{ fontSize: 10, color: C.textMuted, fontFamily: MONO, marginTop: 2 }}>
                {pendingFile.type || 'unknown'} · {(pendingFile.size / 1024).toFixed(1)} KB
              </div>
              <input
                value={pendingCaption}
                onChange={e => setPendingCaption(e.target.value)}
                placeholder="Add a caption…"
                style={{ width: '100%', marginTop: 6, padding: '6px 10px', border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, fontFamily: FONT, outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
            <button onClick={clearPending} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: C.textMuted, padding: 4 }} title="Remove">
              <X size={16} />
            </button>
          </div>
        )}

        <div
          style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, position: 'relative' }}
          onDragOver={e => { e.preventDefault(); if (windowStatus?.canSendFreeForm) setDragOver(true); }}
          onDragLeave={e => { e.preventDefault(); setDragOver(false); }}
          onDrop={e => {
            e.preventDefault();
            setDragOver(false);
            if (!windowStatus?.canSendFreeForm) return;
            const file = e.dataTransfer?.files?.[0];
            if (file) attachFile(file);
          }}
        >
          {dragOver && (
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(220, 38, 38, 0.08)', border: `2px dashed ${C.primary}`, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.primary, fontSize: 13, fontWeight: 600, fontFamily: FONT, zIndex: 5, pointerEvents: 'none' }}>
              Drop file to attach
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            style={{ display: 'none' }}
            onChange={e => { attachFile(e.target.files?.[0]); e.target.value = ''; }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!windowStatus?.canSendFreeForm || sending || !!pendingFile}
            title="Attach file (or drag/drop, or Ctrl+V)"
            style={{
              width: 36, height: 36, borderRadius: 18, border: 'none', flexShrink: 0,
              background: !windowStatus?.canSendFreeForm || pendingFile ? 'var(--c-hover)' : 'var(--c-cardBg)',
              color: !windowStatus?.canSendFreeForm || pendingFile ? C.textMuted : C.textSecondary,
              cursor: !windowStatus?.canSendFreeForm || pendingFile ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: C.shadowSm,
            }}
          >
            <Paperclip size={16} />
          </button>

          <button
            type="button"
            onClick={() => setLibraryOpen(true)}
            disabled={!windowStatus?.canSendFreeForm || sending || !!pendingFile || !!audioBlob}
            title="Send from Media Library"
            style={{
              width: 36, height: 36, borderRadius: 18, border: 'none', flexShrink: 0,
              background: !windowStatus?.canSendFreeForm || pendingFile || audioBlob ? 'var(--c-hover)' : 'var(--c-cardBg)',
              color: !windowStatus?.canSendFreeForm || pendingFile || audioBlob ? C.textMuted : C.textSecondary,
              cursor: !windowStatus?.canSendFreeForm || pendingFile || audioBlob ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: C.shadowSm,
            }}
          >
            <Library size={16} />
          </button>

          {isRecording ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'var(--c-primaryLight)', borderRadius: 8, boxShadow: C.shadowSm }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#A32D2D', animation: 'pulse 1.2s ease-in-out infinite' }} />
              <span style={{ fontSize: 13, color: '#A32D2D', fontFamily: FONT, fontWeight: 600 }}>
                Recording… {String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:{String(recordingSeconds % 60).padStart(2, '0')}
              </span>
              <span style={{ flex: 1 }} />
              <button onClick={cancelRecording} style={{ background: 'transparent', border: 'none', color: C.textMuted, cursor: 'pointer', fontSize: 12, fontFamily: FONT }}>Cancel</button>
              <style>{`@keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.3 } }`}</style>
            </div>
          ) : (
            <input
              value={composerText}
              onChange={e => setComposerText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder={
                audioBlob ? 'Voice ready — click send' :
                pendingFile ? 'Add a caption above, then click send' :
                windowStatus?.canSendFreeForm ? 'Type a message…' :
                windowStatus?.reason ? 'This number isn’t set up to send — see Settings' :
                'Reply window closed — send a template instead'
              }
              disabled={!windowStatus?.canSendFreeForm || sending || !!pendingFile || !!audioBlob}
              style={{
                flex: 1, padding: '10px 14px', borderRadius: 8, border: 'none',
                fontSize: 14, fontFamily: FONT, outline: 'none',
                background: windowStatus?.canSendFreeForm && !pendingFile && !audioBlob ? 'var(--c-cardBg)' : 'var(--c-hover)',
                color: windowStatus?.canSendFreeForm && !pendingFile && !audioBlob ? C.text : C.textMuted,
                boxShadow: C.shadowSm, cursor: windowStatus?.canSendFreeForm && !pendingFile && !audioBlob ? 'text' : 'not-allowed',
              }}
            />
          )}

          {/* Mic / Stop button — only when not in file-attach mode */}
          {!pendingFile && (
            isRecording ? (
              <button
                onClick={stopRecording}
                title="Stop recording"
                style={{ width: 40, height: 40, borderRadius: 20, border: 'none', background: '#A32D2D', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
              ><Square size={14} fill="#fff" /></button>
            ) : (
              !audioBlob && (
                <button
                  onClick={startRecording}
                  disabled={!windowStatus?.canSendFreeForm || sending || !!composerText.trim()}
                  title="Record voice message"
                  style={{
                    width: 36, height: 36, borderRadius: 18, border: 'none', flexShrink: 0,
                    background: !windowStatus?.canSendFreeForm || composerText.trim() ? 'var(--c-hover)' : 'var(--c-cardBg)',
                    color: !windowStatus?.canSendFreeForm || composerText.trim() ? C.textMuted : C.textSecondary,
                    cursor: !windowStatus?.canSendFreeForm || composerText.trim() ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: C.shadowSm,
                  }}
                ><Mic size={16} /></button>
              )
            )
          )}

          <button
            onClick={handleSend}
            disabled={isRecording || !windowStatus?.canSendFreeForm || sending || (!composerText.trim() && !pendingFile && !audioBlob)}
            title="Send"
            style={{
              width: 40, height: 40, borderRadius: 20, border: 'none',
              background: isRecording || ((!composerText.trim() && !pendingFile && !audioBlob) || !windowStatus?.canSendFreeForm) ? '#ccc' : C.primary,
              color: '#fff', cursor: isRecording || ((!composerText.trim() && !pendingFile && !audioBlob) || !windowStatus?.canSendFreeForm) ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}
          >
            {sending ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={16} />}
          </button>
        </div>
      </div>

      {/* Edit contact name modal */}
      {isEditing && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 200, fontFamily: FONT,
        }}>
          <div style={{
            background: C.cardBg, borderRadius: 14,
            padding: '24px 24px 20px', width: 420, maxHeight: '85vh',
            boxShadow: C.shadowLg, overflowY: 'auto',
          }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 6 }}>
              Save Contact
            </div>
            <div style={{ fontSize: 13, color: C.textSecondary, marginBottom: 16, lineHeight: 1.5 }}>
              Add a name and tags for <strong><MaskedNumber number={contactNumber} prefix="+" /></strong>.
            </div>
            <input
              autoFocus
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleSaveName();
                if (e.key === 'Escape') handleCancelEdit();
              }}
              placeholder="Contact name..."
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 8,
                border: `1px solid ${C.border}`, fontSize: 14,
                fontFamily: FONT, outline: 'none', color: C.text,
                marginBottom: 16, boxSizing: 'border-box',
              }}
            />

            {/* Assigned tags */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.textSecondary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Assigned Tags</div>
              {contactTags.length === 0 ? (
                <div style={{ color: C.textMuted, fontSize: 12 }}>No tags selected</div>
              ) : (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {contactTags.map(t => (
                    <span key={t.id} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '3px 8px', borderRadius: 4,
                      background: darkenColor(t.color),
                      color: '#fff',
                      border: `1px solid ${darkenColor(t.color)}`,
                      fontSize: 11, fontWeight: 700, fontFamily: FONT,
                    }}>
                      {t.name}
                      <button onClick={() => toggleContactTag(t)} style={{
                        border: 'none', background: 'transparent', cursor: 'pointer',
                        color: 'inherit', padding: 0, display: 'flex', alignItems: 'center',
                      }}><X size={10} /></button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Tag picker */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.textSecondary, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Assign Tags</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {categories.map(cat => {
                  const catTags = allTags.filter(t => t.category_id === cat.id);
                  if (catTags.length === 0) return null;
                  const selectedInCat = contactTags.find(t => t.category_id === cat.id);
                  return (
                    <div key={cat.id}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 4 }}>{cat.name}</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {catTags.map(tag => {
                          const isSelected = contactTags.some(t => t.id === tag.id);
                          return (
                            <button
                              key={tag.id}
                              onClick={() => toggleContactTag(tag)}
                              style={{
                                padding: '4px 10px', borderRadius: 4,
                                border: `1.5px solid ${isSelected ? tag.color : C.border}`,
                                background: isSelected ? tag.color : 'var(--c-cardBg)',
                                color: isSelected ? '#fff' : C.textSecondary,
                                cursor: 'pointer', fontFamily: FONT, fontSize: 12,
                                fontWeight: 600,
                              }}
                            >
                              {tag.name}
                            </button>
                          );
                        })}
                      </div>
                      {selectedInCat && (
                        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>
                          Selected: <strong style={{ color: selectedInCat.color }}>{selectedInCat.name}</strong>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Custom fields */}
            <CustomFieldEditor fields={fieldDefs} values={contactFieldValues} onChange={setContactFieldValues} />

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={handleCancelEdit}
                style={{
                  padding: '8px 16px', borderRadius: 8,
                  border: `1px solid ${C.border}`, background: 'transparent',
                  cursor: 'pointer', fontSize: 13, fontWeight: 600,
                  color: C.textSecondary, fontFamily: FONT,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveName}
                disabled={!editValue.trim() || saving}
                style={{
                  padding: '8px 16px', borderRadius: 8, border: 'none',
                  background: C.purple, color: '#fff',
                  cursor: (!editValue.trim() || saving) ? 'not-allowed' : 'pointer',
                  fontSize: 13, fontWeight: 600, fontFamily: FONT,
                  opacity: (!editValue.trim() || saving) ? 0.6 : 1,
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                {saving && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />}
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {libraryOpen && (
        <LibraryPickerModal
          waNumber={waNumber}
          sending={librarySending}
          onClose={() => setLibraryOpen(false)}
          onSend={handleSendLibraryMedia}
        />
      )}
    </div>
  );
}

// ── Media Library picker ─────────────────────────────────────────────────────
function LibraryPickerModal({ waNumber, sending, onClose, onSend }) {
  const [media, setMedia] = useState(null);
  const [account, setAccount] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [caption, setCaption] = useState('');

  useEffect(() => {
    (async () => {
      try {
        // Resolve the sending account first so we only load media owned by it.
        const acc = await api.resolveAccountByPhone(waNumber).catch(() => null);
        setAccount(acc);
        const list = await api.mediaLibrary.list(acc?.id);
        setMedia(list.media || []);
      } catch (err) { setError(err.message); }
    })();
  }, [waNumber]);

  const filtered = useMemo(() => {
    if (!media) return [];
    if (filter === 'all') return media;
    return media.filter(m => m.mediaType === filter);
  }, [media, filter]);

  const syncStateFor = (m) => {
    if (!account) return { label: 'Unknown account', kind: 'pending' };
    const s = m.syncs.find(s => Number(s.accountId) === Number(account.id));
    if (!s) return { label: 'Not synced — will sync on send', kind: 'pending' };
    if (s.status === 'synced') {
      const days = s.expiresAt ? Math.round((new Date(s.expiresAt) - Date.now()) / 86400000) : null;
      return { label: days != null ? `Synced · expires in ${days}d` : 'Synced', kind: 'synced' };
    }
    if (s.status === 'expired') return { label: 'Expired — will re-sync on send', kind: 'expired' };
    if (s.status === 'failed')  return { label: `Failed: ${s.lastError?.slice(0, 60) || 'unknown'}`, kind: 'failed' };
    return { label: s.status, kind: 'pending' };
  };

  const handleSendClick = () => {
    if (!selected) return;
    const meta = TYPE_META[selected.mediaType] || TYPE_META.document;
    onSend({
      mediaLibraryId: Number(selected.id),
      caption: caption.trim(),
      kind: selected.mediaType,
      originalName: selected.name || selected.originalName,
      mimeType: selected.mimeType,
    });
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 250, fontFamily: FONT,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--c-cardBg)', borderRadius: 14, width: 720, maxHeight: '85vh',
          display: 'flex', flexDirection: 'column', boxShadow: C.shadowLg,
        }}
      >
        {/* Header */}
        <div style={{ padding: '18px 22px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 12 }}>
          <Library size={20} color={C.primary} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Send from Media Library</div>
            <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 2 }}>
              {account
                ? <>Sending as <strong><MaskedNumber number={account.displayPhoneNumber} /></strong> — items synced for this WABA send immediately, others auto-sync first.</>
                : 'Resolving WABA…'}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: C.textMuted, padding: 4 }}
          ><X size={18} /></button>
        </div>

        {/* Filter chips */}
        <div style={{ padding: '10px 22px', borderBottom: `1px solid ${C.border}`, display: 'flex', gap: 6 }}>
          {[
            { id: 'all', label: 'All' },
            { id: 'image', label: 'Images' },
            { id: 'video', label: 'Videos' },
            { id: 'audio', label: 'Audio' },
            { id: 'document', label: 'Documents' },
          ].map(f => {
            const active = filter === f.id;
            return (
              <button
                key={f.id}
                onClick={() => { setFilter(f.id); setSelected(null); }}
                style={{
                  padding: '5px 12px', borderRadius: 14,
                  border: `1px solid ${active ? C.primary : C.border}`,
                  background: active ? C.primary : 'var(--c-cardBg)',
                  color: active ? '#fff' : C.text,
                  cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: FONT,
                }}
              >{f.label}</button>
            );
          })}
        </div>

        {/* List */}
        <div style={{ flex: 1, overflow: 'auto', padding: 16, background: '#FAFAF8' }}>
          {error && (
            <div style={{ padding: 10, background: 'var(--c-primaryLight)', color: '#A32D2D', borderRadius: 6, fontSize: 13 }}>{error}</div>
          )}
          {!media ? (
            <div style={{ padding: 40, textAlign: 'center', color: C.textMuted }}>Loading…</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: C.textMuted, fontSize: 13 }}>
              No media in the library. Upload one from the Media tab first.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
              {filtered.map(m => {
                const meta = TYPE_META[m.mediaType] || TYPE_META.document;
                const Icon = meta.Icon;
                const state = syncStateFor(m);
                const isSel = selected?.id === m.id;
                const stateColor = state.kind === 'synced' ? '#059669'
                  : state.kind === 'failed' ? '#DC2626'
                  : state.kind === 'expired' ? '#B45309'
                  : '#6B7280';
                return (
                  <button
                    key={m.id}
                    onClick={() => setSelected(m)}
                    style={{
                      textAlign: 'left', padding: 0, background: 'var(--c-cardBg)', borderRadius: 10,
                      border: `2px solid ${isSel ? C.primary : C.border}`,
                      cursor: 'pointer', overflow: 'hidden',
                      boxShadow: isSel ? C.shadowMd : 'none', fontFamily: FONT,
                    }}
                  >
                    <div style={{
                      aspectRatio: '1 / 1', background: `${meta.color}15`, display: 'flex',
                      alignItems: 'center', justifyContent: 'center', position: 'relative',
                    }}>
                      {m.mediaType === 'image' ? (
                        <img
                          src={api.mediaLibrary.downloadUrl(m.id)}
                          alt={m.name || m.originalName}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : m.mediaType === 'video' ? (
                        <>
                          <video
                            src={api.mediaLibrary.downloadUrl(m.id)}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            preload="metadata"
                            muted
                          />
                          <div style={{
                            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            pointerEvents: 'none',
                          }}>
                            <div style={{
                              width: 32, height: 32, borderRadius: '50%', background: 'rgba(0,0,0,.5)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                              <div style={{
                                width: 0, height: 0, borderStyle: 'solid', borderWidth: '7px 0 7px 11px',
                                borderColor: 'transparent transparent transparent #fff', marginLeft: 2,
                              }} />
                            </div>
                          </div>
                        </>
                      ) : (
                        <Icon size={40} color={meta.color} />
                      )}
                      {isSel && (
                        <div style={{
                          position: 'absolute', top: 6, right: 6, background: C.primary,
                          color: '#fff', borderRadius: '50%', width: 22, height: 22,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}><CheckCircle2 size={14} /></div>
                      )}
                    </div>
                    <div style={{ padding: 8 }}>
                      <div style={{
                        fontSize: 12, fontWeight: 600, color: C.text,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{m.name || m.originalName}</div>
                      <div style={{
                        fontSize: 10, marginTop: 4, color: stateColor, fontWeight: 600,
                        display: 'flex', alignItems: 'center', gap: 3,
                      }}>
                        {state.kind === 'synced' && <CheckCircle2 size={10} />}
                        {state.kind === 'expired' && <RefreshCw size={10} />}
                        {state.kind === 'failed' && <AlertTriangle size={10} />}
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {state.label}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer with caption + send */}
        <div style={{ padding: '14px 22px', borderTop: `1px solid ${C.border}`, display: 'flex', gap: 10, alignItems: 'center' }}>
          <input
            value={caption}
            onChange={e => setCaption(e.target.value)}
            placeholder={selected ? 'Add a caption (optional)…' : 'Select a media item above'}
            disabled={!selected}
            style={{
              flex: 1, padding: '9px 12px', borderRadius: 8,
              border: `1px solid ${C.border}`, fontSize: 13, fontFamily: FONT,
              outline: 'none', boxSizing: 'border-box',
              background: selected ? 'var(--c-cardBg)' : 'var(--c-hover)',
            }}
          />
          <button
            onClick={onClose}
            disabled={sending}
            style={{
              padding: '9px 14px', borderRadius: 8, border: `1px solid ${C.border}`,
              background: 'var(--c-cardBg)', color: C.text, cursor: 'pointer',
              fontSize: 13, fontWeight: 600, fontFamily: FONT,
            }}
          >Cancel</button>
          <button
            onClick={handleSendClick}
            disabled={!selected || sending}
            style={{
              padding: '9px 18px', borderRadius: 8, border: 'none',
              background: !selected ? 'var(--c-hover)' : C.primary, color: '#fff',
              cursor: !selected || sending ? 'not-allowed' : 'pointer',
              fontSize: 13, fontWeight: 600, fontFamily: FONT,
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            {sending ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={14} />}
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

const TYPE_META = {
  image:    { Icon: ImageIcon, label: 'Image',    color: '#3B82F6' },
  video:    { Icon: Video,     label: 'Video',    color: '#8B5CF6' },
  audio:    { Icon: Music,     label: 'Audio',    color: '#10B981' },
  document: { Icon: FileText,  label: 'Document', color: '#F59E0B' },
};
