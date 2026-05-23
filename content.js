(function () {
  'use strict';

  if (!window.location.href.includes('live_chat')) return;
  if (window.__ccLoaded) return;
  window.__ccLoaded = true;

  const NS = 'cc';

  // ─── DEFAULTS ────────────────────────────────────────────────────────────────
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

  // ─── STATE ───────────────────────────────────────────────────────────────────
  let cfg = deepClone(DEFAULTS);
  let seenUsers = new Set();
  let recentMsgs = new Map();
  let userHistory = new Map();
  let sessionLog = [];
  let speedWindow = [];
  let stats = { total: 0, hidden: 0, recentWindow: [], users: new Set() };

  // ─── STORAGE ─────────────────────────────────────────────────────────────────
  async function loadAll() {
    return new Promise((res) => {
      chrome.storage.sync.get('ccCfg', (r) => {
        if (r.ccCfg) cfg = deepMerge(DEFAULTS, r.ccCfg);
        chrome.storage.local.get('ccSeen', (r2) => {
          if (r2.ccSeen) seenUsers = new Set(r2.ccSeen);
          res();
        });
      });
    });
  }

  function saveCfg() {
    chrome.storage.sync.set({ ccCfg: cfg });
  }

  let saveSeenTimer;
  function saveSeen() {
    clearTimeout(saveSeenTimer);
    saveSeenTimer = setTimeout(() => {
      chrome.storage.local.set({ ccSeen: [...seenUsers].slice(-8000) });
    }, 2000);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.ccCfg) {
      cfg = deepMerge(DEFAULTS, changes.ccCfg.newValue || {});
      refreshControlBar();
      reprocessAll();
    }
  });

  // ─── UTILS ───────────────────────────────────────────────────────────────────
  function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

  function deepMerge(base, over) {
    const r = { ...base };
    for (const k of Object.keys(over || {})) {
      if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]))
        r[k] = deepMerge(base[k] || {}, over[k]);
      else r[k] = over[k];
    }
    return r;
  }

  function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  // ─── DOM HELPERS ─────────────────────────────────────────────────────────────
  function getAuthorName(el) {
    return (el.querySelector('#author-name')?.textContent || '').trim();
  }

  function getAuthorId(el) {
    const attr = el.getAttribute('author-external-channel-id');
    if (attr) return attr;
    const link = el.querySelector('a#author-name, #author-name a');
    if (link?.href) {
      const m = link.href.match(/channel\/(UC[^/?&]+)/);
      if (m) return m[1];
    }
    return getAuthorName(el).toLowerCase();
  }

  function getMsgText(el) {
    return (el.querySelector('#message')?.textContent || '').trim();
  }

  function getMsgType(el) {
    const tag = el.tagName.toLowerCase();
    if (tag.includes('paid-message') || tag.includes('paid_message')) return 'superchat';
    if (tag.includes('membership') || tag.includes('member')) return 'membership';
    if (tag.includes('sticker')) return 'sticker';
    return 'message';
  }

  function hasBadge(el, ...keywords) {
    for (const b of el.querySelectorAll('yt-live-chat-author-badge-renderer')) {
      const t = [b.getAttribute('shared-tooltip-text') || '', b.getAttribute('type') || '', b.textContent || ''].join(' ').toLowerCase();
      if (keywords.some((kw) => t.includes(kw))) return true;
    }
    return false;
  }

  function isEmoteOnly(el) {
    const msgEl = el.querySelector('#message');
    if (!msgEl) return false;
    const rawText = msgEl.textContent.trim();
    const hasImgs = msgEl.querySelectorAll('img').length > 0;
    // Pure image emotes (YouTube custom emotes render as <img> with no text node)
    if (!rawText && hasImgs) return true;
    if (!rawText) return false;
    // Strip :shortcode: emotes (e.g. :slightly_smiling_face:) and Unicode emoji chars.
    // If nothing real remains, the message is emote-only.
    const stripped = rawText
      .replace(/:[a-zA-Z0-9_]+:/g, '')
      .replace(/\p{Emoji}/gu, '')
      .trim();
    return stripped.length === 0;
  }

  function countEmoji(text) { return (text.match(/\p{Emoji}/gu) || []).length; }

  function capsPercent(text) {
    const letters = text.replace(/[^a-zA-Z]/g, '');
    if (letters.length < 5) return 0;
    return (text.replace(/[^A-Z]/g, '').length / letters.length) * 100;
  }

  function hasLink(text) {
    return /https?:\/\/\S+|www\.\S+|\S+\.(com|net|org|io|gg|tv|me|ly)\b/i.test(text);
  }

  // ─── DUPLICATE DETECTION ─────────────────────────────────────────────────────
  function isDupe(text, authorId) {
    const key = `${authorId}:${text}`;
    const now = Date.now();
    const win = (cfg.streamer.duplicateWindowSec || 30) * 1000;
    if (recentMsgs.has(key) && now - recentMsgs.get(key) < win) { recentMsgs.set(key, now); return true; }
    recentMsgs.set(key, now);
    if (recentMsgs.size > 1000)
      for (const [k, t] of recentMsgs) if (now - t > win * 2) recentMsgs.delete(k);
    return false;
  }

  // ─── FIRST TIMER ─────────────────────────────────────────────────────────────
  function checkAndMarkFirstTimer(authorId) {
    if (seenUsers.has(authorId)) return false;
    seenUsers.add(authorId);
    saveSeen();
    return true;
  }

  function peekFirstTimer(authorId) { return !seenUsers.has(authorId); }

  // ─── SPEED LIMITER ───────────────────────────────────────────────────────────
  function isRateLimited() {
    const limit = cfg.streamer.speedLimit;
    if (!limit) return false;
    const now = Date.now();
    speedWindow = speedWindow.filter((t) => now - t < 1000);
    if (speedWindow.length >= limit) return true;
    speedWindow.push(now);
    return false;
  }

  // ─── FILTER ENGINE ───────────────────────────────────────────────────────────
  function shouldHide(el) {
    if (!cfg.enabled) return false;
    const author = getAuthorName(el).toLowerCase();
    const authorId = getAuthorId(el);
    const text = getMsgText(el);
    const type = getMsgType(el);

    if ((type === 'superchat' || type === 'membership') && cfg.streamer.emphasizeSuperChats) return false;

    if (cfg.mode === 'streamer') {
      const s = cfg.streamer;
      for (const u of s.hiddenUsers || [])
        if (u && author.includes(u.toLowerCase().replace('@', ''))) return true;
      if (s.hideCommands)
        for (const p of s.commandPrefixes || ['!'])
          if (text.startsWith(p)) return true;
      if (s.hideDuplicates && isDupe(text, authorId)) return true;
      if (s.hideEmoteOnly && isEmoteOnly(el)) return true;
      if (s.hideShortMessages && text.length > 0 && text.length < (s.minLength || 2)) return true;
      const lc = text.toLowerCase();
      for (const w of s.blockedWords || [])
        if (w && lc.includes(w.toLowerCase())) return true;
      if (s.hideModerators && hasBadge(el, 'moderator')) return true;
      if (s.hideMembers && hasBadge(el, 'member')) return true;
      if (s.hideNonMembers && !hasBadge(el, 'member', 'moderator', 'owner')) return true;
      if (isRateLimited()) return true;
    }

    if (cfg.mode === 'moderator') {
      const q = (cfg.moderator.searchFilter || '').toLowerCase().trim();
      if (q && !text.toLowerCase().includes(q) && !author.includes(q)) return true;
    }

    return false;
  }

  // ─── KEYWORD HIGHLIGHTING ────────────────────────────────────────────────────
  function applyKwHighlights(el, kws, color) {
    const msgEl = el.querySelector('#message');
    if (!msgEl || !kws?.length) return;
    for (const kw of kws) {
      const kwStr = typeof kw === 'string' ? kw : (kw.keyword || '');
      if (!kwStr) continue;
      const regex = new RegExp(`(${escRe(kwStr)})`, 'gi');
      const walker = document.createTreeWalker(msgEl, NodeFilter.SHOW_TEXT);
      const nodes = [];
      let n;
      while ((n = walker.nextNode())) nodes.push(n);
      for (const node of nodes) {
        if (!regex.test(node.textContent)) continue;
        regex.lastIndex = 0;
        const frag = document.createDocumentFragment();
        let last = 0, m;
        while ((m = regex.exec(node.textContent)) !== null) {
          if (m.index > last) frag.appendChild(document.createTextNode(node.textContent.slice(last, m.index)));
          const mark = document.createElement('mark');
          mark.className = `${NS}-kw-mark`;
          mark.style.setProperty('--kw', color || '#ffd700');
          mark.textContent = m[0];
          frag.appendChild(mark);
          last = regex.lastIndex;
        }
        if (last < node.textContent.length) frag.appendChild(document.createTextNode(node.textContent.slice(last)));
        node.parentNode.replaceChild(frag, node);
      }
    }
  }

  // ─── ALERT KEYWORD HIGHLIGHTING ────────────────────────��────────────────────
  function applyAlertHighlights(el, alerts, wholeWord) {
    const msgEl = el.querySelector('#message');
    if (!msgEl || !alerts?.length) return;
    for (const a of alerts) {
      const kw = a.keyword || a;
      if (!kw) continue;
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = wholeWord ? `\\b${escaped}\\b` : escaped;
      const regex = new RegExp(`(${pattern})`, 'gi');
      const walker = document.createTreeWalker(msgEl, NodeFilter.SHOW_TEXT);
      const nodes = [];
      let n;
      while ((n = walker.nextNode())) nodes.push(n);
      for (const node of nodes) {
        if (!regex.test(node.textContent)) continue;
        regex.lastIndex = 0;
        const frag = document.createDocumentFragment();
        let last = 0, m;
        while ((m = regex.exec(node.textContent)) !== null) {
          if (m.index > last) frag.appendChild(document.createTextNode(node.textContent.slice(last, m.index)));
          const mark = document.createElement('mark');
          mark.className = `${NS}-alert-mark`;
          mark.textContent = m[0];
          frag.appendChild(mark);
          last = regex.lastIndex;
        }
        if (last < node.textContent.length) frag.appendChild(document.createTextNode(node.textContent.slice(last)));
        node.parentNode.replaceChild(frag, node);
      }
    }
  }

  // ─── ENHANCEMENT ENGINE ────────────────────────────────────────────��─────────
  function applyHighlights(el) {
    const authorId = getAuthorId(el);
    const authorName = getAuthorName(el);
    const text = getMsgText(el);
    const type = getMsgType(el);

    for (const cls of [...el.classList])
      if (cls.startsWith(NS + '-') && cls !== `${NS}-hidden`) el.classList.remove(cls);

    if (cfg.mode === 'streamer') {
      const s = cfg.streamer;
      if (s.highlightFirstTimers && (hasBadge(el, 'first') || checkAndMarkFirstTimer(authorId))) {
        el.classList.add(`${NS}-firsttimer`);
        addFirstTimerBadge(el);
      } else {
        checkAndMarkFirstTimer(authorId);
      }
      if (s.emphasizeSuperChats && (type === 'superchat' || type === 'membership'))
        el.classList.add(`${NS}-superchat`);
      if (s.highlightByRole) {
        if (hasBadge(el, 'owner'))          el.classList.add(`${NS}-role-owner`);
        else if (hasBadge(el, 'moderator')) el.classList.add(`${NS}-role-mod`);
        else if (hasBadge(el, 'member'))    el.classList.add(`${NS}-role-member`);
        else                                el.classList.add(`${NS}-role-viewer`);
      }
      applyKwHighlights(el, s.keywordHighlights, s.keywordHighlightColor);
    } else {
      const m = cfg.moderator;
      const isNew = hasBadge(el, 'first') || peekFirstTimer(authorId);
      if (m.showNewViewerAlert && isNew) {
        el.classList.add(`${NS}-newviewer`);
        checkAndMarkFirstTimer(authorId);
        addNewViewerBadge(el);
      } else {
        checkAndMarkFirstTimer(authorId);
      }
      if (m.highlightLinks && hasLink(text)) el.classList.add(`${NS}-link`);
      if ((m.detectCapsSpam && capsPercent(text) > (m.capsThreshold || 70)) ||
          (m.detectEmojiSpam && countEmoji(text) > (m.emojiThreshold || 8)))
        el.classList.add(`${NS}-suspicious`);
      if (m.keywordAlerts?.length) {
        const lc = text.toLowerCase();
        for (const a of m.keywordAlerts) {
          const kw = a.keyword || a;
          if (!kw) continue;
          const hit = m.alertWholeWord
            ? new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)
            : lc.includes(kw.toLowerCase());
          if (hit) { triggerAlert(authorName, text, kw); break; }
        }
        applyAlertHighlights(el, m.keywordAlerts, m.alertWholeWord);
      }
      addQuickActions(el);
      if (m.showUserTooltip) addTooltipTrigger(el);
    }
  }

  function addFirstTimerBadge(el) {
    if (el.querySelector(`.${NS}-badge`)) return;
    const badge = document.createElement('span');
    badge.className = `${NS}-badge ${NS}-badge-first`;
    badge.textContent = '✨ First message';
    el.querySelector('#header-content, #content')?.prepend(badge);
  }

  function addNewViewerBadge(el) {
    if (el.querySelector(`.${NS}-badge`)) return;
    const badge = document.createElement('span');
    badge.className = `${NS}-badge ${NS}-badge-new`;
    badge.textContent = '🎉 New viewer';
    el.querySelector('#header-content, #content')?.prepend(badge);
  }

  // ─── QUICK ACTIONS ───────────────────────────────────────────────────────────
  function addQuickActions(el) {
    if (el.querySelector(`.${NS}-actions`)) return;
    const div = document.createElement('div');
    div.className = `${NS}-actions`;
    div.innerHTML = [['⏱','timeout','Timeout'],['🚫','ban','Ban'],['🗑','delete','Delete'],['📋','history','History']]
      .map(([icon, action, title]) => `<button class="${NS}-act-btn" data-action="${action}" title="${title}">${icon}</button>`)
      .join('');
    div.addEventListener('click', (e) => {
      e.stopPropagation();
      const btn = e.target.closest('[data-action]');
      if (btn) handleAction(btn.dataset.action, getAuthorName(el), el);
    });
    el.appendChild(div);
  }

  function handleAction(action, author, el) {
    if (action === 'history') showHistory(author);
    else if (action === 'delete') el.classList.add(`${NS}-deleted`);
    else toast(`${action === 'timeout' ? '⏱' : '🚫'} To ${action} @${author}: click their name in chat`, 'info');
  }

  // ─── USER TOOLTIP ────────────────────────────────────────────────────────────
  function addTooltipTrigger(el) {
    const authorEl = el.querySelector('#author-name');
    if (!authorEl || authorEl.dataset.ccTip) return;
    authorEl.dataset.ccTip = '1';
    authorEl.addEventListener('mouseenter', (e) => showTooltip(e, getAuthorName(el)));
    authorEl.addEventListener('mouseleave', hideTooltip);
  }

  function showTooltip(e, name) {
    hideTooltip();
    const msgs = userHistory.get(name) || [];
    const tip = document.createElement('div');
    tip.id = `${NS}-tooltip`;
    tip.innerHTML = `
      <div class="${NS}-tip-name">@${escHtml(name)}</div>
      <div class="${NS}-tip-row"><span>Session messages</span><strong>${msgs.length}</strong></div>
      ${msgs[0] ? `<div class="${NS}-tip-row"><span>First seen</span><strong>${fmtTime(msgs[0].time)}</strong></div>` : ''}
      ${msgs.at(-1) ? `<div class="${NS}-tip-row"><span>Last message</span><strong>${fmtTime(msgs.at(-1).time)}</strong></div>` : ''}`;
    document.body.appendChild(tip);
    requestAnimationFrame(() => {
      const r = e.target.getBoundingClientRect();
      tip.style.left = Math.max(4, Math.min(r.left, window.innerWidth - tip.offsetWidth - 8)) + 'px';
      tip.style.top = (r.bottom + 4) + 'px';
      tip.classList.add('visible');
    });
  }

  function hideTooltip() { document.getElementById(`${NS}-tooltip`)?.remove(); }

  // ─── USER HISTORY ────────────────────────────────────────────────────────────
  function trackHistory(el) {
    const name = getAuthorName(el);
    const text = getMsgText(el);
    if (!name || !text) return;
    const arr = userHistory.get(name) || [];
    arr.push({ text, time: Date.now() });
    if (arr.length > 60) arr.shift();
    userHistory.set(name, arr);
  }

  function showHistory(name) {
    document.querySelector(`.${NS}-modal`)?.remove();
    const msgs = userHistory.get(name) || [];
    const modal = document.createElement('div');
    modal.className = `${NS}-modal`;
    modal.innerHTML = `
      <div class="${NS}-modal-inner">
        <div class="${NS}-modal-head">
          <span>@${escHtml(name)} — ${msgs.length} message${msgs.length !== 1 ? 's' : ''} this session</span>
          <button class="${NS}-modal-close">✕</button>
        </div>
        <div class="${NS}-modal-body">
          ${msgs.length === 0
            ? `<div class="${NS}-empty-state">No messages tracked yet</div>`
            : [...msgs].reverse().map((m) => `
                <div class="${NS}-hist-row">
                  <span class="${NS}-hist-time">${fmtTime(m.time)}</span>
                  <span class="${NS}-hist-text">${escHtml(m.text)}</span>
                </div>`).join('')}
        </div>
      </div>`;
    modal.querySelector(`.${NS}-modal-close`).onclick = () => modal.remove();
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    document.body.appendChild(modal);
  }

  // ─── STATS ───────────────────────────────────────────────────────────────────
  function getStatsObj() {
    const now = Date.now();
    const recent = stats.recentWindow.filter((t) => now - t < 60000);
    return { total: stats.total, hidden: stats.hidden, mpm: recent.length, users: stats.users.size };
  }

  function trackStats(el, hidden) {
    stats.total++;
    if (hidden) stats.hidden++;
    const now = Date.now();
    stats.recentWindow.push(now);
    if (stats.recentWindow.length > 3000)
      stats.recentWindow = stats.recentWindow.filter((t) => now - t < 90000);
    const name = getAuthorName(el);
    if (name) stats.users.add(name);
  }

  // ─── KEYWORD ALERTS ──────────────────────────────────────────────────────────
  let alertCooldown = false;
  let isReprocessing = false;
  function triggerAlert(author, text, kw) {
    if (alertCooldown || isReprocessing) return;
    alertCooldown = true;
    setTimeout(() => (alertCooldown = false), 3000);
    toast(`🔔 Alert: "${kw}" — @${author}`, 'alert');
    if (cfg.moderator.alertSound) {
      try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.connect(g); g.connect(ctx.destination);
        osc.frequency.value = 880; osc.type = 'sine';
        g.gain.setValueAtTime(0.25, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
        osc.start(); osc.stop(ctx.currentTime + 0.4);
      } catch (_) {}
    }
  }

  // ─── TOAST ───────────────────────────────────────────────────────────────────
  function toast(msg, type = 'info') {
    const n = document.createElement('div');
    n.className = `${NS}-toast ${NS}-toast-${type}`;
    n.innerHTML = `<span>${escHtml(msg)}</span>`;
    document.body.appendChild(n);
    requestAnimationFrame(() => requestAnimationFrame(() => n.classList.add('show')));
    setTimeout(() => { n.classList.remove('show'); setTimeout(() => n.remove(), 400); }, 3500);
  }

  // ─── PROCESS MESSAGE ─────────────────────────────────────────────────────────
  function processMsg(el) {
    if (!el || el.dataset.ccDone) return;
    el.dataset.ccDone = '1';
    const author = getAuthorName(el);
    const text = getMsgText(el);
    if (author && text) {
      sessionLog.push({ author, text, time: Date.now() });
      if (sessionLog.length > 5000) sessionLog.shift();
    }
    if (cfg.mode === 'moderator') trackHistory(el);
    const hidden = shouldHide(el);
    trackStats(el, hidden);
    if (hidden) el.classList.add(`${NS}-hidden`);
    else { el.classList.remove(`${NS}-hidden`); applyHighlights(el); }
  }

  function reprocessAll() {
    isReprocessing = true;
    recentMsgs.clear();
    const msgs = document.querySelectorAll(
      'yt-live-chat-text-message-renderer,yt-live-chat-paid-message-renderer,' +
      'yt-live-chat-membership-item-renderer,yt-live-chat-paid-sticker-renderer'
    );
    for (const el of msgs) {
      delete el.dataset.ccDone;
      for (const cls of [...el.classList]) if (cls.startsWith(NS + '-')) el.classList.remove(cls);
      el.querySelector(`.${NS}-actions`)?.remove();
      el.querySelector(`.${NS}-badge`)?.remove();
      processMsg(el);
    }
    isReprocessing = false;
  }

  // ─── CONTROL BAR (minimal in-YouTube UI) ─────────────────────────────────────
  function createControlBar() {
    document.getElementById(`${NS}-bar`)?.remove();
    const isStr = cfg.mode === 'streamer';

    const bar = document.createElement('div');
    bar.id = `${NS}-bar`;
    bar.dataset.mode = cfg.mode;
    bar.innerHTML = `
      <svg class="${NS}-bar-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
        <line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="10" y1="18" x2="14" y2="18"/>
      </svg>
      <div class="${NS}-bar-seg">
        <button class="${NS}-bar-btn${isStr ? ' active' : ''}" data-mode="streamer">Streamer</button>
        <button class="${NS}-bar-btn${!isStr ? ' active' : ''}" data-mode="moderator">Mod</button>
      </div>
      <label class="${NS}-bar-enable" title="${cfg.enabled ? 'Disable' : 'Enable'} CleanChat">
        <input type="checkbox" id="${NS}-bar-power" ${cfg.enabled ? 'checked' : ''}/>
        <span class="${NS}-bar-check"></span>
      </label>`;

    const itemList = document.querySelector('#item-list');
    if (itemList?.parentNode) itemList.parentNode.insertBefore(bar, itemList);
    else document.body.appendChild(bar);

    bar.querySelectorAll(`.${NS}-bar-btn`).forEach((btn) => {
      btn.onclick = () => {
        cfg.mode = btn.dataset.mode;
        saveCfg();
        refreshControlBar();
        reprocessAll();
      };
    });

    const powerChk = bar.querySelector(`#${NS}-bar-power`);
    powerChk.onchange = () => { cfg.enabled = powerChk.checked; saveCfg(); reprocessAll(); };
  }

  function refreshControlBar() {
    const bar = document.getElementById(`${NS}-bar`);
    if (!bar) return createControlBar();
    bar.dataset.mode = cfg.mode;
    bar.querySelectorAll(`.${NS}-bar-btn`).forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === cfg.mode);
    });
    const powerChk = bar.querySelector(`#${NS}-bar-power`);
    if (powerChk) powerChk.checked = cfg.enabled;
  }

  // ─── OBSERVER ────────────────────────────────────────────────────────────────
  const MSG_SELS =
    'yt-live-chat-text-message-renderer,yt-live-chat-paid-message-renderer,' +
    'yt-live-chat-membership-item-renderer,yt-live-chat-paid-sticker-renderer';

  function startObserver() {
    new MutationObserver((muts) => {
      for (const mut of muts)
        for (const node of mut.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.matches?.(MSG_SELS)) processMsg(node);
          node.querySelectorAll?.(MSG_SELS).forEach(processMsg);
        }
    }).observe(document.body, { childList: true, subtree: true });
  }

  // ─── INIT ────────────────────────────────────────────────────────────────────
  async function init() {
    await loadAll();
    await new Promise((res) => {
      if (document.querySelector('#item-list,yt-live-chat-item-list-renderer')) { res(); return; }
      const obs = new MutationObserver(() => {
        if (document.querySelector('#item-list,yt-live-chat-item-list-renderer')) { obs.disconnect(); res(); }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      setTimeout(res, 5000);
    });
    createControlBar();
    startObserver();
    setTimeout(reprocessAll, 800);
    setInterval(() => {
      chrome.storage.local.set({ ccStats: getStatsObj(), ccLog: sessionLog.slice(-2000) });
    }, 5000);
  }

  init();
})();
