const test = require('node:test');
const assert = require('node:assert/strict');
const { difference, coreKey, sortStandings, exactTieGroups, serializeStanding } = require('../src/services/standingsService');

test('desempata por puntos, luego victorias y luego diferencia de respuestas', () => {
  const rows = [
    { userId: 1, points: 9, wins: 2, correctAnswers: 20, incorrectAnswers: 10, seed: 1 },
    { userId: 2, points: 9, wins: 3, correctAnswers: 10, incorrectAnswers: 9, seed: 2 },
    { userId: 3, points: 9, wins: 3, correctAnswers: 18, incorrectAnswers: 8, seed: 3 },
    { userId: 4, points: 6, wins: 10, correctAnswers: 100, incorrectAnswers: 0, seed: 4 }
  ];
  assert.deepEqual(sortStandings(rows).map(x => x.userId), [3, 2, 1, 4]);
});

test('un empate exacto se resuelve por el orden real de la partida definitoria', () => {
  const rows = [
    { userId: 10, points: 12, wins: 4, correctAnswers: 30, incorrectAnswers: 10, seed: 1 },
    { userId: 11, points: 12, wins: 4, correctAnswers: 28, incorrectAnswers: 8, seed: 2 },
    { userId: 12, points: 12, wins: 4, correctAnswers: 25, incorrectAnswers: 5, seed: 3 }
  ];
  const key = coreKey(rows[0]);
  assert.equal(key, coreKey(rows[1]));
  assert.equal(key, coreKey(rows[2]));
  const resolved = new Map([[key, [12, 10, 11]]]);
  assert.deepEqual(sortStandings(rows, resolved).map(x => x.userId), [12, 10, 11]);
});

test('detecta solamente grupos con empate exacto', () => {
  const rows = [
    { userId: 1, points: 3, wins: 1, correctAnswers: 5, incorrectAnswers: 2 },
    { userId: 2, points: 3, wins: 1, correctAnswers: 7, incorrectAnswers: 4 },
    { userId: 3, points: 3, wins: 1, correctAnswers: 7, incorrectAnswers: 3 }
  ];
  const ties = exactTieGroups(rows);
  assert.equal(ties.length, 1);
  assert.deepEqual(ties[0].rows.map(x => x.userId), [1, 2]);
});

test('serializa las columnas públicas de tabla', () => {
  const row = { userId: 7, points: 8, wins: 2, correctAnswers: 14, incorrectAnswers: 5, played: 4 };
  assert.equal(difference(row), 9);
  assert.deepEqual(serializeStanding(row, 2), {
    position: 2, userId: 7, groupCode: null, points: 8, wins: 2,
    correctAnswers: 14, incorrectAnswers: 5, answerDifference: 9, played: 4
  });
});
