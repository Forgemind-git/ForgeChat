// Process-local event bus used to push real-time updates to subscribed SSE
// clients (see routes/events.js). Single-process by design — if we ever scale
// to multiple backend instances, swap this for Redis pub/sub but keep the same
// emit() / on() / off() surface so callers don't change.

const { EventEmitter } = require('events');

const bus = new EventEmitter();
// Many SSE connections may listen to the same event simultaneously. Node's
// default cap is 10 listeners per event — raise it before adding so we don't
// pollute the logs with MaxListenersExceededWarning.
bus.setMaxListeners(200);

module.exports = bus;
