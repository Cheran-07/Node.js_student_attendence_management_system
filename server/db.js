// Uses Node's built-in node:sqlite module (stable/unflagged since Node 22.5+,
// no native compilation required — this avoids the Visual Studio Build Tools /
// node-gyp requirement that a native addon like better-sqlite3 needs on Windows).
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'attendance.db');
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// node:sqlite's DatabaseSync has no built-in `.transaction()` helper the way
// better-sqlite3 does, so we add a small shim with the same call shape
// (`db.transaction(fn)` returns a function; calling that function runs `fn`
// wrapped in BEGIN/COMMIT, rolling back on any thrown error) so the rest of
// the codebase can use it identically.
db.transaction = function (fn) {
  return function (...args) {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
};

// ---------- SCHEMA ----------
db.exec(`
CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS classes ( -- a "division", e.g. CSE-A, Year 2
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,           -- e.g. "CSE-A"
  department_id INTEGER NOT NULL REFERENCES departments(id),
  year INTEGER NOT NULL DEFAULT 1,
  UNIQUE(name, department_id)
);

CREATE TABLE IF NOT EXISTS subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  class_id INTEGER NOT NULL REFERENCES classes(id),
  UNIQUE(code, class_id)
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','faculty')),
  department_id INTEGER REFERENCES departments(id),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS faculty_subject ( -- which faculty teaches which subject to which class
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  faculty_id INTEGER NOT NULL REFERENCES users(id),
  subject_id INTEGER NOT NULL REFERENCES subjects(id),
  class_id INTEGER NOT NULL REFERENCES classes(id),
  UNIQUE(faculty_id, subject_id, class_id)
);

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  roll_no TEXT NOT NULL,
  class_id INTEGER NOT NULL REFERENCES classes(id),
  department_id INTEGER NOT NULL REFERENCES departments(id),
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(roll_no, class_id)
);

-- One "session" = one class taught, one subject, one date+period. Attendance is per-student within a session.
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL REFERENCES classes(id),
  subject_id INTEGER NOT NULL REFERENCES subjects(id),
  faculty_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,        -- YYYY-MM-DD
  period INTEGER NOT NULL,   -- 1..8
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  locked INTEGER NOT NULL DEFAULT 0, -- locked sessions require admin to correct
  UNIQUE(class_id, subject_id, date, period)
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  status TEXT NOT NULL CHECK(status IN ('present','absent','late')),
  remarks TEXT,
  UNIQUE(session_id, student_id)
);

CREATE TABLE IF NOT EXISTS attendance_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attendance_id INTEGER NOT NULL REFERENCES attendance(id),
  changed_by INTEGER NOT NULL REFERENCES users(id),
  old_status TEXT NOT NULL,
  new_status TEXT NOT NULL,
  reason TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

module.exports = db;
