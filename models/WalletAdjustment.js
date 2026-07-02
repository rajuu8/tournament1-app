const mongoose = require('mongoose');

// Logs every manual wallet balance change made by an admin, for audit/fraud-review purposes.
const walletAdjustmentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    adjustedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // which admin made the change
    previousBalance: { type: Number, required: true },
    newBalance: { type: Number, required: true },
    difference: { type: Number, required: true }, // newBalance - previousBalance
    reason: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('WalletAdjustment', walletAdjustmentSchema);
