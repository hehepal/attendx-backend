const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Class = require('../models/Class');
const { protect } = require('../middleware/auth');

const router = express.Router();

// Helper: generate JWT
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '7d'
  });
};

// ── POST /api/auth/register ──────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role, rollNumber, department } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ message: 'Please fill all required fields' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    const user = await User.create({
      name, email, password, role, rollNumber, department
    });

    const token = generateToken(user._id);
    res.status(201).json({ token, user });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ── POST /api/auth/login ─────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await User.findOne({ email });
    if (!user || !user.isActive) {
      return res.status(401).json({ message: 'Invalid credentials or account disabled' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = generateToken(user._id);
    res.json({ token, user });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ── GET /api/auth/me ─────────────────────────────────────────────
router.get('/me', protect, async (req, res) => {
  res.json({ user: req.user });
});

// ── POST /api/auth/seed ── (DEV ONLY: create demo accounts) ──────
router.post('/seed', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ message: 'Not allowed in production' });
  }
  try {
    await User.deleteMany({});
    await Class.deleteMany({});

    const admin = await User.create({
      name: 'Admin User', email: 'admin@demo.com',
      password: 'admin123', role: 'admin'
    });
    const teacher = await User.create({
      name: 'Prof. Sharma', email: 'teacher@demo.com',
      password: 'teacher123', role: 'teacher', department: 'Computer Science'
    });
    const student1 = await User.create({
      name: 'Rahul Gupta', email: 'student1@demo.com',
      password: 'student123', role: 'student',
      rollNumber: 'CS2101', department: 'Computer Science'
    });
    const student2 = await User.create({
      name: 'Priya Singh', email: 'student2@demo.com',
      password: 'student123', role: 'student',
      rollNumber: 'CS2102', department: 'Computer Science'
    });

    // Create a demo class
    const demoClass = await Class.create({
      name: 'Software Engineering', subject: 'SE301',
      teacher: teacher._id, students: [student1._id, student2._id],
      department: 'Computer Science', semester: '5th'
    });

    // Link class to teacher and students
    await User.findByIdAndUpdate(teacher._id,  { $push: { teachingClasses: demoClass._id } });
    await User.findByIdAndUpdate(student1._id, { $push: { enrolledClasses: demoClass._id } });
    await User.findByIdAndUpdate(student2._id, { $push: { enrolledClasses: demoClass._id } });

    res.json({
      message: '✅ Demo data seeded successfully',
      accounts: [
        { role: 'admin',   email: 'admin@demo.com',    password: 'admin123'   },
        { role: 'teacher', email: 'teacher@demo.com',  password: 'teacher123' },
        { role: 'student', email: 'student1@demo.com', password: 'student123' },
        { role: 'student', email: 'student2@demo.com', password: 'student123' }
      ]
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
