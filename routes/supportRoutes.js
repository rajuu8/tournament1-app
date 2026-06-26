const express = require('express');
const multer = require('multer');
const SupportMessage = require('../models/SupportMessage');
const User = require('../models/User');
const { protect, anyAdmin } = require('../middleware/authMiddleware');
const { sendPushNotification, sendPushToMany } = require('../config/firebase');
const { uploadImage } = require('../config/cloudinary');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const router = express.Router();

/* ===================== PLAYER SIDE ===================== */

// @route   GET /api/support/my
// @desc    Player views their own conversation thread
router.get('/my', protect, async (req, res) => {
  try {
    const messages = await SupportMessage.find({ conversationUser: req.user.id }).sort({ createdAt: 1 });
    // Mark admin messages as read by the player
    await SupportMessage.updateMany(
      { conversationUser: req.user.id, senderRole: { $ne: 'player' } },
      { readByPlayer: true }
    );
    res.json(messages);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route   POST /api/support/send
// @desc    Player sends a message (text and/or image) to support
router.post('/send', protect, upload.single('image'), async (req, res) => {
  try {
    const { text } = req.body;
    if (!text && !req.file) {
      return res.status(400).json({ message: 'Message text or image is required' });
    }

    let imageUrl = '';
    if (req.file) {
      imageUrl = await uploadImage(req.file.buffer, 'clashking-support');
    }

    const message = await SupportMessage.create({
      conversationUser: req.user.id,
      sender: req.user.id,
      senderRole: 'player',
      text: text || '',
      imageUrl,
      readByAdmin: false,
      readByPlayer: true,
    });

    // Notify all admins and support-admins that a player needs help
    const player = await User.findById(req.user.id).select('name fcmToken');
    const admins = await User.find({
      role: { $in: ['admin', 'support-admin'] },
      fcmToken: { $ne: '' },
    }).select('fcmToken');
    const tokens = admins.map(a => a.fcmToken).filter(Boolean);
    sendPushToMany(
      tokens,
      `💬 New message from ${player?.name || 'a player'}`,
      text ? text.slice(0, 80) : '📷 Sent an image',
      { type: 'new_support_message', userId: req.user.id }
    );

    res.status(201).json(message);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

/* ===================== ADMIN SIDE ===================== */

// @route   GET /api/support/conversations
// @desc    Admin/support-admin views list of all conversations with unread counts
router.get('/conversations', protect, anyAdmin, async (req, res) => {
  try {
    const unreadAgg = await SupportMessage.aggregate([
      { $match: { senderRole: 'player', readByAdmin: false } },
      { $group: { _id: '$conversationUser', unreadCount: { $sum: 1 } } },
    ]);
    const unreadMap = {};
    unreadAgg.forEach(u => { unreadMap[u._id.toString()] = u.unreadCount; });

    // Get the latest message per conversation, plus the player's basic info
    const latestAgg = await SupportMessage.aggregate([
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$conversationUser', lastMessage: { $first: '$$ROOT' } } },
      { $sort: { 'lastMessage.createdAt': -1 } },
    ]);

    const userIds = latestAgg.map(c => c._id);
    const users = await User.find({ _id: { $in: userIds } }).select('name phone');
    const userMap = {};
    users.forEach(u => { userMap[u._id.toString()] = u; });

    const conversations = latestAgg.map(c => ({
      userId: c._id,
      user: userMap[c._id.toString()] || null,
      lastMessage: c.lastMessage,
      unreadCount: unreadMap[c._id.toString()] || 0,
    }));

    res.json(conversations);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route   GET /api/support/conversations/:userId
// @desc    Admin/support-admin views a specific player's full conversation
router.get('/conversations/:userId', protect, anyAdmin, async (req, res) => {
  try {
    const messages = await SupportMessage.find({ conversationUser: req.params.userId }).sort({ createdAt: 1 });
    await SupportMessage.updateMany(
      { conversationUser: req.params.userId, senderRole: 'player' },
      { readByAdmin: true }
    );
    res.json(messages);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route   POST /api/support/conversations/:userId/reply
// @desc    Admin/support-admin replies to a player's conversation (text and/or image)
router.post('/conversations/:userId/reply', protect, anyAdmin, upload.single('image'), async (req, res) => {
  try {
    const { text } = req.body;
    if (!text && !req.file) {
      return res.status(400).json({ message: 'Message text or image is required' });
    }

    let imageUrl = '';
    if (req.file) {
      imageUrl = await uploadImage(req.file.buffer, 'clashking-support');
    }

    const message = await SupportMessage.create({
      conversationUser: req.params.userId,
      sender: req.user.id,
      senderRole: req.user.role,
      text: text || '',
      imageUrl,
      readByAdmin: true,
      readByPlayer: false,
    });

    const player = await User.findById(req.params.userId);
    if (player?.fcmToken) {
      sendPushNotification(
        player.fcmToken,
        '💬 Support Reply',
        text ? text.slice(0, 80) : 'You received a new message from support.',
        { type: 'support_reply' }
      );
    }

    res.status(201).json(message);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
