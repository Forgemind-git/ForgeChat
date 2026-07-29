import { Globe, Instagram, Youtube, Facebook, Github, ExternalLink } from 'lucide-react';
import { C, FONT } from '../constants.js';

// Forgemind links surfaced on the About Us page. Each opens in a new tab.
const LINKS = [
  { label: 'Website',   sub: 'forgemind.in',                 url: 'https://forgemind.in/',                      Icon: Globe,     color: '#2563EB', img: '/forgemind-logo.png' },
  { label: 'Instagram', sub: '@forgemind_ai',                url: 'https://www.instagram.com/forgemind_ai/',    Icon: Instagram, color: '#E1306C' },
  { label: 'YouTube',   sub: '@forgemind_ai',                url: 'https://www.youtube.com/@forgemind_ai',      Icon: Youtube,   color: '#FF0000' },
  { label: 'Facebook',  sub: 'forgemindai',                  url: 'https://www.facebook.com/forgemindai',       Icon: Facebook,  color: '#1877F2' },
  { label: 'GitHub',    sub: 'Forgemind-git',                url: 'https://github.com/Forgemind-git',           Icon: Github,    color: '#111111' },
];

export default function AboutUsPage() {
  return (
    <div style={{ padding: '40px 24px', fontFamily: FONT, color: C.text, maxWidth: 760, margin: '0 auto', width: '100%' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <img
          src="/forgemind-logo.gif"
          alt="Forgemind"
          style={{ height: 64, width: 64, objectFit: 'contain', marginBottom: 14 }}
          onError={e => { e.currentTarget.style.display = 'none'; }}
        />
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>About FORGEMIND <span style={{ color: C.primary }}>AI</span></h1>
        <p style={{ fontSize: 14, color: C.textSecondary, margin: '10px auto 0', maxWidth: 540, lineHeight: 1.6 }}>
          Forgemind builds practical AI automation tools — including this WhatsApp CRM.
          Follow us and explore our work through the links below.
        </p>
      </div>

      {/* Link cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 14,
      }}>
        {LINKS.map(({ label, sub, url, Icon, color, img }) => (
          <a
            key={label}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex', alignItems: 'center', gap: 14,
              padding: '16px 18px', borderRadius: 12,
              background: C.cardBg, border: `1px solid ${C.border}`,
              textDecoration: 'none', color: C.text,
              boxShadow: C.shadowSm, transition: 'transform .15s, box-shadow .15s, border-color .15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = C.shadowMd;
              e.currentTarget.style.borderColor = color;
            }}
            onMouseLeave={e => {
              e.currentTarget.style.transform = 'none';
              e.currentTarget.style.boxShadow = C.shadowSm;
              e.currentTarget.style.borderColor = C.border;
            }}
          >
            <span style={{
              width: 44, height: 44, borderRadius: 10, flexShrink: 0,
              background: img ? '#fff' : `${color}18`,
              border: img ? `1px solid ${C.border}` : 'none',
              color,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {img
                ? <img src={img} alt={label} style={{ width: 28, height: 28, objectFit: 'contain' }} />
                : <Icon size={22} />}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 15, fontWeight: 700 }}>{label}</span>
              <span style={{ display: 'block', fontSize: 12, color: C.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span>
            </span>
            <ExternalLink size={16} style={{ color: C.textMuted, flexShrink: 0 }} />
          </a>
        ))}
      </div>

      <div style={{ textAlign: 'center', marginTop: 36, fontSize: 12, color: C.textMuted }}>
        © {new Date().getFullYear()} Forgemind · Powered by FMOS
      </div>
    </div>
  );
}
