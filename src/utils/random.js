const crypto = require('crypto');

function randomInt(min, max) {
  return crypto.randomInt(min, max + 1);
}
function shuffle(items) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function roomCode(length = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length }, () => alphabet[randomInt(0, alphabet.length - 1)]).join('');
}
module.exports = { randomInt, shuffle, roomCode };
