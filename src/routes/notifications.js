const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { auth } = require('../middleware/auth');
const router   = express.Router();
const prisma   = new PrismaClient();

router.get('/', auth, async (req, res) => {
  res.json(await prisma.notification.findMany({ where: { userId: req.user.userId }, orderBy: { createdAt: 'desc' }, take: 30 }));
});

router.patch('/:id/read', auth, async (req, res) => {
  await prisma.notification.updateMany({ where: { id: req.params.id, userId: req.user.userId }, data: { read: true } });
  res.json({ ok: true });
});

router.post('/subscribe', auth, async (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth) return res.status(400).json({ error: 'Ungültig' });
  await prisma.pushSubscription.upsert({ where: { endpoint }, create: { userId: req.user.userId, endpoint, p256dh: keys.p256dh, auth: keys.auth }, update: { userId: req.user.userId } });
  res.json({ ok: true });
});

router.get('/vapid-key', (_, res) => res.json({ key: process.env.VAPID_PUBLIC_KEY }));

module.exports = router;