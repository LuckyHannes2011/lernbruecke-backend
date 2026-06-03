const { verifyAccess } = require('../utils/jwt');

function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return res.status(401).json({ error: 'Kein Token' });
  try { req.user = verifyAccess(h.slice(7)); next(); }
  catch { res.status(401).json({ error: 'Token ungültig oder abgelaufen' }); }
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'ADMIN') return res.status(403).json({ error: 'Nur für Admins' });
  next();
}

function tutorOnly(req, res, next) {
  if (!['TUTOR','ADMIN'].includes(req.user?.role)) return res.status(403).json({ error: 'Nur für Tutoren' });
  next();
}

module.exports = { auth, adminOnly, tutorOnly };