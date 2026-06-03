const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || 587),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

async function sendEmail(to, subject, html) {
  try {
    await transporter.sendMail({ from: process.env.EMAIL_FROM, to, subject, html });
  } catch (e) {
    console.error('E-Mail Fehler:', e.message);
  }
}

module.exports = { sendEmail };