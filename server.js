// server.js — TAC Youth Camp 2026 | LOCAL VERSION
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const mongoSanitize = require('express-mongo-sanitize');
const rateLimit = require('express-rate-limit');

const app = express();

// ── SECURITY ──────────────────────────────────────────────
app.use(helmet());
app.use(mongoSanitize());
app.set('trust proxy', 1);

// CORS — allow both localhost:3000 and localhost:5173 (Vite default)
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173',
    process.env.FRONTEND_URL
  ].filter(Boolean),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']
}));

// Rate limiting (relaxed for local testing)
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000 }));

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(morgan('dev'));

// ── DATABASE ──────────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('✅  MongoDB connected successfully');
    await seedAdminAccount();
  })
  .catch(err => {
    console.error('\n❌  MongoDB connection FAILED:', err.message);
    console.error('👉  Check your MONGODB_URI in backend/.env\n');
    process.exit(1);
  });

// ── SEED ADMIN (first run only) ───────────────────────────
async function seedAdminAccount() {
  try {
    const { User } = require('./models');
    const existing = await User.findOne({ role: 'admin' });
    if (existing) {
      console.log(`✅  Admin account ready: ${existing.email}`);
      return;
    }
    const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME, ADMIN_PHONE } = process.env;
    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
      console.warn('⚠️   No admin credentials in .env — skipping seed.');
      return;
    }
    await User.create({
      name: ADMIN_NAME || 'Administrator',
      sex: 'Male',
      email: ADMIN_EMAIL.toLowerCase(),
      phone: ADMIN_PHONE || '+233000000000',
      password: ADMIN_PASSWORD,
      role: 'admin',
      phoneVerified: true,
      isActive: true
    });
    console.log(`✅  Admin account created: ${ADMIN_EMAIL}`);
  } catch (err) {
    if (err.code === 11000) console.log('✅  Admin already exists.');
    else console.error('❌  Admin seed error:', err.message);
  }
}

// ── ROUTES ────────────────────────────────────────────────
app.use('/api/auth',         require('./routes/auth'));
app.use('/api/participants', require('./routes/participants'));
app.use('/api/admin',        require('./routes/admin'));
app.use('/api/finance',      require('./routes/finance'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'online',
    environment: 'local',
    smsMode: process.env.SMS_TEST_MODE === 'true' ? 'TEST (console only)' : 'LIVE',
    time: new Date().toISOString()
  });
});

// ── ERROR HANDLER ─────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  res.status(err.status || 500).json({ success: false, message: err.message });
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found.' });
});

// ── START ─────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log('\n' + '='.repeat(55));
  console.log('🚀  TAC Youth Camp 2026 — LOCAL SERVER RUNNING');
  console.log('='.repeat(55));
  console.log(`📡  API:      http://localhost:${PORT}/api`);
  console.log(`🔍  Health:   http://localhost:${PORT}/api/health`);
  console.log(`📲  SMS Mode: ${process.env.SMS_TEST_MODE === 'true' ? '🟡 TEST (logged to console)' : '🟢 LIVE (real SMS)'}`);
  console.log(`👤  Admin:    ${process.env.ADMIN_EMAIL}`);
  console.log('='.repeat(55));
  console.log('💡  Open a new terminal and run: cd frontend && npm run dev');
  console.log('='.repeat(55) + '\n');
});

module.exports = app;
