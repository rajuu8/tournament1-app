const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, unique: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    password: { type: String, required: true },
    gameId: { type: String, trim: true }, // Free Fire / PUBG in-game ID
    gameUid: { type: String, trim: true }, // in-game UID number
    role: { type: String, enum: ['player', 'admin', 'support-admin'], default: 'player' },
    walletBalance: { type: Number, default: 0 }, // for prize payouts

    referralCode: { type: String, unique: true, sparse: true }, // this user's own code to share
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // who referred this user
    referralBonusCredited: { type: Boolean, default: false }, // becomes true after referred user joins first tournament
    referralCount: { type: Number, default: 0 }, // how many successful referrals this user has

    lastLoginDate: { type: String, default: '' }, // 'YYYY-MM-DD' for daily login streak
    loginStreak: { type: Number, default: 0 },

    fcmToken: { type: String, default: '' }, // Firebase Cloud Messaging token for push notifications

    isBanned: { type: Boolean, default: false },
    banReason: { type: String, default: '' },
    bannedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
