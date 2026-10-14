require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { io } = require('socket.io-client');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
const target = arg('target', process.env.LOAD_TEST_TARGET || manifest.target);
const duration = Math.max(5, Number(arg('duration', 60))) * 1000;
const ramp = Math.max(0, Number(arg('ramp-ms', 5)));

let connected = 0;
let acks = 0;
let errors = 0;
let events = 0;
let questions = 0;
let staleActionsRejected = 0;
const lat = [];
const sockets = [];

function emitAck(socket, event, data, { tolerateStale = false } = {}) {
  const startedAt = Date.now();
  socket.timeout(5000).emit(event, data, (err, ack) => {
    if (err || !ack?.ok) {
      const message = ack?.error || err?.message || '';
      if (tolerateStale && /turno cambió|ya fue resuelta|pregunta ya cambió|ahora no se puede/i.test(message)) {
        staleActionsRejected += 1;
        return;
      }
      errors += 1;
      return;
    }
    acks += 1;
    lat.push(Date.now() - startedAt);
  });
}

(async () => {
  console.log(`Target ${target} · partidas ${manifest.games.length} · sockets ${manifest.games.reduce((n, g) => n + g.players.length, 0)} · duración ${duration / 1000}s`);
  let seq = 0;

  for (const g of manifest.games) {
    for (const p of g.players) {
      await new Promise(resolve => setTimeout(resolve, ramp));

      const socket = io(target, {
        auth: { token: p.token },
        transports: ['websocket'],
        upgrade: false,
        reconnection: false,
        timeout: 10000
      });

      sockets.push(socket);

      let latestState = null;
      let scheduledRollToken = null;
      let scheduledQuestionKey = null;
      let scheduledCoinToken = null;

      socket.on('connect', () => {
        connected += 1;
        emitAck(socket, 'join_game', { gameId: g.gameId });
      });

      socket.on('game_state', payload => {
        events += 1;
        const st = payload.state;
        latestState = st;
        if (!st || payload.status !== 'running') return;

        const current = st.players?.[st.turnIndex];
        if (Number(current?.userId) !== Number(p.userId) || st.phase !== 'roll' || !st.turnToken) return;
        if (scheduledRollToken === st.turnToken) return;

        scheduledRollToken = st.turnToken;
        setTimeout(() => {
          emitAck(socket, 'roll_dice', {
            gameId: g.gameId,
            turnToken: st.turnToken
          }, { tolerateStale: true });
        }, Math.floor(Math.random() * 120) + 10);
      });

      socket.on('question', q => {
        questions += 1;
        const key = `${q.turnToken}:${q.id}`;
        if (scheduledQuestionKey === key) return;
        scheduledQuestionKey = key;

        let answer = null;
        if (q.type === 'multiple_choice') {
          answer = q.options?.[Math.floor(Math.random() * (q.options?.length || 1))] || null;
        } else {
          // Una respuesta incompleta es válida para el stress test: el servidor
          // la computará como incorrecta y el turno seguirá normalmente.
          answer = {};
        }

        setTimeout(() => {
          emitAck(socket, 'submit_answer', {
            gameId: g.gameId,
            questionId: q.id,
            turnToken: q.turnToken,
            answer
          }, { tolerateStale: true });
        }, Math.floor(Math.random() * 150) + 20);
      });

      socket.on('coin_toss_choice_required', payload => {
        const turnToken = payload?.turnToken || latestState?.turnToken;
        if (!turnToken || scheduledCoinToken === turnToken) return;
        scheduledCoinToken = turnToken;

        const rival = g.players.find(x => Number(x.userId) !== Number(p.userId));
        if (!rival) return;

        emitAck(socket, 'coin_toss_choice', {
          gameId: g.gameId,
          turnToken,
          targetUserId: rival.userId,
          amount: 1
        }, { tolerateStale: true });
      });

      socket.on('connect_error', () => {
        errors += 1;
      });

      if (++seq % 50 === 0) console.log(`conexiones lanzadas: ${seq}`);
    }
  }

  setTimeout(() => {
    for (const s of sockets) s.disconnect();
    const sorted = lat.sort((a, b) => a - b);
    const pct = x => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * x))] : 0;

    console.log(JSON.stringify({
      connected,
      acks,
      errors,
      events,
      questions,
      staleActionsRejected,
      ackLatencyMs: {
        p50: pct(.5),
        p95: pct(.95),
        p99: pct(.99),
        max: sorted.at(-1) || 0
      }
    }, null, 2));

    process.exit(errors ? 2 : 0);
  }, duration);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
