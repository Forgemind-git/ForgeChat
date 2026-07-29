// Server-Sent Events stream for real-time push to the chat UI. The frontend
// opens one connection per tab via `new EventSource('/api/events')`; the auth
// cookie rides along and `authMiddleware` upstream verifies the JWT before we
// get here. nginx already disables proxy buffering for this exact location
// (frontend/nginx.conf) so events flush immediately.
//
// Events emitted:
//   - 'message-status': { waNumber, contactNumber, messageId, status }
//       Pushed when a Meta delivery/read receipt advances an outbound message's
//       status, so the chat tick turns blue without waiting for the poll.

const { Router } = require('express');
const bus = require('../events');

const router = Router();

// Every event the stream forwards. Kept as a list so adding a new push event is
// a one-liner here + a bus.emit() at the source.
const FORWARDED_EVENTS = ['message-status'];

router.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  // Initial handshake — also nudges proxies that wait for the first byte.
  res.write(`event: hello\ndata: {"ts":${Date.now()},"userId":${req.user?.id ?? null}}\n\n`);

  const writeEvent = (event, data) => {
    if (res.writableEnded) return;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      // Connection may have died mid-write; the close handler cleans up.
    }
  };

  const handlers = {};
  for (const event of FORWARDED_EVENTS) {
    handlers[event] = (payload) => writeEvent(event, payload);
    bus.on(event, handlers[event]);
  }

  // Keepalive every 25s — most proxies idle-close at 30-60s.
  const keepalive = setInterval(() => {
    if (res.writableEnded) return;
    try { res.write(': ka\n\n'); } catch { /* connection died */ }
  }, 25000);

  const cleanup = () => {
    clearInterval(keepalive);
    for (const event of FORWARDED_EVENTS) bus.off(event, handlers[event]);
  };
  req.on('close', cleanup);
  req.on('error', cleanup);
});

module.exports = { router };
