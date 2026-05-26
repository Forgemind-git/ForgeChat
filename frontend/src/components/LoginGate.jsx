import { useState } from 'react';
import { Lock, LogIn, Eye, EyeOff } from 'lucide-react';
import { api } from '../api.js';
import { C, FONT } from '../constants.js';

export default function LoginGate({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) { setError('Email and password required.'); return; }
    setError('');
    setLoading(true);
    try {
      const { user } = await api.auth.login(email, password);
      onLogin(user);
    } catch (err) {
      setError(err.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      display: 'flex',
      width: '100%',
      height: '100%',
      fontFamily: FONT,
    }}>
      {/* Left brand panel — fills full height */}
      <div className="login-brand-panel" style={{
        flex: 1,
        minWidth: 0,
        background: C.headerBg,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '48px 64px',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Subtle radial accent */}
        <div style={{
          position: 'absolute',
          top: '-20%',
          right: '-10%',
          width: '60%',
          height: '60%',
          background: 'radial-gradient(circle, rgba(220,38,38,0.15) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute',
          bottom: '-20%',
          left: '-10%',
          width: '50%',
          height: '50%',
          background: 'radial-gradient(circle, rgba(83,74,183,0.12) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />

        <div style={{ position: 'relative', zIndex: 1, maxWidth: 480 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 40 }}>
            <img
              src="/forgemind-logo.gif"
              alt="ForgeMind Logo"
              style={{ height: 56, width: 56, objectFit: 'contain', flexShrink: 0 }}
              onError={e => { e.currentTarget.style.display = 'none'; }}
            />
            <div style={{ lineHeight: 1.15 }}>
              <div style={{
                fontSize: 28,
                fontWeight: 800,
                letterSpacing: '-0.02em',
                color: C.headerText,
              }}>
                Forge<span style={{ color: C.primary }}>Chat</span>
              </div>
              <div style={{
                fontSize: 11,
                fontWeight: 700,
                color: C.headerMuted,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                marginTop: 4,
              }}>
                powered by FMOS
              </div>
            </div>
          </div>

          <h1 style={{
            fontSize: 42,
            fontWeight: 800,
            color: C.headerText,
            letterSpacing: '-0.03em',
            lineHeight: 1.15,
            marginBottom: 20,
          }}>
            Manage conversations at scale
          </h1>
          <p style={{
            fontSize: 16,
            color: C.headerMuted,
            lineHeight: 1.6,
            marginBottom: 40,
          }}>
            Reply to WhatsApp chats, build templates, send broadcasts, and automate responses — all from one place for your team.
          </p>

        </div>

        <a
          href="https://forgemind.in/"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            position: 'absolute',
            bottom: 32,
            left: 64,
            fontSize: 10,
            fontWeight: 600,
            color: '#52525b',
            letterSpacing: '.06em',
            textTransform: 'uppercase',
            textDecoration: 'none',
            cursor: 'pointer',
          }}
        >
          FORGEMIND <span style={{ color: C.primary }}>AI</span>
        </a>
      </div>

      {/* Right form panel */}
      <div className="login-form-panel" style={{
        width: '100%',
        maxWidth: 540,
        minWidth: 360,
        background: C.pageBg,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '40px 48px',
        overflowY: 'auto',
      }}>
        <div style={{
          width: '100%',
          maxWidth: 400,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <Lock size={14} color={C.primary} />
            <span style={{
              fontSize: 11,
              fontWeight: 700,
              color: C.primary,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}>
              Sign In
            </span>
          </div>
          <h2 style={{
            fontSize: 24,
            fontWeight: 700,
            color: C.text,
            marginBottom: 28,
            letterSpacing: '-0.02em',
          }}>
            Welcome back
          </h2>

          <form onSubmit={handleSubmit}>
            <label style={{ display: 'block', marginBottom: 18 }}>
              <div style={{
                fontSize: 11,
                fontWeight: 700,
                color: C.textSecondary,
                letterSpacing: '0.07em',
                textTransform: 'uppercase',
                marginBottom: 6,
              }}>
                Email
              </div>
              <input
                type="email"
                placeholder="admin@forgemind.space"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoFocus
                style={{
                  width: '100%',
                  padding: '11px 14px',
                  borderRadius: 10,
                  border: `1.5px solid ${C.border}`,
                  fontSize: 14,
                  fontFamily: FONT,
                  outline: 'none',
                  background: C.cardBg,
                  color: C.text,
                  transition: 'border .15s',
                }}
                onFocus={e => (e.target.style.borderColor = C.purple)}
                onBlur={e => (e.target.style.borderColor = C.border)}
              />
            </label>

            <label style={{ display: 'block', marginBottom: 24 }}>
              <div style={{
                fontSize: 11,
                fontWeight: 700,
                color: C.textSecondary,
                letterSpacing: '0.07em',
                textTransform: 'uppercase',
                marginBottom: 6,
              }}>
                Password
              </div>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPw ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '11px 38px 11px 14px',
                    borderRadius: 10,
                    border: `1.5px solid ${C.border}`,
                    fontSize: 14,
                    fontFamily: FONT,
                    outline: 'none',
                    background: C.cardBg,
                    color: C.text,
                    transition: 'border .15s',
                  }}
                  onFocus={e => (e.target.style.borderColor = C.purple)}
                  onBlur={e => (e.target.style.borderColor = C.border)}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  style={{
                    position: 'absolute',
                    right: 12,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: C.textSecondary,
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>

            {error && (
              <div style={{
                background: C.primaryLight,
                color: '#A32D2D',
                borderRadius: 8,
                padding: '10px 14px',
                fontSize: 13,
                marginBottom: 16,
                fontWeight: 500,
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: 10,
                border: 'none',
                background: C.primary,
                color: '#fff',
                fontSize: 14,
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.7 : 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                fontFamily: FONT,
                transition: 'opacity .15s, background .15s',
              }}
              onMouseEnter={e => { if (!loading) e.currentTarget.style.background = C.primaryHover; }}
              onMouseLeave={e => { e.currentTarget.style.background = C.primary; }}
            >
              <LogIn size={16} />
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>

      {/* Responsive: hide brand panel on small screens */}
      <style>{`
        @media (max-width: 900px) {
          .login-brand-panel { display: none !important; }
        }
        @media (max-width: 900px) {
          .login-form-panel { max-width: 100% !important; padding: 24px !important; }
        }
      `}</style>
    </div>
  );
}
