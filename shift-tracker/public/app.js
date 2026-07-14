const API = '';
const app = document.getElementById('app');

// ---------- i18n ----------

const STRINGS = {
  en: {
    enterPin: 'Enter your PIN',
    clear: 'Clear',
    adminPanel: 'Admin panel →',
    adminPinDetected: "That's an admin PIN. Please open the admin panel instead.",
    noShiftOpen: 'No shift open',
    shiftOpenSince: (t) => `Shift open since ${t}`,
    endShift: 'End Shift',
    startShift: 'Start Shift',
    backdateLabel: 'Arrived earlier and forgot to clock in? Minutes ago:',
    myShifts: 'My Shifts',
    logOut: 'Log Out',
    checklistLabel: 'Checklist — check off every item',
    shiftStartedTitle: 'Shift Started',
    onClockMsg: "You're on the clock. Please finish the opening checklist:",
    confirmChecklist: 'Confirm Checklist',
    finishLater: "I'll finish this later",
    shiftStartedMsg: 'Shift started. Have a great shift!',
    checkAllBeforeConfirm: 'Please check off every item before confirming.',
    endShiftTitle: 'End Shift',
    breakLabel: 'How many minutes was your break?',
    cancel: 'Cancel',
    checkAllBeforeEnd: 'Please check off every item on the checklist before ending your shift.',
    shiftCompleteTitle: 'Shift Complete',
    started: 'Started:',
    ended: 'Ended:',
    breakMin: (m) => `Break: ${m} min`,
    worked: 'Worked:',
    earned: 'Earned:',
    done: 'Done',
    noShiftsYet: 'No shifts yet.',
    back: 'Back',
    openWord: 'open',
    breakShort: (m) => `Break: ${m} min`,
  },
  ru: {
    enterPin: 'Введите ПИН-код',
    clear: 'Очистить',
    adminPanel: 'Панель администратора →',
    adminPinDetected: 'Это ПИН администратора. Откройте панель администратора.',
    noShiftOpen: 'Смена не открыта',
    shiftOpenSince: (t) => `Смена открыта с ${t}`,
    endShift: 'Завершить смену',
    startShift: 'Начать смену',
    backdateLabel: 'Пришли раньше и забыли открыть смену? Минут назад:',
    myShifts: 'Мои смены',
    logOut: 'Выйти',
    checklistLabel: 'Чек-лист — отметьте все пункты',
    shiftStartedTitle: 'Смена начата',
    onClockMsg: 'Вы уже на смене. Пожалуйста, пройдите чек-лист открытия:',
    confirmChecklist: 'Подтвердить чек-лист',
    finishLater: 'Заполню позже',
    shiftStartedMsg: 'Смена начата. Хорошей работы!',
    checkAllBeforeConfirm: 'Пожалуйста, отметьте все пункты перед подтверждением.',
    endShiftTitle: 'Завершение смены',
    breakLabel: 'Сколько минут длился перерыв?',
    cancel: 'Отмена',
    checkAllBeforeEnd: 'Пожалуйста, отметьте все пункты чек-листа перед завершением смены.',
    shiftCompleteTitle: 'Смена завершена',
    started: 'Начало:',
    ended: 'Конец:',
    breakMin: (m) => `Перерыв: ${m} мин`,
    worked: 'Отработано:',
    earned: 'Заработано:',
    done: 'Готово',
    noShiftsYet: 'Смен пока нет.',
    back: 'Назад',
    openWord: 'открыта',
    breakShort: (m) => `Перерыв: ${m} мин`,
  },
};

// Translations for the fixed set of error messages the server can return.
const ERROR_TRANSLATIONS = {
  ru: {
    'Enter a PIN': 'Введите ПИН-код',
    'Incorrect PIN': 'Неверный ПИН-код',
    "Admins don't clock in shifts": 'Администраторы не отмечают смены',
    'You already have an open shift': 'У вас уже есть открытая смена',
    'No open shift': 'Нет открытой смены',
    'Enter a valid break time (minutes)': 'Введите корректное время перерыва (в минутах)',
    'Please check off every item on the checklist before continuing': 'Пожалуйста, отметьте все пункты чек-листа',
    'Please complete the checklist before continuing': 'Пожалуйста, заполните чек-лист полностью',
    'Not available for admins': 'Недоступно для администраторов',
    'Server error': 'Ошибка сервера',
    'No connection to the server': 'Нет соединения с сервером',
  },
};

function getLang() {
  return localStorage.getItem('kiosk_lang') || 'en';
}
function setLang(lang) {
  localStorage.setItem('kiosk_lang', lang);
}
function t(key, ...args) {
  const entry = STRINGS[getLang()][key];
  return typeof entry === 'function' ? entry(...args) : entry;
}
function translateError(message) {
  const lang = getLang();
  if (lang === 'en') return message;
  return (ERROR_TRANSLATIONS[lang] && ERROR_TRANSLATIONS[lang][message]) || message;
}

// ---------- state ----------

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
  if (!res.ok) throw new Error(translateError(json.error || 'Server error'));
  return json;
}

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const locale = getLang() === 'ru' ? 'ru-RU' : 'en-US';
  return d.toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function fmtDuration(minutes) {
  if (minutes === null || minutes === undefined) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return getLang() === 'ru' ? `${h}ч ${m}м` : `${h}h ${m}m`;
}

function fmtMoney(amount) {
  if (amount === null || amount === undefined) return '—';
  return `$${Number(amount).toFixed(2)}`;
}

function checklistHtml(items, checkedArr, idPrefix) {
  return `
    <div class="field" style="text-align:left;">
      <label>${t('checklistLabel')}</label>
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

function langToggleHtml() {
  const lang = getLang();
  return `
    <div style="position:absolute; top:16px; right:16px;">
      <button id="langToggle" class="btn-sm btn-ghost" style="padding:6px 12px; border-radius:8px; border:1px solid var(--border); background:transparent; color:var(--muted); cursor:pointer;">
        ${lang === 'en' ? 'RU' : 'EN'}
      </button>
    </div>
  `;
}
function bindLangToggle() {
  const btn = document.getElementById('langToggle');
  if (btn) btn.addEventListener('click', () => {
    setLang(getLang() === 'en' ? 'ru' : 'en');
    render();
  });
}

// ---------- PIN screen ----------

function renderPin() {
  const dots = Array.from({ length: 6 }, (_, i) =>
    `<div class="pin-dot ${i < state.pin.length ? 'filled' : ''}"></div>`
  ).join('');

  app.innerHTML = `
    <div style="position:relative; width:100%; max-width:420px;">
      ${langToggleHtml()}
      <div class="card">
        <div class="clock" id="clock"></div>
        <h1>${t('enterPin')}</h1>
        <div class="pin-display">${dots}</div>
        <div class="msg ${state.msgType}">${state.msg}</div>
        <div class="pin-pad">
          ${[1,2,3,4,5,6,7,8,9].map(n => `<button data-key="${n}">${n}</button>`).join('')}
          <button data-key="clear">${t('clear')}</button>
          <button data-key="0">0</button>
          <button data-key="back">⌫</button>
        </div>
        <div class="link-row"><a href="/admin.html">${t('adminPanel')}</a></div>
      </div>
    </div>
  `;

  bindLangToggle();

  document.getElementById('clock').textContent = new Date().toLocaleString(getLang() === 'ru' ? 'ru-RU' : 'en-US');

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
      state.msg = t('adminPinDetected');
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
  const { employee, open_shift } = state.data;
  const isOpen = !!open_shift;

  app.innerHTML = `
    <div class="card">
      <div class="employee-name">${employee.full_name}</div>
      <div class="status-badge ${isOpen ? 'open' : 'idle'}">
        ${isOpen ? t('shiftOpenSince', fmtTime(open_shift.start_at)) : t('noShiftOpen')}
      </div>
      <div class="msg ${state.msgType}">${state.msg}</div>
      ${
        isOpen
          ? `<button class="btn btn-danger" id="endBtn">${t('endShift')}</button>`
          : `
            <div class="field" style="text-align:left;">
              <label>${t('backdateLabel')}</label>
              <input type="number" id="backdateInput" min="0" max="360" value="${state.backdate || 0}" />
            </div>
            <button class="btn btn-success" id="startBtn">${t('startShift')}</button>
          `
      }
      <button class="btn btn-ghost" id="historyBtn">${t('myShifts')}</button>
      <button class="btn btn-ghost" id="backBtn">${t('logOut')}</button>
    </div>
  `;

  document.getElementById('backBtn').addEventListener('click', goHome);
  document.getElementById('historyBtn').addEventListener('click', showHistory);

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
  // The shift starts immediately — the employee is already on the clock.
  // Any opening checklist for their position is filled out right after,
  // as a separate step, so it never delays the start time.
  try {
    const result = await api('/api/shifts/start', { pin: state.pin, backdate_minutes: state.backdate || 0 });
    state.data.open_shift = result.shift;
    state.backdate = 0;

    const { position } = state.data;
    const openingItems = position ? position.opening_items : [];
    if (openingItems.length) {
      state.screen = 'openingChecklist';
      state.msg = '';
    } else {
      state.msg = t('shiftStartedMsg');
      state.msgType = 'success';
    }
    render();
    resetInactivityTimer();
  } catch (e) {
    state.msg = e.message;
    state.msgType = 'error';
    render();
  }
}

// ---------- Opening checklist (shown right after the shift has started) ----------

function renderOpeningChecklist() {
  const { position } = state.data;
  const openingItems = position ? position.opening_items : [];

  app.innerHTML = `
    <div class="card">
      <h1>${t('shiftStartedTitle')}</h1>
      <p style="color: var(--muted); font-size: 14px;">${t('onClockMsg')}</p>
      ${checklistHtml(openingItems, state.openChecked, 'open')}
      <div class="msg ${state.msgType}">${state.msg}</div>
      <button class="btn btn-primary" id="confirmOpen">${t('confirmChecklist')}</button>
      <button class="btn btn-ghost" id="laterOpen">${t('finishLater')}</button>
    </div>
  `;

  bindChecklist('open', state.openChecked);

  document.getElementById('laterOpen').addEventListener('click', goHome);

  document.getElementById('confirmOpen').addEventListener('click', async () => {
    if (state.openChecked.some((c) => !c)) {
      state.msg = t('checkAllBeforeConfirm');
      state.msgType = 'error';
      render();
      return;
    }
    const checklist = openingItems.map((text, i) => ({ text, checked: state.openChecked[i] }));
    try {
      await api('/api/shifts/checklist/opening', { pin: state.pin, checklist });
      state.screen = 'home';
      state.msg = t('shiftStartedMsg');
      state.msgType = 'success';
      render();
      resetInactivityTimer();
    } catch (e) {
      state.msg = e.message;
      state.msgType = 'error';
      render();
    }
  });
}

// ---------- Break input before ending shift ----------

function renderBreak() {
  const { position } = state.data;
  const closingItems = position ? position.closing_items : [];

  app.innerHTML = `
    <div class="card">
      <h1>${t('endShiftTitle')}</h1>
      ${closingItems.length ? checklistHtml(closingItems, state.closeChecked, 'close') : ''}
      <div class="field">
        <label>${t('breakLabel')}</label>
        <input type="number" id="breakInput" inputmode="numeric" min="0" placeholder="0" autofocus />
      </div>
      <div class="msg ${state.msgType}">${state.msg}</div>
      <button class="btn btn-danger" id="confirmEnd">${t('endShift')}</button>
      <button class="btn btn-ghost" id="cancelEnd">${t('cancel')}</button>
    </div>
  `;

  if (closingItems.length) bindChecklist('close', state.closeChecked);

  document.getElementById('cancelEnd').addEventListener('click', () => {
    state.screen = 'home';
    render();
  });

  document.getElementById('confirmEnd').addEventListener('click', async () => {
    if (closingItems.length && state.closeChecked.some((c) => !c)) {
      state.msg = t('checkAllBeforeEnd');
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
      <h1>${t('shiftCompleteTitle')}</h1>
      <p>${t('started')} ${fmtTime(s.start_at)}</p>
      <p>${t('ended')} ${fmtTime(s.end_at)}</p>
      <p>${t('breakMin', s.break_minutes)}</p>
      <p class="employee-name">${t('worked')} ${fmtDuration(s.worked_minutes)}</p>
      ${hasRate ? `<p class="employee-name">${t('earned')} ${fmtMoney(s.earned_amount)}</p>` : ''}
      <button class="btn btn-primary" id="okBtn">${t('done')}</button>
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
        <div class="date">${fmtTime(s.start_at)} → ${s.end_at ? fmtTime(s.end_at) : t('openWord')}</div>
        <div>${t('breakShort', s.break_minutes ?? 0)} · <span class="worked">${fmtDuration(s.worked_minutes)}</span>${hasRate ? ` · <span class="worked">${fmtMoney(s.earned_amount)}</span>` : ''}</div>
      </div>
    `;
      }).join('')
    : `<p>${t('noShiftsYet')}</p>`;

  app.innerHTML = `
    <div class="card">
      <h1>${t('myShifts')}</h1>
      <div class="history">${items}</div>
      <button class="btn btn-ghost" id="backBtn">${t('back')}</button>
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
  else if (state.screen === 'openingChecklist') renderOpeningChecklist();
  else if (state.screen === 'break') renderBreak();
  else if (state.screen === 'summary') renderSummary();
  else if (state.screen === 'history') renderHistory();
}

render();
setInterval(() => {
  const clockEl = document.getElementById('clock');
  if (clockEl) clockEl.textContent = new Date().toLocaleString(getLang() === 'ru' ? 'ru-RU' : 'en-US');
}, 1000);

['click', 'touchstart'].forEach((evt) => {
  document.addEventListener(evt, resetInactivityTimer, { passive: true });
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
