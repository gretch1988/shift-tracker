// Lightweight, dependency-free JSON-file datastore.
// Chosen over native SQLite bindings so the app installs cleanly on any
// hosting platform without a native build step (no node-gyp / prebuild-install).
// Fine for the target scale here (a handful of employees, a few thousand shifts).

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'shifts.json');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

function load() {
  const empty = { employees: [], shifts: [], positions: [], nextEmployeeId: 1, nextShiftId: 1, nextPositionId: 1 };
  if (!fs.existsSync(DB_PATH)) {
    return empty;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    return { ...empty, ...parsed };
  } catch (e) {
    console.error('[db] Could not read data file, creating a new one:', e.message);
    return empty;
  }
}

let state = load();

function persist() {
  fs.writeFileSync(DB_PATH, JSON.stringify(state, null, 2));
}

// ---------- employees ----------

const employees = {
  getAll() {
    return [...state.employees];
  },
  getById(id) {
    return state.employees.find((e) => e.id === Number(id)) || null;
  },
  findByPin(pin, { activeOnly = true } = {}) {
    const pool = activeOnly ? state.employees.filter((e) => e.active) : state.employees;
    return pool.find((e) => bcrypt.compareSync(String(pin), e.pin_hash)) || null;
  },
  insert({ full_name, pin_hash, role, active = true, hourly_rate = 0, position_id = null }) {
    const emp = {
      id: state.nextEmployeeId++,
      full_name,
      pin_hash,
      role,
      active: !!active,
      hourly_rate: Number(hourly_rate) || 0,
      position_id: position_id ? Number(position_id) : null,
      created_at: new Date().toISOString(),
    };
    state.employees.push(emp);
    persist();
    return emp;
  },
  update(id, patch) {
    const emp = employees.getById(id);
    if (!emp) return null;
    Object.assign(emp, patch);
    persist();
    return emp;
  },
};

// ---------- positions (job roles with start/end checklists, e.g. "Barista") ----------

const positions = {
  getAll() {
    return [...state.positions];
  },
  getById(id) {
    if (!id) return null;
    return state.positions.find((p) => p.id === Number(id)) || null;
  },
  insert({ name, opening_items = [], closing_items = [] }) {
    const pos = {
      id: state.nextPositionId++,
      name,
      opening_items: opening_items.filter(Boolean),
      closing_items: closing_items.filter(Boolean),
      created_at: new Date().toISOString(),
    };
    state.positions.push(pos);
    persist();
    return pos;
  },
  update(id, patch) {
    const pos = positions.getById(id);
    if (!pos) return null;
    Object.assign(pos, patch);
    persist();
    return pos;
  },
  delete(id) {
    const idx = state.positions.findIndex((p) => p.id === Number(id));
    if (idx === -1) return false;
    state.positions.splice(idx, 1);
    // Unassign this position from any employees who had it
    state.employees.forEach((e) => {
      if (e.position_id === Number(id)) e.position_id = null;
    });
    persist();
    return true;
  },
};

// ---------- shifts ----------

const shifts = {
  getAll({ employee_id, from, to, status } = {}) {
    let rows = [...state.shifts];
    if (employee_id) rows = rows.filter((s) => s.employee_id === Number(employee_id));
    if (status) rows = rows.filter((s) => s.status === status);
    if (from) rows = rows.filter((s) => s.start_at >= from);
    if (to) rows = rows.filter((s) => s.start_at <= to);
    return rows.sort((a, b) => (a.start_at < b.start_at ? 1 : -1));
  },
  getById(id) {
    return state.shifts.find((s) => s.id === Number(id)) || null;
  },
  getByEmployee(employee_id) {
    return state.shifts
      .filter((s) => s.employee_id === Number(employee_id))
      .sort((a, b) => (a.start_at < b.start_at ? 1 : -1));
  },
  findOpenByEmployee(employee_id) {
    return state.shifts.find((s) => s.employee_id === Number(employee_id) && s.status === 'open') || null;
  },
  insert(data) {
    const shift = {
      id: state.nextShiftId++,
      employee_id: Number(data.employee_id),
      start_at: data.start_at,
      end_at: data.end_at || null,
      break_minutes: data.break_minutes ?? null,
      worked_minutes: data.worked_minutes ?? null,
      hourly_rate_snapshot: data.hourly_rate_snapshot ?? null,
      earned_amount: data.earned_amount ?? null,
      opening_checklist: data.opening_checklist ?? null,
      closing_checklist: data.closing_checklist ?? null,
      status: data.status || 'open',
      edited_by_admin: !!data.edited_by_admin,
      created_at: new Date().toISOString(),
      closed_at: data.closed_at || null,
    };
    state.shifts.push(shift);
    persist();
    return shift;
  },
  update(id, patch) {
    const shift = shifts.getById(id);
    if (!shift) return null;
    Object.assign(shift, patch);
    persist();
    return shift;
  },
  delete(id) {
    const idx = state.shifts.findIndex((s) => s.id === Number(id));
    if (idx === -1) return false;
    state.shifts.splice(idx, 1);
    persist();
    return true;
  },
};

// Seed first admin account if none exists yet
if (!state.employees.some((e) => e.role === 'admin')) {
  const adminName = process.env.ADMIN_NAME || 'Owner';
  const adminPin = process.env.ADMIN_PIN || '9999';
  employees.insert({ full_name: adminName, pin_hash: bcrypt.hashSync(String(adminPin), 10), role: 'admin', active: true });
  console.log(`[seed] Created admin "${adminName}" with default PIN: ${adminPin}`);
  console.log('[seed] IMPORTANT: change this PIN after your first login to the admin panel!');
}

module.exports = { employees, shifts, positions };
