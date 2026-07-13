const API = '';
const app = document.getElementById('app');

const initialState = () => ({
  screen: 'pin',
  pin: '',
  data: null,
  msg: '',
  msgType: '',
  backdate: 0,
  openChecked: [],
  closeChecked: [],
});

let state = initialState();
let inactivityTimer = null;

function resetInactivityTimer() {
  clearTimeout(inactivityTimer);
  if (state.screen !== 'pin') {
    inactivityTimer = setTimeout(() => {
      goHome();
    }, 60000);
  }
}

function goHome() {
  state = initialState();
  render();
}

async function api(path, body) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Server error');
  return json;
}

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function fmtDuration(minutes) {
  if (minutes === null || minutes === undefined) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

function fmtMoney(amount) {
  if (amount === null || amount === undefined) return '—';
  return `$${Number(amount).toFixed(2)}`;
}

function checklistHtml(items, checkedArr, idPrefix) {
  return `
    <div class="field" style="text-align:left;">
      <label>Checklist — check off every item</label>
      ${items.map((text, i) => `
        <label class="checklist-item">
          <input type="checkbox" data-checklist="${idPrefix}" data-index="${i}" ${checkedArr[i] ? 'checked' : ''} />
          <span>${text}</span>
        </label>
      `).join('')}
    </div>
  `;
}

function bindChecklist(idPrefix, checkedArr) {
  app.querySelectorAll(`[data-checklist="${idPrefix}"]`).forEach((cb) => {
    cb.addEventListener('change', () => {
      checkedArr[Number(cb.dataset.index)] = cb.checked;
    });
  });
}

// ---------- PIN screen ----------

function renderPin() {
  const dots = Array.from({ length: 6 }, (_, i) =>
    `<div class="pin-dot ${i < state.pin.length ? 'filled' : ''}"></div>`
  ).join('');

  app.innerHTML = `
    <div class="card">
      <div class="clock" id="clock"></div>
      <h1>Enter your PIN</h1>
      <div class="pin-display">${dots}</div>
      <div class="msg ${state.msgType}">${state.msg}</div>
      <div class="pin-pad">
        ${[1,2,3,4,5,6,7,8,9].map(n => `<button data-key="${n}">${n}</button>`).join('')}
        <button data-key="clear">Clear</button>
        <button data-key="0">0</button>
        <button data-key="back">⌫</button>
      </div>
      <div class="link-row"><a href="/admin.html">Admin panel →</a></div>
    </div>
  `;

  document.getElementById('clock').textContent = new Date().toLocaleString('en-US');

  app.querySelectorAll('.pin-pad button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      if (key === 'clear') state.pin = '';
      else if (key === 'back') state.pin = state.pin.slice(0, -1);
      else if (state.pin.length < 6) state.pin += key;

      state.msg = '';
      render();

      if (state.pin.length >= 4) {
        submitPin();
      }
    });
  });
}

async function submitPin() {
  const pin = state.pin;
  try {
    const result = await api('/api/pin/lookup', { pin });
    if (result.role === 'admin') {
      state.msg = `That's an admin PIN. Please open the admin panel instead.`;
      state.msgType = 'success';
      state.pin = '';
      render();
      return;
    }
    state.screen = 'home';
    state.data = result;
    state.pin = pin; // keep for start/end calls
    state.msg = '';
    state.openChecked = result.position ? result.position.opening_items.map(() => false) : [];
    state.closeChecked = result.position ? result.position.closing_items.map(() => false) : [];
    render();
    resetInactivityTimer();
  } catch (e) {
    state.msg = e.message;
    state.msgType = 'error';
    state.pin = '';
    render();
  }
}

// ---------- Employee home ----------

function renderHome() {
  const { employee, open_shift, position } = state.data;
  const isOpen = !!open_shift;
  const openingItems = position ? position.opening_items : [];

  app.innerHTML = `
    <div class="card">
      <div class="employee-name">${employee.full_name}</div>
      <div class="status-badge ${isOpen ? 'open' : 'idle'}">
        ${isOpen ? `Shift open since ${fmtTime(open_shift.start_at)}` : 'No shift open'}
      </div>
      <div class="msg ${state.msgType}">${state.msg}</div>
      ${
        isOpen
          ? `<button class="btn btn-danger" id="endBtn">End Shift</button>`
          : `
            ${openingItems.length ? checklistHtml(openingItems, state.openChecked, 'open') : ''}
            <div class="field" style="text-align:left;">
              <label>Arrived earlier and forgot to clock in? Minutes ago:</label>
              <input type="number" id="backdateInput" min="0" max="360" value="${state.backdate || 0}" />
            </div>
            <button class="btn btn-success" id="startBtn">Start Shift</button>
          `
      }
      <button class="btn btn-ghost" id="historyBtn">My Shifts</button>
      <button class="btn btn-ghost" id="backBtn">Log Out</button>
    </div>
  `;

  document.getElementById('backBtn').addEventListener('click', goHome);
  document.getElementById('historyBtn').addEventListener('click', showHistory);

  if (openingItems.length) bindChecklist('open', state.openChecked);

  const startBtn = document.getElementById('startBtn');
  if (startBtn) startBtn.addEventListener('click', doStart);

  const backdateInput = document.getElementById('backdateInput');
  if (backdateInput) backdateInput.addEventListener('input', () => {
    state.backdate = Number(backdateInput.value) || 0;
  });

  const endBtn = document.getElementById('endBtn');
  if (endBtn) endBtn.addEventListener('click', () => {
    state.screen = 'break';
    render();
  });
}

async function doStart() {
  const { position } = state.data;
  const openingItems = position ? position.opening_items : [];
  if (openingItems.length && state.openChecked.some((c) => !c)) {
    state.msg = 'Please check off every item on the checklist before starting your shift.';
    state.msgType = 'error';
    render();
    return;
  }

  const checklist = openingItems.length
    ? openingItems.map((text, i) => ({ text, checked: state.openChecked[i] }))
    : undefined;

  try {
    const result = await api('/api/shifts/start', { pin: state.pin, backdate_minutes: state.backdate || 0, checklist });
    state.data.open_shift = result.shift;
    state.backdate = 0;
    state.msg = 'Shift started. Have a great shift!';
    state.msgType = 'success';
    render();
    resetInactivityTimer();
  } catch (e) {
    state.msg = e.message;
    state.msgType = 'error';
    render();
  }
}

// ---------- Break input before ending shift ----------

function renderBreak() {
  const { position } = state.data;
  const closingItems = position ? position.closing_items : [];

  app.innerHTML = `
    <div class="card">
      <h1>End Shift</h1>
      ${closingItems.length ? checklistHtml(closingItems, state.closeChecked, 'close') : ''}
      <div class="field">
        <label>How many minutes was your break?</label>
        <input type="number" id="breakInput" inputmode="numeric" min="0" placeholder="0" autofocus />
      </div>
      <div class="msg ${state.msgType}">${state.msg}</div>
      <button class="btn btn-danger" id="confirmEnd">End Shift</button>
      <button class="btn btn-ghost" id="cancelEnd">Cancel</button>
    </div>
  `;

  if (closingItems.length) bindChecklist('close', state.closeChecked);

  document.getElementById('cancelEnd').addEventListener('click', () => {
    state.screen = 'home';
    render();
  });

  document.getElementById('confirmEnd').addEventListener('click', async () => {
    if (closingItems.length && state.closeChecked.some((c) => !c)) {
      state.msg = 'Please check off every item on the checklist before ending your shift.';
      state.msgType = 'error';
      render();
      return;
    }

    const val = document.getElementById('breakInput').value;
    const breakMinutes = Number(val || 0);
    const checklist = closingItems.length
      ? closingItems.map((text, i) => ({ text, checked: state.closeChecked[i] }))
      : undefined;

    try {
      const result = await api('/api/shifts/end', { pin: state.pin, break_minutes: breakMinutes, checklist });
      state.screen = 'summary';
      state.data.lastShift = result.shift;
      render();
      resetInactivityTimer();
    } catch (e) {
      state.msg = e.message;
      state.msgType = 'error';
      render();
    }
  });
}

function renderSummary() {
  const s = state.data.lastShift;
  const hasRate = s.hourly_rate_snapshot && s.hourly_rate_snapshot > 0;
  app.innerHTML = `
    <div class="card">
      <h1>Shift Complete</h1>
      <p>Started: ${fmtTime(s.start_at)}</p>
      <p>Ended: ${fmtTime(s.end_at)}</p>
      <p>Break: ${s.break_minutes} min</p>
      <p class="employee-name">Worked: ${fmtDuration(s.worked_minutes)}</p>
      ${hasRate ? `<p class="employee-name">Earned: ${fmtMoney(s.earned_amount)}</p>` : ''}
      <button class="btn btn-primary" id="okBtn">Done</button>
    </div>
  `;
  document.getElementById('okBtn').addEventListener('click', goHome);
}

// ---------- Employee's own history ----------

async function showHistory() {
  try {
    const result = await api('/api/shifts/mine', { pin: state.pin });
    state.screen = 'history';
    state.data.history = result.shifts;
    render();
    resetInactivityTimer();
  } catch (e) {
    state.msg = e.message;
    state.msgType = 'error';
    render();
  }
}

function renderHistory() {
  const shifts = state.data.history || [];
  const items = shifts.length
    ? shifts.map((s) => {
        const hasRate = s.hourly_rate_snapshot && s.hourly_rate_snapshot > 0;
        return `
      <div class="history-item">
        <div class="date">${fmtTime(s.start_at)} → ${s.end_at ? fmtTime(s.end_at) : 'open'}</div>
        <div>Break: ${s.break_minutes ?? 0} min · <span class="worked">${fmtDuration(s.worked_minutes)}</span>${hasRate ? ` · <span class="worked">${fmtMoney(s.earned_amount)}</span>` : ''}</div>
      </div>
    `;
      }).join('')
    : '<p>No shifts yet.</p>';

  app.innerHTML = `
    <div class="card">
      <h1>My Shifts</h1>
      <div class="history">${items}</div>
      <button class="btn btn-ghost" id="backBtn">Back</button>
    </div>
  `;
  document.getElementById('backBtn').addEventListener('click', () => {
    state.screen = 'home';
    render();
  });
}

// ---------- render dispatcher ----------

function render() {
  if (state.screen === 'pin') renderPin();
  else if (state.screen === 'home') renderHome();
  else if (state.screen === 'break') renderBreak();
  else if (state.screen === 'summary') renderSummary();
  else if (state.screen === 'history') renderHistory();
}

render();
setInterval(() => {
  const clockEl = document.getElementById('clock');
  if (clockEl) clockEl.textContent = new Date().toLocaleString('en-US');
}, 1000);

['click', 'touchstart'].forEach((evt) => {
  document.addEventListener(evt, resetInactivityTimer, { passive: true });
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
