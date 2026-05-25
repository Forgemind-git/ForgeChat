import {
  Home, Zap, LayoutTemplate, MessageCircle, Users,
  Megaphone, Image as ImageIcon, Info, KanbanSquare,
} from 'lucide-react';
import { C, FONT } from '../constants.js';

const NAV_ITEMS = [
  { id: 'home', label: 'Home', Icon: Home },
  { id: 'chatbot-builder', label: 'Automations', Icon: Zap },
  { id: 'template-builder', label: 'Template Builder', Icon: LayoutTemplate },
  { id: 'media-library', label: 'Media', Icon: ImageIcon },
  { id: 'chats', label: 'Chats', Icon: MessageCircle },
  { id: 'contacts', label: 'Contacts', Icon: Users },
  { id: 'pipelines', label: 'Pipelines', Icon: KanbanSquare },
  { id: 'bulk-message', label: 'Bulk Message', Icon: Megaphone },
  { id: 'about', label: 'About Us', Icon: Info },
];

export default function Sidebar({ activePage, onPageChange, collapsed, setCollapsed, user }) {
  // Admins see every nav item; other roles see only the pages granted to them
  // (user.pages from the session). Falls back to all items if pages is missing.
  const visibleItems = (user?.role === 'admin' || !Array.isArray(user?.pages))
    ? NAV_ITEMS
    : NAV_ITEMS.filter(item => user.pages.includes(item.id));
  return (
    <div style={{
      width: collapsed ? 68 : 224,
      minHeight: '100%',
      background: C.sidebarBg,
      borderRight: `1px solid ${C.sidebarBorder}`,
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      transition: 'width .25s ease',
      overflow: 'hidden',
      position: 'relative',
    }}>
      {/* Nav items */}
      <div style={{ padding: collapsed ? '10px 8px' : '14px 10px', flex: 1 }}>
        {visibleItems.map(item => {
          const active = activePage === item.id;
          return (
            <div
              key={item.id}
              onClick={() => onPageChange(item.id)}
              title={collapsed ? item.label : ''}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: collapsed ? 0 : 11,
                padding: collapsed ? '11px 0' : '10px 12px',
                borderRadius: 10,
                cursor: 'pointer',
                transition: 'all .15s',
                marginBottom: 2,
                background: active ? C.primary : 'transparent',
                color: active ? '#fff' : '#111',
                justifyContent: collapsed ? 'center' : 'flex-start',
                fontFamily: FONT,
                fontSize: 13,
                fontWeight: active ? 700 : 500,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                userSelect: 'none',
              }}
              onMouseEnter={e => {
                if (!active) {
                  e.currentTarget.style.background = '#EFEEE6';
                  e.currentTarget.style.color = '#111';
                }
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = active ? C.primary : 'transparent';
                e.currentTarget.style.color = active ? '#fff' : '#111';
              }}
            >
              <span style={{
                width: 20,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                opacity: active ? 1 : 0.75,
              }}>
                <item.Icon size={16} />
              </span>
              {!collapsed && <span style={{ letterSpacing: '-.01em' }}>{item.label}</span>}
            </div>
          );
        })}
      </div>

      {/* Collapse button + watermark */}
      <div style={{ borderTop: `1px solid #F0F0EA` }}>
        <div
          onClick={() => setCollapsed(p => !p)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: collapsed ? '12px 0' : '11px 14px',
            cursor: 'pointer',
            justifyContent: collapsed ? 'center' : 'flex-start',
            transition: 'background .15s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = '#EFEEE6'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <span style={{ fontSize: 13, color: '#888', fontWeight: 600, lineHeight: 1 }}>
            {collapsed ? '›' : '‹'}
          </span>
          {!collapsed && (
            <span style={{ fontSize: 12, fontWeight: 600, color: '#888', fontFamily: FONT }}>
              Collapse
            </span>
          )}
        </div>
        {!collapsed && (
          <div style={{ padding: '0 14px 10px' }}>
            <span style={{
              fontSize: 9,
              fontWeight: 600,
              color: '#ccc',
              fontFamily: FONT,
              letterSpacing: '.06em',
              textTransform: 'uppercase',
            }}>
              Powered by FMOS
            </span>
          </div>
        )}
        {collapsed && (
          <div style={{ padding: '0 0 8px', textAlign: 'center' }}>
            <span style={{
              fontSize: 7,
              fontWeight: 600,
              color: '#ddd',
              fontFamily: FONT,
              letterSpacing: '.04em',
              textTransform: 'uppercase',
            }}>
              FMOS
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
