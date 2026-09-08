const { parse } = require('csv-parse/sync');
const { inferTier } = require('./questionTiers');

function asJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function normalizeQuestion(row) {
  const type = String(row.type || '').trim();
  const prompt = String(row.prompt || '').trim();
  let options = row.options ?? row.options_json ?? null;
  let correctAnswer = row.correctAnswer ?? row.correct_answer ?? row.correct_answer_json ?? null;

  if (type === 'multiple_choice') {
    if (!Array.isArray(options)) {
      const parsed = asJson(options, null);
      options = Array.isArray(parsed) ? parsed : [row.option_a, row.option_b, row.option_c, row.option_d].filter(v => v != null && String(v).trim() !== '');
    }
    if (typeof correctAnswer === 'string') {
      const parsed = asJson(correctAnswer, undefined);
      if (parsed !== undefined) correctAnswer = parsed;
    }
  } else if (type === 'categorization') {
    options = asJson(options, options);
    correctAnswer = asJson(correctAnswer, correctAnswer);
  }

  const prepared = {
    type,
    prompt,
    options,
    correctAnswer,
    category: String(row.category || '').trim() || null,
    competition: String(row.competition || '').trim() || null,
    knowledgeArea: String(row.knowledgeArea || row.knowledge_area || '').trim() || null,
    tier: Number(row.tier || 0) || undefined,
    difficulty: Number(row.difficulty || 2),
    reviewStatus: String(row.reviewStatus || row.review_status || 'published'),
    active: !['false','0','no'].includes(String(row.active ?? 'true').toLowerCase())
  };
  if (!prepared.tier) prepared.tier = Number(inferTier(prepared));
  if (!prepared.knowledgeArea) prepared.knowledgeArea = prepared.competition || prepared.category || 'General';
  return prepared;
}

function validateQuestion(q, index = 0) {
  const prefix = index ? `Fila ${index}: ` : '';
  if (!['multiple_choice','categorization'].includes(q.type)) throw new Error(`${prefix}type inválido.`);
  if (q.prompt.length < 4 || q.prompt.length > 500) throw new Error(`${prefix}prompt inválido.`);
  if (![1,2,3].includes(Number(q.tier))) throw new Error(`${prefix}tier debe ser 1, 2 o 3.`);
  if (!Number.isInteger(Number(q.difficulty)) || Number(q.difficulty) < 1 || Number(q.difficulty) > 5) throw new Error(`${prefix}difficulty debe ser 1..5.`);
  if (!['draft','review','published','rejected'].includes(q.reviewStatus)) throw new Error(`${prefix}reviewStatus inválido.`);
  if (q.type === 'multiple_choice') {
    if (!Array.isArray(q.options) || q.options.length !== 4) throw new Error(`${prefix}multiple_choice requiere exactamente 4 opciones.`);
    const target = String(q.correctAnswer ?? '').trim().toLowerCase();
    if (!q.options.some(v => String(v).trim().toLowerCase() === target)) throw new Error(`${prefix}correctAnswer debe coincidir con una de las 4 opciones.`);
  } else {
    if (!q.options || !Array.isArray(q.options.categories) || !Array.isArray(q.options.items)) throw new Error(`${prefix}categorización requiere options.categories y options.items.`);
    if (!q.correctAnswer || typeof q.correctAnswer !== 'object' || Array.isArray(q.correctAnswer)) throw new Error(`${prefix}correctAnswer de categorización debe ser un objeto.`);
  }
  return q;
}

function parseQuestionFile(buffer, mimeType, originalName = '') {
  const name = String(originalName).toLowerCase();
  let rows;
  if (name.endsWith('.json') || mimeType === 'application/json') {
    rows = JSON.parse(buffer.toString('utf8'));
    if (!Array.isArray(rows)) throw new Error('El JSON debe contener un array de preguntas.');
  } else if (name.endsWith('.csv') || ['text/csv','application/vnd.ms-excel','text/plain'].includes(mimeType)) {
    rows = parse(buffer.toString('utf8'), { columns: true, skip_empty_lines: true, trim: true, bom: true, relax_column_count: true });
  } else {
    throw new Error('Formato no soportado. Usá CSV o JSON.');
  }
  if (rows.length > 30000) throw new Error('Una importación no puede superar 30.000 preguntas.');
  const prepared = rows.map((row, i) => validateQuestion(normalizeQuestion(row), i + 1));
  const seen = new Set();
  for (const [i, q] of prepared.entries()) {
    const key = q.prompt.toLowerCase();
    if (seen.has(key)) throw new Error(`Fila ${i + 1}: prompt duplicado dentro del archivo.`);
    seen.add(key);
  }
  return prepared;
}

module.exports = { normalizeQuestion, validateQuestion, parseQuestionFile };
