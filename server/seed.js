const bcrypt = require('bcryptjs');
const db = require('./db');

function seed() {
  const existing = db.prepare('SELECT COUNT(*) c FROM users').get();
  if (existing.c > 0) {
    console.log('Database already seeded. Skipping. (Delete attendance.db to reseed.)');
    return;
  }

  const insertDept = db.prepare('INSERT INTO departments (name) VALUES (?)');
  const deptIds = {
    CSE: insertDept.run('Computer Science').lastInsertRowid,
    ECE: insertDept.run('Electronics & Communication').lastInsertRowid,
  };

  const insertClass = db.prepare('INSERT INTO classes (name, department_id, year) VALUES (?,?,?)');
  const cseA = insertClass.run('CSE-A', deptIds.CSE, 2).lastInsertRowid;
  const cseB = insertClass.run('CSE-B', deptIds.CSE, 2).lastInsertRowid;
  const eceA = insertClass.run('ECE-A', deptIds.ECE, 1).lastInsertRowid;

  const insertSubject = db.prepare('INSERT INTO subjects (name, code, class_id) VALUES (?,?,?)');
  const subDS = insertSubject.run('Data Structures', 'CS201', cseA).lastInsertRowid;
  const subDBMS = insertSubject.run('DBMS', 'CS202', cseA).lastInsertRowid;
  const subOS_B = insertSubject.run('Operating Systems', 'CS203', cseB).lastInsertRowid;
  const subCkts = insertSubject.run('Circuit Theory', 'EC101', eceA).lastInsertRowid;

  const insertUser = db.prepare(
    'INSERT INTO users (name, email, password_hash, role, department_id) VALUES (?,?,?,?,?)'
  );
  const hash = (pw) => bcrypt.hashSync(pw, 8);

  const adminId = insertUser.run('Admin User', 'admin@college.edu', hash('admin123'), 'admin', null).lastInsertRowid;
  const fac1 = insertUser.run('Dr. Meera Rao', 'meera.rao@college.edu', hash('faculty123'), 'faculty', deptIds.CSE).lastInsertRowid;
  const fac2 = insertUser.run('Prof. Arjun Iyer', 'arjun.iyer@college.edu', hash('faculty123'), 'faculty', deptIds.CSE).lastInsertRowid;
  const fac3 = insertUser.run('Dr. Kavya Nair', 'kavya.nair@college.edu', hash('faculty123'), 'faculty', deptIds.ECE).lastInsertRowid;

  const mapFS = db.prepare('INSERT INTO faculty_subject (faculty_id, subject_id, class_id) VALUES (?,?,?)');
  mapFS.run(fac1, subDS, cseA);
  mapFS.run(fac1, subDBMS, cseA);
  mapFS.run(fac2, subOS_B, cseB);
  mapFS.run(fac3, subCkts, eceA);

  const insertStudent = db.prepare(
    'INSERT INTO students (name, roll_no, class_id, department_id) VALUES (?,?,?,?)'
  );
  const cseAStudents = [
    'Aarav Sharma','Diya Patel','Vihaan Reddy','Ananya Iyer','Kabir Singh',
    'Ishaan Gupta','Sara Khan','Riya Menon','Aditya Nair','Meera Pillai',
    'Rohan Verma','Sneha Joshi','Arnav Malhotra','Priya Desai','Karthik Raman'
  ];
  cseAStudents.forEach((name, i) =>
    insertStudent.run(name, `CSA${String(i + 1).padStart(3, '0')}`, cseA, deptIds.CSE)
  );

  const cseBStudents = ['Neha Bhat','Yash Kapoor','Tanya Rao','Dev Shah','Isha Kulkarni'];
  cseBStudents.forEach((name, i) =>
    insertStudent.run(name, `CSB${String(i + 1).padStart(3, '0')}`, cseB, deptIds.CSE)
  );

  const eceAStudents = ['Vivaan Menon','Aisha Khan','Reyansh Rao','Anika Sharma'];
  eceAStudents.forEach((name, i) =>
    insertStudent.run(name, `ECA${String(i + 1).padStart(3, '0')}`, eceA, deptIds.ECE)
  );

  // Generate ~15 days of historical attendance for CSE-A / Data Structures so the
  // low-attendance report and history views have realistic data out of the box.
  const insertSession = db.prepare(
    'INSERT INTO sessions (class_id, subject_id, faculty_id, date, period) VALUES (?,?,?,?,?)'
  );
  const insertAttendance = db.prepare(
    'INSERT INTO attendance (session_id, student_id, status) VALUES (?,?,?)'
  );
  const cseAStudentRows = db.prepare('SELECT id FROM students WHERE class_id = ?').all(cseA);

  const today = new Date();
  for (let d = 14; d >= 1; d--) {
    const date = new Date(today);
    date.setDate(date.getDate() - d);
    const dateStr = date.toISOString().slice(0, 10);
    const sessionId = insertSession.run(cseA, subDS, fac1, dateStr, 1).lastInsertRowid;
    cseAStudentRows.forEach((s, idx) => {
      // Make a couple of students chronically absent to demonstrate the low-attendance report
      let status = 'present';
      if (idx === 3) status = Math.random() < 0.7 ? 'absent' : 'present'; // Ananya Iyer - low attendance
      else if (idx === 7) status = Math.random() < 0.5 ? 'absent' : 'present'; // Riya Menon - borderline
      else status = Math.random() < 0.08 ? 'absent' : 'present';
      insertAttendance.run(sessionId, s.id, status);
    });
  }

  console.log('Seed complete.');
  console.log('----------------------------------------');
  console.log('Admin login:    admin@college.edu / admin123');
  console.log('Faculty login:  meera.rao@college.edu / faculty123 (teaches CSE-A: Data Structures, DBMS)');
  console.log('Faculty login:  arjun.iyer@college.edu / faculty123 (teaches CSE-B: Operating Systems)');
  console.log('Faculty login:  kavya.nair@college.edu / faculty123 (teaches ECE-A: Circuit Theory)');
  console.log('----------------------------------------');
}

seed();
