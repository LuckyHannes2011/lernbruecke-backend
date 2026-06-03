const { Server } = require('socket.io');
const { verifyAccess } = require('./utils/jwt');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
let io;

function initSocket(server) {
  io = new Server(server, {
    cors: { origin: process.env.FRONTEND_URL, credentials: true },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('No token'));
    try { socket.user = verifyAccess(token); next(); }
    catch { next(new Error('Invalid token')); }
  });

  io.on('connection', (socket) => {
    socket.join(`user_${socket.user.userId}`);

    socket.on('join', (convId) => socket.join(convId));

    socket.on('send_message', async ({ conversationId, text, fileUrl, fileType }) => {
      try {
        const part = await prisma.conversationParticipant.findUnique({
          where: { conversationId_userId: { conversationId, userId: socket.user.userId } },
        });
        if (!part) return;

        const msg = await prisma.message.create({
          data: { conversationId, senderId: socket.user.userId, text, fileUrl, fileType },
          include: {
            sender: {
              select: {
                id: true,
                tutorProfile: { select: { name: true, avatarUrl: true } },
                studentProfile: { select: { name: true, avatarUrl: true } },
              },
            },
          },
        });

        await prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
        io.to(conversationId).emit('new_message', msg);

        // Benachrichtigung für andere Teilnehmer
        const others = await prisma.conversationParticipant.findMany({
          where: { conversationId, NOT: { userId: socket.user.userId } },
          include: { user: true },
        });
        const { sendNotification } = require('./services/push');
        const { sendEmail }        = require('./services/email');
        for (const p of others) {
          sendNotification(p.userId, 'Neue Nachricht', text || '📎 Datei', '/messages');
          const activeSockets = await io.in(`user_${p.userId}`).fetchSockets();
          if (activeSockets.length === 0) {
            sendEmail(p.user.email, 'Neue Nachricht auf LernBrücke',
              `<p>Du hast eine neue Nachricht erhalten. <a href="${process.env.FRONTEND_URL}/messages">Jetzt lesen</a></p>`);
          }
        }
      } catch (e) { console.error('Socket-Fehler:', e.message); }
    });

    socket.on('typing', ({ conversationId }) => {
      socket.to(conversationId).emit('typing', { userId: socket.user.userId });
    });
  });

  return io;
}

function getIO() { return io; }
module.exports = { initSocket, getIO };