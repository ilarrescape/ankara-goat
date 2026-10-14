const express = require('express');
const { getPublicMatchByCode, getPublicTournamentByCode } = require('../services/publicShareService');

const router = express.Router();

router.get('/matches/:code', async (req, res, next) => {
  try {
    const data = await getPublicMatchByCode(req.params.code);
    if (!data) return res.status(404).json({ error:'Resultado público inexistente.' });
    res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
    res.json(data);
  } catch (error) { next(error); }
});

router.get('/tournaments/:code', async (req, res, next) => {
  try {
    const data = await getPublicTournamentByCode(req.params.code);
    if (!data) return res.status(404).json({ error:'Torneo público inexistente.' });
    res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
    res.json(data);
  } catch (error) { next(error); }
});

module.exports = router;
