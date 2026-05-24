import { AlertTriangle } from 'lucide-react';
import { C, FONT } from '../constants.js';

export default function DeleteConfirmModal({
  open,
  title = 'Confirm Delete',
  message = 'Are you sure you want to delete this item?',
  confirmText = 'Delete',
  cancelText = 'Cancel',
  danger = true,
  onConfirm,
  onCancel,
}) {
  if (!open) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 300, fontFamily: FONT,
    }}>
      <div style={{
        background: C.cardBg, borderRadius: 14,
        padding: '24px 24px 20px', width: 400,
        boxShadow: C.shadowLg,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%',
            background: danger ? '#fef2f2' : '#f0f2f5',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: danger ? C.primary : C.textSecondary,
            flexShrink: 0,
          }}>
            <AlertTriangle size={18} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{title}</div>
        </div>

        <div style={{ fontSize: 13, color: C.textSecondary, lineHeight: 1.6, marginBottom: 20 }}>
          {message}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{
            padding: '8px 16px', borderRadius: 8, border: `1px solid ${C.border}`,
            background: 'transparent', cursor: 'pointer', fontSize: 13,
            fontWeight: 600, color: C.textSecondary, fontFamily: FONT,
          }}>{cancelText}</button>
          <button onClick={onConfirm} style={{
            padding: '8px 16px', borderRadius: 8, border: 'none',
            background: danger ? C.primary : C.purple,
            color: '#fff', cursor: 'pointer',
            fontSize: 13, fontWeight: 600, fontFamily: FONT,
          }}>{confirmText}</button>
        </div>
      </div>
    </div>
  );
}
