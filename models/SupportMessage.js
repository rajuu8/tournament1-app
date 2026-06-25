const mongoose = require('mongoose');

// Each document is a single message within a player's support conversation.
// All messages for one player thread share the same conversationUser (the player's ID).
const supportMessageSchema = new mongoose.Schema(
  {
    conversationUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // the player this thread belongs to
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // who actually sent this message (player or an admin)
    senderRole: { type: String, enum: ['player', 'admin', 'support-admin'], required: true },
    text: { type: String, default: '' },
    imageUrl: { type: String, default: '' }, // optional attached image (Cloudinary URL)
    readByAdmin: { type: Boolean, default: false },
    readByPlayer: { type: Boolean, default: true }, // true by default for admin messages? set explicitly per message
  },
  { timestamps: true }
);

module.exports = mongoose.model('SupportMessage', supportMessageSchema);
