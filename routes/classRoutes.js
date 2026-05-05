const express = require('express');
const Class = require('../models/Class');
const User = require('../models/User');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// ── POST /api/classes ── Create new class (teacher/admin)
router.post('/', protect, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const { name, subject, department, semester, description } = req.body;

    const newClass = await Class.create({
      name, subject, department, semester, description,
      teacher: req.user._id
    });

    // Add class to teacher's teachingClasses
    await User.findByIdAndUpdate(req.user._id, {
      $addToSet: { teachingClasses: newClass._id }
    });

    res.status(201).json({ class: newClass });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ── GET /api/classes ── Get classes for current user
router.get('/', protect, async (req, res) => {
  try {
    let classes;
    if (req.user.role === 'teacher') {
      classes = await Class.find({ teacher: req.user._id, isActive: true })
        .populate('students', 'name email rollNumber')
        .sort('-createdAt');
    } else if (req.user.role === 'student') {
      classes = await Class.find({ students: req.user._id, isActive: true })
        .populate('teacher', 'name email')
        .sort('-createdAt');
    } else {
      // admin sees all
      classes = await Class.find({ isActive: true })
        .populate('teacher', 'name email')
        .populate('students', 'name email rollNumber')
        .sort('-createdAt');
    }
    res.json({ classes });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ── POST /api/classes/enroll-by-code ── Student self-enrolls using class code
router.post('/enroll-by-code', protect, authorize('student'), async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ message: 'Class code is required' });

    const classDoc = await Class.findOne({ code: code.toUpperCase(), isActive: true });
    if (!classDoc) return res.status(404).json({ message: 'No class found with that code. Double-check with your teacher.' });

    if (classDoc.students.includes(req.user._id)) {
      return res.status(400).json({ message: 'You are already enrolled in this class.' });
    }

    classDoc.students.push(req.user._id);
    await classDoc.save();
    await User.findByIdAndUpdate(req.user._id, { $addToSet: { enrolledClasses: classDoc._id } });

    res.json({ message: 'Enrolled successfully!', class: classDoc });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});


router.get('/:id', protect, async (req, res) => {
  try {
    const classDoc = await Class.findById(req.params.id)
      .populate('teacher', 'name email')
      .populate('students', 'name email rollNumber department');

    if (!classDoc) return res.status(404).json({ message: 'Class not found' });
    res.json({ class: classDoc });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ── POST /api/classes/:id/enroll ── Enroll a student by email or rollNumber
router.post('/:id/enroll', protect, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const { email, rollNumber } = req.body;

    const student = await User.findOne({
      $or: [{ email }, { rollNumber }],
      role: 'student'
    });

    if (!student) return res.status(404).json({ message: 'Student not found' });

    const classDoc = await Class.findById(req.params.id);
    if (!classDoc) return res.status(404).json({ message: 'Class not found' });

    if (classDoc.students.includes(student._id)) {
      return res.status(400).json({ message: 'Student already enrolled' });
    }

    classDoc.students.push(student._id);
    await classDoc.save();

    await User.findByIdAndUpdate(student._id, {
      $addToSet: { enrolledClasses: classDoc._id }
    });

    res.json({ message: `${student.name} enrolled successfully`, student });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ── DELETE /api/classes/:id/students/:studentId ── Remove student from class
router.delete('/:id/students/:studentId', protect, authorize('teacher', 'admin'), async (req, res) => {
  try {
    await Class.findByIdAndUpdate(req.params.id, {
      $pull: { students: req.params.studentId }
    });
    await User.findByIdAndUpdate(req.params.studentId, {
      $pull: { enrolledClasses: req.params.id }
    });
    res.json({ message: 'Student removed from class' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

// ── POST /api/classes/:id/import-students ── Bulk import from CSV
router.post('/:id/import-students', protect, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const { students } = req.body;
    if (!Array.isArray(students) || students.length === 0) {
      return res.status(400).json({ message: 'No student data provided' });
    }

    const classDoc = await Class.findById(req.params.id);
    if (!classDoc) return res.status(404).json({ message: 'Class not found' });

    let created = 0, enrolled = 0, skipped = 0;

    for (const s of students) {
      if (!s.name && !s.email) { skipped++; continue; }
      try {
        let student = s.email
          ? await User.findOne({ email: s.email.toLowerCase() })
          : null;

        if (!student && s.rollNumber) {
          student = await User.findOne({ rollNumber: s.rollNumber });
        }

        if (!student) {
          const email = s.email
            ? s.email.toLowerCase()
            : `${(s.rollNumber || s.name.replace(/\s+/g,'').toLowerCase())}@student.local`;
          student = await User.create({
            name: s.name || 'Student', email,
            password: s.rollNumber || 'student123',
            role: 'student',
            rollNumber: s.rollNumber || '',
            department: s.department || ''
          });
          created++;
        }

        if (!classDoc.students.map(id => id.toString()).includes(student._id.toString())) {
          classDoc.students.push(student._id);
          await User.findByIdAndUpdate(student._id, { $addToSet: { enrolledClasses: classDoc._id } });
          enrolled++;
        } else {
          skipped++;
        }
      } catch (e) {
        if (e.code === 11000) skipped++;
      }
    }

    await classDoc.save();
    res.json({ message: 'Import complete', created, enrolled, skipped });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});
