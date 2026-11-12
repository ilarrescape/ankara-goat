const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = filename => fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');

test('Socket.IO importa la validación de membresía federativa antes de utilizarla', () => {
  const source = read('src/sockets/gameSocket.js');
  assert.match(source, /const\s*\{\s*ensureFriendlyMembership\s*\}\s*=\s*require\(['"]\.\.\/services\/federationFriendlies['"]\)/);
  assert.match(source, /await ensureFriendlyMembership\(game,\s*socket\.user\.id\)/);
  assert.match(source, /await ensureFriendlyMembership\(game,\s*userId\)/);
  // Exige también que el módulo sea importable con sus dependencias instaladas.
  assert.equal(typeof require('../src/sockets/gameSocket'), 'function');
});

test('Los controles de federados quedan agrupados, con iconos y estilos de colores distintos', () => {
  const ui = read('public/js/federations.js');
  const css = read('public/css/federations.css');
  assert.match(ui, /class=\\?"fed-member-actions/);
  for(const [label, icon, tone] of [
    ['Logros', 'medal', 'achievements'],
    ['Retar', 'swords', 'challenge'],
    ['Alternar Secretario', 'users', 'role'],
    ['Permisos', 'settings', 'permissions']
  ]) {
    assert.ok(ui.includes(`memberAction('${label}','${icon}'`), `${label} debe incluir ícono`);
    assert.ok(css.includes(`.fed-member-action-${tone}`), `${label} debe tener color independiente`);
  }
  assert.match(css, /\.fed-member-actions\s*\{[^}]*justify-content:flex-end/);
  assert.match(css, /\.fed-member-actions \.fed-member-action\s*\{[^}]*background:#000/);
  assert.match(css, /border:1px solid var\(--member-tone\)/);
});
