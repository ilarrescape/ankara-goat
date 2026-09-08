const IORedis = require('ioredis');

let commandClient = null;

function redisEnabled() {
  return Boolean(process.env.REDIS_URL);
}

function createRedisConnection({ blocking = false } = {}) {
  if (!redisEnabled()) return null;
  return new IORedis(process.env.REDIS_URL, {
    maxRetriesPerRequest: blocking ? null : 2,
    enableReadyCheck: true,
    lazyConnect: false
  });
}

function getRedis() {
  if (!redisEnabled()) return null;
  if (!commandClient) {
    commandClient = createRedisConnection();
    commandClient.on('error', err => console.error('[redis]', err.message));
  }
  return commandClient;
}

async function closeRedis() {
  if (commandClient) {
    const client = commandClient;
    commandClient = null;
    await client.quit().catch(() => client.disconnect());
  }
}

module.exports = { redisEnabled, createRedisConnection, getRedis, closeRedis };
