const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true }, // e.g. 'esewaNumber'
    value: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Settings', settingsSchema);
