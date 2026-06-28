const mongoose = require('mongoose');

const tournamentSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    game: { type: String, enum: ['Free Fire', 'PUBG'], required: true },
    matchType: {
      type: String,
      enum: ['Solo', 'Duo', 'Squad', 'Classic Squad', 'Lone Wolf', '1v1'],
      default: 'Squad',
    },
    mode: { type: String, enum: ['Free', 'Paid'], default: 'Free' },
    entryFee: { type: Number, default: 0 },
    prizePool: { type: Number, default: 0 },
    perKillReward: { type: Number, default: 0 }, // ₨ awarded per confirmed kill
    maxSlots: { type: Number, required: true },
    filledSlots: { type: Number, default: 0 },
    matchDate: { type: Date, required: true },
    roomId: { type: String, default: '' }, // released closer to match time
    roomPassword: { type: String, default: '' },
    status: {
      type: String,
      enum: ['Upcoming', 'Live', 'Completed', 'Cancelled'],
      default: 'Upcoming',
    },
    bannerImage: { type: String, default: '' }, // Cloudinary URL, shown on tournament card
    description: { type: String, default: '' },
    isArchived: { type: Boolean, default: false }, // hides old completed/cancelled tournaments from the main list
    reminderSent: { type: Boolean, default: false }, // tracks whether the pre-match reminder push was already sent
  },
  { timestamps: true }
);

module.exports = mongoose.model('Tournament', tournamentSchema);
