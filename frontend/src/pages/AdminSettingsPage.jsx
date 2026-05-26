import { useState, useEffect } from 'react';
import {
  Settings, Tag, FolderOpen,
  LogOut, Trash2, FormInput, Users as UsersIcon, Shield, Copy,
  ArrowLeft, Plus, X, ChevronLeft, Eye, EyeOff, Phone, User,
  Loader2, MessageSquare, Key, Check,
} from 'lucide-react';
import { api } from '../api.js';
import { C, FONT, MONO, maskPhone } from '../constants.js';
import DeleteConfirmModal from '../components/DeleteConfirmModal.jsx';
import { useTableSelection, SelectAllCheckbox, RowCheckbox, BulkDeleteButton, runBulkDelete } from '../components/TableSelection.jsx';

const TABS = [
  { key: 'general', label: 'General', icon: Settings },
  { key: 'tags', label: 'Tags', icon: Tag },
  { key: 'category', label: 'Category', icon: FolderOpen },
  { key: 'fields', label: 'Fields', icon: FormInput },
  { key: 'whatsapp-accounts', label: 'WhatsApp Accounts', icon: MessageSquare },
  { key: 'users', label: 'Users', icon: UsersIcon },
];

// Two roles ship today: admin (full access) and bda_sales (labelled "Sales").
const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'bda_sales', label: 'Sales' },
];
const ROLE_LABEL = { admin: 'Admin', bda_sales: 'Sales', viewer: 'Viewer' };

const FIELD_TYPE_OPTIONS = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Text area' },
  { value: 'number', label: 'Number' },
  { value: 'phone', label: 'Phone' },
  { value: 'email', label: 'Email' },
  { value: 'date', label: 'Date' },
  { value: 'url', label: 'URL' },
];
const FIELD_TYPE_LABEL = Object.fromEntries(FIELD_TYPE_OPTIONS.map(o => [o.value, o.label]));

const TIMEZONES = [
  'Asia/Calcutta',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Australia/Sydney',
  'Pacific/Auckland',
];

const COLOR_PRESETS = [
  '#dc2626', '#ea580c', '#d97706', '#16a34a',
  '#0891b2', '#2563eb', '#7c3aed', '#db2777',
  '#4b5563', '#000000',
];

/* ------------------------------------------------------------------ */
/*  General                                                            */
/* ------------------------------------------------------------------ */
function GeneralTab({ onLogout, user }) {
  const [timezone, setTimezone] = useState('Asia/Calcutta');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [showDeleteInput, setShowDeleteInput] = useState(false);

  const handleDeleteClick = () => {
    if (!showDeleteInput) { setShowDeleteInput(true); return; }
    if (deleteConfirm.trim().toLowerCase() === 'delete') {
      alert('Account deletion request submitted.');
      setShowDeleteInput(false);
      setDeleteConfirm('');
    } else {
      alert('Please type "delete" to confirm account deletion.');
    }
  };

  return (
    <div style={{ flex: 1, padding: '32px 40px', overflowY: 'auto', fontFamily: FONT }}>
      <div style={{ maxWidth: '100%' }}>
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: 0, letterSpacing: '-.02em', fontFamily: FONT }}>General Settings</h1>
          <p style={{ fontSize: 12, color: C.textMuted, margin: '4px 0 0', fontFamily: FONT }}>Manage your account preferences and settings</p>
        </div>

        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
            Timezone
          </div>
          <select value={timezone} onChange={e => setTimezone(e.target.value)} style={{
            width: '100%', maxWidth: 360, padding: '10px 12px', borderRadius: 8,
            border: `1px solid ${C.border}`, fontSize: 14, fontFamily: FONT,
            color: C.text, background: 'var(--c-cardBg)', outline: 'none', cursor: 'pointer',
          }}>
            {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
          </select>
        </div>

        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
            Account
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button onClick={onLogout} style={{
              width: 'fit-content', display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 18px', borderRadius: 8, border: `1px solid ${C.border}`,
              background: 'var(--c-cardBg)', cursor: 'pointer', fontFamily: FONT, fontSize: 13,
              fontWeight: 600, color: C.text,
            }}>
              <LogOut size={14} /> Sign out
            </button>

            {/* Single-owner system: the owner manages their own account. */}
            {true && (
            <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 16, marginTop: 6 }}>
              <button onClick={handleDeleteClick} style={{
                width: 'fit-content', display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 18px', borderRadius: 8, border: '1.5px solid #fca5a5',
                background: '#fef2f2', cursor: 'pointer', fontFamily: FONT, fontSize: 13,
                fontWeight: 600, color: C.primary,
              }}>
                <Trash2 size={14} /> Delete account
              </button>
              {showDeleteInput && (
                <div style={{ marginTop: 12, maxWidth: 360 }}>
                  <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 8 }}>
                    Type <strong>"delete"</strong> below to confirm permanent account deletion.
                  </div>
                  <input autoFocus value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleDeleteClick()}
                    placeholder="Type delete..." style={{
                      width: '100%', padding: '10px 12px', borderRadius: 8,
                      border: `1px solid ${C.border}`, fontSize: 14, fontFamily: FONT,
                      color: C.text, outline: 'none', boxSizing: 'border-box',
                    }} />
                </div>
              )}
            </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tags                                                               */
/* ------------------------------------------------------------------ */
function TagsTab({ categories, tags, onRefresh }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingTag, setEditingTag] = useState(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#dc2626');
  const [categoryId, setCategoryId] = useState('');
  const [deleteModal, setDeleteModal] = useState({ open: false, id: null });
  const [filterCategoryId, setFilterCategoryId] = useState('');

  // Category filter — selection/bulk-delete operate on the visible (filtered) set.
  const filteredTags = filterCategoryId
    ? tags.filter(t => String(t.category_id) === String(filterCategoryId))
    : tags;

  const sel = useTableSelection(filteredTags);
  const handleBulkDelete = async (ids) => {
    await runBulkDelete(ids, (id) => api.tags.delete(id), {
      label: 'tag',
      onSuccess: () => onRefresh(),
    });
  };

  const openAdd = () => {
    setEditingTag(null);
    setName('');
    setColor('#dc2626');
    setCategoryId('');
    setShowAdd(true);
  };

  const openEdit = (tag) => {
    setEditingTag(tag);
    setName(tag.name);
    setColor(tag.color);
    setCategoryId(tag.category_id);
    setShowAdd(true);
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) { alert('Tag name is required'); return; }
    if (!categoryId) { alert('Please select a category'); return; }
    try {
      if (editingTag) {
        await api.tags.update(editingTag.id, { name: trimmed, color, categoryId });
      } else {
        await api.tags.create({ name: trimmed, color, categoryId });
      }
      onRefresh();
      setShowAdd(false);
      setEditingTag(null);
      setName('');
      setColor('#dc2626');
      setCategoryId('');
    } catch (err) {
      alert('Failed to save tag: ' + err.message);
    }
  };

  const handleDeleteClick = (id) => {
    setDeleteModal({ open: true, id });
  };

  const handleDeleteConfirm = async () => {
    try {
      await api.tags.delete(deleteModal.id);
      onRefresh();
      setDeleteModal({ open: false, id: null });
    } catch (err) {
      alert('Failed to delete tag: ' + err.message);
    }
  };

  const getCategoryName = (cid) => categories.find(c => c.id === cid)?.name || '-';

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        padding: '20px 32px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: `1px solid ${C.border}`,
      }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: 0, letterSpacing: '-.02em', fontFamily: FONT }}>Tags</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <select
            value={filterCategoryId}
            onChange={e => setFilterCategoryId(e.target.value)}
            title="Filter by category"
            style={{
              padding: '8px 12px', borderRadius: 8,
              border: `1px solid ${C.border}`, fontSize: 13, fontFamily: FONT,
              color: filterCategoryId ? C.text : C.textSecondary, background: 'var(--c-cardBg)',
              outline: 'none', cursor: 'pointer', maxWidth: 220,
            }}
          >
            <option value="">All categories</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <BulkDeleteButton sel={sel} label="tag" onConfirm={handleBulkDelete} />
          <button onClick={openAdd} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 8, border: 'none',
            background: C.primary, color: '#fff', cursor: 'pointer',
            fontFamily: FONT, fontSize: 13, fontWeight: 600,
          }}>
            <Plus size={14} /> Add tag
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 32px' }}>
        {tags.length === 0 ? (
          <div style={{ textAlign: 'center', color: C.textMuted, fontSize: 14, marginTop: 60 }}>
            No tags yet. Click "Add tag" to create one.
          </div>
        ) : filteredTags.length === 0 ? (
          <div style={{ textAlign: 'center', color: C.textMuted, fontSize: 14, marginTop: 60 }}>
            No tags in <strong>{getCategoryName(filterCategoryId)}</strong>.
          </div>
        ) : (
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT, fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--c-hover)' }}>
                  <th style={{ padding: '12px 16px', width: 40, borderBottom: `1px solid ${C.border}` }}><SelectAllCheckbox sel={sel} /></th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: C.textSecondary, borderBottom: `1px solid ${C.border}` }}>Tag</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: C.textSecondary, borderBottom: `1px solid ${C.border}` }}>Category</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: C.textSecondary, borderBottom: `1px solid ${C.border}` }}>Created</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: C.textSecondary, borderBottom: `1px solid ${C.border}` }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTags.map(tag => (
                  <tr key={tag.id} style={{ background: sel.isSelected(tag.id) ? '#FDF6F6' : 'var(--c-cardBg)', borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: '12px 16px', width: 40 }}><RowCheckbox sel={sel} id={tag.id} label={tag.name} /></td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{
                          width: 14, height: 14, borderRadius: 4,
                          background: tag.color, display: 'inline-block',
                          border: '1px solid rgba(0,0,0,0.1)',
                        }} />
                        <span style={{ fontWeight: 600, color: C.text }}>{tag.name}</span>
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px', color: C.textSecondary }}>{getCategoryName(tag.category_id)}</td>
                    <td style={{ padding: '12px 16px', color: C.textSecondary }}>{new Date(tag.created_at).toLocaleDateString()}</td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      <button onClick={() => openEdit(tag)} style={{
                        border: 'none', background: 'transparent', cursor: 'pointer',
                        color: C.purple, fontSize: 12, fontWeight: 600, marginRight: 12,
                      }}>Edit</button>
                      <button onClick={() => handleDeleteClick(tag.id)} style={{
                        border: 'none', background: 'transparent', cursor: 'pointer',
                        color: C.primary, fontSize: 12, fontWeight: 600,
                      }}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <DeleteConfirmModal
        open={deleteModal.open}
        title="Delete Tag"
        message="Are you sure you want to delete this tag? It will be removed from all contacts."
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteModal({ open: false, id: null })}
      />

      {showAdd && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 200, fontFamily: FONT,
        }}>
          <div style={{
            background: C.cardBg, borderRadius: 14,
            padding: '24px 24px 20px', width: 420, boxShadow: C.shadowLg,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{editingTag ? 'Edit Tag' : 'Add Tag'}</div>
              <button onClick={() => { setShowAdd(false); setEditingTag(null); }} style={{
                border: 'none', background: 'transparent', cursor: 'pointer', color: C.textMuted,
              }}><X size={18} /></button>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.textSecondary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Tag Name</label>
              <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Follow-up"
                onKeyDown={e => e.key === 'Enter' && handleSave()}
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 8,
                  border: `1px solid ${C.border}`, fontSize: 14, fontFamily: FONT,
                  color: C.text, outline: 'none', boxSizing: 'border-box',
                }} />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.textSecondary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Color</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {COLOR_PRESETS.map(c => (
                  <button key={c} onClick={() => setColor(c)} style={{
                    width: 28, height: 28, borderRadius: 6,
                    background: c,
                    border: color === c ? '2px solid #111' : '2px solid transparent',
                    cursor: 'pointer',
                    boxShadow: color === c ? '0 0 0 2px #fff inset' : 'none',
                  }} />
                ))}
                <label style={{
                  width: 28, height: 28, borderRadius: 6,
                  border: `2px dashed ${C.border}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', color: C.textMuted,
                }}>
                  <Plus size={14} />
                  <input type="color" value={color} onChange={e => setColor(e.target.value)} style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }} />
                </label>
              </div>
              <div style={{ marginTop: 6, fontSize: 12, color: C.textMuted }}>Selected: {color}</div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.textSecondary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Category</label>
              <select value={categoryId} onChange={e => setCategoryId(e.target.value)} style={{
                width: '100%', padding: '10px 12px', borderRadius: 8,
                border: `1px solid ${C.border}`, fontSize: 14, fontFamily: FONT,
                color: C.text, background: 'var(--c-cardBg)', outline: 'none', cursor: 'pointer',
              }}>
                <option value="">Select category…</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { setShowAdd(false); setEditingTag(null); }} style={{
                padding: '8px 16px', borderRadius: 8, border: `1px solid ${C.border}`,
                background: 'transparent', cursor: 'pointer', fontSize: 13,
                fontWeight: 600, color: C.textSecondary, fontFamily: FONT,
              }}>Cancel</button>
              <button onClick={handleSave} style={{
                padding: '8px 16px', borderRadius: 8, border: 'none',
                background: C.primary, color: '#fff', cursor: 'pointer',
                fontSize: 13, fontWeight: 600, fontFamily: FONT,
              }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Category Detail                                                    */
/* ------------------------------------------------------------------ */
function CategoryDetail({ category, tags, onBack, onDeleteTag, onRefresh }) {
  const categoryTags = tags.filter(t => t.category_id === category.id);
  const [deleteModal, setDeleteModal] = useState({ open: false, id: null });

  const handleDeleteClick = (tid) => {
    setDeleteModal({ open: true, id: tid });
  };

  const handleDeleteConfirm = async () => {
    try {
      await api.tags.delete(deleteModal.id);
      onRefresh();
      setDeleteModal({ open: false, id: null });
    } catch (err) {
      alert('Failed to delete tag: ' + err.message);
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '20px 32px', borderBottom: `1px solid ${C.border}` }}>
        <button onClick={onBack} style={{
          display: 'flex', alignItems: 'center', gap: 6,
          border: 'none', background: 'transparent', cursor: 'pointer',
          color: C.textSecondary, fontFamily: FONT, fontSize: 13,
          fontWeight: 600, marginBottom: 12,
        }}>
          <ChevronLeft size={16} /> Back to categories
        </button>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: 0, letterSpacing: '-.02em', fontFamily: FONT }}>
          {category.name}
        </h1>
        <div style={{ fontSize: 13, color: C.textSecondary, marginTop: 4, fontFamily: FONT }}>
          {category.description || 'No description'}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 32px' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.textSecondary, marginBottom: 12, fontFamily: FONT }}>
          Tags under this category ({categoryTags.length})
        </div>
        {categoryTags.length === 0 ? (
          <div style={{ color: C.textMuted, fontSize: 13 }}>No tags assigned to this category yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {categoryTags.map(tag => (
              <div key={tag.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 16px', background: 'var(--c-cardBg)', borderRadius: 8,
                border: `1px solid ${C.border}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{
                    width: 14, height: 14, borderRadius: 4,
                    background: tag.color, display: 'inline-block',
                    border: '1px solid rgba(0,0,0,0.1)',
                  }} />
                  <span style={{ fontWeight: 600, color: C.text, fontSize: 14 }}>{tag.name}</span>
                </div>
                <button onClick={() => handleDeleteClick(tag.id)} style={{
                  border: 'none', background: 'transparent', cursor: 'pointer',
                  color: C.primary, fontSize: 12, fontWeight: 600,
                }}>Delete</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <DeleteConfirmModal
        open={deleteModal.open}
        title="Delete Tag"
        message="Are you sure you want to delete this tag? It will be removed from all contacts."
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteModal({ open: false, id: null })}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Category Tab                                                       */
/* ------------------------------------------------------------------ */
function CategoryTab({ categories, tags, onRefresh, detailId, onViewDetail, onBack, showAddForm, onAddFormShown }) {
  const [showAdd, setShowAdd] = useState(showAddForm);
  const [editingCategory, setEditingCategory] = useState(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [deleteModal, setDeleteModal] = useState({ open: false, id: null });

  useEffect(() => {
    setShowAdd(showAddForm);
  }, [showAddForm]);

  const openAdd = () => {
    setEditingCategory(null);
    setName('');
    setDescription('');
    setShowAdd(true);
    onAddFormShown();
  };

  const openEdit = (cat) => {
    setEditingCategory(cat);
    setName(cat.name);
    setDescription(cat.description || '');
    setShowAdd(true);
    onAddFormShown();
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) { alert('Category name is required'); return; }
    try {
      if (editingCategory) {
        await api.categories.update(editingCategory.id, { name: trimmed, description: description.trim() });
      } else {
        await api.categories.create({ name: trimmed, description: description.trim() });
      }
      onRefresh();
      setShowAdd(false);
      setEditingCategory(null);
      onAddFormShown();
      setName('');
      setDescription('');
    } catch (err) {
      alert('Failed to save category: ' + err.message);
    }
  };

  const handleDeleteClick = (id) => {
    setDeleteModal({ open: true, id });
  };

  const handleDeleteConfirm = async () => {
    try {
      await api.categories.delete(deleteModal.id);
      onRefresh();
      setDeleteModal({ open: false, id: null });
    } catch (err) {
      alert('Failed to delete category: ' + err.message);
    }
  };

  const sel = useTableSelection(categories);
  const handleBulkDelete = async (ids) => {
    await runBulkDelete(ids, (id) => api.categories.delete(id), {
      label: 'category',
      onSuccess: () => onRefresh(),
    });
  };

  if (detailId) {
    const cat = categories.find(c => c.id === detailId);
    if (!cat) { onBack(); return null; }
    return (
      <CategoryDetail
        category={cat}
        tags={tags}
        onBack={onBack}
        onRefresh={onRefresh}
      />
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        padding: '20px 32px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: `1px solid ${C.border}`,
      }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: 0, letterSpacing: '-.02em', fontFamily: FONT }}>Categories</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <BulkDeleteButton sel={sel} label="category" onConfirm={handleBulkDelete} />
          <button onClick={openAdd} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 8, border: 'none',
            background: C.primary, color: '#fff', cursor: 'pointer',
            fontFamily: FONT, fontSize: 13, fontWeight: 600,
          }}>
            <Plus size={14} /> Add category
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 32px' }}>
        {categories.length === 0 ? (
          <div style={{ textAlign: 'center', color: C.textMuted, fontSize: 14, marginTop: 60 }}>
            No categories yet. Click "Add category" to create one.
          </div>
        ) : (
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT, fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--c-hover)' }}>
                  <th style={{ padding: '12px 16px', width: 40, borderBottom: `1px solid ${C.border}` }}><SelectAllCheckbox sel={sel} /></th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: C.textSecondary, borderBottom: `1px solid ${C.border}` }}>Name</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: C.textSecondary, borderBottom: `1px solid ${C.border}` }}>Description</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: C.textSecondary, borderBottom: `1px solid ${C.border}` }}>Tags</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: C.textSecondary, borderBottom: `1px solid ${C.border}` }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {categories.map(cat => {
                  const tagCount = tags.filter(t => t.category_id === cat.id).length;
                  return (
                    <tr key={cat.id} style={{ background: sel.isSelected(cat.id) ? '#FDF6F6' : 'var(--c-cardBg)', borderBottom: `1px solid ${C.border}`, cursor: 'pointer' }}
                      onClick={() => onViewDetail(cat.id)}
                      onMouseEnter={e => { if (!sel.isSelected(cat.id)) e.currentTarget.style.background = '#f9fafb'; }}
                      onMouseLeave={e => { if (!sel.isSelected(cat.id)) e.currentTarget.style.background = '#fff'; }}
                    >
                      <td style={{ padding: '12px 16px', width: 40 }} onClick={(e) => e.stopPropagation()}><RowCheckbox sel={sel} id={cat.id} label={cat.name} /></td>
                      <td style={{ padding: '12px 16px', fontWeight: 600, color: C.text }}>{cat.name}</td>
                      <td style={{ padding: '12px 16px', color: C.textSecondary, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cat.description || '-'}</td>
                      <td style={{ padding: '12px 16px', color: C.textSecondary }}>{tagCount}</td>
                      <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                        <button onClick={(e) => { e.stopPropagation(); onViewDetail(cat.id); }} style={{
                          border: 'none', background: 'transparent', cursor: 'pointer',
                          color: C.purple, fontSize: 12, fontWeight: 600, marginRight: 12,
                        }}><Eye size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />View</button>
                        <button onClick={(e) => { e.stopPropagation(); openEdit(cat); }} style={{
                          border: 'none', background: 'transparent', cursor: 'pointer',
                          color: '#2563eb', fontSize: 12, fontWeight: 600, marginRight: 12,
                        }}>Edit</button>
                        <button onClick={(e) => { e.stopPropagation(); handleDeleteClick(cat.id); }} style={{
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

      <DeleteConfirmModal
        open={deleteModal.open}
        title="Delete Category"
        message="Are you sure you want to delete this category? All tags under it will be deleted too."
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteModal({ open: false, id: null })}
      />

      {showAdd && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 200, fontFamily: FONT,
        }}>
          <div style={{
            background: C.cardBg, borderRadius: 14,
            padding: '24px 24px 20px', width: 420, boxShadow: C.shadowLg,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{editingCategory ? 'Edit Category' : 'Add Category'}</div>
              <button onClick={() => { setShowAdd(false); setEditingCategory(null); onAddFormShown(); }} style={{
                border: 'none', background: 'transparent', cursor: 'pointer', color: C.textMuted,
              }}><X size={18} /></button>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.textSecondary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Category Name</label>
              <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Admission"
                onKeyDown={e => e.key === 'Enter' && handleSave()}
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 8,
                  border: `1px solid ${C.border}`, fontSize: 14, fontFamily: FONT,
                  color: C.text, outline: 'none', boxSizing: 'border-box',
                }} />
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.textSecondary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Description</label>
              <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Short description..."
                rows={3}
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 8,
                  border: `1px solid ${C.border}`, fontSize: 14, fontFamily: FONT,
                  color: C.text, outline: 'none', boxSizing: 'border-box', resize: 'vertical',
                }} />
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { setShowAdd(false); setEditingCategory(null); onAddFormShown(); }} style={{
                padding: '8px 16px', borderRadius: 8, border: `1px solid ${C.border}`,
                background: 'transparent', cursor: 'pointer', fontSize: 13,
                fontWeight: 600, color: C.textSecondary, fontFamily: FONT,
              }}>Cancel</button>
              <button onClick={handleSave} style={{
                padding: '8px 16px', borderRadius: 8, border: 'none',
                background: C.primary, color: '#fff', cursor: 'pointer',
                fontSize: 13, fontWeight: 600, fontFamily: FONT,
              }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/*  WhatsApp Accounts Tab                                              */
/* ------------------------------------------------------------------ */
function WhatsappAccountsTab() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    phoneNumberId: '', wabaId: '', accessToken: '', verifyToken: '', metaAppId: '',
  });
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  // The callback URL to register in the Meta App Dashboard — always the live origin.
  const webhookUrl = `${window.location.origin}/api/webhook/whatsapp`;
  const copyWebhookUrl = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  };

  const refresh = async () => {
    setLoading(true);
    try {
      const data = await api.whatsappAccounts.list();
      setAccounts(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const startCreate = () => {
    setEditing(null);
    setForm({ phoneNumberId: '', wabaId: '', accessToken: '', verifyToken: '', metaAppId: '' });
    setShowToken(false);
    setShowForm(true);
  };
  const startEdit = (acc) => {
    setEditing(acc);
    setForm({
      phoneNumberId: acc.phoneNumberId || '',
      wabaId: acc.wabaId || '',
      accessToken: '',                 // blank = keep the stored token
      verifyToken: acc.verifyToken || '',
      metaAppId: acc.metaAppId || '',
    });
    setShowToken(false);
    setShowForm(true);
  };

  const save = async () => {
    if (!form.phoneNumberId.trim() || !form.wabaId.trim()) {
      alert('Phone Number ID and WhatsApp Business Account ID are required');
      return;
    }
    if (!editing && !form.accessToken.trim()) {
      alert('Permanent Access Token is required');
      return;
    }
    if (!form.verifyToken.trim()) {
      alert('Webhook Verify Token is required');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        const payload = { ...form };
        if (!payload.accessToken) delete payload.accessToken;
        await api.whatsappAccounts.update(editing.id, payload);
      } else {
        await api.whatsappAccounts.create(form);
      }
      setShowForm(false);
      await refresh();
    } catch (err) {
      alert(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const inpStyle ={ width: '100%', padding: '8px 12px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontFamily: FONT, outline: 'none', background: 'var(--c-cardBg)', color: C.text };
  const labelStyle = { display: 'block', fontSize: 11, fontWeight: 600, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6, fontFamily: FONT };
  const sectionTitleStyle = { fontSize: 14, fontWeight: 700, color: C.text, margin: '0 0 2px' };
  const sectionSubStyle = { fontSize: 12, color: C.textMuted, margin: '0 0 14px' };
  const hintInline = { color: C.textMuted, fontWeight: 400, textTransform: 'none', letterSpacing: 0 };
  const hintRow = { fontSize: 11, color: C.textMuted, marginTop: 5 };
  const eyeBtnStyle = { position: 'absolute', right: 8, top: 8, background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, padding: 4 };
  const copyBtnStyle = { flexShrink: 0, width: 42, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--c-cardBg)', border: `1px solid ${C.border}`, borderRadius: 8, cursor: 'pointer', color: copied ? C.green : C.textSecondary };

  return (
    <div style={{ flex: 1, padding: 24, overflow: 'auto', fontFamily: FONT }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: 0 }}>WhatsApp Account</h2>
          <p style={{ fontSize: 12, color: C.textMuted, margin: '4px 0 0' }}>
            The single Business Account (WABA) used to send templates, broadcasts and automation messages.
          </p>
        </div>
        {/* Single-account system: connecting is only possible when none exists yet. */}
        {accounts.length === 0 && (
          <button onClick={startCreate} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', background: C.primary, color: '#fff', border: 'none',
            borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
          }}>
            <Plus size={15} /> Connect account
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: C.textMuted }}>Loading…</div>
      ) : accounts.length === 0 ? (
        <div style={{
          padding: '48px 32px', textAlign: 'center', background: C.cardBg,
          border: `1px dashed ${C.border}`, borderRadius: 12, color: C.textMuted, fontSize: 13,
        }}>
          <MessageSquare size={36} style={{ opacity: 0.5, marginBottom: 12 }} />
          <div style={{ marginBottom: 6, color: C.textSecondary, fontWeight: 600 }}>No WhatsApp Business account connected yet</div>
          <div>Connect your WhatsApp Business account to start creating templates and broadcasts.</div>
        </div>
      ) : (
        <div style={{ background: C.cardBg, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--c-hover)', borderBottom: `1px solid ${C.border}` }}>
                <th style={thStyle}>Display name</th>
                <th style={thStyle}>Phone number</th>
                <th style={thStyle}>Phone number ID</th>
                <th style={thStyle}>WABA ID</th>
                <th style={thStyle}>Access token</th>
                <th style={thStyle}>Health</th>
                <th style={thStyle}>Status</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map(acc => (
                <tr key={acc.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={tdStyle}>
                    <span style={{ fontWeight: 600 }}>{acc.displayName}</span>
                  </td>
                  <td style={tdStyle}>{maskPhone(acc.displayPhoneNumber)}</td>
                  <td style={{ ...tdStyle, fontFamily: 'DM Mono, monospace', fontSize: 11 }}>{acc.phoneNumberId}</td>
                  <td style={{ ...tdStyle, fontFamily: 'DM Mono, monospace', fontSize: 11 }}>{acc.wabaId}</td>
                  <td style={{ ...tdStyle, fontFamily: 'DM Mono, monospace', fontSize: 11, color: C.textMuted }}>{acc.accessTokenMasked}</td>
                  <td style={tdStyle}>
                    {(() => {
                      const h = acc.healthStatus || 'unknown';
                      const styles = {
                        healthy: { bg: '#E1F5EE', fg: '#0F6E56', label: 'Healthy' },
                        invalid_token: { bg: '#FCEBEB', fg: '#A32D2D', label: 'Token expired' },
                        rate_limited: { bg: '#FFF3E0', fg: '#E65100', label: 'Rate limited' },
                        unknown_error: { bg: '#FCEBEB', fg: '#A32D2D', label: 'Error' },
                        unknown: { bg: '#EEEDE8', fg: C.textMuted, label: 'Not checked' },
                      };
                      const s = styles[h] || styles.unknown;
                      return (
                        <span title={acc.lastErrorMessage || ''} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 99, fontWeight: 600, background: s.bg, color: s.fg }}>
                          {s.label}
                        </span>
                      );
                    })()}
                  </td>
                  <td style={tdStyle}>
                    <span style={{
                      fontSize: 11, padding: '3px 8px', borderRadius: 99, fontWeight: 600,
                      background: acc.isActive ? '#E1F5EE' : '#EEEDE8',
                      color: acc.isActive ? '#0F6E56' : C.textMuted,
                    }}>
                      {acc.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    <button onClick={() => startEdit(acc)} style={iconBtnStyle} title="Edit / update token">
                      <Eye size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Form modal */}
      {showForm && (
        <div onClick={() => setShowForm(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--c-cardBg)', borderRadius: 14, width: 520, maxHeight: '90vh', overflow: 'auto', boxShadow: C.shadowLg, padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: C.text, margin: 0 }}>
                {editing ? 'Edit WhatsApp Business account' : 'Add WhatsApp Business account'}
              </h3>
              <button onClick={() => setShowForm(false)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: C.textMuted }}><X size={20} /></button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {/* API Credentials */}
              <div>
                <h4 style={sectionTitleStyle}>API Credentials</h4>
                <p style={sectionSubStyle}>Enter your WhatsApp Cloud API credentials (from Meta Business Suite).</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div>
                    <label style={labelStyle}>Phone Number ID</label>
                    <input style={{ ...inpStyle, fontFamily: MONO }} value={form.phoneNumberId} onChange={e => setForm({ ...form, phoneNumberId: e.target.value })} placeholder="e.g. 100234567890123" autoFocus />
                  </div>
                  <div>
                    <label style={labelStyle}>WhatsApp Business Account ID</label>
                    <input style={{ ...inpStyle, fontFamily: MONO }} value={form.wabaId} onChange={e => setForm({ ...form, wabaId: e.target.value })} placeholder="e.g. 100234567890456" />
                  </div>
                  <div>
                    <label style={labelStyle}>
                      Permanent Access Token {editing && <span style={hintInline}>(leave blank to keep existing)</span>}
                    </label>
                    <div style={{ position: 'relative' }}>
                      <input
                        style={{ ...inpStyle, paddingRight: 38, fontFamily: MONO, fontSize: 12 }}
                        type={showToken ? 'text' : 'password'}
                        value={form.accessToken}
                        onChange={e => setForm({ ...form, accessToken: e.target.value })}
                        placeholder={editing ? '••••••••' : 'Enter your access token'}
                      />
                      <button type="button" onClick={() => setShowToken(s => !s)} style={eyeBtnStyle}>
                        {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    <div style={{ ...hintRow, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Key size={10} /> Encrypted at rest with AES-256-GCM.
                    </div>
                  </div>
                  <div>
                    <label style={labelStyle}>Webhook Verify Token</label>
                    <input style={inpStyle} value={form.verifyToken} onChange={e => setForm({ ...form, verifyToken: e.target.value })} placeholder="Create a custom verify token" />
                    <div style={hintRow}>A custom string you create. Must match the token you set in Meta webhook settings.</div>
                  </div>
                  <div>
                    <label style={labelStyle}>Meta App ID <span style={hintInline}>(only required for media-header templates)</span></label>
                    <input style={{ ...inpStyle, fontFamily: MONO }} value={form.metaAppId} onChange={e => setForm({ ...form, metaAppId: e.target.value })} placeholder="e.g. 1191602295745986" />
                    <div style={hintRow}>From Meta App Dashboard → App Settings → Basic → App ID. Needed for uploading image/video/document template headers.</div>
                  </div>
                </div>
              </div>

              {/* Webhook Configuration */}
              <div>
                <h4 style={sectionTitleStyle}>Webhook Configuration</h4>
                <p style={sectionSubStyle}>Use this URL as your webhook callback in the Meta App Dashboard.</p>
                <label style={labelStyle}>Webhook Callback URL</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    readOnly
                    value={webhookUrl}
                    onFocus={e => e.target.select()}
                    style={{ ...inpStyle, fontFamily: MONO, fontSize: 12, background: 'var(--c-hover)', color: C.textSecondary }}
                  />
                  <button type="button" onClick={copyWebhookUrl} title={copied ? 'Copied!' : 'Copy URL'} style={copyBtnStyle}>
                    {copied ? <Check size={15} /> : <Copy size={15} />}
                  </button>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 }}>
              <button onClick={() => setShowForm(false)} disabled={saving} style={{ padding: '8px 16px', background: 'var(--c-cardBg)', color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}>Cancel</button>
              <button onClick={save} disabled={saving} style={{ padding: '8px 16px', background: C.primary, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: saving ? 'wait' : 'pointer', fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 6 }}>
                {saving && <Loader2 size={14} className="spin" />}
                {editing ? 'Save changes' : 'Create account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Fields (custom contact field definitions)                          */
/* ------------------------------------------------------------------ */
function FieldsTab({ fields, onRefresh }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState('');
  const [fieldType, setFieldType] = useState('text');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteModal, setDeleteModal] = useState({ open: false, id: null });

  const openAdd = () => {
    setEditing(null);
    setName('');
    setFieldType('text');
    setDescription('');
    setShowAdd(true);
  };

  const openEdit = (f) => {
    setEditing(f);
    setName(f.name);
    setFieldType(f.field_type);
    setDescription(f.description || '');
    setShowAdd(true);
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) { alert('Field name is required'); return; }
    setSaving(true);
    try {
      const payload = { name: trimmed, fieldType, description: description.trim() };
      if (editing) {
        await api.contactFields.update(editing.id, payload);
      } else {
        await api.contactFields.create({ ...payload, sortOrder: fields.length });
      }
      await onRefresh();
      setShowAdd(false);
      setEditing(null);
    } catch (err) {
      alert('Failed to save field: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteConfirm = async () => {
    try {
      await api.contactFields.delete(deleteModal.id);
      await onRefresh();
      setDeleteModal({ open: false, id: null });
    } catch (err) {
      alert('Failed to delete field: ' + err.message);
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        padding: '20px 32px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: `1px solid ${C.border}`,
      }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: 0, letterSpacing: '-.02em', fontFamily: FONT }}>Fields</h1>
          <p style={{ fontSize: 12, color: C.textMuted, margin: '4px 0 0', fontFamily: FONT }}>
            Custom fields appear when editing a contact — capture extra details per contact.
          </p>
        </div>
        <button onClick={openAdd} style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '8px 14px', borderRadius: 8, border: 'none',
          background: C.primary, color: '#fff', cursor: 'pointer',
          fontFamily: FONT, fontSize: 13, fontWeight: 600,
        }}>
          <Plus size={14} /> Add field
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 32px' }}>
        {(!fields || fields.length === 0) ? (
          <div style={{ textAlign: 'center', color: C.textMuted, fontSize: 14, marginTop: 60 }}>
            No custom fields yet. Click "Add field" to create one.
          </div>
        ) : (
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT, fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--c-hover)' }}>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: C.textSecondary, borderBottom: `1px solid ${C.border}` }}>Field</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: C.textSecondary, borderBottom: `1px solid ${C.border}` }}>Type</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: C.textSecondary, borderBottom: `1px solid ${C.border}` }}>Description</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: C.textSecondary, borderBottom: `1px solid ${C.border}` }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {fields.map(f => (
                  <tr key={f.id} style={{ background: 'var(--c-cardBg)', borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: '12px 16px', fontWeight: 600, color: C.text }}>{f.name}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{
                        display: 'inline-block', padding: '2px 8px', borderRadius: 4,
                        background: 'var(--c-hover)', color: C.textSecondary, fontSize: 12, fontWeight: 600,
                      }}>{FIELD_TYPE_LABEL[f.field_type] || f.field_type}</span>
                    </td>
                    <td style={{ padding: '12px 16px', color: C.textSecondary }}>{f.description || '—'}</td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      <button onClick={() => openEdit(f)} style={{
                        border: 'none', background: 'transparent', cursor: 'pointer',
                        color: C.purple, fontSize: 12, fontWeight: 600, marginRight: 12,
                      }}>Edit</button>
                      <button onClick={() => setDeleteModal({ open: true, id: f.id })} style={{
                        border: 'none', background: 'transparent', cursor: 'pointer',
                        color: C.primary, fontSize: 12, fontWeight: 600,
                      }}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <DeleteConfirmModal
        open={deleteModal.open}
        title="Delete Field"
        message="Are you sure you want to delete this field? Existing values stored on contacts will no longer be shown."
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteModal({ open: false, id: null })}
      />

      {showAdd && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 200, fontFamily: FONT,
        }}>
          <div style={{
            background: C.cardBg, borderRadius: 14,
            padding: '24px 24px 20px', width: 420, boxShadow: C.shadowLg,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{editing ? 'Edit Field' : 'Add Field'}</div>
              <button onClick={() => { setShowAdd(false); setEditing(null); }} style={{
                border: 'none', background: 'transparent', cursor: 'pointer', color: C.textMuted,
              }}><X size={18} /></button>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.textSecondary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Field Name</label>
              <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Company"
                onKeyDown={e => e.key === 'Enter' && handleSave()}
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 8,
                  border: `1px solid ${C.border}`, fontSize: 14, fontFamily: FONT,
                  color: C.text, outline: 'none', boxSizing: 'border-box',
                }} />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.textSecondary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Type</label>
              <select value={fieldType} onChange={e => setFieldType(e.target.value)}
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 8,
                  border: `1px solid ${C.border}`, fontSize: 14, fontFamily: FONT,
                  color: C.text, outline: 'none', background: 'var(--c-cardBg)', cursor: 'pointer',
                }}>
                {FIELD_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            <div style={{ marginBottom: 22 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.textSecondary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Description <span style={{ fontWeight: 400, textTransform: 'none', color: C.textMuted }}>(optional)</span></label>
              <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Shown as a hint when entering a value"
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 8,
                  border: `1px solid ${C.border}`, fontSize: 14, fontFamily: FONT,
                  color: C.text, outline: 'none', boxSizing: 'border-box',
                }} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={() => { setShowAdd(false); setEditing(null); }} disabled={saving} style={{ padding: '8px 16px', background: 'var(--c-cardBg)', color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}>Cancel</button>
              <button onClick={handleSave} disabled={saving} style={{ padding: '8px 16px', background: C.primary, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: saving ? 'wait' : 'pointer', fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 6 }}>
                {saving && <Loader2 size={14} className="spin" />}
                {editing ? 'Save changes' : 'Create field'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Users (admin-only multi-user management)                           */
/* ------------------------------------------------------------------ */
function RoleBadge({ role }) {
  const isAdmin = role === 'admin';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700,
      background: isAdmin ? '#EEF2FF' : '#ECFDF5',
      color: isAdmin ? '#4338CA' : '#047857',
    }}>
      <Shield size={11} /> {ROLE_LABEL[role] || role}
    </span>
  );
}

function UsersTab({ currentUser }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleteModal, setDeleteModal] = useState({ open: false, user: null });
  const [cred, setCred] = useState(null); // { username, password } shown once

  const blank = { displayName: '', username: '', email: '', role: 'bda_sales', password: '', isActive: true };
  const [form, setForm] = useState(blank);

  const load = async () => {
    setLoading(true);
    try {
      setUsers(await api.users.list());
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const openAdd = () => { setEditing(null); setForm(blank); setShowForm(true); };
  const openEdit = (u) => {
    setEditing(u);
    setForm({ displayName: u.displayName || '', username: u.username, email: u.email, role: u.role, password: '', isActive: u.isActive !== false });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.displayName.trim()) { alert('Display name is required'); return; }
    if (!editing && (!form.username.trim() || !form.email.trim())) { alert('Username and email are required'); return; }
    setSaving(true);
    try {
      if (editing) {
        await api.users.update(editing.id, {
          displayName: form.displayName.trim(),
          email: form.email.trim(),
          role: form.role,
          isActive: form.isActive,
        });
      } else {
        const created = await api.users.create({
          username: form.username.trim(),
          email: form.email.trim(),
          displayName: form.displayName.trim(),
          role: form.role,
          password: form.password.trim() || undefined,
        });
        // Show the (possibly generated) password once.
        setCred({ username: created.username, password: created.password });
      }
      await load();
      setShowForm(false);
      setEditing(null);
    } catch (err) {
      alert('Failed to save user: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (u) => {
    try {
      await api.users.update(u.id, { isActive: !(u.isActive !== false) });
      await load();
    } catch (err) { alert('Failed: ' + err.message); }
  };

  const resetPassword = async (u) => {
    if (!window.confirm(`Reset password for ${u.displayName || u.username}? A new password will be generated.`)) return;
    try {
      const r = await api.users.resetPassword(u.id);
      setCred({ username: u.username, password: r.password });
    } catch (err) { alert('Failed to reset password: ' + err.message); }
  };

  const handleDelete = async () => {
    try {
      await api.users.delete(deleteModal.user.id);
      await load();
      setDeleteModal({ open: false, user: null });
    } catch (err) { alert('Failed to delete user: ' + err.message); }
  };

  const inputStyle = {
    width: '100%', padding: '10px 12px', borderRadius: 8,
    border: `1px solid ${C.border}`, fontSize: 14, fontFamily: FONT,
    color: C.text, outline: 'none', boxSizing: 'border-box', background: 'var(--c-cardBg)',
  };
  const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: C.textSecondary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '20px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${C.border}` }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: 0, letterSpacing: '-.02em', fontFamily: FONT }}>Users</h1>
          <p style={{ fontSize: 12, color: C.textMuted, margin: '4px 0 0', fontFamily: FONT }}>
            Create admin and sales users. Sales users see only the chats &amp; contacts assigned to them.
          </p>
        </div>
        <button onClick={openAdd} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8,
          border: 'none', background: C.primary, color: '#fff', cursor: 'pointer',
          fontFamily: FONT, fontSize: 13, fontWeight: 600,
        }}>
          <Plus size={14} /> Add user
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 32px' }}>
        {error && <div style={{ padding: 12, background: '#FEF2F2', color: '#991B1B', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{error}</div>}
        {loading ? (
          <div style={{ textAlign: 'center', color: C.textMuted, fontSize: 14, marginTop: 60 }}>Loading…</div>
        ) : (
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT, fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--c-hover)' }}>
                  {['User', 'Email', 'Role', 'Status', 'Actions'].map((h, i) => (
                    <th key={h} style={{ padding: '12px 16px', textAlign: i === 4 ? 'right' : 'left', fontWeight: 600, color: C.textSecondary, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map(u => {
                  const isSelf = String(u.id) === String(currentUser?.id);
                  return (
                    <tr key={u.id} style={{ background: 'var(--c-cardBg)', borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ fontWeight: 600, color: C.text }}>{u.displayName || u.username}{isSelf && <span style={{ color: C.textMuted, fontWeight: 500 }}> (you)</span>}</div>
                        <div style={{ fontSize: 12, color: C.textMuted }}>@{u.username}</div>
                      </td>
                      <td style={{ padding: '12px 16px', color: C.textSecondary }}>{u.email}</td>
                      <td style={{ padding: '12px 16px' }}><RoleBadge role={u.role} /></td>
                      <td style={{ padding: '12px 16px' }}>
                        <button onClick={() => !isSelf && toggleActive(u)} disabled={isSelf}
                          title={isSelf ? "You can't disable yourself" : 'Toggle active'}
                          style={{
                            padding: '2px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700, border: 'none',
                            cursor: isSelf ? 'default' : 'pointer',
                            background: u.isActive !== false ? '#ECFDF5' : '#F3F4F6',
                            color: u.isActive !== false ? '#047857' : '#6B7280',
                          }}>
                          {u.isActive !== false ? 'Active' : 'Disabled'}
                        </button>
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button onClick={() => openEdit(u)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: C.purple, fontSize: 12, fontWeight: 600, marginRight: 12 }}>Edit</button>
                        <button onClick={() => resetPassword(u)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: C.textSecondary, fontSize: 12, fontWeight: 600, marginRight: 12 }}>Reset password</button>
                        <button onClick={() => setDeleteModal({ open: true, user: u })} disabled={isSelf}
                          style={{ border: 'none', background: 'transparent', cursor: isSelf ? 'not-allowed' : 'pointer', color: isSelf ? C.textMuted : C.primary, fontSize: 12, fontWeight: 600, opacity: isSelf ? 0.5 : 1 }}>Delete</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <DeleteConfirmModal
        open={deleteModal.open}
        title="Delete User"
        message={`Delete ${deleteModal.user?.displayName || deleteModal.user?.username}? They will lose access immediately. Contacts assigned to them remain but become unassigned in their view.`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteModal({ open: false, user: null })}
      />

      {/* Add / Edit modal */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, fontFamily: FONT }}>
          <div style={{ background: C.cardBg, borderRadius: 14, padding: '24px 24px 20px', width: 440, maxHeight: '88vh', overflowY: 'auto', boxShadow: C.shadowLg }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{editing ? 'Edit User' : 'Add User'}</div>
              <button onClick={() => { setShowForm(false); setEditing(null); }} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: C.textMuted }}><X size={18} /></button>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Display Name</label>
              <input autoFocus value={form.displayName} onChange={e => setForm({ ...form, displayName: e.target.value })} placeholder="e.g. Priya Sharma" style={inputStyle} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <label style={labelStyle}>Username</label>
                <input value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} placeholder="priya" readOnly={!!editing} title={editing ? 'Username cannot be changed' : ''} style={{ ...inputStyle, opacity: editing ? 0.6 : 1 }} />
              </div>
              <div>
                <label style={labelStyle}>Role</label>
                <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} style={{ ...inputStyle, cursor: 'pointer' }}>
                  {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Email</label>
              <input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="priya@company.com" style={inputStyle} />
            </div>
            {!editing && (
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Password <span style={{ fontWeight: 400, textTransform: 'none', color: C.textMuted }}>(optional — auto-generated if blank)</span></label>
                <input value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="Leave blank to generate" style={inputStyle} />
              </div>
            )}
            {editing && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, fontSize: 13, color: C.text, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} />
                Account active
              </label>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 6 }}>
              <button onClick={() => { setShowForm(false); setEditing(null); }} disabled={saving} style={{ padding: '8px 16px', background: 'var(--c-cardBg)', color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}>Cancel</button>
              <button onClick={save} disabled={saving} style={{ padding: '8px 16px', background: C.primary, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: saving ? 'wait' : 'pointer', fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 6 }}>
                {saving && <Loader2 size={14} className="spin" />}
                {editing ? 'Save changes' : 'Create user'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* One-time credentials modal */}
      {cred && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 250, fontFamily: FONT }}>
          <div style={{ background: C.cardBg, borderRadius: 14, padding: 24, width: 420, boxShadow: C.shadowLg }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 6 }}>User credentials</div>
            <div style={{ fontSize: 13, color: C.textSecondary, marginBottom: 16 }}>
              Share these with the user now — the password won’t be shown again.
            </div>
            <div style={{ background: 'var(--c-hover)', borderRadius: 10, padding: 14, marginBottom: 18, fontFamily: MONO, fontSize: 13 }}>
              <div style={{ marginBottom: 8 }}><span style={{ color: C.textMuted }}>Username:</span> <strong>{cred.username}</strong></div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span><span style={{ color: C.textMuted }}>Password:</span> <strong>{cred.password}</strong></span>
                <button onClick={() => { navigator.clipboard?.writeText(`${cred.username} / ${cred.password}`); }} title="Copy" style={{ border: `1px solid ${C.border}`, background: 'var(--c-cardBg)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', color: C.textSecondary }}><Copy size={13} /></button>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => setCred(null)} style={{ padding: '8px 18px', background: C.primary, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const thStyle = { textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 700, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.04em' };
const tdStyle = { padding: '14px 16px', fontSize: 13, color: C.text, verticalAlign: 'middle' };
const iconBtnStyle = { background: 'transparent', border: 'none', cursor: 'pointer', padding: 6, marginLeft: 4, color: C.textSecondary };

/*  Main Page                                                          */
/* ------------------------------------------------------------------ */
export default function AdminSettingsPage({ onLogout, onNavigate, subParts = [], navigate, user }) {
  const VALID_TABS = ['general', 'tags', 'category', 'fields', 'whatsapp-accounts', 'users'];
  // Admins see every tab; other roles see only tabs granted by their pages
  // (e.g. Sales users get General only).
  const visibleTabs = (user?.role === 'admin' || !Array.isArray(user?.pages))
    ? TABS
    : TABS.filter(t => user.pages.includes(`admin-settings:${t.key}`));
  const allowedTabKeys = visibleTabs.map(t => t.key);
  const requestedTab = VALID_TABS.includes(subParts[0]) ? subParts[0] : 'general';
  const activeTab = allowedTabKeys.includes(requestedTab) ? requestedTab : (allowedTabKeys[0] || 'general');
  const setActiveTab = (t) => navigate ? navigate('admin-settings', t) : null;
  const [categories, setCategories] = useState([]);
  const [tags, setTags] = useState([]);
  const [fields, setFields] = useState([]);
  const [loading, setLoading] = useState(true);
  const [categoryDetailId, setCategoryDetailId] = useState(null);
  const [showCategoryAddForm, setShowCategoryAddForm] = useState(false);

  const refresh = async () => {
    try {
      const [catRes, tagRes, fieldRes] = await Promise.all([
        api.categories.list(),
        api.tags.list(),
        api.contactFields.list().catch(() => []),
      ]);
      setCategories(catRes);
      setTags(tagRes);
      setFields(fieldRes);
    } catch (err) {
      console.error('Failed to load settings data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleTabChange = (key) => {
    setActiveTab(key);
    setCategoryDetailId(null);
  };

  const handleRequestAddCategory = () => {
    setShowCategoryAddForm(true);
    setActiveTab('category');
  };

  const renderTab = () => {
    if (loading) {
      return (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textMuted, fontSize: 14 }}>
          Loading…
        </div>
      );
    }
    switch (activeTab) {
      case 'general': return <GeneralTab onLogout={onLogout} user={user} />;
      case 'tags': return (
        <TagsTab
          categories={categories}
          tags={tags}
          onRefresh={refresh}
        />
      );
      case 'category': return (
        <CategoryTab
          categories={categories}
          tags={tags}
          onRefresh={refresh}
          detailId={categoryDetailId}
          onViewDetail={setCategoryDetailId}
          onBack={() => setCategoryDetailId(null)}
          showAddForm={showCategoryAddForm}
          onAddFormShown={() => setShowCategoryAddForm(false)}
        />
      );
      case 'fields': return <FieldsTab fields={fields} onRefresh={refresh} />;
      case 'whatsapp-accounts': return <WhatsappAccountsTab />;
      case 'users': return <UsersTab currentUser={user} />;
      default: return <GeneralTab onLogout={onLogout} user={user} />;
    }
  };

  return (
    <div style={{ display: 'flex', flex: 1, height: '100%', overflow: 'hidden', background: C.pageBg }}>
      <div style={{
        width: 240, minWidth: 240, background: 'var(--c-cardBg)',
        borderRight: `1px solid ${C.borderDark}`,
        display: 'flex', flexDirection: 'column', flexShrink: 0,
        padding: '16px 12px',
      }}>
        <button
          onClick={() => onNavigate('chats')}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 10px', marginBottom: 16, borderRadius: 8,
            border: 'none', background: 'transparent', cursor: 'pointer',
            fontFamily: FONT, fontSize: 13, fontWeight: 600,
            color: C.textSecondary, textAlign: 'left',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#f0f2f5'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
        >
          <ArrowLeft size={16} /> Back to home
        </button>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12, paddingLeft: 8 }}>
          Settings
        </div>
        {visibleTabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => handleTabChange(tab.key)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 10px', borderRadius: 8, border: 'none',
                background: isActive ? '#f0f2f5' : 'transparent',
                cursor: 'pointer', fontFamily: FONT, fontSize: 13,
                fontWeight: isActive ? 700 : 500,
                color: isActive ? C.text : C.textSecondary,
                textAlign: 'left', marginBottom: 2, transition: 'background .1s',
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = '#f5f6f6'; }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
            >
              <Icon size={16} strokeWidth={isActive ? 2.5 : 2} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {renderTab()}
    </div>
  );
}
