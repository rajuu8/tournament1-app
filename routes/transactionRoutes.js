const express = require('express');
const Transaction = require('../models/Transaction');
const Settings = require('../models/Settings');
const User = require('../models/User');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const { sendPushNotification } = require('../config/firebase');

const router = express.Router();

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
