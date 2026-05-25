import { useState, useEffect, useCallback, useRef } from 'react';
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

// Keep the chat window usable no matter how wide the contacts panel is dragged.
const NUM_W_EXPANDED = 320;   // NumberSidebar width when shown
const NUM_W_COLLAPSED = 48;   // NumberSidebar width when collapsed
const RESIZE_HANDLE_W = 6;    // the drag divider
const MIN_CHAT_W = 360;       // chat window never renders narrower than this

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

  // Track the live width of the chats area so we can keep the chat window usable
  // regardless of how wide the contacts panel was dragged (or restored from
  // localStorage on a now-smaller window). The user's preferred width is kept in
  // `contactWidth`; we only clamp what we *render* via `effectiveContactW`.
  const rootRef = useRef(null);
  const [containerW, setContainerW] = useState(0);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(entries => setContainerW(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const numW = navCollapsed ? NUM_W_COLLAPSED : NUM_W_EXPANDED;
  // Largest contacts width that still leaves MIN_CHAT_W for the chat window.
  const fitMax = containerW > 0
    ? Math.max(MIN_CONTACT_W, containerW - numW - RESIZE_HANDLE_W - MIN_CHAT_W)
    : MAX_CONTACT_W;
  const effectiveContactW = Math.min(contactWidth, MAX_CONTACT_W, fitMax);

  const selectNumber = (n) => { setSelectedNumber(n); setSelectedContact(null); };
  const selectContact = (c) => setSelectedContact(c);

  // Drag the divider to resize the contacts list; the chat window (flex:1) takes the rest.
  const startResize = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = effectiveContactW;
    const upper = Math.min(MAX_CONTACT_W, fitMax);
    const onMove = (ev) => {
      const next = Math.min(upper, Math.max(MIN_CONTACT_W, startW + (ev.clientX - startX)));
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
  }, [effectiveContactW, fitMax]);

  return (
    <div ref={rootRef} style={{ display: 'flex', flex: 1, height: '100%', overflow: 'hidden', background: C.pageBg }}>
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
            width={effectiveContactW}
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
