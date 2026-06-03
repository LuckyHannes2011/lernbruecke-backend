const express = require('express');
const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { PrismaClient } = require('@prisma/client');
const { auth, tutorOnly } = require('../middleware/auth');
const { sendEmail }       = require('../services/email');
const router = express.Router();
const prisma = new PrismaClient();

router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session   = event.data.object;
    const bookingId = session.metadata?.bookingId;
    if (!bookingId) return res.sendStatus(200);

    const booking = await prisma.booking.update({
      where: { id: bookingId },
      data: { status: 'CONFIRMED', stripePaymentId: session.payment_intent },
      include: { tutor: true, student: { include: { user: true } } },
    });

    const tutorUser = await prisma.user.findUnique({ where: { id: booking.tutor.userId } });
    sendEmail(tutorUser.email, '🎉 Neue Buchung bei dir!',
      `<h2>Neue Nachhilfestunde gebucht</h2><p>Fach: <strong>${booking.subject}</strong><br>Zeit: ${new Date(booking.scheduledAt).toLocaleString('de')}<br>Du erhältst: <strong>${booking.tutorPayout}€</strong></p>`);
    sendEmail(booking.student.user.email, '✅ Buchung bestätigt!',
      `<h2>Deine Buchung ist bestätigt!</h2><p>Nachhilfe in <strong>${booking.subject}</strong> bei <strong>${booking.tutor.name}</strong><br>Am: ${new Date(booking.scheduledAt).toLocaleString('de')}</p>`);
  }

  res.sendStatus(200);
});

router.post('/connect/onboard', auth, tutorOnly, async (req, res) => {
  try {
    const tutor = await prisma.tutorProfile.findUnique({ where: { userId: req.user.userId } });
    let accountId = tutor.stripeAccountId;

    if (!accountId) {
      const acc = await stripe.accounts.create({ type: 'express', country: 'DE', email: req.user.email, capabilities: { transfers: { requested: true } } });
      accountId = acc.id;
      await prisma.tutorProfile.update({ where: { id: tutor.id }, data: { stripeAccountId: accountId } });
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${process.env.FRONTEND_URL}/profile`,
      return_url:  `${process.env.FRONTEND_URL}/profile?stripe=success`,
      type: 'account_onboarding',
    });
    res.json({ url: link.url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Stripe Connect Fehler' });
  }
});

router.get('/connect/status', auth, tutorOnly, async (req, res) => {
  const tutor = await prisma.tutorProfile.findUnique({ where: { userId: req.user.userId } });
  if (!tutor.stripeAccountId) return res.json({ onboarded: false });
  const acc = await stripe.accounts.retrieve(tutor.stripeAccountId);
  if (acc.details_submitted !== tutor.stripeOnboarded)
    await prisma.tutorProfile.update({ where: { id: tutor.id }, data: { stripeOnboarded: acc.details_submitted } });
  res.json({ onboarded: acc.details_submitted });
});

router.get('/connect/dashboard', auth, tutorOnly, async (req, res) => {
  const tutor = await prisma.tutorProfile.findUnique({ where: { userId: req.user.userId } });
  if (!tutor.stripeAccountId) return res.status(400).json({ error: 'Kein Stripe-Konto verbunden' });
  const link = await stripe.accounts.createLoginLink(tutor.stripeAccountId);
  res.json({ url: link.url });
});

module.exports = router;