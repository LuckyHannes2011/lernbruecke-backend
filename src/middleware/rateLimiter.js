const rateLimit = require('express-rate-limit');

const generalLimiter = rateLimit({ windowMs: 15*60*1000, max: 300, standardHeaders: true, legacyHeaders: false, message: { error: 'Zu viele Anfragen. Bitte kurz warten.' } });
const authLimiter    = rateLimit({ windowMs: 15*60*1000, max: 20,  message: { error: 'Zu viele Login-Versuche. Bitte 15 Minuten warten.' } });
const uploadLimiter  = rateLimit({ windowMs: 60*60*1000, max: 30,  message: { error: 'Upload-Limit erreicht.' } });

module.exports = { generalLimiter, authLimiter, uploadLimiter };