const express = require('express');
const multer = require('multer');
const { Team } = require('../models');
const auth = require('../middleware/auth');
const { uploadCrest } = require('../services/storageService');
const { validateTeamName } = require('../services/contentModeration');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });
router.use(auth);

router.put('/mine', async (req, res, next) => {
  try {
    const team = await Team.findOne({ where: { userId: req.user.id } });
    if (!team) return res.status(404).json({ error: 'Equipo no encontrado.' });
    const allowed = ['crestUrl','crestEmoji','primaryColor','secondaryColor','shirtPattern'];
    for (const key of allowed) if (req.body[key] !== undefined) team[key] = req.body[key];
    if (req.body.name !== undefined) {
      team.name = validateTeamName(req.body.name);
      team.moderationStatus = 'approved';
      team.moderationReason = null;
    }
    await team.save();
    res.json(team);
  } catch (e) { next(e); }
});

router.post('/mine/crest', upload.single('crest'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Adjuntá un escudo.' });
    const team = await Team.findOne({ where: { userId: req.user.id } });
    if (!team) return res.status(404).json({ error: 'Equipo no encontrado.' });
    const uploaded = await uploadCrest(req.file.buffer, req.file.mimetype, req.user.id);
    team.crestUrl = uploaded.url;
    team.crestStorageKey = uploaded.key;
    await team.save();
    res.json({ team, storage: uploaded.provider });
  } catch (e) { next(e); }
});

module.exports = router;
