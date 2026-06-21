const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['Deposit', 'Withdrawal'], required: true },
    amount: { type: Number, required: true },
    method: { type: String, enum: ['eSewa'], default: 'eSewa' },

    // For deposits - user submits proof
    senderEsewaNumber: { type: String, default: '' }, // number they sent FROM
    transactionId: { type: String, default: '' },

    // For withdrawals - user submits where to send money
    receiverEsewaNumber: { type: String, default: '' }, // number to send TO

    status: {
      type: String,
      enum: ['Pending', 'Approved', 'Rejected'],
      default: 'Pending',
    },
    adminNote: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Transaction', transactionSchema);
