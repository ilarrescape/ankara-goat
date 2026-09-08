const { Queue, Worker } = require('bullmq');
const { redisEnabled, createRedisConnection } = require('../config/redis');

const fallbackTimers = new Map();
let queue = null;
let worker = null;
let handler = null;

function timerKey(gameId, questionId) {
  return `question-timeout-${gameId}-${questionId}`;
}

function ensureQueue() {
  if (!redisEnabled()) return null;
  if (!queue) queue = new Queue('ankara-question-timeouts', { connection: createRedisConnection() });
  return queue;
}

function startQuestionTimeoutWorker(fn) {
  handler = fn;
  if (!redisEnabled() || worker) return worker;
  worker = new Worker('ankara-question-timeouts', async job => {
    if (job.name !== 'question-timeout' || !handler) return;
    await handler(job.data);
  }, { connection: createRedisConnection({ blocking: true }) });
  worker.on('error', err => console.error('[bullmq worker]', err.message));
  return worker;
}

async function scheduleQuestionTimeout({ gameId, userId, questionId, deadline }) {
  const delay = Math.max(0, Number(deadline) - Date.now() + 75);
  const key = timerKey(gameId, questionId);
  if (redisEnabled()) {
    const q = ensureQueue();
    const old = await q.getJob(key);
    if (old) await old.remove().catch(() => {});
    await q.add('question-timeout', { gameId, userId, questionId }, {
      jobId: key,
      delay,
      removeOnComplete: 500,
      removeOnFail: 500,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 }
    });
    return;
  }
  clearTimeout(fallbackTimers.get(gameId));
  fallbackTimers.set(gameId, setTimeout(() => {
    fallbackTimers.delete(gameId);
    Promise.resolve(handler?.({ gameId, userId, questionId })).catch(console.error);
  }, delay));
}

async function cancelQuestionTimeout(gameId, questionId) {
  if (redisEnabled()) {
    const q = ensureQueue();
    const job = await q.getJob(timerKey(gameId, questionId));
    if (job) await job.remove().catch(() => {});
    return;
  }
  clearTimeout(fallbackTimers.get(gameId));
  fallbackTimers.delete(gameId);
}

async function closeTimers() {
  for (const timeout of fallbackTimers.values()) clearTimeout(timeout);
  fallbackTimers.clear();
  if (worker) await worker.close();
  if (queue) await queue.close();
  worker = null;
  queue = null;
}

module.exports = { startQuestionTimeoutWorker, scheduleQuestionTimeout, cancelQuestionTimeout, closeTimers };
