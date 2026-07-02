const mongoose = require('mongoose');

// For people who can't log in (banned, forgot password, or any pre-login issue).
// Simpler than the in-app SupportMessage thread since there's no logged-in user yet.
const guestSupportTicketSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    message: { type: String, required: true },
    imageUrl: { type: String, default: '' },
    status: { type: String, enum: ['Open', 'Resolved'], default: 'Open' },
    adminReply: { type: String, default: '' }, // admin can leave a short note/reply (no live chat back-and-forth)
  },
  { timestamps: true }
);

module.exports = mongoose.model('GuestSupportTicket', guestSupportTicketSchema);
