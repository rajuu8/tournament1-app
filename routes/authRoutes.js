const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Registration = require('../models/Registration');
const { protect, adminOnly } = require('../middleware/authMiddleware');

const router = express.Router();

const generateToken = (user) => {
  return jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });
};

// Generates a short unique referral code based on the user's name + random digits
async function generateReferralCode(name) {
  const base = (name || 'PLAYER').replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 5) || 'PLYR';
  let code, exists = true;
  while (exists) {
    const rand = Math.floor(1000 + Math.random() * 9000);
    code = `${base}${rand}`;
    exists = await User.findOne({ referralCode: code });
  }
  return code;
}

// Returns today's date as YYYY-MM-DD (used for daily login streak tracking)
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// @route   POST /api/auth/register
// @desc    Register a new player
router.post('/register', async (req, res) => {
  try {
    const { name, phone, email, password, gameId, gameUid, referralCode } = req.body;

    if (!name || !phone || !password) {
      return res.status(400).json({ message: 'Name, phone and password are required' });
    }

    const existingUser = await User.findOne({ phone });
    if (existingUser) {
      return res.status(400).json({ message: 'Phone number already registered' });
    }

    // If a referral code was entered, find the referring user
    let referredBy = null;
    if (referralCode && referralCode.trim()) {
      const referrer = await User.findOne({ referralCode: referralCode.trim().toUpperCase() });
      if (referrer) referredBy = referrer._id;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const myReferralCode = await generateReferralCode(name);

    const user = await User.create({
      name,
      phone,
      email,
      password: hashedPassword,
      gameId,
      gameUid,
      role: 'player',
      referralCode: myReferralCode,
      referredBy,
      lastLoginDate: todayStr(),
      loginStreak: 1,
    });

    res.status(201).json({
      token: generateToken(user),
      user: {
        id: user._id,
        name: user.name,
        phone: user.phone,
        role: user.role,
        walletBalance: user.walletBalance,
        referralCode: user.referralCode,
      },
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route   POST /api/auth/login
// @desc    Login for players
router.post('/login', async (req, res) => {
  try {
    const { phone, password } = req.body;

    const user = await User.findOne({ phone });
    if (!user) {
      return res.status(400).json({ message: 'Invalid phone or password' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid phone or password' });
    }

    if (user.isBanned) {
      return res.status(403).json({
        message: `Your account has been banned${user.banReason ? `: ${user.banReason}` : '.'} Contact support if you believe this is a mistake.`,
      });
    }

    // Update daily login streak (only once per calendar day)
    const today = todayStr();
    let dailyBonusAwarded = false;
    let newStreak = user.loginStreak || 0;

    if (user.lastLoginDate !== today) {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      newStreak = user.lastLoginDate === yesterday ? (user.loginStreak || 0) + 1 : 1;

      // Daily bonus: small wallet credit, capped so it stays cheap. Bigger for longer streaks, capped at day 7.
      const bonusAmount = Math.min(newStreak, 7) * 1; // ₨1 per streak day, max ₨7
      user.walletBalance += bonusAmount;
      user.lastLoginDate = today;
      user.loginStreak = newStreak;
      await user.save();
      dailyBonusAwarded = true;
      req._dailyBonusAmount = bonusAmount;
    }

    res.json({
      token: generateToken(user),
      user: {
        id: user._id,
        name: user.name,
        phone: user.phone,
        role: user.role,
        walletBalance: user.walletBalance,
        referralCode: user.referralCode,
        loginStreak: user.loginStreak,
      },
      dailyBonus: dailyBonusAwarded ? { amount: req._dailyBonusAmount, streak: newStreak } : null,
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route   POST /api/auth/admin/register
// @desc    Register admin account (protected by a secret key, run once)
router.post('/admin/register', async (req, res) => {
  try {
    const { name, phone, password, secretKey } = req.body;

    if (secretKey !== process.env.ADMIN_SECRET_KEY) {
      return res.status(403).json({ message: 'Invalid admin secret key' });
    }

    const existingUser = await User.findOne({ phone });
    if (existingUser) {
      return res.status(400).json({ message: 'Phone number already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const admin = await User.create({
      name,
      phone,
      password: hashedPassword,
      role: 'admin',
    });

    res.status(201).json({
      token: generateToken(admin),
      user: { id: admin._id, name: admin.name, phone: admin.phone, role: admin.role },
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route   POST /api/auth/admin/login
// @desc    Login for admin or support-admin
router.post('/admin/login', async (req, res) => {
  try {
    const { phone, password } = req.body;

    const user = await User.findOne({ phone, role: { $in: ['admin', 'support-admin'] } });
    if (!user) {
      return res.status(400).json({ message: 'Invalid admin credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid admin credentials' });
    }

    res.json({
      token: generateToken(user),
      user: { id: user._id, name: user.name, phone: user.phone, role: user.role },
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route   GET /api/auth/me
// @desc    Get fresh logged-in user data (wallet balance, etc.)
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.isBanned) {
      return res.status(403).json({
        message: `Your account has been banned${user.banReason ? `: ${user.banReason}` : '.'} Contact support if you believe this is a mistake.`,
        banned: true,
      });
    }
    res.json({ user });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route   PUT /api/auth/fcm-token
// @desc    Save/update the player's Firebase push notification token
router.put('/fcm-token', protect, async (req, res) => {
  try {
    const { fcmToken } = req.body;
    await User.findByIdAndUpdate(req.user.id, { fcmToken });
    res.json({ message: 'Token saved' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route   POST /api/auth/admin/create-support-admin
// @desc    Main admin creates a limited-permission support-admin (chat access only)
router.post('/admin/create-support-admin', protect, adminOnly, async (req, res) => {
  try {
    const { name, phone, password } = req.body;
    if (!name || !phone || !password) {
      return res.status(400).json({ message: 'Name, phone and password are required' });
    }

    const existingUser = await User.findOne({ phone });
    if (existingUser) {
      return res.status(400).json({ message: 'Phone number already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const supportAdmin = await User.create({
      name,
      phone,
      password: hashedPassword,
      role: 'support-admin',
    });

    res.status(201).json({
      user: { id: supportAdmin._id, name: supportAdmin.name, phone: supportAdmin.phone, role: supportAdmin.role },
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route   GET /api/auth/admin/support-admins
// @desc    Main admin lists all support-admins they've created
router.get('/admin/support-admins', protect, adminOnly, async (req, res) => {
  try {
    const supportAdmins = await User.find({ role: 'support-admin' }).select('name phone createdAt');
    res.json(supportAdmins);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route   DELETE /api/auth/admin/support-admins/:id
// @desc    Main admin removes a support-admin's access
router.delete('/admin/support-admins/:id', protect, adminOnly, async (req, res) => {
  try {
    const deleted = await User.findOneAndDelete({ _id: req.params.id, role: 'support-admin' });
    if (!deleted) return res.status(404).json({ message: 'Support admin not found' });
    res.json({ message: 'Support admin removed' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route   GET /api/auth/my-stats
// @desc    Player's own lifetime stats - total kills, wins, matches, earnings
router.get('/my-stats', protect, async (req, res) => {
  try {
    const stats = await Registration.aggregate([
      { $match: { user: new (require('mongoose').Types.ObjectId)(req.user.id) } },
      {
        $group: {
          _id: null,
          totalMatches: { $sum: 1 },
          totalKills: { $sum: '$kills' },
          totalWins: { $sum: { $cond: [{ $eq: ['$rank', 1] }, 1, 0] } },
          totalEarnings: { $sum: '$prizeWon' },
        },
      },
    ]);
    res.json(stats[0] || { totalMatches: 0, totalKills: 0, totalWins: 0, totalEarnings: 0 });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route   GET /api/auth/admin/players
// @desc    Admin views all players with basic stats, optional ?search=name/phone
router.get('/admin/players', protect, adminOnly, async (req, res) => {
  try {
    const filter = { role: 'player' };
    if (req.query.search) {
      const re = new RegExp(req.query.search, 'i');
      filter.$or = [{ name: re }, { phone: re }];
    }
    const players = await User.find(filter)
      .select('name phone walletBalance isBanned banReason createdAt')
      .sort({ createdAt: -1 })
      .limit(200);
    res.json(players);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route   PUT /api/auth/admin/players/:id/ban
// @desc    Admin bans a player (they will be logged out and blocked on next request)
router.put('/admin/players/:id/ban', protect, adminOnly, async (req, res) => {
  try {
    const { banReason } = req.body;
    const player = await User.findByIdAndUpdate(
      req.params.id,
      { isBanned: true, banReason: banReason || '', bannedAt: new Date() },
      { new: true }
    ).select('name phone isBanned banReason');
    if (!player) return res.status(404).json({ message: 'Player not found' });
    res.json(player);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route   PUT /api/auth/admin/players/:id/unban
// @desc    Admin unbans a player
router.put('/admin/players/:id/unban', protect, adminOnly, async (req, res) => {
  try {
    const player = await User.findByIdAndUpdate(
      req.params.id,
      { isBanned: false, banReason: '', bannedAt: null },
      { new: true }
    ).select('name phone isBanned');
    if (!player) return res.status(404).json({ message: 'Player not found' });
    res.json(player);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
