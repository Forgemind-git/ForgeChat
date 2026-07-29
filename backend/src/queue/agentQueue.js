// Agent inference queue. The webhook handler enqueues; this worker runs the
// agent's LLM tool-use loop off the request path so Meta doesn't time out (20s
// webhook ceiling). Per-contact serial processing prevents two simultaneous
// agent runs from sending out-of-order replies to the same chat.

const { Queue, Worker, QueueEvents } = require('bullmq');
const IORedis = require('ioredis');
const { runAgent } = require('../engine/agentEngine');

const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
const QUEUE_NAME = 'forgechat-agent';
const CONCURRENCY = parseInt(process.env.AGENT_QUEUE_CONCURRENCY || '4', 10);
const ATTEMPTS = parseInt(process.env.AGENT_QUEUE_ATTEMPTS || '2', 10);

const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});
connection.on('error', err => console.error('[agentQueue] redis error:', err.message));

const agentQueue = new Queue(QUEUE_NAME, { connection });

let worker = null;
let queueEvents = null;

async function processJob(job) {
  const { agentId, contactNumber, inboundMessageId, inboundText } = job.data || {};
  return await runAgent({ agentId, contactNumber, inboundMessageId, inboundText });
}

function startAgentWorker() {
  if (worker) return worker;
  worker = new Worker(QUEUE_NAME, processJob, {
    connection,
    concurrency: CONCURRENCY,
  });

  worker.on('completed', (job, result) => {
    const r = result || {};
    console.log(`[agentQueue] agent=${job.data?.agentId} contact=${job.data?.contactNumber} status=${r.status} run=${r.runId}`);
  });
  worker.on('failed', (job, err) => {
    console.error(`[agentQueue] agent=${job?.data?.agentId} contact=${job?.data?.contactNumber} failed (attempt ${job?.attemptsMade}/${ATTEMPTS}): ${err?.message}`);
  });

  queueEvents = new QueueEvents(QUEUE_NAME, { connection });
  queueEvents.on('error', err => console.error('[agentQueue] events error:', err.message));

  console.log(`[agentQueue] worker started, concurrency=${CONCURRENCY}, attempts=${ATTEMPTS}`);
  return worker;
}

/**
 * Enqueue an agent run. The jobId pins it to (agent, contact) so a flood of
 * messages from the same number doesn't fan out into parallel runs that step
 * over each other.
 */
async function enqueueAgentRun({ agentId, contactNumber, inboundMessageId, inboundText }) {
  await agentQueue.add(
    'run',
    { agentId, contactNumber, inboundMessageId, inboundText },
    {
      jobId: `agent-${agentId}-${contactNumber}-${inboundMessageId || Date.now()}`,
      attempts: ATTEMPTS,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 200, age: 3600 },
      removeOnFail: { count: 500, age: 86400 },
    },
  );
}

async function shutdownAgentQueue() {
  try {
    if (worker) await worker.close();
    if (queueEvents) await queueEvents.close();
    await agentQueue.close();
    await connection.quit();
  } catch (err) {
    console.error('[agentQueue] shutdown error:', err.message);
  }
}

module.exports = { agentQueue, startAgentWorker, enqueueAgentRun, shutdownAgentQueue };
