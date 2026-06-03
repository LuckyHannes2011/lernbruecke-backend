const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { auth } = require('../middleware/auth');
const router   = express.Router();
const prisma   = new PrismaClient();

router.post('/', auth, async (req, res) => {
  if (req.user.role !== 'STUDENT') return res.status(403).json({ error: 'Nur Schüler können bewerten' });
  const { bookingId, rating, comment } = req.body;
  if (!bookingId || !rating || rating < 1 || rating > 5)
    return res.status(400).json({ error: 'Ungültige Bewertung' });

  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: { student: true, review: true } });
  if (!booking || booking.student.userId !== req.user.userId) return res.status(403).json({ error: 'Kein Zugriff' });
  if (booking.status !== 'COMPLETED') return res.status(400).json({ error: 'Stunde noch nicht abgeschlossen' });
  if (booking.review) return res.status(409).json({ error: 'Bereits bewertet' });

  const review = await prisma.review.create({ data: { bookingId, tutorId: booking.tutorId, studentId: booking.studentId, rating, comment } });

  const agg = await prisma.review.aggregate({ where: { tutorId: booking.tutorId }, _avg: { rating: true }, _count: { rating: true } });
  await prisma.tutorProfile.update({ where: { id: booking.tutorId }, data: { avgRating: agg._avg.rating || 0, reviewCount: agg._count.rating } });

  res.status(201).json(review);
});

router.patch('/:id/reply', auth, async (req, res) => {
  const review = await prisma.review.findUnique({ where: { id: req.params.id }, include: { tutor: true } });
  if (!review || review.tutor.userId !== req.user.userId) return res.status(403).json({ error: 'Kein Zugriff' });
  res.json(await prisma.review.update({ where: { id: req.params.id }, data: { reply: req.body.reply } }));
});

router.get('/tutor/:tutorId', async (req, res) => {
  const reviews = await prisma.review.findMany({
    where: { tutorId: req.params.tutorId },
    include: { student: { select: { name: true, avatarUrl: true } } },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  res.json(reviews);
});

module.exports = router;