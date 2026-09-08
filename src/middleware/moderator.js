module.exports = function moderator(req, res, next) {
  if (!['moderator','admin'].includes(req.user?.role)) return res.status(403).json({ error: 'Se requiere perfil de moderador.' });
  next();
};
