import { useState, useEffect, useCallback, useMemo } from 'react';
import { Users, Search, Phone, User, Pencil, Trash2, Loader2, ChevronDown, X, Tag, Send, Play, Music, FileText, Image, Video, Library, Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, Download } from 'lucide-react';
import DeleteConfirmModal from '../components/DeleteConfirmModal.jsx';
import WhatsAppPreview, { BroadcastMessagePreview } from '../components/WhatsAppPreview.jsx';
import TagMultiSelect from '../components/TagMultiSelect.jsx';
import { CustomFieldEditor, CustomFieldView } from '../components/CustomFieldInputs.jsx';
import { api } from '../api.js';
import { C, FONT, maskPhone, darkenColor } from '../constants.js';
import MaskedNumber from '../components/MaskedNumber.jsx';

const ROLE_LABEL_MAP = { admin: 'Admin', bda_sales: 'Sales', viewer: 'Viewer' };

function TagBadge({ tag, onRemove }) {
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
      {onRemove && (
        <button onClick={onRemove} style={{
          border: 'none', background: 'transparent', cursor: 'pointer',
          color: 'inherit', padding: 0, display: 'flex', alignItems: 'center',
        }}>
          <X size={10} />
        </button>
      )}
    </span>
  );
}

export default function ContactsPage({ user }) {
  const isAdmin = user?.role === 'admin';
  const [numbers, setNumbers] = useState([]);
  const [selectedNumber, setSelectedNumber] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [filterTagIds, setFilterTagIds] = useState([]);

  const [categories, setCategories] = useState([]);
  const [tags, setTags] = useState([]);
  const [fieldDefs, setFieldDefs] = useState([]);
  const [users, setUsers] = useState([]); // assignable users (admin only)

  const [detailContact, setDetailContact] = useState(null);
  const [detailTags, setDetailTags] = useState([]);
  const [detailFields, setDetailFields] = useState({});
  const [detailAssignedUserId, setDetailAssignedUserId] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [savingDetail, setSavingDetail] = useState(false);
  const [detailMode, setDetailMode] = useState('view'); // 'view' | 'edit'
  const [deleteModal, setDeleteModal] = useState({ open: false, contact: null });
  const [selectedContacts, setSelectedContacts] = useState(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [broadcastModal, setBroadcastModal] = useState(false);
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [broadcasting, setBroadcasting] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [broadcastFrom, setBroadcastFrom] = useState('');
  const [broadcastTemplateId, setBroadcastTemplateId] = useState('');
  const [broadcastName, setBroadcastName] = useState('');
  const [testNumber, setTestNumber] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const [broadcastVariableMapping, setBroadcastVariableMapping] = useState({});
  const [testNumberSearch, setTestNumberSearch] = useState('');
  const [testNumberOpen, setTestNumberOpen] = useState(false);
  const [broadcastMessageType, setBroadcastMessageType] = useState('template');
  const [broadcastBody, setBroadcastBody] = useState('');
  const [broadcastUrl, setBroadcastUrl] = useState('');
  const [broadcastMediaLibraryId, setBroadcastMediaLibraryId] = useState('');
  const [broadcastMediaItems, setBroadcastMediaItems] = useState([]);
  const [broadcastCaption, setBroadcastCaption] = useState('');
  const [broadcastMediaLoading, setBroadcastMediaLoading] = useState(false);

  // Import contacts
  const [importModal, setImportModal] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null); // { ok, imported, updated, skipped:[], total }
  const [importError, setImportError] = useState('');

  // Load numbers on mount
  useEffect(() => {
    api.numbers()
      .then(data => {
        setNumbers(data);
        if (data.length > 0) setSelectedNumber(data[0].wa_number);
      })
      .catch(() => setNumbers([]));
  }, []);

  // Load saved contacts when number changes — polled every 5s so that admin
  // reassignments propagate to BDAs without a manual refresh.
  const loadContacts = useCallback((quiet = false) => {
    if (!selectedNumber) return;
    if (!quiet) setLoading(true);
    api.savedContacts(selectedNumber)
      .then(data => setContacts(data.map(c => ({ ...c, tags: c.tags || [] }))))
      .catch(() => setContacts([]))
      .finally(() => { if (!quiet) setLoading(false); });
  }, [selectedNumber]);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  // Polling refresh (every 30s).
  useEffect(() => {
    if (!selectedNumber) return;
    const t = setInterval(() => loadContacts(true), 30000);
    return () => clearInterval(t);
  }, [selectedNumber, loadContacts]);

  // Load categories, tags, and team members
  useEffect(() => {
    Promise.all([
      api.categories.list().catch(() => []),
      api.tags.list().catch(() => []),
      api.contactFields.list().catch(() => []),
    ]).then(([cats, tgs, flds]) => {
      setCategories(cats);
      setTags(tgs);
      setFieldDefs(flds);
    });
    // Admins can assign contacts to other users — load the assignable list.
    if (user?.role === 'admin') {
      api.users.list().then(setUsers).catch(() => setUsers([]));
    }
  }, [user]);

  // ── Import contacts ──────────────────────────────────────────────────────
  const ACCEPTED_IMPORT = ['.csv', '.xlsx'];
  const isAcceptedSheet = (file) =>
    !!file && ACCEPTED_IMPORT.some(ext => file.name.toLowerCase().endsWith(ext));

  const openImport = () => { setImportFile(null); setImportResult(null); setImportError(''); setImportModal(true); };
  const closeImport = () => { setImportModal(false); setImportFile(null); setImportResult(null); setImportError(''); };

  const pickImportFile = (file) => {
    if (!file) return;
    if (!isAcceptedSheet(file)) { setImportError('Please choose a .csv or .xlsx file.'); return; }
    setImportError(''); setImportResult(null); setImportFile(file);
  };

  const runImport = async () => {
    if (!importFile || !selectedNumber) return;
    setImporting(true); setImportError('');
    try {
      const res = await api.importContacts(selectedNumber, importFile);
      setImportResult(res);
      loadContacts(true); // refresh the list after import
    } catch (err) {
      setImportError(err.message || 'Import failed. Please try again.');
    } finally {
      setImporting(false);
    }
  };

  // Ctrl+V paste a sheet into the open modal (Forge convention: file inputs support paste)
  useEffect(() => {
    if (!importModal) return;
    const onPaste = (e) => {
      const file = [...(e.clipboardData?.files || [])][0];
      if (file) { e.preventDefault(); pickImportFile(file); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [importModal]);

  const openDetail = async (contact, mode = 'view') => {
    setDetailContact(contact);
    setDetailTags(contact.tags || []);
    setDetailFields(contact.custom_fields || {});
    setDetailAssignedUserId(contact.assigned_user_id ?? null);
    setDetailMode(mode);
    setDetailLoading(true);
    try {
      const data = await api.contact(selectedNumber, contact.contact_number);
      setDetailTags(data.tags || []);
      setDetailFields(data.custom_fields || {});
      setDetailAssignedUserId(data.assigned_user_id ?? null);
    } catch (err) {
      console.error('Failed to load contact detail:', err);
    } finally {
      setDetailLoading(false);
    }
  };

  const saveDetail = async () => {
    if (!detailContact) return;
    setSavingDetail(true);
    try {
      await api.saveContact(
        selectedNumber, detailContact.contact_number, detailContact.name,
        detailTags, detailFields,
        isAdmin ? (detailAssignedUserId ?? null) : undefined,
      );
      const assignedUser = users.find(u => String(u.id) === String(detailAssignedUserId));
      setContacts(prev => prev.map(c =>
        c.contact_number === detailContact.contact_number
          ? {
              ...c, tags: detailTags, custom_fields: detailFields,
              ...(isAdmin ? {
                assigned_user_id: detailAssignedUserId ?? null,
                assigned_user_name: assignedUser?.displayName || null,
              } : {}),
            }
          : c
      ));
      setDetailContact(null);
    } catch (err) {
      alert('Failed to save: ' + err.message);
    } finally {
      setSavingDetail(false);
    }
  };

  const handleDeleteClick = (contact) => {
    setDeleteModal({ open: true, contact });
  };

  const handleDeleteConfirm = async () => {
    const contact = deleteModal.contact;
    if (!contact) return;
    try {
      await api.deleteContact(selectedNumber, contact.contact_number);
      setContacts(prev => prev.filter(c => c.contact_number !== contact.contact_number));
      setDeleteModal({ open: false, contact: null });
    } catch (err) {
      alert('Failed to remove contact: ' + err.message);
    }
  };

  const handleBulkDeleteConfirm = async () => {
    const numbers = [...selectedContacts];
    setBulkDeleteOpen(false);
    if (numbers.length === 0) return;
    const results = await Promise.allSettled(
      numbers.map(n => api.deleteContact(selectedNumber, n))
    );
    const removed = new Set();
    const failures = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') removed.add(numbers[i]);
      else failures.push({ n: numbers[i], err: r.reason });
    });
    if (removed.size > 0) {
      setContacts(prev => prev.filter(c => !removed.has(c.contact_number)));
      setSelectedContacts(prev => {
        const next = new Set(prev);
        removed.forEach(n => next.delete(n));
        return next;
      });
    }
    if (failures.length > 0) {
      alert(`Failed to remove ${failures.length} contact${failures.length === 1 ? '' : 's'}: ${failures[0].err?.message || 'unknown error'}`);
    }
  };

  const toggleTag = (tag) => {
    const exists = detailTags.find(t => t.id === tag.id);
    if (exists) {
      setDetailTags(prev => prev.filter(t => t.id !== tag.id));
    } else {
      // Only one tag per category: remove any other tag from the same category first
      setDetailTags(prev => [
        ...prev.filter(t => t.category_id !== tag.category_id),
        { id: tag.id, name: tag.name, color: tag.color, category_id: tag.category_id }
      ]);
    }
  };

  const filtered = contacts.filter(c => {
    const matchesSearch = !search ||
      c.contact_number.includes(search) ||
      (c.name && c.name.toLowerCase().includes(search.toLowerCase()));
    const matchesTag = filterTagIds.length === 0 || (c.tags || []).some(t => filterTagIds.includes(t.id));
    return matchesSearch && matchesTag;
  });

  const allSelected = filtered.length > 0 && filtered.every(c => selectedContacts.has(c.contact_number));
  const someSelected = filtered.some(c => selectedContacts.has(c.contact_number)) && !allSelected;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedContacts(prev => {
        const next = new Set(prev);
        filtered.forEach(c => next.delete(c.contact_number));
        return next;
      });
    } else {
      setSelectedContacts(prev => {
        const next = new Set(prev);
        filtered.forEach(c => next.add(c.contact_number));
        return next;
      });
    }
  };

  const toggleSelectOne = (contactNumber) => {
    setSelectedContacts(prev => {
      const next = new Set(prev);
      if (next.has(contactNumber)) next.delete(contactNumber);
      else next.add(contactNumber);
      return next;
    });
  };

  const clearSelection = () => setSelectedContacts(new Set());

  const selectedNumberName = numbers.find(n => n.wa_number === selectedNumber)?.display_name || maskPhone(selectedNumber);

  const getTagInfo = (tagRef) => tags.find(t => t.id === tagRef.id) || tagRef;

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

  const selectedTemplate = templates.find(t => t.id.toString() === broadcastTemplateId);
  // 'image' | 'video' | 'document' when the selected template has a media header
  // (requires a header image at send time), else null.
  const headerMediaType = (() => {
    if (broadcastMessageType !== 'template' || !selectedTemplate) return null;
    const ht = String(selectedTemplate.header_type || '').toUpperCase();
    return ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(ht) ? ht.toLowerCase() : null;
  })();
  const selectedRecipients = contacts.filter(c => selectedContacts.has(c.contact_number));
  const previewTemplate = selectedTemplate ? {
    ...selectedTemplate,
    body: resolvePreviewText(selectedTemplate.body, broadcastVariableMapping, selectedRecipients[0]),
    header_text: selectedTemplate.header_type === 'TEXT' ? resolvePreviewText(selectedTemplate.header_text, broadcastVariableMapping, selectedRecipients[0]) : selectedTemplate.header_text,
  } : null;

  const templateVars = useMemo(() => {
    if (!selectedTemplate) return [];
    const bodyVars = extractVars(selectedTemplate.body);
    const headerVars = selectedTemplate.header_type === 'TEXT' ? extractVars(selectedTemplate.header_text) : [];
    return [...new Set([...headerVars, ...bodyVars])].sort((a, b) => +a - +b);
  }, [selectedTemplate]);

  const isBroadcastFormInvalid = () => {
    if (!broadcastFrom || selectedRecipients.length === 0 || broadcasting) return true;
    if (broadcastMessageType === 'template' && !selectedTemplate) return true;
    if (broadcastMessageType === 'text' && !broadcastBody.trim()) return true;
    if (broadcastMessageType === 'link' && !broadcastUrl.trim()) return true;
    if (['image', 'video', 'audio', 'document'].includes(broadcastMessageType) && !broadcastMediaLibraryId) return true;
    if (headerMediaType && !broadcastMediaLibraryId) return true;
    return false;
  };

  // Load media items for media-type broadcasts OR for a template with a media
  // header (IMAGE/VIDEO/DOCUMENT) — both need a Media Library pick.
  useEffect(() => {
    const mediaTypes = ['image', 'video', 'audio', 'document'];
    let neededType = null;
    if (mediaTypes.includes(broadcastMessageType)) {
      neededType = broadcastMessageType;
    } else if (broadcastMessageType === 'template') {
      const tpl = templates.find(t => t.id.toString() === broadcastTemplateId);
      const ht = String(tpl?.header_type || '').toLowerCase();
      if (['image', 'video', 'document'].includes(ht)) neededType = ht;
    }
    if (!neededType) {
      setBroadcastMediaItems([]);
      setBroadcastMediaLibraryId('');
      return;
    }
    setBroadcastMediaLoading(true);
    api.mediaLibrary.list()
      .then(res => {
        const filtered = (res.media || []).filter(m => m.mediaType === neededType);
        setBroadcastMediaItems(filtered);
      })
      .catch(() => setBroadcastMediaItems([]))
      .finally(() => setBroadcastMediaLoading(false));
  }, [broadcastMessageType, broadcastTemplateId, templates]);

  // Available contact fields for variable mapping
  const contactFieldOptions = useMemo(() => {
    const opts = [
      { value: 'name', label: 'Contact Name' },
      { value: 'contact_number', label: 'Phone Number' },
    ];
    categories.forEach(cat => {
      opts.push({ value: `category_tag.${cat.id}`, label: cat.name });
    });
    return opts;
  }, [categories]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '20px 24px',
        borderBottom: `1px solid ${C.border}`,
        background: C.cardBg,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Users size={22} color={C.text} />
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: 0, letterSpacing: '-.02em', fontFamily: FONT }}>Contacts</h1>
              <p style={{ fontSize: 12, color: C.textMuted, margin: '4px 0 0', fontFamily: FONT }}>
                {contacts.length} saved contact{contacts.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>

          <div style={{ position: 'relative' }}>
            <select
              value={selectedNumber || ''}
              onChange={e => setSelectedNumber(e.target.value)}
              disabled={numbers.length === 0}
              style={{
                padding: '8px 32px 8px 12px', borderRadius: 8,
                border: `1px solid ${C.border}`, fontSize: 13,
                fontFamily: FONT, color: numbers.length === 0 ? C.textMuted : C.text,
                background: C.cardBg,
                cursor: numbers.length === 0 ? 'default' : 'pointer',
                appearance: 'none',
              }}
            >
              {numbers.length === 0 && <option value="">No WhatsApp number</option>}
              {numbers.map(n => (
                <option key={n.wa_number} value={n.wa_number}>
                  {n.display_name || maskPhone(n.wa_number)}
                </option>
              ))}
            </select>
            <ChevronDown size={14} color={C.textMuted} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'var(--c-chatPanel)', borderRadius: 8,
            padding: '8px 12px', flex: 1, minWidth: 200, maxWidth: 400,
          }}>
            <Search size={16} color={C.textMuted} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
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
            selectedIds={filterTagIds}
            onChange={setFilterTagIds}
            minWidth={180}
          />

          <button
            onClick={openImport}
            disabled={!selectedNumber}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', borderRadius: 8,
              border: `1px solid ${C.border}`, background: C.cardBg,
              cursor: selectedNumber ? 'pointer' : 'not-allowed',
              fontSize: 13, fontWeight: 700, color: C.text, fontFamily: FONT,
              opacity: selectedNumber ? 1 : 0.5,
            }}
            onMouseEnter={e => { if (selectedNumber) e.currentTarget.style.background = 'var(--c-chatPanel)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = C.cardBg; }}
          >
            <Upload size={15} /> Import
          </button>

          <button
            onClick={() => {
              if (selectedContacts.size > 0) {
                setBroadcastModal(true);
                api.templates.list().catch(() => []).then(data => {
                  setTemplates(data.filter(t => t.status === 'APPROVED'));
                });
              }
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '8px 14px', borderRadius: 8,
              border: 'none',
              background: selectedContacts.size > 0 ? C.primary : '#ccc',
              cursor: selectedContacts.size > 0 ? 'pointer' : 'not-allowed',
              fontSize: 13, fontWeight: 700,
              color: '#fff', fontFamily: FONT,
            }}
          >
            <Send size={14} /> Broadcast
          </button>
          {selectedContacts.size > 0 && (
            <>
              <button
                onClick={() => setBulkDeleteOpen(true)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '8px 14px', borderRadius: 8,
                  border: `1.5px solid ${C.primary}`, background: C.primaryLight,
                  cursor: 'pointer', fontSize: 13, fontWeight: 700,
                  color: C.primary, fontFamily: FONT,
                }}
                onMouseEnter={e => { e.currentTarget.style.background = C.primary; e.currentTarget.style.color = '#fff'; }}
                onMouseLeave={e => { e.currentTarget.style.background = C.primaryLight; e.currentTarget.style.color = C.primary; }}
              >
                <Trash2 size={14} /> Delete {selectedContacts.size} selected
              </button>
              <button
                onClick={clearSelection}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '8px 12px', borderRadius: 8,
                  border: `1px solid ${C.border}`, background: 'var(--c-cardBg)',
                  cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  color: C.textSecondary, fontFamily: FONT,
                }}
              >
                <X size={12} /> Clear selection
              </button>
            </>
          )}
          {(search || filterTagIds.length > 0) && (
            <button
              onClick={() => { setSearch(''); setFilterTagIds([]); }}
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
        </div>
      </div>

      {/* Contact table */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
        {loading && contacts.length === 0 && (
          <div style={{ textAlign: 'center', color: C.textMuted, fontSize: 13, padding: 40 }}>
            <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 8px' }} />
            Loading contacts...
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: 'center', color: C.textMuted, fontSize: 13, padding: 60 }}>
            <User size={40} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
            <div>{(search || filterTagIds.length > 0) ? 'No contacts match your filters' : 'No saved contacts yet'}</div>
            {!search && (
              <div style={{ marginTop: 6, fontSize: 12 }}>
                Open a chat and click the edit icon next to a contact name to save it here.
              </div>
            )}
          </div>
        )}

        {filtered.length > 0 && (
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT, fontSize: 13 }}>
              <thead>
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
                  <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: C.textSecondary, borderBottom: `1px solid ${C.border}` }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => {
                  const isSelected = selectedContacts.has(c.contact_number);
                  return (
                    <tr key={c.contact_number} style={{ background: isSelected ? 'var(--c-primaryLight)' : 'var(--c-cardBg)', borderBottom: `1px solid ${C.border}`, cursor: 'pointer' }}
                      onClick={() => openDetail(c, 'view')}
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
                      <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                        <button onClick={(e) => { e.stopPropagation(); openDetail(c, 'edit'); }} style={{
                          border: 'none', background: 'transparent', cursor: 'pointer',
                          color: C.primary, fontSize: 12, fontWeight: 600, marginRight: 12,
                        }}>
                          <Pencil size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />Edit
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); handleDeleteClick(c); }} style={{
                          border: 'none', background: 'transparent', cursor: 'pointer',
                          color: C.primary, fontSize: 12, fontWeight: 600,
                        }}>Delete</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Delete Confirm Modal */}
      <DeleteConfirmModal
        open={deleteModal.open}
        title="Remove Contact"
        message={deleteModal.contact ? `Are you sure you want to remove "${deleteModal.contact.name}" from saved contacts?` : ''}
        confirmText="Remove"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteModal({ open: false, contact: null })}
      />

      {/* Bulk Delete Confirm Modal */}
      <DeleteConfirmModal
        open={bulkDeleteOpen}
        title={`Remove ${selectedContacts.size} contact${selectedContacts.size === 1 ? '' : 's'}`}
        message={`Are you sure you want to remove ${selectedContacts.size} contact${selectedContacts.size === 1 ? '' : 's'} from saved contacts? This cannot be undone.`}
        confirmText="Remove"
        onConfirm={handleBulkDeleteConfirm}
        onCancel={() => setBulkDeleteOpen(false)}
      />

      {/* Import Contacts Modal */}
      {importModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 20 }}
          onClick={closeImport}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: C.cardBg, borderRadius: 14, boxShadow: C.shadowLg, width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto', fontFamily: FONT }}
          >
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: `1px solid ${C.border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Upload size={18} color={C.primary} />
                <h2 style={{ fontSize: 17, fontWeight: 700, color: C.text, margin: 0 }}>Import Contacts</h2>
              </div>
              <button onClick={closeImport} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: C.textMuted, display: 'flex', padding: 4 }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: '20px 22px' }}>
              <p style={{ fontSize: 13, color: C.textSecondary, margin: '0 0 18px', lineHeight: 1.5 }}>
                Add contacts to <strong style={{ color: C.text }}>{selectedNumberName}</strong>. Upload a sheet with
                {' '}<strong style={{ color: C.text }}>Name</strong> and <strong style={{ color: C.text }}>Phone Number</strong> columns
                (include the country code, e.g. <span style={{ fontFamily: "'DM Mono', monospace" }}>919876543210</span>).
              </p>

              {importResult ? (
                /* ---- Result summary ---- */
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                    <CheckCircle2 size={20} color={C.green} />
                    <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Import complete</span>
                  </div>
                  <div style={{ display: 'flex', gap: 10, marginBottom: importResult.skipped?.length ? 16 : 0 }}>
                    {[
                      { label: 'Added', value: importResult.imported, color: C.green },
                      { label: 'Updated', value: importResult.updated, color: C.purple },
                      { label: 'Skipped', value: importResult.skipped?.length || 0, color: importResult.skipped?.length ? C.primary : C.textMuted },
                    ].map(s => (
                      <div key={s.label} style={{ flex: 1, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px', textAlign: 'center' }}>
                        <div style={{ fontSize: 24, fontWeight: 700, color: s.color, fontFamily: "'DM Mono', monospace" }}>{s.value}</div>
                        <div style={{ fontSize: 11, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 2 }}>{s.label}</div>
                      </div>
                    ))}
                  </div>
                  {importResult.skipped?.length > 0 && (
                    <div style={{ background: '#FFF8E6', border: '1px solid #F0E0B0', borderRadius: 10, padding: '10px 14px', maxHeight: 160, overflowY: 'auto' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: '#8A6D00', marginBottom: 6 }}>
                        <AlertTriangle size={14} /> Skipped rows
                      </div>
                      {importResult.skipped.map((s, i) => (
                        <div key={i} style={{ fontSize: 12, color: '#7A6200', padding: '2px 0' }}>
                          Row {s.row}: {s.reason}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                /* ---- Upload step ---- */
                <>
                  <a
                    href={api.importContactsTemplateUrl()}
                    download
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 8,
                      padding: '9px 14px', borderRadius: 8, marginBottom: 16,
                      border: `1px solid ${C.border}`, background: 'var(--c-chatPanel)',
                      cursor: 'pointer', fontSize: 13, fontWeight: 600, color: C.text,
                      textDecoration: 'none',
                    }}
                  >
                    <Download size={15} color={C.primary} /> Download sample sheet
                  </a>

                  <label
                    onDragOver={e => { e.preventDefault(); }}
                    onDrop={e => { e.preventDefault(); pickImportFile([...(e.dataTransfer?.files || [])][0]); }}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
                      border: `2px dashed ${importFile ? C.green : C.border}`, borderRadius: 12,
                      padding: '28px 20px', cursor: 'pointer', textAlign: 'center',
                      background: importFile ? 'rgba(15,110,86,0.05)' : 'transparent',
                    }}
                  >
                    <input
                      type="file"
                      accept=".csv,.xlsx"
                      style={{ display: 'none' }}
                      onChange={e => pickImportFile(e.target.files?.[0])}
                    />
                    {importFile ? (
                      <>
                        <FileSpreadsheet size={26} color={C.green} />
                        <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{importFile.name}</span>
                        <span style={{ fontSize: 12, color: C.textMuted }}>Click to choose a different file</span>
                      </>
                    ) : (
                      <>
                        <FileSpreadsheet size={26} color={C.textMuted} />
                        <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Click to upload, drag a file here, or paste (Ctrl+V)</span>
                        <span style={{ fontSize: 12, color: C.textMuted }}>Accepts .csv and .xlsx</span>
                      </>
                    )}
                  </label>
                </>
              )}

              {importError && (
                <div style={{ marginTop: 14, background: '#FCEBEB', color: '#A32D2D', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
                  {importError}
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '14px 22px', borderTop: `1px solid ${C.border}` }}>
              {importResult ? (
                <button
                  onClick={closeImport}
                  style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: C.primary, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: FONT }}
                >
                  Done
                </button>
              ) : (
                <>
                  <button
                    onClick={closeImport}
                    style={{ padding: '9px 18px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.cardBg, color: C.textSecondary, cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: FONT }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={runImport}
                    disabled={!importFile || importing}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '9px 20px', borderRadius: 8, border: 'none',
                      background: (!importFile || importing) ? '#ccc' : C.primary, color: '#fff',
                      cursor: (!importFile || importing) ? 'not-allowed' : 'pointer',
                      fontSize: 13, fontWeight: 700, fontFamily: FONT,
                    }}
                  >
                    {importing ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Importing…</> : <>Import contacts</>}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Broadcast Modal */}
      {broadcastModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 200, fontFamily: FONT,
        }}>
          <div style={{
            background: C.cardBg, borderRadius: 14,
            width: 900, maxHeight: '90vh',
            boxShadow: C.shadowLg, overflowY: 'auto',
            display: 'flex', flexDirection: 'column',
          }}>
            {/* Modal Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px 0' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>
                <Send size={18} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: 8, color: C.primary }} />
                Broadcast Message
              </div>
              <button onClick={() => { setBroadcastModal(false); setBroadcastMessage(''); setBroadcastTemplateId(''); setBroadcastName(''); setTestNumber(''); setBroadcastMessageType('template'); setBroadcastBody(''); setBroadcastUrl(''); setBroadcastMediaLibraryId(''); setBroadcastMediaItems([]); setBroadcastCaption(''); setBroadcastMediaLoading(false); }} style={{
                border: 'none', background: 'transparent', cursor: 'pointer', color: C.textMuted,
              }}><X size={20} /></button>
            </div>

            {/* Two-column body */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 420px', gap: 24, padding: '20px 24px' }}>
              {/* LEFT — Form */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                {/* Broadcast Name */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.textSecondary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Broadcast Name</div>
                  <input
                    type="text"
                    value={broadcastName}
                    onChange={e => setBroadcastName(e.target.value)}
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
                      value={broadcastFrom}
                      onChange={e => setBroadcastFrom(e.target.value)}
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
                </div>

                {/* To */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.textSecondary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>To ({selectedRecipients.length} selected)</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 100, overflowY: 'auto', padding: '10px 12px', background: 'var(--c-hover)', borderRadius: 8, border: `1.5px solid ${C.border}` }}>
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
                      value={broadcastMessageType}
                      onChange={e => setBroadcastMessageType(e.target.value)}
                      style={{
                        width: '100%', padding: '10px 32px 10px 12px', borderRadius: 8,
                        border: `1.5px solid ${C.border}`, fontSize: 13,
                        fontFamily: FONT, color: C.text, background: 'var(--c-cardBg)',
                        cursor: 'pointer', appearance: 'none', outline: 'none',
                      }}
                    >
                      <option value="template">Template Message</option>
                      <option value="text">Text Message</option>
                      <option value="link">Link Message</option>
                      <option value="image">Image Message</option>
                      <option value="video">Video Message</option>
                      <option value="audio">Audio Message</option>
                      <option value="document">Document Message</option>
                    </select>
                    <ChevronDown size={14} color={C.textMuted} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                  </div>
                </div>

                {/* Template Fields */}
                {broadcastMessageType === 'template' && (
                  <>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: C.textSecondary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Message Template</div>
                      <div style={{ position: 'relative' }}>
                        <select
                          value={broadcastTemplateId}
                          onChange={e => { setBroadcastTemplateId(e.target.value); setBroadcastVariableMapping({}); setBroadcastMediaLibraryId(''); }}
                          style={{
                            width: '100%', padding: '10px 32px 10px 12px', borderRadius: 8,
                            border: `1.5px solid ${C.border}`, fontSize: 13,
                            fontFamily: FONT, color: C.text, background: 'var(--c-cardBg)',
                            cursor: 'pointer', appearance: 'none', outline: 'none',
                          }}
                        >
                          <option value="">Select a template...</option>
                          {templates.map(t => (
                            <option key={t.id} value={t.id}>{t.name} ({t.category})</option>
                          ))}
                        </select>
                        <ChevronDown size={14} color={C.textMuted} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                      </div>
                      {templates.length === 0 && (
                        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4, fontFamily: FONT }}>No approved templates available. Create and approve a template first.</div>
                      )}
                    </div>

                    {/* Header media — required for IMAGE/VIDEO/DOCUMENT header templates */}
                    {headerMediaType && (
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: C.textSecondary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                          Header {headerMediaType} <span style={{ color: C.primary }}>*</span>
                        </div>
                        <div style={{ position: 'relative' }}>
                          <select
                            value={broadcastMediaLibraryId}
                            onChange={e => setBroadcastMediaLibraryId(e.target.value)}
                            disabled={broadcastMediaLoading}
                            style={{
                              width: '100%', padding: '10px 32px 10px 12px', borderRadius: 8,
                              border: `1.5px solid ${C.border}`, fontSize: 13,
                              fontFamily: FONT, color: C.text, background: 'var(--c-cardBg)',
                              cursor: 'pointer', appearance: 'none', outline: 'none',
                            }}
                          >
                            <option value="">{broadcastMediaLoading ? 'Loading...' : `— Select ${headerMediaType} —`}</option>
                            {broadcastMediaItems.map(m => (
                              <option key={m.id} value={m.id}>{m.name || m.originalName || `Media #${m.id}`}</option>
                            ))}
                          </select>
                          <ChevronDown size={14} color={C.textMuted} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                        </div>
                        {broadcastMediaItems.length === 0 && !broadcastMediaLoading ? (
                          <div style={{ fontSize: 11, color: '#E65100', marginTop: 4, fontFamily: FONT }}>
                            This template has a {headerMediaType} header — upload a {headerMediaType} to the Media Library first.
                          </div>
                        ) : (
                          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4, fontFamily: FONT }}>
                            This template has a {headerMediaType} header — pick the {headerMediaType} to send in the header.
                          </div>
                        )}
                        {broadcastMediaLibraryId && headerMediaType === 'image' && (
                          <img
                            src={api.mediaLibrary.downloadUrl(Number(broadcastMediaLibraryId))}
                            alt=""
                            style={{ marginTop: 8, width: '100%', maxHeight: 140, objectFit: 'cover', borderRadius: 8, border: `1px solid ${C.border}`, display: 'block' }}
                          />
                        )}
                      </div>
                    )}

                    {templateVars.length > 0 && (
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: C.textSecondary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Variable Mapping</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {templateVars.map(v => (
                            <div key={v} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <span style={{ fontSize: 12, fontWeight: 600, color: C.text, fontFamily: "'DM Mono', monospace", background: 'var(--c-hover)', padding: '4px 8px', borderRadius: 4, whiteSpace: 'nowrap' }}>{'{{' + v + '}}'}</span>
                              <span style={{ fontSize: 12, color: C.textMuted }}>→</span>
                              <div style={{ position: 'relative', flex: 1 }}>
                                <select
                                  value={broadcastVariableMapping[v] || ''}
                                  onChange={e => setBroadcastVariableMapping(prev => ({ ...prev, [v]: e.target.value }))}
                                  style={{
                                    width: '100%', padding: '8px 28px 8px 10px', borderRadius: 6,
                                    border: `1.5px solid ${C.border}`, fontSize: 12,
                                    fontFamily: FONT, color: C.text, background: 'var(--c-cardBg)',
                                    cursor: 'pointer', appearance: 'none', outline: 'none',
                                  }}
                                >
                                  <option value="">Select contact field...</option>
                                  {contactFieldOptions.map(opt => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                  ))}
                                </select>
                                <ChevronDown size={12} color={C.textMuted} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                              </div>
                            </div>
                          ))}
                        </div>
                        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 6, fontFamily: FONT }}>
                          Map each template variable to a contact field. Values will be pulled per recipient when sending.
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Text Fields */}
                {broadcastMessageType === 'text' && (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.textSecondary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Message Text</div>
                    <textarea
                      value={broadcastBody}
                      onChange={e => setBroadcastBody(e.target.value)}
                      placeholder="Type your message here..."
                      rows={4}
                      style={{
                        width: '100%', padding: '10px 12px', borderRadius: 8,
                        border: `1.5px solid ${C.border}`, fontSize: 13,
                        fontFamily: FONT, color: C.text, outline: 'none',
                        boxSizing: 'border-box', resize: 'vertical',
                      }}
                    />
                    <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4, fontFamily: FONT }}>
                      Use {'{{name}}'} and {'{{contact_number}}'} for dynamic values per recipient.
                    </div>
                  </div>
                )}

                {/* Link Fields */}
                {broadcastMessageType === 'link' && (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.textSecondary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Link URL</div>
                    <input
                      type="text"
                      value={broadcastUrl}
                      onChange={e => setBroadcastUrl(e.target.value)}
                      placeholder="https://example.com"
                      style={{
                        width: '100%', padding: '10px 12px', borderRadius: 8,
                        border: `1.5px solid ${C.border}`, fontSize: 13,
                        fontFamily: FONT, color: C.text, outline: 'none',
                        boxSizing: 'border-box',
                      }}
                    />
                    <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4, fontFamily: FONT }}>
                      The link will be sent as a text message with preview enabled.
                    </div>
                  </div>
                )}

                {/* Media Fields */}
                {['image', 'video', 'audio', 'document'].includes(broadcastMessageType) && (
                  <>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: C.textSecondary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Select from Media Library</div>
                      <div style={{ position: 'relative' }}>
                        <select
                          value={broadcastMediaLibraryId}
                          onChange={e => setBroadcastMediaLibraryId(e.target.value)}
                          disabled={broadcastMediaLoading}
                          style={{
                            width: '100%', padding: '10px 32px 10px 12px', borderRadius: 8,
                            border: `1.5px solid ${C.border}`, fontSize: 13,
                            fontFamily: FONT, color: C.text, background: 'var(--c-cardBg)',
                            cursor: 'pointer', appearance: 'none', outline: 'none',
                          }}
                        >
                          <option value="">{broadcastMediaLoading ? 'Loading...' : `— Select ${broadcastMessageType} —`}</option>
                          {broadcastMediaItems.map(m => (
                            <option key={m.id} value={m.id}>{m.name || m.originalName || `Media #${m.id}`}</option>
                          ))}
                        </select>
                        <ChevronDown size={14} color={C.textMuted} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                      </div>
                      {broadcastMediaItems.length === 0 && !broadcastMediaLoading && (
                        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4, fontFamily: FONT }}>
                          No {broadcastMessageType}s in the Media Library. Upload one from the Media tab first.
                        </div>
                      )}
                    </div>

                    {broadcastMediaLibraryId && (
                      <div style={{ borderRadius: 10, overflow: 'hidden', border: `1px solid ${C.border}`, background: 'var(--c-hover)' }}>
                        {broadcastMessageType === 'image' ? (
                          <img
                            src={api.mediaLibrary.downloadUrl(Number(broadcastMediaLibraryId))}
                            alt=""
                            style={{ width: '100%', height: 140, objectFit: 'cover', display: 'block' }}
                          />
                        ) : broadcastMessageType === 'video' ? (
                          <div style={{ position: 'relative', width: '100%', height: 140 }}>
                            <video
                              src={api.mediaLibrary.downloadUrl(Number(broadcastMediaLibraryId))}
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              preload="metadata"
                              muted
                            />
                            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.25)' }}>
                              <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Play size={16} color="#111" fill="#111" />
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                            <div style={{ width: 40, height: 40, borderRadius: 8, background: '#E1F5EE', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0F6E56' }}>
                              {broadcastMessageType === 'audio' ? <Music size={20} /> : <FileText size={20} />}
                            </div>
                            <div>
                              <div style={{ fontSize: 12, fontWeight: 600, color: C.text, fontFamily: FONT }}>
                                {broadcastMediaItems.find(m => String(m.id) === String(broadcastMediaLibraryId))?.name || 'Media'}
                              </div>
                              <div style={{ fontSize: 11, color: C.textMuted, fontFamily: FONT, textTransform: 'capitalize' }}>
                                {broadcastMessageType}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {broadcastMessageType !== 'audio' && (
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: C.textSecondary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Caption (optional)</div>
                        <input
                          type="text"
                          value={broadcastCaption}
                          onChange={e => setBroadcastCaption(e.target.value)}
                          placeholder="Optional caption..."
                          style={{
                            width: '100%', padding: '10px 12px', borderRadius: 8,
                            border: `1.5px solid ${C.border}`, fontSize: 13,
                            fontFamily: FONT, color: C.text, outline: 'none',
                            boxSizing: 'border-box',
                          }}
                        />
                      </div>
                    )}
                  </>
                )}

                {/* Test Number */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.textSecondary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Test Number</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {/* Single-owner system: enter the test recipient number directly */}
                    <input
                      type="tel"
                      value={testNumber}
                      onChange={e => setTestNumber(e.target.value)}
                      placeholder="Enter test number (e.g. 919342245724)"
                      style={{
                        flex: 1, padding: '10px 12px', borderRadius: 8,
                        border: `1.5px solid ${C.border}`, fontSize: 13,
                        fontFamily: FONT, color: C.text, background: 'var(--c-cardBg)',
                        outline: 'none', boxSizing: 'border-box',
                      }}
                    />
                    <button
                      onClick={async () => {
                        if (!testNumber.trim() || !broadcastFrom || selectedRecipients.length === 0) return;
                        if (broadcastMessageType === 'template' && !selectedTemplate) return;
                        if (broadcastMessageType === 'text' && !broadcastBody.trim()) return;
                        if (broadcastMessageType === 'link' && !broadcastUrl.trim()) return;
                        if (['image', 'video', 'audio', 'document'].includes(broadcastMessageType) && !broadcastMediaLibraryId) return;
                        if (headerMediaType && !broadcastMediaLibraryId) return;
                        setSendingTest(true);
                        try {
                          const payload = {
                            from_number: broadcastFrom,
                            recipient_numbers: selectedRecipients.map(r => ({ contact_number: r.contact_number, name: r.name })),
                            status: 'DRAFT',
                            test_number: testNumber.trim(),
                            name: broadcastName.trim() || undefined,
                            message_type: broadcastMessageType,
                          };
                          if (broadcastMessageType === 'template') {
                            payload.template_id = selectedTemplate.id;
                            payload.variable_mapping = broadcastVariableMapping;
                          } else if (broadcastMessageType === 'text') {
                            payload.body = broadcastBody;
                          } else if (broadcastMessageType === 'link') {
                            payload.url = broadcastUrl;
                          } else if (['image', 'video', 'audio', 'document'].includes(broadcastMessageType)) {
                            payload.media_library_id = Number(broadcastMediaLibraryId);
                            payload.caption = broadcastCaption || undefined;
                          }
                          const broadcast = await api.broadcasts.create(payload);
                          await api.broadcasts.test(broadcast.id, testNumber.trim());
                          alert(`Test message sent to ${testNumber}`);
                        } catch (err) {
                          alert('Test failed: ' + err.message);
                        } finally {
                          setSendingTest(false);
                        }
                      }}
                      disabled={!testNumber.trim() || !broadcastFrom || selectedRecipients.length === 0 || sendingTest || (broadcastMessageType === 'template' && !selectedTemplate) || (broadcastMessageType === 'text' && !broadcastBody.trim()) || (broadcastMessageType === 'link' && !broadcastUrl.trim()) || (['image','video','audio','document'].includes(broadcastMessageType) && !broadcastMediaLibraryId) || (headerMediaType && !broadcastMediaLibraryId)}
                      style={{
                        padding: '10px 16px', borderRadius: 8, border: 'none',
                        background: C.primary, color: '#fff',
                        cursor: (!testNumber.trim() || !selectedTemplate || !broadcastFrom || sendingTest) ? 'not-allowed' : 'pointer',
                        fontSize: 12, fontWeight: 700, fontFamily: FONT,
                        opacity: (!testNumber.trim() || !selectedTemplate || !broadcastFrom || sendingTest) ? 0.5 : 1,
                        display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
                      }}
                    >
                      {sendingTest ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={14} />}
                      Send Test
                    </button>
                  </div>
                </div>

                {/* Spacer */}
                <div style={{ flex: 1 }} />

                {/* Bottom Buttons */}
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
                  <button onClick={() => { setBroadcastModal(false); setBroadcastMessage(''); setBroadcastTemplateId(''); setBroadcastName(''); setTestNumber(''); setBroadcastVariableMapping({}); setBroadcastMessageType('template'); setBroadcastBody(''); setBroadcastUrl(''); setBroadcastMediaLibraryId(''); setBroadcastMediaItems([]); setBroadcastCaption(''); setBroadcastMediaLoading(false); }} style={{
                    padding: '10px 18px', borderRadius: 8, border: `1px solid ${C.border}`,
                    background: 'transparent', cursor: 'pointer', fontSize: 13,
                    fontWeight: 600, color: C.textSecondary, fontFamily: FONT,
                  }}>Cancel</button>
                  <button
                    onClick={async () => {
                      if (isBroadcastFormInvalid()) return;
                      setBroadcasting(true);
                      try {
                        const payload = {
                          from_number: broadcastFrom,
                          recipient_numbers: selectedRecipients.map(r => ({ contact_number: r.contact_number, name: r.name })),
                          status: 'DRAFT',
                          test_number: testNumber || undefined,
                          name: broadcastName.trim() || undefined,
                          message_type: broadcastMessageType,
                        };
                        if (broadcastMessageType === 'template') {
                          payload.template_id = selectedTemplate.id;
                          payload.variable_mapping = broadcastVariableMapping;
                          if (headerMediaType && broadcastMediaLibraryId) payload.media_library_id = Number(broadcastMediaLibraryId);
                        } else if (broadcastMessageType === 'text') {
                          payload.body = broadcastBody;
                        } else if (broadcastMessageType === 'link') {
                          payload.url = broadcastUrl;
                        } else if (['image', 'video', 'audio', 'document'].includes(broadcastMessageType)) {
                          payload.media_library_id = Number(broadcastMediaLibraryId);
                          payload.caption = broadcastCaption || undefined;
                        }
                        await api.broadcasts.create(payload);
                        alert('Broadcast saved as draft');
                        setBroadcastModal(false);
                        setBroadcastTemplateId('');
                        setBroadcastName('');
                        setTestNumber('');
                        setBroadcastFrom('');
                        setBroadcastMessageType('template');
                        setBroadcastBody('');
                        setBroadcastUrl('');
                        setBroadcastMediaLibraryId('');
                        setBroadcastMediaItems([]);
                        setBroadcastCaption('');
                      } catch (err) {
                        alert('Save failed: ' + err.message);
                      } finally {
                        setBroadcasting(false);
                      }
                    }}
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
                    onClick={async () => {
                      if (isBroadcastFormInvalid()) return;
                      setBroadcasting(true);
                      try {
                        const payload = {
                          from_number: broadcastFrom,
                          recipient_numbers: selectedRecipients.map(r => ({ contact_number: r.contact_number, name: r.name })),
                          status: 'SENT',
                          test_number: testNumber || undefined,
                          name: broadcastName.trim() || undefined,
                          message_type: broadcastMessageType,
                        };
                        if (broadcastMessageType === 'template') {
                          payload.template_id = selectedTemplate.id;
                          payload.variable_mapping = broadcastVariableMapping;
                          if (headerMediaType && broadcastMediaLibraryId) payload.media_library_id = Number(broadcastMediaLibraryId);
                        } else if (broadcastMessageType === 'text') {
                          payload.body = broadcastBody;
                        } else if (broadcastMessageType === 'link') {
                          payload.url = broadcastUrl;
                        } else if (['image', 'video', 'audio', 'document'].includes(broadcastMessageType)) {
                          payload.media_library_id = Number(broadcastMediaLibraryId);
                          payload.caption = broadcastCaption || undefined;
                        }
                        const broadcast = await api.broadcasts.create(payload);
                        await api.broadcasts.send(broadcast.id);
                        alert(`Broadcast sent to ${selectedRecipients.length} contact(s) from ${broadcastFrom}!`);
                        setBroadcastModal(false);
                        setBroadcastTemplateId('');
                        setBroadcastName('');
                        setTestNumber('');
                        setBroadcastFrom('');
                        setBroadcastMessageType('template');
                        setBroadcastBody('');
                        setBroadcastUrl('');
                        setBroadcastMediaLibraryId('');
                        setBroadcastMediaItems([]);
                        setBroadcastCaption('');
                        clearSelection();
                      } catch (err) {
                        alert('Broadcast failed: ' + err.message);
                      } finally {
                        setBroadcasting(false);
                      }
                    }}
                    disabled={isBroadcastFormInvalid()}
                    style={{
                      padding: '10px 18px', borderRadius: 8, border: 'none',
                      background: isBroadcastFormInvalid() ? '#ccc' : C.primary,
                      color: '#fff', cursor: isBroadcastFormInvalid() ? 'not-allowed' : 'pointer',
                      fontSize: 13, fontWeight: 700, fontFamily: FONT,
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}
                  >
                    {broadcasting && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />}
                    Broadcast
                  </button>
                </div>
              </div>

              {/* RIGHT — Preview */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, paddingTop: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: '#888', fontFamily: FONT }}>Live Preview</div>
                {broadcastMessageType === 'template' ? (
                  <WhatsAppPreview template={previewTemplate} minHeight={280} emptyText="Select a template&#10;to preview" />
                ) : (
                  <BroadcastMessagePreview
                    messageType={broadcastMessageType}
                    body={broadcastBody}
                    url={broadcastUrl}
                    mediaLibraryId={broadcastMediaLibraryId}
                    caption={broadcastCaption}
                    mediaItems={broadcastMediaItems}
                    minHeight={280}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Contact Detail / Edit Modal */}
      {detailContact && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 200, fontFamily: FONT,
        }}>
          <div style={{
            background: C.cardBg, borderRadius: 14,
            padding: '24px 24px 20px', width: 480, maxHeight: '85vh',
            boxShadow: C.shadowLg, overflowY: 'auto',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>
                {detailMode === 'edit' ? 'Edit Contact' : 'Contact Details'}
              </div>
              <button onClick={() => setDetailContact(null)} style={{
                border: 'none', background: 'transparent', cursor: 'pointer', color: C.textMuted,
              }}><X size={18} /></button>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.textSecondary, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Name</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{detailContact.name}</div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.textSecondary, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Phone</div>
              <div style={{ fontSize: 14, color: C.textSecondary, display: 'flex', alignItems: 'center', gap: 4 }}>
                <Phone size={12} /> <MaskedNumber number={detailContact.contact_number} prefix="+" />
              </div>
            </div>

            {/* Assigned to (chat owner) — admins can (re)assign to a sales user */}
            {isAdmin && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.textSecondary, marginBottom: detailMode === 'edit' ? 6 : 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Assigned to</div>
                {detailMode === 'edit' ? (
                  <select
                    value={detailAssignedUserId ?? ''}
                    onChange={e => setDetailAssignedUserId(e.target.value || null)}
                    style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: FONT, color: C.text, background: C.cardBg, cursor: 'pointer' }}
                  >
                    <option value="">Unassigned</option>
                    {users.filter(u => u.isActive !== false).map(u => (
                      <option key={u.id} value={u.id}>{(u.displayName || u.username)} ({ROLE_LABEL_MAP[u.role] || u.role})</option>
                    ))}
                  </select>
                ) : (
                  <div style={{ fontSize: 14, color: C.text }}>
                    {(() => {
                      const u = users.find(x => String(x.id) === String(detailAssignedUserId));
                      return u ? (u.displayName || u.username) : (detailContact.assigned_user_name || 'Unassigned');
                    })()}
                  </div>
                )}
              </div>
            )}

            <div style={{ marginBottom: detailMode === 'edit' ? 8 : 20 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.textSecondary, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Assigned Tags</div>
              {detailTags.length === 0 ? (
                <div style={{ color: C.textMuted, fontSize: 12 }}>No tags assigned</div>
              ) : (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                  {detailTags.map(t => {
                    const info = getTagInfo(t);
                    return <TagBadge key={t.id} tag={info} onRemove={detailMode === 'edit' ? () => toggleTag(info) : null} />;
                  })}
                </div>
              )}
            </div>

            {/* Tag picker — only in edit mode */}
            {detailMode === 'edit' && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.textSecondary, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Assign Tags</div>
                {detailLoading ? (
                  <div style={{ color: C.textMuted, fontSize: 12 }}>Loading tags…</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {categories.map(cat => {
                      const catTags = tags.filter(t => t.category_id === cat.id);
                      if (catTags.length === 0) return null;
                      const selectedInCat = detailTags.find(t => t.category_id === cat.id);
                      return (
                        <div key={cat.id}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6 }}>{cat.name}</div>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {catTags.map(tag => {
                              const isSelected = detailTags.some(t => t.id === tag.id);
                              return (
                                <button
                                  key={tag.id}
                                  onClick={() => toggleTag(tag)}
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
                )}
              </div>
            )}

            {/* Custom fields */}
            {detailMode === 'edit'
              ? <CustomFieldEditor fields={fieldDefs} values={detailFields} onChange={setDetailFields} />
              : <CustomFieldView fields={fieldDefs} values={detailFields} />}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              {detailMode === 'view' ? (
                <>
                  <button onClick={() => setDetailContact(null)} style={{
                    padding: '8px 16px', borderRadius: 8, border: `1px solid ${C.border}`,
                    background: 'transparent', cursor: 'pointer', fontSize: 13,
                    fontWeight: 600, color: C.textSecondary, fontFamily: FONT,
                  }}>Close</button>
                  <button onClick={() => setDetailMode('edit')} style={{
                    padding: '8px 16px', borderRadius: 8, border: 'none',
                    background: C.primary, color: '#fff', cursor: 'pointer',
                    fontSize: 13, fontWeight: 600, fontFamily: FONT,
                  }}>
                    <Pencil size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />Edit
                  </button>
                </>
              ) : (
                <>
                  <button onClick={() => setDetailContact(null)} style={{
                    padding: '8px 16px', borderRadius: 8, border: `1px solid ${C.border}`,
                    background: 'transparent', cursor: 'pointer', fontSize: 13,
                    fontWeight: 600, color: C.textSecondary, fontFamily: FONT,
                  }}>Cancel</button>
                  <button onClick={saveDetail} disabled={savingDetail} style={{
                    padding: '8px 16px', borderRadius: 8, border: 'none',
                    background: C.primary, color: '#fff', cursor: savingDetail ? 'not-allowed' : 'pointer',
                    fontSize: 13, fontWeight: 600, fontFamily: FONT,
                    opacity: savingDetail ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    {savingDetail && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />}
                    Save
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
