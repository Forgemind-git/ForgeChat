import { FONT } from '../constants.js';
import { api } from '../api.js';

/* ── iPhone 16 frame ─────────────────────────────────────────────── */
export function PhoneFrame({ children, headerTitle = 'Your Business', headerSubtitle = 'online', minHeight = 280 }) {
  const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div style={{
      width: 278,
      background: 'linear-gradient(155deg, #D8D8DE 0%, #A6A6AD 30%, #82828A 58%, #BFBFC5 82%, #6E6E76 100%)',
      borderRadius: 52,
      padding: 3.5,
      boxShadow: '0 22px 50px rgba(0,0,0,.28), 0 4px 10px rgba(0,0,0,.10), inset 0 0 0 0.5px rgba(255,255,255,.55), inset 0 -2px 4px rgba(0,0,0,.18)',
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Side buttons */}
      <div style={{ position: 'absolute', left: 0, top: 84, width: 3, height: 30, background: 'linear-gradient(90deg,#4A4A50,#6B6B72)', borderRadius: '3px 0 0 3px' }} />
      <div style={{ position: 'absolute', left: 0, top: 130, width: 3, height: 48, background: 'linear-gradient(90deg,#4A4A50,#6B6B72)', borderRadius: '3px 0 0 3px' }} />
      <div style={{ position: 'absolute', left: 0, top: 188, width: 3, height: 48, background: 'linear-gradient(90deg,#4A4A50,#6B6B72)', borderRadius: '3px 0 0 3px' }} />
      <div style={{ position: 'absolute', right: 0, top: 130, width: 3, height: 64, background: 'linear-gradient(270deg,#4A4A50,#6B6B72)', borderRadius: '0 3px 3px 0' }} />
      <div style={{ position: 'absolute', right: 0, top: 208, width: 3, height: 38, background: 'linear-gradient(270deg,#4A4A50,#6B6B72)', borderRadius: '0 3px 3px 0' }} />

      <div style={{ background: '#000', borderRadius: 48.5, padding: 2, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', boxShadow: 'inset 0 0 0 0.5px rgba(255,255,255,.12)' }}>
        <div style={{ flex: 1, minHeight: 0, position: 'relative', borderRadius: 46.5, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#075E54' }}>

          {/* Status bar */}
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 46, padding: '14px 28px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', color: '#fff', zIndex: 5, fontFamily: "-apple-system, 'SF Pro Display', system-ui, sans-serif", fontWeight: 600, fontSize: 14, letterSpacing: '-.01em', pointerEvents: 'none' }}>
            <span style={{ minWidth: 48, textAlign: 'left' }}>{nowTime}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              {/* Signal */}
              <svg width="17" height="11" viewBox="0 0 17 11" style={{ display: 'block' }}>
                <rect x="0"  y="6.5" width="3" height="4.5" rx="0.7" fill="#fff"/>
                <rect x="4"  y="4.5" width="3" height="6.5" rx="0.7" fill="#fff"/>
                <rect x="8"  y="2.5" width="3" height="8.5" rx="0.7" fill="#fff"/>
                <rect x="12" y="0.5" width="3" height="10.5" rx="0.7" fill="#fff"/>
              </svg>
              {/* WiFi */}
              <svg width="15" height="11" viewBox="0 0 15 11" style={{ display: 'block' }}>
                <path d="M7.5 2.5 C 4 2.5, 1.5 4.5, 0.5 5.5 L 1.7 7 C 2.6 6.1, 4.6 4.5, 7.5 4.5 C 10.4 4.5, 12.4 6.1, 13.3 7 L 14.5 5.5 C 13.5 4.5, 11 2.5, 7.5 2.5 Z" fill="#fff"/>
                <path d="M7.5 5.5 C 5.5 5.5, 4 6.6, 3.3 7.4 L 4.5 8.7 C 5 8.1, 6 7.5, 7.5 7.5 C 9 7.5, 10 8.1, 10.5 8.7 L 11.7 7.4 C 11 6.6, 9.5 5.5, 7.5 5.5 Z" fill="#fff"/>
                <circle cx="7.5" cy="9.7" r="1.1" fill="#fff"/>
              </svg>
              {/* Battery */}
              <svg width="27" height="13" viewBox="0 0 27 13" style={{ display: 'block' }}>
                <rect x="0.5" y="0.5" width="23" height="12" rx="3" fill="none" stroke="#fff" strokeOpacity="0.45" strokeWidth="1"/>
                <rect x="24.5" y="4" width="1.5" height="5" rx="0.6" fill="#fff" fillOpacity="0.45"/>
                <rect x="2" y="2" width="20" height="9" rx="1.7" fill="#fff"/>
              </svg>
            </div>
          </div>

          {/* Dynamic Island */}
          <div style={{ position: 'absolute', top: 11, left: '50%', transform: 'translateX(-50%)', width: 108, height: 32, background: '#000', borderRadius: 99, zIndex: 6, boxShadow: 'inset 0 0 0 0.5px rgba(255,255,255,.08), 0 0 0 0.5px #000' }}>
            <div style={{ position: 'absolute', top: 11, right: 14, width: 9, height: 9, borderRadius: '50%', background: '#1a1a1d', boxShadow: 'inset 0 0 0 1px #050505, inset 0 0 4px rgba(80,120,200,.3)' }} />
          </div>

          {/* Chat header */}
          <div style={{ background: '#075E54', paddingTop: 50, paddingBottom: 8, paddingLeft: 12, paddingRight: 12, color: '#fff', fontFamily: "-apple-system, 'SF Pro Display', system-ui, sans-serif", flexShrink: 0, position: 'relative', zIndex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#fff', fontSize: 20, lineHeight: 1, opacity: .9, marginRight: -2 }}>‹</span>
              <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg,#1D9E75,#0F6E56)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>F</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{headerTitle}</div>
                <div style={{ fontSize: 10, opacity: .82, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{headerSubtitle}</div>
              </div>
              {/* Video */}
              <svg width="20" height="14" viewBox="0 0 20 14" style={{ display: 'block', flexShrink: 0 }}>
                <rect x="0.5" y="1.5" width="13" height="11" rx="2.5" fill="none" stroke="#fff" strokeWidth="1.4"/>
                <path d="M14 5.5 L19 3 L19 11 L14 8.5 Z" fill="none" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round"/>
              </svg>
              {/* Phone */}
              <svg width="15" height="15" viewBox="0 0 15 15" style={{ display: 'block', flexShrink: 0 }}>
                <path d="M3 1 L5 1 L6.5 4.5 L5 6 C 6 8, 7 9, 9 10 L 10.5 8.5 L 14 10 L 14 12 C 14 13, 13 14, 12 14 C 6 14, 1 9, 1 3 C 1 2, 2 1, 3 1 Z" fill="none" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round"/>
              </svg>
            </div>
          </div>

          {/* Chat body */}
          <div style={{
            flex: 1,
            minHeight,
            overflowY: 'auto',
            background: 'var(--c-chatWall)',
            padding: '10px 7px',
            backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'%3E%3Cpath d='M20 20 L25 25 M55 55 L60 60' stroke='%23D9CFC4' stroke-width='1'/%3E%3C/svg%3E\")",
          }}>
            {children}
          </div>

          {/* Input bar + home indicator */}
          <div style={{ background: 'var(--c-hover)', padding: '7px 9px 22px', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, position: 'relative' }}>
            <div style={{ flex: 1, background: 'var(--c-cardBg)', borderRadius: 99, padding: '6px 12px', fontSize: 10, color: 'var(--c-textMuted)', border: '1px solid var(--c-border)' }}>
              Message
            </div>
            <div style={{ width: 28, height: 28, background: '#25D366', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0, boxShadow: '0 1px 2px rgba(0,0,0,.15)' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22,2 15,22 11,13 2,9 22,2" fill="currentColor" stroke="none"/>
              </svg>
            </div>
            <div style={{ position: 'absolute', bottom: 6, left: '50%', transform: 'translateX(-50%)', width: 110, height: 4, background: '#111', borderRadius: 99, opacity: .85 }} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Reusable WhatsApp template preview ──────────────────────────── */
export default function WhatsAppPreview({ template, minHeight = 280, emptyText = 'Select a template\nto preview' }) {
  if (!template) {
    return (
      <PhoneFrame headerTitle="Your Business" headerSubtitle="online" minHeight={minHeight}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
          <span style={{ background: '#E1F2FA', color: '#3C6678', fontSize: 9, padding: '2px 9px', borderRadius: 99, fontWeight: 600 }}>TODAY</span>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, textAlign: 'center' }}>
          <div style={{ fontSize: 26, marginBottom: 6, opacity: 0.4 }}>💬</div>
          <div style={{ fontSize: 10, color: '#888', fontWeight: 500, lineHeight: 1.5, fontFamily: FONT, whiteSpace: 'pre-line' }}>{emptyText}</div>
        </div>
      </PhoneFrame>
    );
  }

  const buttons = template.buttons || [];

  return (
    <PhoneFrame headerTitle="Your Business" headerSubtitle="online" minHeight={minHeight}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
        <span style={{ background: '#E1F2FA', color: '#3C6678', fontSize: 9, padding: '2px 9px', borderRadius: 99, fontWeight: 600 }}>TODAY</span>
      </div>
      <div style={{ marginLeft: 'auto', maxWidth: '88%', minWidth: '55%' }}>
        <div style={{ background: '#DCF8C6', borderRadius: buttons.length > 0 ? '7.5px 7.5px 0 0' : '7.5px 7.5px 0 7.5px', padding: '6px 7px 5px 9px', boxShadow: '0 1px 0.5px rgba(11,20,26,.13)', position: 'relative', marginRight: buttons.length > 0 ? 0 : 8 }}>
          {buttons.length === 0 && (
            <div style={{ position: 'absolute', bottom: 0, right: -8, width: 0, height: 0, borderStyle: 'solid', borderWidth: '0 0 9px 9px', borderColor: 'transparent transparent #DCF8C6 transparent' }} />
          )}
          {template.header_text && template.header_type === 'TEXT' && (
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-text)', marginBottom: 4, lineHeight: 1.4, fontFamily: FONT }}>{template.header_text}</div>
          )}
          {template.body && (
            <div style={{ fontSize: 13.5, color: 'var(--c-text)', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: FONT }}>{template.body}</div>
          )}
          {template.footer && (
            <div style={{ fontSize: 11.5, color: 'var(--c-textSecondary)', marginTop: 4, fontFamily: FONT }}>{template.footer}</div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 3, marginTop: 2, marginBottom: -1 }}>
            <span style={{ fontSize: 10.5, color: 'var(--c-textSecondary)', fontFamily: FONT }}>9:41</span>
            <svg width="16" height="11" viewBox="0 0 16 11" fill="none"><path d="M1 5.5L5 9.5L11.5 1" stroke="#53BDEB" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /><path d="M5 5.5L9 9.5L15.5 1" stroke="#53BDEB" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
        </div>
        {buttons.length > 0 && (
          <div style={{ background: 'var(--c-cardBg)', borderRadius: '0 0 7.5px 7.5px', overflow: 'hidden', boxShadow: '0 1px 0.5px rgba(11,20,26,.13)' }}>
            {buttons.map((btn, i) => (
              <div key={i} style={{ padding: '9px 14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, borderTop: '1px solid rgba(0,0,0,.07)' }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: '#00A884', fontFamily: FONT }}>{btn.text || btn.type}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </PhoneFrame>
  );
}


/* ── Broadcast direct-message preview ────────────────────────────── */
export function BroadcastMessagePreview({ messageType, body, url, mediaLibraryId, caption, mediaItems, minHeight = 280 }) {
  const selected = mediaItems?.find(m => String(m.id) === String(mediaLibraryId));
  const hasMedia = !!selected;

  const renderMediaPreview = () => {
    if (!hasMedia) return null;
    const previewUrl = api.mediaLibrary.downloadUrl(selected.id);
    if (messageType === 'image') {
      return (
        <img
          src={previewUrl}
          alt={selected.name || 'Image'}
          style={{ width: '100%', borderRadius: 6, display: 'block', marginBottom: caption ? 6 : 0 }}
        />
      );
    }
    if (messageType === 'video') {
      return (
        <div style={{ position: 'relative', width: '100%', borderRadius: 6, overflow: 'hidden', marginBottom: caption ? 6 : 0 }}>
          <img
            src={previewUrl}
            alt={selected.name || 'Video'}
            style={{ width: '100%', display: 'block' }}
          />
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.35)' }}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M8 5v14l11-7z" fill="#111"/></svg>
            </div>
          </div>
        </div>
      );
    }
    if (messageType === 'audio') {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#00A884', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" fill="#fff"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" fill="#fff"/></svg>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: 'var(--c-text)', fontWeight: 500, fontFamily: FONT }}>{selected.name || 'Audio'}</div>
            <div style={{ fontSize: 10, color: 'var(--c-textSecondary)', fontFamily: FONT }}>0:00</div>
          </div>
        </div>
      );
    }
    if (messageType === 'document') {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--c-chatPanel)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" fill="#667781"/></svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: 'var(--c-text)', fontWeight: 500, fontFamily: FONT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selected.name || 'Document'}</div>
            <div style={{ fontSize: 10, color: 'var(--c-textSecondary)', fontFamily: FONT }}>{selected.mediaType?.toUpperCase?.() || 'PDF'}</div>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <PhoneFrame headerTitle="Your Business" headerSubtitle="online" minHeight={minHeight}>
      <div style={{ marginLeft: 'auto', maxWidth: '88%', minWidth: '55%' }}>
        <div style={{ background: '#DCF8C6', borderRadius: '7.5px', padding: '8px 10px', boxShadow: '0 1px 0.5px rgba(11,20,26,.13)' }}>
          {messageType === 'text' && (
            <div style={{ fontSize: 13.5, color: 'var(--c-text)', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: FONT }}>
              {body || 'Your message will appear here…'}
            </div>
          )}
          {messageType === 'link' && (
            <div style={{ fontSize: 13.5, lineHeight: 1.55, fontFamily: FONT }}>
              <a href={/^https?:\/\//i.test(String(url || '')) ? url : '#'} target="_blank" rel="noreferrer" style={{ color: '#027EB5', textDecoration: 'underline', wordBreak: 'break-all' }} onClick={e => e.preventDefault()}>
                {url || 'https://example.com'}
              </a>
            </div>
          )}
          {['image', 'video', 'audio', 'document'].includes(messageType) && (
            <div>
              {renderMediaPreview()}
              {caption && (
                <div style={{ fontSize: 13, color: 'var(--c-text)', lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: FONT, marginTop: 4 }}>
                  {caption}
                </div>
              )}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 3, marginTop: 2, marginBottom: -1 }}>
            <span style={{ fontSize: 10.5, color: 'var(--c-textSecondary)', fontFamily: FONT }}>9:41</span>
            <svg width="16" height="11" viewBox="0 0 16 11" fill="none"><path d="M1 5.5L5 9.5L11.5 1" stroke="#53BDEB" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /><path d="M5 5.5L9 9.5L15.5 1" stroke="#53BDEB" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
        </div>
      </div>
    </PhoneFrame>
  );
}
