const { Router } = require('express');
const pool = require('../db');
const { decrypt } = require('../util/crypto');
const { safeEqual, verifyMetaSignature } = require('../util/webhookSignature');
const { evaluateTriggers, resumeAutomation } = require('../engine/automationEngine');
const agentRouter = require('../services/agentRouter');
const { markPending, MEDIA_TYPES } = require('../services/mediaDownloader');
const { enqueueMediaDownload } = require('../queue/mediaQueue');
const bus = require('../events');

const router = Router();

// Monotonic ordering of a message's delivery lifecycle. Meta delivers status
// receipts at-least-once and can reorder them (a retried 'delivered' may land
// after 'read'), so status must only ever ADVANCE — never downgrade a blue
// double-tick back to grey. 'failed' ranks alongside 'delivered' so it can land
// on a sent/queued message but never overwrites a real delivered/read.
const STATUS_RANK = { sending: 0, sent: 1, delivered: 2, read: 3, played: 3, failed: 2 };

/**
 * Parse a Meta WhatsApp Cloud API webhook payload and extract message records.
 * Handles: text, image, video, audio, document, location, sticker, contacts,
 *          interactive (button_reply / list_reply), reaction, and status updates.
 */
// Normalize WhatsApp phone numbers to digits-only — strips '+', spaces, dashes.
// Meta sometimes includes leading '+' in display_phone_number, sometimes not;
// without this, the same conversation lands under two different wa_numbers and
// shows as duplicate chat threads.
function normalizePhone(s) {
  if (!s) return s;
  return String(s).replace(/\D/g, '');
}

function parseMetaPayload(body) {
  const records = [];

  if (!body || body.object !== 'whatsapp_business_account') {
    return records;
  }

  const entries = body.entry || [];
  for (const entry of entries) {
    const changes = entry.changes || [];
    for (const change of changes) {
      const value = change.value || {};
      if (value.messaging_product !== 'whatsapp') continue;

      const metadata = value.metadata || {};
      const phoneNumberId = metadata.phone_number_id || '';
      const displayPhoneNumber = metadata.display_phone_number || '';

      // Contact profile info (name mapping)
      const contactProfiles = {};
      (value.contacts || []).forEach(c => {
        const waId = c.wa_id || '';
        const name = c.profile?.name || '';
        if (waId && name) contactProfiles[waId] = name;
      });

      // Parse a single message (shared logic for incoming and outgoing)
      function parseMessage(msg, direction, waNum, contactNum) {
        const record = {
          message_id: msg.id || '',
          phone_number_id: phoneNumberId,
          wa_number: normalizePhone(waNum || displayPhoneNumber),
          contact_number: normalizePhone(contactNum || ''),
          to_number: normalizePhone(msg.to || ''),
          direction,
          message_type: msg.type || 'unknown',
          message_body: null,
          raw_payload: JSON.stringify(body),
          media_url: null,
          media_mime_type: null,
          status: direction === 'incoming' ? 'received' : 'sent',
          timestamp: msg.timestamp
            ? new Date(parseInt(msg.timestamp, 10) * 1000).toISOString()
            : new Date().toISOString(),
          contact_name: contactProfiles[contactNum] || null,
          // Quote-reply: when the customer replies to a specific message, Meta
          // sends the quoted message's wamid here. Stored so we can render the
          // quoted bubble above their reply.
          context_message_id: msg.context?.id || null,
        };

        const type = msg.type;
        if (type === 'text' && msg.text) {
          record.message_body = msg.text.body || '';
        } else if (type === 'image' && msg.image) {
          record.message_body = msg.image.caption || '';
          record.media_mime_type = msg.image.mime_type || null;
          record.media_url = msg.image.id || null;
        } else if (type === 'video' && msg.video) {
          record.message_body = msg.video.caption || '';
          record.media_mime_type = msg.video.mime_type || null;
          record.media_url = msg.video.id || null;
        } else if (type === 'audio' && msg.audio) {
          record.message_body = 'Audio message';
          record.media_mime_type = msg.audio.mime_type || null;
          record.media_url = msg.audio.id || null;
        } else if (type === 'voice' && msg.voice) {
          record.message_body = 'Voice message';
          record.media_mime_type = msg.voice.mime_type || null;
          record.media_url = msg.voice.id || null;
        } else if (type === 'document' && msg.document) {
          record.message_body = msg.document.filename || '';
          record.media_mime_type = msg.document.mime_type || null;
          record.media_url = msg.document.id || null;
          record.media_filename = msg.document.filename || null;
        } else if (type === 'location' && msg.location) {
          const lat = msg.location.latitude || '';
          const lng = msg.location.longitude || '';
          record.message_body = `Location: ${lat}, ${lng}`;
        } else if (type === 'sticker' && msg.sticker) {
          record.message_body = 'Sticker';
          record.media_mime_type = msg.sticker.mime_type || null;
          record.media_url = msg.sticker.id || null;
        } else if (type === 'contacts' && msg.contacts) {
          const names = msg.contacts.map(c => c.name?.formatted_name || c.name?.first_name || 'Contact').join(', ');
          record.message_body = `Shared contact(s): ${names}`;
        } else if (type === 'interactive' && msg.interactive) {
          const reply = msg.interactive.button_reply || msg.interactive.list_reply || {};
          record.message_body = reply.title || 'Interactive response';
          record.message_type = 'interactive';
        } else if (type === 'reaction' && msg.reaction) {
          record.message_body = `Reaction: ${msg.reaction.emoji || ''}`;
          record.message_type = 'reaction';
          // Capture the target message + emoji so the insert loop can attach it
          // to that message instead of creating a standalone bubble. Empty emoji
          // = the customer removed their reaction.
          record.reaction = {
            targetMessageId: msg.reaction.message_id || null,
            emoji: msg.reaction.emoji || '',
            from: msg.from || null,
          };
        } else if (type === 'order' && msg.order) {
          record.message_body = 'Order received';
        } else if (type === 'system' && msg.system) {
          record.message_body = msg.system.body || 'System message';
        } else if (type === 'unknown' && msg.errors) {
          record.message_body = `Error: ${msg.errors[0]?.message || 'Unknown error'}`;
          record.status = 'error';
        }

        return record;
      }

      // Incoming messages
      const messages = value.messages || [];
      for (const msg of messages) {
        records.push(parseMessage(msg, 'incoming', displayPhoneNumber, msg.from));
      }

      // Outgoing message echoes (messages sent from the WhatsApp Business app)
      const messageEchoes = value.message_echoes || [];
      for (const msg of messageEchoes) {
        // For echoes: from = business number, to = customer
        records.push(parseMessage(msg, 'outgoing', displayPhoneNumber, msg.to));
      }

      // Status updates (delivered, read, sent)
      const statuses = value.statuses || [];
      for (const status of statuses) {
        records.push({
          message_id: status.id || '',
          phone_number_id: phoneNumberId,
          wa_number: normalizePhone(displayPhoneNumber),
          contact_number: normalizePhone(status.recipient_id || ''),
          to_number: normalizePhone(status.recipient_id || ''),
          direction: 'outgoing',
          message_type: 'status',
          message_body: `Status: ${status.status || ''}`,
          raw_payload: JSON.stringify(body),
          media_url: null,
          media_mime_type: null,
          status: status.status || 'unknown',
          timestamp: status.timestamp
            ? new Date(parseInt(status.timestamp, 10) * 1000).toISOString()
            : new Date().toISOString(),
          contact_name: contactProfiles[status.recipient_id] || null,
          // Include full status payload for trigger evaluation
          conversation: status.conversation || null,
          pricing: status.pricing || null,
          errors: status.errors || null,
        });
      }
    }
  }

  return records;
}

/* ------------------------------------------------------------------ *
 * Webhook audit trail. Every raw payload is stored in webhook_events so the
 * status reconciler (services/statusReconciler.js) can re-derive a message's
 * true delivery/read status from the stored receipts — self-healing any tick
 * that was missed live (e.g. a receipt that landed before markSent() swapped
 * the local id for Meta's wamid). `payload_kind='statuses'` is what the
 * reconciler filters on.
 * ------------------------------------------------------------------ */
function pickPhoneNumberId(body) {
  return body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id || null;
}

function inferPayloadKind(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'unknown';
  if (body.object !== 'whatsapp_business_account') return 'unknown';
  const change = body.entry?.[0]?.changes?.[0];
  if (!change) return 'unknown';
  const field = change.field;
  if (field === 'message_template_status_update') return 'template_status_update';
  if (field === 'account_update') return 'account_update';
  const value = change.value || {};
  if (Array.isArray(value.message_echoes) && value.message_echoes.length > 0) return 'message_echoes';
  if (Array.isArray(value.messages) && value.messages.length > 0) return 'messages';
  if (Array.isArray(value.statuses) && value.statuses.length > 0) return 'statuses';
  return field || 'unknown';
}

function inferPayloadSubtype(body) {
  const value = body?.entry?.[0]?.changes?.[0]?.value;
  if (!value) return null;
  if (Array.isArray(value.messages) && value.messages.length > 0) return value.messages[0].type || null;
  if (Array.isArray(value.statuses) && value.statuses.length > 0) return value.statuses[0].status || null;
  if (Array.isArray(value.message_echoes) && value.message_echoes.length > 0) return value.message_echoes[0].type || null;
  return null;
}

async function logWebhookReceived({ payload, headers, remoteIp, source }) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO coexistence.webhook_events
         (source, remote_ip, request_headers, payload, payload_kind, payload_subtype, meta_object, phone_number_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id`,
      [
        source || 'meta', remoteIp || null, JSON.stringify(headers || {}),
        JSON.stringify(payload), inferPayloadKind(payload), inferPayloadSubtype(payload),
        payload?.object || null, pickPhoneNumberId(payload),
      ]
    );
    return rows[0].id;
  } catch (err) {
    console.error('[webhook-audit] insert failed:', err.message);
    return null;
  }
}

async function logWebhookProcessed(id, { status, recordsExtracted, error, processingMs }) {
  if (!id) return;
  try {
    await pool.query(
      `UPDATE coexistence.webhook_events
          SET processing_status = $1, records_extracted = $2, processing_error = $3, processing_ms = $4
        WHERE id = $5`,
      [status, recordsExtracted || 0, error ? String(error).slice(0, 500) : null, processingMs || null, id]
    );
  } catch (err) {
    console.error('[webhook-audit] update failed:', err.message);
  }
}

/**
 * POST /api/webhook/whatsapp
 * Receives raw Meta WhatsApp webhook payloads. Meta posts here directly.
 * No auth required — this is Meta's public callback URL.
 */
router.post('/webhook/whatsapp', async (req, res) => {
  const startTime = Date.now();
  const remoteIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || null;
  const source = 'meta';
  let auditId = null;
  try {
    // Authenticity: this endpoint is necessarily unauthenticated (public), so
    // the control is Meta's HMAC signature. When META_APP_SECRET is configured
    // we REJECT anything unsigned/invalid; if it's not set we log a warning so
    // operators know inbound webhooks are unverified (forgeable).
    const sig = verifyMetaSignature(req);
    if (sig === false) {
      return res.status(403).json({ error: 'Invalid webhook signature' });
    }
    if (sig === null) {
      console.warn('[webhook] META_APP_SECRET not set — inbound webhook signature NOT verified (set it to reject forged payloads).');
    }

    auditId = await logWebhookReceived({ payload: req.body, headers: req.headers, remoteIp, source });

    const payload = req.body;
    if (!payload) {
      await logWebhookProcessed(auditId, { status: 'error', error: 'Empty payload', processingMs: Date.now() - startTime });
      return res.status(400).json({ error: 'Empty payload' });
    }

    // Support both a single payload and an array of payloads (batched)
    const payloads = Array.isArray(payload) ? payload : [payload];
    const allRecords = [];
    for (const p of payloads) {
      const records = parseMetaPayload(p);
      allRecords.push(...records);
    }

    if (allRecords.length === 0) {
      // Acknowledge non-message webhooks (e.g. verification, errors)
      await logWebhookProcessed(auditId, { status: 'processed', recordsExtracted: 0, processingMs: Date.now() - startTime });
      return res.status(200).json({ ok: true, stored: 0 });
    }

    const client = await pool.connect();
    // Status receipts whose UPDATE actually advanced a row — pushed to SSE
    // subscribers after COMMIT so open chats flip the tick instantly.
    const statusUpdates = [];
    try {
      await client.query('BEGIN');

      for (const r of allRecords) {
        // Status receipts (sent/delivered/read/failed) update the ORIGINAL
        // message's status — they must never create a chat row. Inserting them
        // produced phantom "Status: delivered" bubbles. If no matching message
        // exists (e.g. an app-sent message we don't track), this is a no-op.
        if (r.message_type === 'status') {
          // On a 'failed' receipt, capture Meta's reason (code + title) so the
          // UI can explain WHY instead of a bare red icon.
          let failedError = null;
          if (r.status === 'failed' && Array.isArray(r.errors) && r.errors.length > 0) {
            const e = r.errors[0] || {};
            const detail = e.error_data?.details || e.title || e.message || 'Message failed to send';
            failedError = (e.code != null ? `[${e.code}] ` : '') + detail;
          }
          const newRank = STATUS_RANK[r.status] ?? 0;
          // Only ADVANCE the status — never let a reordered/duplicate receipt
          // downgrade a higher state (the read→grey-tick bug).
          const upd = await client.query(
            `UPDATE coexistence.chat_history
                SET status = $1,
                    error_message = CASE WHEN $1 = 'failed' AND $4::text IS NOT NULL
                                         THEN $4 ELSE error_message END
              WHERE message_id = $2
                AND $3 > (CASE status
                            WHEN 'sending' THEN 0 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2
                            WHEN 'read' THEN 3 WHEN 'played' THEN 3 WHEN 'failed' THEN 2 ELSE 0 END)
              RETURNING wa_number, contact_number, message_id`,
            [r.status, r.message_id, newRank, failedError]
          );
          if (upd.rowCount > 0) {
            const row = upd.rows[0];
            statusUpdates.push({ waNumber: row.wa_number, contactNumber: row.contact_number, messageId: row.message_id, status: r.status });
          }
          continue;
        }

        // Reactions are NOT chat bubbles — attach the emoji to the message it
        // reacts to (message_reactions). An empty emoji removes the reaction.
        if (r.message_type === 'reaction') {
          const tgt = r.reaction?.targetMessageId;
          if (tgt) {
            if (r.reaction.emoji) {
              await client.query(
                `INSERT INTO coexistence.message_reactions
                   (wa_number, contact_number, target_message_id, direction, emoji, reactor, updated_at)
                 VALUES ($1,$2,$3,$4,$5,$6,NOW())
                 ON CONFLICT (target_message_id, direction)
                 DO UPDATE SET emoji = EXCLUDED.emoji, reactor = EXCLUDED.reactor, updated_at = NOW()`,
                [r.wa_number, r.contact_number, tgt, r.direction, r.reaction.emoji, r.reaction.from || null]
              );
            } else {
              await client.query(
                `DELETE FROM coexistence.message_reactions WHERE target_message_id = $1 AND direction = $2`,
                [tgt, r.direction]
              );
            }
          }
          continue;
        }

        // Upsert chat_history (ignore duplicates on message_id)
        await client.query(
          `INSERT INTO coexistence.chat_history
            (message_id, phone_number_id, wa_number, contact_number, to_number,
             direction, message_type, message_body, raw_payload, media_url,
             media_mime_type, media_filename, status, timestamp, context_message_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           ON CONFLICT (message_id) DO UPDATE SET
             status = EXCLUDED.status,
             raw_payload = EXCLUDED.raw_payload`,
          [
            r.message_id, r.phone_number_id, r.wa_number, r.contact_number, r.to_number,
            r.direction, r.message_type, r.message_body, r.raw_payload, r.media_url,
            r.media_mime_type, r.media_filename || null, r.status, r.timestamp,
            r.context_message_id || null,
          ]
        );

        // Upsert the WhatsApp profile/push name into profile_name (NOT name).
        // `name` is reserved for a name we explicitly captured (AI ask-name flow
        // or manual save) so inbound messages don't clobber it — that clobbering
        // is what made the automation "is the contact known?" condition always
        // true. Display falls back to COALESCE(name, profile_name).
        if (r.contact_number && r.wa_number && r.contact_name) {
          await client.query(
            `INSERT INTO coexistence.contacts (wa_number, contact_number, profile_name)
             VALUES ($1, $2, $3)
             ON CONFLICT (wa_number, contact_number) DO UPDATE SET
               profile_name = EXCLUDED.profile_name,
               updated_at = NOW()`,
            [r.wa_number, r.contact_number, r.contact_name]
          );
        }
      }

      // Self-heal the connected account's business number. If the Meta lookup at
      // connect time failed (e.g. an invalid/expired access token), the account's
      // display_phone_number was saved blank — which hides every chat for this
      // number from the Chats list even though the messages are stored. The
      // inbound webhook carries the real number (metadata.display_phone_number),
      // so backfill it here, keyed on the stable phone_number_id. Only fills when
      // blank, so a correct value is never overwritten.
      const backfilled = new Set();
      for (const r of allRecords) {
        if (!r.phone_number_id || !r.wa_number || backfilled.has(r.phone_number_id)) continue;
        backfilled.add(r.phone_number_id);
        await client.query(
          `UPDATE coexistence.whatsapp_accounts
              SET display_phone_number = $1, updated_at = NOW()
            WHERE phone_number_id = $2
              AND COALESCE(display_phone_number, '') = ''`,
          [r.wa_number, r.phone_number_id]
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Push live tick updates to any open chat (after COMMIT so subscribers only
    // ever see committed state). Best-effort — a missed push self-heals on the
    // next 15s poll.
    for (const u of statusUpdates) bus.emit('message-status', u);

    // Evaluate automation triggers
    // 1. For incoming messages (keyword, anyMessage, newContact triggers)
    //    First: if this conversation has paused executions awaiting a reply,
    //    resume them and SKIP fresh trigger evaluation for that record
    //    (the customer is mid-conversation — see plan: "Resume only — skip
    //    new trigger").
    const incomingRecords = allRecords.filter(r => r.direction === 'incoming' && r.message_type !== 'status' && r.message_type !== 'reaction');
    if (incomingRecords.length > 0) {
      for (const record of incomingRecords) {
        try {
          const { rows: pausedRows } = await pool.query(
            `SELECT id FROM coexistence.automation_executions
              WHERE wa_number=$1 AND contact_number=$2
                AND status='paused' AND expires_at>NOW()
              ORDER BY paused_at`,
            [record.wa_number, record.contact_number]
          );
          if (pausedRows.length > 0) {
            for (const p of pausedRows) {
              try {
                await resumeAutomation(pool, p.id, record);
              } catch (resumeErr) {
                console.error(`[webhook] Resume error for execution ${p.id}:`, resumeErr.message);
              }
            }
            continue; // do not also fire fresh triggers
          }
          const fired = await evaluateTriggers(record);
          // Agent fall-through: if no keyword automation matched, hand the
          // message to the agent bound to this WhatsApp account (if any active
          // agent exists). evaluateTriggers returns the array of executions
          // it created; an empty array means nothing fired.
          if (!fired || fired.length === 0) {
            try {
              await agentRouter.routeIfActive(record);
            } catch (agentErr) {
              console.error('[webhook] Agent routing error:', agentErr.message);
            }
          }
        } catch (triggerErr) {
          console.error('[webhook] Trigger evaluation error:', triggerErr.message);
        }
      }
    }

    // 2. For status updates (messageRead, messageDelivered, messageSent triggers)
    const statusRecords = allRecords.filter(r => r.message_type === 'status');
    if (statusRecords.length > 0) {
      for (const record of statusRecords) {
        try {
          await evaluateTriggers(record);
        } catch (triggerErr) {
          console.error('[webhook] Status trigger evaluation error:', triggerErr.message);
        }
      }
    }

    // Enqueue durable media downloads via BullMQ (concurrency-capped + retried)
    for (const r of allRecords) {
      if (MEDIA_TYPES.has(r.message_type) && r.media_url && r.message_id) {
        await markPending(r.message_id);
        enqueueMediaDownload(r.message_id).catch(() => {});
      }
    }

    console.log(`[webhook] Stored ${allRecords.length} record(s)`);
    await logWebhookProcessed(auditId, { status: 'processed', recordsExtracted: allRecords.length, processingMs: Date.now() - startTime });
    res.status(200).json({ ok: true, stored: allRecords.length });
  } catch (err) {
    console.error('[webhook] Error:', err.message);
    await logWebhookProcessed(auditId, { status: 'error', error: err.message, processingMs: Date.now() - startTime });
    // Always return 200 so Meta doesn't retry infinitely. Use a static
    // message — err.message can carry internal Postgres/schema details.
    res.status(200).json({ ok: false, error: 'Processing error' });
  }
});

/**
 * GET /api/webhook/whatsapp
 * Meta webhook verification endpoint (hub.challenge handshake).
 */
router.get('/webhook/whatsapp', async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  let accepted = false;
  if (mode === 'subscribe' && token) {
    // 1) The per-account Webhook Verify Token set in the connection form.
    try {
      const { rows } = await pool.query(
        `SELECT verify_token_encrypted FROM coexistence.whatsapp_accounts
          WHERE verify_token_encrypted IS NOT NULL`
      );
      for (const r of rows) {
        if (safeEqual(decrypt(r.verify_token_encrypted), token)) { accepted = true; break; }
      }
    } catch (err) {
      console.error('[webhook] verify-token lookup error:', err.message);
    }
    // 2) Backward-compatible env fallback.
    if (!accepted && process.env.META_WEBHOOK_VERIFY_TOKEN && safeEqual(process.env.META_WEBHOOK_VERIFY_TOKEN, token)) {
      accepted = true;
    }
  }

  if (accepted) {
    console.log('[webhook] Meta verification accepted');
    // Echo the challenge as plain text (Meta sends a numeric token). Sending it
    // as text/plain — not the res.send default of text/html — prevents the
    // reflected value from being interpreted as HTML (reflected-XSS).
    return res.status(200).type('text/plain').send(String(challenge ?? ''));
  }
  res.status(403).json({ error: 'Verification failed' });
});

module.exports = { router };
