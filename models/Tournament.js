const mongoose = require('mongoose');

const tournamentSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    game: { type: String, enum: ['Free Fire', 'PUBG'], required: true },
    matchType: { type: String, default: 'Squad' }, // Solo / Duo / Squad
    mode: { type: String, enum: ['Free', 'Paid'], default: 'Free' },
    entryFee: { type: Number, default: 0 },
    prizePool: { type: Number, default: 0 },
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
    description: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Tournament', tournamentSchema);
