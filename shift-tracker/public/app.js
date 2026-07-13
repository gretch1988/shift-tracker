const API = '';
const app = document.getElementById('app');

let state = { screen: 'pin', pin: '', data: null, msg: '', msgType: '' };
let inactivityTimer = null;

function resetInactivityTimer() {
  clearTimeout(inactivityTimer);
  if (state.screen !== 'pin') {
    inactivityTimer = setTimeout(() => {
      goHome();
    }, 45000);
  }
}

function goHome() {
  state = { screen: 'pin', pin: '', data: null, msg: '', msgType: '' };
  render();
}

async function api(path, body) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Ошибка сервера');
  return json;
}

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function fmtDuration(minutes) {
  if (minutes === null || minutes === undefined) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h} ч ${m} мин`;
}

// ---------- PIN screen ----------

function renderPin() {
  const dots = Array.from({ length: 6 }, (_, i) =>
    `<div class="pin-dot ${i < state.pin.length ? 'filled' : ''}"></div>`
  ).join('');

  app.innerHTML = `
    <div class="card">
      <div class="clock" id="clock"></div>
      <h1>Введите ПИН-код</h1>
      <div class="pin-display">${dots}</div>
      <div class="msg ${state.msgType}">${state.msg}</div>
      <div class="pin-pad">
        ${[1,2,3,4,5,6,7,8,9].map(n => `<button data-key="${n}">${n}</button>`).join('')}
        <button data-key="clear">Очистить</button>
        <button data-key="0">0</button>
        <button data-key="back">⌫</button>
      </div>
      <div class="link-row"><a href="/admin.html">Панель администратора →</a></div>
    </div>
  `;

  document.getElementById('clock').textContent = new Date().toLocaleString('ru-RU');

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
      state.msg = `Это ПИН администратора. Откройте панель администратора.`;
      state.msgType = 'success';
      state.pin = '';
      render();
      return;
    }
    state.screen = 'home';
    state.data = result;
    state.pin = pin; // keep for start/end calls
    state.msg = '';
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
  const { employee, open_shift } = state.data;
  const isOpen = !!open_shift;

  app.innerHTML = `
    <div class="card">
      <div class="employee-name">${employee.full_name}</div>
      <div class="status-badge ${isOpen ? 'open' : 'idle'}">
        ${isOpen ? `Смена открыта с ${fmtTime(open_shift.start_at)}` : 'Смена не открыта'}
      </div>
      <div class="msg ${state.msgType}">${state.msg}</div>
      ${
        isOpen
          ? `<button class="btn btn-danger" id="endBtn">Завершить смену</button>`
          : `<button class="btn btn-success" id="startBtn">Начать смену</button>`
      }
      <button class="btn btn-ghost" id="historyBtn">Мои смены</button>
      <button class="btn btn-ghost" id="backBtn">Выйти</button>
    </div>
  `;

  document.getElementById('backBtn').addEventListener('click', goHome);
  document.getElementById('historyBtn').addEventListener('click', showHistory);

  const startBtn = document.getElementById('startBtn');
  if (startBtn) startBtn.addEventListener('click', doStart);

  const endBtn = document.getElementById('endBtn');
  if (endBtn) endBtn.addEventListener('click', () => {
    state.screen = 'break';
    render();
  });
}

async function doStart() {
  try {
    const result = await api('/api/shifts/start', { pin: state.pin });
    state.data.open_shift = result.shift;
    state.msg = 'Смена начата. Хорошей работы!';
    state.msgType = 'success';
    render();
    resetInactivityTimer();
    setTimeout(goHome, 2500);
  } catch (e) {
    state.msg = e.message;
    state.msgType = 'error';
    render();
  }
}

// ---------- Break input before ending shift ----------

function renderBreak() {
  app.innerHTML = `
    <div class="card">
      <h1>Завершение смены</h1>
      <div class="field">
        <label>Сколько минут длился перерыв?</label>
        <input type="number" id="breakInput" inputmode="numeric" min="0" placeholder="0" autofocus />
      </div>
      <div class="msg ${state.msgType}">${state.msg}</div>
      <button class="btn btn-danger" id="confirmEnd">Завершить смену</button>
      <button class="btn btn-ghost" id="cancelEnd">Отмена</button>
    </div>
  `;

  document.getElementById('cancelEnd').addEventListener('click', () => {
    state.screen = 'home';
    render();
  });

  document.getElementById('confirmEnd').addEventListener('click', async () => {
    const val = document.getElementById('breakInput').value;
    const breakMinutes = Number(val || 0);
    try {
      const result = await api('/api/shifts/end', { pin: state.pin, break_minutes: breakMinutes });
      state.screen = 'summary';
      state.data.lastShift = result.shift;
      render();
      setTimeout(goHome, 4000);
    } catch (e) {
      state.msg = e.message;
      state.msgType = 'error';
      render();
    }
  });
}

function renderSummary() {
  const s = state.data.lastShift;
  app.innerHTML = `
    <div class="card">
      <h1>Смена завершена</h1>
      <p>Начало: ${fmtTime(s.start_at)}</p>
      <p>Конец: ${fmtTime(s.end_at)}</p>
      <p>Перерыв: ${s.break_minutes} мин</p>
      <p class="employee-name">Отработано: ${fmtDuration(s.worked_minutes)}</p>
      <button class="btn btn-primary" id="okBtn">Готово</button>
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
    ? shifts.map((s) => `
      <div class="history-item">
        <div class="date">${fmtTime(s.start_at)} → ${s.end_at ? fmtTime(s.end_at) : 'открыта'}</div>
        <div>Перерыв: ${s.break_minutes ?? 0} мин · <span class="worked">${fmtDuration(s.worked_minutes)}</span></div>
      </div>
    `).join('')
    : '<p>Смен пока нет.</p>';

  app.innerHTML = `
    <div class="card">
      <h1>Мои смены</h1>
      <div class="history">${items}</div>
      <button class="btn btn-ghost" id="backBtn">Назад</button>
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
  if (clockEl) clockEl.textContent = new Date().toLocaleString('ru-RU');
}, 1000);

['click', 'touchstart'].forEach((evt) => {
  document.addEventListener(evt, resetInactivityTimer, { passive: true });
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
