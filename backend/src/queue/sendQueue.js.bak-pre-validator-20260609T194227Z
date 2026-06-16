// BullMQ outbound send queue. Rate-limited at 60 messages/sec by default
// (well under Meta Tier 1's 80/sec ceiling). All four send-origin paths
// (chat reply, broadcast, automation, template test) enqueue here.

const { Queue, Worker, QueueEvents } = require('bullmq');
const IORedis = require('ioredis');
const pool = require('../db');
const { getAccountWithToken } = require('../routes/whatsappAccounts');
const { sendText, sendTemplate, sendMedia, sendInteractive, sendLocation, sendContacts, sendReaction } = require('../integrations/metaSend');
const { markSent, markFailed } = require('../services/messageSender');
const { markAccountHealth, classifyMetaError } = require('../services/accountHealth');

const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
const QUEUE_NAME = 'forgecrm-send';
const CONCURRENCY = parseInt(process.env.SEND_QUEUE_CONCURRENCY || '5', 10);
const RATE_MAX = parseInt(process.env.SEND_RATE_MAX || '60', 10);
const RATE_DURATION_MS = parseInt(process.env.SEND_RATE_DURATION_MS || '1000', 10);
const ATTEMPTS = parseInt(process.env.SEND_QUEUE_ATTEMPTS || '4', 10);

const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});
connection.on('error', err => console.error('[sendQueue] redis error:', err.message));

const sendQueue = new Queue(QUEUE_NAME, { connection });

let worker = null;
let queueEvents = null;

/**
 * Job data shape:
 * {
 *   kind: 'text' | 'template' | 'media',
 *   accountId: number,        // resolved WhatsApp account id
 *   to: string,               // recipient phone (digits only)
 *   localMessageId: string,   // matches the optimistic chat_history row
 *   payload: {                // shape depends on kind
 *     // text:    { body, previewUrl? }
 *     // template:{ name, languageCode, components, broadcastLogId? }
 *     // media:   { type, mediaId | link, caption?, filename? }
 *   },
 *   originRef?: {             // optional cross-table linkage for status writes
 *     kind: 'broadcast_log' | 'automation_step',
 *     id: number,
 *   }
 * }
 */
async function processJob(job) {
  const { kind, accountId, to, localMessageId, payload, originRef } = job.data || {};
  const account = await getAccountWithToken(accountId);
  if (!account) throw new Error(`Account id=${accountId} not found`);
  if (!account.accessToken) throw new Error('Access token missing');
  if (!account.isActive) throw new Error(`Account "${account.displayName}" is inactive`);

  const args = {
    accessToken: account.accessToken,
    phoneNumberId: account.phoneNumberId,
    to,
  };

  let result;
  try {
    if (kind === 'text') {
      result = await sendText({ ...args, body: payload.body, previewUrl: payload.previewUrl, contextMessageId: payload.contextMessageId });
    } else if (kind === 'template') {
      result = await sendTemplate({ ...args, templateName: payload.name, languageCode: payload.languageCode, components: payload.components });
    } else if (kind === 'media') {
      result = await sendMedia({ ...args, type: payload.type, mediaId: payload.mediaId, link: payload.link, caption: payload.caption, filename: payload.filename, contextMessageId: payload.contextMessageId });
    } else if (kind === 'interactive') {
      result = await sendInteractive({ ...args, interactive: payload.interactive });
    } else if (kind === 'location') {
      result = await sendLocation({ ...args, latitude: payload.latitude, longitude: payload.longitude, name: payload.name, address: payload.address });
    } else if (kind === 'contacts') {
      result = await sendContacts({ ...args, contacts: payload.contacts });
    } else if (kind === 'reaction') {
      result = await sendReaction({ ...args, messageId: payload.messageId, emoji: payload.emoji });
    } else {
      throw new Error(`unknown send kind: ${kind}`);
    }
    await markAccountHealth(account.id, 'healthy');
  } catch (err) {
    const cls = classifyMetaError(err);
    await markAccountHealth(account.id, cls, err.message);
    // Don't retry auth failures — they'll fail every time until token is fixed
    if (cls === 'invalid_token') {
      err.skipRetry = true;
    }
    throw err;
  }

  const wamid = result?.messages?.[0]?.id;
  if (!wamid) throw new Error('Meta returned no message id');

  // Swap the optimistic row's local id for the real wamid
  if (localMessageId) await markSent(localMessageId, wamid);

  // Update origin-side linkage (broadcast_log etc) if provided
  if (originRef?.kind === 'broadcast_log' && originRef.id) {
    await pool.query(
      `UPDATE coexistence.broadcast_logs
          SET status = 'sent', wa_message_id = $1, sent_at = NOW()
        WHERE id = $2`,
      [wamid, originRef.id]
    ).catch(err => console.error('[sendQueue] broadcast_log update failed:', err.message));
  }
  if (originRef?.kind === 'automation_step' && originRef.id) {
    await pool.query(
      `UPDATE coexistence.automation_execution_steps
          SET wa_message_id = $1, wa_message_status = 'sent'
        WHERE id = $2`,
      [wamid, originRef.id]
    ).catch(() => {});
  }

  return { wamid };
}

function startSendWorker() {
  if (worker) return worker;
  worker = new Worker(QUEUE_NAME, processJob, {
    connection,
    concurrency: CONCURRENCY,
    limiter: { max: RATE_MAX, duration: RATE_DURATION_MS },
  });

  worker.on('completed', (job) => {
    console.log(`[sendQueue] ${job.data?.kind} to ${job.data?.to} → ${job.returnvalue?.wamid}`);
  });
  worker.on('failed', async (job, err) => {
    const localId = job?.data?.localMessageId;
    const skipRetry = err?.skipRetry || /invalid.*token|access token has expired|Error validating access token/i.test(err?.message || '');
    const finalAttempt = (job?.attemptsMade || 0) >= ATTEMPTS || skipRetry;
    console.error(`[sendQueue] ${job?.data?.kind} to ${job?.data?.to} failed attempt=${job?.attemptsMade}/${ATTEMPTS}${skipRetry ? ' (no-retry: auth)' : ''}: ${err.message}`);
    if (finalAttempt && localId) {
      await markFailed(localId, err.message).catch(() => {});
      if (job?.data?.originRef?.kind === 'broadcast_log') {
        await pool.query(
          `UPDATE coexistence.broadcast_logs SET status='failed', error_message=$1 WHERE id=$2`,
          [err.message.slice(0, 500), job.data.originRef.id]
        ).catch(() => {});
      }
    }
  });

  queueEvents = new QueueEvents(QUEUE_NAME, { connection });
  queueEvents.on('error', err => console.error('[sendQueue] events error:', err.message));

  console.log(`[sendQueue] worker started, concurrency=${CONCURRENCY}, rate=${RATE_MAX}/${RATE_DURATION_MS}ms, attempts=${ATTEMPTS}`);
  return worker;
}

async function enqueueSend(jobData, opts = {}) {
  const idKey = jobData.localMessageId || `${jobData.accountId}-${jobData.to}-${Date.now()}`;
  const addOpts = {
    jobId: `send-${idKey}`,
    attempts: ATTEMPTS,
    backoff: { type: 'exponential', delay: 1500 },
    removeOnComplete: { count: 500, age: 3600 },
    removeOnFail: { count: 1000, age: 86400 },
  };
  // Optional delayed delivery (used by automation Delay nodes so a later message
  // lands after an earlier one). BullMQ holds the job for `delayMs` before a
  // worker picks it up — non-blocking, no scheduler needed.
  if (opts.delayMs && opts.delayMs > 0) addOpts.delay = Math.round(opts.delayMs);
  await sendQueue.add('send', jobData, addOpts);
}

async function shutdownSendQueue() {
  try {
    if (worker) await worker.close();
    if (queueEvents) await queueEvents.close();
    await sendQueue.close();
    await connection.quit();
  } catch (err) {
    console.error('[sendQueue] shutdown error:', err.message);
  }
}

module.exports = { sendQueue, startSendWorker, enqueueSend, shutdownSendQueue };
