// Subscribe to the backend SSE stream (/api/events). Call once at the chat
// view's mount level and pass a stable `onEvent` callback. The auth cookie
// rides along automatically; the browser closes the connection on tab unload
// and auto-reconnects (EventSource's built-in ~3s retry) on transient drops.
//
//   const onEvent = useCallback((ev) => {
//     if (ev.type === 'message-status') applyTick(ev.data);
//   }, [...]);
//   useServerEvents(onEvent);

import { useEffect } from 'react';

const SUBSCRIBED_EVENTS = ['message-status', 'hello'];

export function useServerEvents(onEvent) {
  useEffect(() => {
    if (!onEvent) return;
    let es;
    try {
      es = new EventSource('/api/events', { withCredentials: true });
    } catch (err) {
      console.warn('[useServerEvents] EventSource unsupported:', err.message);
      return undefined;
    }

    const handlers = {};
    for (const type of SUBSCRIBED_EVENTS) {
      handlers[type] = (e) => {
        let data = {};
        try { data = JSON.parse(e.data); } catch { /* leave empty */ }
        onEvent({ type, data });
      };
      es.addEventListener(type, handlers[type]);
    }

    return () => {
      for (const type of SUBSCRIBED_EVENTS) {
        try { es.removeEventListener(type, handlers[type]); } catch { /* ignore */ }
      }
      try { es.close(); } catch { /* ignore */ }
    };
  }, [onEvent]);
}
