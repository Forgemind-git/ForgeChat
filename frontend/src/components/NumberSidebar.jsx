import { useState } from 'react';
import { Search, ChevronLeft } from 'lucide-react';
import { usePolling } from '../hooks/usePolling.js';
import { api } from '../api.js';
import { C, FONT, maskPhone } from '../constants.js';

export default function NumberSidebar({ selectedNumber, onSelectNumber, onCollapse }) {
  const [search, setSearch] = useState('');
  // Polling refresh (every 30s).
  const { data: numbers, loading } = usePolling(() => api.numbers(), 30000);

  const filtered = (numbers || []).filter(n =>
    !search || n.wa_number.includes(search) || (n.display_name && n.display_name.toLowerCase().includes(search.toLowerCase()))
  );

  const getInitials = (name) => {
    if (!name) return '';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  };

  return (
    <aside style={{
      width: 320,
      minWidth: 320,
      background: 'var(--c-cardBg)',
      borderRight: `1px solid ${C.borderDark}`,
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      height: '100%',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        background: 'var(--c-chatPanel)',
        borderBottom: `1px solid ${C.borderDark}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: C.text, fontFamily: FONT, letterSpacing: '-0.01em' }}>
          Team Members
        </span>
        <button
          onClick={onCollapse}
          title="Hide team members"
          style={{
            width: 32, height: 32, borderRadius: 8, border: 'none',
            background: 'transparent', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: C.textMuted,
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#e4e7e9'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
        >
          <ChevronLeft size={18} />
        </button>
      </div>

      {/* Search */}
      <div style={{ padding: '8px 12px', background: 'var(--c-cardBg)', borderBottom: `1px solid ${C.borderDark}` }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'var(--c-chatPanel)', borderRadius: 8,
          padding: '6px 12px',
        }}>
          <Search size={16} color={C.textMuted} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search team members..."
            style={{
              flex: 1, border: 'none', background: 'transparent',
              fontSize: 14, fontFamily: FONT, outline: 'none', color: C.text,
            }}
          />
        </div>
      </div>

      {/* Numbers list */}
      <div style={{ flex: 1, overflowY: 'auto', background: 'var(--c-cardBg)' }}>
        {loading && !numbers && (
          <div style={{ padding: 30, textAlign: 'center', color: C.textMuted, fontSize: 13 }}>
            Loading team members...
          </div>
        )}

        {filtered.map(n => {
          const isActive = selectedNumber === n.wa_number;
          const displayName = n.display_name || maskPhone(n.wa_number);
          const hasPicture = n.profile_picture_url;
          const unread = Number(n.unread_chats) || 0;

          return (
            <button
              key={n.wa_number}
              onClick={() => onSelectNumber(n.wa_number)}
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
                width: 44, height: 44, borderRadius: '50%',
                background: hasPicture ? 'transparent' : (isActive ? C.primary : '#dfe5e7'),
                color: isActive ? '#fff' : '#54656f',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, fontWeight: 700, flexShrink: 0,
                overflow: 'hidden',
                position: 'relative',
              }}>
                {hasPicture ? (
                  <img
                    src={n.profile_picture_url}
                    alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={e => { e.target.style.display = 'none'; e.target.parentElement.style.background = isActive ? C.primary : '#dfe5e7'; }}
                  />
                ) : (
                  <span>{getInitials(displayName)}</span>
                )}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{
                    fontSize: 15, fontWeight: 600, color: C.text,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {displayName}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{
                    fontSize: 13, color: C.textSecondary,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {maskPhone(n.wa_number)}
                  </span>
                </div>
              </div>

              {/* Unread chats badge */}
              {unread > 0 && (
                <span
                  title={`${unread} unread chat${unread === 1 ? '' : 's'}`}
                  style={{
                    flexShrink: 0,
                    background: '#25D366', color: '#fff',
                    borderRadius: 11, minWidth: 22, height: 22, padding: '0 7px',
                    fontSize: 12, fontWeight: 700,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </button>
          );
        })}

        {filtered.length === 0 && !loading && (
          <div style={{ padding: 40, textAlign: 'center', color: C.textMuted, fontSize: 13 }}>
            No team members found
          </div>
        )}
      </div>
    </aside>
  );
}
