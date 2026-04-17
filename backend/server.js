// server.js - TAC Youth Camp 2026 Backend
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const mongoSanitize = require('express-mongo-sanitize');
const rateLimit = require('express-rate-limit');

const app = express();

// ==================== SECURITY MIDDLEWARE ====================
app.use(helmet());
app.use(mongoSanitize());
app.set('trust proxy', 1);

// CORS
app.use(cors({
  origin: [
    process.env.FRONTEND_URL,
    'http://localhost:3000',
    'http://localhost:5173'
  ].filter(Boolean),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']
}));

// Rate limiting
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { success: false, message: 'Too many requests. Please try again later.' }
});
app.use(globalLimiter);

// Body parsing
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Logging
if (process.env.NODE_ENV !== 'production') app.use(morgan('dev'));

// ==================== DATABASE ====================
mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('✅ MongoDB connected');
    await seedAdminAccount();
  })
  .catch(err => {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
  });

// ==================== SEED ADMIN (First-time only) ====================
async function seedAdminAccount() {
  try {
    const { User } = require('./models');
    const existing = await User.findOne({ role: 'admin' });
    if (existing) {
      console.log(`✅ Admin account exists: ${existing.email}`);
      return;
    }
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;
    const adminName = process.env.ADMIN_NAME;
    const adminPhone = process.env.ADMIN_PHONE;
    if (!adminEmail || !adminPassword || !adminName || !adminPhone) {
      console.warn('⚠️  ADMIN credentials not set in .env — skipping admin seed.');
      return;
    }
    await User.create({
      name: adminName,
      sex: 'Male',
      email: adminEmail.toLowerCase(),
      phone: adminPhone,
      password: adminPassword,
      role: 'admin',
      phoneVerified: true,
      isActive: true
    });
    console.log(`✅ Admin account created: ${adminEmail}`);
    console.log('⚠️  IMPORTANT: Delete ADMIN_EMAIL, ADMIN_PASSWORD from .env after first deployment!');
  } catch (err) {
    if (err.code === 11000) {
      console.log('✅ Admin account already exists.');
    } else {
      console.error('❌ Admin seed failed:', err.message);
    }
  }
}

// ==================== ROUTES ====================
app.use('/api/auth', require('./routes/auth'));
app.use('/api/participants', require('./routes/participants'));
app.use('/api/admin', require('./routes/admin'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'online',
    service: 'TAC Youth Camp 2026 API',
    time: new Date().toISOString()
  });
});

// ==================== ERROR HANDLER ====================
app.use((err, req, res, next) => {
  console.error('[Server Error]', err);
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production'
      ? 'Something went wrong. Please try again.'
      : err.message
  });
});

// 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found.' });
});

// ==================== START ====================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 TAC Camp API running on port ${PORT}`);
  console.log(`📡 Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
