import { useState, useEffect, useCallback } from 'react';
import { ChevronRight } from 'lucide-react';
import NumberSidebar from './NumberSidebar.jsx';
import ContactList from './ContactList.jsx';
import ChatWindow from './ChatWindow.jsx';
import { C } from '../constants.js';

const MIN_CONTACT_W = 280;
const MAX_CONTACT_W = 620;
const DEFAULT_CONTACT_W = 380;
const LS_WIDTH = 'forgecrm.chats.contactWidth';
const LS_COLLAPSED = 'forgecrm.chats.navCollapsed';

export default function ChatsPage({ subParts = [], navigate, user }) {
  // Selection lives in component state, NOT the URL, so customer/business phone
  // numbers never appear in the address bar (consistent with phone masking).
  const [selectedNumber, setSelectedNumber] = useState(subParts[0] || null);
  const [selectedContact, setSelectedContact] = useState(subParts[1] || null);
  const [contactRefreshKey, setContactRefreshKey] = useState(0);

  // A deep-link like #/chats/<wa>/<contact> still opens that chat once (state is
  // seeded above), then we scrub the numbers out of the hash → URL stays #/chats.
  useEffect(() => {
    if (subParts.length > 0) window.history.replaceState(null, '', '#/chats');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persisted UI prefs — read once on mount, written back on change.
  const [navCollapsed, setNavCollapsed] = useState(
    () => localStorage.getItem(LS_COLLAPSED) === '1'
  );
  const [contactWidth, setContactWidth] = useState(() => {
    const v = parseInt(localStorage.getItem(LS_WIDTH), 10);
    return Number.isFinite(v) ? Math.min(MAX_CONTACT_W, Math.max(MIN_CONTACT_W, v)) : DEFAULT_CONTACT_W;
  });

  useEffect(() => { localStorage.setItem(LS_COLLAPSED, navCollapsed ? '1' : '0'); }, [navCollapsed]);
  useEffect(() => { localStorage.setItem(LS_WIDTH, String(contactWidth)); }, [contactWidth]);

  const selectNumber = (n) => { setSelectedNumber(n); setSelectedContact(null); };
  const selectContact = (c) => setSelectedContact(c);

  // Drag the divider to resize the contacts list; the chat window (flex:1) takes the rest.
  const startResize = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = contactWidth;
    const onMove = (ev) => {
      const next = Math.min(MAX_CONTACT_W, Math.max(MIN_CONTACT_W, startW + (ev.clientX - startX)));
      setContactWidth(next);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [contactWidth]);

  return (
    <div style={{ display: 'flex', flex: 1, height: '100%', overflow: 'hidden', background: C.pageBg }}>
      {navCollapsed ? (
        <div style={{
          width: 48, minWidth: 48, flexShrink: 0,
          background: 'var(--c-cardBg)', borderRight: `1px solid ${C.borderDark}`,
          display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 14,
        }}>
          <button
            onClick={() => setNavCollapsed(false)}
            title="Show team members"
            style={{
              width: 34, height: 34, borderRadius: 8, border: 'none',
              background: 'var(--c-chatPanel)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.text,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#e4e7e9'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#f0f2f5'; }}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      ) : (
        <NumberSidebar
          selectedNumber={selectedNumber}
          onSelectNumber={selectNumber}
          onCollapse={() => setNavCollapsed(true)}
        />
      )}

      {selectedNumber && (
        <>
          <ContactList
            key={selectedNumber}
            waNumber={selectedNumber}
            width={contactWidth}
            selectedContact={selectedContact}
            onSelectContact={selectContact}
            refreshKey={contactRefreshKey}
            user={user}
          />
          {/* Drag handle: resize contacts list ⇄ chat window */}
          <div
            onMouseDown={startResize}
            title="Drag to resize"
            style={{
              width: 6, minWidth: 6, flexShrink: 0, cursor: 'col-resize',
              background: 'transparent', zIndex: 5, alignSelf: 'stretch',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = C.primary + '33'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          />
        </>
      )}

      {selectedContact ? (
        <ChatWindow
          key={`${selectedNumber}-${selectedContact}`}
          waNumber={selectedNumber}
          contactNumber={selectedContact}
          onContactSaved={() => setContactRefreshKey(k => k + 1)}
        />
      ) : (
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: C.textMuted,
          fontSize: 14,
          background: 'var(--c-chatPanel)',
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>💬</div>
            <div>Select a contact to view chat</div>
          </div>
        </div>
      )}
    </div>
  );
}
