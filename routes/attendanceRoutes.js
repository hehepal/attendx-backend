const express = require('express');
const Session = require('../models/Session');
const AttendanceRecord = require('../models/AttendanceRecord');
const Class = require('../models/Class');
const User = require('../models/User');
const { protect, authorize } = require('../middleware/auth');
const { calculateConfidence, getDistanceMeters } = require('../utils/confidence');

const router = express.Router();

// ── POST /api/attendance/mark ──────────────────────────────────────────
router.post('/mark', protect, authorize('student'), async (req, res) => {
  try {
    const { sessionId, token, latitude, longitude, cameraAvailable } = req.body;

    if (!sessionId || !token) {
      return res.status(400).json({ message: 'sessionId and token are required' });
    }

    const session = await Session.findById(sessionId).populate('class');
    if (!session) return res.status(404).json({ message: 'Session not found' });

    if (session.status !== 'active') {
      return res.status(400).json({
        message: session.status === 'ended'
          ? 'This session has been ended by the teacher.'
          : 'Session has expired.',
        status: session.status
      });
    }

    const classDoc = await Class.findById(session.class._id);
    const isEnrolled = classDoc.students.some(s => s.toString() === req.user._id.toString());
    if (!isEnrolled) {
      return res.status(403).json({ message: 'You are not enrolled in this class.' });
    }

    const existing = await AttendanceRecord.findOne({ session: sessionId, student: req.user._id });
    if (existing) {
      return res.status(400).json({
        message: 'Attendance already marked for this session.',
        status: existing.status,
        score: existing.confidenceScore
      });
    }

    // ─── SIMPLE MODE ───────────────────────────────────────────────────
    if (session.mode === 'simple') {
      const validToken = session.currentQRToken === token;

      if (!validToken) {
        return res.status(400).json({
          message: 'Invalid or expired QR code. Ask the teacher to refresh the QR.',
          verdict: 'rejected', score: 0
        });
      }

      const breakdown = [
        { check: 'Valid QR Token', points: 100, passed: true },
        { check: 'Simple Mode — No extra checks', points: 0, passed: true }
      ];

      const record = await AttendanceRecord.create({
        session: sessionId, student: req.user._id, class: classDoc._id,
        status: 'accepted', confidenceScore: 100, scoreBreakdown: breakdown,
        metadata: { latitude, longitude, hasCamera: !!cameraAvailable,
          userAgent: req.headers['user-agent'], ipAddress: req.ip }
      });

      await Session.findByIdAndUpdate(sessionId, { $inc: { totalPresent: 1 } });

      return res.json({
        message: 'Attendance marked successfully! ✅',
        verdict: 'accepted', score: 100, breakdown, mode: 'simple', recordId: record._id
      });
    }

    // ─── SECURE MODE ───────────────────────────────────────────────────
    const validToken = session.currentQRToken === token;
    const now = new Date();
    const notExpired = session.qrExpiry && now <= new Date(session.qrExpiry);

    // Replay attack check
    const isReplayed = session.usedTokens.includes(token);
    if (isReplayed) {
      const record = await AttendanceRecord.create({
        session: sessionId, student: req.user._id, class: classDoc._id,
        status: 'rejected', confidenceScore: 0,
        scoreBreakdown: [{ check: 'Replay Attack — Token already used', points: 0, passed: false }],
        metadata: { latitude, longitude, hasCamera: !!cameraAvailable,
          userAgent: req.headers['user-agent'], ipAddress: req.ip }
      });
      return res.status(400).json({
        message: '❌ This QR was already used. Possible screenshot/sharing attempt.',
        verdict: 'rejected', score: 0, breakdown: record.scoreBreakdown
      });
    }

    await Session.findByIdAndUpdate(sessionId, { $addToSet: { usedTokens: token } });

    const sessionStart = new Date(session.startTime);
    const sessionEndAllowed = new Date(sessionStart.getTime() + session.duration * 60 * 1000);
    const withinWindow = now >= sessionStart && now <= sessionEndAllowed;

    let gpsChecked = false, gpsMatch = false;
    if (session.allowGPS && session.centerLat && session.centerLng && latitude && longitude) {
      gpsChecked = true;
      const dist = getDistanceMeters(latitude, longitude, session.centerLat, session.centerLng);
      gpsMatch = dist <= (session.allowedRadius || 100);
    }

    const checks = {
      validToken, notExpired, sessionActive: true, withinWindow,
      gpsChecked, gpsMatch, cameraAvailable: !!cameraAvailable, freshToken: true
    };

    const { score, breakdown, verdict, message } = calculateConfidence(checks);

    const record = await AttendanceRecord.create({
      session: sessionId, student: req.user._id, class: classDoc._id,
      status: verdict, confidenceScore: score, scoreBreakdown: breakdown,
      metadata: { latitude, longitude, hasCamera: !!cameraAvailable,
        userAgent: req.headers['user-agent'], ipAddress: req.ip }
    });

    if (verdict === 'accepted') {
      await Session.findByIdAndUpdate(sessionId, { $inc: { totalPresent: 1 } });
    }

    return res.json({ message, verdict, score, breakdown, mode: 'secure', recordId: record._id });

  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Attendance already marked for this session.' });
    }
    res.status(500).json({ message: error.message });
  }
});

// ── GET /api/attendance/session/:sessionId ──────────────────────────────────
router.get('/session/:sessionId', protect, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const session = await Session.findById(req.params.sessionId)
      .populate('class', 'name subject students');
    if (!session) return res.status(404).json({ message: 'Session not found' });

    const records = await AttendanceRecord.find({ session: req.params.sessionId })
      .populate('student', 'name email rollNumber').sort('-markedAt');

    const presentIds = records.map(r => r.student._id.toString());
    const allStudents = await User.find({ _id: { $in: session.class.students } })
      .select('name email rollNumber');
    const absentees = allStudents.filter(s => !presentIds.includes(s._id.toString()));

    const stats = {
      total:    session.class.students.length,
      accepted: records.filter(r => (r.finalStatus || r.status) === 'accepted').length,
      review:   records.filter(r => r.status === 'review' && !r.isReviewed).length,
      rejected: records.filter(r => (r.finalStatus || r.status) === 'rejected').length,
      absent:   absentees.length
    };

    res.json({ records, absentees, stats, session });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ── GET /api/attendance/student/me ──────────────────────────────────────────
router.get('/student/me', protect, authorize('student'), async (req, res) => {
  try {
    // 1. All attendance records this student has submitted
    const records = await AttendanceRecord.find({ student: req.user._id })
      .populate('session', 'date startTime status duration mode')
      .populate('class',   'name subject code')
      .sort('-markedAt');

    // 2. All classes this student is enrolled in (to get TRUE total sessions)
    const enrolledClasses = await Class.find({
      students: req.user._id, isActive: true
    }).select('name subject code');

    // 3. For each enrolled class, count total sessions held (ended or expired)
    //    and how many the student actually attended (accepted record exists)
    const summary = await Promise.all(enrolledClasses.map(async (cls) => {
      const totalSessions = await Session.countDocuments({
        class: cls._id,
        status: { $in: ['ended', 'expired'] }
      });

      const presentCount = await AttendanceRecord.countDocuments({
        student: req.user._id,
        class:   cls._id,
        $or: [{ status: 'accepted' }, { finalStatus: 'accepted' }]
      });

      const percentage = totalSessions > 0
        ? Math.round((presentCount / totalSessions) * 100)
        : 0;

      return {
        class:      cls,
        total:      totalSessions,
        present:    presentCount,
        absent:     totalSessions - presentCount,
        percentage,
        atRisk:     totalSessions > 0 && percentage < 75
      };
    }));

    res.json({ records, summary });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ── GET /api/attendance/class/:classId ──────────────────────────────────────
router.get('/class/:classId', protect, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const classDoc = await Class.findById(req.params.classId)
      .populate('students', 'name email rollNumber');
    if (!classDoc) return res.status(404).json({ message: 'Class not found' });

    const sessions = await Session.find({ class: req.params.classId }).sort('-createdAt');
    const totalSessions = sessions.length;

    const studentStats = await Promise.all(
      classDoc.students.map(async (student) => {
        const accepted = await AttendanceRecord.countDocuments({
          student: student._id, class: req.params.classId,
          $or: [{ status: 'accepted' }, { finalStatus: 'accepted' }]
        });
        return {
          student, sessionsAttended: accepted, totalSessions,
          percentage: totalSessions > 0 ? Math.round((accepted / totalSessions) * 100) : 0,
          atRisk: totalSessions > 0 && (accepted / totalSessions) < 0.75
        };
      })
    );

    res.json({ classDoc, studentStats, totalSessions });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ── PATCH /api/attendance/:id/review ────────────────────────────────────────
router.patch('/:id/review', protect, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const { decision, note } = req.body;
    if (!['accepted', 'rejected'].includes(decision)) {
      return res.status(400).json({ message: 'Decision must be "accepted" or "rejected"' });
    }
    const record = await AttendanceRecord.findByIdAndUpdate(
      req.params.id,
      { finalStatus: decision, isReviewed: true, reviewedBy: req.user._id, reviewNote: note || '' },
      { new: true }
    ).populate('student', 'name email');
    res.json({ message: `Attendance ${decision}`, record });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
