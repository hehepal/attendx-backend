const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  class: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
    required: true
  },
  teacher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  /**
   * SESSION MODE
   * ─────────────────────────────────────────────
   * 'simple'  → Only QR scan required.
   *             No GPS, no camera check, no window
   *             restriction. Student anywhere = ✅
   *             Good for online/remote classes.
   *
   * 'secure'  → Full multi-layer validation.
   *             Confidence score calculated from:
   *             QR validity, token freshness, GPS,
   *             camera, time-window, replay check.
   *             Best for in-person classroom.
   * ─────────────────────────────────────────────
   */
  mode: {
    type: String,
    enum: ['simple', 'secure'],
    default: 'secure'
  },
  date: {
    type: Date,
    default: Date.now
  },
  startTime: {
    type: Date,
    default: Date.now
  },
  endTime: {
    type: Date
  },
  // How long the session lasts (minutes)
  duration: {
    type: Number,
    default: 60
  },
  status: {
    type: String,
    enum: ['active', 'ended', 'expired'],
    default: 'active'
  },
  // Current rotating QR token (changes every 30s)
  currentQRToken: {
    type: String
  },
  qrExpiry: {
    type: Date
  },
  // All tokens that have been used (to prevent replay attacks)
  usedTokens: [{
    type: String
  }],
  // GPS options
  allowGPS: {
    type: Boolean,
    default: false
  },
  centerLat: Number,
  centerLng: Number,
  allowedRadius: {
    type: Number,
    default: 100  // meters
  },
  // Stats
  totalPresent: {
    type: Number,
    default: 0
  },
  totalAbsent: {
    type: Number,
    default: 0
  }
}, { timestamps: true });

module.exports = mongoose.model('Session', sessionSchema);
