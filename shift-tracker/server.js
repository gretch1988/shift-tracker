require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { employees: Employees, shifts: Shifts, positions: Positions, encryptPin, decryptPin } = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const PORT = process.env.PORT || 3000;

// How far back an employee may backdate their own shift start (self-service,
// no admin approval needed) to cover "forgot to clock in" situations.
const MAX_BACKDATE_MINUTES = Number(process.env.MAX_BACKDATE_MINUTES || 360); // 6 hours

// A shift left open longer than this is flagged for the admin as likely
// forgotten (employee left without tapping "End Shift").
const STALE_SHIFT_HOURS = Number(process.env.STALE_SHIFT_HOURS || 14);

// ---------- helpers ----------

function publicEmployee(e) {
  return {
    id: e.id,
    full_name: e.full_name,
    role: e.role,
    active: !!e.active,
    hourly_rate: e.hourly_rate ?? 0,
    position_id: e.position_id ?? null,
  };
}

// Extended employee view for admin-only endpoints: includes the current PIN
// in plaintext (decrypted server-side) so the admin can remind an employee
// who forgot it. Never used in employee-facing/self-service responses.
function adminPublicEmployee(e) {
  return {
    ...publicEmployee(e),
    current_pin: e.pin_encrypted ? decryptPin(e.pin_encrypted) : null,
  };
}

function publicPosition(p) {
  return { id: p.id, name: p.name, opening_items: p.opening_items || [], closing_items: p.closing_items || [] };
}

function publicShift(s) {
  return {
    id: s.id,
    employee_id: s.employee_id,
    start_at: s.start_at,
    end_at: s.end_at,
    break_minutes: s.break_minutes,
    worked_minutes: s.worked_minutes,
    hourly_rate_snapshot: s.hourly_rate_snapshot,
    earned_amount: s.earned_amount,
    opening_checklist: s.opening_checklist ?? null,
    closing_checklist: s.closing_checklist ?? null,
    status: s.status,
    edited_by_admin: !!s.edited_by_admin,
    created_at: s.created_at,
    closed_at: s.closed_at,
  };
}

// Verifies a submitted checklist against the position's required item list.
// Returns { ok: true, checklist } or { ok: false, error }.
function verifyChecklist(requiredItems, submitted) {
  if (!requiredItems || requiredItems.length === 0) {
    return { ok: true, checklist: null };
  }
  if (!Array.isArray(submitted) || submitted.length !== requiredItems.length) {
    return { ok: false, error: 'Please complete the checklist before continuing' };
  }
  const matches = requiredItems.every((text, i) => submitted[i] && submitted[i].text === text);
  const allChecked = submitted.every((item) => item.checked === true);
  if (!matches || !allChecked) {
    return { ok: false, error: 'Please check off every item on the checklist before continuing' };
  }
  const nowIso = new Date().toISOString();
  return { ok: true, checklist: submitted.map((item) => ({ text: item.text, checked: true, checked_at: nowIso })) };
}

function computeWorkedMinutes(startAt, endAt, breakMinutes) {
  const ms = new Date(endAt).getTime() - new Date(startAt).getTime();
  const rawMinutes = Math.round(ms / 60000);
  const worked = rawMinutes - (Number(breakMinutes) || 0);
  return Math.max(0, worked);
}

function computeEarned(workedMinutes, hourlyRate) {
  if (!hourlyRate) return 0;
  return Math.round(((workedMinutes / 60) * hourlyRate) * 100) / 100;
}

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing authorization token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== 'admin') return res.status(403).json({ error: 'Admin privileges required' });
    req.admin = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ---------- PIN lookup (kiosk decides which screen to show) ----------

app.post('/api/pin/lookup', (req, res) => {
  const { pin } = req.body || {};
  if (!pin) return res.status(400).json({ error: 'Enter a PIN', code: 'PIN_REQUIRED' });

  const employee = Employees.findByPin(pin);
  if (!employee) return res.status(404).json({ error: 'Incorrect PIN', code: 'INVALID_PIN' });

  if (employee.role === 'admin') {
    return res.json({ role: 'admin', full_name: employee.full_name });
  }

  const openShift = Shifts.findOpenByEmployee(employee.id);
  const position = Positions.getById(employee.position_id);

  res.json({
    role: 'employee',
    employee: publicEmployee(employee),
    position: position ? publicPosition(position) : null,
    open_shift: openShift ? publicShift(openShift) : null,
  });
});

// ---------- Shift start/end (employee, PIN-authenticated per request) ----------

app.post('/api/shifts/start', (req, res) => {
  const { pin, backdate_minutes } = req.body || {};
  const employee = Employees.findByPin(pin);
  if (!employee) return res.status(404).json({ error: 'Incorrect PIN', code: 'INVALID_PIN' });
  if (employee.role !== 'employee') return res.status(400).json({ error: "Admins don't clock in shifts", code: 'ADMIN_NO_CLOCK' });

  const openShift = Shifts.findOpenByEmployee(employee.id);
  if (openShift) return res.status(409).json({ error: 'You already have an open shift', code: 'SHIFT_ALREADY_OPEN' });

  // The shift starts the instant the button is pressed — the employee is
  // already on the clock. Any start-of-shift checklist for their position is
  // completed as a follow-up step and does not delay the clock.
  let backdateMin = Number(backdate_minutes) || 0;
  if (backdateMin < 0) backdateMin = 0;
  if (backdateMin > MAX_BACKDATE_MINUTES) backdateMin = MAX_BACKDATE_MINUTES;

  const startAt = new Date(Date.now() - backdateMin * 60000).toISOString();
  const shift = Shifts.insert({
    employee_id: employee.id,
    start_at: startAt,
    status: 'open',
  });

  res.json({ employee: publicEmployee(employee), shift: publicShift(shift) });
});

// Submitted as a follow-up right after the shift has already started.
app.post('/api/shifts/checklist/opening', (req, res) => {
  const { pin, checklist } = req.body || {};
  const employee = Employees.findByPin(pin);
  if (!employee) return res.status(404).json({ error: 'Incorrect PIN', code: 'INVALID_PIN' });
  if (employee.role !== 'employee') return res.status(400).json({ error: "Admins don't clock in shifts", code: 'ADMIN_NO_CLOCK' });

  const openShift = Shifts.findOpenByEmployee(employee.id);
  if (!openShift) return res.status(409).json({ error: 'No open shift', code: 'NO_OPEN_SHIFT' });

  const position = Positions.getById(employee.position_id);
  const check = verifyChecklist(position ? position.opening_items : [], checklist);
  if (!check.ok) return res.status(400).json({ error: check.error, code: 'CHECKLIST_INCOMPLETE' });

  const shift = Shifts.update(openShift.id, { opening_checklist: check.checklist });
  res.json({ employee: publicEmployee(employee), shift: publicShift(shift) });
});

app.post('/api/shifts/end', (req, res) => {
  const { pin, break_minutes, checklist } = req.body || {};
  const employee = Employees.findByPin(pin);
  if (!employee) return res.status(404).json({ error: 'Incorrect PIN', code: 'INVALID_PIN' });
  if (employee.role !== 'employee') return res.status(400).json({ error: "Admins don't clock in shifts", code: 'ADMIN_NO_CLOCK' });

  const breakMin = Number(break_minutes);
  if (!Number.isFinite(breakMin) || breakMin < 0) {
    return res.status(400).json({ error: 'Enter a valid break time (minutes)', code: 'INVALID_BREAK' });
  }

  const openShift = Shifts.findOpenByEmployee(employee.id);
  if (!openShift) return res.status(409).json({ error: 'No open shift', code: 'NO_OPEN_SHIFT' });

  const position = Positions.getById(employee.position_id);
  const check = verifyChecklist(position ? position.closing_items : [], checklist);
  if (!check.ok) return res.status(400).json({ error: check.error, code: 'CHECKLIST_INCOMPLETE' });

  const nowIso = new Date().toISOString();
  const workedMinutes = computeWorkedMinutes(openShift.start_at, nowIso, breakMin);
  const earned = computeEarned(workedMinutes, employee.hourly_rate);

  const shift = Shifts.update(openShift.id, {
    end_at: nowIso,
    break_minutes: breakMin,
    worked_minutes: workedMinutes,
    hourly_rate_snapshot: employee.hourly_rate || 0,
    earned_amount: earned,
    closing_checklist: check.checklist,
    status: 'closed',
    closed_at: nowIso,
  });

  res.json({ employee: publicEmployee(employee), shift: publicShift(shift) });
});

// ---------- Employee's own history (read-only) ----------

app.post('/api/shifts/mine', (req, res) => {
  const { pin } = req.body || {};
  const employee = Employees.findByPin(pin, { activeOnly: false });
  if (!employee) return res.status(404).json({ error: 'Incorrect PIN', code: 'INVALID_PIN' });
  if (employee.role !== 'employee') return res.status(400).json({ error: 'Not available for admins', code: 'ADMIN_NO_CLOCK' });

  const shifts = Shifts.getByEmployee(employee.id).slice(0, 200);
  res.json({ employee: publicEmployee(employee), shifts: shifts.map(publicShift) });
});

// ---------- Admin auth ----------

app.post('/api/admin/login', (req, res) => {
  const { pin } = req.body || {};
  const employee = Employees.findByPin(pin, { activeOnly: false });
  if (!employee || employee.role !== 'admin') {
    return res.status(401).json({ error: 'Incorrect admin PIN' });
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
      let open_hours = null;
      let needs_attention = false;
      if (r.status === 'open') {
        open_hours = Math.round(((Date.now() - new Date(r.start_at).getTime()) / 3600000) * 10) / 10;
        needs_attention = open_hours > STALE_SHIFT_HOURS;
      }
      return { ...publicShift(r), employee_name: emp ? emp.full_name : 'Deleted employee', open_hours, needs_attention };
    })
  );
});

app.put('/api/admin/shifts/:id', requireAdmin, (req, res) => {
  const existing = Shifts.getById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Shift not found' });

  const start_at = req.body.start_at || existing.start_at;
  const end_at = req.body.end_at !== undefined ? req.body.end_at : existing.end_at;
  const break_minutes =
    req.body.break_minutes !== undefined ? Number(req.body.break_minutes) : existing.break_minutes;
  const rate =
    req.body.hourly_rate !== undefined ? Number(req.body.hourly_rate) : existing.hourly_rate_snapshot || 0;

  let worked_minutes;
  let earned_amount;
  let status;
  if (end_at) {
    worked_minutes = computeWorkedMinutes(start_at, end_at, break_minutes || 0);
    earned_amount = computeEarned(worked_minutes, rate);
    status = 'closed';
  } else {
    worked_minutes = null;
    earned_amount = null;
    status = 'open';
  }

  const updated = Shifts.update(existing.id, {
    start_at,
    end_at: end_at || null,
    break_minutes: break_minutes ?? null,
    worked_minutes,
    hourly_rate_snapshot: rate,
    earned_amount,
    status,
    edited_by_admin: true,
  });

  res.json(publicShift(updated));
});

app.delete('/api/admin/shifts/:id', requireAdmin, (req, res) => {
  const ok = Shifts.delete(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Shift not found' });
  res.json({ ok: true });
});

app.post('/api/admin/shifts', requireAdmin, (req, res) => {
  const { employee_id, start_at, end_at, break_minutes } = req.body || {};
  const employee = Employees.getById(employee_id);
  if (!employee) return res.status(404).json({ error: 'Employee not found' });
  if (!start_at) return res.status(400).json({ error: 'Provide a start time' });

  const rate = req.body.hourly_rate !== undefined ? Number(req.body.hourly_rate) : employee.hourly_rate || 0;

  let worked_minutes = null;
  let earned_amount = null;
  let status = 'open';
  if (end_at) {
    worked_minutes = computeWorkedMinutes(start_at, end_at, break_minutes || 0);
    earned_amount = computeEarned(worked_minutes, rate);
    status = 'closed';
  }

  const shift = Shifts.insert({
    employee_id,
    start_at,
    end_at: end_at || null,
    break_minutes: break_minutes ?? null,
    worked_minutes,
    hourly_rate_snapshot: rate,
    earned_amount,
    status,
    edited_by_admin: true,
    closed_at: end_at || null,
  });

  res.json(publicShift(shift));
});

// ---------- Admin: employees CRUD ----------

app.get('/api/admin/employees', requireAdmin, (req, res) => {
  const rows = [...Employees.getAll()].sort((a, b) => a.full_name.localeCompare(b.full_name, 'en'));
  res.json(rows.map(adminPublicEmployee));
});

app.post('/api/admin/employees', requireAdmin, (req, res) => {
  const { full_name, pin, role, hourly_rate, position_id } = req.body || {};
  if (!full_name || !pin) return res.status(400).json({ error: 'Provide a name and PIN' });
  if (!/^\d{4,6}$/.test(String(pin))) return res.status(400).json({ error: 'PIN must be 4–6 digits' });

  const clash = Employees.findByPin(pin, { activeOnly: false });
  if (clash) return res.status(409).json({ error: 'That PIN is already used by another employee' });

  const employee = Employees.insert({
    full_name,
    pin_encrypted: encryptPin(pin),
    role: role === 'admin' ? 'admin' : 'employee',
    active: true,
    hourly_rate: Number(hourly_rate) || 0,
    position_id: position_id || null,
  });

  res.json(adminPublicEmployee(employee));
});

app.put('/api/admin/employees/:id', requireAdmin, (req, res) => {
  const existing = Employees.getById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Employee not found' });

  const patch = {};
  if (req.body.full_name !== undefined) patch.full_name = req.body.full_name;
  if (req.body.active !== undefined) patch.active = !!req.body.active;
  if (req.body.hourly_rate !== undefined) patch.hourly_rate = Number(req.body.hourly_rate) || 0;
  if (req.body.position_id !== undefined) patch.position_id = req.body.position_id || null;

  if (req.body.pin) {
    if (!/^\d{4,6}$/.test(String(req.body.pin))) {
      return res.status(400).json({ error: 'PIN must be 4–6 digits' });
    }
    const clash = Employees.findByPin(req.body.pin, { activeOnly: false });
    if (clash && clash.id !== existing.id) {
      return res.status(409).json({ error: 'That PIN is already used by another employee' });
    }
    patch.pin_encrypted = encryptPin(req.body.pin);
  }

  const updated = Employees.update(existing.id, patch);
  res.json(adminPublicEmployee(updated));
});

app.delete('/api/admin/employees/:id', requireAdmin, (req, res) => {
  const existing = Employees.getById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Employee not found' });
  if (existing.role === 'admin') {
    return res.status(400).json({ error: 'Admin accounts cannot be deleted here' });
  }
  Employees.delete(existing.id);
  res.json({ ok: true });
});

// ---------- Admin: positions CRUD (job roles + their checklists) ----------

app.get('/api/admin/positions', requireAdmin, (req, res) => {
  res.json(Positions.getAll().map(publicPosition));
});

app.post('/api/admin/positions', requireAdmin, (req, res) => {
  const { name, opening_items, closing_items } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Provide a position name' });
  const position = Positions.insert({
    name: name.trim(),
    opening_items: Array.isArray(opening_items) ? opening_items.map((s) => String(s).trim()).filter(Boolean) : [],
    closing_items: Array.isArray(closing_items) ? closing_items.map((s) => String(s).trim()).filter(Boolean) : [],
  });
  res.json(publicPosition(position));
});

app.put('/api/admin/positions/:id', requireAdmin, (req, res) => {
  const existing = Positions.getById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Position not found' });

  const patch = {};
  if (req.body.name !== undefined) patch.name = String(req.body.name).trim();
  if (req.body.opening_items !== undefined) {
    patch.opening_items = Array.isArray(req.body.opening_items)
      ? req.body.opening_items.map((s) => String(s).trim()).filter(Boolean)
      : [];
  }
  if (req.body.closing_items !== undefined) {
    patch.closing_items = Array.isArray(req.body.closing_items)
      ? req.body.closing_items.map((s) => String(s).trim()).filter(Boolean)
      : [];
  }

  const updated = Positions.update(existing.id, patch);
  res.json(publicPosition(updated));
});

app.delete('/api/admin/positions/:id', requireAdmin, (req, res) => {
  const ok = Positions.delete(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Position not found' });
  res.json({ ok: true });
});

// ---------- Admin: full data backup ----------

app.get('/api/admin/backup', requireAdmin, (req, res) => {
  const backup = {
    exported_at: new Date().toISOString(),
    employees: Employees.getAll(),
    shifts: Shifts.getAll({}),
    positions: Positions.getAll(),
  };
  const filename = `shift-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.json(backup);
});

// ---------- static frontend ----------
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Shift Tracker running: http://localhost:${PORT}`);
});
