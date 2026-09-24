# Smart Attendance Management — Approach Note

## 1. Problem Understanding

A college with ~5,000 students and 200 faculty needs a system to record attendance, correct
mistakes, review history, and flag students with low attendance. The brief deliberately leaves
users, workflows, permissions, data model, and architecture open, so the decisions below are
mine, made explicit so they can be discussed and challenged.

## 2. Users & Roles

I modeled two roles, which cover the core workflow end-to-end:

- **Admin** — manages master data (departments, classes/divisions, subjects, faculty, students,
  and which faculty teaches which subject to which class), views institution-wide low-attendance
  reports, and has final authority to correct any attendance record (with a mandatory reason,
  logged to an audit trail).
- **Faculty** — marks attendance for the classes/subjects they are assigned to, can correct
  attendance they entered within a time-bound correction window, and can view which of their own
  students are falling below an attendance threshold.

**Assumption / scope cut:** a read-only **Student** portal (to let students see their own %) is a
natural next step but was left out to keep the submission focused and fully working end-to-end
for the roles that actually *record* and *govern* attendance, which is where the hard product
decisions live (corrections, auditability, low-attendance detection). It would reuse the existing
`GET /students/:id` style summary query with a students table login — see "What I'd do next."

## 3. Core Data Model

```
departments 1---* classes 1---* subjects
users(role=faculty) *---* subjects (via faculty_subject, scoped to a class)
classes 1---* students
sessions (one class + one subject + one date + one period) 1---* attendance (one row per student)
attendance 1---* attendance_audit (every correction, old value, new value, reason, who, when)
```

Attendance is modeled at the **session** level (a specific class taught on a specific date and
period) rather than "mark absent for the day," because a real timetable has multiple periods
across multiple subjects per day, and low-attendance rules in most colleges are computed
per-subject, not just per-day. This also naturally supports partial-day attendance (a student
absent for period 3 but present for period 5).

## 4. Key Workflows

- **Recording:** faculty pick their class+subject, a date and period, get the roster, and mark
  each student Present / Late / Absent (defaults to Present, since that's the common case — the
  faculty member flips the exceptions rather than clicking through every student). Duplicate
  sessions (same class/subject/date/period) are rejected server-side so the same period can't be
  marked twice by accident.
- **Correction:** attendance is real-world data entered under time pressure, so mistakes are
  expected. Faculty can correct a record within a **48-hour window** of the session date. Every
  correction requires a typed reason and is written to an immutable `attendance_audit` table
  (old status → new status, who, when, why) — nothing is silently overwritten. After the window
  closes, the session is treated as effectively locked for that faculty member and only an Admin
  can override it (also logged), which mirrors how most institutions want a "cooling-off then
  escalate" correction policy rather than indefinite unaudited editing.
- **Review/History:** faculty see a session list with present/absent counts and can drill into any
  session to see every student's status and correct where allowed.
- **Low attendance:** computed on demand as `(present + late) / total_sessions`, filterable by
  threshold (default 75%, a common institutional cutoff), and by class/department/subject for
  admins. This is a query, not a stored/cached value, so it's always correct against the latest
  data — acceptable at this scale (a few thousand attendance rows per class) without needing a
  background job.

## 5. Architecture & Technology Choices

- **Backend:** Node.js + Express, exposing a REST API under `/api`. Chosen for minimal setup
  overhead so the grader can run it with two commands.
- **Database:** SQLite via `better-sqlite3` — a single file (`attendance.db`), zero external
  services to install, but a real relational schema with foreign keys, unique constraints, and
  transactions (used for the "write attendance + write audit row" and "create session + create
  all attendance rows" operations, so a partial failure can't leave inconsistent state).
- **Auth:** JWT bearer tokens, password hashes with bcrypt. Kept intentionally simple (no
  refresh-token rotation, no email verification) since the brief is about attendance product
  thinking, not building an auth system from scratch.
- **Frontend:** a single-page vanilla HTML/CSS/JS app (no build step) calling the REST API. This
  keeps "clone and run" trivial and keeps the UI code easy to read end-to-end, at the cost of some
  hand-rolled DOM templating that a framework like React would give for free at larger scale.
- **Why not a bigger stack:** at this problem's scope (a working prototype to demonstrate product
  and engineering judgement, not a production system for a real college), a heavier stack (React,
  Postgres, a job queue) would add setup friction without adding to the reviewer's ability to
  judge the decisions that actually matter here — the data model, the correction/audit workflow,
  and the low-attendance logic.

## 6. Edge Cases Considered

- **Duplicate marking** — same class/subject/date/period rejected with a 409, pointing the
  faculty member to the existing session instead of creating a duplicate.
- **Unauthorized marking** — a faculty member can only create sessions for class/subject
  combinations they're explicitly assigned to (checked server-side, not just hidden in the UI).
- **Correction after the window** — blocked server-side (not just UI-side) with a clear message,
  and routed to admin override instead of just failing silently.
- **Every correction is attributed and reasoned** — no attendance value can change without a
  logged actor, timestamp, old value, new value, and reason, which is the auditability the brief
  explicitly calls out.
- **Students with zero sessions** — excluded from the low-attendance % (an empty class or a
  brand-new student isn't flagged as "0% attendance," which would be misleading).
- **Soft delete for students** — removing a student sets `active = 0` rather than a hard delete,
  preserving historical attendance records for reporting/audit integrity.

## 7. Validation

- Manually exercised the full flow: seeded realistic data (3 departments' worth of classes,
  students, and faculty; two students seeded with deliberately poor attendance patterns) →
  logged in as faculty → marked attendance across sessions → confirmed the low-attendance report
  picks up the seeded low-attendance students → made a correction within the window → confirmed it
  appears with a reason in the Admin audit log → confirmed the API rejects a correction with no
  `reason` and rejects marking attendance for a class/subject the faculty member isn't assigned to.
- Server-side validation duplicates every check the UI makes (role checks, correction-window
  checks, required fields), since a UI restriction alone isn't a real guarantee.

## 8. What I'd Do Next (Given More Time)

- A read-only Student login to self-check attendance %, and notifications (email/SMS) when a
  student crosses below the threshold, rather than admins/faculty having to go looking.
- Bulk import of students/faculty via CSV instead of one-by-one forms.
- Pagination on the audit log and history tables once data volume grows well beyond the seed data.
- Configurable low-attendance threshold and correction-window length per institution, stored as
  settings rather than constants in code.
