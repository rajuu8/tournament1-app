const mongoose = require('mongoose');

const registrationSchema = new mongoose.Schema(
  {
    tournament: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    teamName: { type: String, default: '' },
    paymentStatus: {
      type: String,
      enum: ['Not Required', 'Pending', 'Verified', 'Rejected'],
      default: 'Not Required',
    },
    paymentMethod: { type: String, enum: ['eSewa', 'Khalti', 'None'], default: 'None' },
    transactionId: { type: String, default: '' }, // user-entered txn id for manual verification
    kills: { type: Number, default: 0 },
    rank: { type: Number, default: 0 },
    points: { type: Number, default: 0 },
    prizeWon: { type: Number, default: 0 }, // total prize (position prize + per-kill earnings), set by admin
    prizeStatus: { type: String, enum: ['Pending', 'Paid'], default: 'Pending' },

    resultScreenshot: { type: String, default: '' }, // Cloudinary URL of the match result screenshot
    screenshotStatus: {
      type: String,
      enum: ['Not Submitted', 'Pending Review', 'Verified', 'Rejected'],
      default: 'Not Submitted',
    },
  },
  { timestamps: true }
);

// Prevent the same user from registering twice for the same tournament
registrationSchema.index({ tournament: 1, user: 1 }, { unique: true });

module.exports = mongoose.model('Registration', registrationSchema);
