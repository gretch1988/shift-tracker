require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { employees: Employees, shifts: Shifts } = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const PORT = process.env.PORT || 3000;

// ---------- helpers ----------

function publicEmployee(e) {
  return { id: e.id, full_name: e.full_name, role: e.role, active: !!e.active };
}

function publicShift(s) {
  return {
    id: s.id,
    employee_id: s.employee_id,
    start_at: s.start_at,
    end_at: s.end_at,
    break_minutes: s.break_minutes,
    worked_minutes: s.worked_minutes,
    status: s.status,
    edited_by_admin: !!s.edited_by_admin,
    created_at: s.created_at,
    closed_at: s.closed_at,
  };
}

function computeWorkedMinutes(startAt, endAt, breakMinutes) {
  const ms = new Date(endAt).getTime() - new Date(startAt).getTime();
  const rawMinutes = Math.round(ms / 60000);
  const worked = rawMinutes - (Number(breakMinutes) || 0);
  return Math.max(0, worked);
}

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Нет токена авторизации' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== 'admin') return res.status(403).json({ error: 'Требуются права администратора' });
    req.admin = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Неверный или истёкший токен' });
  }
}

// ---------- PIN lookup (kiosk decides which screen to show) ----------

app.post('/api/pin/lookup', (req, res) => {
  const { pin } = req.body || {};
  if (!pin) return res.status(400).json({ error: 'Введите ПИН-код' });

  const employee = Employees.findByPin(pin);
  if (!employee) return res.status(404).json({ error: 'Неверный ПИН-код' });

  if (employee.role === 'admin') {
    return res.json({ role: 'admin', full_name: employee.full_name });
  }

  const openShift = Shifts.findOpenByEmployee(employee.id);

  res.json({
    role: 'employee',
    employee: publicEmployee(employee),
    open_shift: openShift ? publicShift(openShift) : null,
  });
});

// ---------- Shift start/end (employee, PIN-authenticated per request) ----------

app.post('/api/shifts/start', (req, res) => {
  const { pin } = req.body || {};
  const employee = Employees.findByPin(pin);
  if (!employee) return res.status(404).json({ error: 'Неверный ПИН-код' });
  if (employee.role !== 'employee') return res.status(400).json({ error: 'Администратор не отмечает смены' });

  const openShift = Shifts.findOpenByEmployee(employee.id);
  if (openShift) return res.status(409).json({ error: 'У вас уже есть открытая смена' });

  const nowIso = new Date().toISOString();
  const shift = Shifts.insert({ employee_id: employee.id, start_at: nowIso, status: 'open' });

  res.json({ employee: publicEmployee(employee), shift: publicShift(shift) });
});

app.post('/api/shifts/end', (req, res) => {
  const { pin, break_minutes } = req.body || {};
  const employee = Employees.findByPin(pin);
  if (!employee) return res.status(404).json({ error: 'Неверный ПИН-код' });
  if (employee.role !== 'employee') return res.status(400).json({ error: 'Администратор не отмечает смены' });

  const breakMin = Number(break_minutes);
  if (!Number.isFinite(breakMin) || breakMin < 0) {
    return res.status(400).json({ error: 'Укажите корректное время перерыва (минуты)' });
  }

  const openShift = Shifts.findOpenByEmployee(employee.id);
  if (!openShift) return res.status(409).json({ error: 'Нет открытой смены' });

  const nowIso = new Date().toISOString();
  const workedMinutes = computeWorkedMinutes(openShift.start_at, nowIso, breakMin);

  const shift = Shifts.update(openShift.id, {
    end_at: nowIso,
    break_minutes: breakMin,
    worked_minutes: workedMinutes,
    status: 'closed',
    closed_at: nowIso,
  });

  res.json({ employee: publicEmployee(employee), shift: publicShift(shift) });
});

// ---------- Employee's own history (read-only) ----------

app.post('/api/shifts/mine', (req, res) => {
  const { pin } = req.body || {};
  const employee = Employees.findByPin(pin, { activeOnly: false });
  if (!employee) return res.status(404).json({ error: 'Неверный ПИН-код' });
  if (employee.role !== 'employee') return res.status(400).json({ error: 'Недоступно для администратора' });

  const shifts = Shifts.getByEmployee(employee.id).slice(0, 200);
  res.json({ employee: publicEmployee(employee), shifts: shifts.map(publicShift) });
});

// ---------- Admin auth ----------

app.post('/api/admin/login', (req, res) => {
  const { pin } = req.body || {};
  const employee = Employees.findByPin(pin, { activeOnly: false });
  if (!employee || employee.role !== 'admin') {
    return res.status(401).json({ error: 'Неверный ПИН-код администратора' });
  }
  const token = jwt.sign({ sub: employee.id, role: 'admin', name: employee.full_name }, JWT_SECRET, {
    expiresIn: '12h',
  });
  res.json({ token, full_name: employee.full_name });
});

// ---------- Admin: shifts CRUD ----------

app.get('/api/admin/shifts', requireAdmin, (req, res) => {
  const { employee_id, from, to, status } = req.query;
  const rows = Shifts.getAll({ employee_id, from, to, status }).slice(0, 1000);
  res.json(
    rows.map((r) => {
      const emp = Employees.getById(r.employee_id);
      return { ...publicShift(r), employee_name: emp ? emp.full_name : '—' };
    })
  );
});

app.put('/api/admin/shifts/:id', requireAdmin, (req, res) => {
  const existing = Shifts.getById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Смена не найдена' });

  const start_at = req.body.start_at || existing.start_at;
  const end_at = req.body.end_at !== undefined ? req.body.end_at : existing.end_at;
  const break_minutes =
    req.body.break_minutes !== undefined ? Number(req.body.break_minutes) : existing.break_minutes;

  let worked_minutes;
  let status;
  if (end_at) {
    worked_minutes = computeWorkedMinutes(start_at, end_at, break_minutes || 0);
    status = 'closed';
  } else {
    worked_minutes = null;
    status = 'open';
  }

  const updated = Shifts.update(existing.id, {
    start_at,
    end_at: end_at || null,
    break_minutes: break_minutes ?? null,
    worked_minutes,
    status,
    edited_by_admin: true,
  });

  res.json(publicShift(updated));
});

app.delete('/api/admin/shifts/:id', requireAdmin, (req, res) => {
  const ok = Shifts.delete(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Смена не найдена' });
  res.json({ ok: true });
});

app.post('/api/admin/shifts', requireAdmin, (req, res) => {
  const { employee_id, start_at, end_at, break_minutes } = req.body || {};
  const employee = Employees.getById(employee_id);
  if (!employee) return res.status(404).json({ error: 'Сотрудник не найден' });
  if (!start_at) return res.status(400).json({ error: 'Укажите время начала смены' });

  let worked_minutes = null;
  let status = 'open';
  if (end_at) {
    worked_minutes = computeWorkedMinutes(start_at, end_at, break_minutes || 0);
    status = 'closed';
  }

  const shift = Shifts.insert({
    employee_id,
    start_at,
    end_at: end_at || null,
    break_minutes: break_minutes ?? null,
    worked_minutes,
    status,
    edited_by_admin: true,
    closed_at: end_at || null,
  });

  res.json(publicShift(shift));
});

// ---------- Admin: employees CRUD ----------

app.get('/api/admin/employees', requireAdmin, (req, res) => {
  const rows = [...Employees.getAll()].sort((a, b) => a.full_name.localeCompare(b.full_name, 'ru'));
  res.json(rows.map(publicEmployee));
});

app.post('/api/admin/employees', requireAdmin, (req, res) => {
  const { full_name, pin, role } = req.body || {};
  if (!full_name || !pin) return res.status(400).json({ error: 'Укажите имя и ПИН-код' });
  if (!/^\d{4,6}$/.test(String(pin))) return res.status(400).json({ error: 'ПИН-код должен быть из 4–6 цифр' });

  const clash = Employees.findByPin(pin, { activeOnly: false });
  if (clash) return res.status(409).json({ error: 'Такой ПИН-код уже используется другим сотрудником' });

  const hash = bcrypt.hashSync(String(pin), 10);
  const employee = Employees.insert({
    full_name,
    pin_hash: hash,
    role: role === 'admin' ? 'admin' : 'employee',
    active: true,
  });

  res.json(publicEmployee(employee));
});

app.put('/api/admin/employees/:id', requireAdmin, (req, res) => {
  const existing = Employees.getById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Сотрудник не найден' });

  const patch = {};
  if (req.body.full_name !== undefined) patch.full_name = req.body.full_name;
  if (req.body.active !== undefined) patch.active = !!req.body.active;

  if (req.body.pin) {
    if (!/^\d{4,6}$/.test(String(req.body.pin))) {
      return res.status(400).json({ error: 'ПИН-код должен быть из 4–6 цифр' });
    }
    const clash = Employees.findByPin(req.body.pin, { activeOnly: false });
    if (clash && clash.id !== existing.id) {
      return res.status(409).json({ error: 'Такой ПИН-код уже используется другим сотрудником' });
    }
    patch.pin_hash = bcrypt.hashSync(String(req.body.pin), 10);
  }

  const updated = Employees.update(existing.id, patch);
  res.json(publicEmployee(updated));
});

// ---------- static frontend ----------
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Shift Tracker запущен: http://localhost:${PORT}`);
});
