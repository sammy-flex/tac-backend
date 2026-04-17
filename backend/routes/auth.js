// routes/auth.js — FIXED OTP FLOW
const express   = require('express');
const router    = express.Router();
const rateLimit = require('express-rate-limit');
const { User, OTP } = require('../models');
const { sendOTP }   = require('../services/smsService');
const { signToken, protect, logAction } = require('../middleware/auth');

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message: { success: false, message: 'Too many OTP requests. Try again in 15 minutes.' }
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20,
  message: { success: false, message: 'Too many login attempts. Try again in 15 minutes.' }
});

function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// ─── SEND OTP ─────────────────────────────────────────────
router.post('/send-otp', otpLimiter, async (req, res) => {
  try {
    const { phone, purpose } = req.body;
    if (!phone) return res.status(400).json({ success: false, message: 'Phone number is required.' });
    if (!['signup', 'reset', 'verify'].includes(purpose)) {
      return res.status(400).json({ success: false, message: 'Invalid OTP purpose.' });
    }
    if (purpose === 'signup') {
      const existing = await User.findOne({ phone });
      if (existing) return res.status(409).json({ success: false, message: 'Phone number already registered.' });
    }
    if (purpose === 'reset') {
      const user = await User.findOne({ phone });
      if (!user) return res.status(404).json({ success: false, message: 'No account found with this phone number.' });
    }

    await OTP.deleteMany({ phone, purpose });
    const code = generateOTP();
    const expiresAt = new Date(Date.now() + (parseInt(process.env.OTP_EXPIRES_MINUTES) || 10) * 60 * 1000);
    await OTP.create({ phone, code, purpose, expiresAt });
    await sendOTP(phone, code);

    const isDev = process.env.NODE_ENV !== 'production';
    res.json({
      success: true,
      message: `OTP sent to ${phone}`,
      ...(isDev && { devOtp: code, devNote: 'OTP shown here in development mode only — remove in production' })
    });
  } catch (err) {
    console.error('[OTP Send]', err.message);
    res.status(500).json({ success: false, message: 'Failed to send OTP. Check phone number and try again.' });
  }
});

// ─── VERIFY OTP ───────────────────────────────────────────
// KEY FIX: This only validates — does NOT mark OTP as used.
// The OTP is consumed (used=true) at the final signup or reset step.
// This was the bug — verifying marked it used, then signup failed finding it "expired".
router.post('/verify-otp', async (req, res) => {
  try {
    const { phone, code, purpose } = req.body;
    if (!phone || !code || !purpose) {
      return res.status(400).json({ success: false, message: 'Phone, code and purpose are required.' });
    }
    const otp = await OTP.findOne({ phone, purpose, used: false, expiresAt: { $gt: new Date() } });
    if (!otp) {
      return res.status(400).json({ success: false, message: 'OTP has expired or not found. Please request a new one.' });
    }
    if (otp.code !== code) {
      return res.status(400).json({ success: false, message: 'Incorrect OTP. Please check and try again.' });
    }
    // ✅ Correct — validated but NOT consumed here
    res.json({ success: true, message: 'OTP verified successfully.' });
  } catch (err) {
    console.error('[OTP Verify]', err.message);
    res.status(500).json({ success: false, message: 'Verification failed. Please try again.' });
  }
});

// ─── SIGN UP ──────────────────────────────────────────────
router.post('/signup', async (req, res) => {
  try {
    const { name, sex, email, phone, password, otpCode } = req.body;
    if (!name || !sex || !email || !phone || !password || !otpCode) {
      return res.status(400).json({ success: false, message: 'All fields are required.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
    }

    const existing = await User.findOne({ $or: [{ email: email.toLowerCase() }, { phone }] });
    if (existing) return res.status(409).json({ success: false, message: 'Email or phone number already registered.' });

    // Consume OTP at signup time
    const otp = await OTP.findOne({ phone, purpose: 'signup', used: false, expiresAt: { $gt: new Date() } });
    if (!otp || otp.code !== otpCode) {
      return res.status(400).json({
        success: false,
        message: 'OTP is invalid or expired. Please go back and request a new OTP.'
      });
    }

    const newUser = await User.create({
      name: name.trim(), sex,
      email: email.toLowerCase().trim(),
      phone: phone.trim(),
      password, role: 'officer',
      phoneVerified: true, isActive: true
    });

    otp.used = true;
    await otp.save();

    const token = signToken(newUser._id);
    await logAction('USER_SIGNUP', req, { targetName: name });
    res.status(201).json({ success: true, token, user: newUser.toSafeObject() });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ success: false, message: 'Email or phone already registered.' });
    console.error('[Signup]', err);
    res.status(500).json({ success: false, message: 'Registration failed. Please try again.' });
  }
});

// ─── LOGIN ────────────────────────────────────────────────
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { emailOrPhone, password } = req.body;
    if (!emailOrPhone || !password) {
      return res.status(400).json({ success: false, message: 'Email/phone and password are required.' });
    }
    const user = await User.findOne({
      $or: [{ email: emailOrPhone.toLowerCase() }, { phone: emailOrPhone }]
    });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ success: false, message: 'Invalid credentials. Please check and try again.' });
    }
    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'Account deactivated. Contact the administrator.' });
    }
    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });
    const token = signToken(user._id);
    await logAction('USER_LOGIN', req, { targetName: user.name });
    res.json({ success: true, token, user: user.toSafeObject() });
  } catch (err) {
    console.error('[Login]', err);
    res.status(500).json({ success: false, message: 'Login failed. Please try again.' });
  }
});

// ─── RESET PASSWORD ───────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { phone, otpCode, newPassword } = req.body;
    if (!phone || !otpCode || !newPassword) {
      return res.status(400).json({ success: false, message: 'All fields are required.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
    }
    const otp = await OTP.findOne({ phone, purpose: 'reset', used: false, expiresAt: { $gt: new Date() } });
    if (!otp || otp.code !== otpCode) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP.' });
    }
    const user = await User.findOne({ phone });
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    user.password = newPassword;
    await user.save();
    otp.used = true;
    await otp.save();
    res.json({ success: true, message: 'Password reset successfully. Please sign in with your new password.' });
  } catch (err) {
    console.error('[Reset Password]', err);
    res.status(500).json({ success: false, message: 'Password reset failed. Please try again.' });
  }
});

// ─── CHANGE PASSWORD (logged-in admin/officer) ────────────
router.post('/change-password', protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Current and new passwords are required.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'New password must be at least 8 characters.' });
    }
    const user = await User.findById(req.user._id);
    if (!(await user.comparePassword(currentPassword))) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
    }
    if (currentPassword === newPassword) {
      return res.status(400).json({ success: false, message: 'New password must be different from your current one.' });
    }
    user.password = newPassword;
    await user.save();
    await logAction('PASSWORD_CHANGED', req, { targetName: user.name });
    res.json({ success: true, message: 'Password changed successfully.' });
  } catch (err) {
    console.error('[Change Password]', err);
    res.status(500).json({ success: false, message: 'Password change failed.' });
  }
});

// ─── GET ME ───────────────────────────────────────────────
router.get('/me', protect, async (req, res) => {
  res.json({ success: true, user: req.user.toSafeObject() });
});

module.exports = router;
