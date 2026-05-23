'use strict';

const DEFAULTS = {
  enabled: true,
  mode: 'streamer',
  streamer: {
    hiddenUsers: ['nightbot', 'streamlabs', 'streamelements', 'moobot'],
    hideCommands: true,
    commandPrefixes: ['!'],
    highlightFirstTimers: true,
    hideDuplicates: true,
    duplicateWindowSec: 30,
    keywordHighlights: [],
    keywordHighlightColor: '#ffd700',
    speedLimit: 0,
    hideEmoteOnly: false,
    hideShortMessages: false,
    minLength: 2,
    emphasizeSuperChats: true,
    highlightByRole: true,
    blockedWords: [],
    hideNonMembers: false,
    hideMembers: false,
    hideModerators: false,
  },
  moderator: {
    highlightLinks: true,
    detectCapsSpam: true,
    capsThreshold: 70,
    detectEmojiSpam: true,
    emojiThreshold: 8,
    showNewViewerAlert: true,
    keywordAlerts: [],
    alertSound: false,
    alertWholeWord: false,
    showUserTooltip: true,
    showUserHistory: true,
    searchFilter: '',
  },
};

function deepMerge(base, over) {
  const r = { ...base };
  for (const k of Object.keys(over || {})) {
    if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]))
      r[k] = deepMerge(base[k] || {}, over[k]);
    else r[k] = over[k];
  }
  return r;
}

function getByPath(obj, path) {
  return path.split('.').reduce((o, k) => (o != null ? o[k] : undefined), obj);
}

function setByPath(obj, path, val) {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]];
  cur[keys[keys.length - 1]] = val;
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

let cfg = JSON.parse(JSON.stringify(DEFAULTS));
let pendingImport = null;

function save() { chrome.storage.sync.set({ ccCfg: cfg }); }

// ── CHIPS ─────────────────────────────────────────────────────────────────────
function createChipEl(val, type) {
  const span = document.createElement('span');
  span.className = 'chip';
  span.dataset.type = type;
  span.dataset.val = val;
  span.textContent = val;
  const del = document.createElement('button');
  del.className = 'chip-del';
  del.type = 'button';
  del.textContent = '✕';
  del.onclick = () => { span.remove(); removeChipVal(type, val); };
  span.appendChild(del);
  return span;
}

function removeChipVal(type, val) {
  const s = cfg.streamer, m = cfg.moderator;
  if (type === 'user')    s.hiddenUsers      = (s.hiddenUsers      || []).filter(x => x !== val);
  if (type === 'word')    s.blockedWords     = (s.blockedWords     || []).filter(x => x !== val);
  if (type === 'kwhigh')  s.keywordHighlights= (s.keywordHighlights|| []).filter(x => x !== val);
  if (type === 'alert')   m.keywordAlerts    = (m.keywordAlerts    || []).filter(a => (a.keyword || a) !== val);
  save();
}

function renderChips(fieldId, vals, type) {
  const field = document.getElementById(fieldId);
  if (!field) return;
  field.querySelectorAll('.chip').forEach(c => c.remove());
  const input = field.querySelector('.chip-in');
  vals.forEach(v => field.insertBefore(createChipEl(v, type), input));
}

function bindChipInput(inputId, fieldId, type, addFn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.onkeydown = (e) => {
    if (e.key !== 'Enter' && e.key !== ',') return;
    e.preventDefault();
    const val = input.value.trim();
    if (!val) return;
    addFn(val);
    document.getElementById(fieldId).insertBefore(createChipEl(val, type), input);
    input.value = '';
    save();
  };
}


// ── RENDER ────────────────────────────────────────────────────────────────────
function renderAll() {
  const isStr = cfg.mode === 'streamer';

  document.getElementById('master-toggle').checked = !!cfg.enabled;
  document.getElementById('btn-streamer').className = 'mode-btn' + (isStr ? ' active-streamer' : '');
  document.getElementById('btn-moderator').className = 'mode-btn' + (!isStr ? ' active-moderator' : '');
  document.getElementById('streamer-tab').classList.toggle('hidden', !isStr);
  document.getElementById('mod-tab').classList.toggle('hidden', isStr);

  // All checkbox data-path elements
  document.querySelectorAll('[data-path]').forEach(el => {
    el.checked = !!getByPath(cfg, el.dataset.path);
  });

  // Streamer controls
  const s = cfg.streamer;
  const speedSlider = document.getElementById('speed-slider');
  if (speedSlider) { speedSlider.value = s.speedLimit || 0; document.getElementById('speed-val').textContent = s.speedLimit ? s.speedLimit + '/s' : 'Off'; }
  const minlenSlider = document.getElementById('minlen-slider');
  if (minlenSlider) { minlenSlider.value = s.minLength || 2; document.getElementById('minlen-val').textContent = (s.minLength || 2) + ' chars'; }
  renderChips('users-field',  s.hiddenUsers       || [], 'user');
  renderChips('words-field',  s.blockedWords      || [], 'word');
  renderChips('kwhigh-field', s.keywordHighlights || [], 'kwhigh');
  const colorPicker = document.getElementById('kwhigh-color');
  if (colorPicker) colorPicker.value = s.keywordHighlightColor || '#ffd700';

  // Mod controls
  const m = cfg.moderator;
  const capsSlider = document.getElementById('caps-slider');
  if (capsSlider) { capsSlider.value = m.capsThreshold || 70; document.getElementById('caps-val').textContent = (m.capsThreshold || 70) + '%'; }
  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.value = m.searchFilter || '';
  renderChips('alerts-field', (m.keywordAlerts || []).map(a => a.keyword || a), 'alert');
}

function renderStats(stats) {
  const s = stats || {};
  document.getElementById('stat-total').textContent  = s.total  != null ? s.total.toLocaleString()  : '—';
  document.getElementById('stat-hidden').textContent = s.hidden != null ? s.hidden.toLocaleString() : '—';
  document.getElementById('stat-mpm').textContent    = s.mpm    != null ? s.mpm                     : '—';
  document.getElementById('stat-users').textContent  = s.users  != null ? s.users.toLocaleString()  : '—';
}

function setActive(stats) {
  document.getElementById('status-dot').className = 'status-dot active';
  document.getElementById('status-text').textContent = `Active · ${cfg.mode === 'streamer' ? 'Streamer' : 'Moderator'} mode`;
}

// ── EXPORT / IMPORT ───────────────────────────────────────────────────────────
function exportConfig() {
  const data = JSON.stringify({ version: 1, mode: cfg.mode, enabled: cfg.enabled, streamer: cfg.streamer, moderator: cfg.moderator }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: 'cleanchat-config.json' }).click();
  URL.revokeObjectURL(url);
}

function importConfig() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data || typeof data !== 'object') throw new Error();
        pendingImport = data;
        showImportModal(data);
      } catch { /* invalid file — ignore silently */ }
    };
    reader.readAsText(file);
  };
  input.click();
}

function showImportModal(data) {
  const hasStreamer = !!data.streamer;
  const hasMod = !!data.moderator;
  const optS = document.getElementById('import-opt-s');
  const optM = document.getElementById('import-opt-m');
  optS.classList.toggle('opt-disabled', !hasStreamer);
  optS.querySelector('input').disabled = !hasStreamer;
  optM.classList.toggle('opt-disabled', !hasMod);
  optM.querySelector('input').disabled = !hasMod;
  document.querySelector('input[name="import-sel"][value="both"]').checked = true;
  document.getElementById('import-modal').classList.remove('hidden');
}

function hideImportModal() {
  document.getElementById('import-modal').classList.add('hidden');
  pendingImport = null;
}

function applyImport() {
  if (!pendingImport) return;
  const sel = document.querySelector('input[name="import-sel"]:checked')?.value || 'both';
  if ((sel === 'streamer' || sel === 'both') && pendingImport.streamer)
    cfg.streamer = deepMerge(DEFAULTS.streamer, pendingImport.streamer);
  if ((sel === 'moderator' || sel === 'both') && pendingImport.moderator)
    cfg.moderator = deepMerge(DEFAULTS.moderator, pendingImport.moderator);
  save();
  renderAll();
  hideImportModal();
}

// ── CONFIRM HELPER ────────────────────────────────────────────────────────────
// First click arms the button (turns red, shows "Confirm?").
// Second click within 3s executes. Auto-disarms if ignored.
function confirmBtn(btn, action) {
  if (btn.dataset.armed === '1') {
    clearTimeout(btn._armTimer);
    delete btn.dataset.armed;
    btn.textContent = btn.dataset.origText;
    btn.classList.remove('btn-arming');
    action();
  } else {
    btn.dataset.origText = btn.textContent;
    btn.dataset.armed = '1';
    btn.textContent = 'Confirm?';
    btn.classList.add('btn-arming');
    btn._armTimer = setTimeout(() => {
      delete btn.dataset.armed;
      btn.textContent = btn.dataset.origText;
      btn.classList.remove('btn-arming');
    }, 3000);
  }
}

function exportLog() {
  chrome.storage.local.get('ccLog', (r) => {
    const log = r.ccLog || [];
    if (!log.length) return;
    const lines = log.map(m => `[${fmtTime(m.time)}] ${m.author}: ${m.text}`);
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), {
      href: url,
      download: `youtube-chat-${new Date().toISOString().slice(0, 10)}.txt`,
    }).click();
    URL.revokeObjectURL(url);
  });
}

// ── BIND ──────────────────────────────────────────────────────────────────────
function bindAll() {
  document.getElementById('master-toggle').addEventListener('change', (e) => {
    cfg.enabled = e.target.checked; save();
  });

  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => { cfg.mode = btn.dataset.mode; renderAll(); save(); });
  });

  document.querySelectorAll('[data-path]').forEach(el => {
    el.addEventListener('change', () => { setByPath(cfg, el.dataset.path, el.checked); save(); });
  });

  // Sliders
  document.getElementById('speed-slider').oninput = () => {
    const v = parseInt(document.getElementById('speed-slider').value);
    cfg.streamer.speedLimit = v;
    document.getElementById('speed-val').textContent = v ? v + '/s' : 'Off';
    save();
  };
  document.getElementById('minlen-slider').oninput = () => {
    const v = parseInt(document.getElementById('minlen-slider').value);
    cfg.streamer.minLength = v;
    document.getElementById('minlen-val').textContent = v + ' chars';
    save();
  };
  document.getElementById('caps-slider').oninput = () => {
    const v = parseInt(document.getElementById('caps-slider').value);
    cfg.moderator.capsThreshold = v;
    document.getElementById('caps-val').textContent = v + '%';
    save();
  };

  // Search filter
  document.getElementById('search-input').oninput = (e) => {
    cfg.moderator.searchFilter = e.target.value; save();
  };

  // Chip inputs
  bindChipInput('users-in',    'users-field',    'user',    v => { cfg.streamer.hiddenUsers      = [...(cfg.streamer.hiddenUsers      || []), v.replace(/^@/, '')]; });
  bindChipInput('words-in',    'words-field',    'word',    v => { cfg.streamer.blockedWords     = [...(cfg.streamer.blockedWords     || []), v]; });
  bindChipInput('kwhigh-in',   'kwhigh-field',   'kwhigh',  v => { cfg.streamer.keywordHighlights = [...(cfg.streamer.keywordHighlights || []), v]; });
  bindChipInput('alerts-in',   'alerts-field',   'alert',   v => { cfg.moderator.keywordAlerts    = [...(cfg.moderator.keywordAlerts    || []), { keyword: v }]; });

  document.getElementById('kwhigh-color').oninput = (e) => {
    cfg.streamer.keywordHighlightColor = e.target.value; save();
  };

  // Streamer footer
  document.getElementById('reset-seen').addEventListener('click', () => chrome.storage.local.remove('ccSeen'));

  const clearAllBtn = document.getElementById('clear-all');
  clearAllBtn.addEventListener('click', () => confirmBtn(clearAllBtn, () => {
    cfg.streamer.hiddenUsers  = [];
    cfg.streamer.blockedWords = [];
    cfg.streamer.hideCommands = cfg.streamer.hideDuplicates = cfg.streamer.hideEmoteOnly =
      cfg.streamer.hideShortMessages =
      cfg.streamer.hideNonMembers = cfg.streamer.hideMembers = cfg.streamer.hideModerators = false;
    save(); renderAll();
  }));

  const sResetBtn = document.getElementById('s-reset-defaults');
  sResetBtn.addEventListener('click', () => confirmBtn(sResetBtn, () => {
    cfg.streamer = JSON.parse(JSON.stringify(DEFAULTS.streamer));
    save(); renderAll();
  }));

  document.getElementById('s-export-cfg').addEventListener('click', exportConfig);
  document.getElementById('s-import-cfg').addEventListener('click', importConfig);

  // Mod footer
  document.getElementById('export-log').addEventListener('click', exportLog);

  const mClearBtn = document.getElementById('m-clear-all');
  mClearBtn.addEventListener('click', () => confirmBtn(mClearBtn, () => {
    cfg.moderator.searchFilter  = '';
    cfg.moderator.keywordAlerts = [];
    cfg.moderator.detectCapsSpam  = cfg.moderator.detectEmojiSpam = cfg.moderator.highlightLinks = false;
    save(); renderAll();
  }));

  const mResetBtn = document.getElementById('m-reset-defaults');
  mResetBtn.addEventListener('click', () => confirmBtn(mResetBtn, () => {
    cfg.moderator = JSON.parse(JSON.stringify(DEFAULTS.moderator));
    save(); renderAll();
  }));

  document.getElementById('m-export-cfg').addEventListener('click', exportConfig);
  document.getElementById('m-import-cfg').addEventListener('click', importConfig);

  // Import modal
  document.getElementById('import-close').addEventListener('click', hideImportModal);
  document.getElementById('import-cancel').addEventListener('click', hideImportModal);
  document.getElementById('import-apply').addEventListener('click', applyImport);
}

// ── INIT ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.sync.get('ccCfg', (r) => {
    if (r.ccCfg) cfg = deepMerge(DEFAULTS, r.ccCfg);
    renderAll();
    bindAll();
  });

  chrome.storage.local.get('ccStats', (r) => {
    if (r.ccStats) { renderStats(r.ccStats); setActive(); }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.ccStats) { renderStats(changes.ccStats.newValue); setActive(); }
  });
});
