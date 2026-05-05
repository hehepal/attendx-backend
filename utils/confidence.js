/**
 * Confidence Score System
 * 
 * Calculates a score from 0-100 based on multiple validation checks.
 * Each check contributes points toward the final score.
 * 
 * Decision thresholds:
 *   80-100 → Accepted  ✅
 *   60-79  → Review    ⚠️ (Teacher must manually approve)
 *   0-59   → Rejected  ❌
 */

const calculateConfidence = (checks) => {
  let score = 0;
  const breakdown = [];

  // ── CHECK 1: Valid QR token (not forged/tampered) ── 25 pts
  if (checks.validToken) {
    score += 25;
    breakdown.push({ check: 'Valid QR Token',     points: 25,  passed: true  });
  } else {
    breakdown.push({ check: 'Valid QR Token',     points: 0,   passed: false });
  }

  // ── CHECK 2: QR not expired (< 30 sec old) ── 20 pts
  if (checks.notExpired) {
    score += 20;
    breakdown.push({ check: 'QR Not Expired',     points: 20,  passed: true  });
  } else {
    breakdown.push({ check: 'QR Not Expired',     points: 0,   passed: false });
  }

  // ── CHECK 3: Session is currently active ── 20 pts
  if (checks.sessionActive) {
    score += 20;
    breakdown.push({ check: 'Session Active',     points: 20,  passed: true  });
  } else {
    breakdown.push({ check: 'Session Active',     points: 0,   passed: false });
  }

  // ── CHECK 4: Scan within allowed time window ── 15 pts
  if (checks.withinWindow) {
    score += 15;
    breakdown.push({ check: 'Within Time Window', points: 15,  passed: true  });
  } else {
    breakdown.push({ check: 'Within Time Window', points: 0,   passed: false });
  }

  // ── CHECK 5: GPS location (optional) ── +10 or -5 pts
  if (checks.gpsChecked === true) {
    if (checks.gpsMatch === true) {
      score += 10;
      breakdown.push({ check: 'GPS Location Match',    points: 10, passed: true  });
    } else {
      score -= 5;
      breakdown.push({ check: 'GPS Location Mismatch', points: -5, passed: false });
    }
  } else {
    breakdown.push({ check: 'GPS Not Checked',         points: 0,  passed: null  });
  }

  // ── CHECK 6: Camera available (presence signal) ── 10 pts
  if (checks.cameraAvailable) {
    score += 10;
    breakdown.push({ check: 'Camera Available',   points: 10,  passed: true  });
  } else {
    breakdown.push({ check: 'Camera Available',   points: 0,   passed: false });
  }

  // ── CHECK 7: One-time token (not a replayed request) ── 10 pts
  // If it reached this function, token was NOT replayed (checked before calling)
  // But we still note it in breakdown
  if (checks.freshToken) {
    score += 10;
    breakdown.push({ check: 'Fresh Token (No Replay)', points: 10, passed: true  });
  } else {
    breakdown.push({ check: 'Fresh Token (No Replay)', points: 0,  passed: false });
  }

  // Clamp score between 0 and 100
  score = Math.max(0, Math.min(100, score));

  // Determine verdict
  let verdict, message, color;
  if (score >= 80) {
    verdict = 'accepted';
    message = 'Attendance marked successfully! ✅';
    color   = 'green';
  } else if (score >= 60) {
    verdict = 'review';
    message = 'Attendance submitted for teacher review ⚠️';
    color   = 'yellow';
  } else {
    verdict = 'rejected';
    message = 'Attendance could not be verified ❌';
    color   = 'red';
  }

  return { score, breakdown, verdict, message, color };
};

/**
 * Calculate distance between two GPS coordinates (Haversine formula)
 * Returns distance in meters
 */
const getDistanceMeters = (lat1, lng1, lat2, lng2) => {
  const R = 6371000; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

module.exports = { calculateConfidence, getDistanceMeters };
