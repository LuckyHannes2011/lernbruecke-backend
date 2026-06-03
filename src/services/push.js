const webpush = require('web-push');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

async function sendNotification(userId, title, body, link) {
  await prisma.notification.create({ data: { userId, title, body, link } }).catch(() => {});
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  const payload = JSON.stringify({ title, body, link });
  for (const s of subs) {
    webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload)
      .catch(async (e) => {
        if (e.statusCode === 410)
          await prisma.pushSubscription.deleteMany({ where: { endpoint: s.endpoint } });
      });
  }
}

module.exports = { sendNotification };