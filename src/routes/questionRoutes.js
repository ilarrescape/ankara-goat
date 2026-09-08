const express = require('express');
const { Question, QuestionReport } = require('../models');
const auth = require('../middleware/auth');
const router = express.Router();
router.use(auth);

router.post('/:id/report', async (req, res, next) => {
  try {
    const question = await Question.findByPk(Number(req.params.id));
    if (!question) return res.status(404).json({ error: 'Pregunta inexistente.' });
    const allowed = ['incorrect_answer','outdated','ambiguous','typo','other'];
    const reason = allowed.includes(req.body.reason) ? req.body.reason : 'other';
    const report = await QuestionReport.create({ questionId: question.id, reporterId: req.user.id, reason, details: String(req.body.details || '').slice(0, 1000) || null });
    res.status(201).json(report);
  } catch (e) { next(e); }
});

module.exports = router;
