// Valida estructura y distribución antes de importar un banco grande.
// Uso: node scripts/validate-question-bank.js ./preguntas.json
const fs = require('fs');
const { inferTier } = require('../src/services/questionTiers');

const file = process.argv[2];
if (!file) throw new Error('Indicá la ruta del JSON.');
const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!Array.isArray(rows)) throw new Error('El JSON debe contener un array.');

const stats = { total: rows.length, multiple_choice: 0, categorization: 0, tiers: {1:0,2:0,3:0}, missingArea: 0, errors: [] };
const prompts = new Set();
rows.forEach((q, index) => {
  const n = index + 1;
  if (!['multiple_choice','categorization'].includes(q.type)) stats.errors.push(`#${n}: type inválido`);
  else stats[q.type]++;
  if (!q.prompt || String(q.prompt).trim().length < 4) stats.errors.push(`#${n}: prompt vacío/corto`);
  const key = String(q.prompt || '').trim().toLowerCase();
  if (prompts.has(key)) stats.errors.push(`#${n}: prompt duplicado`); else prompts.add(key);
  const tier = Number(q.tier || inferTier(q));
  if (![1,2,3].includes(tier)) stats.errors.push(`#${n}: tier inválido`); else stats.tiers[tier]++;
  const diff = Number(q.difficulty || 2);
  if (!Number.isInteger(diff) || diff < 1 || diff > 5) stats.errors.push(`#${n}: difficulty debe ser 1..5`);
  if (!(q.knowledgeArea || q.competition || q.category)) stats.missingArea++;
  if (q.type === 'multiple_choice') {
    if (!Array.isArray(q.options) || q.options.length !== 4) stats.errors.push(`#${n}: multiple choice debe tener exactamente 4 opciones`);
    if (!q.options?.some(v => String(v).trim().toLowerCase() === String(q.correctAnswer).trim().toLowerCase())) stats.errors.push(`#${n}: correctAnswer no aparece entre las opciones`);
  }
  if (q.type === 'categorization') {
    if (!Array.isArray(q.options?.categories) || !Array.isArray(q.options?.items)) stats.errors.push(`#${n}: categorización sin categories/items`);
    if (!q.correctAnswer || typeof q.correctAnswer !== 'object' || Array.isArray(q.correctAnswer)) stats.errors.push(`#${n}: correctAnswer de categorización inválido`);
  }
});

console.log(JSON.stringify(stats, null, 2));
if (rows.length === 30000) {
  console.log(`Objetivo 30.000: ${stats.multiple_choice === 20000 && stats.categorization === 10000 ? 'OK' : 'NO COINCIDE'} (MC ${stats.multiple_choice}, CAT ${stats.categorization})`);
}
if (stats.errors.length) process.exitCode = 1;
