const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { auth }        = require('../middleware/auth');
const { uploadFile }  = require('../middleware/upload');
const { uploadLimiter } = require('../middleware/rateLimiter');
const router = express.Router();
const prisma = new PrismaClient();

router.get('/', auth, async (req, res) => {
  const convs = await prisma.conversation.findMany({
    where: { participants: { some: { userId: req.user.userId } } },
    include: {
      participants: { include: { user: { select: { id: true, tutorProfile: { select: { name: true, avatarUrl: true } }, studentProfile: { select: { name: true, avatarUrl: true } } } } } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
    orderBy: { updatedAt: 'desc' },
  });
  res.json(convs);
});

router.post('/', auth, async (req, res) => {
  const { tutorUserId } = req.body;
  if (!tutorUserId || tutorUserId === req.user.userId)
    return res.status(400).json({ error: 'Ungültige Anfrage' });
  try {
    const existing = await prisma.conversation.findFirst({
      where: { AND: [{ participants: { some: { userId: req.user.userId } } }, { participants: { some: { userId: tutorUserId } } }] },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (existing) return res.json(existing);
    const conv = await prisma.conversation.create({
      data: { participants: { create: [{ userId: req.user.userId }, { userId: tutorUserId }] } },
      include: { messages: true },
    });
    res.status(201).json(conv);
  } catch { res.status(500).json({ error: 'Fehler beim Erstellen des Chats' }); }
});

router.get('/:id/messages', auth, async (req, res) => {
  const part = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId: req.params.id, userId: req.user.userId } },
  });
  if (!part) return res.status(403).json({ error: 'Kein Zugriff' });
  const { cursor, limit = 50 } = req.query;
  const messages = await prisma.message.findMany({
    where: { conversationId: req.params.id, ...(cursor && { createdAt: { lt: new Date(cursor) } }) },
    include: { sender: { select: { id: true, tutorProfile: { select: { name: true, avatarUrl: true } }, studentProfile: { select: { name: true, avatarUrl: true } } } } },
    orderBy: { createdAt: 'desc' },
    take: parseInt(limit),
  });
  res.json(messages.reverse());
});

router.post('/:id/upload', auth, uploadLimiter, uploadFile.single('file'), async (req, res) => {
  const part = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId: req.params.id, userId: req.user.userId } },
  });
  if (!part || !req.file) return res.status(403).json({ error: 'Fehler' });
  const msg = await prisma.message.create({
    data: { conversationId: req.params.id, senderId: req.user.userId, fileUrl: req.file.path, fileType: req.file.mimetype },
    include: { sender: { select: { id: true, tutorProfile: { select: { name: true } }, studentProfile: { select: { name: true } } } } },
  });
  const { getIO } = require('../socket');
  getIO()?.to(req.params.id).emit('new_message', msg);
  res.json(msg);
});

module.exports = router;