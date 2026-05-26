import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import {
  LayoutTemplate, Plus, ArrowLeft, Pencil, Trash2, Eye, Megaphone, Bell, Shield,
  Check, X, Copy, Braces, Search,
  Image, Video, FileText, Type, Link, Phone, Reply, KeyRound, Loader2, Send,
  CheckCircle2, XCircle, Info,
  Play, User,
  Library
} from 'lucide-react';
import DeleteConfirmModal from '../components/DeleteConfirmModal.jsx';
import { useTableSelection, SelectAllCheckbox, RowCheckbox, BulkDeleteButton, runBulkDelete } from '../components/TableSelection.jsx';
import { PhoneFrame } from '../components/WhatsAppPreview.jsx';
import { api } from '../api.js';
import { C, FONT, maskPhone } from '../constants.js';

// ─── Builder-local Design Tokens (purple accent per plan) ─────────────────────
const B = {
  bg: '#F7F7F3',
  card: '#FFFFFF',
  cardBorder: '#E5E5E0',
  innerBg: '#FAFAF7',
  innerBorder: '#EEEEE8',
  sectionBg: '#F8F7F2',
  sectionBorder: '#EEEEE8',
  divider: '#F0F0EA',
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
  warn: '#854F0B',
  warnBg: '#FAEEDA',
  wa: '#25D366',
  waHeader: '#00A884',
};

const CATEGORIES = [
  { id: 'MARKETING', icon: Megaphone, label: 'Marketing', color: B.orange, bg: B.orangeBg, desc: 'Promotions, offers, announcements' },
  { id: 'UTILITY', icon: Bell, label: 'Utility', color: '#1565C0', bg: '#E3F2FD', desc: 'Order updates, delivery alerts' },
  { id: 'AUTHENTICATION', icon: Shield, label: 'Authentication', color: B.green, bg: B.greenBg, desc: 'OTPs, verification codes' },
];

const LANGUAGES = [
  { code: 'en', label: 'English' }, { code: 'en_US', label: 'English (US)' },
  { code: 'hi', label: 'Hindi' }, { code: 'ta', label: 'Tamil' },
  { code: 'te', label: 'Telugu' }, { code: 'mr', label: 'Marathi' },
  { code: 'kn', label: 'Kannada' }, { code: 'ml', label: 'Malayalam' },
  { code: 'bn', label: 'Bengali' }, { code: 'gu', label: 'Gujarati' },
  { code: 'ar', label: 'Arabic' }, { code: 'pt_BR', label: 'Portuguese (BR)' },
  { code: 'id', label: 'Indonesian' }, { code: 'fr', label: 'French' },
];

const HEADER_TYPES = [
  { id: 'NONE', label: 'None', icon: X },
  { id: 'TEXT', label: 'Text', icon: Type },
  { id: 'IMAGE', label: 'Image', icon: Image },
  { id: 'VIDEO', label: 'Video', icon: Video },
  { id: 'DOCUMENT', label: 'Document', icon: FileText },
];

const STATUSES = {
  DRAFT: { color: B.t6, bg: '#EEEDE8', dot: '#aaa', label: 'DRAFT' },
  SUBMITTED: { color: B.accentDark, bg: B.accentBg, dot: B.accent, label: 'PENDING REVIEW' },
  APPROVED: { color: B.green, bg: B.greenBg, dot: B.greenBright, label: 'APPROVED' },
  REJECTED: { color: B.red, bg: B.redBg, dot: B.red, label: 'REJECTED' },
  PAUSED: { color: '#E65100', bg: '#FFF3E0', dot: '#E65100', label: 'PAUSED' },
  DISABLED: { color: '#666', bg: '#EEEDE8', dot: '#666', label: 'DISABLED' },
};

const QUALITY_STYLES = {
  GREEN: { color: '#0F6E56', label: 'Quality: Green' },
  YELLOW: { color: '#E65100', label: 'Quality: Yellow' },
  RED: { color: '#A32D2D', label: 'Quality: Red' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const extractVars = (t) => { const m = [...(t || '').matchAll(/\{\{(\d+)\}\}/g)]; return [...new Set(m.map(x => x[1]))].sort((a, b) => +a - +b); };
const applyVars = (t, s) => (t || '').replace(/\{\{(\d+)\}\}/g, (_, n) => s[n] || `{{${n}}}`);
const nameOk = (n) => /^[a-z0-9_]+$/.test(n);

function runValidation({ name, body, headerType, headerText, mediaHandle, footer, buttons, samples, category, codeExpiry }) {
  const e = {};
  if (!name || !name.trim()) e.name = 'Template name is required';
  else if (!nameOk(name)) e.name = 'Only lowercase letters, numbers, underscores';
  else if (name.length > 512) e.name = 'Max 512 characters';

  if (!body || !body.trim()) e.body = 'Body text is required';
  const hv = headerType === 'TEXT' ? extractVars(headerText) : [];
  if (hv.length > 1) e.headerVars = 'Header allows only 1 variable — {{1}}';
  if (headerText && headerText.length > 60) e.headerTextLen = 'Header text max 60 characters';
  if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerType) && !(mediaHandle || '').trim()) e.mediaHandle = 'Meta file handle required for media header';
  if (extractVars(footer).length > 0) e.footer = 'Footer cannot contain variables';
  if (footer && footer.length > 60) e.footerLen = 'Footer max 60 characters';

  const bv = extractVars(body);
  const miss = bv.filter(v => !(samples || {})[v]?.trim());
  if (miss.length > 0) e.bodySamples = `Fill samples for: ${miss.map(v => `{{${v}}}`).join(', ')}`;
  if (hv.length > 0 && !(samples || {})[hv[0]]?.trim()) e.headerSamples = `Fill sample for header {{${hv[0]}}}`;

  const btnArr = buttons || [];
  const urlBtns = btnArr.filter(b => b.type === 'URL');
  const phoneBtns = btnArr.filter(b => b.type === 'PHONE_NUMBER');
  if (urlBtns.length > 2) e.btnMaxUrl = 'Max 2 URL buttons';
  if (phoneBtns.length > 1) e.btnMaxPhone = 'Max 1 phone button';

  btnArr.forEach((btn, i) => {
    if (!btn.text?.trim() && btn.type !== 'OTP') e[`btn_text_${i}`] = 'Button text required';
    if (btn.type === 'URL') {
      if (btn.value && !btn.value.startsWith('https://')) e[`btn_url_${i}`] = 'URL must start with https://';
      if (extractVars(btn.value || '').length > 0 && !btn.urlSample?.trim()) e[`btn_urlsample_${i}`] = 'Sample URL required for dynamic URL variable';
    }
    if (btn.type === 'PHONE_NUMBER' && btn.value) {
      const clean = (btn.value || '').replace(/[\s\-()]/g, '');
      if (!/^\+\d{7,15}$/.test(clean)) e[`btn_phone_${i}`] = 'Use E.164 format: +919876543210';
    }
  });

  if (category === 'AUTHENTICATION' && codeExpiry && codeExpiry !== '' && (isNaN(+codeExpiry) || +codeExpiry < 1 || +codeExpiry > 90)) {
    e.codeExpiry = 'Expiry must be 1–90 minutes';
  }
  return e;
}

function buildPayload({ name, category, language, headerType, headerText, mediaHandle, body, footer, buttons, samples, securityRec, codeExpiry, allowCatChange }) {
  const components = [];
  if (headerType !== 'NONE') {
    const hc = { type: 'HEADER', format: headerType };
    if (headerType === 'TEXT') {
      hc.text = headerText;
      const hv = extractVars(headerText);
      if (hv.length > 0) hc.example = { header_text: [samples[hv[0]] || 'Sample'] };
    } else {
      if (mediaHandle) hc.example = { header_handle: [mediaHandle] };
    }
    components.push(hc);
  }
  const bc = { type: 'BODY', text: body };
  if (securityRec && category === 'AUTHENTICATION') bc.add_security_recommendation = true;
  const bv = extractVars(body);
  if (bv.length > 0) bc.example = { body_text: [bv.map(v => samples[v] || `sample_${v}`)] };
  components.push(bc);
  if (category !== 'AUTHENTICATION' && footer) components.push({ type: 'FOOTER', text: footer });
  if (category === 'AUTHENTICATION' && codeExpiry) components.push({ type: 'FOOTER', code_expiration_minutes: parseInt(codeExpiry) });
  const btnArr = buttons || [];
  if (btnArr.length > 0) {
    const btns = btnArr.map(b => {
      if (b.type === 'OTP') return { type: 'OTP', otp_type: b.otpType || 'COPY_CODE', text: b.text || 'Copy Code', ...(b.otpType === 'ONE_TAP' ? { autofill_text: 'Autofill', package_name: b.packageName || '', signature_hash: b.signatureHash || '' } : {}) };
      if (b.type === 'URL') { const uv = extractVars(b.value || ''); return { type: 'URL', text: b.text, url: b.value, ...(uv.length > 0 ? { example: [b.urlSample || b.value] } : {}) }; }
      if (b.type === 'PHONE_NUMBER') return { type: 'PHONE_NUMBER', text: b.text, phone_number: b.value };
      if (b.type === 'COPY_CODE') return { type: 'COPY_CODE', example: [b.value || 'PROMO50'] };
      return { type: 'QUICK_REPLY', text: b.text };
    });
    components.push({ type: 'BUTTONS', buttons: btns });
  }
  return { name, language, category, allow_category_change: allowCatChange, components };
}

// ─── Shared UI Components ─────────────────────────────────────────────────────
function Lbl({ children, required, note }) {
  return (
    <label style={{ fontSize: 12, fontWeight: 600, color: B.t3, display: 'block', marginBottom: 5, fontFamily: FONT }}>
      {children}{required && <span style={{ color: B.red }}> *</span>}
      {note && <span style={{ color: B.t6, fontWeight: 500, marginLeft: 5, fontSize: 11 }}>{note}</span>}
    </label>
  );
}

function Hint({ children, error, warn }) {
  return (
    <div style={{ fontSize: 11, marginTop: 4, color: error ? B.red : warn ? B.warn : B.t7, display: 'flex', alignItems: 'flex-start', gap: 4, fontFamily: FONT }}>
      {(error || warn) && <span style={{ flexShrink: 0, marginTop: 1 }}>{error ? '⚠' : 'ℹ'}</span>}
      <span>{children}</span>
    </div>
  );
}

function Sec({ n, title, note, children }) {
  return (
    <div style={{ background: B.card, border: `1px solid ${B.cardBorder}`, borderRadius: 12, padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <span style={{ width: 22, height: 22, borderRadius: 99, background: B.accent, color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontFamily: FONT }}>{n}</span>
        <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.1em', color: '#888', fontWeight: 700, fontFamily: FONT }}>{title}</span>
        {note && <span style={{ fontSize: 10, color: '#bbb', fontFamily: FONT, textTransform: 'none', letterSpacing: 0, fontStyle: 'italic' }}>{note}</span>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ on, onChange, label, desc }) {
  return (
    <div onClick={() => onChange(!on)} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '10px 14px', background: on ? B.greenBg : B.innerBg, border: `1.5px solid ${on ? B.greenBright + '66' : B.innerBorder}`, borderRadius: 10, transition: 'all .15s' }}>
      <div style={{ width: 36, height: 20, borderRadius: 99, background: on ? B.greenBright : '#D5D5D0', transition: 'background .2s', position: 'relative', flexShrink: 0 }}>
        <div style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 16, height: 16, borderRadius: 99, background: 'var(--c-cardBg)', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} />
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: B.t2, fontFamily: FONT }}>{label}</div>
        {desc && <div style={{ fontSize: 11, color: B.t5, marginTop: 1, fontFamily: FONT }}>{desc}</div>}
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const st = STATUSES[status] || STATUSES.DRAFT;
  return (
    <span style={{ padding: '4px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700, background: st.bg, color: st.color, display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: FONT, whiteSpace: 'nowrap' }}>
      <span style={{ width: 6, height: 6, borderRadius: 99, background: st.dot, display: 'inline-block' }} />
      {st.label}
    </span>
  );
}


// ─── WhatsApp Preview ─────────────────────────────────────────────────────────
function WaPreview({ headerType, headerText, bodyText, footerText, buttons, securityRec, codeExpiry, headerMediaLibraryId }) {
  const hasBubble = bodyText || footerText || (headerType !== 'NONE' && (headerText || ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerType)));
  const hasButtons = buttons.length > 0;
  const bRadius = hasButtons ? '7.5px 7.5px 0 0' : '7.5px 7.5px 0 7.5px';

  const bIcon = (type) => {
    if (type === 'URL') return <Link size={14} color={B.waHeader} />;
    if (type === 'PHONE_NUMBER') return <Phone size={14} color={B.waHeader} />;
    if (type === 'OTP') return <KeyRound size={14} color={B.waHeader} />;
    return <Reply size={14} color={B.waHeader} />;
  };
  const bLabel = (btn) => btn.text || (btn.type === 'QUICK_REPLY' ? 'Quick Reply' : btn.type === 'URL' ? 'Visit Website' : btn.type === 'PHONE_NUMBER' ? 'Call Us' : 'Copy Code');

  return (
    <PhoneFrame headerTitle="Your Business" headerSubtitle="online" minHeight={330}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
        <span style={{ background: '#E1F2FA', color: '#3C6678', fontSize: 9, padding: '2px 9px', borderRadius: 99, fontWeight: 600 }}>TODAY</span>
      </div>
      {!hasBubble && !hasButtons ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, textAlign: 'center' }}>
          <div style={{ fontSize: 26, marginBottom: 6, opacity: 0.4 }}>💬</div>
          <div style={{ fontSize: 10, color: '#888', fontWeight: 500, lineHeight: 1.5, fontFamily: FONT }}>Your message<br />will appear here</div>
        </div>
      ) : (
        <div style={{ marginLeft: 'auto', maxWidth: '88%', minWidth: '55%' }}>
          <div style={{ background: '#DCF8C6', borderRadius: bRadius, padding: '6px 7px 5px 9px', boxShadow: '0 1px 0.5px rgba(11,20,26,.13)', position: 'relative', marginRight: hasButtons ? 0 : 8 }}>
            {!hasButtons && <div style={{ position: 'absolute', bottom: 0, right: -8, width: 0, height: 0, borderStyle: 'solid', borderWidth: '0 0 9px 9px', borderColor: 'transparent transparent #DCF8C6 transparent' }} />}
            {headerType === 'IMAGE' && (
              headerMediaLibraryId
                ? <img src={api.mediaLibrary.downloadUrl(headerMediaLibraryId)} alt="" style={{ margin: '-6px -7px 6px -9px', borderRadius: '7.5px 7.5px 0 0', height: 120, width: 'calc(100% + 16px)', objectFit: 'cover', display: 'block' }} />
                : <div style={{ margin: '-6px -7px 6px -9px', borderRadius: '7.5px 7.5px 0 0', height: 120, background: 'linear-gradient(135deg,#c9c9c9,#999)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Image size={28} color="rgba(255,255,255,.8)" /></div>
            )}
            {headerType === 'VIDEO' && (
              headerMediaLibraryId
                ? <div style={{ margin: '-6px -7px 6px -9px', borderRadius: '7.5px 7.5px 0 0', height: 120, position: 'relative', overflow: 'hidden' }}>
                    <video src={api.mediaLibrary.downloadUrl(headerMediaLibraryId)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} preload="metadata" muted />
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.3)' }}>
                      <div style={{ width: 38, height: 38, borderRadius: 99, background: 'rgba(255,255,255,.15)', border: '1.5px solid rgba(255,255,255,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Play size={16} color="white" fill="white" />
                      </div>
                    </div>
                  </div>
                : <div style={{ margin: '-6px -7px 6px -9px', borderRadius: '7.5px 7.5px 0 0', height: 120, background: '#1A1A1A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ width: 38, height: 38, borderRadius: 99, background: 'rgba(255,255,255,.15)', border: '1.5px solid rgba(255,255,255,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Play size={16} color="white" fill="white" /></div></div>
            )}
            {headerType === 'DOCUMENT' && (
              headerMediaLibraryId
                ? <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 8px', background: 'rgba(0,0,0,.06)', borderRadius: 6, marginBottom: 7 }}>
                    <div style={{ width: 34, height: 38, background: 'var(--c-cardBg)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 1px 3px rgba(0,0,0,.15)', position: 'relative', overflow: 'hidden' }}>
                      <div style={{ position: 'absolute', top: 0, right: 0, width: 10, height: 10, background: '#e94235', clipPath: 'polygon(100% 0,0 0,100% 100%)' }} />
                      <FileText size={16} color="#9e9e9e" />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--c-text)', fontFamily: FONT }}>Document</div>
                      <div style={{ fontSize: 9.5, color: 'var(--c-textMuted)', marginTop: 1, fontFamily: FONT }}>From Media Library</div>
                    </div>
                  </div>
                : <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 8px', background: 'rgba(0,0,0,.06)', borderRadius: 6, marginBottom: 7 }}><div style={{ width: 34, height: 38, background: 'var(--c-cardBg)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 1px 3px rgba(0,0,0,.15)', position: 'relative', overflow: 'hidden' }}><div style={{ position: 'absolute', top: 0, right: 0, width: 10, height: 10, background: '#e94235', clipPath: 'polygon(100% 0,0 0,100% 100%)' }} /><FileText size={16} color="#9e9e9e" /></div><div><div style={{ fontSize: 11, fontWeight: 600, color: 'var(--c-text)', fontFamily: FONT }}>document.pdf</div><div style={{ fontSize: 9.5, color: 'var(--c-textMuted)', marginTop: 1, fontFamily: FONT }}>PDF · 1 page</div></div></div>
            )}
            {headerType === 'TEXT' && headerText && <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-text)', marginBottom: 4, lineHeight: 1.4, fontFamily: FONT }}>{headerText}</div>}
            {bodyText && <div style={{ fontSize: 13.5, color: 'var(--c-text)', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: FONT }}>{bodyText}</div>}
            {securityRec && <div style={{ fontSize: 11, color: 'var(--c-textSecondary)', marginTop: 4, fontFamily: FONT }}>🔒 For your security, do not share this code.</div>}
            {codeExpiry && <div style={{ fontSize: 11, color: 'var(--c-textSecondary)', marginTop: 2, fontFamily: FONT }}>⏱ This code expires in {codeExpiry} minute{+codeExpiry !== 1 ? 's' : ''}.</div>}
            {footerText && <div style={{ fontSize: 11.5, color: 'var(--c-textSecondary)', marginTop: 4, fontFamily: FONT }}>{footerText}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 3, marginTop: 2, marginBottom: -1 }}>
              <span style={{ fontSize: 10.5, color: 'var(--c-textSecondary)', fontFamily: FONT }}>9:41</span>
              <svg width="16" height="11" viewBox="0 0 16 11" fill="none"><path d="M1 5.5L5 9.5L11.5 1" stroke="#53BDEB" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /><path d="M5 5.5L9 9.5L15.5 1" stroke="#53BDEB" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
          </div>
          {hasButtons && (
            <div style={{ background: 'var(--c-cardBg)', borderRadius: '0 0 7.5px 7.5px', overflow: 'hidden', boxShadow: '0 1px 0.5px rgba(11,20,26,.13)' }}>
              {buttons.map((btn, i) => (
                <div key={i} style={{ padding: '9px 14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, borderTop: '1px solid rgba(0,0,0,.07)' }}>
                  {bIcon(btn.type)}
                  <span style={{ fontSize: 13, fontWeight: 500, color: B.waHeader, fontFamily: FONT }}>{bLabel(btn)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </PhoneFrame>
  );
}




// ─── Buttons Section ──────────────────────────────────────────────────────────
function ButtonsSection({ buttons, onAdd, onRemove, onUpdate, category, errors }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isAuth = category === 'AUTHENTICATION';
  const urlCount = buttons.filter(b => b.type === 'URL').length;
  const phoneCount = buttons.filter(b => b.type === 'PHONE_NUMBER').length;
  const hasOtp = buttons.some(b => b.type === 'OTP');

  const couponCount = buttons.filter(b => b.type === 'COPY_CODE').length;
  const menuOpts = isAuth
    ? [{ type: 'OTP', icon: <KeyRound size={16} />, label: 'OTP / Copy Code', hint: 'Auto-fill one-time password', disabled: hasOtp, disabledMsg: 'Already added' }]
    : [
        { type: 'QUICK_REPLY', icon: <Reply size={16} />, label: 'Quick Reply', hint: 'User taps to reply', disabled: false },
        { type: 'URL', icon: <Link size={16} />, label: 'Visit Website', hint: 'Opens a URL', disabled: urlCount >= 2, disabledMsg: 'Max 2 URL buttons' },
        { type: 'PHONE_NUMBER', icon: <Phone size={16} />, label: 'Call Phone', hint: 'Dials a number', disabled: phoneCount >= 1, disabledMsg: 'Max 1 phone button' },
        { type: 'COPY_CODE', icon: <KeyRound size={16} />, label: 'Copy Coupon Code', hint: 'One-tap copy of a promo code', disabled: couponCount >= 1, disabledMsg: 'Max 1 coupon button' },
      ];

  const tColor = { QUICK_REPLY: B.accent, URL: '#1565C0', PHONE_NUMBER: B.green, OTP: B.green, COPY_CODE: '#8E24AA' };
  const tBg = { QUICK_REPLY: B.accentBg, URL: '#E3F2FD', PHONE_NUMBER: B.greenBg, OTP: B.greenBg };
  const tLabel = { QUICK_REPLY: '↩ Quick Reply', URL: '🔗 Visit Website', PHONE_NUMBER: '📞 Call Phone', OTP: '🔑 OTP / Copy Code' };

  return (
    <Sec n={6} title="Buttons" note="optional">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: B.t5, fontFamily: FONT }}>
          {isAuth ? 'Auth templates: OTP buttons only.' : `${buttons.length}/3 buttons.`}
          {errors.btnMaxUrl && <span style={{ color: B.red, marginLeft: 6 }}>⚠ {errors.btnMaxUrl}</span>}
          {errors.btnMaxPhone && <span style={{ color: B.red, marginLeft: 6 }}>⚠ {errors.btnMaxPhone}</span>}
        </div>
        {buttons.length < 3 && !(isAuth && hasOtp) && (
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              style={{ padding: '7px 14px', background: 'var(--c-cardBg)', border: '1.5px solid #D5D5D0', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: FONT, color: '#444', transition: 'all .15s', display: 'flex', alignItems: 'center', gap: 5 }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = B.accent; e.currentTarget.style.color = B.accent; e.currentTarget.style.background = B.accentBg; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#D5D5D0'; e.currentTarget.style.color = '#444'; e.currentTarget.style.background = '#fff'; }}
            >+ Add Button</button>
            {menuOpen && (
              <div style={{ position: 'absolute', right: 0, top: '110%', background: 'var(--c-cardBg)', border: '1px solid var(--c-border)', borderRadius: 10, padding: 6, boxShadow: '0 8px 32px rgba(0,0,0,.12)', zIndex: 50, minWidth: 200 }}>
                {menuOpts.map(o => (
                  <button key={o.type} disabled={o.disabled}
                    onClick={() => { if (!o.disabled) { onAdd(o.type); setMenuOpen(false); } }}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 12px', border: 'none', background: 'none', fontSize: 12, fontFamily: FONT, cursor: o.disabled ? 'not-allowed' : 'pointer', fontWeight: 600, borderRadius: 8, color: o.disabled ? '#bbb' : B.t2, transition: 'background .1s' }}
                    onMouseEnter={e => { if (!o.disabled) e.currentTarget.style.background = B.bg; }}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                    <span style={{ fontSize: 16 }}>{o.icon}</span>
                    <div><div>{o.label}</div><div style={{ fontSize: 10, color: o.disabled ? '#ccc' : B.t6, fontWeight: 500 }}>{o.disabled ? o.disabledMsg : o.hint}</div></div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {buttons.length === 0 && <div style={{ textAlign: 'center', padding: '14px 0', color: '#bbb', fontSize: 12, fontFamily: FONT }}>No buttons added yet.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {buttons.map((btn, i) => {
          const urlVars = btn.type === 'URL' ? extractVars(btn.value || '') : [];
          const hasErr = errors[`btn_url_${i}`] || errors[`btn_phone_${i}`] || errors[`btn_urlsample_${i}`] || errors[`btn_text_${i}`];
          return (
            <div key={i} style={{ border: `1.5px solid ${hasErr ? B.red + '44' : B.innerBorder}`, borderRadius: 10, padding: '12px 14px', background: B.innerBg }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: tBg[btn.type], color: tColor[btn.type], fontFamily: FONT }}>{tLabel[btn.type]}</span>
                <button onClick={() => onRemove(i)} style={{ width: 22, height: 22, borderRadius: 99, background: B.redBg, border: 'none', cursor: 'pointer', color: B.red, fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>×</button>
              </div>
              {btn.type === 'OTP' ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <Lbl>Button Text</Lbl>
                    <input style={{ border: '1.5px solid #D5D5D0', borderRadius: 8, padding: '7px 12px', fontSize: 12, fontFamily: FONT, width: '100%', background: 'var(--c-cardBg)', color: 'var(--c-text)', outline: 'none' }} placeholder="Copy Code" value={btn.text || ''} maxLength={25} onChange={e => onUpdate(i, 'text', e.target.value)} />
                  </div>
                  <div>
                    <Lbl>OTP Type</Lbl>
                    <select style={{ border: '1.5px solid #D5D5D0', borderRadius: 8, padding: '7px 12px', fontSize: 12, fontFamily: FONT, width: '100%', background: 'var(--c-cardBg)', color: 'var(--c-text)', outline: 'none', cursor: 'pointer', appearance: 'none' }} value={btn.otpType || 'COPY_CODE'} onChange={e => onUpdate(i, 'otpType', e.target.value)}>
                      <option value="COPY_CODE">Copy Code</option>
                      <option value="ONE_TAP">One Tap (Android)</option>
                    </select>
                  </div>
                  {btn.otpType === 'ONE_TAP' && (
                    <>
                      <div><Lbl note="Android only">Package Name</Lbl><input style={{ border: '1.5px solid #D5D5D0', borderRadius: 8, padding: '7px 12px', fontSize: 12, fontFamily: FONT, width: '100%', background: 'var(--c-cardBg)', color: 'var(--c-text)', outline: 'none' }} placeholder="com.example.app" value={btn.packageName || ''} onChange={e => onUpdate(i, 'packageName', e.target.value)} /></div>
                      <div><Lbl>Signature Hash</Lbl><input style={{ border: '1.5px solid #D5D5D0', borderRadius: 8, padding: '7px 12px', fontSize: 12, fontFamily: FONT, width: '100%', background: 'var(--c-cardBg)', color: 'var(--c-text)', outline: 'none' }} placeholder="K8a%2FAINcGX7" value={btn.signatureHash || ''} onChange={e => onUpdate(i, 'signatureHash', e.target.value)} /></div>
                    </>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: btn.type === 'QUICK_REPLY' ? '1fr' : '1fr 1fr', gap: 8 }}>
                    <div>
                      <Lbl required>Button Text</Lbl>
                      <input style={{ border: `1.5px solid ${errors[`btn_text_${i}`] ? B.red : '#D5D5D0'}`, borderRadius: 8, padding: '7px 12px', fontSize: 12, fontFamily: FONT, width: '100%', background: 'var(--c-cardBg)', color: 'var(--c-text)', outline: 'none' }}
                        placeholder={btn.type === 'QUICK_REPLY' ? 'e.g. Yes, Confirm' : btn.type === 'URL' ? 'e.g. View Order' : 'e.g. Call Us'}
                        value={btn.text || ''} maxLength={25} onChange={e => onUpdate(i, 'text', e.target.value)} />
                      <div style={{ fontSize: 10, color: B.t7, textAlign: 'right', marginTop: 2, fontFamily: "'DM Mono', monospace" }}>{(btn.text || '').length}/25</div>
                    </div>
                    {btn.type !== 'QUICK_REPLY' && (
                      <div>
                        <Lbl required>{btn.type === 'URL' ? 'Website URL' : 'Phone Number (E.164)'}</Lbl>
                        <input style={{ border: `1.5px solid ${errors[`btn_url_${i}`] || errors[`btn_phone_${i}`] ? B.red : '#D5D5D0'}`, borderRadius: 8, padding: '7px 12px', fontSize: 12, fontFamily: FONT, width: '100%', background: 'var(--c-cardBg)', color: 'var(--c-text)', outline: 'none' }}
                          placeholder={btn.type === 'URL' ? 'https://example.com/orders/{{1}}' : '+919876543210'}
                          value={btn.value || ''} onChange={e => onUpdate(i, 'value', e.target.value)} />
                        {errors[`btn_url_${i}`] && <Hint error>{errors[`btn_url_${i}`]}</Hint>}
                        {errors[`btn_phone_${i}`] && <Hint error>{errors[`btn_phone_${i}`]}</Hint>}
                        {btn.type === 'URL' && !errors[`btn_url_${i}`] && <Hint>Optional use {'{{1}}'} in URL for dynamic path</Hint>}
                        {btn.type === 'PHONE_NUMBER' && !errors[`btn_phone_${i}`] && <Hint>Include country code e.g. +919876543210</Hint>}
                      </div>
                    )}
                  </div>
                  {btn.type === 'URL' && urlVars.length > 0 && (
                    <div style={{ padding: '10px 12px', background: B.sectionBg, border: `1px solid ${errors[`btn_urlsample_${i}`] ? B.red + '44' : B.sectionBorder}`, borderRadius: 8 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: B.t4, marginBottom: 6, fontFamily: FONT }}>
                        URL has <span style={{ fontFamily: "'DM Mono', monospace", background: B.accentBg, padding: '1px 5px', borderRadius: 4, fontSize: 11, color: B.accentDark }}>{'{{1}}'}</span> — provide a sample URL:
                      </div>
                      <input style={{ border: `1.5px solid ${errors[`btn_urlsample_${i}`] ? B.red : '#D5D5D0'}`, borderRadius: 8, padding: '7px 12px', fontSize: 12, fontFamily: FONT, width: '100%', background: 'var(--c-cardBg)', color: 'var(--c-text)', outline: 'none' }}
                        placeholder="https://example.com/orders/ORD-12345"
                        value={btn.urlSample || ''} onChange={e => onUpdate(i, 'urlSample', e.target.value)} />
                      {errors[`btn_urlsample_${i}`] && <Hint error>{errors[`btn_urlsample_${i}`]}</Hint>}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Sec>
  );
}


// ─── List View ────────────────────────────────────────────────────────────────
function TemplateList({ templates, loading, onAdd, onEdit, onDelete, onView, onBulkDelete, onDuplicate, onBulkSubmit, onSyncAll, syncingAll, accounts, groupByTranslation, onToggleGroup }) {
  const [deleteModal, setDeleteModal] = useState({ open: false, template: null });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Apply text/status filters first
  const filteredFlat = useMemo(() => {
    let list = templates;
    if (statusFilter !== 'all') list = list.filter(t => t.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(t =>
        t.name.toLowerCase().includes(q) ||
        (t.body || '').toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        t.status.toLowerCase().includes(q)
      );
    }
    return list;
  }, [templates, search, statusFilter]);

  // Group by template_group_key when toggle is on. Each "row" in the displayed
  // list is either a single template (no siblings) or a group representative
  // with siblings collected.
  const filtered = useMemo(() => {
    if (!groupByTranslation) return filteredFlat;
    const groups = new Map();
    for (const t of filteredFlat) {
      const key = t.template_group_key || `__${t.id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t);
    }
    // Pick the most-recently-updated row as the representative; attach siblings
    return Array.from(groups.values()).map(siblings => {
      const sorted = [...siblings].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
      return { ...sorted[0], _siblings: sorted };
    });
  }, [filteredFlat, groupByTranslation]);

  const sel = useTableSelection(filtered);

  // Count each status for the filter chips
  const counts = useMemo(() => {
    const c = { all: templates.length, DRAFT: 0, SUBMITTED: 0, APPROVED: 0, REJECTED: 0, PAUSED: 0, DISABLED: 0 };
    templates.forEach(t => { if (c[t.status] != null) c[t.status]++; });
    return c;
  }, [templates]);

  const selectedDrafts = useMemo(
    () => filtered.filter(t => sel.isSelected(t.id) && (t.status === 'DRAFT' || t.status === 'REJECTED')),
    [filtered, sel]
  );

  const chipStyle = (active) => ({
    padding: '6px 12px', borderRadius: 99, fontSize: 12, fontWeight: 600, fontFamily: FONT,
    border: `1px solid ${active ? C.primary : '#D5D5D0'}`,
    background: active ? C.primary : 'var(--c-cardBg)',
    color: active ? '#fff' : B.t3, cursor: 'pointer',
  });

  return (
    <div style={{ padding: 24, fontFamily: FONT }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: B.t1, margin: 0, letterSpacing: '-.02em' }}>Message Templates</h1>
          <p style={{ fontSize: 12, color: B.t5, margin: '4px 0 0' }}>Create and manage WhatsApp message templates.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={onSyncAll}
            disabled={syncingAll}
            style={{ padding: '9px 14px', background: 'var(--c-cardBg)', color: B.t3, border: `1px solid ${B.cardBorder}`, borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: syncingAll ? 'wait' : 'pointer', fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            {syncingAll ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Search size={13} />}
            Refresh All from Meta
          </button>
          <button
            onClick={onAdd}
            style={{ padding: '10px 18px', background: C.primary, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 6, transition: 'background .15s' }}
            onMouseEnter={e => e.currentTarget.style.background = C.primaryHover}
            onMouseLeave={e => e.currentTarget.style.background = C.primary}
          >
            <Plus size={16} /> Add Template
          </button>
        </div>
      </div>

      {/* Status filter chips */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {[
          { k: 'all', label: 'All' },
          { k: 'DRAFT', label: 'Draft' },
          { k: 'SUBMITTED', label: 'Pending' },
          { k: 'APPROVED', label: 'Approved' },
          { k: 'REJECTED', label: 'Rejected' },
          { k: 'PAUSED', label: 'Paused' },
          { k: 'DISABLED', label: 'Disabled' },
        ].map(c => (
          <button key={c.k} onClick={() => setStatusFilter(c.k)} style={chipStyle(statusFilter === c.k)}>
            {c.label} <span style={{ opacity: 0.7, marginLeft: 4 }}>{counts[c.k]}</span>
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 1 360px', minWidth: 220 }}>
          <Search size={16} color={B.t6} />
          <input
            style={{ flex: 1, border: '1.5px solid #D5D5D0', borderRadius: 8, padding: '8px 12px', fontSize: 13, fontFamily: FONT, background: 'var(--c-cardBg)', color: 'var(--c-text)', outline: 'none' }}
            placeholder="Search by name or body…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: B.t4, fontFamily: FONT, cursor: 'pointer' }}>
          <input type="checkbox" checked={groupByTranslation} onChange={e => onToggleGroup(e.target.checked)} />
          Group translations
        </label>
        {selectedDrafts.length > 0 && (
          <button
            onClick={() => onBulkSubmit(selectedDrafts.map(t => t.id))}
            style={{ padding: '8px 14px', background: B.green, color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Send size={13} /> Submit {selectedDrafts.length} draft{selectedDrafts.length > 1 ? 's' : ''} to Meta
          </button>
        )}
        <BulkDeleteButton sel={sel} label="template" onConfirm={(ids) => onBulkDelete(ids)} />
      </div>

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60, gap: 8 }}>
          <Loader2 size={18} className="spin" style={{ animation: 'spin 1s linear infinite' }} /> <span style={{ fontSize: 13, color: B.t5, fontFamily: FONT }}>Loading...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', background: B.card, border: `1px solid ${B.cardBorder}`, borderRadius: 12 }}>
          <LayoutTemplate size={40} color="#ccc" style={{ marginBottom: 12 }} />
          <div style={{ fontSize: 15, fontWeight: 600, color: B.t3, marginBottom: 4, fontFamily: FONT }}>No templates yet</div>
          <div style={{ fontSize: 12, color: B.t6, marginBottom: 16, fontFamily: FONT }}>Create your first WhatsApp message template.</div>
          <button
            onClick={onAdd}
            style={{ padding: '10px 18px', background: C.primary, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: FONT, display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Plus size={16} /> Add Template
          </button>
        </div>
      ) : (
        <div style={{ background: B.card, border: `1px solid ${B.cardBorder}`, borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT }}>
            <thead>
              <tr style={{ background: B.innerBg, borderBottom: `1px solid ${B.cardBorder}` }}>
                <th style={{ padding: '10px 14px', width: 36 }}><SelectAllCheckbox sel={sel} /></th>
                {['Name', 'Account', 'Category', 'Language', 'Status', 'Sent', 'Created', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', fontSize: 11, fontWeight: 700, color: B.t4, textAlign: 'left', textTransform: 'uppercase', letterSpacing: '.06em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => {
                const cat = CATEGORIES.find(c => c.id === t.category);
                const canEdit = ['DRAFT', 'REJECTED', 'APPROVED', 'PAUSED'].includes(t.status);
                return (
                  <tr key={t.id} style={{ borderBottom: `1px solid ${B.rowSep}`, background: sel.isSelected(t.id) ? '#FDF6F6' : 'transparent' }}>
                    <td style={{ padding: '12px 14px', width: 36 }}><RowCheckbox sel={sel} id={t.id} label={t.name} /></td>
                    <td style={{ padding: '12px 14px', fontSize: 13, fontWeight: 600, color: B.t2, fontFamily: FONT }}>{t.name}</td>
                    <td style={{ padding: '12px 14px' }}>
                      {t.whatsappAccountName ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: B.t2, fontFamily: FONT }}>{t.whatsappAccountName}</span>
                          <span style={{ fontSize: 10, color: B.t6, fontFamily: 'DM Mono, monospace' }}>{maskPhone(t.whatsappAccountPhone)}</span>
                        </div>
                      ) : (
                        <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 99, background: '#FFF3E0', color: '#E65100', fontWeight: 600, fontFamily: FONT }}>Unassigned</span>
                      )}
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 4, background: cat?.bg || B.innerBg, color: cat?.color || B.t4, fontSize: 11, fontWeight: 700, fontFamily: FONT }}>
                        {cat && <cat.icon size={12} />} {cat?.label || t.category}
                      </span>
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: 12, color: B.t4, fontFamily: FONT }}>
                      {t._siblings && t._siblings.length > 1 ? (
                        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                          {t._siblings.map(s => (
                            <button
                              key={s.id}
                              onClick={(e) => { e.stopPropagation(); onView(s); }}
                              title={`Open ${s.language} variant (${s.status})`}
                              style={{
                                fontSize: 10, padding: '2px 7px', borderRadius: 99,
                                border: `1px solid ${STATUSES[s.status]?.bg || '#eee'}`,
                                background: s.id === t.id ? STATUSES[s.status]?.bg : 'var(--c-cardBg)',
                                color: STATUSES[s.status]?.color || B.t5,
                                fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase',
                                fontFamily: 'DM Mono, monospace',
                              }}
                            >{s.language}</button>
                          ))}
                        </div>
                      ) : (
                        <span style={{ textTransform: 'uppercase' }}>{t.language}</span>
                      )}
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <StatusBadge status={t.status} />
                      {t.quality_score && QUALITY_STYLES[t.quality_score] && (
                        <div style={{ fontSize: 10, marginTop: 3, color: QUALITY_STYLES[t.quality_score].color, fontFamily: FONT, fontWeight: 600 }}>● {t.quality_score}</div>
                      )}
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: 12, color: B.t4, fontFamily: FONT }}>
                      <div style={{ fontWeight: 600, color: B.t2 }}>{t.sendCount || 0}</div>
                      {t.broadcastCount > 0 && <div style={{ fontSize: 10, color: B.t6 }}>in {t.broadcastCount} broadcast{t.broadcastCount > 1 ? 's' : ''}</div>}
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: 11, color: B.t6, fontFamily: FONT, whiteSpace: 'nowrap' }}>{new Date(t.created_at).toLocaleDateString()}</td>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {canEdit && (
                          <button onClick={() => onEdit(t)} title="Edit" style={{ width: 28, height: 28, borderRadius: 6, border: '1.5px solid #D5D5D0', background: 'var(--c-cardBg)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: B.t4 }}>
                            <Pencil size={13} />
                          </button>
                        )}
                        <button onClick={() => onView(t)} title="View" style={{ width: 28, height: 28, borderRadius: 6, border: '1.5px solid #D5D5D0', background: 'var(--c-cardBg)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: B.t4 }}>
                          <Eye size={13} />
                        </button>
                        <button onClick={() => onDuplicate(t)} title="Duplicate" style={{ width: 28, height: 28, borderRadius: 6, border: '1.5px solid #D5D5D0', background: 'var(--c-cardBg)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: B.t4 }}>
                          <Plus size={13} />
                        </button>
                        <button onClick={() => setDeleteModal({ open: true, template: t })} title="Delete" style={{ width: 28, height: 28, borderRadius: 6, border: '1.5px solid #D5D5D0', background: 'var(--c-cardBg)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: B.red }}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <DeleteConfirmModal
        open={deleteModal.open}
        title="Delete Template"
        message={`Are you sure you want to delete "${deleteModal.template?.name}"? This cannot be undone.`}
        onConfirm={() => { onDelete(deleteModal.template?.id); setDeleteModal({ open: false, template: null }); }}
        onCancel={() => setDeleteModal({ open: false, template: null })}
      />
    </div>
  );
}


// ─── Builder View ─────────────────────────────────────────────────────────────
function BuilderView({ template, onBack, onSave, readOnly, accounts }) {
  const isEdit = !!template;
  const defaultAccountId = accounts?.find(a => a.isDefault)?.id || accounts?.[0]?.id || null;
  const [whatsappAccountId, setWhatsappAccountId] = useState(template?.whatsappAccountId ?? defaultAccountId);
  const [name, setName] = useState(template?.name || '');
  const [category, setCategory] = useState(template?.category || 'MARKETING');
  const [language, setLanguage] = useState(template?.language || 'en');
  const [headerType, setHeaderType] = useState(template?.header_type || 'NONE');
  const [headerText, setHeaderText] = useState(template?.header_text || '');
  const [mediaHandle, setMediaHandle] = useState(template?.media_handle || '');
  const [libPickerOpen, setLibPickerOpen] = useState(false);
  const [libSourceName, setLibSourceName] = useState('');  // shown as "From library: foo.jpg" chip
  const [headerMediaLibraryId, setHeaderMediaLibraryId] = useState(template?.header_media_library_id || null);
  const [headerMediaItems, setHeaderMediaItems] = useState([]);
  const [headerMediaUploading, setHeaderMediaUploading] = useState(false);

  useEffect(() => {
    if (!['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerType)) { setHeaderMediaItems([]); return; }
    api.mediaLibrary.list(whatsappAccountId).then(r => {
      const target = headerType === 'IMAGE' ? 'image' : headerType === 'VIDEO' ? 'video' : 'document';
      setHeaderMediaItems((r.media || []).filter(m => m.mediaType === target));
    }).catch(() => setHeaderMediaItems([]));
  }, [headerType, whatsappAccountId]);
  const [body, setBody] = useState(template?.body || '');
  const [footer, setFooter] = useState(template?.footer || '');
  const [buttons, setButtons] = useState(template?.buttons || []);
  const [samples, setSamples] = useState(template?.samples || {});
  const [securityRec, setSecurityRec] = useState(template?.security_recommendation || false);
  const [codeExpiry, setCodeExpiry] = useState(template?.code_expiry_minutes?.toString() || '');
  const [allowCatChange, setAllowCatChange] = useState(template?.allow_category_change !== false);
  const [status, setStatus] = useState(template?.status || 'DRAFT');
  const [templateId, setTemplateId] = useState(template?.meta_template_id || '');
  const [submittedAt, setSubmittedAt] = useState(template?.submitted_at || '');
  const [showErrors, setShowErrors] = useState(false);
  const [showPayload, setShowPayload] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef(null);

  const bodyVars = extractVars(body);
  const hdrVars = headerType === 'TEXT' ? extractVars(headerText) : [];
  const allVars = [...new Set([...hdrVars, ...bodyVars])].sort((a, b) => +a - +b);
  const previewBody = applyVars(body, samples);
  const previewHeader = applyVars(headerText, samples);

  const errors = useMemo(() => runValidation({ name, body, headerType, headerText, mediaHandle, footer, buttons, samples, category, codeExpiry }), [name, body, headerType, headerText, mediaHandle, footer, buttons, samples, category, codeExpiry]);
  const errCount = Object.keys(errors).length;
  const canSubmit = errCount === 0;
  // Approved-edit mode: template exists on Meta + status is APPROVED/PAUSED.
  // We can change content but Meta locks name/language and re-reviews after every edit.
  const isApprovedEdit = isEdit && ['APPROVED', 'PAUSED'].includes(status);

  const payload = useMemo(() => buildPayload({ name, category, language, headerType, headerText, mediaHandle, body, footer, buttons, samples, securityRec, codeExpiry, allowCatChange }), [name, category, language, headerType, headerText, mediaHandle, body, footer, buttons, samples, securityRec, codeExpiry, allowCatChange]);

  const insertVar = () => {
    const next = bodyVars.length + 1;
    const ta = bodyRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const tag = `{{${next}}}`;
    setBody(body.slice(0, s) + tag + body.slice(e));
    setTimeout(() => { ta.focus(); ta.setSelectionRange(s + tag.length, s + tag.length); }, 10);
  };

  const wrapFmt = (w) => {
    const ta = bodyRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const sel = body.slice(s, e);
    setBody(body.slice(0, s) + `${w}${sel}${w}` + body.slice(e));
  };

  const handleSave = async (markStatus = 'DRAFT') => {
    setShowErrors(true);
    if (!canSubmit && markStatus !== 'DRAFT') return;
    setSaving(true);
    try {
      const data = {
        name, category, language, header_type: headerType, header_text: headerText || null,
        media_handle: mediaHandle || null, header_media_library_id: headerMediaLibraryId || null,
        body, footer: footer || null,
        buttons, samples, security_recommendation: securityRec,
        code_expiry_minutes: codeExpiry ? parseInt(codeExpiry) : null,
        allow_category_change: allowCatChange,
        whatsappAccountId: whatsappAccountId || null,
      };
      let result;
      if (isEdit) {
        result = await api.templates.update(template.id, data);
      } else {
        result = await api.templates.create(data);
      }
      // For APPROVED/PAUSED edits the PUT already calls Meta and sets status=SUBMITTED.
      // For DRAFT creates we still need the explicit /submit step.
      if (markStatus === 'SUBMITTED' && result.id && !isApprovedEdit) {
        await api.templates.submit(result.id);
        result = await api.templates.get(result.id);
      }
      onSave(result);
    } catch (err) {
      alert(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = () => handleSave('SUBMITTED');

  // Test send dialog state
  const [testOpen, setTestOpen] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [testSampleValues, setTestSampleValues] = useState({});
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState(null);

  // Add Translation modal state
  const [translationOpen, setTranslationOpen] = useState(false);
  const [translationLang, setTranslationLang] = useState('hi');
  const [translationSaving, setTranslationSaving] = useState(false);
  const [translationResult, setTranslationResult] = useState(null);

  const handleAddTranslation = async () => {
    if (!template?.id || !translationLang) return;
    setTranslationSaving(true);
    setTranslationResult(null);
    try {
      // Create a sibling row (same name, same group, different language, DRAFT)
      const data = {
        name: template.name,
        category, language: translationLang,
        header_type: headerType, header_text: headerText || null,
        media_handle: mediaHandle || null, header_media_library_id: headerMediaLibraryId || null,
        body, footer: footer || null,
        buttons, samples, security_recommendation: securityRec,
        code_expiry_minutes: codeExpiry ? parseInt(codeExpiry) : null,
        allow_category_change: allowCatChange,
        whatsappAccountId: whatsappAccountId || null,
      };
      const created = await api.templates.create(data);
      setTranslationResult({ ok: true, msg: `Created ${translationLang} translation (id ${created.id}) — edit the body to translate.` });
      setTimeout(() => setTranslationOpen(false), 1500);
    } catch (err) {
      setTranslationResult({ ok: false, msg: err.message || 'Add translation failed' });
    } finally {
      setTranslationSaving(false);
    }
  };

  const handleTestSend = async () => {
    if (!testTo.trim() || !template?.id) return;
    setTestSending(true);
    setTestResult(null);
    try {
      const res = await api.testTemplate(template.id, testTo.trim(), testSampleValues);
      setTestResult({ ok: true, msg: `Queued — local id ${res.messageId}` });
    } catch (err) {
      setTestResult({ ok: false, msg: err.message || 'Test send failed' });
    } finally {
      setTestSending(false);
    }
  };

  const copyPayload = () => {
    navigator.clipboard?.writeText(JSON.stringify(payload, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCategoryChange = (cat) => {
    setCategory(cat);
    if (cat === 'AUTHENTICATION') {
      setButtons([]);
      if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerType)) setHeaderType('NONE');
    } else {
      setButtons(prev => prev.filter(b => b.type !== 'OTP'));
    }
  };

  const st = STATUSES[status];
  const isAuth = category === 'AUTHENTICATION';

  const checklist = [
    ['name', 'Valid template name', !errors.name && !!name, true],
    ['body', 'Body text filled', !errors.body && !!body.trim(), true],
    ['samples', 'All variable samples filled', !errors.bodySamples && !errors.headerSamples, allVars.length > 0],
    ['media', 'Media file handle provided', !errors.mediaHandle, ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerType)],
    ['hdrVar', 'Header has max 1 variable', !errors.headerVars, headerType === 'TEXT'],
    ['footer', 'Footer has no variables', !errors.footer, !!footer],
    ['btnValid', 'Buttons valid', !errors.btnMaxUrl && !errors.btnMaxPhone && !Object.keys(errors).some(k => k.startsWith('btn_')), buttons.length > 0],
    ['auth', 'Auth fields valid', !errors.codeExpiry, isAuth],
  ].filter(([,,, show]) => show !== false);

  // Input styles
  const inpStyle = { border: '1.5px solid #D5D5D0', borderRadius: 10, padding: '9px 14px', fontSize: 13, fontFamily: FONT, width: '100%', background: 'var(--c-cardBg)', color: 'var(--c-text)', outline: 'none', transition: 'border .15s' };
  const inpErrStyle = { ...inpStyle, borderColor: B.red };
  const selStyle = { ...inpStyle, cursor: 'pointer', appearance: 'none' };
  const taStyle = { ...inpStyle, resize: 'vertical', lineHeight: 1.65 };
  const taErrStyle = { ...taStyle, borderColor: B.red };
  const btnPriStyle = { padding: '10px 22px', background: B.accent, color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: FONT, transition: 'all .15s', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' };
  const btnGhostStyle = { padding: '7px 14px', background: 'var(--c-cardBg)', border: '1.5px solid #D5D5D0', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: FONT, color: '#444', transition: 'all .15s', display: 'flex', alignItems: 'center', gap: 5 };
  const hdrTabStyle = { padding: '7px 14px', borderRadius: 99, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1.5px solid #D5D5D0', background: 'var(--c-cardBg)', color: '#444', transition: 'all .15s', display: 'flex', alignItems: 'center', gap: 5, fontFamily: FONT };
  const hdrTabOnStyle = { ...hdrTabStyle, background: '#111', color: '#fff', borderColor: 'var(--c-text)' };
  const catCardStyle = { border: '2px solid var(--c-border)', borderRadius: 12, padding: '14px 16px', cursor: 'pointer', background: 'var(--c-cardBg)', transition: 'all .18s', textAlign: 'left', width: '100%', fontFamily: FONT };
  const catCardOnStyle = { ...catCardStyle, borderColor: B.accent, background: B.accentBg };

  return (
    <div style={{ fontFamily: FONT, background: B.bg, minHeight: '100%', padding: '24px 16px' }}>
      <div>

        {/* Header */}
        <div style={{ marginBottom: 20, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-.03em', color: B.t1, margin: 0, fontFamily: FONT }}>Message Template Builder</h1>
            <div style={{ fontSize: 12, color: B.t5, marginTop: 4, fontFamily: FONT }}>{readOnly ? 'Viewing template — read only' : 'Fill all required fields to submit for Meta approval.'}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={onBack} style={{ ...btnGhostStyle }}><ArrowLeft size={14} /> Back</button>
            <StatusBadge status={status} />
            {status === 'REJECTED' && !readOnly && <button style={{ ...btnGhostStyle, fontSize: 12 }} onClick={() => setStatus('DRAFT')}>Reset to Draft</button>}
            {showErrors && errCount > 0 && <span style={{ fontSize: 11, color: B.red, fontWeight: 600, fontFamily: FONT }}>⚠ {errCount} issue{errCount > 1 ? 's' : ''}</span>}
            {!readOnly && (
              <button
                style={{ ...btnPriStyle, background: canSubmit ? B.green : '#ccc' }}
                onClick={isApprovedEdit ? () => handleSave('DRAFT') : handleSubmit}
                disabled={saving}
                title={isApprovedEdit ? 'Saves edits to Meta — template re-enters review' : 'Submit template for Meta review'}
              >
                {saving
                  ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                  : <Send size={14} />}
                {' '}{isApprovedEdit ? 'Save Changes (Re-submit)' : 'Submit for Approval'}
              </button>
            )}
            {status === 'APPROVED' && template?.id && (
              <button style={{ ...btnGhostStyle }} onClick={() => setTestOpen(true)}>
                <Send size={13} /> Test Send
              </button>
            )}
            {template?.id && !readOnly && (
              <button style={{ ...btnGhostStyle }} onClick={() => setTranslationOpen(true)}>
                <Plus size={13} /> Add Translation
              </button>
            )}
          </div>
        </div>

        {/* Add Translation modal — duplicates this template into a new language */}
        {translationOpen && (
          <div onClick={() => setTranslationOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'var(--c-cardBg)', borderRadius: 14, width: 440, padding: 22, boxShadow: C.shadowLg, fontFamily: FONT }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>Add translation for {template.name}</div>
                <button onClick={() => setTranslationOpen(false)} style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}><X size={18} /></button>
              </div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: B.t4, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.05em' }}>Target language</div>
                <select value={translationLang} onChange={e => setTranslationLang(e.target.value)} style={{ width: '100%', padding: '8px 12px', border: '1px solid #D5D5D0', borderRadius: 8, fontSize: 13, fontFamily: FONT, outline: 'none', background: 'var(--c-cardBg)', color: B.t2, boxSizing: 'border-box' }}>
                  {LANGUAGES.filter(l => l.code !== template.language).map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                </select>
                <div style={{ fontSize: 11, color: B.t6, marginTop: 6 }}>
                  Creates a new DRAFT with the same content, grouped under the same template name. Edit the body to translate, then submit.
                </div>
              </div>
              {translationResult && (
                <div style={{ marginBottom: 12, padding: '8px 10px', borderRadius: 8, fontSize: 12, background: translationResult.ok ? B.greenBg : 'var(--c-primaryLight)', color: translationResult.ok ? B.green : B.red }}>
                  {translationResult.ok ? '✓ ' : '⚠ '}{translationResult.msg}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button onClick={() => setTranslationOpen(false)} style={{ ...btnGhostStyle }}>Cancel</button>
                <button onClick={handleAddTranslation} disabled={translationSaving} style={{ ...btnPriStyle, background: translationSaving ? '#ccc' : B.green }}>
                  {translationSaving ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={13} />} Create
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Test send modal */}
        {testOpen && (
          <div onClick={() => setTestOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'var(--c-cardBg)', borderRadius: 14, width: 440, padding: 22, boxShadow: C.shadowLg, fontFamily: FONT }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>Test Send: {template.name}</div>
                <button onClick={() => setTestOpen(false)} style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}><X size={18} /></button>
              </div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: B.t4, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.05em' }}>Recipient phone</div>
                <input value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="+919xxxxxxxxx" style={{ width: '100%', padding: '8px 12px', border: '1px solid #D5D5D0', borderRadius: 8, fontSize: 13, fontFamily: FONT, outline: 'none', boxSizing: 'border-box' }} />
              </div>
              {bodyVars.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: B.t4, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.05em' }}>Body variable values</div>
                  {bodyVars.map(v => (
                    <input
                      key={v}
                      value={testSampleValues[v] || samples[v] || ''}
                      onChange={e => setTestSampleValues({ ...testSampleValues, [v]: e.target.value })}
                      placeholder={`{{${v}}}`}
                      style={{ width: '100%', padding: '7px 12px', border: '1px solid #D5D5D0', borderRadius: 8, fontSize: 12, fontFamily: FONT, outline: 'none', marginTop: 4, boxSizing: 'border-box' }}
                    />
                  ))}
                </div>
              )}
              {testResult && (
                <div style={{ marginBottom: 12, padding: '8px 10px', borderRadius: 8, fontSize: 12, background: testResult.ok ? B.greenBg : 'var(--c-primaryLight)', color: testResult.ok ? B.green : B.red }}>
                  {testResult.ok ? '✓ ' : '⚠ '}{testResult.msg}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button onClick={() => setTestOpen(false)} style={{ ...btnGhostStyle }}>Close</button>
                <button onClick={handleTestSend} disabled={testSending || !testTo.trim()} style={{ ...btnPriStyle, background: testSending || !testTo.trim() ? '#ccc' : B.green }}>
                  {testSending ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={13} />} Send Test
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Approved-edit warning — appears when editing a live template */}
        {isApprovedEdit && !readOnly && (
          <div style={{ background: '#FFF8E1', border: '1px solid #FFD54F', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: '#7A5500', fontFamily: FONT }}>
            ⚠ <strong>You're editing a live template.</strong> Saving sends the changes to Meta for re-review (status reverts to SUBMITTED until re-approval, usually within 24h). Name and language are locked.
          </div>
        )}

        {/* Status banners */}
        {status === 'SUBMITTED' && templateId && (
          <div style={{ background: B.greenBg, border: `1px solid ${B.greenBright}44`, borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ fontSize: 18 }}>🎉</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: B.green, fontFamily: FONT }}>Submitted to Meta for review</div>
                <div style={{ fontSize: 11, color: B.green, opacity: 0.8, fontFamily: FONT }}>
                  Meta ID: <span style={{ fontFamily: "'DM Mono', monospace" }}>{templateId}</span> · {submittedAt ? new Date(submittedAt).toLocaleString('en-IN') : ''} · Reviews within ~24 hrs · Auto-refreshes every 4h
                </div>
              </div>
            </div>
            {!readOnly && (
              <button style={{ ...btnGhostStyle, fontSize: 11, color: B.green, borderColor: B.greenBright + '44' }}
                onClick={async () => { try { await api.templates.sync(template.id); onSave?.({}); } catch (e) { alert(e.message); } }}>
                Refresh from Meta
              </button>
            )}
          </div>
        )}
        {status === 'APPROVED' && (
          <div style={{ background: B.greenBg, border: `1px solid ${B.greenBright}44`, borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: 13, fontWeight: 700, color: B.green, fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span><CheckCircle2 size={16} style={{ display: 'inline', marginRight: 6, verticalAlign: 'text-bottom' }} /> Template approved by Meta — live and usable.</span>
            {template?.quality_score && QUALITY_STYLES[template.quality_score] && (
              <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 99, background: 'var(--c-cardBg)', color: QUALITY_STYLES[template.quality_score].color, fontWeight: 700 }}>
                {QUALITY_STYLES[template.quality_score].label}
              </span>
            )}
          </div>
        )}
        {status === 'PAUSED' && (
          <div style={{ background: '#FFF3E0', border: '1px solid #FFB74D', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#E65100', fontFamily: FONT }}>⏸ Template paused by Meta</div>
            <div style={{ fontSize: 11, color: '#E65100', marginTop: 4, opacity: 0.85, fontFamily: FONT }}>
              Quality score dropped — sends are blocked until quality recovers. Reduce send volume and improve recipient engagement, then click Refresh from Meta to re-check.
            </div>
          </div>
        )}
        {status === 'DISABLED' && (
          <div style={{ background: '#EEEDE8', border: '1px solid #aaa', borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: 13, fontWeight: 700, color: '#444', fontFamily: FONT }}>
            🚫 Template disabled by Meta — cannot be sent. Duplicate and resubmit with revised content.
          </div>
        )}
        {status === 'REJECTED' && (
          <div style={{ background: B.redBg, border: `1px solid ${B.red}44`, borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: B.red, fontFamily: FONT }}><XCircle size={16} style={{ display: 'inline', marginRight: 6, verticalAlign: 'text-bottom' }} /> Template rejected by Meta</div>
            <div style={{ fontSize: 11, color: B.red, marginTop: 4, opacity: 0.85, fontFamily: FONT }}>
              {template?.rejection_reason
                ? <>Reason: <strong>{template.rejection_reason}</strong>. Address this then click "Edit Draft" and resubmit.</>
                : 'Review the category and body text, then resubmit.'}
            </div>
          </div>
        )}
        {/* Category auto-change banner */}
        {template?.previous_category && template.previous_category !== category && (
          <div style={{ background: '#FFF3E0', border: '1px solid #FFB74D', borderRadius: 10, padding: '10px 16px', marginBottom: 16, fontSize: 12, color: '#E65100', fontFamily: FONT }}>
            ℹ Meta reclassified this template from <strong>{template.previous_category}</strong> → <strong>{category}</strong>.
          </div>
        )}

        {/* Two-column layout */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 16, alignItems: 'start' }}>

          {/* LEFT */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

            {/* 1 — Basic Info */}
            <Sec n={1} title="Basic Information">
              <div style={{ marginBottom: 12 }}>
                <Lbl required>WhatsApp Account</Lbl>
                {accounts && accounts.length > 1 ? (
                  <div style={{ position: 'relative' }}>
                    <select
                      style={selStyle}
                      value={whatsappAccountId || ''}
                      onChange={e => setWhatsappAccountId(e.target.value ? parseInt(e.target.value, 10) : null)}
                      disabled={readOnly || (isEdit && (status === 'SUBMITTED' || status === 'APPROVED'))}
                    >
                      <option value="">— Unassigned —</option>
                      {accounts.map(a => (
                        <option key={a.id} value={a.id}>
                          {a.displayName} ({maskPhone(a.displayPhoneNumber)}){a.isDefault ? ' · default' : ''}{!a.isActive ? ' · inactive' : ''}
                        </option>
                      ))}
                    </select>
                    <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', fontSize: 10, color: B.t6 }}>▼</span>
                  </div>
                ) : accounts && accounts.length === 1 ? (
                  // Single-account system: the connected account is used automatically.
                  <div style={{ padding: '8px 12px', background: 'var(--c-cardBg)', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, color: C.text, fontFamily: FONT }}>
                    {accounts[0].displayName} ({maskPhone(accounts[0].displayPhoneNumber)})
                  </div>
                ) : (
                  <div style={{ padding: '8px 12px', background: '#FFF3E0', border: `1px solid #E65100`, borderRadius: 8, fontSize: 12, color: '#E65100', fontFamily: FONT }}>
                    No WhatsApp accounts configured yet. Add one in Settings → WhatsApp Accounts.
                  </div>
                )}
                <Hint>The Business Account this template will be submitted to. Cannot be changed after submission.</Hint>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <Lbl required>Template Name</Lbl>
                  <input style={showErrors && errors.name ? inpErrStyle : inpStyle} placeholder="e.g. order_confirmation" value={name} onChange={e => setName(e.target.value.toLowerCase().replace(/\s+/g, '_'))} maxLength={512} readOnly={readOnly || isApprovedEdit} title={isApprovedEdit ? 'Name cannot be changed on an approved template' : ''} />
                  {showErrors && errors.name ? <Hint error>{errors.name}</Hint> : <Hint>Lowercase, underscores only · Max 512 chars</Hint>}
                </div>
                <div>
                  <Lbl required>Language</Lbl>
                  <div style={{ position: 'relative' }}>
                    <select style={selStyle} value={language} onChange={e => setLanguage(e.target.value)} disabled={readOnly || isApprovedEdit} title={isApprovedEdit ? 'Language cannot be changed on an approved template' : ''}>
                      {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                    </select>
                    <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', fontSize: 10, color: B.t6 }}>▼</span>
                  </div>
                </div>
              </div>
            </Sec>

            {/* 2 — Category */}
            <Sec n={2} title="Category">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {CATEGORIES.map(cat => {
                  const Icon = cat.icon;
                  const on = category === cat.id;
                  return (
                    <button key={cat.id} style={on ? catCardOnStyle : catCardStyle} onClick={() => !readOnly && handleCategoryChange(cat.id)} disabled={readOnly}>
                      <div style={{ marginBottom: 7 }}><Icon size={22} color={on ? cat.color : B.t4} /></div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: on ? B.accentDark : B.t1, marginBottom: 3, fontFamily: FONT }}>{cat.label}</div>
                      <div style={{ fontSize: 11, color: on ? '#6055cc' : B.t6, lineHeight: 1.45, fontFamily: FONT }}>{cat.desc}</div>
                    </button>
                  );
                })}
              </div>
              {isAuth && <div style={{ marginTop: 10, padding: '10px 12px', background: B.greenBg, border: `1px solid ${B.greenBright}44`, borderRadius: 8, fontSize: 11, color: B.green, lineHeight: 1.6, fontFamily: FONT }}><Shield size={12} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: 4 }} /> <strong>Auth rules:</strong> No media headers · OTP buttons only · Footer = code expiry only</div>}
              <div style={{ marginTop: 12 }}>
                <Toggle on={allowCatChange} onChange={setAllowCatChange} label="Allow Meta to auto-correct category" desc="Prevents rejection if Meta disagrees — they'll fix it instead" />
              </div>
            </Sec>

            {/* 3 — Header */}
            <Sec n={3} title="Header" note="optional">
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
                {HEADER_TYPES.filter(t => !isAuth || ['NONE', 'TEXT'].includes(t.id)).map(t => {
                  const Icon = t.icon;
                  const on = headerType === t.id;
                  return (
                    <button key={t.id} style={on ? hdrTabOnStyle : hdrTabStyle} onClick={() => !readOnly && setHeaderType(t.id)} disabled={readOnly}>
                      <Icon size={14} /> {t.label}
                    </button>
                  );
                })}
              </div>
              {headerType === 'TEXT' && (
                <div>
                  <Lbl>Header Text</Lbl>
                  <input style={showErrors && (errors.headerVars || errors.headerTextLen) ? inpErrStyle : inpStyle} placeholder="e.g. Your Order is Confirmed! 🎉" value={headerText} onChange={e => setHeaderText(e.target.value)} maxLength={60} readOnly={readOnly} />
                  {showErrors && errors.headerVars && <Hint error>{errors.headerVars}</Hint>}
                  {showErrors && errors.headerTextLen && <Hint error>{errors.headerTextLen}</Hint>}
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                    <Hint>Max 1 variable — <code style={{ background: B.accentBg, padding: '1px 5px', borderRadius: 4, fontSize: 11, color: B.accentDark }}>{'{{1}}'}</code></Hint>
                    <span style={{ fontSize: 11, color: B.t7, fontFamily: "'DM Mono', monospace" }}>{headerText.length}/60</span>
                  </div>
                  {hdrVars.length > 0 && (
                    <div style={{ marginTop: 10, padding: '10px 12px', background: B.sectionBg, border: `1px solid ${showErrors && errors.headerSamples ? B.red + '55' : B.sectionBorder}`, borderRadius: 8 }}>
                      <Lbl required>Sample for <span style={{ fontFamily: "'DM Mono', monospace", background: B.accentBg, padding: '1px 5px', borderRadius: 4, fontSize: 11, color: B.accentDark }}>{`{{${hdrVars[0]}}}`}</span></Lbl>
                      <input style={showErrors && errors.headerSamples ? inpErrStyle : { ...inpStyle, fontSize: 12, padding: '7px 12px' }} placeholder="Sample header value" value={samples[hdrVars[0]] || ''} onChange={e => setSamples({ ...samples, [hdrVars[0]]: e.target.value })} readOnly={readOnly} />
                      {showErrors && errors.headerSamples && <Hint error>{errors.headerSamples}</Hint>}
                    </div>
                  )}
                </div>
              )}
              {['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerType) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div>
                    <Lbl required>Select {headerType === 'IMAGE' ? 'Image' : headerType === 'VIDEO' ? 'Video' : 'Document'} from Media Library</Lbl>
                    <select
                      value={headerMediaLibraryId || ''}
                      onChange={async (e) => {
                        const val = e.target.value;
                        if (!val) {
                          setHeaderMediaLibraryId(null);
                          setMediaHandle('');
                          setLibSourceName('');
                          return;
                        }
                        if (!whatsappAccountId) { alert('Pick a WhatsApp Account first (Section 1).'); e.target.value = ''; return; }
                        const media = headerMediaItems.find(m => String(m.id) === val);
                        setHeaderMediaLibraryId(Number(val));
                        setHeaderMediaUploading(true);
                        try {
                          const result = await api.uploadTemplateMediaHandleFromLibrary({
                            accountId: whatsappAccountId,
                            mediaLibraryId: Number(val),
                          });
                          setMediaHandle(result.handle);
                          setLibSourceName(result.name || result.originalName || media?.name || '');
                        } catch (err) {
                          alert(`Upload failed: ${err.message}`);
                          setHeaderMediaLibraryId(null);
                          setMediaHandle('');
                          setLibSourceName('');
                        } finally {
                          setHeaderMediaUploading(false);
                        }
                      }}
                      disabled={readOnly || headerMediaUploading}
                      style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: `1px solid ${showErrors && errors.mediaHandle ? B.red + '55' : B.cardBorder}`, borderRadius: 8, fontFamily: FONT, background: B.card, color: B.t2, cursor: readOnly ? 'not-allowed' : 'pointer' }}
                    >
                      <option value="">— Select from library —</option>
                      {headerMediaItems.map(m => (
                        <option key={m.id} value={m.id}>{m.name || m.originalName || `Media #${m.id}`}</option>
                      ))}
                    </select>
                    {headerMediaUploading && (
                      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: B.t6, fontFamily: FONT }}>
                        <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Uploading to Meta…
                      </div>
                    )}
                    {showErrors && errors.mediaHandle && <Hint error>{errors.mediaHandle}</Hint>}
                  </div>

                  {/* Preview of selected media */}
                  {headerMediaLibraryId && (
                    <div style={{ borderRadius: 10, overflow: 'hidden', border: `1px solid ${B.innerBorder}`, background: B.innerBg }}>
                      {headerType === 'IMAGE' ? (
                        <img
                          src={api.mediaLibrary.downloadUrl(headerMediaLibraryId)}
                          alt=""
                          style={{ width: '100%', height: 160, objectFit: 'cover', display: 'block' }}
                        />
                      ) : headerType === 'VIDEO' ? (
                        <div style={{ position: 'relative', width: '100%', height: 160 }}>
                          <video
                            src={api.mediaLibrary.downloadUrl(headerMediaLibraryId)}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            preload="metadata"
                            muted
                          />
                          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.25)' }}>
                            <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <Play size={16} color="#111" fill="#111" />
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{ width: 40, height: 40, borderRadius: 8, background: B.greenBg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: B.green }}>
                            <FileText size={20} />
                          </div>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: B.t2, fontFamily: FONT }}>{libSourceName || headerMediaItems.find(m => String(m.id) === String(headerMediaLibraryId))?.name || 'Document'}</div>
                            <div style={{ fontSize: 11, color: B.t6, fontFamily: FONT }}>Document • {headerMediaItems.find(m => String(m.id) === String(headerMediaLibraryId))?.mimeType || ''}</div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div>
                    <Lbl>Meta File Handle</Lbl>
                    <input style={inpStyle} placeholder="Auto-filled when you select from library above" value={mediaHandle} onChange={e => { setMediaHandle(e.target.value); setLibSourceName(''); setHeaderMediaLibraryId(null); }} readOnly={readOnly} />
                    {libSourceName && (
                      <div style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 12, background: B.accentBg, color: B.accentDark, fontSize: 11, fontWeight: 600, fontFamily: FONT }}>
                        <Library size={11} /> From library: {libSourceName}
                      </div>
                    )}
                    <Hint>Auto-uploaded via Meta's Resumable Upload API when you select from the library</Hint>
                  </div>
                </div>
              )}
              {headerType === 'NONE' && <div style={{ fontSize: 12, color: B.t6, fontFamily: FONT }}>No header will be shown in the message.</div>}
            </Sec>

            {/* 4 — Body */}
            <Sec n={4} title="Body (Message Content)">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ display: 'flex', gap: 5 }}>
                  {[['*', 'B', { fontWeight: 700 }], ['_', 'I', { fontStyle: 'italic' }], ['~', 'S', { textDecoration: 'line-through' }]].map(([w, l, s]) => (
                    <button key={w} style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1.5px solid #D5D5D0', borderRadius: 8, background: 'var(--c-cardBg)', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#444', fontFamily: FONT, transition: 'all .15s', ...s }} onClick={() => !readOnly && wrapFmt(w)} disabled={readOnly}>{l}</button>
                  ))}
                </div>
                {!readOnly && (
                  <button style={{ ...btnGhostStyle, background: B.accentBg, borderColor: B.accentDark + '44', color: B.accentDark }} onClick={insertVar}>
                    <Braces size={14} /> Add Variable
                  </button>
                )}
              </div>
              <textarea ref={bodyRef} style={showErrors && errors.body ? taErrStyle : taStyle} rows={5}
                placeholder={isAuth ? '{{1}} is your verification code.' : 'Hello {{1}}, your order {{2}} has been confirmed!\n\nYour delivery is expected by {{3}}. 🎉'}
                value={body} onChange={e => setBody(e.target.value)} maxLength={1024} readOnly={readOnly} />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
                {showErrors && errors.body ? <Hint error>{errors.body}</Hint> : <Hint>*bold* · _italic_ · ~strikethrough~ · {'{{1}}'} variables</Hint>}
                <span style={{ fontSize: 11, color: B.t7, fontFamily: "'DM Mono', monospace", flexShrink: 0, marginLeft: 8 }}>{body.length}/1024</span>
              </div>

              {/* Auth add-ons */}
              {isAuth && (
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Toggle on={securityRec} onChange={setSecurityRec} label="Add security recommendation" desc='"For your security, do not share this code." — appended automatically' />
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1 }}>
                      <Toggle on={!!codeExpiry} onChange={v => setCodeExpiry(v ? '10' : '')} label="Add code expiry" desc="Shows 'This code expires in X minutes'" />
                    </div>
                    {codeExpiry !== '' && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        <input style={showErrors && errors.codeExpiry ? { ...inpStyle, width: 70, textAlign: 'center', fontFamily: "'DM Mono', monospace" } : { ...inpStyle, width: 70, textAlign: 'center', fontFamily: "'DM Mono', monospace" }} type="number" min="1" max="90" value={codeExpiry} onChange={e => setCodeExpiry(e.target.value)} readOnly={readOnly} />
                        <span style={{ fontSize: 12, color: B.t5, whiteSpace: 'nowrap', fontFamily: FONT }}>mins (1–90)</span>
                      </div>
                    )}
                    {showErrors && errors.codeExpiry && <Hint error>{errors.codeExpiry}</Hint>}
                  </div>
                </div>
              )}

              {/* Samples */}
              {bodyVars.length > 0 && (
                <div style={{ marginTop: 14, padding: '12px 14px', background: B.sectionBg, border: `1px solid ${showErrors && errors.bodySamples ? B.red + '55' : B.sectionBorder}`, borderRadius: 10 }}>
                  <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.1em', color: '#888', fontWeight: 700, marginBottom: 6, fontFamily: FONT }}>Sample Values for Variables</div>
                  <div style={{ fontSize: 11, color: B.t6, marginBottom: 10, fontFamily: FONT }}>Required by Meta — realistic examples for each placeholder.</div>
                  {showErrors && errors.bodySamples && <Hint error style={{ marginBottom: 8 }}>{errors.bodySamples}</Hint>}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {bodyVars.map(v => (
                      <div key={v}>
                        <Lbl required><span style={{ fontFamily: "'DM Mono', monospace", background: B.accentBg, padding: '1px 6px', borderRadius: 4, fontSize: 11, color: B.accentDark }}>{`{{${v}}}`}</span></Lbl>
                        <input style={showErrors && !samples[v]?.trim() ? inpErrStyle : { ...inpStyle, fontSize: 12, padding: '7px 12px' }} placeholder={`Sample for {{${v}}}`} value={samples[v] || ''} onChange={e => setSamples({ ...samples, [v]: e.target.value })} readOnly={readOnly} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Sec>

            {/* 5 — Footer */}
            {!isAuth && (
              <Sec n={5} title="Footer" note="optional">
                <Lbl>Footer Text</Lbl>
                <input style={showErrors && (errors.footer || errors.footerLen) ? inpErrStyle : inpStyle} placeholder="e.g. Reply STOP to unsubscribe" value={footer} onChange={e => setFooter(e.target.value)} maxLength={60} readOnly={readOnly} />
                {showErrors && errors.footer && <Hint error>{errors.footer}</Hint>}
                {showErrors && errors.footerLen && <Hint error>{errors.footerLen}</Hint>}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                  <Hint>Small grey text · No variables allowed</Hint>
                  <span style={{ fontSize: 11, color: B.t7, fontFamily: "'DM Mono', monospace" }}>{footer.length}/60</span>
                </div>
              </Sec>
            )}

            {/* 6 — Buttons */}
            {!readOnly && (
              <ButtonsSection buttons={buttons} category={category} errors={showErrors ? errors : {}}
                onAdd={(type) => setButtons([...buttons, { type, text: '', value: '', otpType: 'COPY_CODE' }])}
                onRemove={(i) => setButtons(buttons.filter((_, idx) => idx !== i))}
                onUpdate={(i, field, val) => { const b = [...buttons]; b[i] = { ...b[i], [field]: val }; setButtons(b); }}
              />
            )}

            {/* 7 — Submit / Save */}
            {!readOnly && (
              <div style={{ background: B.card, border: `1px solid ${B.cardBorder}`, borderRadius: 12, padding: '16px 18px' }}>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.1em', color: '#888', fontWeight: 700, marginBottom: 14, fontFamily: FONT }}>Submit for Meta Approval</div>
                {showErrors && errCount > 0 && (
                  <div style={{ background: B.redBg, border: `1px solid ${B.red}33`, borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: B.red, marginBottom: 8, fontFamily: FONT }}>⚠ {errCount} issue{errCount > 1 ? 's' : ''} to fix before submitting:</div>
                    {Object.entries(errors).map(([k, msg]) => (
                      <div key={k} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '4px 0', borderBottom: `1px solid ${B.red}22` }}>
                        <span style={{ color: B.red, flexShrink: 0 }}>·</span>
                        <span style={{ fontSize: 12, color: B.red, fontFamily: FONT }}>{msg}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button style={{ ...btnPriStyle, background: canSubmit ? B.green : '#ccc', flex: 1, justifyContent: 'center', fontSize: 14, padding: 12 }} onClick={handleSubmit} disabled={saving}>
                    {saving ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={16} />} Submit for Approval
                  </button>
                  <button style={{ ...btnGhostStyle }} onClick={() => { setShowPayload(p => !p); setShowErrors(true); }}>
                    {showPayload ? 'Hide' : 'View'} API Payload
                  </button>
                </div>
                {!canSubmit && <div style={{ marginTop: 8, fontSize: 11, color: B.t6, textAlign: 'center', fontFamily: FONT }}>Fix the issues above to enable submission</div>}
              </div>
            )}

            {/* API Payload */}
            {showPayload && (
              <div style={{ background: B.card, border: `1px solid ${B.cardBorder}`, borderRadius: 12, padding: '16px 18px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.1em', color: '#888', fontWeight: 700, fontFamily: FONT }}>API Payload</div>
                  <button style={{ ...btnGhostStyle, fontSize: 11, gap: 5 }} onClick={copyPayload}>
                    {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied!' : 'Copy JSON'}
                  </button>
                </div>
                <div style={{ marginBottom: 8, fontSize: 11, color: B.t5, fontFamily: "'DM Mono', monospace", background: B.sectionBg, padding: '6px 10px', borderRadius: 6 }}>
                  POST https://graph.facebook.com/v20.0/<strong style={{ color: B.accent }}>{'{WABA_ID}'}</strong>/message_templates
                </div>
                <div style={{ background: '#1A1A2E', borderRadius: 10, padding: '14px 16px', overflow: 'auto', fontFamily: "'DM Mono', monospace", fontSize: 11, color: '#E8E8F0', lineHeight: 1.7, maxHeight: 320 }}>
                  <pre style={{ margin: 0 }}>{JSON.stringify(payload, null, 2)}</pre>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT */}
          <div style={{ position: 'sticky', top: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.1em', color: '#888', fontWeight: 700, fontFamily: FONT }}>Live Preview</span>
              <span style={{ fontSize: 11, color: B.t7, fontStyle: 'italic', fontFamily: FONT }}>Updates as you type</span>
            </div>
            <WaPreview headerType={headerType} headerText={previewHeader} bodyText={previewBody} footerText={footer} buttons={buttons} securityRec={securityRec} codeExpiry={codeExpiry} headerMediaLibraryId={headerMediaLibraryId} />

            {/* Checklist */}
            <div style={{ background: B.card, border: `1px solid ${B.cardBorder}`, borderRadius: 12, padding: '14px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.1em', color: '#888', fontWeight: 700, fontFamily: FONT }}>Submission Checklist</div>
                {errCount === 0
                  ? <span style={{ fontSize: 10, fontWeight: 700, color: B.green, background: B.greenBg, padding: '2px 8px', borderRadius: 99, fontFamily: FONT }}>✓ Ready</span>
                  : <span style={{ fontSize: 10, fontWeight: 700, color: B.red, background: B.redBg, padding: '2px 8px', borderRadius: 99, fontFamily: FONT }}>{errCount} issues</span>
                }
              </div>
              {checklist.map(([key, label, ok]) => (
                <div key={key} style={{ borderBottom: `1px solid ${B.rowSep}`, paddingBottom: 6, marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 18, height: 18, borderRadius: 99, background: ok ? B.greenBg : B.redBg, border: `1.5px solid ${ok ? B.greenBright : B.red}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <span style={{ fontSize: 10, color: ok ? B.green : B.red, fontWeight: 700 }}>{ok ? '✓' : '!'}</span>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 600, color: ok ? B.t3 : B.red, fontFamily: FONT }}>{label}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Spec */}
            <div style={{ background: B.card, border: `1px solid ${B.cardBorder}`, borderRadius: 12, padding: '14px 16px' }}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.1em', color: '#888', fontWeight: 700, marginBottom: 10, fontFamily: FONT }}>Template Spec</div>
              {[
                ['Name', name || '—', true],
                ['Category', CATEGORIES.find(c => c.id === category)?.label || '—', false],
                ['Language', LANGUAGES.find(l => l.code === language)?.label || language, false],
                ['Header', headerType, false],
                ['Variables', allVars.length > 0 ? allVars.map(v => `{{${v}}}`).join(', ') : 'None', true],
                ['Buttons', buttons.length > 0 ? buttons.map(b => b.type).join(', ') : 'None', false],
                ['Status', status, false],
                ['Template ID', templateId || '—', true],
              ].map(([label, val, mono]) => (
                <div key={label} style={{ borderBottom: `1px solid ${B.rowSep}`, paddingBottom: 6, marginBottom: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: B.t6, flexShrink: 0, fontFamily: FONT }}>{label}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: B.t2, fontFamily: mono ? "'DM Mono', monospace" : FONT, textAlign: 'right', wordBreak: 'break-all', maxWidth: '62%' }}>{val}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {libPickerOpen && (
        <TemplateLibraryPickerModal
          headerType={headerType}
          accountId={whatsappAccountId}
          onClose={() => setLibPickerOpen(false)}
          onPicked={({ handle, name, originalName }) => {
            setMediaHandle(handle);
            setLibSourceName(name || originalName);
            setLibPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ── Library picker for template header media ────────────────────────────────
function TemplateLibraryPickerModal({ headerType, accountId, onClose, onPicked }) {
  const targetType = headerType === 'IMAGE' ? 'image' : headerType === 'VIDEO' ? 'video' : 'document';
  const [media, setMedia] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const list = await api.mediaLibrary.list(accountId);
        setMedia((list.media || []).filter(m => m.mediaType === targetType));
      } catch (err) { setError(err.message); }
    })();
  }, [targetType, accountId]);

  const handleConfirm = async () => {
    if (!selected) return;
    setUploading(true);
    try {
      const result = await api.uploadTemplateMediaHandleFromLibrary({
        accountId, mediaLibraryId: Number(selected.id),
      });
      onPicked({ handle: result.handle, name: result.name || selected.name, originalName: result.originalName || selected.originalName });
    } catch (err) {
      setError(err.message);
      setUploading(false);
    }
  };

  const TYPE_ICON = { image: Image, video: Video, document: FileText };
  const Icon = TYPE_ICON[targetType] || FileText;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 250, fontFamily: FONT,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--c-cardBg)', borderRadius: 14, width: 720, maxHeight: '85vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,.15)',
        }}
      >
        <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--c-border)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <Library size={20} color="#dc2626" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--c-text)' }}>Pick {targetType} from Media Library</div>
            <div style={{ fontSize: 12, color: 'var(--c-textSecondary)', marginTop: 2 }}>
              The selected file is uploaded to Meta's resumable upload API and the resulting handle is filled into your template header.
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--c-textMuted)', padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 16, background: '#FAFAF8' }}>
          {error && (
            <div style={{ padding: 10, background: 'var(--c-primaryLight)', color: '#A32D2D', borderRadius: 6, fontSize: 13, marginBottom: 12 }}>{error}</div>
          )}
          {!media ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--c-textMuted)' }}>Loading…</div>
          ) : media.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--c-textMuted)', fontSize: 13 }}>
              No {targetType}s in the library. Upload one from the Media tab first.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
              {media.map(m => {
                const isSel = selected?.id === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => setSelected(m)}
                    style={{
                      textAlign: 'left', padding: 0, background: 'var(--c-cardBg)', borderRadius: 10,
                      border: `2px solid ${isSel ? '#dc2626' : '#E5E5E0'}`,
                      cursor: 'pointer', overflow: 'hidden', fontFamily: FONT,
                    }}
                  >
                    <div style={{
                      aspectRatio: '1 / 1', display: 'flex', alignItems: 'center',
                      justifyContent: 'center', position: 'relative',
                      background: targetType === 'image' ? '#3B82F615' : targetType === 'video' ? '#8B5CF615' : '#F59E0B15',
                    }}>
                      {targetType === 'image' ? (
                        <img src={api.mediaLibrary.downloadUrl(m.id)} alt={m.name || m.originalName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : targetType === 'video' ? (
                        <>
                          <video
                            src={api.mediaLibrary.downloadUrl(m.id)}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            preload="metadata"
                            muted
                          />
                          <div style={{
                            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            pointerEvents: 'none',
                          }}>
                            <div style={{
                              width: 32, height: 32, borderRadius: '50%', background: 'rgba(0,0,0,.5)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                              <div style={{
                                width: 0, height: 0, borderStyle: 'solid', borderWidth: '7px 0 7px 11px',
                                borderColor: 'transparent transparent transparent #fff', marginLeft: 2,
                              }} />
                            </div>
                          </div>
                        </>
                      ) : (
                        <Icon size={40} color={targetType === 'video' ? '#8B5CF6' : '#F59E0B'} />
                      )}
                      {isSel && (
                        <div style={{ position: 'absolute', top: 6, right: 6, background: '#dc2626', color: '#fff', borderRadius: '50%', width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <CheckCircle2 size={14} />
                        </div>
                      )}
                    </div>
                    <div style={{ padding: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name || m.originalName}</div>
                      <div style={{ fontSize: 10, color: 'var(--c-textSecondary)', marginTop: 2 }}>
                        {(m.sizeBytes / 1024).toFixed(0)} KB · {m.mimeType}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ padding: '14px 22px', borderTop: '1px solid var(--c-border)', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            onClick={onClose}
            disabled={uploading}
            style={{
              padding: '9px 14px', borderRadius: 8, border: '1px solid var(--c-border)',
              background: 'var(--c-cardBg)', color: 'var(--c-text)', cursor: 'pointer',
              fontSize: 13, fontWeight: 600, fontFamily: FONT,
            }}
          >Cancel</button>
          <button
            onClick={handleConfirm}
            disabled={!selected || uploading}
            style={{
              padding: '9px 18px', borderRadius: 8, border: 'none',
              background: !selected ? 'var(--c-hover)' : '#dc2626', color: '#fff',
              cursor: !selected || uploading ? 'not-allowed' : 'pointer',
              fontSize: 13, fontWeight: 600, fontFamily: FONT,
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            {uploading && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />}
            Use this file
          </button>
        </div>
      </div>
    </div>
  );
}


// ─── Main Page Component ──────────────────────────────────────────────────────
export default function TemplateBuilderPage() {
  const [view, setView] = useState('list'); // 'list' | 'builder' | 'view'
  const [templates, setTemplates] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [syncingAll, setSyncingAll] = useState(false);
  const [groupByTranslation, setGroupByTranslation] = useState(true);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const [tpls, accs] = await Promise.all([
        api.templates.list(),
        api.whatsappAccounts.list().catch(() => []),
      ]);
      setTemplates(tpls);
      setAccounts(accs);
    } catch {
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const handleAdd = () => {
    setSelectedTemplate(null);
    setView('builder');
  };

  const handleEdit = (t) => {
    setSelectedTemplate(t);
    setView('builder');
  };

  const handleView = (t) => {
    setSelectedTemplate(t);
    setView('view');
  };

  const handleDelete = async (id) => {
    try {
      await api.templates.delete(id);
      loadTemplates();
    } catch (err) {
      alert(err.message || 'Delete failed');
    }
  };

  const handleBulkDelete = async (ids) => {
    await runBulkDelete(ids, (id) => api.templates.delete(id), {
      label: 'template',
      onSuccess: (deletedIds) => {
        const set = new Set(deletedIds);
        setTemplates(prev => prev.filter(t => !set.has(t.id)));
      },
    });
  };

  const handleSave = (saved) => {
    loadTemplates();
    setView('list');
  };

  const handleDuplicate = async (t) => {
    try {
      await api.templates.duplicate(t.id);
      loadTemplates();
    } catch (err) {
      alert(err.message || 'Duplicate failed');
    }
  };

  const handleBulkSubmit = async (ids) => {
    if (!confirm(`Submit ${ids.length} draft template${ids.length > 1 ? 's' : ''} to Meta for review?`)) return;
    try {
      const res = await api.bulkSubmitTemplates(ids);
      alert(`Bulk submit done: ${res.succeeded}/${res.total} succeeded.`);
      loadTemplates();
    } catch (err) {
      alert(err.message || 'Bulk submit failed');
    }
  };

  const handleSyncAll = async () => {
    setSyncingAll(true);
    try {
      const res = await api.syncAllTemplates();
      console.log('Synced:', res);
      loadTemplates();
    } catch (err) {
      alert(err.message || 'Sync failed');
    } finally {
      setSyncingAll(false);
    }
  };

  const handleBack = () => {
    setView('list');
    setSelectedTemplate(null);
  };

  if (view === 'builder') {
    return <BuilderView template={selectedTemplate} onBack={handleBack} onSave={handleSave} readOnly={false} accounts={accounts} />;
  }

  if (view === 'view') {
    return <BuilderView template={selectedTemplate} onBack={handleBack} onSave={handleSave} readOnly={true} accounts={accounts} />;
  }

  return (
    <TemplateList
      templates={templates}
      loading={loading}
      onAdd={handleAdd}
      onEdit={handleEdit}
      onDelete={handleDelete}
      onView={handleView}
      onBulkDelete={handleBulkDelete}
      onDuplicate={handleDuplicate}
      onBulkSubmit={handleBulkSubmit}
      onSyncAll={handleSyncAll}
      syncingAll={syncingAll}
      accounts={accounts}
      groupByTranslation={groupByTranslation}
      onToggleGroup={setGroupByTranslation}
    />
  );
}
