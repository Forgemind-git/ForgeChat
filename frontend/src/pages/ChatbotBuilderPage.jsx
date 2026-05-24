import { useState, useEffect, useMemo } from 'react';
import { Plus, Pencil, Trash2, Loader2, Search, Bot, X, Copy } from 'lucide-react';
import DeleteConfirmModal from '../components/DeleteConfirmModal.jsx';
import AutomationBuilderView from '../components/AutomationBuilderView.jsx';
import { useTableSelection, SelectAllCheckbox, RowCheckbox, BulkDeleteButton, runBulkDelete } from '../components/TableSelection.jsx';
import { api } from '../api.js';
import { C, FONT } from '../constants.js';

// ─── Design Tokens ────────────────────────────────────────────────────────────
const B = {
  bg: '#F7F7F3',
  card: '#FFFFFF',
  cardBorder: '#E5E5E0',
  innerBg: '#FAFAF7',
  innerBorder: '#EEEEE8',
  rowSep: '#F5F5F0',
  t1: '#111111',
  t2: '#222222',
  t3: '#444444',
  t4: '#666666',
  t5: '#777777',
  t6: '#888888',
  t7: '#999999',
  accent: C.primary,
  accentBg: C.primaryLight,
  accentDark: C.primaryHover,
  green: '#0F6E56',
  greenBright: '#1D9E75',
  greenBg: '#E1F5EE',
  red: '#A32D2D',
  redBg: '#FCEBEB',
  orange: '#E65100',
  orangeBg: '#FFF3E0',
};

const STATUS_STYLES = {
  active:   { color: B.green, bg: B.greenBg, dot: B.greenBright, label: 'Active' },
  inactive: { color: B.t6, bg: '#EEEDE8', dot: '#aaa', label: 'Inactive' },
  draft:    { color: B.orange, bg: B.orangeBg, dot: B.orange, label: 'Draft' },
};

function StatusBadge({ status }) {
  const st = STATUS_STYLES[status] || STATUS_STYLES.draft;
  return (
    <span style={{ padding: '4px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700, background: st.bg, color: st.color, display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: FONT, whiteSpace: 'nowrap' }}>
      <span style={{ width: 6, height: 6, borderRadius: 99, background: st.dot, display: 'inline-block' }} />
      {st.label}
    </span>
  );
}

function NewAutomationModal({ open, onClose, onCreate }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!name.trim()) {
      alert('Name is required');
      return;
    }
    setCreating(true);
    try {
      const data = await api.chatbots.create({
        name: name.trim(),
        description: description || null,
        status: 'draft',
        trigger_type: 'keyword',
        config: { nodes: [], edges: [] }
      });
      onCreate(data);
    } catch (err) {
      alert(err.message || 'Create failed');
    } finally {
      setCreating(false);
    }
  };

  const overlayStyle = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' };
  const modalStyle = { background: 'var(--c-cardBg)', borderRadius: 14, padding: '24px 28px', width: 440, maxWidth: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.18)' };
  const inpStyle = { border: '1.5px solid #D5D5D0', borderRadius: 10, padding: '9px 14px', fontSize: 13, fontFamily: FONT, width: '100%', background: 'var(--c-cardBg)', color: 'var(--c-text)', outline: 'none' };
  const btnPriStyle = { padding: '10px 22px', background: B.accent, color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: FONT };
  const btnGhostStyle = { padding: '10px 22px', background: 'var(--c-cardBg)', border: '1.5px solid #D5D5D0', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FONT, color: '#444' };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: B.t1, margin: 0, fontFamily: FONT }}>New Automation</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: B.t5 }}><X size={18} /></button>
        </div>
        <div style={{ fontSize: 12, color: B.t5, marginBottom: 16, fontFamily: FONT }}>Name your automation and add a short description.</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: B.t3, display: 'block', marginBottom: 5, fontFamily: FONT }}>Name <span style={{ color: B.red }}>*</span></label>
            <input style={inpStyle} placeholder="e.g. Welcome Bot" value={name} onChange={e => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: B.t3, display: 'block', marginBottom: 5, fontFamily: FONT }}>Description</label>
            <textarea style={{ ...inpStyle, resize: 'vertical', lineHeight: 1.5 }} rows={3} placeholder="What does this automation do?" value={description} onChange={e => setDescription(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
          <button onClick={onClose} style={btnGhostStyle}>Cancel</button>
          <button onClick={handleSubmit} disabled={creating} style={btnPriStyle}>
            {creating ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : 'Next →'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ChatbotList({ chatbots, loading, onAdd, onEdit, onDelete, onDuplicate, onBulkDelete }) {
  const [deleteModal, setDeleteModal] = useState({ open: false, chatbot: null });
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return chatbots;
    const q = search.toLowerCase();
    return chatbots.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.description || '').toLowerCase().includes(q) ||
      c.status.toLowerCase().includes(q)
    );
  }, [chatbots, search]);

  const sel = useTableSelection(filtered);

  return (
    <div style={{ padding: 24, fontFamily: FONT }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: B.t1, margin: 0, letterSpacing: '-.02em' }}>Automations</h1>
          <p style={{ fontSize: 12, color: B.t5, margin: '4px 0 0' }}>Build and manage automated conversation flows.</p>
        </div>
        <button
          onClick={onAdd}
          style={{ padding: '10px 18px', background: C.primary, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 6, transition: 'background .15s' }}
          onMouseEnter={e => e.currentTarget.style.background = C.primaryHover}
          onMouseLeave={e => e.currentTarget.style.background = C.primary}
        >
          <Plus size={16} /> New Automation
        </button>
      </div>

      {/* Search + bulk-delete */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 1 360px', minWidth: 220 }}>
          <Search size={16} color={B.t6} />
          <input
            style={{ flex: 1, border: '1.5px solid #D5D5D0', borderRadius: 8, padding: '8px 12px', fontSize: 13, fontFamily: FONT, background: 'var(--c-cardBg)', color: 'var(--c-text)', outline: 'none' }}
            placeholder="Search automations..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <BulkDeleteButton sel={sel} label="automation" onConfirm={(ids) => onBulkDelete(ids)} />
      </div>

      {/* Content */}
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60, gap: 8 }}>
          <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> <span style={{ fontSize: 13, color: B.t5, fontFamily: FONT }}>Loading...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', background: B.card, border: `1px solid ${B.cardBorder}`, borderRadius: 12 }}>
          <Bot size={40} color="#ccc" style={{ marginBottom: 12 }} />
          <div style={{ fontSize: 15, fontWeight: 600, color: B.t3, marginBottom: 4, fontFamily: FONT }}>No automations yet</div>
          <div style={{ fontSize: 12, color: B.t6, marginBottom: 16, fontFamily: FONT }}>Create your first automation.</div>
          <button
            onClick={onAdd}
            style={{ padding: '10px 18px', background: C.primary, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: FONT, display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Plus size={16} /> New Automation
          </button>
        </div>
      ) : (
        <div style={{ background: B.card, border: `1px solid ${B.cardBorder}`, borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT }}>
            <thead>
              <tr style={{ background: B.innerBg, borderBottom: `1px solid ${B.cardBorder}` }}>
                <th style={{ padding: '10px 14px', width: 36 }}><SelectAllCheckbox sel={sel} /></th>
                {['Name', 'Description', 'Status', 'Trigger', 'Created', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', fontSize: 11, fontWeight: 700, color: B.t4, textAlign: 'left', textTransform: 'uppercase', letterSpacing: '.06em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id} style={{ borderBottom: `1px solid ${B.rowSep}`, background: sel.isSelected(c.id) ? '#FDF6F6' : 'transparent' }}>
                  <td style={{ padding: '12px 14px', width: 36 }}><RowCheckbox sel={sel} id={c.id} label={c.name} /></td>
                  <td style={{ padding: '12px 14px', fontSize: 13, fontWeight: 600, color: B.t2, fontFamily: FONT }}>{c.name}</td>
                  <td style={{ padding: '12px 14px', fontSize: 12, color: B.t4, fontFamily: FONT, maxWidth: 300 }}>
                    <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.description || '—'}
                    </span>
                  </td>
                  <td style={{ padding: '12px 14px' }}><StatusBadge status={c.status} /></td>
                  <td style={{ padding: '12px 14px', fontSize: 12, color: B.t4, fontFamily: FONT, textTransform: 'capitalize' }}>{c.trigger_type}</td>
                  <td style={{ padding: '12px 14px', fontSize: 11, color: B.t6, fontFamily: FONT, whiteSpace: 'nowrap' }}>{new Date(c.created_at).toLocaleDateString()}</td>
                  <td style={{ padding: '12px 14px' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => onEdit(c)} title="Edit" style={{ width: 28, height: 28, borderRadius: 6, border: '1.5px solid #D5D5D0', background: 'var(--c-cardBg)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: B.t4 }}>
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => onDuplicate(c)} title="Duplicate (creates a disabled copy)" style={{ width: 28, height: 28, borderRadius: 6, border: '1.5px solid #D5D5D0', background: 'var(--c-cardBg)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: B.t4 }}>
                        <Copy size={13} />
                      </button>
                      <button onClick={() => setDeleteModal({ open: true, chatbot: c })} title="Delete" style={{ width: 28, height: 28, borderRadius: 6, border: '1.5px solid #D5D5D0', background: 'var(--c-cardBg)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: B.red }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <DeleteConfirmModal
        open={deleteModal.open}
        title="Delete Automation"
        message={`Are you sure you want to delete "${deleteModal.chatbot?.name}"? This cannot be undone.`}
        onConfirm={() => { onDelete(deleteModal.chatbot?.id); setDeleteModal({ open: false, chatbot: null }); }}
        onCancel={() => setDeleteModal({ open: false, chatbot: null })}
      />

    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ChatbotBuilderPage({ subParts = [], navigate }) {
  const [chatbots, setChatbots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingChatbot, setEditingChatbot] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [builderTab, setBuilderTab] = useState('editor'); // 'editor' | 'executions'

  const routeId = subParts[0] || null;
  // Deep-link to a specific execution: #/chatbot-builder/<id>/executions/<execId>
  const routeTab = subParts[1] === 'executions' ? 'executions' : null;
  const routeExecutionId = routeTab === 'executions' ? (subParts[2] || null) : null;
  const view = routeId ? 'builder' : 'list';

  const loadChatbots = async () => {
    setLoading(true);
    try {
      const data = await api.chatbots.list();
      setChatbots(data);
    } catch (err) {
      console.error('Failed to load automations:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadChatbots();
  }, []);

  // Honour deep-link to executions tab from elsewhere in the app
  // (e.g. AI Models activity log → click an entry).
  useEffect(() => {
    if (routeTab === 'executions') setBuilderTab('executions');
  }, [routeTab, routeId]);

  // Hydrate editingChatbot from hash on direct reload
  useEffect(() => {
    if (!routeId) {
      setEditingChatbot(null);
      return;
    }
    if (editingChatbot?.id === routeId) return;
    const found = chatbots.find(c => String(c.id) === String(routeId));
    if (found) {
      setEditingChatbot(found);
    } else if (chatbots.length > 0) {
      // Fall back to direct fetch if not in list (e.g. deleted, or list still loading)
      api.chatbots.get(routeId)
        .then(data => setEditingChatbot(data))
        .catch(() => navigate && navigate('chatbot-builder'));
    }
  }, [routeId, chatbots]);

  const handleAdd = () => {
    setShowModal(true);
  };

  const handleModalCreate = (newAutomation) => {
    setShowModal(false);
    setChatbots(prev => [newAutomation, ...prev]);
    setEditingChatbot(newAutomation);
    navigate && navigate('chatbot-builder', newAutomation.id);
  };

  const handleEdit = (chatbot) => {
    setEditingChatbot(chatbot);
    setBuilderTab('editor');
    navigate && navigate('chatbot-builder', chatbot.id);
  };

  const handleDelete = async (id) => {
    try {
      await api.chatbots.delete(id);
      setChatbots(prev => prev.filter(c => c.id !== id));
    } catch (err) {
      alert(err.message || 'Delete failed');
    }
  };

  const handleDuplicate = async (chatbot) => {
    try {
      const copy = await api.chatbots.duplicate(chatbot.id);
      setChatbots(prev => [copy, ...prev]); // appears at top (newest), disabled by default
    } catch (err) {
      alert(err.message || 'Duplicate failed');
    }
  };

  const handleBulkDelete = async (ids) => {
    await runBulkDelete(ids, (id) => api.chatbots.delete(id), {
      label: 'automation',
      onSuccess: (deletedIds) => {
        const set = new Set(deletedIds);
        setChatbots(prev => prev.filter(c => !set.has(c.id)));
      },
    });
  };

  const handleBack = () => {
    setEditingChatbot(null);
    setBuilderTab('editor');
    if (navigate) navigate('chatbot-builder');
    loadChatbots();
  };

  const handleSaveBuilder = async ({ config }) => {
    if (!editingChatbot?.id) return;
    await api.chatbots.update(editingChatbot.id, { config });
  };

  const handleToggleStatus = async (nextStatus) => {
    if (!editingChatbot?.id) return;
    try {
      const updated = await api.chatbots.update(editingChatbot.id, { status: nextStatus });
      setEditingChatbot(prev => prev ? { ...prev, status: updated?.status || nextStatus } : prev);
      setChatbots(list => list.map(c => c.id === editingChatbot.id ? { ...c, status: updated?.status || nextStatus } : c));
    } catch (err) {
      alert(err.message || 'Failed to update status');
    }
  };

  if (view === 'builder') {
    if (!editingChatbot) {
      return (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textMuted, fontSize: 13, fontFamily: FONT }}>
          Loading automation…
        </div>
      );
    }
    return (
      <AutomationBuilderView
        automation={editingChatbot}
        onBack={handleBack}
        onSave={handleSaveBuilder}
        onToggleStatus={handleToggleStatus}
        activeTab={builderTab}
        onTabChange={setBuilderTab}
        initialExecutionId={routeExecutionId}
      />
    );
  }

  return (
    <>
      <ChatbotList
        chatbots={chatbots}
        loading={loading}
        onAdd={handleAdd}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onDuplicate={handleDuplicate}
        onBulkDelete={handleBulkDelete}
      />
      <NewAutomationModal
        open={showModal}
        onClose={() => setShowModal(false)}
        onCreate={handleModalCreate}
      />
    </>
  );
}
