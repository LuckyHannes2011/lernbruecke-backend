const express = require('express');
const { PrismaClient }    = require('@prisma/client');
const { auth, adminOnly } = require('../middleware/auth');
const router = express.Router();
const prisma = new PrismaClient();

router.use(auth, adminOnly);

router.get('/stats', async (_, res) => {
  const [users, tutors, students, bookings, revenue] = await Promise.all([
    prisma.user.count(),
    prisma.tutorProfile.count(),
    prisma.studentProfile.count(),
    prisma.booking.count(),
    prisma.booking.aggregate({ where: { status: { in: ['CONFIRMED','COMPLETED'] } }, _sum: { platformFee: true } }),
  ]);
  res.json({ users, tutors, students, bookings, revenue: revenue._sum.platformFee || 0 });
});

router.get('/users', async (req, res) => {
  const { page=1, limit=50, role, q } = req.query;
  const users = await prisma.user.findMany({
    where: { ...(role && { role }), ...(q && { email: { contains: q, mode: 'insensitive' } }) },
    include: { tutorProfile: { select: { name: true, avgRating: true, isActive: true } }, studentProfile: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    skip: (parseInt(page)-1)*parseInt(limit),
    take: parseInt(limit),
  });
  res.json(users);
});

router.get('/bookings', async (req, res) => {
  const { status, page=1, limit=50 } = req.query;
  const bookings = await prisma.booking.findMany({
    where: status ? { status } : {},
    include: { tutor: { select: { name: true } }, student: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    skip: (parseInt(page)-1)*parseInt(limit),
    take: parseInt(limit),
  });
  res.json(bookings);
});

// Tutor deaktivieren / aktivieren
router.patch('/tutors/:id/toggle', async (req, res) => {
  const tutor = await prisma.tutorProfile.findUnique({ where: { id: req.params.id } });
  if (!tutor) return res.status(404).json({ error: 'Nicht gefunden' });
  const updated = await prisma.tutorProfile.update({ where: { id: req.params.id }, data: { isActive: !tutor.isActive } });
  res.json({ isActive: updated.isActive });
});

router.delete('/users/:id', async (req, res) => {
  await prisma.user.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

module.exports = router;