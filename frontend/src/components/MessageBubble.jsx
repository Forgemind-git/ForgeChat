import { useState, useRef, useMemo, useEffect } from 'react';
import { Check, CheckCheck, FileText, Image as ImageIcon, Video, Music, MapPin, Phone, Download, AlertCircle, Loader2, Mic, ExternalLink, Reply, Copy, ChevronDown, Forward, Star, Info, Ban } from 'lucide-react';
import { C, CHAT, FONT, MONO, formatTime } from '../constants.js';
import { api } from '../api.js';

const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'voice', 'document', 'sticker']);

/* ── Global single-audio controller ────────────────────────────────── */
const globalAudioControllers = new Set();

function isImageMime(m) { return (m || '').startsWith('image/'); }
function formatBytes(n) {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/* WhatsApp-style inline text formatting. Renders *bold*, _italic_,
   ~strikethrough~ and ```monospace``` the same way the WhatsApp app does.
   Newlines are preserved by the container's `whiteSpace: 'pre-wrap'`, so a
   message keeps its line breaks and bullet lists instead of collapsing into
   one blob. Returns a string (no markup) or an array of nodes. */
const WA_PATTERNS = [
  { re: /```([\s\S]+?)```/, style: { fontFamily: MONO, fontSize: '0.92em' } },
  { re: /\*([^*\n]+)\*/,    style: { fontWeight: 700 } },
  { re: /_([^_\n]+)_/,      style: { fontStyle: 'italic' } },
  { re: /~([^~\n]+)~/,      style: { textDecoration: 'line-through' } },
];
function renderRichText(text, key = 'w') {
  if (typeof text !== 'string' || !text) return text ?? null;
  // Find the earliest-occurring formatting marker, render text before it
  // plainly, style the matched span (recursing for nested formats), then
  // continue with the remainder.
  let earliest = null;
  for (const p of WA_PATTERNS) {
    const m = p.re.exec(text);
    if (m && (!earliest || m.index < earliest.m.index)) earliest = { p, m };
  }
  if (!earliest) return text;
  const { p, m } = earliest;
  const out = [];
  if (m.index > 0) out.push(text.slice(0, m.index));
  out.push(<span key={key} style={p.style}>{renderRichText(m[1], key + 'i')}</span>);
  return out.concat(renderRichText(text.slice(m.index + m[0].length), key + 'a'));
}

/* One-line preview of a quoted message, shown in the reply quote box and the
   composer reply bar. Mirrors what WhatsApp shows for each message type. */
export function quoteSnippet(msg) {
  if (!msg) return 'Original message';
  const t = (msg.message_type || '').toLowerCase();
  switch (t) {
    case 'image':    return msg.message_body ? `📷 ${msg.message_body}` : '📷 Photo';
    case 'sticker':  return 'Sticker';
    case 'video':    return msg.message_body ? `🎥 ${msg.message_body}` : '🎥 Video';
    case 'audio':
    case 'voice':    return '🎵 Audio';
    case 'document': return `📄 ${msg.media_filename || msg.message_body || 'Document'}`;
    case 'location': return '📍 Location';
    case 'contacts': return '👤 Contact';
    case 'template': return msg.message_body || 'Template message';
    case 'unsupported':
    case 'unknown':  return msg.message_body || 'Unsupported message';
    case 'revoke':   return 'This message was deleted';
    default:         return msg.message_body || `[${t || 'message'}]`;
  }
}

function MediaPlaceholder({ Icon, label, sub }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 4px', minWidth: 180 }}>
      <Icon size={20} color={C.textMuted} />
      <div>
        <div style={{ fontSize: 12, color: C.textSecondary, fontFamily: FONT }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: C.textMuted, fontFamily: FONT }}>{sub}</div>}
      </div>
    </div>
  );
}

function MediaPending({ Icon, kind }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 4px', minWidth: 200 }}>
      <Loader2 size={16} color={C.textMuted} style={{ animation: 'spin 1s linear infinite' }} />
      <Icon size={18} color={C.textMuted} />
      <span style={{ fontSize: 12, color: C.textMuted, fontFamily: FONT }}>Downloading {kind}…</span>
      <style>{`@keyframes spin { from {transform:rotate(0)} to {transform:rotate(360deg)} }`}</style>
    </div>
  );
}

function MediaFailed({ Icon, label, error, onRetry, status }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 4px', minWidth: 200 }}>
      <AlertCircle size={16} color="#A32D2D" />
      <Icon size={18} color={C.textMuted} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, color: '#A32D2D', fontFamily: FONT }}>
          {status === 'expired' ? `${label} no longer available` : `Failed to load ${label}`}
        </div>
        {error && status !== 'expired' && (
          <div style={{ fontSize: 10, color: C.textMuted, fontFamily: FONT, marginTop: 2 }}>{error.slice(0, 60)}</div>
        )}
      </div>
      {status !== 'expired' && (
        <button
          onClick={onRetry}
          style={{
            fontSize: 11, padding: '3px 8px', border: '1px solid var(--c-border)',
            background: 'var(--c-cardBg)', borderRadius: 6, cursor: 'pointer',
            fontFamily: FONT, color: C.text,
          }}
        >Retry</button>
      )}
    </div>
  );
}

function StatusTicks({ status }) {
  if (status === 'sending') return <Loader2 size={11} color="#8696a0" style={{ animation: 'spin 1s linear infinite' }} />;
  if (status === 'failed') return <AlertCircle size={11} color="#A32D2D" />;
  if (status === 'read') return <CheckCheck size={12} color="#53bdeb" />;
  if (status === 'delivered') return <CheckCheck size={12} color="#8696a0" />;
  return <Check size={12} color="#8696a0" />;
}

/* ── Seeded waveform — natural speech-like pattern, always "full" ───── */
function generateWaveform(seed, count = 40) {
  // FNV-1a hash → well-distributed starting state for the PRNG
  let h = 2166136261 >>> 0;
  const s = String(seed || 'voice');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  let state = (h >>> 0) || 1;
  const rnd = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };

  const bars = [];
  let level = 0.6;
  for (let i = 0; i < count; i++) {
    // Smoothed random walk biased to mid/high amplitude so there are no isolated "dots"
    const target = 0.4 + rnd() * 0.6;            // 0.40 – 1.00
    level = level * 0.5 + target * 0.5;          // ease toward target → smooth contour
    bars.push(Math.round(Math.max(32, Math.min(100, level * 100))));  // floor 32% → always a visible bar
  }
  return bars;
}

function fmtDuration(seconds) {
  // Guard non-finite (Ogg/Opus often reports Infinity until scanned) → avoids
  // rendering "Infinity:NaN".
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/* ── Sharp play / pause SVGs matching WhatsApp ─────────────────────── */
function PlayIcon({ size = 18, color = '#1f3c2e' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ display: 'block' }}>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseIcon({ size = 18, color = '#1f3c2e' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ display: 'block' }}>
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

/* ── WhatsApp-style voice / audio message player ───────────────────── */
function VoiceMessagePlayer({ src, message, isOutgoing, senderAvatarUrl, contactName }) {
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [imgError, setImgError] = useState(false);
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  const bars = useMemo(() => generateWaveform(message.message_id || ''), [message.message_id]);
  const progress = duration > 0 ? currentTime / duration : 0;
  const displayTime = isPlaying ? currentTime : duration;

  // Register with global controller so only one audio plays at a time
  const pauseMe = useRef(() => {
    if (audioRef.current && isPlayingRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  }).current;

  useEffect(() => {
    globalAudioControllers.add(pauseMe);
    return () => globalAudioControllers.delete(pauseMe);
  }, [pauseMe]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlayingRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      // Pause every other playing voice message first
      globalAudioControllers.forEach(ctrl => {
        if (ctrl !== pauseMe) ctrl();
      });
      audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  };

  const playedColor = isOutgoing ? CHAT.outgoingText : CHAT.incomingText;
  const unplayedColor = isOutgoing ? 'rgba(134,181,150,0.7)' : 'var(--c-textMuted)';
  const bubbleBg = isOutgoing ? CHAT.outgoingBg : CHAT.incomingBg;
  const iconColor = isOutgoing ? CHAT.outgoingText : CHAT.incomingText;

  // Avatar config
  const avatarUrl = isOutgoing ? senderAvatarUrl : null;
  const avatarInitial = isOutgoing ? 'F' : (contactName ? contactName.charAt(0).toUpperCase() : '?');
  const avatarBg = isOutgoing ? '#008069' : '#6B7280';

  return (
    <div style={{ width: '100%', maxWidth: 360 }}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onTimeUpdate={(e) => { const t = e.target.currentTime; if (Number.isFinite(t)) setCurrentTime(t); }}
        onLoadedMetadata={(e) => {
          const el = e.target;
          if (Number.isFinite(el.duration) && el.duration > 0) {
            setDuration(el.duration);
            return;
          }
          // Ogg/Opus voice notes report Infinity until forced to scan to the
          // end. Seek to a huge time (needs server Range support) → the browser
          // resolves the real duration via durationchange, then we reset.
          const onDur = () => {
            if (Number.isFinite(el.duration) && el.duration > 0) {
              setDuration(el.duration);
              el.removeEventListener('durationchange', onDur);
              try { el.currentTime = 0; } catch { /* noop */ }
            }
          };
          el.addEventListener('durationchange', onDur);
          try { el.currentTime = 1e101; } catch { /* noop */ }
        }}
        onEnded={() => { setIsPlaying(false); setCurrentTime(0); }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* Avatar with mic badge — always shown for voice messages */}
        <div style={{ position: 'relative', width: 40, height: 40, flexShrink: 0 }}>
          {avatarUrl && !imgError ? (
            <img
              src={avatarUrl}
              alt=""
              style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', display: 'block' }}
              onError={() => setImgError(true)}
            />
          ) : (
            <div style={{
              width: 40, height: 40, borderRadius: '50%', background: avatarBg,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, fontWeight: 700, color: '#fff',
            }}>
              {avatarInitial}
            </div>
          )}
          <div style={{
            position: 'absolute', bottom: -2, right: -2,
            width: 14, height: 14, borderRadius: '50%', background: '#008069',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: `2px solid ${bubbleBg}`,
          }}>
            <Mic size={8} color="#fff" />
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              onClick={togglePlay}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                padding: 2, display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: iconColor, flexShrink: 0, width: 22,
              }}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <PauseIcon size={18} color={iconColor} />
              ) : (
                <PlayIcon size={18} color={iconColor} />
              )}
            </button>

            {/* Waveform + progress dot */}
            <div style={{ position: 'relative', flex: 1, height: 28, display: 'flex', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%', height: 24 }}>
                {bars.map((h, i) => {
                  const isPlayed = (i + 0.5) / bars.length <= progress;
                  return (
                    <div
                      key={i}
                      style={{
                        flex: 1,
                        height: `${h}%`,
                        background: isPlayed ? playedColor : unplayedColor,
                        borderRadius: 2,
                        minWidth: 1,
                        transition: 'background 0.15s linear',
                      }}
                    />
                  );
                })}
              </div>
              <div style={{
                position: 'absolute',
                left: `calc(${progress * 100}% - 3px)`,
                top: '50%',
                transform: 'translateY(-50%)',
                width: 6, height: 6, borderRadius: '50%', background: '#111',
                transition: 'left 0.1s linear',
                pointerEvents: 'none',
              }} />
            </div>
          </div>

          {/* Bottom row: duration | time + ticks */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 1 }}>
            <span style={{ fontSize: 11, color: 'var(--c-textSecondary)', fontFamily: FONT }}>
              {fmtDuration(displayTime)}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <span style={{ fontSize: 10, color: 'var(--c-textMuted)', fontFamily: MONO, lineHeight: 1 }}>
                {formatTime(message.timestamp)}
              </span>
              {isOutgoing && <StatusTicks status={message.status} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export default function MessageBubble({ message, isOutgoing, senderAvatarUrl, contactName, onReply, quotedMessage, onReact, canReact, onForward, onStar }) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [menu, setMenu] = useState(null);      // context-menu position {x,y} | null
  const [infoOpen, setInfoOpen] = useState(false);

  const isVoice = message.message_type === 'audio' || message.message_type === 'voice';
  const isTemplate = message.message_type === 'template';

  // Reactions on this message (badge), and which one WE sent (to toggle/remove).
  const reactions = Array.isArray(message.reactions) ? message.reactions : [];
  const myReaction = reactions.find(r => r.direction === 'outgoing')?.emoji || null;
  const starred = !!message.starred;
  // Menu actions (react/star/info) need a real Meta wamid — optimistic/failed
  // rows still hold a local-/tmp- id.
  const realMsg = !!message.message_id
    && !String(message.message_id).startsWith('tmp-')
    && !String(message.message_id).startsWith('local-');
  const menuable = realMsg && message.status !== 'sending' && message.status !== 'failed';
  // Reacting also needs an open 24h window.
  const reactable = !!onReact && !!canReact && menuable;
  // Show the reaction bar for any real message; it renders disabled (greyed)
  // when the 24h window is closed so the option is always discoverable.
  const showReactionBar = !!onReact && menuable;

  // Reply is only allowed against a real Meta wamid — optimistic / failed rows
  // still hold a local-/tmp- id that Meta would reject as a quote target.
  const canReply = !!onReply
    && !!message.message_id
    && !String(message.message_id).startsWith('tmp-')
    && !String(message.message_id).startsWith('local-')
    && message.status !== 'sending'
    && message.status !== 'failed';

  // Quote box (this message is itself a reply to another message)
  const hasQuote = !!message.context_message_id;
  const quotedAccent = quotedMessage
    ? (quotedMessage.direction === 'outgoing' ? '#06cf9c' : '#34b7f1')
    : '#9aa5ab';
  const quotedSender = quotedMessage
    ? (quotedMessage.direction === 'outgoing' ? 'You' : (contactName || 'Contact'))
    : '';
  const quotedText = quotedMessage ? quoteSnippet(quotedMessage) : 'Original message';

  // Scroll to (and briefly flash) the message this reply quotes
  const goToQuoted = () => {
    if (!message.context_message_id) return;
    const el = document.getElementById(`msg-${message.context_message_id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.style.transition = 'background 0.3s ease';
    el.style.background = 'rgba(37,211,102,0.18)';
    el.style.borderRadius = '8px';
    setTimeout(() => { el.style.background = ''; }, 1200);
  };

  const bubbleStyle = {
    // Voice notes need more room for the waveform; they also fill the bubble
    // (width:100%) so they never overflow when the chat pane is contracted.
    maxWidth: isVoice ? '82%' : '65%',
    padding: '6px 7px 8px 9px',
    borderRadius: isOutgoing ? '7.5px 0 7.5px 7.5px' : '0 7.5px 7.5px 7.5px',
    background: isOutgoing ? CHAT.outgoingBg : CHAT.incomingBg,
    color: 'var(--c-text)',
    alignSelf: isOutgoing ? 'flex-end' : 'flex-start',
    boxShadow: '0 1px 0.5px rgba(0,0,0,0.13)',
    position: 'relative',
    wordBreak: 'break-word',
    fontFamily: FONT,
  };

  const mediaSrc = message.message_id
    ? `/api/media/${encodeURIComponent(message.message_id)}?v=${retryNonce}`
    : null;
  const mediaStatus = message.media_status;
  const hasMedia = MEDIA_TYPES.has(message.message_type);

  const handleRetry = async () => {
    if (!message.message_id || retrying) return;
    setRetrying(true);
    try {
      await api.retryMedia(message.message_id);
      setRetryNonce(n => n + 1);
    } catch (err) {
      console.error('Retry failed:', err);
    } finally {
      setRetrying(false);
    }
  };

  const renderMediaShell = ({ Icon, label, kind, children }) => {
    if (!hasMedia) return children;
    if (mediaStatus === 'stored') return children;
    if (mediaStatus === 'failed' || mediaStatus === 'expired') {
      return <MediaFailed Icon={Icon} label={label} error={message.media_error} onRetry={handleRetry} status={mediaStatus} />;
    }
    if (mediaStatus === 'pending' || mediaStatus === 'downloading' || mediaStatus == null) {
      return <MediaPending Icon={Icon} kind={kind} />;
    }
    return <MediaPlaceholder Icon={Icon} label={label} />;
  };

  const renderContent = () => {
    const type = message.message_type?.toLowerCase();

    switch (type) {
      case 'text':
        return <div style={{ fontSize: 13.5, lineHeight: 1.5, fontFamily: FONT, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{message.message_body ? renderRichText(message.message_body) : '...'}</div>;

      case 'image':
      case 'sticker':
        return (
          <div>
            {renderMediaShell({
              Icon: ImageIcon, label: 'Image', kind: 'image',
              children: (
                <img
                  src={mediaSrc}
                  alt="Image"
                  onClick={() => setLightboxOpen(true)}
                  style={{ maxWidth: 240, maxHeight: 300, borderRadius: 6, cursor: 'pointer', display: 'block' }}
                />
              ),
            })}
            {message.message_body && (
              <div style={{ fontSize: 13, marginTop: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{renderRichText(message.message_body)}</div>
            )}
          </div>
        );

      case 'video':
        return (
          <div>
            {renderMediaShell({
              Icon: Video, label: 'Video', kind: 'video',
              children: (
                <video controls preload="metadata" style={{ maxWidth: 240, maxHeight: 300, borderRadius: 6, display: 'block' }}>
                  <source src={mediaSrc} type={message.media_mime_type || 'video/mp4'} />
                </video>
              ),
            })}
            {message.message_body && (
              <div style={{ fontSize: 13, marginTop: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{renderRichText(message.message_body)}</div>
            )}
          </div>
        );

      case 'audio':
      case 'voice': {
        if (mediaStatus === 'stored' && mediaSrc) {
          return (
            <VoiceMessagePlayer
              src={mediaSrc}
              message={message}
              isOutgoing={isOutgoing}
              senderAvatarUrl={senderAvatarUrl}
              contactName={contactName}
            />
          );
        }
        return (
          <div style={{ minWidth: 220 }}>
            {renderMediaShell({
              Icon: Music, label: type === 'voice' ? 'Voice message' : 'Audio', kind: type,
              children: (
                <audio controls preload="metadata" style={{ maxWidth: 260, height: 36 }}>
                  <source src={mediaSrc} type={message.media_mime_type || 'audio/ogg'} />
                </audio>
              ),
            })}
            {message.media_size_bytes && mediaStatus === 'stored' && (
              <div style={{ fontSize: 10, color: C.textMuted, fontFamily: MONO, marginTop: 2 }}>
                {formatBytes(message.media_size_bytes)}
              </div>
            )}
          </div>
        );
      }

      case 'document': {
        const filename = message.media_filename || message.message_body || 'Document';
        return (
          <div>
            {mediaStatus === 'stored' ? (
              <a
                href={`${mediaSrc}&download=1`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 6px',
                  textDecoration: 'none', color: C.text, minWidth: 220,
                  border: '1px solid var(--c-border)', borderRadius: 6, background: 'var(--c-hover)',
                }}
              >
                <FileText size={28} color={C.purple} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, fontFamily: FONT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {filename}
                  </div>
                  <div style={{ fontSize: 10, color: C.textMuted, fontFamily: MONO, marginTop: 2 }}>
                    {[message.media_mime_type, formatBytes(message.media_size_bytes)].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <Download size={16} color={C.purple} />
              </a>
            ) : (
              renderMediaShell({
                Icon: FileText, label: filename, kind: 'document', children: null,
              })
            )}
          </div>
        );
      }

      case 'location':
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
            <MapPin size={20} color={C.green} />
            <span style={{ fontSize: 13 }}>{message.message_body || 'Location shared'}</span>
          </div>
        );

      case 'contacts':
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
            <Phone size={20} color={C.purple} />
            <span style={{ fontSize: 13 }}>{message.message_body || 'Contact shared'}</span>
          </div>
        );

      case 'interactive':
      case 'button':
        return (
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.purple, marginBottom: 4 }}>Interactive</div>
            <div style={{ fontSize: 13 }}>{message.message_body || 'User interacted with a message'}</div>
          </div>
        );

      case 'reaction':
        return (
          <div style={{ fontSize: 13, color: C.textMuted }}>
            Reacted {message.message_body || '...'}
          </div>
        );

      case 'template': {
        const tm = message.template_meta || null;
        const buttons = Array.isArray(tm?.buttons) ? tm.buttons : [];
        const mediaHeader = tm && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(tm.header_type);
        const HeaderMediaIcon = tm?.header_type === 'VIDEO' ? Video : tm?.header_type === 'DOCUMENT' ? FileText : ImageIcon;
        const btnIcon = (t) => t === 'URL' ? <ExternalLink size={14} />
          : t === 'PHONE_NUMBER' ? <Phone size={14} />
          : (t === 'COPY_CODE' || t === 'OTP') ? <Copy size={14} />
          : <Reply size={14} />;
        return (
          <div style={{ minWidth: 200 }}>
            {/* Header */}
            {tm?.header_type === 'TEXT' && tm.header_text && (
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--c-text)', marginBottom: 5, fontFamily: FONT }}>
                {tm.header_text}
              </div>
            )}
            {mediaHeader && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6,
                padding: '6px 8px', borderRadius: 6, background: 'rgba(0,0,0,0.04)',
                color: C.textSecondary, fontSize: 11, fontFamily: FONT,
              }}>
                <HeaderMediaIcon size={14} /> {String(tm.header_type).charAt(0) + String(tm.header_type).slice(1).toLowerCase()} header
              </div>
            )}
            {/* Body */}
            <div style={{ fontSize: 13.5, lineHeight: 1.5, fontFamily: FONT, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {message.message_body ? renderRichText(message.message_body) : '...'}
            </div>
            {/* Footer + time/ticks on one row */}
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8, marginTop: 5 }}>
              <span style={{ fontSize: 11, color: 'var(--c-textMuted)', fontFamily: FONT, flex: 1, minWidth: 0 }}>
                {tm?.footer || ''}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                <span style={{ fontSize: 10, color: 'var(--c-textMuted)', fontFamily: MONO, lineHeight: 1 }}>
                  {formatTime(message.timestamp)}
                </span>
                {isOutgoing && <StatusTicks status={message.status} />}
              </span>
            </div>
            {/* Buttons */}
            {buttons.length > 0 && (
              <div style={{ margin: '6px -7px -8px -9px' }}>
                {buttons.map((b, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    padding: '9px 8px', borderTop: '1px solid rgba(0,0,0,0.08)',
                    color: '#027eb5', fontSize: 13.5, fontWeight: 500, fontFamily: FONT,
                  }}>
                    {btnIcon(b.type)}
                    <span>{b.text || (b.type === 'URL' ? 'Visit' : b.type === 'PHONE_NUMBER' ? 'Call' : 'Reply')}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      }

      // Meta sends type:'unsupported' (error 131051) for messages the Cloud API
      // can't relay — polls, view-once it can't forward, certain native/flow or
      // template-originated messages. The content isn't delivered to us, so show
      // a clean placeholder rather than the raw "[unsupported]".
      case 'unsupported':
      case 'unknown':
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: C.textMuted, fontStyle: 'italic', fontFamily: FONT }}>
            <AlertCircle size={14} style={{ flexShrink: 0 }} />
            <span>{message.message_body || 'Unsupported message — open WhatsApp to view'}</span>
          </div>
        );

      // The customer (or business) deleted this message via "Delete for
      // everyone". WhatsApp/Baileys delivers a revoke event with no body; the
      // original row stays in our DB but is hidden here, matching WhatsApp.
      case 'revoke':
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: C.textMuted, fontStyle: 'italic', fontFamily: FONT }}>
            <Ban size={14} style={{ flexShrink: 0 }} />
            <span>This message was deleted</span>
          </div>
        );

      default:
        return <div style={{ fontSize: 13 }}>{message.message_body || `[${message.message_type || 'unknown'}]`}</div>;
    }
  };

  const canLightbox = (message.message_type === 'image' || message.message_type === 'sticker') && mediaStatus === 'stored';

  // Hover Reply button stays as-is (additive to the new chevron menu).
  const replyBtn = canReply ? (
    <button
      onClick={() => onReply(message)}
      title="Reply"
      style={{
        width: 28, height: 28, borderRadius: '50%', border: 'none', flexShrink: 0,
        background: 'var(--c-cardBg)', boxShadow: C.shadowSm, color: C.textSecondary,
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        opacity: hovered ? 1 : 0, transition: 'opacity 0.12s',
        pointerEvents: hovered ? 'auto' : 'none',
      }}
    >
      <Reply size={15} />
    </button>
  ) : null;

  const controls = replyBtn ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
      {replyBtn}
    </div>
  ) : null;

  // WhatsApp-style context menu, opened by the chevron on the bubble top-right.
  const MENU_W = 206;
  const canForward = !!onForward && !!message.message_body;
  const canCopy = !!message.message_body;
  const openMenu = (e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const itemCount = 1 /*Info*/ + (canReply ? 1 : 0) + (canForward ? 1 : 0) + (canCopy ? 1 : 0) + (onStar ? 1 : 0);
    const estH = (reactable ? 46 : 0) + itemCount * 41 + 8;
    let x = r.right - MENU_W; if (x < 8) x = 8;
    let y = r.bottom + 4;
    if (y + estH > window.innerHeight - 8) y = Math.max(8, r.top - estH - 4);
    setMenu({ x, y });
  };
  const copyText = () => {
    try { navigator.clipboard?.writeText(message.message_body || ''); } catch { /* ignore */ }
    setMenu(null);
  };
  const MenuRow = ({ icon: Icon, label, onClick }) => (
    <button onClick={onClick}
      onMouseEnter={e => { e.currentTarget.style.background = C.pageBg; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
        border: 'none', background: 'transparent', cursor: 'pointer', padding: '10px 14px',
        fontFamily: FONT, fontSize: 13.5, color: C.text,
      }}>
      <span>{label}</span><Icon size={16} style={{ color: C.textSecondary }} />
    </button>
  );
  const InfoRow = ({ label, value, cap }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ color: C.textSecondary }}>{label}</span>
      <span style={{ fontWeight: 600, color: C.text, textTransform: cap ? 'capitalize' : 'none', textAlign: 'right' }}>{value}</span>
    </div>
  );

  return (
    <>
      <div
        id={`msg-${message.message_id}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          justifyContent: isOutgoing ? 'flex-end' : 'flex-start',
          marginBottom: reactions.length > 0 ? 15 : 3,
        }}
      >
        {isOutgoing && controls}
        <div style={bubbleStyle}>
          {/* Chevron → WhatsApp-style context menu (top-right of bubble, on hover) */}
          {menuable && (
            <button onClick={openMenu} title="More" style={{
              position: 'absolute', top: 0, right: 0, height: 26, width: 36,
              border: 'none', cursor: 'pointer', padding: '1px 3px 0 0', borderRadius: '0 7px 0 14px',
              display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end',
              background: isOutgoing
                ? 'linear-gradient(to left, var(--c-outgoingBg) 62%, transparent)'
                : 'linear-gradient(to left, var(--c-incomingBg) 62%, transparent)',
              color: 'var(--c-textSecondary)', opacity: hovered || menu ? 1 : 0,
              transition: 'opacity .12s', pointerEvents: hovered || menu ? 'auto' : 'none', zIndex: 3,
            }}>
              <ChevronDown size={18} strokeWidth={2.5} />
            </button>
          )}
          {hasQuote && (
            <div
              onClick={goToQuoted}
              style={{
                display: 'flex', flexDirection: 'column', gap: 1,
                borderLeft: `3px solid ${quotedAccent}`,
                background: 'rgba(0,0,0,0.05)',
                borderRadius: 6, padding: '4px 8px', marginBottom: 4,
                cursor: 'pointer', maxWidth: '100%', overflow: 'hidden',
              }}
            >
              {quotedSender && (
                <span style={{
                  fontSize: 12, fontWeight: 700, color: quotedAccent,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>{quotedSender}</span>
              )}
              <span style={{
                fontSize: 12, color: 'var(--c-textSecondary)', fontFamily: FONT,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 240,
              }}>{quotedText}</span>
            </div>
          )}
          {renderContent()}
          {/* Standard footer for non-voice messages (templates render their own) */}
          {!isVoice && !isTemplate && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
              gap: 4, marginTop: 2,
            }}>
              {starred && <Star size={11} fill="#8696a0" color="#8696a0" />}
              <span style={{
                fontSize: 10, color: 'var(--c-textMuted)', fontFamily: MONO,
                lineHeight: 1,
              }}>
                {formatTime(message.timestamp)}
              </span>
              {isOutgoing && (
                <StatusTicks status={message.status} />
              )}
            </div>
          )}
          {/* WhatsApp-style reaction badge, overlapping the bubble's bottom edge */}
          {reactions.length > 0 && (
            <div style={{
              position: 'absolute', bottom: -11, [isOutgoing ? 'left' : 'right']: 6,
              display: 'flex', alignItems: 'center', gap: 1,
              background: 'var(--c-cardBg)', border: `1px solid ${C.border}`, borderRadius: 12,
              padding: '1px 4px', boxShadow: '0 1px 2px rgba(0,0,0,0.12)',
              fontSize: 12, lineHeight: '15px', zIndex: 2, whiteSpace: 'nowrap',
            }}>
              {[...new Set(reactions.map(r => r.emoji))].map((e, i) => <span key={i}>{e}</span>)}
            </div>
          )}
        </div>
        {!isOutgoing && controls}
      </div>

      {/* WhatsApp-style context menu (reaction bar + actions) */}
      {menu && (
        <>
          <div onClick={() => setMenu(null)} style={{ position: 'fixed', inset: 0, zIndex: 300 }} />
          <div style={{
            position: 'fixed', left: menu.x, top: menu.y, width: MENU_W,
            background: 'var(--c-cardBg)', border: `1px solid ${C.border}`, borderRadius: 12,
            boxShadow: C.shadowLg, zIndex: 301, overflow: 'hidden', fontFamily: FONT,
          }}>
            {showReactionBar && (
              <div style={{ borderBottom: `1px solid ${C.border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, padding: '5px 7px', opacity: canReact ? 1 : 0.45 }}>
                  {QUICK_EMOJIS.map(e => (
                    <button key={e} disabled={!canReact}
                      onClick={canReact ? () => { onReact(message, myReaction === e ? '' : e); setMenu(null); } : undefined}
                      title={!canReact ? 'Reactions need the 24-hour window open' : (myReaction === e ? 'Remove reaction' : `React ${e}`)}
                      style={{ border: 'none', background: myReaction === e ? C.primaryLight : 'transparent', borderRadius: '50%', width: 28, height: 28, fontSize: 17, lineHeight: 1, cursor: canReact ? 'pointer' : 'not-allowed' }}>{e}</button>
                  ))}
                </div>
                {!canReact && (
                  <div style={{ padding: '0 9px 6px', fontSize: 11, color: 'var(--c-textMuted)', fontFamily: FONT }}>
                    Reactions need the 24-hour window open
                  </div>
                )}
              </div>
            )}
            {canReply && <MenuRow icon={Reply} label="Reply" onClick={() => { onReply(message); setMenu(null); }} />}
            {canForward && <MenuRow icon={Forward} label="Forward" onClick={() => { onForward(message); setMenu(null); }} />}
            {canCopy && <MenuRow icon={Copy} label="Copy" onClick={copyText} />}
            <MenuRow icon={Info} label="Info" onClick={() => { setInfoOpen(true); setMenu(null); }} />
            {onStar && <MenuRow icon={Star} label={starred ? 'Unstar' : 'Star'} onClick={() => { onStar(message, !starred); setMenu(null); }} />}
          </div>
        </>
      )}

      {/* Message info modal */}
      {infoOpen && (
        <div onClick={() => setInfoOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--c-cardBg)', borderRadius: 14, boxShadow: C.shadowLg, width: 'min(380px,100%)', fontFamily: FONT, overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: `1px solid ${C.border}`, fontWeight: 700, fontSize: 15, color: C.text }}>Message info</div>
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 11, fontSize: 13 }}>
              <InfoRow label="Direction" value={isOutgoing ? 'Sent by you' : 'Received'} />
              {isOutgoing && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: C.textSecondary }}>Status</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, color: C.text, textTransform: 'capitalize' }}>{message.status || 'sent'} <StatusTicks status={message.status} /></span>
                </div>
              )}
              <InfoRow label="Time" value={new Date(message.timestamp).toLocaleString('en-IN')} />
              {message.message_type && message.message_type !== 'text' && <InfoRow label="Type" value={message.message_type} cap />}
              {starred && <InfoRow label="Starred" value="Yes" />}
            </div>
            <div style={{ padding: '10px 16px', borderTop: `1px solid ${C.border}`, textAlign: 'right' }}>
              <button onClick={() => setInfoOpen(false)} style={{ border: 'none', background: C.primary, color: '#fff', borderRadius: 8, padding: '7px 16px', cursor: 'pointer', fontFamily: FONT, fontSize: 13, fontWeight: 600 }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox for images */}
      {lightboxOpen && canLightbox && (
        <div
          onClick={() => setLightboxOpen(false)}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 300, cursor: 'zoom-out',
          }}
        >
          <img
            src={mediaSrc}
            alt="Full size"
            style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 8 }}
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
