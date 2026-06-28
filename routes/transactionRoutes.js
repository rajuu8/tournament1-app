const express = require('express');
const Transaction = require('../models/Transaction');
const Settings = require('../models/Settings');
const User = require('../models/User');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const { sendPushNotification, sendPushToMany } = require('../config/firebase');

const router = express.Router();

// Notifies all admins and support-admins who have push tokens registered
async function notifyAdmins(title, body, data = {}) {
  const admins = await User.find({
    role: { $in: ['admin', 'support-admin'] },
    fcmToken: { $ne: '' },
  }).select('fcmToken');
  const tokens = admins.map(a => a.fcmToken).filter(Boolean);
  sendPushToMany(tokens, title, body, data);
}

/* ===================== SETTINGS (eSewa number) ===================== */

// @route   GET /api/transactions/settings/esewa
// @desc    Public - get the admin's eSewa number to show on deposit screen
router.get('/settings/esewa', async (req, res) => {
  try {
    const setting = await Settings.findOne({ key: 'esewaNumber' });
    res.json({ esewaNumber: setting ? setting.value : '' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route   PUT /api/transactions/settings/esewa
// @desc    Admin only - update the eSewa number shown to players
router.put('/settings/esewa', protect, adminOnly, async (req, res) => {
  try {
    const { esewaNumber } = req.body;
    const setting = await Settings.findOneAndUpdate(
      { key: 'esewaNumber' },
      { value: esewaNumber },
      { upsert: true, new: true }
    );
    res.json({ esewaNumber: setting.value });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route   GET /api/transactions/settings/min-withdrawal
// @desc    Public - get the minimum withdrawal amount to show on withdraw screen
router.get('/settings/min-withdrawal', async (req, res) => {
  try {
    const setting = await Settings.findOne({ key: 'minWithdrawal' });
    res.json({ minWithdrawal: setting ? Number(setting.value) || 50 : 50 });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route   PUT /api/transactions/settings/min-withdrawal
// @desc    Admin only - update the minimum withdrawal amount
router.put('/settings/min-withdrawal', protect, adminOnly, async (req, res) => {
  try {
    const { minWithdrawal } = req.body;
    const setting = await Settings.findOneAndUpdate(
      { key: 'minWithdrawal' },
      { value: String(minWithdrawal) },
      { upsert: true, new: true }
    );
    res.json({ minWithdrawal: Number(setting.value) });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

/* ===================== DEPOSIT ===================== */

// @route   POST /api/transactions/deposit
// @desc    Player submits a deposit request with proof
router.post('/deposit', protect, async (req, res) => {
  try {
    const { amount, senderEsewaNumber, transactionId } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Enter a valid amount' });
    }
    if (!transactionId) {
      return res.status(400).json({ message: 'Transaction ID is required' });
    }

    const txn = await Transaction.create({
      user: req.user.id,
      type: 'Deposit',
      amount,
      senderEsewaNumber,
      transactionId,
      status: 'Pending',
    });

    const depositor = await User.findById(req.user.id).select('name');
    notifyAdmins(
      '💰 New Deposit Request',
      `${depositor?.name || 'A player'} wants to deposit ₨${amount}. Tap to review.`,
      { type: 'new_deposit', transactionId: txn._id.toString() }
    );

    res.status(201).json(txn);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

/* ===================== WITHDRAWAL ===================== */

// @route   POST /api/transactions/withdraw
// @desc    Player submits a withdrawal request (amount is held immediately)
router.post('/withdraw', protect, async (req, res) => {
  try {
    const { amount, receiverEsewaNumber } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Enter a valid amount' });
    }
    if (!receiverEsewaNumber) {
      return res.status(400).json({ message: 'eSewa number is required' });
    }

    const minSetting = await Settings.findOne({ key: 'minWithdrawal' });
    const minWithdrawal = minSetting ? Number(minSetting.value) || 0 : 50; // default ₨50 if not set
    if (amount < minWithdrawal) {
      return res.status(400).json({ message: `Minimum withdrawal amount is ₨${minWithdrawal}` });
    }

    const user = await User.findById(req.user.id);
    if (user.walletBalance < amount) {
      return res.status(400).json({ message: 'Insufficient wallet balance' });
    }

    // Deduct immediately so user cannot double-spend while request is pending
    user.walletBalance -= amount;
    await user.save();

    const txn = await Transaction.create({
      user: req.user.id,
      type: 'Withdrawal',
      amount,
      receiverEsewaNumber,
      status: 'Pending',
    });

    const withdrawer = await User.findById(req.user.id).select('name');
    notifyAdmins(
      '💸 New Withdrawal Request',
      `${withdrawer?.name || 'A player'} wants to withdraw ₨${amount}. Tap to review.`,
      { type: 'new_withdrawal', transactionId: txn._id.toString() }
    );

    res.status(201).json(txn);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

/* ===================== SHARED ===================== */

// @route   GET /api/transactions/my
// @desc    Player views their own transaction history
router.get('/my', protect, async (req, res) => {
  try {
    const txns = await Transaction.find({ user: req.user.id }).sort({ createdAt: -1 });
    res.json(txns);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route   GET /api/transactions
// @desc    Admin - view all transactions, optional ?status=Pending&type=Deposit filter
router.get('/', protect, adminOnly, async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.type) filter.type = req.query.type;

    const txns = await Transaction.find(filter)
      .populate('user', 'name phone')
      .sort({ createdAt: -1 });
    res.json(txns);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route   PUT /api/transactions/:id/approve
// @desc    Admin approves a deposit (adds to wallet) or withdrawal (just marks paid, already deducted)
router.put('/:id/approve', protect, adminOnly, async (req, res) => {
  try {
    const txn = await Transaction.findById(req.params.id);
    if (!txn) return res.status(404).json({ message: 'Transaction not found' });
    if (txn.status !== 'Pending') {
      return res.status(400).json({ message: 'Transaction already processed' });
    }

    if (txn.type === 'Deposit') {
      await User.findByIdAndUpdate(txn.user, { $inc: { walletBalance: txn.amount } });
    }
    // For withdrawal, amount was already deducted at request time - approval just confirms payment sent

    txn.status = 'Approved';
    txn.adminNote = req.body.adminNote || '';
    await txn.save();

    const user = await User.findById(txn.user);
    if (user?.fcmToken) {
      sendPushNotification(
        user.fcmToken,
        txn.type === 'Deposit' ? '💰 Deposit Approved!' : '💸 Withdrawal Sent!',
        txn.type === 'Deposit'
          ? `₨${txn.amount} has been added to your wallet.`
          : `₨${txn.amount} has been sent to your eSewa.`,
        { type: 'transaction_approved' }
      );
    }

    res.json(txn);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route   PUT /api/transactions/:id/reject
// @desc    Admin rejects a deposit or withdrawal. For withdrawal, refund the held amount.
router.put('/:id/reject', protect, adminOnly, async (req, res) => {
  try {
    const txn = await Transaction.findById(req.params.id);
    if (!txn) return res.status(404).json({ message: 'Transaction not found' });
    if (txn.status !== 'Pending') {
      return res.status(400).json({ message: 'Transaction already processed' });
    }

    if (txn.type === 'Withdrawal') {
      // Refund the held amount back to wallet since it's being rejected
      await User.findByIdAndUpdate(txn.user, { $inc: { walletBalance: txn.amount } });
    }

    txn.status = 'Rejected';
    txn.adminNote = req.body.adminNote || '';
    await txn.save();

    res.json(txn);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
