import { useState, useRef, useEffect } from 'react';
import { Send, RotateCcw, Loader2, Bot, User as UserIcon, Wrench, Cpu, AlertCircle } from 'lucide-react';
import { api } from '../../api.js';
import { C, FONT, MONO } from '../../constants.js';

/**
 * In-app test chat for an agent. Round-trips through POST /agents/:id/test,
 * which runs the same LLM tool-use loop the real WhatsApp path uses — but
 * skips the WhatsApp send AND the agent_runs persistence, so noodling around
 * here doesn't pollute the run history visible above.
 *
 * Conversation state lives entirely in this component (not in chat_history),
 * so a multi-turn test session is sent in full on each call. Refresh clears it.
 *
 * Tool calls (Sheets read/append/update) ARE real — they hit the configured
 * spreadsheet. Operators should point a test agent at a test spreadsheet
 * before clicking around in here.
 */
export default function TestChat({ agentId }) {
  const [messages, setMessages] = useState([]); // [{ role:'user'|'assistant', content, steps?, status? }]
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const threadRef = useRef(null);

  // Auto-scroll to bottom on every new message.
  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages, sending]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setError('');
    setInput('');

    const nextHistory = [...messages, { role: 'user', content: text }];
    setMessages(nextHistory);
    setSending(true);

    try {
      // Send only the {role, content} shape to the backend — strip our local
      // step/status fields so the API sees a clean conversation transcript.
      const payload = nextHistory.map(m => ({ role: m.role, content: m.content }));
      const res = await api.agents.test(agentId, payload);
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: res.reply || '(no reply)',
          steps: res.steps || [],
          status: res.status,
          totalInputTokens: res.totalInputTokens,
          totalOutputTokens: res.totalOutputTokens,
          iterations: res.iterations,
        },
      ]);
    } catch (e) {
      setError(pretty(e));
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    // Enter sends, Shift+Enter inserts a newline (matches every other chat UI).
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleReset = () => {
    setMessages([]);
    setError('');
  };

  return (
    <div style={{ fontFamily: FONT }}>
      {error && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px', borderRadius: 8, marginBottom: 10,
          background: '#FCEBEB', color: '#A32D2D', border: '1px solid #FBC8C8', fontSize: 12,
        }}>
          <AlertCircle size={13} /> {error}
        </div>
      )}

      <div
        ref={threadRef}
        style={{
          maxHeight: 380, overflowY: 'auto',
          padding: '12px 14px', background: 'var(--c-surfaceAlt)',
          borderRadius: 10, border: `1px solid ${C.border}`,
          display: 'flex', flexDirection: 'column', gap: 10,
        }}
      >
        {messages.length === 0 && !sending && (
          <div style={{ fontSize: 12, color: C.textMuted, padding: 12, textAlign: 'center' }}>
            Send a message below to test the agent.
          </div>
        )}
        {messages.map((m, idx) => <Bubble key={idx} message={m} />)}
        {sending && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: C.textMuted, fontSize: 12, padding: '4px 8px' }}>
            <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
            Agent is thinking…
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message and press Enter to send…"
          rows={2}
          style={{
            flex: 1, padding: '10px 12px', borderRadius: 8,
            border: `1px solid ${C.border}`, fontSize: 13, fontFamily: FONT,
            color: C.text, background: C.cardBg, outline: 'none',
            resize: 'vertical', minHeight: 44, maxHeight: 140,
          }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button
            onClick={handleSend}
            disabled={sending || !input.trim()}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '10px 14px', borderRadius: 8,
              border: 'none', background: C.primary, color: '#fff',
              fontSize: 12, fontFamily: FONT, fontWeight: 700,
              cursor: (sending || !input.trim()) ? 'not-allowed' : 'pointer',
              opacity: (sending || !input.trim()) ? 0.6 : 1, whiteSpace: 'nowrap',
            }}
          >
            {sending ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={13} />}
            Send
          </button>
          <button
            onClick={handleReset}
            disabled={messages.length === 0 && !error}
            title="Reset the conversation"
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '10px 14px', borderRadius: 8,
              border: `1px solid ${C.border}`, background: C.cardBg, color: C.text,
              fontSize: 12, fontFamily: FONT, fontWeight: 600,
              cursor: (messages.length === 0 && !error) ? 'not-allowed' : 'pointer',
              opacity: (messages.length === 0 && !error) ? 0.5 : 1, whiteSpace: 'nowrap',
            }}
          >
            <RotateCcw size={13} /> Reset
          </button>
        </div>
      </div>
    </div>
  );
}

function Bubble({ message }) {
  const isUser = message.role === 'user';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start' }}>
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 8, maxWidth: '85%',
        flexDirection: isUser ? 'row-reverse' : 'row',
      }}>
        <div style={{
          width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
          background: isUser ? '#E0E7FF' : '#FEF1F1',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {isUser ? <UserIcon size={13} color="#3730A3" /> : <Bot size={13} color={C.primary} />}
        </div>
        <div>
          <div style={{
            padding: '8px 12px', borderRadius: 10,
            background: isUser ? '#fff' : C.cardBg,
            border: `1px solid ${C.border}`,
            fontSize: 13, color: C.text, lineHeight: 1.45,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {message.content}
          </div>
          {!isUser && message.steps && message.steps.length > 0 && (
            <StepsCollapsible steps={message.steps} />
          )}
          {!isUser && message.status === 'capped' && (
            <div style={{ fontSize: 10, color: '#B45309', marginTop: 4 }}>
              Hit the max-tool-iterations cap; reply may be partial.
            </div>
          )}
          {!isUser && (message.totalInputTokens || message.totalOutputTokens) && (
            <div style={{ fontSize: 10, color: C.textMuted, marginTop: 3, fontFamily: MONO }}>
              {message.totalInputTokens || 0}↓ / {message.totalOutputTokens || 0}↑ tok · {message.iterations || 1} iter
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StepsCollapsible({ steps }) {
  const [open, setOpen] = useState(false);
  const llmCalls = steps.filter(s => s.stepType === 'llm_call').length;
  const toolCalls = steps.filter(s => s.stepType === 'tool_call').length;
  return (
    <div style={{ marginTop: 6 }}>
      <button onClick={() => setOpen(o => !o)}
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
          fontSize: 11, color: C.textSecondary, fontWeight: 600, fontFamily: FONT,
        }}>
        {open ? '▾' : '▸'} trace · {llmCalls} LLM · {toolCalls} tool
      </button>
      {open && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {steps.map((s) => <StepRow key={s.stepIndex} step={s} />)}
        </div>
      )}
    </div>
  );
}

function StepRow({ step }) {
  const isTool = step.stepType === 'tool_call';
  const Icon = isTool ? Wrench : Cpu;
  return (
    <div style={{
      padding: '6px 10px', borderRadius: 6,
      background: 'var(--c-surfaceAlt)', border: `1px solid ${C.border}`,
      fontSize: 11, fontFamily: MONO, color: C.text,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        <Icon size={11} color={isTool ? '#0F7A38' : '#534AB7'} />
        <span style={{ fontWeight: 700, color: step.status === 'error' ? C.primary : C.text }}>
          {isTool ? `tool: ${step.toolType}` : 'llm'}
        </span>
        {step.latencyMs != null && (
          <span style={{ color: C.textMuted }}>{step.latencyMs}ms</span>
        )}
        {step.status === 'error' && <span style={{ color: C.primary }}>error</span>}
      </div>
      {step.errorMessage && (
        <div style={{ color: C.primary, marginBottom: 2 }}>{step.errorMessage}</div>
      )}
      {step.input != null && (
        <div style={{ color: C.textSecondary, wordBreak: 'break-word' }}>
          in: {clip(JSON.stringify(step.input), 200)}
        </div>
      )}
      {step.output != null && (
        <div style={{ color: C.textSecondary, wordBreak: 'break-word' }}>
          out: {clip(JSON.stringify(step.output), 200)}
        </div>
      )}
    </div>
  );
}

function clip(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
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
