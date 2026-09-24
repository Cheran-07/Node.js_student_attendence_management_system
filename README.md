# Smart Attendance Management

A working prototype for **Assignment 1 — Smart Attendance Management** Edumerge Solutions
Pre-Drive Product Engineering Assignment.

See **APPROACH.md** for the full write-up: problem understanding, product decisions, data model,
architecture, trade-offs, edge cases, and validation. See **AI_USAGE_REPORT.md** for the mandatory
AI usage disclosure.

## Requirements

- Node.js 18+ (tested on Node 22)
- No external database needed — uses SQLite (a local file, created automatically)

## Setup & Run

```bash
npm install
npm run seed     # creates attendance.db and loads sample data (departments, classes,
                  # subjects, faculty, students, and ~2 weeks of attendance history)
npm start
```

Then open **http://localhost:3000**

To reset all data, stop the server, delete `attendance.db`, and run `npm run seed` again.

## Demo Logins

| Role    | Email                     | Password    | Notes                                   |
|---------|----------------------------|-------------|------------------------------------------|
| Admin   | admin@college.edu          | admin123    | Full access to master data & reports     |
| Faculty | meera.rao@college.edu      | faculty123  | Teaches CSE-A: Data Structures, DBMS     |
| Faculty | arjun.iyer@college.edu     | faculty123  | Teaches CSE-B: Operating Systems         |
| Faculty | kavya.nair@college.edu     | faculty123  | Teaches ECE-A: Circuit Theory            |

**Suggested walkthrough:**
1. Log in as **admin@college.edu** → Overview, then Manage Data to see/add departments, classes,
   subjects, faculty and student-teacher mappings → Low Attendance report → Audit Log.
2. Log in as **meera.rao@college.edu** → Mark Attendance for CSE-A / Data Structures →
   History → open a recent session and correct a student's status (a reason is required, and it
   will appear in the Admin's Audit Log) → My Low Attendance.

## Project Structure

```
attendance-app/
├── server/
│   ├── server.js        # Express app entry point
│   ├── db.js             # SQLite connection + schema
│   ├── auth.js            # JWT auth middleware
│   ├── seed.js            # Sample data generator
│   └── routes/
│       ├── auth.js        # /api/auth/*
│       ├── admin.js        # /api/admin/* (master data, reports, audit log)
│       └── faculty.js       # /api/faculty/* (mark, roster, history, corrections)
├── public/
│   ├── index.html         # SPA shell
│   ├── app.js               # Frontend logic (vanilla JS)
│   └── style.css             # Styling
├── package.json
```

## API Overview

All endpoints except `/api/auth/login` and `/api/health` require `Authorization: Bearer <token>`.

- `POST /api/auth/login`, `GET /api/auth/me`
- **Admin:** CRUD for `/departments`, `/classes`, `/subjects`, `/faculty`, `/students`,
  `/faculty-subjects`; `GET /reports/overview`, `GET /reports/low-attendance`,
  `GET /audit-log`, `PUT /attendance/:id` (admin override correction)
- **Faculty:** `GET /my-subjects`, `GET /roster`, `POST /sessions` (mark attendance),
  `GET /sessions`, `GET /sessions/:id`, `PUT /attendance/:id` (correction within 48h window),
  `GET /low-attendance`
