const express = require('express');
const Registration = require('../models/Registration');
const Tournament = require('../models/Tournament');
const User = require('../models/User');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const { sendPushNotification } = require('../config/firebase');

const router = express.Router();

// @route   POST /api/registrations/join/:tournamentId
// @desc    Player joins a tournament (free or paid)
router.post('/join/:tournamentId', protect, async (req, res) => {
  try {
    const tournament = await Tournament.findById(req.params.tournamentId);
    if (!tournament) return res.status(404).json({ message: 'Tournament not found' });

    if (tournament.filledSlots >= tournament.maxSlots) {
      return res.status(400).json({ message: 'Tournament is full' });
    }

    const { teamName, paymentMethod, transactionId } = req.body;

    const existing = await Registration.findOne({
      tournament: tournament._id,
      user: req.user.id,
    });
    if (existing) {
      return res.status(400).json({ message: 'Already registered for this tournament' });
    }

    // If this is a paid tournament, deduct the entry fee from the player's wallet
    if (tournament.mode === 'Paid' && tournament.entryFee > 0) {
      const user = await User.findById(req.user.id);
      if (user.walletBalance < tournament.entryFee) {
        return res.status(400).json({ message: 'Insufficient wallet balance. Please deposit first.' });
      }
      user.walletBalance -= tournament.entryFee;
      await user.save();
    }

    const registration = await Registration.create({
      tournament: tournament._id,
      user: req.user.id,
      teamName,
      paymentMethod: tournament.mode === 'Paid' ? 'eSewa' : 'None',
      transactionId: tournament.mode === 'Paid' ? transactionId : '',
      paymentStatus: tournament.mode === 'Paid' ? 'Verified' : 'Not Required',
    });

    tournament.filledSlots += 1;
    await tournament.save();

    // Referral bonus: if this user was referred and this is their FIRST tournament ever, reward both sides
    const user = await User.findById(req.user.id);
    if (user.referredBy && !user.referralBonusCredited) {
      const totalJoins = await Registration.countDocuments({ user: req.user.id });
      if (totalJoins === 1) { // this join we just created is their first
        const REFERRAL_BONUS = 10; // ₨10 each side
        user.walletBalance += REFERRAL_BONUS;
        user.referralBonusCredited = true;
        await user.save();
        const referrer = await User.findByIdAndUpdate(user.referredBy, {
          $inc: { walletBalance: REFERRAL_BONUS, referralCount: 1 },
        });

        if (user.fcmToken) {
          sendPushNotification(user.fcmToken, '🎁 Referral Bonus!', `You earned ₨${REFERRAL_BONUS} for joining your first tournament!`, { type: 'referral_bonus' });
        }
        if (referrer?.fcmToken) {
          sendPushNotification(referrer.fcmToken, '🎁 Referral Bonus!', `Your friend joined a tournament! You earned ₨${REFERRAL_BONUS}.`, { type: 'referral_bonus' });
        }
      }
    }

    res.status(201).json(registration);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: 'Already registered for this tournament' });
    }
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route   GET /api/registrations/tournament/:tournamentId
// @desc    Get all registrations + leaderboard for a tournament
router.get('/tournament/:tournamentId', async (req, res) => {
  try {
    const registrations = await Registration.find({ tournament: req.params.tournamentId })
      .populate('user', 'name gameId gameUid')
      .sort({ points: -1, kills: -1 });
    res.json(registrations);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route   GET /api/registrations/my
// @desc    Get logged-in player's own registrations (match history)
router.get('/my', protect, async (req, res) => {
  try {
    const registrations = await Registration.find({ user: req.user.id })
      .populate('tournament')
      .sort({ createdAt: -1 });
    res.json(registrations);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route   PUT /api/registrations/:id/result
// @desc    Admin updates kills/rank/points/prize for a registration. Prize auto-credits to wallet once.
router.put('/:id/result', protect, adminOnly, async (req, res) => {
  try {
    const { kills, rank, points, prizeWon } = req.body;
    const before = await Registration.findById(req.params.id);
    if (!before) return res.status(404).json({ message: 'Registration not found' });

    const newPrize = Number(prizeWon) || 0;
    const alreadyPaid = before.prizeStatus === 'Paid';

    const registration = await Registration.findByIdAndUpdate(
      req.params.id,
      {
        kills, rank, points,
        prizeWon: newPrize,
        prizeStatus: newPrize > 0 ? 'Paid' : 'Pending',
      },
      { new: true }
    );

    // Auto-credit wallet the first time a prize amount is set (avoids double-paying on edits)
    if (!alreadyPaid && newPrize > 0) {
      await User.findByIdAndUpdate(registration.user, { $inc: { walletBalance: newPrize } });
      const winner = await User.findById(registration.user);
      if (winner?.fcmToken) {
        sendPushNotification(winner.fcmToken, '🏆 Prize Won!', `Congratulations! ₨${newPrize} has been added to your wallet.`, { type: 'prize_credited' });
      }
    } else if (alreadyPaid && newPrize !== before.prizeWon) {
      // Admin corrected the amount after it was already paid - adjust the difference
      const diff = newPrize - before.prizeWon;
      await User.findByIdAndUpdate(registration.user, { $inc: { walletBalance: diff } });
    }

    res.json(registration);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route   PUT /api/registrations/:id/payment
// @desc    Admin verifies or rejects a payment for paid tournaments
router.put('/:id/payment', protect, adminOnly, async (req, res) => {
  try {
    const { paymentStatus } = req.body; // 'Verified' or 'Rejected'
    const registration = await Registration.findByIdAndUpdate(
      req.params.id,
      { paymentStatus },
      { new: true }
    );
    if (!registration) return res.status(404).json({ message: 'Registration not found' });
    res.json(registration);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route   GET /api/registrations/leaderboard/global
// @desc    Public - lifetime earnings leaderboard across all tournaments
router.get('/leaderboard/global', async (req, res) => {
  try {
    const leaderboard = await Registration.aggregate([
      { $match: { prizeWon: { $gt: 0 } } },
      {
        $group: {
          _id: '$user',
          totalEarnings: { $sum: '$prizeWon' },
          wins: { $sum: { $cond: [{ $eq: ['$rank', 1] }, 1, 0] } },
          tournamentsPlayed: { $sum: 1 },
        },
      },
      { $sort: { totalEarnings: -1 } },
      { $limit: 50 },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user',
        },
      },
      { $unwind: '$user' },
      {
        $project: {
          name: '$user.name',
          gameId: '$user.gameId',
          totalEarnings: 1,
          wins: 1,
          tournamentsPlayed: 1,
        },
      },
    ]);
    res.json(leaderboard);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
