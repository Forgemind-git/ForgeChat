// Color tokens map to CSS variables (defined per-theme in index.css) so the
// whole app re-themes when <html data-theme> flips. Fallbacks = light values,
// so colors still render even if the stylesheet hasn't loaded.
export const C = {
  pageBg: 'var(--c-pageBg, #F7F7F3)',
  sidebarBg: 'var(--c-sidebarBg, #FAF9F5)',
  sidebarBorder: 'var(--c-sidebarBorder, #E5E5E0)',
  headerBg: 'var(--c-headerBg, #0F0F10)',
  headerText: 'var(--c-headerText, #F5F5F2)',
  headerMuted: 'var(--c-headerMuted, #A1A1AA)',
  headerBorder: 'var(--c-headerBorder, rgba(255,255,255,.12))',
  headerSurface: 'var(--c-headerSurface, rgba(255,255,255,.06))',
  cardBg: 'var(--c-cardBg, #ffffff)',
  border: 'var(--c-border, #E5E5E0)',
  borderDark: 'var(--c-borderDark, #d1d7db)',
  text: 'var(--c-text, #111111)',
  textSecondary: 'var(--c-textSecondary, #6B7280)',
  textMuted: 'var(--c-textMuted, #8696a0)',
  primary: 'var(--c-primary, #dc2626)',
  primaryHover: 'var(--c-primaryHover, #b91c1c)',
  primaryLight: 'var(--c-primaryLight, #FCEBEB)',
  primaryText: 'var(--c-primaryText, #111b21)',
  purple: 'var(--c-purple, #534AB7)',
  green: 'var(--c-green, #0F6E56)',
  amber: 'var(--c-amber, #E8A317)',
  shadowSm: 'var(--c-shadowSm, 0 1px 2px rgba(0,0,0,.08))',
  shadowMd: 'var(--c-shadowMd, 0 8px 24px rgba(0,0,0,.06))',
  shadowLg: 'var(--c-shadowLg, 0 20px 60px rgba(0,0,0,.15))',
  waBg: 'var(--c-waBg, #e5ddd5)',
  // neutral surface aliases (used when migrating literal-heavy views)
  surface: 'var(--c-surface, #ffffff)',
  surfaceAlt: 'var(--c-surfaceAlt, #F7F7F3)',
  hover: 'var(--c-hover, #EFEEE6)',
  waBgPattern: 'url("data:image/svg+xml,%3Csvg width=\'16\' height=\'16\' viewBox=\'0 0 16 16\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M0 0h8v8H0z\' fill=\'%23d1d7db\' fill-opacity=\'0.15\'/%3E%3C/svg%3E")',
};

export const CHAT = {
  incomingBg: 'var(--c-incomingBg, #ffffff)',
  incomingText: 'var(--c-incomingText, #111b21)',
  outgoingBg: 'var(--c-outgoingBg, #d9fdd3)',
  outgoingText: 'var(--c-outgoingText, #111b21)',
  chatBg: 'var(--c-chatBg, #e5ddd5)',
  bubbleRadius: '7.5px',
  bubblePadding: '6px 7px 8px 9px',
  statusDelivered: 'var(--c-statusDelivered, #53bdeb)',
  statusRead: 'var(--c-statusRead, #53bdeb)',
  statusSent: 'var(--c-statusSent, #8696a0)',
};

export const FONT = "'DM Sans', system-ui, sans-serif";
export const MONO = "'DM Mono', monospace";

export function relativeTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

// Mask a phone number for display — keep the first 2 and last 3 digits, star the
// rest (e.g. "919487722330" -> "91*******330", "93xxxxx678" -> "93*****678").
// Used directly for non-interactive contexts (<option>, strings); the
// MaskedNumber component wraps this with click-to-reveal for JSX.
export function maskPhone(raw) {
  const s = String(raw ?? '');
  const digits = s.replace(/\D/g, '');
  if (digits.length <= 5) return s; // too short to meaningfully mask
  return digits.slice(0, 2) + '*'.repeat(digits.length - 5) + digits.slice(-3);
}

// Tag colors are stored as pale pastels (good as light fills, unreadable with
// the white chip text). Darken a hex color so a white label reads clearly while
// the tag keeps its own hue. Falls back to a dark slate for missing/invalid.
export function darkenColor(hex, factor = 0.5) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex || '');
  if (!m) return '#374151';
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * factor);
  const g = Math.round(((n >> 8) & 255) * factor);
  const b = Math.round((n & 255) * factor);
  return `rgb(${r}, ${g}, ${b})`;
}

export function formatDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}
