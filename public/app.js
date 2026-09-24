// ---------------- State ----------------
let TOKEN = localStorage.getItem('sam_token') || null;
let USER = JSON.parse(localStorage.getItem('sam_user') || 'null');
let currentTab = null;

// ---------------- API helper ----------------
async function api(path, opts = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const res = await fetch(`/api${path}`, { ...opts, headers });
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ---------------- Auth ----------------
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';
  try {
    const data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    TOKEN = data.token; USER = data.user;
    localStorage.setItem('sam_token', TOKEN);
    localStorage.setItem('sam_user', JSON.stringify(USER));
    boot();
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById('logoutBtn').addEventListener('click', () => {
  TOKEN = null; USER = null;
  localStorage.removeItem('sam_token'); localStorage.removeItem('sam_user');
  boot();
});

// ---------------- Nav / Shell ----------------
const TABS = {
  admin: [
    ['overview', 'Overview'],
    ['manage', 'Manage Data'],
    ['lowattendance', 'Low Attendance'],
    ['audit', 'Audit Log'],
  ],
  faculty: [
    ['mark', 'Mark Attendance'],
    ['history', 'History'],
    ['lowattendance', 'My Low Attendance'],
  ],
};

function boot() {
  if (!TOKEN || !USER) {
    document.getElementById('loginView').classList.remove('hidden');
    document.getElementById('shell').classList.add('hidden');
    return;
  }
  document.getElementById('loginView').classList.add('hidden');
  document.getElementById('shell').classList.remove('hidden');
  document.getElementById('userName').textContent = `${USER.name} (${USER.role})`;

  const nav = document.getElementById('navTabs');
  nav.innerHTML = '';
  const tabs = TABS[USER.role] || [];
  tabs.forEach(([key, label]) => {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.onclick = () => setTab(key);
    btn.dataset.key = key;
    nav.appendChild(btn);
  });
  setTab(tabs[0][0]);
}

function setTab(key) {
  currentTab = key;
  document.querySelectorAll('.nav-tabs button').forEach(b => b.classList.toggle('active', b.dataset.key === key));
  const content = document.getElementById('mainContent');
  content.innerHTML = '<div class="empty-state">Loading…</div>';
  const renderer = USER.role === 'admin' ? adminViews[key] : facultyViews[key];
  if (renderer) renderer(content).catch(err => {
    content.innerHTML = `<div class="panel"><p class="error-text">${esc(err.message)}</p></div>`;
  });
}

// ================================================================
// ADMIN VIEWS
// ================================================================
const adminViews = {};

adminViews.overview = async (root) => {
  const stats = await api('/admin/reports/overview');
  root.innerHTML = `
    <h2 class="section-title">Institution Overview</h2>
    <div class="grid stats">
      ${statCard(stats.total_students, 'Active Students')}
      ${statCard(stats.total_faculty, 'Faculty Members')}
      ${statCard(stats.total_classes, 'Classes / Divisions')}
      ${statCard(stats.total_sessions, 'Attendance Sessions Recorded')}
      ${statCard(stats.todays_sessions, "Sessions Today")}
    </div>
    <div class="panel">
      <h3>Getting started</h3>
      <p class="muted">Use <strong>Manage Data</strong> to add departments, classes, subjects, faculty and students, and
      to assign faculty to subjects. Faculty then log in separately to mark attendance. Use
      <strong>Low Attendance</strong> to spot students falling below a threshold, and <strong>Audit Log</strong> to
      review every correction made to attendance records, with who made it and why.</p>
    </div>
  `;
};

function statCard(num, label) {
  return `<div class="stat-card"><div class="num">${esc(num)}</div><div class="label">${esc(label)}</div></div>`;
}

adminViews.manage = async (root) => {
  const [departments, classes, subjects, faculty, students, mappings] = await Promise.all([
    api('/admin/departments'), api('/admin/classes'), api('/admin/subjects'),
    api('/admin/faculty'), api('/admin/students'), api('/admin/faculty-subjects'),
  ]);

  root.innerHTML = `
    <h2 class="section-title">Manage Master Data</h2>

    <div class="panel">
      <h3>Departments</h3>
      <form id="deptForm" class="form-row">
        <div class="form-field"><label>Name</label><input name="name" required placeholder="e.g. Mechanical Engineering"></div>
        <button class="btn primary">Add Department</button>
      </form>
      ${table(['Name'], departments.map(d => [esc(d.name)]))}
    </div>

    <div class="panel">
      <h3>Classes / Divisions</h3>
      <form id="classForm" class="form-row">
        <div class="form-field"><label>Name</label><input name="name" required placeholder="e.g. CSE-C"></div>
        <div class="form-field"><label>Department</label>${selectOptions('department_id', departments)}</div>
        <div class="form-field"><label>Year</label><input name="year" type="number" min="1" max="5" value="1"></div>
        <button class="btn primary">Add Class</button>
      </form>
      ${table(['Name', 'Department', 'Year', 'Students'], classes.map(c => [esc(c.name), esc(c.department_name), c.year, c.student_count]))}
    </div>

    <div class="panel">
      <h3>Subjects</h3>
      <form id="subjectForm" class="form-row">
        <div class="form-field"><label>Name</label><input name="name" required placeholder="e.g. Data Structures"></div>
        <div class="form-field"><label>Code</label><input name="code" required placeholder="e.g. CS201"></div>
        <div class="form-field"><label>Class</label>${selectOptions('class_id', classes)}</div>
        <button class="btn primary">Add Subject</button>
      </form>
      ${table(['Subject', 'Code', 'Class'], subjects.map(s => [esc(s.name), esc(s.code), esc(s.class_name)]))}
    </div>

    <div class="panel">
      <h3>Faculty</h3>
      <form id="facultyForm" class="form-row">
        <div class="form-field"><label>Name</label><input name="name" required></div>
        <div class="form-field"><label>Email</label><input name="email" type="email" required></div>
        <div class="form-field"><label>Password</label><input name="password" type="text" required placeholder="temp password"></div>
        <div class="form-field"><label>Department</label>${selectOptions('department_id', departments)}</div>
        <button class="btn primary">Add Faculty</button>
      </form>
      ${table(['Name', 'Email'], faculty.map(f => [esc(f.name), esc(f.email)]))}
    </div>

    <div class="panel">
      <h3>Faculty → Subject Assignment</h3>
      <form id="mappingForm" class="form-row">
        <div class="form-field"><label>Faculty</label>${selectOptions('faculty_id', faculty)}</div>
        <div class="form-field"><label>Class</label>${selectOptions('class_id', classes)}</div>
        <div class="form-field"><label>Subject</label>${selectOptions('subject_id', subjects)}</div>
        <button class="btn primary">Assign</button>
      </form>
      ${table(['Faculty', 'Subject', 'Class', ''], mappings.map(m => [esc(m.faculty_name), esc(m.subject_name), esc(m.class_name), `<button class="link-btn" data-del-mapping="${m.id}">Remove</button>`]))}
    </div>

    <div class="panel">
      <h3>Students</h3>
      <form id="studentForm" class="form-row">
        <div class="form-field"><label>Name</label><input name="name" required></div>
        <div class="form-field"><label>Roll No</label><input name="roll_no" required></div>
        <div class="form-field"><label>Class</label>${selectOptions('class_id', classes)}</div>
        <button class="btn primary">Add Student</button>
      </form>
      ${table(['Roll No', 'Name', 'Class', ''], students.map(s => [esc(s.roll_no), esc(s.name), esc(s.class_name), `<button class="link-btn danger" data-del-student="${s.id}">Remove</button>`]))}
    </div>
  `;

  bindSimpleCreateForm('deptForm', '/admin/departments', {});
  bindSimpleCreateForm('classForm', '/admin/classes', { numeric: ['department_id', 'year'] });
  bindSimpleCreateForm('subjectForm', '/admin/subjects', { numeric: ['class_id'] });
  bindSimpleCreateForm('facultyForm', '/admin/faculty', { numeric: ['department_id'] });
  bindSimpleCreateForm('mappingForm', '/admin/faculty-subjects', { numeric: ['faculty_id', 'class_id', 'subject_id'] });
  bindSimpleCreateForm('studentForm', '/admin/students', {
    numeric: ['class_id'],
    extra: (fd, classesArr) => {
      const cls = classesArr.find(c => c.id === Number(fd.class_id));
      fd.department_id = cls ? cls.department_id : null;
    },
    extraArgs: classes,
  });

  root.querySelectorAll('[data-del-mapping]').forEach(btn => btn.onclick = async () => {
    await api(`/admin/faculty-subjects/${btn.dataset.delMapping}`, { method: 'DELETE' });
    setTab('manage');
  });
  root.querySelectorAll('[data-del-student]').forEach(btn => btn.onclick = async () => {
    if (!confirm('Remove this student?')) return;
    await api(`/admin/students/${btn.dataset.delStudent}`, { method: 'DELETE' });
    setTab('manage');
  });
};

function bindSimpleCreateForm(formId, endpoint, { numeric = [], extra, extraArgs } = {}) {
  const form = document.getElementById(formId);
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form).entries());
    numeric.forEach(k => { if (fd[k] !== undefined && fd[k] !== '') fd[k] = Number(fd[k]); });
    if (extra) extra(fd, extraArgs);
    try {
      await api(endpoint, { method: 'POST', body: JSON.stringify(fd) });
      toast('Saved');
      setTab('manage');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

adminViews.lowattendance = async (root) => {
  const [classes, subjects] = await Promise.all([api('/admin/classes'), api('/admin/subjects')]);
  root.innerHTML = `
    <h2 class="section-title">Low Attendance Report</h2>
    <div class="panel">
      <form id="filterForm" class="form-row">
        <div class="form-field"><label>Threshold %</label><input name="threshold" type="number" value="75" min="1" max="100"></div>
        <div class="form-field"><label>Class</label>${selectOptions('class_id', classes, true)}</div>
        <div class="form-field"><label>Subject</label>${selectOptions('subject_id', subjects, true)}</div>
        <button class="btn primary">Apply</button>
      </form>
      <div id="lowAttResults"></div>
    </div>
  `;
  const form = document.getElementById('filterForm');
  const runReport = async () => {
    const fd = Object.fromEntries(new FormData(form).entries());
    const params = new URLSearchParams(Object.entries(fd).filter(([,v]) => v !== ''));
    const data = await api(`/admin/reports/low-attendance?${params.toString()}`);
    document.getElementById('lowAttResults').innerHTML = renderLowAttendanceTable(data.students, true);
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); runReport(); });
  runReport();
};

adminViews.audit = async (root) => {
  const rows = await api('/admin/audit-log');
  root.innerHTML = `
    <h2 class="section-title">Attendance Correction Audit Log</h2>
    <div class="panel">
      ${rows.length ? table(
        ['When', 'Student', 'Subject', 'Session Date', 'Changed By', 'Change', 'Reason'],
        rows.map(r => [
          new Date(r.changed_at + 'Z').toLocaleString(),
          `${esc(r.student_name)} (${esc(r.roll_no)})`,
          esc(r.subject_name),
          `${r.date} · P${r.period}`,
          esc(r.changed_by_name),
          `${statusBadge(r.old_status)} → ${statusBadge(r.new_status)}`,
          esc(r.reason),
        ])
      ) : '<div class="empty-state">No corrections have been made yet.</div>'}
    </div>
  `;
};

// ================================================================
// FACULTY VIEWS
// ================================================================
const facultyViews = {};

facultyViews.mark = async (root) => {
  const mySubjects = await api('/faculty/my-subjects');
  if (!mySubjects.length) {
    root.innerHTML = `<div class="panel empty-state">You have not been assigned to any class/subject yet. Contact an admin.</div>`;
    return;
  }
  root.innerHTML = `
    <h2 class="section-title">Mark Attendance</h2>
    <div class="panel">
      <div class="form-row">
        <div class="form-field"><label>Class & Subject</label>
          <select id="mapSelect">
            ${mySubjects.map(m => `<option value="${m.class_id}|${m.subject_id}">${esc(m.class_name)} — ${esc(m.subject_name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-field"><label>Date</label><input type="date" id="sessDate" value="${new Date().toISOString().slice(0,10)}"></div>
        <div class="form-field"><label>Period</label>
          <select id="sessPeriod">${[1,2,3,4,5,6,7,8].map(p => `<option value="${p}">Period ${p}</option>`).join('')}</select>
        </div>
        <button id="loadRosterBtn" class="btn">Load Roster</button>
        <button id="markAllPresentBtn" class="btn">Mark All Present</button>
      </div>
      <div id="rosterArea"></div>
    </div>
  `;
  let roster = [];
  let statuses = {};

  async function loadRoster() {
    const [classId] = document.getElementById('mapSelect').value.split('|');
    roster = await api(`/faculty/roster?class_id=${classId}`);
    statuses = {};
    roster.forEach(s => statuses[s.id] = 'present');
    renderRoster();
  }

  function renderRoster() {
    const area = document.getElementById('rosterArea');
    if (!roster.length) { area.innerHTML = '<div class="empty-state">No students in this class.</div>'; return; }
    area.innerHTML = `
      <table>
        <thead><tr><th>Roll No</th><th>Name</th><th>Status</th></tr></thead>
        <tbody>
          ${roster.map(s => `
            <tr>
              <td>${esc(s.roll_no)}</td>
              <td>${esc(s.name)}</td>
              <td>
                <div class="status-toggle-group" data-student="${s.id}">
                  <button data-status="present" class="${statuses[s.id]==='present'?'active present':''}">Present</button>
                  <button data-status="late" class="${statuses[s.id]==='late'?'active late':''}">Late</button>
                  <button data-status="absent" class="${statuses[s.id]==='absent'?'active absent':''}">Absent</button>
                </div>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
      <div class="form-row" style="margin-top:16px;">
        <button id="submitAttendanceBtn" class="btn primary">Submit Attendance</button>
        <span class="muted" id="rosterSummary"></span>
      </div>
    `;
    area.querySelectorAll('.status-toggle-group button').forEach(btn => {
      btn.onclick = () => {
        const group = btn.parentElement;
        statuses[group.dataset.student] = btn.dataset.status;
        renderRoster();
      };
    });
    document.getElementById('submitAttendanceBtn').onclick = submitAttendance;
    const present = Object.values(statuses).filter(s => s === 'present' || s === 'late').length;
    document.getElementById('rosterSummary').textContent = `${present}/${roster.length} marked present/late`;
  }

  async function submitAttendance() {
    const [classId, subjectId] = document.getElementById('mapSelect').value.split('|');
    const date = document.getElementById('sessDate').value;
    const period = document.getElementById('sessPeriod').value;
    const attendance = roster.map(s => ({ student_id: s.id, status: statuses[s.id] }));
    try {
      await api('/faculty/sessions', {
        method: 'POST',
        body: JSON.stringify({ class_id: Number(classId), subject_id: Number(subjectId), date, period: Number(period), attendance }),
      });
      toast('Attendance submitted');
      setTab('history');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  document.getElementById('loadRosterBtn').onclick = loadRoster;
  document.getElementById('markAllPresentBtn').onclick = () => { roster.forEach(s => statuses[s.id] = 'present'); renderRoster(); };
  loadRoster();
};

facultyViews.history = async (root) => {
  const sessions = await api('/faculty/sessions');
  root.innerHTML = `
    <h2 class="section-title">Attendance History</h2>
    <div class="panel">
      ${sessions.length ? table(
        ['Date', 'Period', 'Class', 'Subject', 'Present', 'Absent', 'Total', ''],
        sessions.map(s => [
          s.date, `P${s.period}`, esc(s.class_name), esc(s.subject_name),
          s.present_count, s.absent_count, s.total,
          `<button class="link-btn" data-view-session="${s.id}">View / Correct</button>`,
        ])
      ) : '<div class="empty-state">No sessions recorded yet. Mark attendance to see history here.</div>'}
    </div>
    <div id="sessionDetail"></div>
  `;
  root.querySelectorAll('[data-view-session]').forEach(btn => btn.onclick = () => viewSession(btn.dataset.viewSession));
};

async function viewSession(id) {
  const data = await api(`/faculty/sessions/${id}`);
  const area = document.getElementById('sessionDetail');
  area.innerHTML = `
    <div class="panel">
      <h3>${data.session.date} · Period ${data.session.period}
        ${data.editable ? '<span class="muted">(editable within 48h correction window)</span>' : '<span class="badge low">Locked — contact admin to correct</span>'}
      </h3>
      <table>
        <thead><tr><th>Roll No</th><th>Name</th><th>Status</th>${data.editable ? '<th>Correct</th>' : ''}</tr></thead>
        <tbody>
          ${data.students.map(s => `
            <tr>
              <td>${esc(s.roll_no)}</td>
              <td>${esc(s.name)}</td>
              <td>${statusBadge(s.status)}</td>
              ${data.editable ? `<td>
                <select data-correct-status="${s.attendance_id}">
                  <option value="present" ${s.status==='present'?'selected':''}>Present</option>
                  <option value="late" ${s.status==='late'?'selected':''}>Late</option>
                  <option value="absent" ${s.status==='absent'?'selected':''}>Absent</option>
                </select>
                <button class="link-btn" data-save-correction="${s.attendance_id}">Save</button>
              </td>` : ''}
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
  if (data.editable) {
    area.querySelectorAll('[data-save-correction]').forEach(btn => {
      btn.onclick = async () => {
        const attId = btn.dataset.saveCorrection;
        const status = area.querySelector(`[data-correct-status="${attId}"]`).value;
        const reason = prompt('Reason for correction (required for audit trail):');
        if (!reason) return;
        try {
          await api(`/faculty/attendance/${attId}`, { method: 'PUT', body: JSON.stringify({ status, reason }) });
          toast('Correction saved');
          viewSession(data.session.id);
        } catch (err) {
          toast(err.message, 'error');
        }
      };
    });
  }
}

facultyViews.lowattendance = async (root) => {
  root.innerHTML = `
    <h2 class="section-title">My Students — Low Attendance</h2>
    <div class="panel">
      <div class="form-row">
        <div class="form-field"><label>Threshold %</label><input id="threshInput" type="number" value="75" min="1" max="100"></div>
        <button id="applyThreshBtn" class="btn primary">Apply</button>
      </div>
      <div id="lowAttResults"></div>
    </div>
  `;
  const run = async () => {
    const threshold = document.getElementById('threshInput').value;
    const data = await api(`/faculty/low-attendance?threshold=${threshold}`);
    document.getElementById('lowAttResults').innerHTML = renderLowAttendanceTable(data.students, false);
  };
  document.getElementById('applyThreshBtn').onclick = run;
  run();
};

// ================================================================
// Shared render helpers
// ================================================================
function table(headers, rows) {
  if (!rows.length) return '<div class="empty-state">No data yet.</div>';
  return `
    <table>
      <thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>
  `;
}

function selectOptions(name, items, includeBlank = false) {
  return `<select name="${name}">
    ${includeBlank ? '<option value="">All</option>' : ''}
    ${items.map(i => `<option value="${i.id}">${esc(i.name)}</option>`).join('')}
  </select>`;
}

function statusBadge(status) {
  return `<span class="badge ${status}">${status}</span>`;
}

function renderLowAttendanceTable(students, showClass) {
  if (!students.length) return '<div class="empty-state">No students below this threshold. 🎉</div>';
  const headers = showClass
    ? ['Roll No', 'Name', 'Class', '%', 'Attended / Total']
    : ['Roll No', 'Name', 'Subject', '%', 'Attended / Total'];
  return table(headers, students.map(s => [
    esc(s.roll_no), esc(s.name), esc(s.class_name || s.subject_name),
    pctCell(s.percentage), `${s.attended} / ${s.total_sessions}`,
  ]));
}

function pctCell(pct) {
  const color = pct < 50 ? '#dc2626' : pct < 75 ? '#d97706' : '#16a34a';
  return `<span class="pct-bar-wrap"><span class="pct-bar" style="width:${Math.min(pct,100)}%;background:${color}"></span></span>${pct}%`;
}

// ---------------- Init ----------------
boot();
