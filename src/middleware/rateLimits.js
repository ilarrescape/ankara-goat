const { rateLimit } = require('express-rate-limit');

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 80, standardHeaders: 'draft-8', legacyHeaders: false });
const writeLimiter = rateLimit({ windowMs: 60 * 1000, limit: 90, standardHeaders: 'draft-8', legacyHeaders: false });

module.exports = { authLimiter, writeLimiter };
