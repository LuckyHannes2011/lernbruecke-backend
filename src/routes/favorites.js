const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { auth } = require('../middleware/auth');
const router   = express.Router();
const prisma   = new PrismaClient();

router.get('/', auth, async (req, res) => {
  const favs = await prisma.favorite.findMany({
    where: { userId: req.user.userId },
    include: { tutor: { select: { id: true, name: true, subjects: true, location: true, pricePerHour: true, avgRating: true, avatarUrl: true, tags: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(favs.map(f => f.tutor));
});

router.post('/:tutorId', auth, async (req, res) => {
  await prisma.favorite.upsert({ where: { userId_tutorId: { userId: req.user.userId, tutorId: req.params.tutorId } }, create: { userId: req.user.userId, tutorId: req.params.tutorId }, update: {} });
  res.json({ ok: true });
});

router.delete('/:tutorId', auth, async (req, res) => {
  await prisma.favorite.deleteMany({ where: { userId: req.user.userId, tutorId: req.params.tutorId } });
  res.json({ ok: true });
});

module.exports = router;