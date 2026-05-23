const DEFAULTS = {
  enabled: true,
  mode: 'streamer',
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get('ccCfg', (r) => {
    if (!r.ccCfg) chrome.storage.sync.set({ ccCfg: DEFAULTS });
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !changes.ccCfg) return;
  const cfg = changes.ccCfg.newValue || DEFAULTS;
  const isStreamer = cfg.mode === 'streamer';
  chrome.action.setBadgeText({ text: cfg.enabled ? (isStreamer ? 'S' : 'M') : 'OFF' });
  chrome.action.setBadgeBackgroundColor({ color: cfg.enabled ? (isStreamer ? '#8B5CF6' : '#3B82F6') : '#6B7280' });
});
