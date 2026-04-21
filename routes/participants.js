// routes/participants.js
const express = require('express');
const router  = express.Router();
const { Participant } = require('../models');
const { sendRegistrationSMS } = require('../services/smsService');
const { protect, adminOnly, checkSystemLock, logAction } = require('../middleware/auth');

// ─────────────────────────────────────────────────────────────────
// PUBLIC ROUTES — no login required
// These must be declared BEFORE router.use(protect)
// ─────────────────────────────────────────────────────────────────

// PUBLIC: Total count for landing page live counter
// Returns only the total number — no participant details exposed
router.get('/public/count', async (req, res) => {
  try {
    const total = await Participant.countDocuments();
    res.json({ success: true, total });
  } catch (err) {
    res.status(500).json({ success: false, total: 0 });
  }
});

// ─────────────────────────────────────────────────────────────────
// PROTECTED ROUTES — login required for everything below
// ─────────────────────────────────────────────────────────────────
router.use(protect);

// ==================== GET ALL PARTICIPANTS ====================
router.get('/', async (req, res) => {
  try {
    const { search, area, category, gender, status, page = 1, limit = 100 } = req.query;
    const filter = {};
    if (search) filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { contactNumber: { $regex: search, $options: 'i' } },
      { contactMobile: { $regex: search, $options: 'i' } }
    ];
    if (area) filter.adminArea = area;
    if (category) filter.category = category;
    if (gender) filter.gender = gender;
    if (status) filter.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [participants, total] = await Promise.all([
      Participant.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)).populate('registeredBy', 'name email'),
      Participant.countDocuments(filter)
    ]);
    res.json({ success: true, total, page: parseInt(page), participants });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch participants.' });
  }
});

// ==================== REGISTER PARTICIPANT ====================
router.post('/', checkSystemLock, async (req, res) => {
  try {
    const { name, gender, adminArea, district, category, status, language,
            contactNumber, contactName, contactLocation, contactMobile, declarationAgreed } = req.body;

    if (!name || !gender || !adminArea || !category || !status || !contactName || !contactLocation || !contactMobile) {
      return res.status(400).json({ success: false, message: 'Please fill all required fields.' });
    }
    if (!declarationAgreed) {
      return res.status(400).json({ success: false, message: 'Participant must agree to the declaration.' });
    }

    // ── DUPLICATE CHECK ──────────────────────────────────────────
    const existing = await Participant.findOne({
      $or: [
        { name: { $regex: `^${name.trim()}$`, $options: 'i' }, contactMobile },
        ...(contactNumber ? [{ contactNumber }] : [])
      ]
    });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: `A participant named "${existing.name}" with this contact number already exists. Possible duplicate.`
      });
    }

    // Create record
    const participant = await Participant.create({
      name: name.trim(), gender, adminArea, district, category, status, language,
      contactNumber, contactName: contactName.trim(), contactLocation: contactLocation.trim(),
      contactMobile, declarationAgreed,
      registeredBy: req.user._id,
      registeredByName: req.user.name
    });

    // Send SMS
    const phoneToSMS = contactNumber || contactMobile;
    let smsSent = false, smsError = null;
    try {
      await sendRegistrationSMS(phoneToSMS, name);
      smsSent = true;
    } catch (smsErr) {
      smsError = smsErr.message;
      console.error('[SMS Error]', smsErr.message);
    }
    participant.smsSent = smsSent;
    participant.smsError = smsError;
    await participant.save();

    await logAction('PARTICIPANT_REGISTERED', req, { targetId: participant._id, targetName: name });

    res.status(201).json({
      success: true,
      message: `${name} registered successfully.${smsSent ? ' SMS sent!' : ' (SMS failed — will retry)'}`,
      participant,
      smsSent
    });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ success: false, message: 'Duplicate entry detected.' });
    console.error('[Register]', err);
    res.status(500).json({ success: false, message: 'Registration failed. Please try again.' });
  }
});

// ==================== UPDATE PARTICIPANT (Admin only) ====================
router.put('/:id', adminOnly, async (req, res) => {
  try {
    const participant = await Participant.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedAt: new Date() },
      { new: true, runValidators: true }
    );
    if (!participant) return res.status(404).json({ success: false, message: 'Participant not found.' });
    await logAction('PARTICIPANT_UPDATED', req, { targetId: req.params.id, targetName: participant.name });
    res.json({ success: true, message: 'Participant updated.', participant });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Update failed.' });
  }
});

// ==================== DELETE PARTICIPANT (Admin only) ====================
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    const participant = await Participant.findByIdAndDelete(req.params.id);
    if (!participant) return res.status(404).json({ success: false, message: 'Participant not found.' });
    await logAction('PARTICIPANT_DELETED', req, { targetId: req.params.id, targetName: participant.name });
    res.json({ success: true, message: `${participant.name} deleted.` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Delete failed.' });
  }
});

// ==================== RESEND SMS (Admin only) ====================
router.post('/:id/resend-sms', adminOnly, async (req, res) => {
  try {
    const participant = await Participant.findById(req.params.id);
    if (!participant) return res.status(404).json({ success: false, message: 'Participant not found.' });
    const phone = participant.contactNumber || participant.contactMobile;
    await sendRegistrationSMS(phone, participant.name);
    participant.smsSent = true;
    participant.smsError = null;
    await participant.save();
    await logAction('SMS_RESENT', req, { targetId: participant._id, targetName: participant.name });
    res.json({ success: true, message: `SMS resent to ${phone}` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'SMS resend failed: ' + err.message });
  }
});

// ==================== ANALYTICS (login required) ====================
router.get('/analytics/summary', async (req, res) => {
  try {
    const [total, byGender, byArea, byCategory, byStatus, byLanguage, todayCount] = await Promise.all([
      Participant.countDocuments(),
      Participant.aggregate([{ $group: { _id: '$gender', count: { $sum: 1 } } }]),
      Participant.aggregate([{ $group: { _id: '$adminArea', count: { $sum: 1 } } }]),
      Participant.aggregate([{ $group: { _id: '$category', count: { $sum: 1 } } }]),
      Participant.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Participant.aggregate([{ $group: { _id: '$language', count: { $sum: 1 } } }]),
      Participant.countDocuments({ createdAt: { $gte: new Date(new Date().setHours(0,0,0,0)) } })
    ]);
    res.json({ success: true, analytics: { total, todayCount, byGender, byArea, byCategory, byStatus, byLanguage } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load analytics.' });
  }
});

// ==================== EXPORT CSV (Admin only) ====================
router.get('/export/csv', adminOnly, async (req, res) => {
  try {
    const participants = await Participant.find().sort({ createdAt: -1 });
    const headers = ['ID','Name','Gender','Admin Area','District','Category','Status','Language',
                     'Contact Number','Contact Name','Contact Location','Contact Mobile',
                     'SMS Sent','Registered By','Registered At'];
    const rows = participants.map(p => [
      p._id, p.name, p.gender, p.adminArea, p.district || '', p.category, p.status,
      p.language || '', p.contactNumber || '', p.contactName, p.contactLocation,
      p.contactMobile, p.smsSent ? 'Yes' : 'No', p.registeredByName,
      new Date(p.createdAt).toLocaleString('en-GH', { timeZone: 'Africa/Accra' })
    ]);
    const csv = [headers, ...rows].map(r =>
      r.map(v => `"${(v || '').toString().replace(/"/g, '""')}"`).join(',')
    ).join('\n');
    const filename = `TAC_Camp_${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await logAction('EXPORT_CSV', req, { details: { count: participants.length } });
    res.send(csv);
  } catch (err) {
    res.status(500).json({ success: false, message: 'Export failed.' });
  }
});


// ── BULK REGISTRATION ─────────────────────────────────────
// Accepts array of participants, validates each, skips duplicates
router.post('/bulk', async (req, res) => {
  try {
    const { participants } = req.body;
    if (!Array.isArray(participants) || participants.length === 0) {
      return res.status(400).json({ success: false, message: 'Provide an array of participants.' });
    }
    if (participants.length > 500) {
      return res.status(400).json({ success: false, message: 'Maximum 500 participants per bulk upload.' });
    }

    const results = { saved: 0, duplicates: [], errors: [] };

    for (const p of participants) {
      try {
        const { name, gender, adminArea, category, status, contactName, contactLocation, contactMobile } = p;
        // Basic validation
        if (!name || !gender || !adminArea || !category || !status || !contactName || !contactLocation || !contactMobile) {
          results.errors.push({ name: name || 'Unknown', reason: 'Missing required fields' });
          continue;
        }
        // Duplicate check
        const existing = await Participant.findOne({
          $or: [
            { name: { $regex: `^${name.trim()}$`, $options: 'i' }, contactMobile },
            ...(p.contactNumber ? [{ contactNumber: p.contactNumber }] : [])
          ]
        });
        if (existing) {
          results.duplicates.push({ name: name.trim(), reason: 'Already registered' });
          continue;
        }
        await Participant.create({
          name: name.trim(), gender, adminArea,
          district: p.district || '', category, status,
          language: p.language || 'English',
          contactNumber: p.contactNumber || '',
          contactName: contactName.trim(),
          contactLocation: contactLocation.trim(),
          contactMobile,
          declarationAgreed: true,
          bulkImport: true,
          smsSent: false,
          registeredBy: req.user._id,
          registeredByName: req.user.name
        });
        results.saved++;
      } catch (err) {
        if (err.code === 11000) {
          results.duplicates.push({ name: p.name || 'Unknown', reason: 'Duplicate detected' });
        } else {
          results.errors.push({ name: p.name || 'Unknown', reason: err.message });
        }
      }
    }

    await logAction('BULK_REGISTRATION', req, {
      details: { saved: results.saved, duplicates: results.duplicates.length, errors: results.errors.length }
    });

    res.status(201).json({
      success: true,
      message: `Bulk registration complete. Saved: ${results.saved}, Duplicates skipped: ${results.duplicates.length}, Errors: ${results.errors.length}`,
      results
    });
  } catch (err) {
    console.error('[Bulk Register]', err);
    res.status(500).json({ success: false, message: 'Bulk registration failed.' });
  }
});

module.exports = router;
