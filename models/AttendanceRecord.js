const mongoose = require('mongoose');

const attendanceRecordSchema = new mongoose.Schema({
  session: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Session',
    required: true
  },
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  class: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
    required: true
  },
  // Final decision
  status: {
    type: String,
    enum: ['accepted', 'review', 'rejected'],
    required: true
  },
  // Confidence score 0-100
  confidenceScore: {
    type: Number,
    required: true,
    min: 0,
    max: 100
  },
  // Breakdown of how score was calculated
  scoreBreakdown: [{
    check: String,
    points: Number,
    passed: Boolean
  }],
  markedAt: {
    type: Date,
    default: Date.now
  },
  // Extra metadata captured during scan
  metadata: {
    latitude:   Number,
    longitude:  Number,
    hasCamera:  Boolean,
    userAgent:  String,
    ipAddress:  String
  },
  // Teacher review fields
  reviewedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewNote:   String,
  isReviewed:   { type: Boolean, default: false },
  // If teacher overrides the auto decision
  finalStatus:  {
    type: String,
    enum: ['accepted', 'rejected', null],
    default: null
  }
}, { timestamps: true });

// Prevent duplicate attendance for same session+student
attendanceRecordSchema.index({ session: 1, student: 1 }, { unique: true });

module.exports = mongoose.model('AttendanceRecord', attendanceRecordSchema);
