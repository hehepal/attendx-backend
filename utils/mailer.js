/**
 * mailer.js
 * Sends emails using Nodemailer + Gmail.
 *
 * Setup (one-time):
 *  1. Add to your .env:
 *       EMAIL_USER=yourgmail@gmail.com
 *       EMAIL_PASS=your_16_char_app_password
 *  2. Generate App Password in Google Account →
 *     Security → 2-Step Verification → App Passwords
 *     (Normal Gmail password will NOT work)
 *
 *  If EMAIL_USER is not set, all emails are silently
 *  skipped so the rest of the app still works fine.
 */

const nodemailer = require('nodemailer');

// Build transporter once and reuse
let transporter = null;

const getTransporter = () => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return null;
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
  return transporter;
};

/**
 * Send absence notification to a list of students.
 * @param {Array}  absentStudents  - [{name, email}]
 * @param {Object} session         - session document
 * @param {Object} classDoc        - class document
 */
const sendAbsenceNotifications = async (absentStudents, session, classDoc) => {
  const t = getTransporter();
  if (!t) {
    console.log('📧 Email not configured — skipping absence notifications.');
    return;
  }

  const date = new Date(session.startTime).toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const promises = absentStudents
    .filter(s => s.email)
    .map(student =>
      t.sendMail({
        from: `"AttendX System" <${process.env.EMAIL_USER}>`,
        to: student.email,
        subject: `Absent: ${classDoc.name} — ${date}`,
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:auto;background:#f8f9fa;padding:32px;border-radius:12px">
            <h2 style="color:#ef4444;margin-bottom:4px">Attendance Alert</h2>
            <p style="color:#64748b;margin-top:0">AttendX Automated Notification</p>
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0"/>

            <p>Dear <strong>${student.name}</strong>,</p>
            <p>
              You were marked <strong style="color:#ef4444">Absent</strong> for the following class:
            </p>

            <table style="width:100%;background:#fff;border-radius:8px;padding:16px;margin:16px 0;border-collapse:collapse">
              <tr><td style="padding:6px 0;color:#64748b;width:120px">Subject</td>
                  <td style="padding:6px 0;font-weight:600">${classDoc.name} (${classDoc.subject})</td></tr>
              <tr><td style="padding:6px 0;color:#64748b">Date</td>
                  <td style="padding:6px 0">${date}</td></tr>
              <tr><td style="padding:6px 0;color:#64748b">Mode</td>
                  <td style="padding:6px 0;text-transform:capitalize">${session.mode}</td></tr>
            </table>

            <p style="background:#fef9c3;padding:12px;border-radius:8px;font-size:0.9rem">
              ⚠️ Students with attendance below <strong>75%</strong> may be
              barred from examinations. Please contact your teacher if this
              absence was recorded in error.
            </p>

            <p style="color:#94a3b8;font-size:0.8rem;margin-top:24px">
              This is an automated message from AttendX. Do not reply.
            </p>
          </div>
        `
      }).catch(err => console.error(`Email failed for ${student.email}:`, err.message))
    );

  await Promise.allSettled(promises);
  console.log(`📧 Sent absence notifications to ${absentStudents.length} student(s).`);
};

/**
 * Send a summary email to the teacher when session ends.
 */
const sendSessionSummaryToTeacher = async (teacher, session, classDoc, stats) => {
  const t = getTransporter();
  if (!t || !teacher.email) return;

  const date = new Date(session.startTime).toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  await t.sendMail({
    from: `"AttendX System" <${process.env.EMAIL_USER}>`,
    to: teacher.email,
    subject: `Session Summary: ${classDoc.name} — ${date}`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:auto;background:#f8f9fa;padding:32px;border-radius:12px">
        <h2 style="color:#6366f1;margin-bottom:4px">Session Ended</h2>
        <p style="color:#64748b;margin-top:0">${classDoc.name} · ${date}</p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0"/>

        <p>Hi <strong>${teacher.name}</strong>, here's your attendance summary:</p>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:20px 0">
          <div style="background:#dcfce7;padding:16px;border-radius:8px;text-align:center">
            <div style="font-size:2rem;font-weight:700;color:#16a34a">${stats.accepted}</div>
            <div style="color:#16a34a;font-size:0.85rem">Present</div>
          </div>
          <div style="background:#fee2e2;padding:16px;border-radius:8px;text-align:center">
            <div style="font-size:2rem;font-weight:700;color:#dc2626">${stats.absent}</div>
            <div style="color:#dc2626;font-size:0.85rem">Absent</div>
          </div>
          <div style="background:#fef9c3;padding:16px;border-radius:8px;text-align:center">
            <div style="font-size:2rem;font-weight:700;color:#ca8a04">${stats.review}</div>
            <div style="color:#ca8a04;font-size:0.85rem">Pending Review</div>
          </div>
          <div style="background:#e0e7ff;padding:16px;border-radius:8px;text-align:center">
            <div style="font-size:2rem;font-weight:700;color:#4f46e5">${stats.total}</div>
            <div style="color:#4f46e5;font-size:0.85rem">Total Students</div>
          </div>
        </div>

        <p style="color:#94a3b8;font-size:0.8rem;margin-top:24px">
          This is an automated message from AttendX. Do not reply.
        </p>
      </div>
    `
  }).catch(err => console.error('Teacher summary email failed:', err.message));
};

module.exports = { sendAbsenceNotifications, sendSessionSummaryToTeacher };
