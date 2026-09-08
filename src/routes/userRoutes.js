const express = require('express');
const { Op } = require('sequelize');
const { User, Team } = require('../models');
const auth = require('../middleware/auth');
const router = express.Router();
router.use(auth);

router.get('/search', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json([]);
    const users = await User.findAll({
      where: { id: { [Op.ne]: req.user.id }, username: { [Op.like]: `%${q}%` } },
      attributes: ['id','username'], include: [{ model: Team, attributes: ['name','crestEmoji','primaryColor'] }], limit: 12
    });
    res.json(users);
  } catch (e) { next(e); }
});
module.exports = router;
