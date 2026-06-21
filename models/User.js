const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, unique: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    password: { type: String, required: true },
    gameId: { type: String, trim: true }, // Free Fire / PUBG in-game ID
    gameUid: { type: String, trim: true }, // in-game UID number
    role: { type: String, enum: ['player', 'admin'], default: 'player' },
    walletBalance: { type: Number, default: 0 }, // for prize payouts
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
