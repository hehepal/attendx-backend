const express = require('express');
const User = require('../models/User');
const Class = require('../models/Class');
const Session = require('../models/Session');
const AttendanceRecord = require('../models/AttendanceRecord');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();
// All admin routes require admin role
router.use(protect, authorize('admin'));

// ── GET /api/admin/users ── List all users
router.get('/users', async (req, res) => {
  try {
    const { role } = req.query;
    const filter = role ? { role } : {};
    const users = await User.find(filter).sort('-createdAt');
    res.json({ users });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ── POST /api/admin/users ── Create user
router.post('/users', async (req, res) => {
  try {
    const user = await User.create(req.body);
    res.status(201).json({ user });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ── PATCH /api/admin/users/:id ── Update user
router.patch('/users/:id', async (req, res) => {
  try {
    const { password, ...updates } = req.body;
    const user = await User.findByIdAndUpdate(req.params.id, updates, { new: true });
    res.json({ user });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ── DELETE /api/admin/users/:id ── Deactivate user
router.delete('/users/:id', async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ message: 'User deactivated' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ── GET /api/admin/stats ── System-wide stats
router.get('/stats', async (req, res) => {
  try {
    const [totalUsers, teachers, students, classes, sessions, suspicious] = await Promise.all([
      User.countDocuments({ isActive: true }),
      User.countDocuments({ role: 'teacher', isActive: true }),
      User.countDocuments({ role: 'student', isActive: true }),
      Class.countDocuments({ isActive: true }),
      Session.countDocuments(),
      AttendanceRecord.countDocuments({ status: 'review' })
    ]);

    const recentSessions = await Session.find()
      .sort('-createdAt').limit(5)
      .populate('class', 'name subject')
      .populate('teacher', 'name');

    res.json({ totalUsers, teachers, students, classes, sessions, suspicious, recentSessions });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ── GET /api/admin/suspicious ── All suspicious attendance attempts
router.get('/suspicious', async (req, res) => {
  try {
    const records = await AttendanceRecord.find({
      status: 'review', isReviewed: false
    })
      .populate('student', 'name email rollNumber')
      .populate('class', 'name subject')
      .populate('session', 'date startTime')
      .sort('-markedAt');

    res.json({ records });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ── GET /api/admin/sessions ── All sessions
router.get('/sessions', async (req, res) => {
  try {
    const sessions = await Session.find()
      .populate('class', 'name subject')
      .populate('teacher', 'name email')
      .sort('-createdAt').limit(30);
    res.json({ sessions });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
