module.exports = function admin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Se requiere rol de administrador.' });
  next();
};
