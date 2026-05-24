import { C, FONT } from '../constants.js';

export default function PlaceholderPage({ title, subtitle, icon: Icon }) {
  return (
    <div style={{
      padding: '24px 28px',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',

    }}>
      {/* Page header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: 0, letterSpacing: '-.02em', fontFamily: FONT }}>
            {title}
          </h1>
          <p style={{ fontSize: 12, color: C.textMuted, margin: '4px 0 0', fontFamily: FONT }}>
            {subtitle || `${title} — Coming Soon`}
          </p>
        </div>
      </div>

      {/* Placeholder card — fills remaining height */}
      <div style={{
        background: C.cardBg,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: '48px 32px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        flex: 1,
        minHeight: 0,
      }}>
        {Icon && (
          <div style={{
            width: 64,
            height: 64,
            borderRadius: 16,
            background: '#F0F0EA',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <Icon size={32} color={C.textMuted} />
          </div>
        )}
        <div style={{
          fontSize: 16,
          fontWeight: 600,
          color: C.textSecondary,
          fontFamily: FONT,
        }}>
          {title} — Coming Soon
        </div>
        <div style={{
          fontSize: 14,
          color: C.textMuted,
          fontFamily: FONT,
          textAlign: 'center',
          maxWidth: 420,
        }}>
          This feature is under development. Check back soon for updates.
        </div>
      </div>
    </div>
  );
}
