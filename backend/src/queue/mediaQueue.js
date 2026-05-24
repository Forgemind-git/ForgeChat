// BullMQ-backed media download queue using the shared Redis (same instance as
// n8n, isolated by queue name / prefix). Replaces the previous in-process
// setImmediate scheduler — gives us durability across restarts, capped
// concurrency, and exponential backoff for transient Meta errors.

const { Queue, Worker, QueueEvents } = require('bullmq');
const IORedis = require('ioredis');
const { downloadOne } = require('../services/mediaDownloader');

const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
const QUEUE_NAME = 'forgecrm-media';
const CONCURRENCY = parseInt(process.env.MEDIA_QUEUE_CONCURRENCY || '2', 10);
const ATTEMPTS = parseInt(process.env.MEDIA_QUEUE_ATTEMPTS || '5', 10);
const BACKOFF_MS = parseInt(process.env.MEDIA_QUEUE_BACKOFF_MS || '2000', 10);

// BullMQ requires these specific Redis client settings
const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

connection.on('error', err => console.error('[mediaQueue] redis error:', err.message));

const mediaQueue = new Queue(QUEUE_NAME, { connection });

let worker = null;
let queueEvents = null;

function startWorker() {
  if (worker) return worker;
  worker = new Worker(QUEUE_NAME, async (job) => {
    const { messageId } = job.data || {};
    if (!messageId) throw new Error('missing messageId');
    const result = await downloadOne(messageId);
    if (!result.ok) {
      // Throw to trigger BullMQ retry/backoff. Permanent failures (expired,
      // 401, 403) are detected inside downloadOne and persisted as terminal
      // states — those still throw here, but the row is already correct.
      throw new Error(result.error || 'download failed');
    }
    return result;
  }, {
    connection,
    concurrency: CONCURRENCY,
  });

  worker.on('failed', (job, err) => {
    console.error(`[mediaQueue] ${job?.data?.messageId} failed attempt=${job?.attemptsMade}/${ATTEMPTS}: ${err.message}`);
  });
  worker.on('completed', (job) => {
    console.log(`[mediaQueue] ${job.data.messageId} stored`);
  });

  queueEvents = new QueueEvents(QUEUE_NAME, { connection });
  queueEvents.on('error', err => console.error('[mediaQueue] events error:', err.message));

  console.log(`[mediaQueue] worker started, concurrency=${CONCURRENCY}, attempts=${ATTEMPTS}`);
  return worker;
}

/**
 * Enqueue a media download. Idempotent: jobId is keyed on messageId so duplicate
 * enqueues (e.g. webhook retries) collapse to a single job.
 */
async function enqueueMediaDownload(messageId) {
  if (!messageId) return;
  try {
    await mediaQueue.add('download', { messageId }, {
      jobId: `media-${messageId}`,
      attempts: ATTEMPTS,
      backoff: { type: 'exponential', delay: BACKOFF_MS },
      removeOnComplete: { count: 200, age: 3600 },
      removeOnFail:     { count: 500, age: 86400 },
    });
  } catch (err) {
    // If Redis is briefly unavailable, fall back to direct execution so we
    // don't drop the download entirely. Logs the fallback.
    console.error('[mediaQueue] enqueue failed, running inline:', err.message);
    downloadOne(messageId).catch(e => console.error('[mediaQueue] inline fallback error:', e.message));
  }
}

async function shutdown() {
  try {
    if (worker) await worker.close();
    if (queueEvents) await queueEvents.close();
    await mediaQueue.close();
    await connection.quit();
  } catch (err) {
    console.error('[mediaQueue] shutdown error:', err.message);
  }
}

module.exports = { mediaQueue, startWorker, enqueueMediaDownload, shutdown };
