import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ArrowLeft, Loader2, CheckCircle2, XCircle, AlertCircle, Clock, RefreshCw, X, Filter, ChevronDown, Pause, Square } from 'lucide-react';
import { api } from '../api.js';
import { FONT, MONO, maskPhone } from '../constants.js';
import ExecutionFlowCanvas from './ExecutionFlowCanvas.jsx';

/* ── Design Tokens ──────────────────────────────────────────────────────────── */
const C = {
  pageBg: 'var(--c-pageBg)',
  card: 'var(--c-cardBg)',
  cardBorder: 'var(--c-border)',
  innerBg: 'var(--c-surfaceAlt)',
  innerBorder: 'var(--c-border)',
  rowSep: 'var(--c-border)',
  t1: 'var(--c-text)',
  t2: 'var(--c-text)',
  t3: 'var(--c-textSecondary)',
  t4: 'var(--c-textSecondary)',
  t5: 'var(--c-textMuted)',
  t6: 'var(--c-textMuted)',
  muted: 'var(--c-textMuted)',
  green: '#0F6E56',
  greenBg: '#E1F5EE',
  greenBright: '#1D9E75',
  red: '#A32D2D',
  redBg: '#FCEBEB',
  orange: '#E65100',
  orangeBg: '#FFF3E0',
  blue: '#1565C0',
  blueBg: '#E3F2FD',
  purple: '#534AB7',
  purpleBg: '#EEEDFE',
};

/* ── Status helpers ─────────────────────────────────────────────────────────── */
const STATUS_META = {
  success: { icon: CheckCircle2, color: C.green, bg: C.greenBg, label: 'Succeeded' },
  error: { icon: XCircle, color: C.red, bg: C.redBg, label: 'Error' },
  running: { icon: Clock, color: C.blue, bg: C.blueBg, label: 'Running' },
  paused: { icon: Pause, color: C.orange, bg: C.orangeBg, label: 'Waiting for reply' },
  cancelled: { icon: AlertCircle, color: C.muted, bg: C.innerBg, label: 'Cancelled' },
  queued: { icon: Clock, color: C.purple, bg: C.purpleBg, label: 'Queued' },
};

// Statuses that can still be stopped by the user
const CANCELLABLE = new Set(['running', 'paused', 'queued']);

const MESSAGE_STATUS_META = {
  received: { label: 'Received', color: C.blue, bg: C.blueBg },
  sent: { label: 'Sent', color: C.green, bg: C.greenBg },
  delivered: { label: 'Delivered', color: C.green, bg: C.greenBg },
  read: { label: 'Read', color: C.green, bg: C.greenBg },
  accepted: { label: 'Accepted', color: C.green, bg: C.greenBg },
  failed: { label: 'Failed', color: C.red, bg: C.redBg },
  error: { label: 'Error', color: C.red, bg: C.redBg },
};

function StatusBadge({ status, size = 'sm' }) {
  const meta = STATUS_META[status] || STATUS_META.running;
  const Icon = meta.icon;
  const isSmall = size === 'sm';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: isSmall ? '2px 8px' : '4px 12px', borderRadius: 99,
      background: meta.bg, color: meta.color,
      fontSize: isSmall ? 10 : 12, fontWeight: 700, fontFamily: FONT, whiteSpace: 'nowrap',
    }}>
      <Icon size={isSmall ? 11 : 14} />
      {meta.label}
    </span>
  );
}

function MessageStatusBadge({ status }) {
  const meta = MESSAGE_STATUS_META[status] || { label: status || 'Unknown', color: C.t5, bg: C.innerBg };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '1px 7px', borderRadius: 99,
      background: meta.bg, color: meta.color,
      fontSize: 10, fontWeight: 700, fontFamily: FONT, whiteSpace: 'nowrap',
      border: `1px solid ${meta.color}22`,
    }}>
      {meta.label}
    </span>
  );
}

/* ── Formatters ─────────────────────────────────────────────────────────────── */
function formatDuration(startedAt, completedAt) {
  if (!completedAt) return '—';
  const diff = new Date(completedAt) - new Date(startedAt);
  if (diff < 1000) return `${diff}ms`;
  if (diff < 60000) return `${Math.round(diff / 1000)}s`;
  return `${Math.round(diff / 60000)}m`;
}

function formatTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function formatDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

/* ── Data Row ───────────────────────────────────────────────────────────────── */
function DataRow({ label, value, mono = false }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${C.rowSep}`, fontFamily: FONT }}>
      <span style={{ fontSize: 11, color: C.t5, fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: 11, color: C.t2, fontWeight: 600, fontFamily: mono ? MONO : FONT, maxWidth: '60%', textAlign: 'right', wordBreak: 'break-all' }}>
        {value !== undefined && value !== null && value !== '' ? String(value) : '—'}
      </span>
    </div>
  );
}

/* ── API Data Block ─────────────────────────────────────────────────────────── */
function ApiDataBlock({ title, data, mono = false }) {
  if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.t6, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>{title}</div>
      <div style={{ background: C.innerBg, borderRadius: 10, padding: '10px 12px' }}>
        {typeof data === 'object' && !Array.isArray(data)
          ? Object.entries(data).map(([k, v]) => {
              if (v === null || v === undefined) return null;
              if (typeof v === 'object') {
                return (
                  <div key={k} style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: C.t4, marginBottom: 2, textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}</div>
                    <pre style={{ margin: 0, padding: 6, background: '#fff', borderRadius: 6, border: `1px solid ${C.innerBorder}`, fontSize: 9, fontFamily: MONO, color: C.t3, lineHeight: 1.4, overflow: 'auto', maxHeight: 120 }}>
                      {JSON.stringify(v, null, 2)}
                    </pre>
                  </div>
                );
              }
              return <DataRow key={k} label={k.replace(/_/g, ' ')} value={String(v)} mono={mono || k.includes('id') || k.includes('number') || k.includes('timestamp')} />;
            })
          : <DataRow label="Value" value={String(data)} />
        }
      </div>
    </div>
  );
}

/* ── Node Detail Panel ──────────────────────────────────────────────────────── */
function NodeDetailPanel({ step, onClose }) {
  if (!step) return null;
  const output = step.output_data || {};
  const input = step.input_data || {};
  const isTrigger = step.node_type === 'trigger';
  const isMessage = step.node_type === 'message';

  // Determine WhatsApp message status to display
  const waStatus = step.wa_message_status
    || output?.whatsapp?.status
    || output?.deliveryStatus
    || output?.apiResponse?.status
    || null;

  const waMessageId = step.wa_message_id
    || output?.whatsapp?.message_id
    || output?.apiResponse?.message_id
    || null;

  return (
    <div style={{
      width: 380, flexShrink: 0,
      background: C.card, borderLeft: `1px solid ${C.cardBorder}`,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ padding: '14px 16px', borderBottom: `1px solid ${C.cardBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.t1, fontFamily: FONT }}>
            {step.node_name || `${step.node_type} node`}
          </div>
          <div style={{ fontSize: 11, color: C.t5, fontFamily: FONT, marginTop: 2, textTransform: 'capitalize' }}>
            {step.node_type} · {step.node_id}
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.t5, padding: 4 }}>
          <X size={16} />
        </button>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
        {/* Execution status badge */}
        <div style={{ marginBottom: 14 }}>
          <StatusBadge status={step.status} size="md" />
        </div>

        {/* WhatsApp Delivery Status — PROMINENT */}
        {(isTrigger || isMessage) && waStatus && (
          <div style={{ background: C.greenBg, border: `1px solid ${C.green}33`, borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '.08em' }}>WhatsApp Status</span>
              <MessageStatusBadge status={waStatus} />
            </div>
            {waMessageId && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: C.t4, fontWeight: 500 }}>Message ID</span>
                <span style={{ fontSize: 10, fontFamily: MONO, color: C.t2, wordBreak: 'break-all', maxWidth: '55%', textAlign: 'right' }}>{waMessageId}</span>
              </div>
            )}
          </div>
        )}

        {/* Timing */}
        <div style={{ background: C.innerBg, borderRadius: 10, padding: '10px 12px', marginBottom: 14 }}>
          <DataRow label="Started" value={formatDateTime(step.started_at)} />
          <DataRow label="Completed" value={formatDateTime(step.completed_at)} />
          <DataRow label="Duration" value={formatDuration(step.started_at, step.completed_at)} />
        </div>

        {/* WhatsApp-specific data */}
        {(isTrigger || isMessage) && output.whatsapp && (
          <ApiDataBlock title="WhatsApp Message" data={output.whatsapp} mono />
        )}

        {/* Full API Response */}
        {output.apiResponse && (
          <ApiDataBlock title="API Response" data={output.apiResponse} mono />
        )}

        {/* Message-specific */}
        {isMessage && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.t6, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>Message Details</div>
            <div style={{ background: C.innerBg, borderRadius: 10, padding: '10px 12px' }}>
              <DataRow label="Mode" value={output.mode} />
              {output.templateName && <DataRow label="Template" value={output.templateName} />}
              {output.templateCategory && <DataRow label="Category" value={output.templateCategory} />}
              {output.directType && <DataRow label="Direct Type" value={output.directType} />}
              {output.resolvedBody && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 11, color: C.t5, fontWeight: 500, marginBottom: 4 }}>Resolved Body</div>
                  <div style={{ fontSize: 11, color: C.t2, fontFamily: FONT, background: '#fff', borderRadius: 6, padding: 8, border: `1px solid ${C.innerBorder}`, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                    {output.resolvedBody}
                  </div>
                </div>
              )}
              {output.resolvedUrl && <DataRow label="Media URL" value={output.resolvedUrl} mono />}
              {output.resolvedCaption && <DataRow label="Caption" value={output.resolvedCaption} />}
              {output.to && <DataRow label="To" value={output.to} mono />}
              {output.deliveryStatus && <DataRow label="Delivery Status" value={output.deliveryStatus} />}
              {output.note && <DataRow label="Note" value={output.note} />}
            </div>
          </div>
        )}

        {/* Contact info */}
        {output.contact && (
          <ApiDataBlock title="Contact" data={output.contact} />
        )}

        {/* Condition result */}
        {step.node_type === 'condition' && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.t6, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>Condition Result</div>
            <div style={{ background: C.innerBg, borderRadius: 10, padding: '10px 12px' }}>
              <DataRow label="Matched" value={output.matched ? 'Yes' : 'No'} />
              <DataRow label="Match Mode" value={output.matchMode} />
              <DataRow label="Rules Evaluated" value={output.rulesEvaluated} />
            </div>
          </div>
        )}

        {/* Action results */}
        {step.node_type === 'action' && output.results && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.t6, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>Actions</div>
            <div style={{ background: C.innerBg, borderRadius: 10, padding: '10px 12px' }}>
              {output.results.map((r, i) => (
                <DataRow key={i} label={r.kind} value={r.value || r.status} />
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {step.error_message && (
          <div style={{ background: C.redBg, border: `1px solid #F4C9C9`, borderRadius: 10, padding: 10, marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.red, marginBottom: 4 }}>Error</div>
            <div style={{ fontSize: 11, color: C.red, fontFamily: FONT }}>{step.error_message}</div>
          </div>
        )}

        {/* Raw Output JSON */}
        <div style={{ marginBottom: 14 }}>
          <details>
            <summary style={{ fontSize: 11, fontWeight: 700, color: C.t5, cursor: 'pointer', fontFamily: FONT }}>Raw Output JSON</summary>
            <pre style={{
              margin: '8px 0 0', padding: 10, background: C.innerBg, borderRadius: 8,
              fontSize: 10, fontFamily: MONO, color: C.t3, lineHeight: 1.5, overflow: 'auto', maxHeight: 200,
            }}>
              {JSON.stringify(output, null, 2)}
            </pre>
          </details>
        </div>

        {/* Raw Input JSON */}
        <div style={{ marginBottom: 14 }}>
          <details>
            <summary style={{ fontSize: 11, fontWeight: 700, color: C.t5, cursor: 'pointer', fontFamily: FONT }}>Raw Input JSON</summary>
            <pre style={{
              margin: '8px 0 0', padding: 10, background: C.innerBg, borderRadius: 8,
              fontSize: 10, fontFamily: MONO, color: C.t3, lineHeight: 1.5, overflow: 'auto', maxHeight: 200,
            }}>
              {JSON.stringify(input, null, 2)}
            </pre>
          </details>
        </div>
      </div>
    </div>
  );
}

/* ── Filter Bar ─────────────────────────────────────────────────────────────── */
function FilterBar({ filters, onChange, onApply, onReset }) {
  const { status, startDate, endDate, messageStatus } = filters;
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{ borderBottom: `1px solid ${C.cardBorder}`, background: C.card }}>
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 14px', cursor: 'pointer', fontFamily: FONT,
        }}
      >
        <Filter size={13} color={C.t4} />
        <span style={{ fontSize: 12, fontWeight: 600, color: C.t3 }}>Filters</span>
        <ChevronDown size={13} color={C.t5} style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
        {(status !== 'all' || startDate || endDate || messageStatus !== 'all') && (
          <span style={{ marginLeft: 'auto', fontSize: 10, color: C.green, fontWeight: 700 }}>Active</span>
        )}
      </div>

      {expanded && (
        <div style={{ padding: '10px 14px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Date range */}
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: C.t5, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.06em' }}>Start</label>
              <input
                type="datetime-local"
                value={startDate}
                onChange={e => onChange({ ...filters, startDate: e.target.value })}
                style={{
                  width: '100%', padding: '6px 8px', borderRadius: 8,
                  border: `1.5px solid ${C.cardBorder}`, fontSize: 11, fontFamily: FONT,
                  background: '#fff', color: C.t2, outline: 'none',
                }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: C.t5, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.06em' }}>End</label>
              <input
                type="datetime-local"
                value={endDate}
                onChange={e => onChange({ ...filters, endDate: e.target.value })}
                style={{
                  width: '100%', padding: '6px 8px', borderRadius: 8,
                  border: `1.5px solid ${C.cardBorder}`, fontSize: 11, fontFamily: FONT,
                  background: '#fff', color: C.t2, outline: 'none',
                }}
              />
            </div>
          </div>

          {/* Status filters */}
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: C.t5, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.06em' }}>Flow Status</label>
              <select
                value={status}
                onChange={e => onChange({ ...filters, status: e.target.value })}
                style={{
                  width: '100%', padding: '6px 8px', borderRadius: 8,
                  border: `1.5px solid ${C.cardBorder}`, fontSize: 11, fontFamily: FONT,
                  background: '#fff', color: C.t2, outline: 'none', cursor: 'pointer',
                }}
              >
                <option value="all">All statuses</option>
                <option value="success">Success</option>
                <option value="error">Error</option>
                <option value="running">Running</option>
                <option value="paused">Waiting for reply</option>
                <option value="queued">Queued</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: C.t5, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.06em' }}>Message Status</label>
              <select
                value={messageStatus}
                onChange={e => onChange({ ...filters, messageStatus: e.target.value })}
                style={{
                  width: '100%', padding: '6px 8px', borderRadius: 8,
                  border: `1.5px solid ${C.cardBorder}`, fontSize: 11, fontFamily: FONT,
                  background: '#fff', color: C.t2, outline: 'none', cursor: 'pointer',
                }}
              >
                <option value="all">All messages</option>
                <option value="sent">Sent</option>
                <option value="delivered">Delivered</option>
                <option value="read">Read</option>
                <option value="received">Received</option>
                <option value="accepted">Accepted</option>
                <option value="failed">Failed</option>
              </select>
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              onClick={onApply}
              style={{
                flex: 1, padding: '7px 0', borderRadius: 8,
                background: C.t1, color: '#fff', border: 'none',
                fontSize: 12, fontWeight: 700, fontFamily: FONT, cursor: 'pointer',
              }}
            >
              Apply Filters
            </button>
            <button
              onClick={onReset}
              style={{
                flex: 1, padding: '7px 0', borderRadius: 8,
                background: '#fff', color: C.t3, border: `1.5px solid ${C.cardBorder}`,
                fontSize: 12, fontWeight: 700, fontFamily: FONT, cursor: 'pointer',
              }}
            >
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Execution List Item ────────────────────────────────────────────────────── */
function ExecutionListItem({ ex, isSelected, onClick, onCancel, cancelling }) {
  const meta = STATUS_META[ex.status] || STATUS_META.running;
  const Icon = meta.icon;
  const canCancel = CANCELLABLE.has(ex.status);

  return (
    <div
      onClick={onClick}
      style={{
        padding: '12px 14px', borderBottom: `1px solid ${C.rowSep}`,
        cursor: 'pointer', background: isSelected ? C.innerBg : 'transparent',
        borderLeft: isSelected ? `3px solid ${meta.color}` : '3px solid transparent',
        transition: 'all .1s',
      }}
      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = C.innerBg; }}
      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Icon size={14} color={meta.color} />
        <span style={{ fontSize: 12, fontWeight: 700, color: meta.color, fontFamily: FONT }}>
          {meta.label}
        </span>
        <span style={{ flex: 1 }} />
        {canCancel && (
          <button
            onClick={(e) => onCancel(ex.id, e)}
            disabled={cancelling}
            title="Stop this execution"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '2px 8px', borderRadius: 6,
              border: `1px solid ${C.red}`, background: '#fff', color: C.red,
              cursor: cancelling ? 'wait' : 'pointer', fontSize: 10, fontWeight: 700, fontFamily: FONT,
            }}
          >
            {cancelling
              ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} />
              : <Square size={9} fill={C.red} />} Stop
          </button>
        )}
        <span style={{ fontSize: 10, color: C.t6, fontFamily: FONT }}>
          {formatDuration(ex.started_at, ex.completed_at)}
        </span>
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: C.t2, fontFamily: FONT, marginBottom: 2 }}>
        {new Date(ex.started_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
        {' · '}
        {formatTime(ex.started_at)}
      </div>
      <div style={{ fontSize: 11, color: C.t5, fontFamily: FONT }}>
        {ex.trigger_type} {ex.contact_number && `· ${maskPhone(ex.contact_number)}`}
      </div>
    </div>
  );
}

/* ── Main Component ─────────────────────────────────────────────────────────── */
export default function AutomationExecutions({ automation, onBack, hideTopBar, initialExecutionId }) {
  const [executions, setExecutions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [filters, setFilters] = useState({ status: 'all', startDate: '', endDate: '', messageStatus: 'all' });
  const [selectedExecution, setSelectedExecution] = useState(null);
  const [executionDetail, setExecutionDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState(null);

  const loadExecutions = useCallback(async () => {
    if (!automation?.id) return;
    setLoading(true);
    try {
      const res = await api.chatbots.executions(automation.id, {
        page, limit: 30,
        status: filters.status,
        startDate: filters.startDate,
        endDate: filters.endDate,
        messageStatus: filters.messageStatus,
      });
      setExecutions(res.executions || []);
      setTotalPages(res.totalPages || 1);
    } catch (err) {
      console.error('Failed to load executions:', err);
    } finally {
      setLoading(false);
    }
  }, [automation?.id, page, filters]);

  useEffect(() => {
    loadExecutions();
  }, [loadExecutions]);

  // Deep-link: auto-open a specific execution when arriving from elsewhere
  // (e.g. AI Models activity log → click a row). We try the list first; if
  // the target isn't on the current page, fall back to a direct fetch by id.
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (!initialExecutionId || autoOpenedRef.current || loading) return;
    autoOpenedRef.current = true;
    const found = executions.find(e => String(e.id) === String(initialExecutionId));
    if (found) {
      loadExecutionDetail(found);
    } else {
      // Pull just the row we need
      api.executions.get(initialExecutionId)
        .then(data => {
          if (data) {
            setExecutionDetail(data);
            setSelectedExecution(data.execution || { id: initialExecutionId });
            setSelectedNodeId(null);
          }
        })
        .catch(err => console.error('Failed to auto-open execution:', err));
    }
  }, [initialExecutionId, executions, loading]);

  const loadExecutionDetail = useCallback(async (execution) => {
    setDetailLoading(true);
    try {
      const data = await api.executions.get(execution.id);
      setExecutionDetail(data);
      setSelectedExecution(execution);
      setSelectedNodeId(null);
    } catch (err) {
      console.error('Failed to load execution detail:', err);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const [cancellingId, setCancellingId] = useState(null);
  const handleCancel = useCallback(async (execId, e) => {
    if (e) e.stopPropagation();
    setCancellingId(execId);
    try {
      const updated = await api.executions.cancel(execId);
      // Reflect new status in the list and (if open) the detail header
      setExecutions(prev => prev.map(x => x.id === updated.id ? { ...x, ...updated } : x));
      setSelectedExecution(prev => (prev && prev.id === updated.id ? { ...prev, ...updated } : prev));
    } catch (err) {
      alert(err.message || 'Failed to stop execution');
    } finally {
      setCancellingId(null);
    }
  }, []);

  const handleNodeClick = useCallback((node, step) => {
    if (step) {
      setSelectedNodeId(node.id);
    }
  }, []);

  const selectedStep = useMemo(() => {
    if (!selectedNodeId || !executionDetail?.steps) return null;
    return executionDetail.steps.find(s => s.node_id === selectedNodeId);
  }, [selectedNodeId, executionDetail]);

  const nodes = useMemo(() => {
    return automation?.config?.nodes || [];
  }, [automation]);

  const edges = useMemo(() => {
    return automation?.config?.edges || [];
  }, [automation]);

  const applyFilters = () => {
    setPage(1);
    loadExecutions();
  };

  const resetFilters = () => {
    setFilters({ status: 'all', startDate: '', endDate: '', messageStatus: 'all' });
    setPage(1);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', background: C.pageBg, fontFamily: FONT }}>
      {!hideTopBar && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 16px', background: C.card, borderBottom: `1px solid ${C.cardBorder}`,
          flexShrink: 0, gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => { setSelectedExecution(null); setExecutionDetail(null); setSelectedNodeId(null); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: 600, fontFamily: FONT, color: C.t4,
              }}
            >
              <ArrowLeft size={14} /> {selectedExecution ? 'Back to list' : 'Back to automations'}
            </button>
            {selectedExecution && (
              <>
                <div style={{ width: 1, height: 20, background: C.cardBorder }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: C.t1 }}>
                  Execution #{selectedExecution.id}
                </span>
                <StatusBadge status={selectedExecution.status} size="sm" />
              </>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {selectedExecution && CANCELLABLE.has(selectedExecution.status) && (
              <button
                onClick={() => handleCancel(selectedExecution.id)}
                disabled={cancellingId === selectedExecution.id}
                title="Stop this execution"
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 12px', borderRadius: 8,
                  border: `1.5px solid ${C.red}`, background: '#fff', color: C.red,
                  cursor: cancellingId === selectedExecution.id ? 'wait' : 'pointer',
                  fontSize: 12, fontWeight: 700, fontFamily: FONT,
                }}
              >
                {cancellingId === selectedExecution.id
                  ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                  : <Square size={12} fill={C.red} />} Stop execution
              </button>
            )}
            {!selectedExecution && (
              <>
                <button
                  onClick={loadExecutions}
                  style={{
                    width: 30, height: 30, borderRadius: 8,
                    border: `1.5px solid ${C.cardBorder}`, background: '#fff',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: C.t4,
                  }}
                  title="Refresh"
                >
                  <RefreshCw size={13} />
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Main content */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left sidebar — execution list */}
        <div style={{
          width: 300, flexShrink: 0,
          background: C.card, borderRight: `1px solid ${C.cardBorder}`,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          {/* Filters */}
          <FilterBar
            filters={filters}
            onChange={setFilters}
            onApply={applyFilters}
            onReset={resetFilters}
          />

          <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.cardBorder}`, fontSize: 11, fontWeight: 700, color: C.t4, textTransform: 'uppercase', letterSpacing: '.06em' }}>
            Executions ({executions.length})
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, gap: 8 }}>
                <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                <span style={{ fontSize: 12, color: C.t5 }}>Loading…</span>
              </div>
            ) : executions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: C.t5, fontSize: 12 }}>
                No executions yet
              </div>
            ) : (
              executions.map(ex => (
                <ExecutionListItem
                  key={ex.id}
                  ex={ex}
                  isSelected={selectedExecution?.id === ex.id}
                  onClick={() => loadExecutionDetail(ex)}
                  onCancel={handleCancel}
                  cancelling={cancellingId === ex.id}
                />
              ))
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 6, padding: 10, borderTop: `1px solid ${C.cardBorder}` }}>
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                style={{
                  padding: '4px 10px', borderRadius: 6, border: `1.5px solid ${C.cardBorder}`,
                  background: '#fff', fontSize: 11, fontFamily: FONT, fontWeight: 600,
                  color: page <= 1 ? C.t6 : C.t2, cursor: page <= 1 ? 'not-allowed' : 'pointer',
                }}
              >
                Prev
              </button>
              <span style={{ padding: '4px 10px', fontSize: 11, fontFamily: FONT, color: C.t4 }}>
                {page}/{totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                style={{
                  padding: '4px 10px', borderRadius: 6, border: `1.5px solid ${C.cardBorder}`,
                  background: '#fff', fontSize: 11, fontFamily: FONT, fontWeight: 600,
                  color: page >= totalPages ? C.t6 : C.t2, cursor: page >= totalPages ? 'not-allowed' : 'pointer',
                }}
              >
                Next
              </button>
            </div>
          )}
        </div>

        {/* Right area — canvas or empty state */}
        {selectedExecution ? (
          <>
            {detailLoading ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
                <span style={{ fontSize: 13, color: C.t5, fontFamily: FONT }}>Loading execution…</span>
              </div>
            ) : (
              <>
                <ExecutionFlowCanvas
                  nodes={nodes}
                  edges={edges}
                  steps={executionDetail?.steps || []}
                  onNodeClick={handleNodeClick}
                  selectedNodeId={selectedNodeId}
                />
                {selectedStep && (
                  <NodeDetailPanel
                    step={selectedStep}
                    onClose={() => setSelectedNodeId(null)}
                  />
                )}
              </>
            )}
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.t3, fontFamily: FONT }}>
              Select an execution to view its flow
            </div>
            <div style={{ fontSize: 12, color: C.t5, fontFamily: FONT }}>
              Click any execution in the left sidebar to see the node-by-node flow
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
