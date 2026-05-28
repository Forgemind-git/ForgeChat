import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, ChevronRight, CheckCircle2, AlertCircle, Clock, Cpu, Wrench, MessageSquare } from 'lucide-react';
import { api } from '../../api.js';
import { C, FONT, MONO } from '../../constants.js';

/**
 * Run history for one agent. Shows recent runs (newest first), expanding a
 * row reveals the per-step trace (LLM calls + tool calls with input/output).
 */
export default function AgentRunsViewer({ agentId }) {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);
  const [openDetail, setOpenDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = await api.agents.runs(agentId);
      setRuns(r);
    } catch (e) {
      setError(pretty(e));
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleExpand = async (run) => {
    if (openId === run.id) {
      setOpenId(null);
      setOpenDetail(null);
      return;
    }
    setOpenId(run.id);
    setOpenDetail(null);
    setLoadingDetail(true);
    try {
      const detail = await api.agents.run(agentId, run.id);
      setOpenDetail(detail);
    } catch (e) {
      setError(pretty(e));
    } finally {
      setLoadingDetail(false);
    }
  };

  return (
    <div style={{ fontFamily: FONT }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <button onClick={refresh}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 10px', borderRadius: 8,
            border: `1px solid ${C.border}`, background: C.cardBg,
            color: C.text, fontSize: 12, fontFamily: FONT, fontWeight: 600,
            cursor: 'pointer',
          }}>
          <RefreshCw size={12} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} /> Refresh
        </button>
      </div>

      {error && (
        <div style={{ padding: '8px 12px', borderRadius: 8, marginBottom: 10,
          background: '#FCEBEB', color: '#A32D2D', border: '1px solid #FBC8C8', fontSize: 12 }}>
          {error}
        </div>
      )}

      {!loading && runs.length === 0 && (
        <div style={{ padding: 16, background: C.surfaceAlt, borderRadius: 8,
          border: `1px dashed ${C.border}`, textAlign: 'center', fontSize: 12, color: C.textSecondary }}>
          No runs yet. Send the agent a WhatsApp message to trigger one.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {runs.map(r => (
          <div key={r.id} style={{ background: C.cardBg, borderRadius: 8, border: `1px solid ${C.border}` }}>
            <button
              onClick={() => handleExpand(r)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px', background: 'transparent', border: 'none',
                cursor: 'pointer', textAlign: 'left',
              }}
            >
              <ChevronRight size={13} style={{
                transform: openId === r.id ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform .15s',
                color: C.textMuted,
              }} />
              <StatusIcon status={r.status} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: C.text, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.finalReply || (r.errorMessage ? `Error: ${r.errorMessage}` : '(no reply)')}
                </div>
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2, fontFamily: MONO }}>
                  +{r.contactNumber} · {formatRelative(r.startedAt)} · {durationMs(r)} ·{' '}
                  {(r.totalInputTokens || 0)}↓/{(r.totalOutputTokens || 0)}↑ tok
                </div>
              </div>
            </button>
            {openId === r.id && (
              <div style={{ borderTop: `1px solid ${C.border}`, padding: 12, background: C.surfaceAlt }}>
                {loadingDetail && (
                  <div style={{ fontSize: 12, color: C.textMuted }}>Loading…</div>
                )}
                {openDetail && (
                  <Steps run={openDetail} />
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusIcon({ status }) {
  if (status === 'completed') return <CheckCircle2 size={14} color="#0F7A38" />;
  if (status === 'failed')    return <AlertCircle size={14} color={C.primary} />;
  if (status === 'capped')    return <AlertCircle size={14} color="#B45309" />;
  return <Clock size={14} color={C.textMuted} />;
}

function Steps({ run }) {
  const steps = run.steps || [];
  if (steps.length === 0) {
    return <div style={{ fontSize: 12, color: C.textMuted }}>No steps recorded.</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {steps.map(s => <Step key={s.id} step={s} />)}
      {run.finalReply && (
        <div style={{
          padding: '10px 12px', borderRadius: 8,
          background: '#ECFDF5', border: '1px solid #A7F3D0',
          fontSize: 12, color: '#065F46', display: 'flex', gap: 8, alignItems: 'flex-start',
        }}>
          <MessageSquare size={13} style={{ marginTop: 1 }} />
          <div>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>Reply sent</div>
            <div>{run.finalReply}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function Step({ step }) {
  const isTool = step.stepType === 'tool_call';
  const Icon = isTool ? Wrench : Cpu;
  const titleColor = step.status === 'error' ? C.primary : C.text;
  return (
    <div style={{
      padding: '10px 12px', borderRadius: 8,
      background: C.cardBg, border: `1px solid ${C.border}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Icon size={13} color={isTool ? '#0F7A38' : '#534AB7'} />
        <div style={{ fontSize: 12, fontWeight: 700, color: titleColor, flex: 1 }}>
          {isTool ? `Tool: ${step.toolType}` : 'LLM call'}
          {step.status === 'error' && ' · error'}
        </div>
        <div style={{ fontSize: 11, color: C.textMuted, fontFamily: MONO }}>
          {step.latencyMs != null ? `${step.latencyMs}ms` : ''}
        </div>
      </div>
      {step.errorMessage && (
        <div style={{ fontSize: 11, color: C.primary, marginBottom: 6 }}>{step.errorMessage}</div>
      )}
      {step.input && (
        <CollapseBlock label="input" content={step.input} />
      )}
      {step.output && (
        <CollapseBlock label="output" content={step.output} />
      )}
    </div>
  );
}

function CollapseBlock({ label, content }) {
  const [open, setOpen] = useState(false);
  const json = JSON.stringify(content, null, 2);
  const short = json.length > 120 ? json.slice(0, 120) + '…' : json;
  return (
    <div style={{ marginTop: 4 }}>
      <button onClick={() => setOpen(o => !o)}
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          fontSize: 11, color: C.textSecondary, fontWeight: 600, fontFamily: FONT,
          padding: 0,
        }}>
        {open ? '▾' : '▸'} {label}
      </button>
      <pre style={{
        margin: '4px 0 0', padding: open ? '8px 10px' : '4px 10px',
        background: C.surfaceAlt, borderRadius: 6,
        fontFamily: MONO, fontSize: 11, color: C.text,
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        maxHeight: open ? 240 : 30, overflow: 'auto',
      }}>
        {open ? json : short}
      </pre>
    </div>
  );
}

function durationMs(r) {
  if (!r.startedAt) return '';
  const end = r.endedAt ? new Date(r.endedAt).getTime() : Date.now();
  const ms = end - new Date(r.startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatRelative(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return d.toLocaleString();
}

function pretty(e) {
  if (!e) return 'Unknown error';
  const msg = e.message || String(e);
  try {
    const m = msg.match(/^\d+\s+(.+)$/);
    if (m) {
      const body = JSON.parse(m[1]);
      if (body && body.error) return body.error;
    }
  } catch { /* fall through */ }
  return msg;
}
