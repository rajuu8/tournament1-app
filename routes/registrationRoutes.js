const express = require('express');
const Registration = require('../models/Registration');
const Tournament = require('../models/Tournament');
const { protect, adminOnly } = require('../middleware/authMiddleware');

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

    const registration = await Registration.create({
      tournament: tournament._id,
      user: req.user.id,
      teamName,
      paymentMethod: tournament.mode === 'Paid' ? paymentMethod : 'None',
      transactionId: tournament.mode === 'Paid' ? transactionId : '',
      paymentStatus: tournament.mode === 'Paid' ? 'Pending' : 'Not Required',
    });

    tournament.filledSlots += 1;
    await tournament.save();

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
// @desc    Admin updates kills/rank/points/prize for a registration
router.put('/:id/result', protect, adminOnly, async (req, res) => {
  try {
    const { kills, rank, points, prizeWon, prizeStatus } = req.body;
    const registration = await Registration.findByIdAndUpdate(
      req.params.id,
      { kills, rank, points, prizeWon, prizeStatus },
      { new: true }
    );
    if (!registration) return res.status(404).json({ message: 'Registration not found' });
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

module.exports = router;
