const express = require('express');
const Tournament = require('../models/Tournament');
const Registration = require('../models/Registration');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const { sendPushToMany } = require('../config/firebase');

const router = express.Router();

// @route   GET /api/tournaments
// @desc    Get all tournaments (players use this) - supports ?game=Free Fire filter
router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.game) filter.game = req.query.game;
    if (req.query.status) filter.status = req.query.status;

    const tournaments = await Tournament.find(filter).sort({ matchDate: 1 });
    res.json(tournaments);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route   GET /api/tournaments/:id
// @desc    Get single tournament details
router.get('/:id', async (req, res) => {
  try {
    const tournament = await Tournament.findById(req.params.id);
    if (!tournament) return res.status(404).json({ message: 'Tournament not found' });
    res.json(tournament);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route   POST /api/tournaments
// @desc    Create a new tournament (admin only)
router.post('/', protect, adminOnly, async (req, res) => {
  try {
    const tournament = await Tournament.create(req.body);
    res.status(201).json(tournament);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route   PUT /api/tournaments/:id
// @desc    Update tournament (admin only) - e.g. release room ID, change status
router.put('/:id', protect, adminOnly, async (req, res) => {
  try {
    const before = await Tournament.findById(req.params.id);
    if (!before) return res.status(404).json({ message: 'Tournament not found' });

    const tournament = await Tournament.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });

    // If room ID was just released (was empty, now has a value), notify all registered players
    const roomJustReleased = !before.roomId && tournament.roomId;
    if (roomJustReleased) {
      const regs = await Registration.find({ tournament: tournament._id }).populate('user', 'fcmToken');
      const tokens = regs.map(r => r.user?.fcmToken).filter(Boolean);
      sendPushToMany(
        tokens,
        '🔑 Room ID Released!',
        `${tournament.title} - Room details are now available. Get ready!`,
        { tournamentId: tournament._id.toString(), type: 'room_released' }
      );
    }

    res.json(tournament);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route   DELETE /api/tournaments/:id
// @desc    Delete a tournament (admin only)
router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    const tournament = await Tournament.findByIdAndDelete(req.params.id);
    if (!tournament) return res.status(404).json({ message: 'Tournament not found' });
    res.json({ message: 'Tournament deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
