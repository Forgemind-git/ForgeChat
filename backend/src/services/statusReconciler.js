// Self-healing delivery/read tick reconciliation.
//
// The live path (webhook.js) updates a message's status the instant a receipt
// arrives. But a receipt can still be "lost" in one narrow race: Meta's
// sent/delivered/read webhook can land in the split-second *before* markSent()
// swaps the local placeholder id for Meta's real wamid — so the UPDATE keyed on
// the wamid matches no row. The receipt is still safely stored in webhook_events.
//
// This re-derives each outbound message's true status from the stored receipts
// and upgrades any chat_history row that's behind (MONOTONIC — never downgrades),
// then emits `message-status` so any open chat advances the tick live. Bounded
// to a recent window so the periodic run stays cheap.
const pool = require('../db');
const bus = require('../events');

async function reconcileMessageStatuses({ windowDays = 2 } = {}) {
  const { rows } = await pool.query(`
    WITH receipts AS (
      SELECT s->>'id' AS message_id,
             bool_or(s->>'status' IN ('read','played')) AS has_read,
             bool_or(s->>'status' = 'delivered')        AS has_delivered,
             bool_or(s->>'status' = 'failed')           AS has_failed,
             bool_or(s->>'status' = 'sent')             AS has_sent
      FROM coexistence.webhook_events we,
           jsonb_array_elements(we.payload->'entry') e,
           jsonb_array_elements(e->'changes') ch,
           jsonb_array_elements(ch->'value'->'statuses') s
      WHERE we.payload_kind = 'statuses'
        AND we.received_at > NOW() - ($1 || ' days')::interval
      GROUP BY s->>'id'
    ),
    best AS (
      SELECT message_id,
             CASE WHEN has_read THEN 'read' WHEN has_delivered THEN 'delivered'
                  WHEN has_failed THEN 'failed' WHEN has_sent THEN 'sent' END AS best_status
      FROM receipts
    )
    UPDATE coexistence.chat_history ch
       SET status = b.best_status
      FROM best b
     WHERE ch.message_id = b.message_id
       AND ch.direction = 'outgoing'
       AND b.best_status IS NOT NULL
       AND ch.timestamp > NOW() - ($1 || ' days')::interval
       AND (CASE b.best_status WHEN 'read' THEN 3 WHEN 'delivered' THEN 2 WHEN 'failed' THEN 2 WHEN 'sent' THEN 1 ELSE 0 END)
         > (CASE ch.status      WHEN 'sending' THEN 0 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 WHEN 'played' THEN 3 WHEN 'failed' THEN 2 ELSE 0 END)
    RETURNING ch.wa_number, ch.contact_number, ch.message_id, ch.status
  `, [String(windowDays)]);

  for (const r of rows) {
    bus.emit('message-status', {
      waNumber: r.wa_number,
      contactNumber: r.contact_number,
      messageId: r.message_id,
      status: r.status,
    });
  }
  return rows.length;
}

module.exports = { reconcileMessageStatuses };
