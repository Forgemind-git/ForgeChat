import { useState, useRef, useEffect } from 'react';
import { RotateCcw, AlertCircle, Mic, Square, Loader2, FileText, Music } from 'lucide-react';
import { api } from '../../api.js';
import { C, FONT } from '../../constants.js';
import { PhoneFrame } from '../WhatsAppPreview.jsx';

/**
 * Live agent test, rendered inside the shared iPhone frame so it looks exactly
 * like a real WhatsApp chat. Typing (or recording a voice note) round-trips
 * through POST /agents/:id/test — the same LLM tool-use loop the real WhatsApp
 * path uses, minus the WhatsApp send. The agent's media/link replies are
 * rendered as real bubbles (images, audio, docs); the mic button records a
 * voice note and transcribes it (POST /agents/:id/test/transcribe) so you can
 * test the agent's voice-note handling end to end.
 *
 * Sheets tools ARE real (they hit the configured spreadsheet). When `canTest`
 * is false (an unsaved agent) the composer is disabled.
 */
export default function AgentLivePreview({ agentId, headerTitle, canTest = true }) {
  const [messages, setMessages] = useState([]); // see message shape below
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState('');
  const bodyRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, sending, transcribing]);

  // Run one turn: set the transcript, call the agent, append its reply (with any
  // media/links it sent).
  const runTurn = async (next) => {
    setMessages(next);
    setSending(true);
    setError('');
    try {
      const payload = next.filter(m => m.content).map(m => ({ role: m.role, content: m.content }));
      const res = await api.agents.test(agentId, payload);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: res.reply || '',
        media: Array.isArray(res.media) ? res.media : [],
        links: Array.isArray(res.links) ? res.links : [],
        status: res.status,
      }]);
    } catch (e) {
      setError(pretty(e));
    } finally {
      setSending(false);
    }
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || sending || recording || transcribing || !canTest) return;
    setInput('');
    runTurn([...messages, { role: 'user', content: text }]);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  // ── Voice note recording → transcription ──────────────────────────
  const startRecording = async () => {
    if (!canTest || sending || transcribing) return;
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        stream.getTracks().forEach(t => t.stop());
        if (blob.size) handleVoiceNote(blob);
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      setError('Microphone unavailable or permission denied.');
    }
  };

  const stopRecording = () => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
    setRecording(false);
  };

  const handleVoiceNote = async (blob) => {
    const audioUrl = URL.createObjectURL(blob);
    setTranscribing(true);
    setError('');
    try {
      const { text } = await api.agents.testTranscribe(agentId, blob);
      const t = (text || '').trim();
      setTranscribing(false);
      if (!t) {
        setMessages(prev => [...prev, { role: 'user', audioUrl, voice: true, note: 'Could not transcribe' }]);
        return;
      }
      // Show the voice bubble (audio + transcript) and run the agent on it.
      await runTurn([...messages, { role: 'user', content: t, audioUrl, voice: true }]);
    } catch (e) {
      setTranscribing(false);
      setError(pretty(e));
      setMessages(prev => [...prev, { role: 'user', audioUrl, voice: true, note: 'Transcription failed' }]);
    }
  };

  const busy = sending || transcribing;
  const showSend = !!input.trim() && !recording;

  const composer = (
    <div style={{ padding: '7px 9px 22px', display: 'flex', alignItems: 'center', gap: 6 }}>
      {recording ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', background: 'var(--c-cardBg)', borderRadius: 99, border: '1px solid var(--c-border)' }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: '#EF4444', animation: 'agentRecPulse 1s ease-in-out infinite' }} />
          <span style={{ fontSize: 12, color: C.text, fontFamily: FONT }}>Recording… tap ◼ to send</span>
        </div>
      ) : transcribing ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', background: 'var(--c-cardBg)', borderRadius: 99, border: '1px solid var(--c-border)' }}>
          <Loader2 size={13} style={{ animation: 'spin 1s linear infinite', color: C.textMuted }} />
          <span style={{ fontSize: 12, color: C.textMuted, fontFamily: FONT }}>Transcribing…</span>
        </div>
      ) : (
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!canTest || sending}
          placeholder={canTest ? 'Message' : 'Save the agent to test'}
          style={{
            flex: 1, minWidth: 0, background: 'var(--c-cardBg)', borderRadius: 99,
            padding: '8px 12px', fontSize: 12, color: C.text, fontFamily: FONT,
            border: '1px solid var(--c-border)', outline: 'none', opacity: canTest ? 1 : 0.6,
          }}
        />
      )}

      {showSend ? (
        <CircleBtn label="Send" color="#25D366" onClick={handleSend} disabled={!canTest || busy}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22,2 15,22 11,13 2,9 22,2" fill="currentColor" stroke="none" />
          </svg>
        </CircleBtn>
      ) : (
        <CircleBtn
          label={recording ? 'Stop & send' : 'Record voice note'}
          color={recording ? '#EF4444' : '#25D366'}
          onClick={recording ? stopRecording : startRecording}
          disabled={!canTest || transcribing || sending}
        >
          {recording ? <Square size={13} fill="#fff" stroke="#fff" /> : <Mic size={15} />}
        </CircleBtn>
      )}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, fontFamily: FONT }}>
      <style>{`@keyframes agentTypingBlink{0%,80%,100%{opacity:.25}40%{opacity:1}}@keyframes agentRecPulse{0%,100%{opacity:1}50%{opacity:.3}}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <PhoneFrame
        headerTitle={(headerTitle || '').trim() || 'Test Agent'}
        headerSubtitle={sending ? 'typing…' : (recording ? 'recording…' : 'online')}
        inputBar={composer}
        bodyRef={bodyRef}
      >
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
          <span style={{ background: '#E1F2FA', color: '#3C6678', fontSize: 9, padding: '2px 9px', borderRadius: 99, fontWeight: 600 }}>TODAY</span>
        </div>

        {messages.length === 0 && !sending && !transcribing && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 26, marginBottom: 6, opacity: 0.4 }}>💬</div>
            <div style={{ fontSize: 10.5, color: '#5b6b73', fontWeight: 500, lineHeight: 1.5, whiteSpace: 'pre-line' }}>
              {canTest ? 'Send a message or 🎤 voice note\nto chat with this agent live' : 'Save the agent first,\nthen test it here'}
            </div>
          </div>
        )}

        {messages.map((m, i) => <MessageBlock key={i} message={m} />)}

        {(sending || transcribing) && (
          <div style={{ marginRight: 'auto', maxWidth: '80%' }}>
            <div style={{ background: 'var(--c-cardBg)', borderRadius: '7.5px 7.5px 7.5px 0', padding: '8px 12px', boxShadow: '0 1px 0.5px rgba(11,20,26,.13)', display: 'flex', gap: 4, alignItems: 'center' }}>
              <Dot delay="0s" /><Dot delay=".15s" /><Dot delay=".3s" />
            </div>
          </div>
        )}

        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '8px auto 0', maxWidth: '92%', padding: '6px 9px', borderRadius: 8, background: '#FCEBEB', color: '#A32D2D', fontSize: 10, lineHeight: 1.4 }}>
            <AlertCircle size={12} style={{ flexShrink: 0 }} />
            <span style={{ wordBreak: 'break-word' }}>{error}</span>
          </div>
        )}
      </PhoneFrame>

      <button
        type="button"
        onClick={() => { setMessages([]); setError(''); }}
        disabled={messages.length === 0 && !error}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          background: 'transparent', border: 'none',
          fontSize: 12, color: C.textSecondary, fontFamily: FONT, fontWeight: 600,
          cursor: (messages.length === 0 && !error) ? 'default' : 'pointer',
          opacity: (messages.length === 0 && !error) ? 0.45 : 1,
        }}
      >
        <RotateCcw size={12} /> Reset chat
      </button>
    </div>
  );
}

// All the bubbles for one message: text, a recorded voice note (user), and any
// media / links the agent sent.
function MessageBlock({ message }) {
  const isUser = message.role === 'user';
  const media = message.media || [];
  const links = message.links || [];
  return (
    <>
      {message.voice && (
        <Bubble isUser={isUser}>
          <audio controls src={message.audioUrl} style={{ width: 200, maxWidth: '100%', height: 34, display: 'block' }} />
          {message.content && <div style={textStyle}>{message.content}</div>}
          {message.note && <div style={{ fontSize: 10, color: '#B45309', marginTop: 3 }}>{message.note}</div>}
          <MetaRow isUser={isUser} />
        </Bubble>
      )}

      {!message.voice && message.content && (
        <Bubble isUser={isUser}>
          <div style={textStyle}>{message.content}</div>
          {message.status === 'capped' && (
            <div style={{ fontSize: 9.5, color: '#B45309', marginTop: 3 }}>Hit the tool-iteration cap; reply may be partial.</div>
          )}
          <MetaRow isUser={isUser} />
        </Bubble>
      )}

      {media.map((m, i) => (
        <Bubble key={`m${i}`} isUser={isUser} pad={m.type === 'image' || m.type === 'video' ? 3 : undefined}>
          <MediaItem item={m} />
          <MetaRow isUser={isUser} />
        </Bubble>
      ))}

      {links.map((url, i) => (
        <Bubble key={`l${i}`} isUser={isUser}>
          <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: '#027EB5', textDecoration: 'underline', wordBreak: 'break-all', fontFamily: FONT }}>{url}</a>
          <MetaRow isUser={isUser} />
        </Bubble>
      ))}
    </>
  );
}

function Bubble({ isUser, children, pad }) {
  return (
    <div style={{ marginLeft: isUser ? 'auto' : 0, marginRight: isUser ? 0 : 'auto', maxWidth: '82%', marginBottom: 6 }}>
      <div style={{
        background: isUser ? '#DCF8C6' : 'var(--c-cardBg)',
        borderRadius: isUser ? '7.5px 7.5px 0 7.5px' : '7.5px 7.5px 7.5px 0',
        padding: pad != null ? pad : '6px 9px 5px',
        boxShadow: '0 1px 0.5px rgba(11,20,26,.13)', overflow: 'hidden',
      }}>
        {children}
      </div>
    </div>
  );
}

function MediaItem({ item }) {
  const src = api.mediaLibrary.downloadUrl(item.id);
  if (item.type === 'image') {
    return <img src={src} alt={item.name} style={{ display: 'block', width: '100%', maxWidth: 230, borderRadius: 5 }} />;
  }
  if (item.type === 'video') {
    return <video src={src} controls style={{ display: 'block', width: '100%', maxWidth: 230, borderRadius: 5 }} />;
  }
  if (item.type === 'audio') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 180 }}>
        <Music size={16} color="#00A884" style={{ flexShrink: 0 }} />
        <audio controls src={src} style={{ width: 180, maxWidth: '100%', height: 34 }} />
      </div>
    );
  }
  // document / other → a file card that opens on tap
  return (
    <a href={src} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 170, textDecoration: 'none', padding: '2px 0' }}>
      <div style={{ width: 34, height: 38, background: '#fff', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 1px 3px rgba(0,0,0,.15)' }}>
        <FileText size={16} color="#e94235" />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-text)', fontFamily: FONT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</div>
        <div style={{ fontSize: 9.5, color: 'var(--c-textMuted)', fontFamily: FONT, textTransform: 'uppercase' }}>{(item.type || 'file')}</div>
      </div>
    </a>
  );
}

function MetaRow({ isUser }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 3, marginTop: 2, marginBottom: -1 }}>
      <span style={{ fontSize: 10, color: 'var(--c-textSecondary)', fontFamily: FONT }}>9:41</span>
      {isUser && (
        <svg width="16" height="11" viewBox="0 0 16 11" fill="none"><path d="M1 5.5L5 9.5L11.5 1" stroke="#53BDEB" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /><path d="M5 5.5L9 9.5L15.5 1" stroke="#53BDEB" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      )}
    </div>
  );
}

function CircleBtn({ children, color, onClick, disabled, label }) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label}
      style={{
        width: 32, height: 32, background: color, borderRadius: '50%', border: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
        flexShrink: 0, boxShadow: '0 1px 2px rgba(0,0,0,.15)',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1,
      }}
    >
      {children}
    </button>
  );
}

const textStyle = {
  fontSize: 13, color: 'var(--c-text)', lineHeight: 1.5,
  whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere', fontFamily: FONT,
};

function Dot({ delay }) {
  return (
    <span style={{
      width: 5, height: 5, borderRadius: '50%', background: '#9aa3a8',
      display: 'inline-block', animation: `agentTypingBlink 1.2s ${delay} infinite ease-in-out`,
    }} />
  );
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
