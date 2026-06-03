require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { initSocket } = require('./socket');
const { generalLimiter } = require('./middleware/rateLimiter');

const app = express();
const server = http.createServer(app);
initSocket(server);

app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE'],
  allowedHeaders: ['Content-Type','Authorization'],
}));

app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(generalLimiter);

app.use('/api/auth',          require('./routes/auth'));
app.use('/api/tutors',        require('./routes/tutors'));
app.use('/api/chats',         require('./routes/chats'));
app.use('/api/bookings',      require('./routes/bookings'));
app.use('/api/stripe',        require('./routes/stripe'));
app.use('/api/reviews',       require('./routes/reviews'));
app.use('/api/admin',         require('./routes/admin'));
app.use('/api/favorites',     require('./routes/favorites'));
app.use('/api/notifications', require('./routes/notifications'));

app.get('/health', (_, res) => res.json({ status: 'ok', version: '1.0.0' }));

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Server Error' });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`🚀 LernBrücke API läuft auf Port ${PORT}`));