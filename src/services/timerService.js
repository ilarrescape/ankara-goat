const { Queue, Worker } = require('bullmq');
const { redisEnabled, createRedisConnection } = require('../config/redis');

const fallbackQuestionTimers = new Map();
const fallbackAbsenceTimers = new Map();
const fallbackResultTimers = new Map();
const fallbackRouletteTimers = new Map();
const fallbackCellVideoTimers = new Map();
let questionQueue = null;
let questionWorker = null;
let questionHandler = null;
let absenceQueue = null;
let absenceWorker = null;
let absenceHandler = null;
let resultQueue = null;
let resultWorker = null;
let resultHandler = null;
let rouletteQueue = null;
let rouletteWorker = null;
let rouletteHandler = null;
let cellVideoQueue = null;
let cellVideoWorker = null;
let cellVideoHandler = null;

function questionTimerKey(gameId, questionId) {
  return `question-timeout-${gameId}-${questionId}`;
}

function absenceTimerKey(gameId, userId) {
  return `player-absence-${gameId}-${userId}`;
}
function resultTimerKey(gameId, turnToken) { return `result-reveal-${gameId}-${turnToken}`; }
function rouletteTimerKey(gameId, turnToken, action) { return `roulette-${action}-${gameId}-${turnToken}`; }
function cellVideoTimerKey(gameId, turnToken) { return `cell-video-${gameId}-${turnToken}`; }

function ensureQuestionQueue() {
  if (!redisEnabled()) return null;
  if (!questionQueue) questionQueue = new Queue('ankara-question-timeouts', { connection: createRedisConnection() });
  return questionQueue;
}

function ensureResultQueue() {
  if (!redisEnabled()) return null;
  if (!resultQueue) resultQueue = new Queue('ankara-result-reveal-timeouts', { connection: createRedisConnection() });
  return resultQueue;
}

function ensureRouletteQueue() {
  if (!redisEnabled()) return null;
  if (!rouletteQueue) rouletteQueue = new Queue('ankara-roulette-timeouts', { connection: createRedisConnection() });
  return rouletteQueue;
}

function ensureCellVideoQueue() {
  if (!redisEnabled()) return null;
  if (!cellVideoQueue) cellVideoQueue = new Queue('ankara-cell-video-timeouts', { connection: createRedisConnection() });
  return cellVideoQueue;
}

function ensureAbsenceQueue() {
  if (!redisEnabled()) return null;
  if (!absenceQueue) absenceQueue = new Queue('ankara-player-absence-timeouts', { connection: createRedisConnection() });
  return absenceQueue;
}

function startQuestionTimeoutWorker(fn) {
  questionHandler = fn;
  if (!redisEnabled() || questionWorker) return questionWorker;
  questionWorker = new Worker('ankara-question-timeouts', async job => {
    if (job.name !== 'question-timeout' || !questionHandler) return;
    await questionHandler(job.data);
  }, { connection: createRedisConnection({ blocking: true }) });
  questionWorker.on('error', err => console.error('[bullmq question worker]', err.message));
  return questionWorker;
}

function startResultRevealTimeoutWorker(fn) {
  resultHandler = fn;
  if (!redisEnabled() || resultWorker) return resultWorker;
  resultWorker = new Worker('ankara-result-reveal-timeouts', async job => {
    if (job.name !== 'result-reveal-timeout' || !resultHandler) return;
    await resultHandler(job.data);
  }, { connection: createRedisConnection({ blocking: true }) });
  resultWorker.on('error', err => console.error('[bullmq result worker]', err.message));
  return resultWorker;
}

function startRouletteTimeoutWorker(fn) {
  rouletteHandler = fn;
  if (!redisEnabled() || rouletteWorker) return rouletteWorker;
  rouletteWorker = new Worker('ankara-roulette-timeouts', async job => {
    if (job.name !== 'roulette-timeout' || !rouletteHandler) return;
    await rouletteHandler(job.data);
  }, { connection: createRedisConnection({ blocking: true }) });
  rouletteWorker.on('error', err => console.error('[bullmq roulette worker]', err.message));
  return rouletteWorker;
}

function startCellVideoTimeoutWorker(fn) {
  cellVideoHandler = fn;
  if (!redisEnabled() || cellVideoWorker) return cellVideoWorker;
  cellVideoWorker = new Worker('ankara-cell-video-timeouts', async job => {
    if (job.name !== 'cell-video-timeout' || !cellVideoHandler) return;
    await cellVideoHandler(job.data);
  }, { connection: createRedisConnection({ blocking: true }) });
  cellVideoWorker.on('error', err => console.error('[bullmq cell video worker]', err.message));
  return cellVideoWorker;
}

function startPlayerAbsenceTimeoutWorker(fn) {
  absenceHandler = fn;
  if (!redisEnabled() || absenceWorker) return absenceWorker;
  absenceWorker = new Worker('ankara-player-absence-timeouts', async job => {
    if (job.name !== 'player-absence-timeout' || !absenceHandler) return;
    await absenceHandler(job.data);
  }, { connection: createRedisConnection({ blocking: true }) });
  absenceWorker.on('error', err => console.error('[bullmq absence worker]', err.message));
  return absenceWorker;
}

async function scheduleQuestionTimeout({ gameId, userId, questionId, deadline }) {
  const delay = Math.max(0, Number(deadline) - Date.now() + 75);
  const key = questionTimerKey(gameId, questionId);
  if (redisEnabled()) {
    const q = ensureQuestionQueue();
    const old = await q.getJob(key);
    if (old) await old.remove().catch(() => {});
    await q.add('question-timeout', { gameId, userId, questionId }, {
      jobId: key, delay, removeOnComplete: 500, removeOnFail: 500,
      attempts: 3, backoff: { type: 'exponential', delay: 1000 }
    });
    return;
  }
  clearTimeout(fallbackQuestionTimers.get(key));
  fallbackQuestionTimers.set(key, setTimeout(() => {
    fallbackQuestionTimers.delete(key);
    Promise.resolve(questionHandler?.({ gameId, userId, questionId })).catch(console.error);
  }, delay));
}

async function cancelQuestionTimeout(gameId, questionId) {
  const key = questionTimerKey(gameId, questionId);
  if (redisEnabled()) {
    const q = ensureQuestionQueue();
    const job = await q.getJob(key);
    if (job) await job.remove().catch(() => {});
    return;
  }
  clearTimeout(fallbackQuestionTimers.get(key));
  fallbackQuestionTimers.delete(key);
}

async function scheduleResultRevealTimeout({ gameId, turnToken, deadline }) {
  const delay = Math.max(0, Number(deadline) - Date.now() + 50);
  const key = resultTimerKey(gameId, turnToken);
  if (redisEnabled()) {
    const q = ensureResultQueue();
    const old = await q.getJob(key); if (old) await old.remove().catch(() => {});
    await q.add('result-reveal-timeout', { gameId, turnToken, deadline:Number(deadline) }, { jobId:key, delay, removeOnComplete:500, removeOnFail:500, attempts:3, backoff:{type:'exponential',delay:1000} });
    return;
  }
  clearTimeout(fallbackResultTimers.get(key));
  fallbackResultTimers.set(key, setTimeout(() => { fallbackResultTimers.delete(key); Promise.resolve(resultHandler?.({gameId,turnToken,deadline:Number(deadline)})).catch(console.error); }, delay));
}

async function cancelResultRevealTimeout(gameId, turnToken) {
  const key = resultTimerKey(gameId, turnToken);
  if (redisEnabled()) { const q=ensureResultQueue(); const job=await q.getJob(key); if(job) await job.remove().catch(()=>{}); return; }
  clearTimeout(fallbackResultTimers.get(key)); fallbackResultTimers.delete(key);
}

async function scheduleCellVideoTimeout({ gameId, turnToken, deadline }) {
  const delay = Math.max(0, Number(deadline) - Date.now() + 50);
  const key = cellVideoTimerKey(gameId, turnToken);
  if (redisEnabled()) {
    const q = ensureCellVideoQueue();
    const old = await q.getJob(key);
    if (old) await old.remove().catch(() => {});
    await q.add('cell-video-timeout', { gameId, turnToken, deadline:Number(deadline) }, {
      jobId:key, delay, removeOnComplete:500, removeOnFail:500, attempts:3, backoff:{type:'exponential',delay:1000}
    });
    return;
  }
  clearTimeout(fallbackCellVideoTimers.get(key));
  fallbackCellVideoTimers.set(key, setTimeout(() => {
    fallbackCellVideoTimers.delete(key);
    Promise.resolve(cellVideoHandler?.({ gameId, turnToken, deadline:Number(deadline) })).catch(console.error);
  }, delay));
}

async function cancelCellVideoTimeout(gameId, turnToken) {
  const key = cellVideoTimerKey(gameId, turnToken);
  if (redisEnabled()) {
    const q = ensureCellVideoQueue();
    const job = await q.getJob(key);
    if (job) await job.remove().catch(() => {});
    return;
  }
  clearTimeout(fallbackCellVideoTimers.get(key));
  fallbackCellVideoTimers.delete(key);
}

async function schedulePlayerAbsenceTimeout({ gameId, userId, deadline }) {
  const delay = Math.max(0, Number(deadline) - Date.now() + 100);
  const key = absenceTimerKey(gameId, userId);
  if (redisEnabled()) {
    const q = ensureAbsenceQueue();
    const old = await q.getJob(key);
    if (old) await old.remove().catch(() => {});
    await q.add('player-absence-timeout', { gameId, userId, deadline: Number(deadline) }, {
      jobId: key, delay, removeOnComplete: 500, removeOnFail: 500,
      attempts: 3, backoff: { type: 'exponential', delay: 1000 }
    });
    return;
  }
  clearTimeout(fallbackAbsenceTimers.get(key));
  fallbackAbsenceTimers.set(key, setTimeout(() => {
    fallbackAbsenceTimers.delete(key);
    Promise.resolve(absenceHandler?.({ gameId, userId, deadline: Number(deadline) })).catch(console.error);
  }, delay));
}

async function cancelPlayerAbsenceTimeout(gameId, userId) {
  const key = absenceTimerKey(gameId, userId);
  if (redisEnabled()) {
    const q = ensureAbsenceQueue();
    const job = await q.getJob(key);
    if (job) await job.remove().catch(() => {});
    return;
  }
  clearTimeout(fallbackAbsenceTimers.get(key));
  fallbackAbsenceTimers.delete(key);
}

async function scheduleRouletteTimeout({ gameId, turnToken, action, deadline }) {
  const delay = Math.max(0, Number(deadline) - Date.now() + 50);
  const key = rouletteTimerKey(gameId, turnToken, action);
  if (redisEnabled()) {
    const q = ensureRouletteQueue();
    const old = await q.getJob(key); if (old) await old.remove().catch(() => {});
    await q.add('roulette-timeout', { gameId, turnToken, action, deadline:Number(deadline) }, { jobId:key, delay, removeOnComplete:500, removeOnFail:500, attempts:3, backoff:{type:'exponential',delay:1000} });
    return;
  }
  clearTimeout(fallbackRouletteTimers.get(key));
  fallbackRouletteTimers.set(key, setTimeout(() => { fallbackRouletteTimers.delete(key); Promise.resolve(rouletteHandler?.({gameId,turnToken,action,deadline:Number(deadline)})).catch(console.error); }, delay));
}

async function cancelRouletteTimeout(gameId, turnToken, action) {
  const key = rouletteTimerKey(gameId, turnToken, action);
  if (redisEnabled()) { const q=ensureRouletteQueue(); const job=await q.getJob(key); if(job) await job.remove().catch(()=>{}); return; }
  clearTimeout(fallbackRouletteTimers.get(key)); fallbackRouletteTimers.delete(key);
}

async function closeTimers() {
  for (const timeout of fallbackQuestionTimers.values()) clearTimeout(timeout);
  for (const timeout of fallbackAbsenceTimers.values()) clearTimeout(timeout);
  for (const timeout of fallbackResultTimers.values()) clearTimeout(timeout);
  for (const timeout of fallbackRouletteTimers.values()) clearTimeout(timeout);
  for (const timeout of fallbackCellVideoTimers.values()) clearTimeout(timeout);
  fallbackQuestionTimers.clear();
  fallbackAbsenceTimers.clear();
  fallbackResultTimers.clear();
  fallbackRouletteTimers.clear();
  fallbackCellVideoTimers.clear();
  if (questionWorker) await questionWorker.close();
  if (absenceWorker) await absenceWorker.close();
  if (resultWorker) await resultWorker.close();
  if (rouletteWorker) await rouletteWorker.close();
  if (cellVideoWorker) await cellVideoWorker.close();
  if (questionQueue) await questionQueue.close();
  if (absenceQueue) await absenceQueue.close();
  if (resultQueue) await resultQueue.close();
  if (rouletteQueue) await rouletteQueue.close();
  if (cellVideoQueue) await cellVideoQueue.close();
  questionWorker = null;
  absenceWorker = null;
  resultWorker = null;
  rouletteWorker = null;
  cellVideoWorker = null;
  questionQueue = null;
  absenceQueue = null;
  resultQueue = null;
  rouletteQueue = null;
  cellVideoQueue = null;
}

module.exports = {
  startQuestionTimeoutWorker,
  scheduleQuestionTimeout,
  cancelQuestionTimeout,
  startResultRevealTimeoutWorker,
  scheduleResultRevealTimeout,
  cancelResultRevealTimeout,
  startPlayerAbsenceTimeoutWorker,
  startCellVideoTimeoutWorker,
  startRouletteTimeoutWorker,
  scheduleRouletteTimeout,
  cancelRouletteTimeout,
  schedulePlayerAbsenceTimeout,
  scheduleCellVideoTimeout,
  cancelCellVideoTimeout,
  cancelPlayerAbsenceTimeout,
  closeTimers
};
