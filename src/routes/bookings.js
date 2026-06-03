const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { auth }      = require('../middleware/auth');
const { sendEmail } = require('../services/email');
const router = express.Router();
const prisma = new PrismaClient();

router.get('/', auth, async (req, res) => {
  const { role, userId } = req.user;
  const where = role === 'TUTOR' ? { tutor: { userId } } : { student: { userId } };
  const bookings = await prisma.booking.findMany({
    where,
    include: { tutor: { select: { name: true, avatarUrl: true, pricePerHour: true } }, student: { select: { name: true, avatarUrl: true } }, review: true },
    orderBy: { scheduledAt: 'desc' },
  });
  res.json(bookings);
});

router.post('/', auth, async (req, res) => {
  if (req.user.role === 'TUTOR') return res.status(403).json({ error: 'Tutoren können nicht buchen' });
  const { tutorId, subject, scheduledAt, durationMinutes = 60, notes } = req.body;
  if (!tutorId || !subject || !scheduledAt) return res.status(400).json({ error: 'Fehlende Felder' });

  try {
    const tutor   = await prisma.tutorProfile.findUnique({ where: { id: tutorId } });
    if (!tutor || !tutor.isActive) return res.status(400).json({ error: 'Tutor nicht verfügbar' });

    const student = await prisma.studentProfile.findUnique({ where: { userId: req.user.userId } });
    if (!student) return res.status(400).json({ error: 'Kein Schülerprofil gefunden' });

    const priceTotal  = (tutor.pricePerHour * durationMinutes) / 60;
    const commPct     = parseFloat(process.env.STRIPE_COMMISSION_PERCENT || 12) / 100;
    const platformFee = parseFloat((priceTotal * commPct).toFixed(2));
    const tutorPayout = parseFloat((priceTotal - platformFee).toFixed(2));

    const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const booking = await prisma.booking.create({
      data: { tutorId, studentId: student.id, subject, notes, scheduledAt: new Date(scheduledAt), durationMinutes, priceTotal, platformFee, tutorPayout, status: 'PENDING_PAYMENT' },
    });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: { name: `Nachhilfe: ${subject} mit ${tutor.name}`, description: `${durationMinutes} Minuten am ${new Date(scheduledAt).toLocaleDateString('de')}` },
          unit_amount: Math.round(priceTotal * 100),
        },
        quantity: 1,
      }],
      metadata: { bookingId: booking.id },
      success_url: `${process.env.FRONTEND_URL}/booking-success?bookingId=${booking.id}`,
      cancel_url:  `${process.env.FRONTEND_URL}/booking-cancel?bookingId=${booking.id}`,
    });

    await prisma.booking.update({ where: { id: booking.id }, data: { stripeSessionId: session.id } });
    res.json({ checkoutUrl: session.url, bookingId: booking.id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Buchung fehlgeschlagen' });
  }
});

router.patch('/:id/complete', auth, async (req, res) => {
  const booking = await prisma.booking.findUnique({
    where: { id: req.params.id },
    include: { tutor: true, student: { include: { user: true } } },
  });
  if (!booking || booking.tutor.userId !== req.user.userId) return res.status(403).json({ error: 'Kein Zugriff' });
  if (booking.status !== 'CONFIRMED') return res.status(400).json({ error: 'Nur bestätigte Buchungen abschließbar' });

  await prisma.booking.update({ where: { id: booking.id }, data: { status: 'COMPLETED' } });

  if (booking.tutor.stripeAccountId && booking.tutor.stripeOnboarded) {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    await stripe.transfers.create({
      amount: Math.round(booking.tutorPayout * 100),
      currency: 'eur',
      destination: booking.tutor.stripeAccountId,
      transfer_group: booking.id,
    }).catch(console.error);
    await prisma.tutorProfile.update({ where: { id: booking.tutorId }, data: { totalEarnings: { increment: booking.tutorPayout } } });
  }

  sendEmail(booking.student.user.email, 'Stunde abgeschlossen – jetzt bewerten!',
    `<h2>Wie war deine Nachhilfestunde?</h2><p>Bewerte deine Stunde bei <strong>${booking.tutor.name}</strong>.</p><p><a href="${process.env.FRONTEND_URL}/profile?tab=bookings">Jetzt bewerten</a></p>`);

  res.json({ status: 'COMPLETED' });
});

router.delete('/:id', auth, async (req, res) => {
  const booking = await prisma.booking.findUnique({ where: { id: req.params.id }, include: { student: true } });
  if (!booking || booking.student.userId !== req.user.userId) return res.status(403).json({ error: 'Kein Zugriff' });
  if (!['PENDING_PAYMENT','CONFIRMED'].includes(booking.status)) return res.status(400).json({ error: 'Nicht mehr stornierbar' });
  await prisma.booking.update({ where: { id: booking.id }, data: { status: 'CANCELLED' } });
  res.json({ ok: true });
});

module.exports = router;