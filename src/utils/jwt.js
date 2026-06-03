const jwt = require('jsonwebtoken');

function generateTokens(payload) {
  const access  = jwt.sign(payload, process.env.JWT_SECRET,         { expiresIn: process.env.JWT_ACCESS_EXPIRES  || '15m' });
  const refresh = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.JWT_REFRESH_EXPIRES || '7d'  });
  return { access, refresh };
}

function verifyAccess(token)  { return jwt.verify(token, process.env.JWT_SECRET); }
function verifyRefresh(token) { return jwt.verify(token, process.env.JWT_REFRESH_SECRET); }

module.exports = { generateTokens, verifyAccess, verifyRefresh };