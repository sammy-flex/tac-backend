// routes/admin.js
const express = require('express');
const router = express.Router();
const { User, SystemSettings, AuditLog, Participant } = require('../models');
const { protect, adminOnly, logAction } = require('../middleware/auth');

router.use(protect, adminOnly);

// ==================== GET SYSTEM STATUS ====================
router.get('/system/status', async (req, res) => {
  try {
    const setting = await SystemSettings.findOne({ key: 'system_locked' });
    const locked = setting?.value === true;
    res.json({
      success: true,
      locked,
      lockedAt: setting?.updatedAt,
      lockedBy: setting?.updatedByName,
      note: setting?.note || ''
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to get system status.' });
  }
});

// ==================== LOCK SYSTEM ====================
router.post('/system/lock', async (req, res) => {
  try {
    const { note } = req.body;
    await SystemSettings.findOneAndUpdate(
      { key: 'system_locked' },
      {
        key: 'system_locked',
        value: true,
        updatedBy: req.user._id,
        updatedByName: req.user.name,
        updatedAt: new Date(),
        note: note || 'System locked by administrator.'
      },
      { upsert: true, new: true }
    );
    await logAction('SYSTEM_LOCKED', req, { details: { note } });
    res.json({ success: true, message: '🔒 System locked. No new registrations will be accepted from officers.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to lock system.' });
  }
});

// ==================== UNLOCK SYSTEM ====================
router.post('/system/unlock', async (req, res) => {
  try {
    await SystemSettings.findOneAndUpdate(
      { key: 'system_locked' },
      {
        key: 'system_locked',
        value: false,
        updatedBy: req.user._id,
        updatedByName: req.user.name,
        updatedAt: new Date(),
        note: 'System unlocked by administrator.'
      },
      { upsert: true, new: true }
    );
    await logAction('SYSTEM_UNLOCKED', req, {});
    res.json({ success: true, message: '🔓 System unlocked. Officers can now register participants.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to unlock system.' });
  }
});

// ==================== GET ALL USERS ====================
router.get('/users', async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch users.' });
  }
});

// ==================== TOGGLE USER ACTIVE ====================
router.patch('/users/:id/toggle', async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ success: false, message: 'You cannot deactivate your own account.' });
    }
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    user.isActive = !user.isActive;
    await user.save({ validateBeforeSave: false });
    await logAction(user.isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED', req, { targetName: user.name });
    res.json({ success: true, message: `${user.name} has been ${user.isActive ? 'activated' : 'deactivated'}.`, user: user.toSafeObject() });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update user.' });
  }
});

// ==================== DELETE USER ====================
router.delete('/users/:id', async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ success: false, message: 'You cannot delete your own account.' });
    }
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    await logAction('USER_DELETED', req, { targetName: user.name });
    res.json({ success: true, message: `${user.name} deleted.` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete user.' });
  }
});

// ==================== AUDIT LOG ====================
router.get('/audit', async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [logs, total] = await Promise.all([
      AuditLog.find().sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
      AuditLog.countDocuments()
    ]);
    res.json({ success: true, total, logs });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch audit logs.' });
  }
});

// ==================== SMS BROADCAST (Admin only) ====================
// Resend SMS to all participants where smsSent = false
router.post('/sms/retry-failed', async (req, res) => {
  try {
    const { sendRegistrationSMS } = require('../services/smsService');
    const failed = await Participant.find({ smsSent: false });
    let successCount = 0;
    let failCount = 0;
    for (const p of failed) {
      try {
        const phone = p.contactNumber || p.contactMobile;
        await sendRegistrationSMS(phone, p.name);
        p.smsSent = true;
        p.smsError = null;
        await p.save();
        successCount++;
      } catch {
        failCount++;
      }
    }
    await logAction('SMS_BATCH_RETRY', req, { details: { successCount, failCount } });
    res.json({ success: true, message: `SMS retry complete. Sent: ${successCount}, Failed: ${failCount}` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Batch SMS retry failed.' });
  }
});

module.exports = router;

// ── FINANCE ACCESS CODE management ──────────────────────
// Generate a new finance access code
router.post('/finance/generate-code', async (req, res) => {
  try {
    const { SystemSettings } = require('../models');
    const { note } = req.body;
    // Generate a code like FIN-XXXX-XXXX
    const rand = () => Math.random().toString(36).substr(2,4).toUpperCase();
    const code = `FIN-${rand()}-${rand()}`;
    await SystemSettings.findOneAndUpdate(
      { key: 'finance_access_code' },
      {
        key: 'finance_access_code',
        value: code,
        updatedBy: req.user._id,
        updatedByName: req.user.name,
        updatedAt: new Date(),
        note: note || 'Finance access code generated by admin'
      },
      { upsert: true, new: true }
    );
    await logAction('FINANCE_CODE_GENERATED', req, { details: { note } });
    res.json({ success: true, code, message: 'Finance access code generated. Share this code only with authorised finance personnel.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to generate code.' });
  }
});

// Get current finance access code
router.get('/finance/code', async (req, res) => {
  try {
    const { SystemSettings } = require('../models');
    const setting = await SystemSettings.findOne({ key: 'finance_access_code' });
    res.json({
      success: true,
      code: setting?.value || null,
      generatedAt: setting?.updatedAt || null,
      generatedBy: setting?.updatedByName || null
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to get finance code.' });
  }
});

// Revoke finance access code
router.delete('/finance/code', async (req, res) => {
  try {
    const { SystemSettings } = require('../models');
    await SystemSettings.findOneAndUpdate(
      { key: 'finance_access_code' },
      { value: null, updatedBy: req.user._id, updatedByName: req.user.name, updatedAt: new Date(), note: 'Code revoked' },
      { upsert: true }
    );
    await logAction('FINANCE_CODE_REVOKED', req, {});
    res.json({ success: true, message: 'Finance access code revoked. New registrations with old code will be rejected.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to revoke code.' });
  }
});
