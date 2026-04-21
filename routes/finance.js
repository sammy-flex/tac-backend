// routes/finance.js
const express = require('express');
const router  = express.Router();
const { Transaction, SystemSettings } = require('../models');
const { protect, logAction } = require('../middleware/auth');

// Finance + admin can access all finance routes
const financeGuard = (req, res, next) => {
  if (req.user?.role === 'admin' || req.user?.role === 'finance') return next();
  return res.status(403).json({ success: false, message: 'Access denied. Finance personnel only.' });
};

router.use(protect, financeGuard);

// ── INCOME CATEGORIES ────────────────────────────────────
const INCOME_CATS = [
  'Thanksgiving Offering',
  'Appeal for Funds',
  'Donations',
  'Sponsorships',
  'Offertory',
  'Others',
];

// ── EXPENDITURE CATEGORIES ───────────────────────────────
const EXPENDITURE_CATS = [
  'Honorarium',
  'Facility Costs',
  'Payments to Subcommittee',
  'Others',
];

const SUBCOMMITTEES = [
  'Food Committee',
  'Music Committee',
  'Registration, Media and Publicity Committee',
  'Health Committee',
  'Security Committee',
  'Organizing Committee',
  'AGD Committee',
  'Ushering and Protocol Committee',
];

// ── GET CATEGORIES (for frontend dropdowns) ──────────────
router.get('/categories', (req, res) => {
  res.json({ success: true, INCOME_CATS, EXPENDITURE_CATS, SUBCOMMITTEES });
});

// ── RECORD TRANSACTION ───────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { type, date, category, subCategory, description, amount, area, reference } = req.body;
    if (!type || !date || !category || !description || amount === undefined) {
      return res.status(400).json({ success: false, message: 'Type, date, category, description and amount are required.' });
    }
    if (isNaN(amount) || Number(amount) < 0) {
      return res.status(400).json({ success: false, message: 'Amount must be a valid positive number.' });
    }
    // Validate categories
    if (type === 'income' && !INCOME_CATS.includes(category)) {
      return res.status(400).json({ success: false, message: 'Invalid income category.' });
    }
    if (type === 'expenditure' && !EXPENDITURE_CATS.includes(category)) {
      return res.status(400).json({ success: false, message: 'Invalid expenditure category.' });
    }
    // Subcommittee required if category is Payments to Subcommittee
    if (category === 'Payments to Subcommittee' && !subCategory) {
      return res.status(400).json({ success: false, message: 'Please select a subcommittee.' });
    }

    const tx = await Transaction.create({
      type, date: new Date(date), category, subCategory: subCategory || null,
      description: description.trim(), amount: Number(amount),
      area: area || null, reference: reference || null,
      recordedBy: req.user._id, recordedByName: req.user.name,
    });

    await logAction(`FINANCE_${type.toUpperCase()}_RECORDED`, req, {
      targetName: `${category} — GHS ${Number(amount).toFixed(2)}`,
      details: { amount, category, date }
    });

    res.status(201).json({ success: true, message: `${type === 'income' ? 'Income' : 'Expenditure'} of GHS ${Number(amount).toFixed(2)} recorded successfully.`, transaction: tx });
  } catch (err) {
    console.error('[Finance]', err);
    res.status(500).json({ success: false, message: 'Failed to record transaction.' });
  }
});

// ── GET ALL TRANSACTIONS (with filters) ──────────────────
router.get('/', async (req, res) => {
  try {
    const { type, category, startDate, endDate, page = 1, limit = 200 } = req.query;
    const filter = {};
    if (type) filter.type = type;
    if (category) filter.category = category;
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.date.$lte = end;
      }
    }
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [transactions, total] = await Promise.all([
      Transaction.find(filter).sort({ date: -1, createdAt: -1 }).skip(skip).limit(parseInt(limit)),
      Transaction.countDocuments(filter)
    ]);
    res.json({ success: true, total, transactions });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch transactions.' });
  }
});

// ── FINANCIAL SUMMARY ────────────────────────────────────
router.get('/summary', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const matchFilter = {};
    if (startDate || endDate) {
      matchFilter.date = {};
      if (startDate) matchFilter.date.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        matchFilter.date.$lte = end;
      }
    }

    const [totals, byCategory, byDate] = await Promise.all([
      // Total income and expenditure
      Transaction.aggregate([
        { $match: matchFilter },
        { $group: { _id: '$type', total: { $sum: '$amount' }, count: { $sum: 1 } } }
      ]),
      // Breakdown by category
      Transaction.aggregate([
        { $match: matchFilter },
        { $group: { _id: { type: '$type', category: '$category' }, total: { $sum: '$amount' }, count: { $sum: 1 } } },
        { $sort: { '_id.type': 1, total: -1 } }
      ]),
      // Daily totals
      Transaction.aggregate([
        { $match: matchFilter },
        { $group: {
          _id: {
            type: '$type',
            date: { $dateToString: { format: '%Y-%m-%d', date: '$date' } }
          },
          total: { $sum: '$amount' }
        }},
        { $sort: { '_id.date': 1 } }
      ])
    ]);

    const totalIncome      = totals.find(t => t._id === 'income')?.total      || 0;
    const totalExpenditure = totals.find(t => t._id === 'expenditure')?.total  || 0;
    const balance          = totalIncome - totalExpenditure;

    res.json({
      success: true,
      summary: { totalIncome, totalExpenditure, balance, byCategory, byDate }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to generate summary.' });
  }
});

// ── DELETE TRANSACTION (admin only) ──────────────────────
router.delete('/:id', async (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Only admin can delete transactions.' });
  }
  try {
    const tx = await Transaction.findByIdAndDelete(req.params.id);
    if (!tx) return res.status(404).json({ success: false, message: 'Transaction not found.' });
    await logAction('FINANCE_TRANSACTION_DELETED', req, { targetName: `${tx.category} GHS ${tx.amount}` });
    res.json({ success: true, message: 'Transaction deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Delete failed.' });
  }
});

module.exports = router;
