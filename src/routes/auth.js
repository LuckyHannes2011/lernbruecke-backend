require('dotenv').config();
const express = require('express');
const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');
const { PrismaClient }    = require('@prisma/client');
const { generateTokens, verifyRefresh } = require('../utils/jwt');
const { authLimiter }     = require('../middleware/rateLimiter');
const { auth }            = require('../middleware/auth');
const { sendEmail }       = require('../services/email');
const { OAuth2Client }    = require('google-auth-library');

const router  = express.Router();
const prisma  = new PrismaClient();
const gClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

function setRefreshCookie(res, token) {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

// POST /api/auth/register
router.post('/register', authLimiter, async (req, res) => {
  const { email, password, role, name } = req.body;
  if (!email || !password || !name)
    return res.status(400).json({ error: 'Alle Felder erforderlich' });
  if (password.length < 8)
    return res.status(400).json({ error: 'Passwort min. 8 Zeichen' });

  try {
    if (await prisma.user.findUnique({ where: { email } }))
      return res.status(409).json({ error: 'E-Mail bereits registriert' });

    const passwordHash = await bcrypt.hash(password, 12);
    const userRole     = role === 'TUTOR' ? 'TUTOR' : 'STUDENT';

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        role: userRole,
        ...(userRole === 'TUTOR'
          ? {
              tutorProfile: {
                create: {
                  name,
                  bio: null,
                  subjects: [],
                  levels: [],
                  tags: [],
                  pricePerHour: 10,
                  location: null,
                  isActive: true,
                  avatarUrl: null,
                  stripeAccountId: null,
                  stripeOnboarded: false,
                  avgRating: 0,
                  reviewCount: 0,
                  totalEarnings: 0,
                },
              },
            }
          : {
              studentProfile: {
                create: { name },
              },
            }),
      },
      include: { tutorProfile: true, studentProfile: true },
    });

    const { access, refresh } = generateTokens({
      userId: user.id,
      role:   user.role,
      email:  user.email,
    });
    await prisma.refreshToken.create({
      data: {
        token:     refresh,
        userId:    user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    setRefreshCookie(res, refresh);

    await sendEmail(
      email,
      'Willkommen bei LernBrücke!',
      `<h2>Hallo ${name}!</h2><p>Willkommen auf LernBrücke – der Nachhilfeplattform für Schüler in der Region Freiburg.</p>${
        userRole === 'TUTOR'
          ? '<p>Dein Profil ist sofort aktiv. Ergänze jetzt deine Fächer!</p>'
          : '<p>Finde jetzt Tutoren in deiner Nähe.</p>'
      }`
    );

    const profile = user.tutorProfile || user.studentProfile;
    res.status(201).json({
      access,
      user: { id: user.id, email, role: user.role, name, profile },
    });
  } catch (e) {
    console.error('Register error:', e);
    res.status(500).json({ error: 'Registrierung fehlgeschlagen: ' + e.message });
  }
});

// POST /api/auth/login
router.post('/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await prisma.user.findUnique({
      where: { email },
      include: { tutorProfile: true, studentProfile: true },
    });
    if (!user?.passwordHash)
      return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
    if (!await bcrypt.compare(password, user.passwordHash))
      return res.status(401).json({ error: 'Ungültige Anmeldedaten' });

    const { access, refresh } = generateTokens({
      userId: user.id,
      role:   user.role,
      email:  user.email,
    });
    await prisma.refreshToken.create({
      data: {
        token:     refresh,
        userId:    user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    setRefreshCookie(res, refresh);

    const profile = user.tutorProfile || user.studentProfile;
    res.json({
      access,
      user: { id: user.id, email, role: user.role, name: profile?.name, profile },
    });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Login fehlgeschlagen' });
  }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res) => {
  const token = req.cookies.refreshToken;
  if (!token) return res.status(401).json({ error: 'Kein Refresh-Token' });
  try {
    const payload = verifyRefresh(token);
    const stored  = await prisma.refreshToken.findUnique({ where: { token } });
    if (!stored || stored.expiresAt < new Date())
      return res.status(401).json({ error: 'Token abgelaufen' });

    await prisma.refreshToken.delete({ where: { token } });
    const { access, refresh } = generateTokens({
      userId: payload.userId,
      role:   payload.role,
      email:  payload.email,
    });
    await prisma.refreshToken.create({
      data: {
        token:     refresh,
        userId:    payload.userId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    setRefreshCookie(res, refresh);
    res.json({ access });
  } catch (e) {
    res.status(401).json({ error: 'Ungültiger Refresh-Token' });
  }
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  const token = req.cookies.refreshToken;
  if (token) await prisma.refreshToken.deleteMany({ where: { token } }).catch(() => {});
  res.clearCookie('refreshToken');
  res.json({ ok: true });
});

// POST /api/auth/forgot-password
router.post('/forgot-password', authLimiter, async (req, res) => {
  const { email } = req.body;
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.json({ ok: true });
    const token = crypto.randomBytes(32).toString('hex');
    await prisma.passwordResetToken.create({
      data: { email, token, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    });
    await sendEmail(
      email,
      'Passwort zurücksetzen',
      `<p><a href="${process.env.FRONTEND_URL}/reset-password?token=${token}">Passwort zurücksetzen</a> (1 Stunde gültig)</p>`
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Fehler beim Senden' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', authLimiter, async (req, res) => {
  const { token, password } = req.body;
  if (!password || password.length < 8)
    return res.status(400).json({ error: 'Passwort min. 8 Zeichen' });
  try {
    const record = await prisma.passwordResetToken.findUnique({ where: { token } });
    if (!record || record.expiresAt < new Date())
      return res.status(400).json({ error: 'Token ungültig oder abgelaufen' });
    await prisma.user.update({
      where: { email: record.email },
      data:  { passwordHash: await bcrypt.hash(password, 12) },
    });
    await prisma.passwordResetToken.delete({ where: { token } });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Fehler' });
  }
});

// POST /api/auth/google
router.post('/google', authLimiter, async (req, res) => {
  const { idToken, role, name } = req.body;
  try {
    const ticket  = await gClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const { sub: googleId, email, name: gName } = ticket.getPayload();

    let user = await prisma.user.findFirst({
      where: { OR: [{ googleId }, { email }] },
      include: { tutorProfile: true, studentProfile: true },
    });

    if (!user) {
      const userRole  = role === 'TUTOR' ? 'TUTOR' : 'STUDENT';
      const finalName = name || gName;
      user = await prisma.user.create({
        data: {
          email,
          googleId,
          role: userRole,
          ...(userRole === 'TUTOR'
            ? {
                tutorProfile: {
                  create: {
                    name: finalName,
                    subjects: [],
                    levels: [],
                    tags: [],
                    pricePerHour: 10,
                    isActive: true,
                  },
                },
              }
            : {
                studentProfile: {
                  create: { name: finalName },
                },
              }),
        },
        include: { tutorProfile: true, studentProfile: true },
      });
    } else if (!user.googleId) {
      await prisma.user.update({ where: { id: user.id }, data: { googleId } });
    }

    const { access, refresh } = generateTokens({
      userId: user.id,
      role:   user.role,
      email:  user.email,
    });
    await prisma.refreshToken.create({
      data: {
        token:     refresh,
        userId:    user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    setRefreshCookie(res, refresh);

    const profile = user.tutorProfile || user.studentProfile;
    res.json({
      access,
      user: { id: user.id, email: user.email, role: user.role, name: profile?.name, profile },
    });
  } catch (e) {
    console.error('Google auth error:', e);
    res.status(400).json({ error: 'Google Login fehlgeschlagen' });
  }
});

// GET /api/auth/me
router.get('/me', auth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where:   { id: req.user.userId },
      include: { tutorProfile: true, studentProfile: true },
    });
    if (!user) return res.status(404).json({ error: 'Nicht gefunden' });
    const profile = user.tutorProfile || user.studentProfile;
    res.json({
      id:      user.id,
      email:   user.email,
      role:    user.role,
      name:    profile?.name,
      profile,
    });
  } catch (e) {
    res.status(500).json({ error: 'Fehler' });
  }
});

module.exports = router;