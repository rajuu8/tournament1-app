const express = require('express');
const multer = require('multer');
const Tournament = require('../models/Tournament');
const Registration = require('../models/Registration');
const User = require('../models/User');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const { sendPushToMany } = require('../config/firebase');
const { uploadImage } = require('../config/cloudinary');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const router = express.Router();

// @route   GET /api/tournaments
// @desc    Get all tournaments (players use this) - supports ?game=Free Fire filter
//          Archived tournaments are hidden by default; pass ?includeArchived=true to see them (admin use)
router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.game) filter.game = req.query.game;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.includeArchived !== 'true') filter.isArchived = { $ne: true };

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
// @desc    Create a new tournament (admin only) - notifies all players
router.post('/', protect, adminOnly, async (req, res) => {
  try {
    const tournament = await Tournament.create(req.body);

    // Notify all players (not admins) that a new tournament is live
    const players = await User.find({ role: 'player', fcmToken: { $ne: '' } }).select('fcmToken');
    const tokens = players.map(p => p.fcmToken).filter(Boolean);
    sendPushToMany(
      tokens,
      '🔥 New Tournament Alert!',
      `${tournament.title} (${tournament.game}) - ₨${tournament.prizePool} prize pool! Slots filling fast.`,
      { tournamentId: tournament._id.toString(), type: 'new_tournament' }
    );

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

// @route   POST /api/tournaments/:id/banner
// @desc    Admin uploads/replaces a tournament's banner image
router.post('/:id/banner', protect, adminOnly, upload.single('banner'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No image file provided' });
    const url = await uploadImage(req.file.buffer, 'clashking-banners');
    const tournament = await Tournament.findByIdAndUpdate(
      req.params.id,
      { bannerImage: url },
      { new: true }
    );
    if (!tournament) return res.status(404).json({ message: 'Tournament not found' });
    res.json(tournament);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route   PUT /api/tournaments/:id/archive
// @desc    Admin archives or unarchives a tournament (hides it from the main list without deleting it)
router.put('/:id/archive', protect, adminOnly, async (req, res) => {
  try {
    const { isArchived } = req.body; // true to archive, false to restore
    const tournament = await Tournament.findByIdAndUpdate(
      req.params.id,
      { isArchived: !!isArchived },
      { new: true }
    );
    if (!tournament) return res.status(404).json({ message: 'Tournament not found' });
    res.json(tournament);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route   POST /api/tournaments/archive-old
// @desc    Admin bulk-archives all Completed/Cancelled tournaments older than 7 days, decluttering the list
router.post('/archive-old', protect, adminOnly, async (req, res) => {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const result = await Tournament.updateMany(
      { status: { $in: ['Completed', 'Cancelled'] }, matchDate: { $lt: sevenDaysAgo }, isArchived: { $ne: true } },
      { isArchived: true }
    );
    res.json({ message: `Archived ${result.modifiedCount} old tournaments` });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route   GET /api/tournaments/cron/match-reminders
// @desc    Sends a reminder push to registered players ~20 minutes before their match starts.
//          Designed to be triggered every 5-10 minutes by a free external cron service (e.g. cron-job.org).
//          Protected by the same CRON_SECRET used for the inactivity reminder job.
router.get('/cron/match-reminders', async (req, res) => {
  try {
    if (req.query.key !== process.env.CRON_SECRET) {
      return res.status(403).json({ message: 'Invalid cron key' });
    }

    const now = new Date();
    const windowStart = new Date(now.getTime() + 15 * 60 * 1000); // 15 min from now
    const windowEnd = new Date(now.getTime() + 25 * 60 * 1000); // 25 min from now

    const upcomingTournaments = await Tournament.find({
      matchDate: { $gte: windowStart, $lte: windowEnd },
      status: 'Upcoming',
      reminderSent: { $ne: true },
    });

    let notified = 0;
    for (const tournament of upcomingTournaments) {
      const regs = await Registration.find({ tournament: tournament._id }).populate('user', 'fcmToken');
      const tokens = regs.map(r => r.user?.fcmToken).filter(Boolean);
      if (tokens.length > 0) {
        sendPushToMany(
          tokens,
          '⏰ Match Starting Soon!',
          `${tournament.title} starts in ~20 minutes. Get your room ID ready!`,
          { tournamentId: tournament._id.toString(), type: 'match_reminder' }
        );
        notified += tokens.length;
      }
      tournament.reminderSent = true;
      await tournament.save();
    }

    res.json({ message: `Sent reminders for ${upcomingTournaments.length} tournaments to ${notified} players` });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route   GET /api/tournaments/analytics/summary
// @desc    Admin dashboard - high-level business stats
router.get('/analytics/summary', protect, adminOnly, async (req, res) => {
  try {
    const Transaction = require('../models/Transaction');

    const [totalPlayers, totalTournaments, liveTournaments, totalRegistrations] = await Promise.all([
      User.countDocuments({ role: 'player' }),
      Tournament.countDocuments({}),
      Tournament.countDocuments({ status: 'Live' }),
      Registration.countDocuments({}),
    ]);

    const depositAgg = await Transaction.aggregate([
      { $match: { type: 'Deposit', status: 'Approved' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const withdrawalAgg = await Transaction.aggregate([
      { $match: { type: 'Withdrawal', status: 'Approved' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const prizeAgg = await Registration.aggregate([
      { $match: { prizeWon: { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: '$prizeWon' } } },
    ]);
    const entryFeeAgg = await Tournament.aggregate([
      { $match: { mode: 'Paid' } },
      { $group: { _id: null, total: { $sum: { $multiply: ['$entryFee', '$filledSlots'] } } } },
    ]);

    res.json({
      totalPlayers,
      totalTournaments,
      liveTournaments,
      totalRegistrations,
      totalDeposited: depositAgg[0]?.total || 0,
      totalWithdrawn: withdrawalAgg[0]?.total || 0,
      totalPrizesPaid: prizeAgg[0]?.total || 0,
      totalEntryFeesCollected: entryFeeAgg[0]?.total || 0,
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
