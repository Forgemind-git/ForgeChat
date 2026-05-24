import { useState, useEffect, useCallback } from 'react';

function parseHash() {
  const raw = (window.location.hash || '').replace(/^#\/?/, '');
  if (!raw) return [];
  return raw.split('/').map(seg => {
    try { return decodeURIComponent(seg); } catch { return seg; }
  });
}

function buildHash(parts) {
  return '#/' + parts
    .filter(p => p != null && p !== '')
    .map(p => encodeURIComponent(String(p)))
    .join('/');
}

export function useHashRoute() {
  const [parts, setParts] = useState(parseHash);

  useEffect(() => {
    const onChange = () => setParts(parseHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = useCallback((...newParts) => {
    const next = buildHash(newParts);
    if (next !== window.location.hash) {
      window.location.hash = next;
    } else {
      setParts(parseHash());
    }
  }, []);

  const replace = useCallback((...newParts) => {
    const next = buildHash(newParts);
    const url = window.location.pathname + window.location.search + next;
    window.history.replaceState(null, '', url);
    setParts(parseHash());
  }, []);

  return [parts, navigate, replace];
}
