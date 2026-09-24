const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();
router.use(requireAuth, requireRole('faculty'));

const CORRECTION_WINDOW_HOURS = 48;

function withinCorrectionWindow(sessionDate) {
  const created = new Date(sessionDate + 'T00:00:00');
  const hoursSince = (Date.now() - created.getTime()) / (1000 * 60 * 60);
  return hoursSince <= CORRECTION_WINDOW_HOURS;
}

// Subjects/classes this faculty member is assigned to teach
router.get('/my-subjects', (req, res) => {
  const rows = db.prepare(`
    SELECT fs.id as mapping_id, sub.id as subject_id, sub.name as subject_name,
           c.id as class_id, c.name as class_name
    FROM faculty_subject fs
    JOIN subjects sub ON sub.id = fs.subject_id
    JOIN classes c ON c.id = fs.class_id
    WHERE fs.faculty_id = ?
    ORDER BY c.name, sub.name
  `).all(req.user.id);
  res.json(rows);
});

// Roster for a class (to mark attendance against)
router.get('/roster', (req, res) => {
  const { class_id } = req.query;
  if (!class_id) return res.status(400).json({ error: 'class_id is required' });
  const rows = db.prepare(
    `SELECT id, name, roll_no FROM students WHERE class_id = ? AND active = 1 ORDER BY roll_no`
  ).all(class_id);
  res.json(rows);
});

// Create a new attendance session (one class, one subject, one date+period)
router.post('/sessions', (req, res) => {
  const { class_id, subject_id, date, period, attendance } = req.body || {};
  if (!class_id || !subject_id || !date || !period || !Array.isArray(attendance)) {
    return res.status(400).json({ error: 'class_id, subject_id, date, period, attendance[] are required' });
  }
  // verify this faculty is actually assigned to this class/subject
  const mapping = db.prepare(
    'SELECT * FROM faculty_subject WHERE faculty_id = ? AND subject_id = ? AND class_id = ?'
  ).get(req.user.id, subject_id, class_id);
  if (!mapping) return res.status(403).json({ error: 'You are not assigned to this subject/class' });

  const existing = db.prepare(
    'SELECT id FROM sessions WHERE class_id=? AND subject_id=? AND date=? AND period=?'
  ).get(class_id, subject_id, date, period);
  if (existing) {
    return res.status(409).json({ error: 'A session already exists for this class/subject/date/period. Edit it instead of creating a new one.', session_id: existing.id });
  }

  const tx = db.transaction(() => {
    const sessionInfo = db.prepare(
      'INSERT INTO sessions (class_id, subject_id, faculty_id, date, period) VALUES (?,?,?,?,?)'
    ).run(class_id, subject_id, req.user.id, date, period);
    const sessionId = sessionInfo.lastInsertRowid;

    const insertAtt = db.prepare('INSERT INTO attendance (session_id, student_id, status, remarks) VALUES (?,?,?,?)');
    for (const a of attendance) {
      if (!['present', 'absent', 'late'].includes(a.status)) throw new Error(`Invalid status for student ${a.student_id}`);
      insertAtt.run(sessionId, a.student_id, a.status, a.remarks || null);
    }
    return sessionId;
  });

  try {
    const sessionId = tx();
    res.status(201).json({ session_id: sessionId });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// History of sessions this faculty has taken
router.get('/sessions', (req, res) => {
  const { class_id, subject_id, from, to } = req.query;
  let q = `
    SELECT ses.id, ses.date, ses.period, ses.locked, c.name as class_name, sub.name as subject_name,
      (SELECT COUNT(*) FROM attendance a WHERE a.session_id = ses.id) as total,
      (SELECT COUNT(*) FROM attendance a WHERE a.session_id = ses.id AND a.status='present') as present_count,
      (SELECT COUNT(*) FROM attendance a WHERE a.session_id = ses.id AND a.status='absent') as absent_count
    FROM sessions ses
    JOIN classes c ON c.id = ses.class_id
    JOIN subjects sub ON sub.id = ses.subject_id
    WHERE ses.faculty_id = ?
  `;
  const params = [req.user.id];
  if (class_id) { q += ' AND ses.class_id = ?'; params.push(class_id); }
  if (subject_id) { q += ' AND ses.subject_id = ?'; params.push(subject_id); }
  if (from) { q += ' AND ses.date >= ?'; params.push(from); }
  if (to) { q += ' AND ses.date <= ?'; params.push(to); }
  q += ' ORDER BY ses.date DESC, ses.period DESC LIMIT 200';
  res.json(db.prepare(q).all(...params));
});

// Detail of one session including every student's status, for review / correction
router.get('/sessions/:id', (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ? AND faculty_id = ?').get(req.params.id, req.user.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const rows = db.prepare(`
    SELECT a.id as attendance_id, a.status, a.remarks, st.id as student_id, st.name, st.roll_no
    FROM attendance a JOIN students st ON st.id = a.student_id
    WHERE a.session_id = ? ORDER BY st.roll_no
  `).all(session.id);
  res.json({
    session,
    editable: withinCorrectionWindow(session.date) && !session.locked,
    students: rows,
  });
});

// Correct a single student's attendance for a session, within the correction window.
router.put('/attendance/:attendanceId', (req, res) => {
  const { status, reason } = req.body || {};
  if (!status || !reason) return res.status(400).json({ error: 'status and reason are required' });
  if (!['present', 'absent', 'late'].includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const att = db.prepare(`
    SELECT a.*, ses.date as session_date, ses.faculty_id, ses.locked
    FROM attendance a JOIN sessions ses ON ses.id = a.session_id
    WHERE a.id = ?
  `).get(req.params.attendanceId);
  if (!att) return res.status(404).json({ error: 'Attendance record not found' });
  if (att.faculty_id !== req.user.id) return res.status(403).json({ error: 'Not your session' });
  if (att.locked || !withinCorrectionWindow(att.session_date)) {
    return res.status(403).json({
      error: `Correction window (${CORRECTION_WINDOW_HOURS}h) has passed. Please contact an admin to make this correction.`,
    });
  }

  const tx = db.transaction(() => {
    db.prepare('UPDATE attendance SET status = ? WHERE id = ?').run(status, att.id);
    db.prepare(
      'INSERT INTO attendance_audit (attendance_id, changed_by, old_status, new_status, reason) VALUES (?,?,?,?,?)'
    ).run(att.id, req.user.id, att.status, status, reason);
  });
  tx();
  res.json({ ok: true });
});

// This faculty's low-attendance students, across subjects they teach
router.get('/low-attendance', (req, res) => {
  const threshold = parseFloat(req.query.threshold) || 75;
  const rows = db.prepare(`
    SELECT st.id as student_id, st.name, st.roll_no, c.name as class_name, sub.name as subject_name,
      COUNT(a.id) as total_sessions,
      SUM(CASE WHEN a.status='present' OR a.status='late' THEN 1 ELSE 0 END) as attended
    FROM attendance a
    JOIN sessions ses ON ses.id = a.session_id
    JOIN students st ON st.id = a.student_id
    JOIN classes c ON c.id = st.class_id
    JOIN subjects sub ON sub.id = ses.subject_id
    WHERE ses.faculty_id = ?
    GROUP BY st.id, ses.subject_id
  `).all(req.user.id);
  const withPct = rows.map(r => ({
    ...r,
    percentage: r.total_sessions ? Math.round((r.attended / r.total_sessions) * 1000) / 10 : 0,
  })).filter(r => r.percentage < threshold).sort((a, b) => a.percentage - b.percentage);
  res.json({ threshold, students: withPct });
});

module.exports = router;
