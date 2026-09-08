const test = require('node:test');
const assert = require('node:assert/strict');
const { POLICY_VERSION, publicPolicy } = require('../src/services/moderationPolicy');

test('la política de moderación tiene versión y secciones para nombres, chat y aplicación', () => {
  const policy = publicPolicy();
  assert.equal(policy.version, POLICY_VERSION);
  assert.ok(Array.isArray(policy.sections) && policy.sections.length === 3);
  const names = policy.sections.find(x => x.title === 'Nombres de equipos');
  const chat = policy.sections.find(x => x.title === 'Chat y reacciones');
  const enforcement = policy.sections.find(x => x.title === 'Aplicación y apelación');
  assert.ok(names.rules.length >= 4);
  assert.ok(chat.rules.length >= 4);
  assert.ok(enforcement.rules.length >= 3);
});
