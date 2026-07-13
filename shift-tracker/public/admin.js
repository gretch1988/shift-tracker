const API = '';
const app = document.getElementById('app');

let token = localStorage.getItem('admin_token') || null;
let adminName = localStorage.getItem('admin_name') || '';
let tab = 'shifts';
let employeesCache = [];
let shiftsCache = [];
let positionsCache = [];
let filters = { employee_id: '', from: '', to: '', status: '' };
let msg = { text: '', type: '' };

async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) logout();
    throw new Error(json.error || 'Server error');
  }
  return json;
}

function logout() {
  token = null;
  localStorage.removeItem('admin_token');
  localStorage.removeItem('admin_name');
  render();
}

function fmtDT(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtDisplay(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function fmtDuration(min) {
  if (min === null || min === undefined) return '—';
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}
function fmtMoney(amount) {
  if (amount === null || amount === undefined) return '—';
  return `$${Number(amount).toFixed(2)}`;
}

// ---------- Login ----------

function renderLogin() {
  app.innerHTML = `
    <div class="card" style="margin: 10vh auto;">
      <h1>Admin Panel</h1>
      <div class="field">
        <label>Admin PIN</label>
        <input type="password" id="adminPin" inputmode="numeric" autofocus />
      </div>
      <div class="msg ${msg.type}">${msg.text}</div>
      <button class="btn btn-primary" id="loginBtn">Log In</button>
      <div class="link-row"><a href="/index.html">← Back to kiosk</a></div>
    </div>
  `;
  const pinInput = document.getElementById('adminPin');
  document.getElementById('loginBtn').addEventListener('click', doLogin);
  pinInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
}

async function doLogin() {
  const pin = document.getElementById('adminPin').value;
  try {
    const result = await api('/api/admin/login', { method: 'POST', body: { pin }, auth: false });
    token = result.token;
    adminName = result.full_name;
    localStorage.setItem('admin_token', token);
    localStorage.setItem('admin_name', adminName);
    msg = { text: '', type: '' };
    render();
  } catch (e) {
    msg = { text: e.message, type: 'error' };
    render();
  }
}

// ---------- Dashboard shell ----------

async function renderDashboard() {
  app.innerHTML = `
    <div class="admin-card">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 16px;">
        <h2>Shift Tracker — ${adminName}</h2>
        <button class="btn btn-ghost btn-sm" id="logoutBtn">Log Out</button>
      </div>
      <div class="tabs">
        <button class="btn btn-sm ${tab === 'shifts' ? 'active' : 'btn-ghost'}" data-tab="shifts">Shifts</button>
        <button class="btn btn-sm ${tab === 'employees' ? 'active' : 'btn-ghost'}" data-tab="employees">Employees</button>
        <button class="btn btn-sm ${tab === 'positions' ? 'active' : 'btn-ghost'}" data-tab="positions">Positions & Checklists</button>
      </div>
      <div id="tabContent"></div>
    </div>
  `;
  document.getElementById('logoutBtn').addEventListener('click', logout);
  app.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => { tab = b.dataset.tab; render(); })
  );

  try {
    employeesCache = await api('/api/admin/employees');
    positionsCache = await api('/api/admin/positions');
  } catch (e) { /* handled by api() */ }

  if (tab === 'shifts') renderShiftsTab();
  else if (tab === 'employees') renderEmployeesTab();
  else renderPositionsTab();
}

// ---------- Shifts tab ----------

async function loadShifts() {
  const params = new URLSearchParams();
  if (filters.employee_id) params.set('employee_id', filters.employee_id);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.status) params.set('status', filters.status);
  shiftsCache = await api('/api/admin/shifts?' + params.toString());
}

async function renderShiftsTab() {
  const el = document.getElementById('tabContent');
  el.innerHTML = `<p>Loading…</p>`;
  try {
    await loadShifts();
  } catch (e) {
    el.innerHTML = `<div class="msg error">${e.message}</div>`;
    return;
  }

  const empOptions = employeesCache
    .filter((e) => e.role === 'employee')
    .map((e) => `<option value="${e.id}" ${filters.employee_id == e.id ? 'selected' : ''}>${e.full_name}</option>`)
    .join('');

  const totalEarned = shiftsCache.reduce((sum, s) => sum + (s.earned_amount || 0), 0);
  const totalMinutes = shiftsCache.reduce((sum, s) => sum + (s.worked_minutes || 0), 0);

  el.innerHTML = `
    <div class="toolbar">
      <div class="field"><label>Employee</label>
        <select id="fEmployee"><option value="">All</option>${empOptions}</select>
      </div>
      <div class="field"><label>From</label><input type="date" id="fFrom" value="${filters.from}" /></div>
      <div class="field"><label>To</label><input type="date" id="fTo" value="${filters.to}" /></div>
      <div class="field"><label>Status</label>
        <select id="fStatus">
          <option value="" ${filters.status===''?'selected':''}>All</option>
          <option value="open" ${filters.status==='open'?'selected':''}>Open</option>
          <option value="closed" ${filters.status==='closed'?'selected':''}>Closed</option>
        </select>
      </div>
      <button class="btn btn-primary btn-sm" id="applyFilters">Apply</button>
      <button class="btn btn-success btn-sm" id="exportBtn">Export to Excel</button>
      <button class="btn btn-ghost btn-sm" id="addShiftBtn">+ Add Shift</button>
    </div>
    <div class="msg ${msg.type}">${msg.text}</div>
    <p style="color: var(--muted); font-size: 14px;">Totals for filtered results: ${fmtDuration(totalMinutes)} worked · ${fmtMoney(totalEarned)} earned</p>
    <table>
      <thead><tr>
        <th>Employee</th><th>Start</th><th>End</th><th>Break</th><th>Worked</th><th>Rate</th><th>Earned</th><th>Checklists</th><th>Status</th><th>Edited</th><th></th>
      </tr></thead>
      <tbody id="shiftsBody"></tbody>
    </table>
  `;

  renderShiftsRows();

  document.getElementById('applyFilters').addEventListener('click', () => {
    filters.employee_id = document.getElementById('fEmployee').value;
    filters.from = document.getElementById('fFrom').value;
    filters.to = document.getElementById('fTo').value;
    filters.status = document.getElementById('fStatus').value;
    renderShiftsTab();
  });

  document.getElementById('exportBtn').addEventListener('click', exportToExcel);
  document.getElementById('addShiftBtn').addEventListener('click', () => openShiftForm(null));
}

function checklistSummary(items) {
  if (!items) return '—';
  const checked = items.filter((i) => i.checked).length;
  return checked === items.length ? `✓ ${checked}/${items.length}` : `⚠ ${checked}/${items.length}`;
}

function renderShiftsRows() {
  const body = document.getElementById('shiftsBody');
  body.innerHTML = shiftsCache.map((s) => `
    <tr>
      <td>${s.employee_name}</td>
      <td>${fmtDisplay(s.start_at)}</td>
      <td>${fmtDisplay(s.end_at)}</td>
      <td>${s.break_minutes ?? '—'}</td>
      <td>${fmtDuration(s.worked_minutes)}</td>
      <td>${s.hourly_rate_snapshot ? '$' + s.hourly_rate_snapshot : '—'}</td>
      <td>${fmtMoney(s.earned_amount)}</td>
      <td>
        ${(s.opening_checklist || s.closing_checklist) ? `<button class="btn-sm btn-ghost" data-checklist-view="${s.id}">Open: ${checklistSummary(s.opening_checklist)} · Close: ${checklistSummary(s.closing_checklist)}</button>` : '—'}
      </td>
      <td>${s.status === 'open' ? 'Open' : 'Closed'}</td>
      <td>${s.edited_by_admin ? 'yes' : ''}</td>
      <td>
        <button class="btn-sm btn-ghost" data-edit="${s.id}">✎</button>
        <button class="btn-sm btn-danger" data-del="${s.id}">✕</button>
      </td>
    </tr>
  `).join('');

  body.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => openShiftForm(shiftsCache.find((s) => s.id == b.dataset.edit)))
  );
  body.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', () => deleteShift(b.dataset.del))
  );
  body.querySelectorAll('[data-checklist-view]').forEach((b) =>
    b.addEventListener('click', () => viewChecklist(shiftsCache.find((s) => s.id == b.dataset.checklistView)))
  );
}

function viewChecklist(shift) {
  const renderList = (title, items) => {
    if (!items) return '';
    return `
      <h4 style="margin-bottom: 6px;">${title}</h4>
      ${items.map((i) => `<div class="checklist-item" style="cursor:default;">
        <input type="checkbox" disabled ${i.checked ? 'checked' : ''} />
        <span>${i.text}</span>
      </div>`).join('')}
    `;
  };
  const wrap = document.createElement('div');
  wrap.className = 'admin-card';
  wrap.innerHTML = `
    <h3>Checklist — ${shift.employee_name}</h3>
    ${renderList('On shift start', shift.opening_checklist)}
    ${renderList('On shift end', shift.closing_checklist)}
    ${!shift.opening_checklist && !shift.closing_checklist ? '<p>No checklist for this shift.</p>' : ''}
    <button class="btn btn-ghost" id="checklistClose">Close</button>
  `;
  document.getElementById('tabContent').prepend(wrap);
  wrap.scrollIntoView({ behavior: 'smooth' });
  document.getElementById('checklistClose').addEventListener('click', () => wrap.remove());
}

function openShiftForm(shift) {
  const isNew = !shift;
  const empOptions = employeesCache
    .filter((e) => e.role === 'employee')
    .map((e) => `<option value="${e.id}" ${shift && shift.employee_id == e.id ? 'selected' : ''}>${e.full_name}</option>`)
    .join('');

  const wrap = document.createElement('div');
  wrap.className = 'admin-card';
  wrap.innerHTML = `
    <h3>${isNew ? 'New Shift' : 'Edit Shift'}</h3>
    ${isNew ? `<div class="field"><label>Employee</label><select id="formEmployee">${empOptions}</select></div>` : ''}
    <div class="field"><label>Start</label><input type="datetime-local" id="formStart" value="${shift ? fmtDT(shift.start_at) : ''}" /></div>
    <div class="field"><label>End (leave blank if shift is still open)</label><input type="datetime-local" id="formEnd" value="${shift ? fmtDT(shift.end_at) : ''}" /></div>
    <div class="field"><label>Break (min)</label><input type="number" id="formBreak" value="${shift ? (shift.break_minutes ?? 0) : 0}" /></div>
    <div class="field"><label>Hourly rate ($)</label><input type="number" step="0.01" id="formRate" value="${shift ? (shift.hourly_rate_snapshot ?? 0) : 0}" /></div>
    <div class="msg" id="formMsg"></div>
    <button class="btn btn-primary" id="formSave">Save</button>
    <button class="btn btn-ghost" id="formCancel">Cancel</button>
  `;
  document.getElementById('tabContent').prepend(wrap);
  wrap.scrollIntoView({ behavior: 'smooth' });

  document.getElementById('formCancel').addEventListener('click', () => wrap.remove());
  document.getElementById('formSave').addEventListener('click', async () => {
    const start_at = document.getElementById('formStart').value;
    const end_at = document.getElementById('formEnd').value;
    const break_minutes = Number(document.getElementById('formBreak').value || 0);
    const hourly_rate = Number(document.getElementById('formRate').value || 0);
    if (!start_at) {
      document.getElementById('formMsg').textContent = 'Please provide a start time';
      document.getElementById('formMsg').className = 'msg error';
      return;
    }
    try {
      if (isNew) {
        const employee_id = document.getElementById('formEmployee').value;
        await api('/api/admin/shifts', { method: 'POST', body: {
          employee_id, start_at: new Date(start_at).toISOString(),
          end_at: end_at ? new Date(end_at).toISOString() : null, break_minutes, hourly_rate,
        }});
      } else {
        await api(`/api/admin/shifts/${shift.id}`, { method: 'PUT', body: {
          start_at: new Date(start_at).toISOString(),
          end_at: end_at ? new Date(end_at).toISOString() : null, break_minutes, hourly_rate,
        }});
      }
      msg = { text: 'Saved', type: 'success' };
      renderShiftsTab();
    } catch (e) {
      document.getElementById('formMsg').textContent = e.message;
      document.getElementById('formMsg').className = 'msg error';
    }
  });
}

async function deleteShift(id) {
  if (!confirm('Delete this shift?')) return;
  try {
    await api(`/api/admin/shifts/${id}`, { method: 'DELETE' });
    msg = { text: 'Shift deleted', type: 'success' };
    renderShiftsTab();
  } catch (e) {
    msg = { text: e.message, type: 'error' };
    renderShiftsTab();
  }
}

function exportToExcel() {
  const rows = shiftsCache.map((s) => ({
    'Employee': s.employee_name,
    'Start': fmtDisplay(s.start_at),
    'End': fmtDisplay(s.end_at),
    'Break (min)': s.break_minutes ?? '',
    'Worked (min)': s.worked_minutes ?? '',
    'Worked': fmtDuration(s.worked_minutes),
    'Rate ($/hr)': s.hourly_rate_snapshot ?? '',
    'Earned ($)': s.earned_amount ?? '',
    'Status': s.status === 'open' ? 'Open' : 'Closed',
  }));
  const totalEarned = shiftsCache.reduce((sum, s) => sum + (s.earned_amount || 0), 0);
  const totalMinutes = shiftsCache.reduce((sum, s) => sum + (s.worked_minutes || 0), 0);
  rows.push({
    'Employee': 'TOTAL', 'Start': '', 'End': '', 'Break (min)': '', 'Worked (min)': totalMinutes,
    'Worked': fmtDuration(totalMinutes), 'Rate ($/hr)': '', 'Earned ($)': Math.round(totalEarned * 100) / 100, 'Status': '',
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Shifts');
  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `shifts_${date}.xlsx`);
}

// ---------- Employees tab ----------

function renderEmployeesTab() {
  const el = document.getElementById('tabContent');
  el.innerHTML = `
    <div class="toolbar">
      <button class="btn btn-primary btn-sm" id="addEmpBtn">+ Add Employee</button>
    </div>
    <div class="msg ${msg.type}">${msg.text}</div>
    <table>
      <thead><tr><th>Name</th><th>Role</th><th>Position</th><th>Rate</th><th>Active</th><th></th></tr></thead>
      <tbody id="empBody"></tbody>
    </table>
  `;
  const body = document.getElementById('empBody');
  body.innerHTML = employeesCache.map((e) => `
    <tr>
      <td>${e.full_name}</td>
      <td>${e.role === 'admin' ? 'Admin' : 'Employee'}</td>
      <td>${positionsCache.find((p) => p.id === e.position_id)?.name || '—'}</td>
      <td>${e.hourly_rate ? '$' + e.hourly_rate + '/hr' : '—'}</td>
      <td>${e.active ? 'yes' : 'no'}</td>
      <td>
        <button class="btn-sm btn-ghost" data-edit-emp="${e.id}">✎</button>
        ${e.role === 'employee' ? `<button class="btn-sm ${e.active ? 'btn-danger' : 'btn-success'}" data-toggle="${e.id}">${e.active ? 'Deactivate' : 'Activate'}</button>` : ''}
      </td>
    </tr>
  `).join('');

  document.getElementById('addEmpBtn').addEventListener('click', () => openEmployeeForm(null));
  body.querySelectorAll('[data-edit-emp]').forEach((b) =>
    b.addEventListener('click', () => openEmployeeForm(employeesCache.find((e) => e.id == b.dataset.editEmp)))
  );
  body.querySelectorAll('[data-toggle]').forEach((b) =>
    b.addEventListener('click', async () => {
      const emp = employeesCache.find((e) => e.id == b.dataset.toggle);
      try {
        await api(`/api/admin/employees/${emp.id}`, { method: 'PUT', body: { active: !emp.active } });
        employeesCache = await api('/api/admin/employees');
        renderEmployeesTab();
      } catch (e) {
        msg = { text: e.message, type: 'error' };
        renderEmployeesTab();
      }
    })
  );
}

function openEmployeeForm(employee) {
  const isNew = !employee;
  const positionOptions = positionsCache
    .map((p) => `<option value="${p.id}" ${employee && employee.position_id === p.id ? 'selected' : ''}>${p.name}</option>`)
    .join('');
  const wrap = document.createElement('div');
  wrap.className = 'admin-card';
  wrap.innerHTML = `
    <h3>${isNew ? 'New Employee' : 'Edit Employee'}</h3>
    <div class="field"><label>Name</label><input id="formName" value="${employee ? employee.full_name : ''}" /></div>
    <div class="field"><label>${isNew ? 'PIN (4–6 digits)' : 'New PIN (leave blank to keep current)'}</label><input id="formPin" inputmode="numeric" /></div>
    <div class="field"><label>Hourly rate ($)</label><input type="number" step="0.01" id="formRateEmp" value="${employee ? (employee.hourly_rate ?? 0) : 0}" /></div>
    <div class="field"><label>Position (determines start/end checklist)</label>
      <select id="formPosition"><option value="">None</option>${positionOptions}</select>
    </div>
    ${isNew ? `<div class="field"><label>Role</label>
      <select id="formRole"><option value="employee">Employee</option><option value="admin">Admin</option></select>
    </div>` : ''}
    <div class="msg" id="empFormMsg"></div>
    <button class="btn btn-primary" id="empFormSave">Save</button>
    <button class="btn btn-ghost" id="empFormCancel">Cancel</button>
  `;
  document.getElementById('tabContent').prepend(wrap);
  wrap.scrollIntoView({ behavior: 'smooth' });

  document.getElementById('empFormCancel').addEventListener('click', () => wrap.remove());
  document.getElementById('empFormSave').addEventListener('click', async () => {
    const full_name = document.getElementById('formName').value.trim();
    const pin = document.getElementById('formPin').value.trim();
    const hourly_rate = Number(document.getElementById('formRateEmp').value || 0);
    const position_id = document.getElementById('formPosition').value || null;
    if (!full_name) {
      document.getElementById('empFormMsg').textContent = 'Please provide a name';
      document.getElementById('empFormMsg').className = 'msg error';
      return;
    }
    try {
      if (isNew) {
        const role = document.getElementById('formRole').value;
        if (!pin) throw new Error('Please provide a PIN');
        await api('/api/admin/employees', { method: 'POST', body: { full_name, pin, role, hourly_rate, position_id } });
      } else {
        const body = { full_name, hourly_rate, position_id };
        if (pin) body.pin = pin;
        await api(`/api/admin/employees/${employee.id}`, { method: 'PUT', body });
      }
      employeesCache = await api('/api/admin/employees');
      msg = { text: 'Saved', type: 'success' };
      renderEmployeesTab();
    } catch (e) {
      document.getElementById('empFormMsg').textContent = e.message;
      document.getElementById('empFormMsg').className = 'msg error';
    }
  });
}

// ---------- Positions tab (job roles + their start/end checklists) ----------

function renderPositionsTab() {
  const el = document.getElementById('tabContent');
  el.innerHTML = `
    <p style="color: var(--muted); font-size: 14px;">
      Positions let you require a different checklist for each job (e.g. Barista vs. Pastry Chef).
      Assign a position to an employee on the Employees tab.
    </p>
    <div class="toolbar">
      <button class="btn btn-primary btn-sm" id="addPosBtn">+ Add Position</button>
    </div>
    <div class="msg ${msg.type}">${msg.text}</div>
    <table>
      <thead><tr><th>Position</th><th>Start checklist items</th><th>End checklist items</th><th></th></tr></thead>
      <tbody id="posBody"></tbody>
    </table>
  `;
  const body = document.getElementById('posBody');
  body.innerHTML = positionsCache.map((p) => `
    <tr>
      <td>${p.name}</td>
      <td>${p.opening_items.length}</td>
      <td>${p.closing_items.length}</td>
      <td>
        <button class="btn-sm btn-ghost" data-edit-pos="${p.id}">✎</button>
        <button class="btn-sm btn-danger" data-del-pos="${p.id}">✕</button>
      </td>
    </tr>
  `).join('');

  document.getElementById('addPosBtn').addEventListener('click', () => openPositionForm(null));
  body.querySelectorAll('[data-edit-pos]').forEach((b) =>
    b.addEventListener('click', () => openPositionForm(positionsCache.find((p) => p.id == b.dataset.editPos)))
  );
  body.querySelectorAll('[data-del-pos]').forEach((b) =>
    b.addEventListener('click', () => deletePosition(b.dataset.delPos))
  );
}

function openPositionForm(position) {
  const isNew = !position;
  const wrap = document.createElement('div');
  wrap.className = 'admin-card';
  wrap.innerHTML = `
    <h3>${isNew ? 'New Position' : 'Edit Position'}</h3>
    <div class="field"><label>Position name (e.g. Barista, Pastry Chef)</label><input id="formPosName" value="${position ? position.name : ''}" /></div>
    <div class="field"><label>Start-of-shift checklist — one item per line</label>
      <textarea id="formOpenItems" rows="5" style="width:100%; background:#0f172a; border:1px solid var(--border); color:var(--text); border-radius:8px; padding:10px; font-family:inherit; font-size:14px;">${position ? position.opening_items.join('\n') : ''}</textarea>
    </div>
    <div class="field"><label>End-of-shift checklist — one item per line</label>
      <textarea id="formCloseItems" rows="5" style="width:100%; background:#0f172a; border:1px solid var(--border); color:var(--text); border-radius:8px; padding:10px; font-family:inherit; font-size:14px;">${position ? position.closing_items.join('\n') : ''}</textarea>
    </div>
    <div class="msg" id="posFormMsg"></div>
    <button class="btn btn-primary" id="posFormSave">Save</button>
    <button class="btn btn-ghost" id="posFormCancel">Cancel</button>
  `;
  document.getElementById('tabContent').prepend(wrap);
  wrap.scrollIntoView({ behavior: 'smooth' });

  document.getElementById('posFormCancel').addEventListener('click', () => wrap.remove());
  document.getElementById('posFormSave').addEventListener('click', async () => {
    const name = document.getElementById('formPosName').value.trim();
    const opening_items = document.getElementById('formOpenItems').value.split('\n').map((s) => s.trim()).filter(Boolean);
    const closing_items = document.getElementById('formCloseItems').value.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!name) {
      document.getElementById('posFormMsg').textContent = 'Please provide a position name';
      document.getElementById('posFormMsg').className = 'msg error';
      return;
    }
    try {
      if (isNew) {
        await api('/api/admin/positions', { method: 'POST', body: { name, opening_items, closing_items } });
      } else {
        await api(`/api/admin/positions/${position.id}`, { method: 'PUT', body: { name, opening_items, closing_items } });
      }
      positionsCache = await api('/api/admin/positions');
      msg = { text: 'Saved', type: 'success' };
      renderPositionsTab();
    } catch (e) {
      document.getElementById('posFormMsg').textContent = e.message;
      document.getElementById('posFormMsg').className = 'msg error';
    }
  });
}

async function deletePosition(id) {
  if (!confirm('Delete this position? Employees assigned to it will keep working, just without a checklist.')) return;
  try {
    await api(`/api/admin/positions/${id}`, { method: 'DELETE' });
    positionsCache = await api('/api/admin/positions');
    msg = { text: 'Position deleted', type: 'success' };
    renderPositionsTab();
  } catch (e) {
    msg = { text: e.message, type: 'error' };
    renderPositionsTab();
  }
}

// ---------- dispatcher ----------

function render() {
  msg = { text: msg.type === 'success' ? msg.text : '', type: '' };
  if (!token) renderLogin();
  else renderDashboard();
}

render();
