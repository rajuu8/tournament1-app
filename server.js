require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const { initFirebase } = require('./config/firebase');
const { initCloudinary } = require('./config/cloudinary');

const authRoutes = require('./routes/authRoutes');
const tournamentRoutes = require('./routes/tournamentRoutes');
const registrationRoutes = require('./routes/registrationRoutes');
const transactionRoutes = require('./routes/transactionRoutes');
const supportRoutes = require('./routes/supportRoutes');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Connect to MongoDB
connectDB();

// Initialize Firebase Admin (for push notifications)
initFirebase();

// Initialize Cloudinary (for screenshot uploads)
initCloudinary();

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/tournaments', tournamentRoutes);
app.use('/api/registrations', registrationRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/support', supportRoutes);

// Health check route
app.get('/', (req, res) => {
  res.send('🏆 Tournament App Backend is running!');
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
