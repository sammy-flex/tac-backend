// middleware/auth.js
const jwt = require('jsonwebtoken');
const { User, AuditLog, SystemSettings } = require('../models');

// ==================== VERIFY JWT TOKEN ====================
const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Not authenticated. Please sign in.' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    if (!user) return res.status(401).json({ success: false, message: 'User no longer exists.' });
    if (!user.isActive) return res.status(403).json({ success: false, message: 'Account has been deactivated.' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired session. Please sign in again.' });
  }
};

// ==================== ADMIN ONLY ====================
const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Access denied. Admins only.' });
  }
  next();
};

// ==================== CHECK SYSTEM LOCK ====================
const checkSystemLock = async (req, res, next) => {
  try {
    // Admins can always bypass the lock
    if (req.user?.role === 'admin') return next();
    const setting = await SystemSettings.findOne({ key: 'system_locked' });
    if (setting?.value === true) {
      return res.status(423).json({
        success: false,
        message: 'The registration system is currently locked. No new submissions are being accepted.',
        locked: true
      });
    }
    next();
  } catch (err) {
    next();
  }
};

// ==================== AUDIT LOGGER ====================
const logAction = async (action, req, extra = {}) => {
  try {
    await AuditLog.create({
      action,
      performedBy: req.user?._id,
      performedByName: req.user?.name,
      performedByRole: req.user?.role,
      ip: req.ip || req.connection?.remoteAddress,
      ...extra
    });
  } catch (e) {
    console.error('[Audit]', e.message);
  }
};

// ==================== SIGN JWT ====================
const signToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });
};

module.exports = { protect, adminOnly, checkSystemLock, logAction, signToken };
