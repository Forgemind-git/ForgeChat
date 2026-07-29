import { useState, useEffect } from 'react';
import { Search, User } from 'lucide-react';
import { usePolling } from '../hooks/usePolling.js';
import { api } from '../api.js';
import { C, FONT, relativeTime, maskPhone, darkenColor } from '../constants.js';
import TagMultiSelect from './TagMultiSelect.jsx';

export default function ContactList({ waNumber, width = 380, selectedContact, onSelectContact, refreshKey, user }) {
  const [search, setSearch] = useState('');
  const [categories, setCategories] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const [filterTagIds, setFilterTagIds] = useState([]);
  const [waName, setWaName] = useState(null); // saved display name for this business number

  // Resolve the saved display name for this WhatsApp number (shown in header).
  useEffect(() => {
    let alive = true;
    setWaName(null);
    api.numbers().then(nums => {
      if (!alive) return;
      const m = (nums || []).find(n => n.wa_number === waNumber);
      setWaName(m?.display_name || null);
    }).catch(() => {});
    return () => { alive = false; };
  }, [waNumber]);
  // Polling refresh (every 30s).
  const { data, loading, refetch } = usePolling(() => api.contacts(waNumber, '30d'), 30000);

  // Tag taxonomy for the filter dropdown.
  useEffect(() => {
    api.categories.list().then(setCategories).catch(() => {});
    api.tags.list().then(setAllTags).catch(() => {});
  }, []);

  useEffect(() => {
    if (refreshKey) refetch();
  }, [refreshKey, refetch]);

  const contacts = (data || []).filter(c => {
    const matchesSearch = !search || c.contact_number.includes(search) || (c.name && c.name.toLowerCase().includes(search.toLowerCase()));
    if (!matchesSearch) return false;
    // Tag filter (OR): contact matches if it has ANY selected tag.
    if (filterTagIds.length > 0) {
      const ids = (c.tags || []).map(t => String(t.id));
      if (!filterTagIds.some(id => ids.includes(String(id)))) return false;
    }
    return true;
  });

  const getDisplayName = (c) => c.name || `+${maskPhone(c.contact_number)}`;

  const getInitials = (name) => {
    if (!name) return '';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  };

  return (
    <div style={{
      width, minWidth: width,
      background: 'var(--c-cardBg)',
      borderRight: `1px solid ${C.borderDark}`,
      display: 'flex', flexDirection: 'column',
      flexShrink: 0, height: '100%', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        background: 'var(--c-chatPanel)',
        borderBottom: `1px solid ${C.borderDark}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: C.text, fontFamily: FONT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {waName || maskPhone(waNumber) || 'Contacts'}
          </span>
          <span style={{ fontSize: 12, color: C.textMuted, fontFamily: FONT }}>
            {contacts.length} contacts
          </span>
        </div>
      </div>

      {/* Search + tag filter */}
      <div style={{ padding: '8px 12px', background: 'var(--c-cardBg)', borderBottom: `1px solid ${C.borderDark}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'var(--c-chatPanel)', borderRadius: 8,
          padding: '6px 12px',
        }}>
          <Search size={16} color={C.textMuted} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by phone..."
            style={{
              flex: 1, border: 'none', background: 'transparent',
              fontSize: 14, fontFamily: FONT, outline: 'none', color: C.text,
            }}
          />
        </div>
        <TagMultiSelect
          categories={categories}
          tags={allTags}
          selectedIds={filterTagIds}
          onChange={setFilterTagIds}
          minWidth="100%"
          placeholder="Filter by tag"
        />
      </div>

      {/* Contact list */}
      <div style={{ flex: 1, overflowY: 'auto', background: 'var(--c-cardBg)' }}>
        {loading && !data && (
          <div style={{ padding: 30, textAlign: 'center', color: C.textMuted, fontSize: 13 }}>
            Loading chats...
          </div>
        )}

        {contacts.map(c => {
          const isActive = selectedContact === c.contact_number;
          const contactTags = c.tags || [];
          const displayName = getDisplayName(c);
          const unread = Number(c.unread_count) || 0;

          return (
            <button
              key={c.contact_number}
              onClick={() => onSelectContact(c.contact_number)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 16px',
                border: 'none',
                borderBottom: `1px solid ${C.border}`,
                cursor: 'pointer',
                background: isActive ? '#f0f2f5' : 'var(--c-cardBg)',
                fontFamily: FONT,
                textAlign: 'left',
                transition: 'background .1s',
                position: 'relative',
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = '#f5f6f6'; }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = '#ffffff'; }}
            >
              {/* Active indicator */}
              {isActive && (
                <div style={{
                  position: 'absolute', left: 0, top: 0, bottom: 0,
                  width: 4, background: C.primary,
                }} />
              )}

              {/* Avatar */}
              <div style={{
                width: 48, height: 48, borderRadius: '50%',
                background: isActive ? C.primary : '#dfe5e7',
                color: isActive ? '#fff' : '#54656f',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, fontWeight: 700, flexShrink: 0,
              }}>
                {c.name ? getInitials(c.name) : <User size={20} />}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{
                    fontSize: 15, fontWeight: 600, color: C.text,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {displayName}
                  </span>
                  <span style={{
                    fontSize: 11, color: c.message_count > 0 ? C.primary : C.textMuted,
                    flexShrink: 0, marginLeft: 8,
                  }}>
                    {relativeTime(c.last_message_time)}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                  <span style={{
                    fontSize: 13, color: unread > 0 && !isActive ? C.text : C.textSecondary,
                    fontWeight: unread > 0 && !isActive ? 600 : 400,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0,
                  }}>
                    {c.last_message || 'No messages'}
                  </span>
                  {unread > 0 && !isActive && (
                    <span style={{
                      flexShrink: 0,
                      background: '#25D366', color: '#fff',
                      borderRadius: 11, minWidth: 20, height: 20, padding: '0 6px',
                      fontSize: 12, fontWeight: 700,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {unread > 99 ? '99+' : unread}
                    </span>
                  )}
                </div>
                {contactTags.length > 0 && (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2, alignItems: 'center' }}>
                    {contactTags.map(t => (
                      <span key={t.id} style={{
                        display: 'inline-flex',
                        alignSelf: 'flex-start',
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: darkenColor(t.color),
                        color: '#fff',
                        border: `1px solid ${darkenColor(t.color)}`,
                        fontSize: 9,
                        fontWeight: 700,
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                      }}>
                        {t.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </button>
          );
        })},

        {contacts.length === 0 && !loading && (
          <div style={{ padding: 40, textAlign: 'center', color: C.textMuted, fontSize: 13 }}>
            No chats found
          </div>
        )}
      </div>
    </div>
  );
}
