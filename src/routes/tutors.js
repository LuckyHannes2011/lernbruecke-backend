const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { auth, tutorOnly } = require('../middleware/auth');
const { uploadAvatar }    = require('../middleware/upload');
const { uploadLimiter }   = require('../middleware/rateLimiter');
const router = express.Router();
const prisma = new PrismaClient();

const SEL = {
  id:true, name:true, bio:true, subjects:true, levels:true, location:true,
  pricePerHour:true, avatarUrl:true, tags:true, avgRating:true, reviewCount:true,
  isActive:true, createdAt:true, user: { select: { id: true } },
};

// GET /api/tutors
router.get('/', async (req, res) => {
  const { subject, level, location, minPrice, maxPrice, q, page=1, limit=20 } = req.query;
  try {
    const where = {
      isActive: true,
      ...(subject  && { subjects: { has: subject } }),
      ...(level    && { levels:   { has: level } }),
      ...(location && { location }),
      ...(minPrice && { pricePerHour: { gte: parseFloat(minPrice) } }),
      ...(maxPrice && { pricePerHour: { lte: parseFloat(maxPrice) } }),
    };

    let tutors = await prisma.tutorProfile.findMany({
      where,
      select: SEL,
      orderBy: [{ avgRating: 'desc' }, { reviewCount: 'desc' }],
      skip: (parseInt(page) - 1) * parseInt(limit),
      take: parseInt(limit),
    });

    if (q) {
      const ql = q.toLowerCase();
      tutors = tutors.filter(t =>
        t.name.toLowerCase().includes(ql) ||
        t.bio?.toLowerCase().includes(ql) ||
        t.subjects.some(s => s.toLowerCase().includes(ql)) ||
        t.tags.some(t => t.toLowerCase().includes(ql))
      );
    }

    const total = await prisma.tutorProfile.count({ where });
    res.json({ tutors, total, pages: Math.ceil(total / parseInt(limit)) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Fehler beim Laden der Tutoren' });
  }
});

// GET /api/tutors/:id
router.get('/:id', async (req, res) => {
  const tutor = await prisma.tutorProfile.findUnique({
    where: { id: req.params.id },
    include: {
      availability: true,
      reviews: {
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { student: { select: { name: true, avatarUrl: true } } },
      },
    },
  });
  if (!tutor) return res.status(404).json({ error: 'Nicht gefunden' });
  res.json(tutor);
});

// PATCH /api/tutors/me
router.patch('/me', auth, tutorOnly, async (req, res) => {
  const { name, bio, subjects, levels, location, pricePerHour, tags, availability } = req.body;
  try {
    const tutor = await prisma.tutorProfile.update({
      where: { userId: req.user.userId },
      data: {
        ...(name         !== undefined && { name }),
        ...(bio          !== undefined && { bio }),
        ...(subjects     !== undefined && { subjects }),
        ...(levels       !== undefined && { levels }),
        ...(location     !== undefined && { location }),
        ...(pricePerHour !== undefined && { pricePerHour: parseFloat(pricePerHour) }),
        ...(tags         !== undefined && { tags }),
      },
    });

    if (availability) {
      await prisma.availability.deleteMany({ where: { tutorId: tutor.id } });
      await prisma.availability.createMany({
        data: availability.map(a => ({ tutorId: tutor.id, dayOfWeek: a.dayOfWeek, startTime: a.startTime, endTime: a.endTime })),
      });
    }
    res.json(tutor);
  } catch (e) {
    res.status(500).json({ error: 'Update fehlgeschlagen' });
  }
});

// POST /api/tutors/me/avatar
router.post('/me/avatar', auth, tutorOnly, uploadLimiter, uploadAvatar.single('avatar'), async (req, res) => {
  if (!req.file?.path) return res.status(400).json({ error: 'Kein Bild hochgeladen' });
  const tutor = await prisma.tutorProfile.update({ where: { userId: req.user.userId }, data: { avatarUrl: req.file.path } });
  res.json({ avatarUrl: tutor.avatarUrl });
});

module.exports = router;