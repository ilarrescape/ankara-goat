const express = require('express');
const { User, Team } = require('../models');
const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const users = await User.findAll({
      where: { accountStatus: 'active' },
      attributes: ['id','username','eloRating','level','xp'],
      include: [{ model: Team, where: { moderationStatus: 'approved' }, required: true, attributes: ['id','name','crestEmoji','crestUrl','primaryColor'] }],
      order: [['eloRating','DESC'],['xp','DESC']],
      limit: Math.min(100, Number(req.query.limit || 50))
    });
    res.json(users);
  } catch (e) { next(e); }
});

module.exports = router;
