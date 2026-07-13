const API = '';
const app = document.getElementById('app');

let token = localStorage.getItem('admin_token') || null;
let adminName = localStorage.getItem('admin_name') || '';
let tab = 'shifts';
let employeesCache = [];
let shiftsCache = [];
let filters = { employee_id: '', from: '', to: '', status: '' };
let msg = { text: '', type: '' };

async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) logout();
    throw new Error(json.error || 'Ошибка сервера');
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
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function fmtDuration(min) {
  if (min === null || min === undefined) return '—';
  return `${Math.floor(min / 60)}ч ${min % 60}м`;
}

// ---------- Login ----------

function renderLogin() {
  app.innerHTML = `
    <div class="card" style="margin: 10vh auto;">
      <h1>Панель администратора</h1>
      <div class="field">
        <label>ПИН-код администратора</label>
        <input type="password" id="adminPin" inputmode="numeric" autofocus />
      </div>
      <div class="msg ${msg.type}">${msg.text}</div>
      <button class="btn btn-primary" id="loginBtn">Войти</button>
      <div class="link-row"><a href="/index.html">← Вернуться к киоску</a></div>
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
        <h2>Учёт смен — ${adminName}</h2>
        <button class="btn btn-ghost btn-sm" id="logoutBtn">Выйти</button>
      </div>
      <div class="tabs">
        <button class="btn btn-sm ${tab === 'shifts' ? 'active' : 'btn-ghost'}" data-tab="shifts">Смены</button>
        <button class="btn btn-sm ${tab === 'employees' ? 'active' : 'btn-ghost'}" data-tab="employees">Сотрудники</button>
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
  } catch (e) { /* handled by api() */ }

  if (tab === 'shifts') renderShiftsTab();
  else renderEmployeesTab();
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
  el.innerHTML = `<p>Загрузка…</p>`;
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

  el.innerHTML = `
    <div class="toolbar">
      <div class="field"><label>Сотрудник</label>
        <select id="fEmployee"><option value="">Все</option>${empOptions}</select>
      </div>
      <div class="field"><label>С даты</label><input type="date" id="fFrom" value="${filters.from}" /></div>
      <div class="field"><label>По дату</label><input type="date" id="fTo" value="${filters.to}" /></div>
      <div class="field"><label>Статус</label>
        <select id="fStatus">
          <option value="" ${filters.status===''?'selected':''}>Все</option>
          <option value="open" ${filters.status==='open'?'selected':''}>Открытые</option>
          <option value="closed" ${filters.status==='closed'?'selected':''}>Закрытые</option>
        </select>
      </div>
      <button class="btn btn-primary btn-sm" id="applyFilters">Применить</button>
      <button class="btn btn-success btn-sm" id="exportBtn">Экспорт в Excel</button>
      <button class="btn btn-ghost btn-sm" id="addShiftBtn">+ Добавить смену</button>
    </div>
    <div class="msg ${msg.type}">${msg.text}</div>
    <table>
      <thead><tr>
        <th>Сотрудник</th><th>Начало</th><th>Конец</th><th>Перерыв</th><th>Отработано</th><th>Статус</th><th>Изменено</th><th></th>
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

function renderShiftsRows() {
  const body = document.getElementById('shiftsBody');
  body.innerHTML = shiftsCache.map((s) => `
    <tr>
      <td>${s.employee_name}</td>
      <td>${fmtDisplay(s.start_at)}</td>
      <td>${fmtDisplay(s.end_at)}</td>
      <td>${s.break_minutes ?? '—'}</td>
      <td>${fmtDuration(s.worked_minutes)}</td>
      <td>${s.status === 'open' ? 'Открыта' : 'Закрыта'}</td>
      <td>${s.edited_by_admin ? 'да' : ''}</td>
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
    <h3>${isNew ? 'Новая смена' : 'Редактировать смену'}</h3>
    ${isNew ? `<div class="field"><label>Сотрудник</label><select id="formEmployee">${empOptions}</select></div>` : ''}
    <div class="field"><label>Начало</label><input type="datetime-local" id="formStart" value="${shift ? fmtDT(shift.start_at) : ''}" /></div>
    <div class="field"><label>Конец (оставьте пустым, если смена ещё открыта)</label><input type="datetime-local" id="formEnd" value="${shift ? fmtDT(shift.end_at) : ''}" /></div>
    <div class="field"><label>Перерыв (мин)</label><input type="number" id="formBreak" value="${shift ? (shift.break_minutes ?? 0) : 0}" /></div>
    <div class="msg" id="formMsg"></div>
    <button class="btn btn-primary" id="formSave">Сохранить</button>
    <button class="btn btn-ghost" id="formCancel">Отмена</button>
  `;
  document.getElementById('tabContent').prepend(wrap);
  wrap.scrollIntoView({ behavior: 'smooth' });

  document.getElementById('formCancel').addEventListener('click', () => wrap.remove());
  document.getElementById('formSave').addEventListener('click', async () => {
    const start_at = document.getElementById('formStart').value;
    const end_at = document.getElementById('formEnd').value;
    const break_minutes = Number(document.getElementById('formBreak').value || 0);
    if (!start_at) {
      document.getElementById('formMsg').textContent = 'Укажите время начала';
      document.getElementById('formMsg').className = 'msg error';
      return;
    }
    try {
      if (isNew) {
        const employee_id = document.getElementById('formEmployee').value;
        await api('/api/admin/shifts', { method: 'POST', body: {
          employee_id, start_at: new Date(start_at).toISOString(),
          end_at: end_at ? new Date(end_at).toISOString() : null, break_minutes,
        }});
      } else {
        await api(`/api/admin/shifts/${shift.id}`, { method: 'PUT', body: {
          start_at: new Date(start_at).toISOString(),
          end_at: end_at ? new Date(end_at).toISOString() : null, break_minutes,
        }});
      }
      msg = { text: 'Сохранено', type: 'success' };
      renderShiftsTab();
    } catch (e) {
      document.getElementById('formMsg').textContent = e.message;
      document.getElementById('formMsg').className = 'msg error';
    }
  });
}

async function deleteShift(id) {
  if (!confirm('Удалить эту смену?')) return;
  try {
    await api(`/api/admin/shifts/${id}`, { method: 'DELETE' });
    msg = { text: 'Смена удалена', type: 'success' };
    renderShiftsTab();
  } catch (e) {
    msg = { text: e.message, type: 'error' };
    renderShiftsTab();
  }
}

function exportToExcel() {
  const rows = shiftsCache.map((s) => ({
    'Сотрудник': s.employee_name,
    'Начало': fmtDisplay(s.start_at),
    'Конец': fmtDisplay(s.end_at),
    'Перерыв (мин)': s.break_minutes ?? '',
    'Отработано (мин)': s.worked_minutes ?? '',
    'Отработано': fmtDuration(s.worked_minutes),
    'Статус': s.status === 'open' ? 'Открыта' : 'Закрыта',
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Смены');
  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `smeny_${date}.xlsx`);
}

// ---------- Employees tab ----------

function renderEmployeesTab() {
  const el = document.getElementById('tabContent');
  el.innerHTML = `
    <div class="toolbar">
      <button class="btn btn-primary btn-sm" id="addEmpBtn">+ Добавить сотрудника</button>
    </div>
    <div class="msg ${msg.type}">${msg.text}</div>
    <table>
      <thead><tr><th>Имя</th><th>Роль</th><th>Активен</th><th></th></tr></thead>
      <tbody id="empBody"></tbody>
    </table>
  `;
  const body = document.getElementById('empBody');
  body.innerHTML = employeesCache.map((e) => `
    <tr>
      <td>${e.full_name}</td>
      <td>${e.role === 'admin' ? 'Администратор' : 'Сотрудник'}</td>
      <td>${e.active ? 'да' : 'нет'}</td>
      <td>
        <button class="btn-sm btn-ghost" data-edit-emp="${e.id}">✎</button>
        ${e.role === 'employee' ? `<button class="btn-sm ${e.active ? 'btn-danger' : 'btn-success'}" data-toggle="${e.id}">${e.active ? 'Отключить' : 'Включить'}</button>` : ''}
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
  const wrap = document.createElement('div');
  wrap.className = 'admin-card';
  wrap.innerHTML = `
    <h3>${isNew ? 'Новый сотрудник' : 'Редактировать сотрудника'}</h3>
    <div class="field"><label>Имя</label><input id="formName" value="${employee ? employee.full_name : ''}" /></div>
    <div class="field"><label>${isNew ? 'ПИН-код (4–6 цифр)' : 'Новый ПИН-код (оставьте пустым, если не меняете)'}</label><input id="formPin" inputmode="numeric" /></div>
    ${isNew ? `<div class="field"><label>Роль</label>
      <select id="formRole"><option value="employee">Сотрудник</option><option value="admin">Администратор</option></select>
    </div>` : ''}
    <div class="msg" id="empFormMsg"></div>
    <button class="btn btn-primary" id="empFormSave">Сохранить</button>
    <button class="btn btn-ghost" id="empFormCancel">Отмена</button>
  `;
  document.getElementById('tabContent').prepend(wrap);
  wrap.scrollIntoView({ behavior: 'smooth' });

  document.getElementById('empFormCancel').addEventListener('click', () => wrap.remove());
  document.getElementById('empFormSave').addEventListener('click', async () => {
    const full_name = document.getElementById('formName').value.trim();
    const pin = document.getElementById('formPin').value.trim();
    if (!full_name) {
      document.getElementById('empFormMsg').textContent = 'Укажите имя';
      document.getElementById('empFormMsg').className = 'msg error';
      return;
    }
    try {
      if (isNew) {
        const role = document.getElementById('formRole').value;
        if (!pin) throw new Error('Укажите ПИН-код');
        await api('/api/admin/employees', { method: 'POST', body: { full_name, pin, role } });
      } else {
        const body = { full_name };
        if (pin) body.pin = pin;
        await api(`/api/admin/employees/${employee.id}`, { method: 'PUT', body });
      }
      employeesCache = await api('/api/admin/employees');
      msg = { text: 'Сохранено', type: 'success' };
      renderEmployeesTab();
    } catch (e) {
      document.getElementById('empFormMsg').textContent = e.message;
      document.getElementById('empFormMsg').className = 'msg error';
    }
  });
}

// ---------- dispatcher ----------

function render() {
  msg = { text: msg.type === 'success' ? msg.text : '', type: '' };
  if (!token) renderLogin();
  else renderDashboard();
}

render();
