require('dotenv').config();
const path = require('path');
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const { sequelize } = require('./models');
const { runMigrations } = require('./config/migrations');
const { redisEnabled, createRedisConnection, closeRedis } = require('./config/redis');
const { closeTimers } = require('./services/timerService');
const authRoutes = require('./routes/authRoutes');
const teamRoutes = require('./routes/teamRoutes');
const tournamentRoutes = require('./routes/tournamentRoutes');
const gameRoutes = require('./routes/gameRoutes');
const userRoutes = require('./routes/userRoutes');
const profileRoutes = require('./routes/profileRoutes');
const leaderboardRoutes = require('./routes/leaderboardRoutes');
const questionRoutes = require('./routes/questionRoutes');
const adminRoutes = require('./routes/adminRoutes');
const moderationRoutes = require('./routes/moderationRoutes');
const gameSocket = require('./sockets/gameSocket');

if (!process.env.JWT_SECRET) {
  console.error('Falta JWT_SECRET en variables de entorno.');
  process.exit(1);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true },
  transports: ['websocket'],
  perMessageDeflate: false,
  maxHttpBufferSize: 1e6,
  pingInterval: Number(process.env.SOCKET_PING_INTERVAL_MS || 25000),
  pingTimeout: Number(process.env.SOCKET_PING_TIMEOUT_MS || 20000)
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/api/health', async (req, res) => {
  let database = false;
  let redis = !redisEnabled();
  try {
    console.log("=== CONFIG DB ===");
    console.log("HOST:", process.env.DB_HOST);
    console.log("PORT:", process.env.DB_PORT);
    console.log("USER:", process.env.DB_USER);
    console.log("DATABASE:", process.env.DB_NAME);
    console.log("PASSWORD:", process.env.DB_PASSWORD ? "OK" : "NO DEFINIDA");
    await sequelize.query('SELECT 1');
    database = true;
  } catch {}
  if (redisEnabled()) {
    try {
      const client = createRedisConnection();
      await client.ping();
      await client.quit();
      redis = true;
    } catch {}
  }
  const ok = database && redis;
  res.status(ok ? 200 : 503).json({ ok, app: 'Ankara GOAT', version: '0.3.0', database, redis, replicaId: process.env.RAILWAY_REPLICA_ID || null, replicaRegion: process.env.RAILWAY_REPLICA_REGION || null, time: new Date().toISOString() });
});
app.use('/api/auth', authRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/tournaments', tournamentRoutes);
app.use('/api/games', gameRoutes);
app.use('/api/users', userRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/questions', questionRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/moderation', moderationRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'El escudo no puede superar 2 MB.' });
  res.status(400).json({ error: err.message || 'Error inesperado.' });
});

async function configureRedisAdapter() {
  if (!redisEnabled()) {
    console.log('Redis desactivado: Socket.IO y timers usarán modo local de desarrollo.');
    return;
  }
  const pubClient = createRedisConnection();
  const subClient = pubClient.duplicate();
  pubClient.on('error', err => console.error('[socket redis pub]', err.message));
  subClient.on('error', err => console.error('[socket redis sub]', err.message));
  io.adapter(createAdapter(pubClient, subClient, { publishOnSpecificResponseChannel: true }));
  console.log('Socket.IO Redis Adapter activo.');
}

const port = Number(process.env.PORT || 3000);
(async () => {
  try {
    await sequelize.authenticate();
    const shouldAutoMigrate = process.env.AUTO_MIGRATE === 'true' || process.env.NODE_ENV !== 'production';
    if (shouldAutoMigrate) await runMigrations();
    await configureRedisAdapter();
    gameSocket(io);
    server.listen(port, '0.0.0.0', () => console.log(`Ankara GOAT escuchando en puerto ${port}`));
  } catch (e) {
    console.error('No se pudo iniciar:', e);
    process.exit(1);
  }
})();

async function shutdown(signal) {
  console.log(`Cerrando Ankara GOAT (${signal})...`);
  await closeTimers().catch(() => {});
  await closeRedis().catch(() => {});
  await new Promise(resolve => server.close(resolve));
  await sequelize.close().catch(() => {});
  process.exit(0);
}
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
