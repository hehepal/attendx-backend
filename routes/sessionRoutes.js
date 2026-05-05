const express = require('express');
const qrcode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const Session = require('../models/Session');
const Class = require('../models/Class');
const AttendanceRecord = require('../models/AttendanceRecord');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// ── POST /api/sessions ── Start a new attendance session
router.post('/', protect, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const { classId, duration, allowGPS, centerLat, centerLng, allowedRadius, mode } = req.body;

    const classDoc = await Class.findById(classId);
    if (!classDoc) return res.status(404).json({ message: 'Class not found' });

    // Only one active session per class at a time
    const existing = await Session.findOne({ class: classId, status: 'active' });
    if (existing) {
      return res.status(400).json({
        message: 'A session is already active for this class. End it first.',
        sessionId: existing._id
      });
    }

    // Generate first QR token
    const qrToken = uuidv4();
    const qrExpiry = new Date(Date.now() + 30 * 1000); // 30 seconds

    const session = await Session.create({
      class: classId,
      teacher: req.user._id,
      duration: duration || 2,
      mode: mode || 'secure',
      currentQRToken: qrToken,
      qrExpiry,
      allowGPS: allowGPS || false,
      centerLat: centerLat || null,
      centerLng: centerLng || null,
      allowedRadius: allowedRadius || 100
    });

    // Auto-expire after duration
    const durationMs = (duration || 60) * 60 * 1000;
    setTimeout(async () => {
      const s = await Session.findById(session._id);
      if (s && s.status === 'active') {
        await Session.findByIdAndUpdate(session._id, {
          status: 'expired',
          endTime: new Date()
        });
      }
    }, durationMs);

    const populated = await session.populate('class', 'name subject code');
    res.status(201).json({ session: populated });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ── GET /api/sessions/:id/qr ── Get (or refresh) current QR for a session
router.get('/:id/qr', protect, async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ message: 'Session not found' });

    if (session.status !== 'active') {
      return res.status(400).json({ message: 'Session is not active', status: session.status });
    }

    const now = new Date();
    let token   = session.currentQRToken;
    let expiry  = session.qrExpiry;

    // Rotate token if expired
    if (!expiry || now >= expiry) {
      token  = uuidv4();
      expiry = new Date(Date.now() + 30 * 1000);
      await Session.findByIdAndUpdate(req.params.id, {
        currentQRToken: token,
        qrExpiry: expiry
      });
    }

    // Build QR payload: what the student's scanner will read
    const qrPayload = JSON.stringify({
      sessionId: session._id.toString(),
      token,
      ts: Date.now()
    });

    // Generate QR as base64 PNG
    const qrImage = await qrcode.toDataURL(qrPayload, {
      width: 280,
      margin: 2,
      color: { dark: '#0f172a', light: '#ffffff' },
      errorCorrectionLevel: 'M'
    });

    const timeLeft = Math.max(0, Math.floor((new Date(expiry) - now) / 1000));

    res.json({
      qrImage,
      token,
      expiresAt: expiry,
      timeLeft,
      sessionId: session._id,
      sessionStatus: session.status
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ── GET /api/sessions/:id ── Get session details + attendance list
router.get('/:id', protect, async (req, res) => {
  try {
    const session = await Session.findById(req.params.id)
      .populate('class', 'name subject code students')
      .populate('teacher', 'name email');

    if (!session) return res.status(404).json({ message: 'Session not found' });

    const records = await AttendanceRecord.find({ session: req.params.id })
      .populate('student', 'name email rollNumber')
      .sort('-markedAt');

    res.json({ session, records });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ── GET /api/sessions/class/:classId ── Get all sessions for a class
router.get('/class/:classId', protect, async (req, res) => {
  try {
    const sessions = await Session.find({ class: req.params.classId })
      .sort('-createdAt')
      .limit(20);
    res.json({ sessions });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ── POST /api/sessions/:id/end ── End session manually
router.post('/:id/end', protect, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const session = await Session.findById(req.params.id).populate('class');
    if (!session) return res.status(404).json({ message: 'Session not found' });

    if (session.teacher.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not your session' });
    }

    const updated = await Session.findByIdAndUpdate(
      req.params.id,
      { status: 'ended', endTime: new Date() },
      { new: true }
    );

    // ── NEW: fire-and-forget email notifications ──────────────────────
    // Runs in background; errors do NOT affect the response to teacher.
    try {
      const { sendAbsenceNotifications, sendSessionSummaryToTeacher } = require('../utils/mailer');
      const User = require('../models/User');
      const records = await AttendanceRecord.find({ session: req.params.id });
      const presentIds = records.map(r => r.student.toString());
      const classDoc = session.class;
      const allStudents = await User.find({ _id: { $in: classDoc.students } }).select('name email');
      const absentStudents = allStudents.filter(s => !presentIds.includes(s._id.toString()));
      const stats = {
        total:    classDoc.students.length,
        accepted: records.filter(r => (r.finalStatus || r.status) === 'accepted').length,
        absent:   absentStudents.length,
        review:   records.filter(r => r.status === 'review' && !r.isReviewed).length
      };
      sendAbsenceNotifications(absentStudents, session, classDoc);
      sendSessionSummaryToTeacher(req.user, session, classDoc, stats);
    } catch (mailErr) {
      console.error('Mail error (non-fatal):', mailErr.message);
    }
    // ─────────────────────────────────────────────────────────────────

    res.json({ message: 'Session ended', session: updated });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
