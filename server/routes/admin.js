const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

// ---------- DEPARTMENTS ----------
router.get('/departments', (req, res) => {
  res.json(db.prepare('SELECT * FROM departments ORDER BY name').all());
});
router.post('/departments', (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const info = db.prepare('INSERT INTO departments (name) VALUES (?)').run(name.trim());
    res.status(201).json({ id: info.lastInsertRowid, name });
  } catch (e) {
    res.status(409).json({ error: 'Department already exists' });
  }
});

// ---------- CLASSES ----------
router.get('/classes', (req, res) => {
  res.json(
    db.prepare(`
      SELECT c.*, d.name as department_name,
        (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND s.active = 1) as student_count
      FROM classes c JOIN departments d ON d.id = c.department_id
      ORDER BY d.name, c.name
    `).all()
  );
});
router.post('/classes', (req, res) => {
  const { name, department_id, year } = req.body || {};
  if (!name || !department_id) return res.status(400).json({ error: 'name and department_id are required' });
  try {
    const info = db.prepare('INSERT INTO classes (name, department_id, year) VALUES (?,?,?)')
      .run(name.trim(), department_id, year || 1);
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (e) {
    res.status(409).json({ error: 'Class already exists in this department' });
  }
});

// ---------- SUBJECTS ----------
router.get('/subjects', (req, res) => {
  res.json(
    db.prepare(`
      SELECT sub.*, c.name as class_name FROM subjects sub
      JOIN classes c ON c.id = sub.class_id ORDER BY c.name, sub.name
    `).all()
  );
});
router.post('/subjects', (req, res) => {
  const { name, code, class_id } = req.body || {};
  if (!name || !code || !class_id) return res.status(400).json({ error: 'name, code, class_id are required' });
  try {
    const info = db.prepare('INSERT INTO subjects (name, code, class_id) VALUES (?,?,?)')
      .run(name.trim(), code.trim(), class_id);
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (e) {
    res.status(409).json({ error: 'Subject code already exists for this class' });
  }
});

// ---------- FACULTY (users with role=faculty) ----------
router.get('/faculty', (req, res) => {
  res.json(
    db.prepare(`SELECT id, name, email, department_id, active FROM users WHERE role='faculty' ORDER BY name`).all()
  );
});
router.post('/faculty', (req, res) => {
  const { name, email, password, department_id } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email, password are required' });
  try {
    const hash = bcrypt.hashSync(password, 8);
    const info = db.prepare(
      'INSERT INTO users (name, email, password_hash, role, department_id) VALUES (?,?,?,\'faculty\',?)'
    ).run(name.trim(), email.toLowerCase().trim(), hash, department_id || null);
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (e) {
    res.status(409).json({ error: 'Email already in use' });
  }
});

// ---------- FACULTY-SUBJECT MAPPING ----------
router.get('/faculty-subjects', (req, res) => {
  res.json(
    db.prepare(`
      SELECT fs.id, u.name as faculty_name, u.id as faculty_id,
             sub.name as subject_name, sub.id as subject_id,
             c.name as class_name, c.id as class_id
      FROM faculty_subject fs
      JOIN users u ON u.id = fs.faculty_id
      JOIN subjects sub ON sub.id = fs.subject_id
      JOIN classes c ON c.id = fs.class_id
      ORDER BY u.name
    `).all()
  );
});
router.post('/faculty-subjects', (req, res) => {
  const { faculty_id, subject_id, class_id } = req.body || {};
  if (!faculty_id || !subject_id || !class_id)
    return res.status(400).json({ error: 'faculty_id, subject_id, class_id are required' });
  try {
    const info = db.prepare('INSERT INTO faculty_subject (faculty_id, subject_id, class_id) VALUES (?,?,?)')
      .run(faculty_id, subject_id, class_id);
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (e) {
    res.status(409).json({ error: 'This mapping already exists' });
  }
});
router.delete('/faculty-subjects/:id', (req, res) => {
  db.prepare('DELETE FROM faculty_subject WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- STUDENTS ----------
router.get('/students', (req, res) => {
  const { class_id } = req.query;
  let rows;
  if (class_id) {
    rows = db.prepare(`
      SELECT s.*, c.name as class_name FROM students s
      JOIN classes c ON c.id = s.class_id WHERE s.class_id = ? AND s.active = 1 ORDER BY s.roll_no
    `).all(class_id);
  } else {
    rows = db.prepare(`
      SELECT s.*, c.name as class_name FROM students s
      JOIN classes c ON c.id = s.class_id WHERE s.active = 1 ORDER BY c.name, s.roll_no
    `).all();
  }
  res.json(rows);
});
router.post('/students', (req, res) => {
  const { name, roll_no, class_id, department_id } = req.body || {};
  if (!name || !roll_no || !class_id || !department_id)
    return res.status(400).json({ error: 'name, roll_no, class_id, department_id are required' });
  try {
    const info = db.prepare('INSERT INTO students (name, roll_no, class_id, department_id) VALUES (?,?,?,?)')
      .run(name.trim(), roll_no.trim(), class_id, department_id);
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (e) {
    res.status(409).json({ error: 'Roll number already exists in this class' });
  }
});
router.delete('/students/:id', (req, res) => {
  db.prepare('UPDATE students SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- REPORTS: OVERVIEW ----------
router.get('/reports/overview', (req, res) => {
  const totals = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM students WHERE active = 1) as total_students,
      (SELECT COUNT(*) FROM users WHERE role='faculty') as total_faculty,
      (SELECT COUNT(*) FROM classes) as total_classes,
      (SELECT COUNT(*) FROM sessions) as total_sessions
  `).get();
  const todaysSessions = db.prepare(`SELECT COUNT(*) c FROM sessions WHERE date = date('now')`).get().c;
  res.json({ ...totals, todays_sessions: todaysSessions });
});

// ---------- REPORTS: LOW ATTENDANCE ----------
// Overall % per student across all sessions they were expected in, optionally filtered.
router.get('/reports/low-attendance', (req, res) => {
  const threshold = parseFloat(req.query.threshold) || 75;
  const { class_id, department_id, subject_id } = req.query;

  let query = `
    SELECT st.id as student_id, st.name, st.roll_no, c.name as class_name, d.name as department_name,
      COUNT(a.id) as total_sessions,
      SUM(CASE WHEN a.status = 'present' OR a.status = 'late' THEN 1 ELSE 0 END) as attended
    FROM students st
    JOIN classes c ON c.id = st.class_id
    JOIN departments d ON d.id = st.department_id
    JOIN attendance a ON a.student_id = st.id
    JOIN sessions ses ON ses.id = a.session_id
    WHERE st.active = 1
  `;
  const params = [];
  if (class_id) { query += ' AND st.class_id = ?'; params.push(class_id); }
  if (department_id) { query += ' AND st.department_id = ?'; params.push(department_id); }
  if (subject_id) { query += ' AND ses.subject_id = ?'; params.push(subject_id); }
  query += ' GROUP BY st.id';

  const rows = db.prepare(query).all(...params);
  const withPct = rows.map(r => ({
    ...r,
    percentage: r.total_sessions ? Math.round((r.attended / r.total_sessions) * 1000) / 10 : 0,
  }));
  const low = withPct.filter(r => r.percentage < threshold).sort((a, b) => a.percentage - b.percentage);
  res.json({ threshold, count: low.length, students: low });
});

// ---------- AUDIT LOG ----------
router.get('/audit-log', (req, res) => {
  const rows = db.prepare(`
    SELECT aa.*, u.name as changed_by_name, st.name as student_name, st.roll_no,
           sub.name as subject_name, ses.date, ses.period
    FROM attendance_audit aa
    JOIN users u ON u.id = aa.changed_by
    JOIN attendance a ON a.id = aa.attendance_id
    JOIN students st ON st.id = a.student_id
    JOIN sessions ses ON ses.id = a.session_id
    JOIN subjects sub ON sub.id = ses.subject_id
    ORDER BY aa.changed_at DESC LIMIT 200
  `).all();
  res.json(rows);
});

// Admin can correct attendance even on locked sessions (bypasses the faculty correction window)
router.put('/attendance/:attendanceId', (req, res) => {
  const { status, reason } = req.body || {};
  if (!status || !reason) return res.status(400).json({ error: 'status and reason are required' });
  const att = db.prepare('SELECT * FROM attendance WHERE id = ?').get(req.params.attendanceId);
  if (!att) return res.status(404).json({ error: 'Attendance record not found' });

  const tx = db.transaction(() => {
    db.prepare('UPDATE attendance SET status = ? WHERE id = ?').run(status, att.id);
    db.prepare(
      'INSERT INTO attendance_audit (attendance_id, changed_by, old_status, new_status, reason) VALUES (?,?,?,?,?)'
    ).run(att.id, req.user.id, att.status, status, reason);
  });
  tx();
  res.json({ ok: true });
});

module.exports = router;
