// Dashboard front-end. Talks only to our own local server (via api()), which
// requires the session key obtained from the main process over IPC.

let API_BASE = '';
let SESSION_KEY = '';

const el = (id) => document.getElementById(id);

// Anything that came from outside the app (stream titles especially, which
// streamers type themselves) must be escaped before going into innerHTML.
function escapeHtml(value) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value ?? '').replace(/[&<>"']/g, ch => map[ch]);
}
const streamGrid = el('streamGrid');
const totalStreamersEl = el('totalStreamers');
const liveNowEl = el('liveNow');
const lastRefreshEl = el('lastRefresh');
const offlineHiddenNote = el('offlineHiddenNote');
const statusBanner = el('statusBanner');

const settingsBtn = el('settingsBtn');
const settingsPanel = el('settingsPanel');
const settingsOverlay = el('settingsOverlay');
const closeSettings = el('closeSettings');

const toggleAutoRefresh = el('toggleAutoRefresh');
const toggleSound = el('toggleSound');
const toggleTheme = el('toggleTheme');
const toggleVIP = el('toggleVIP');
const toggleShowOffline = el('toggleShowOffline');
const refreshIntervalSelect = el('refreshInterval');

const clientIdInput = el('clientIdInput');
const clientSecretInput = el('clientSecretInput');
const saveCredentialsBtn = el('saveCredentialsBtn');
const credentialsStatus = el('credentialsStatus');

const vipInput = el('vipInput');
const addVipBtn = el('addVipBtn');
const vipListDisplay = el('vipListDisplay');

const addStreamersInput = el('addStreamersInput');
const addStreamersBtn = el('addStreamersBtn');
const addStreamersStatus = el('addStreamersStatus');
const chooseStreamersFile = el('chooseStreamersFile');

// --- Live alert sound: the built-in chime, or the user's own file ---

const DEFAULT_SOUND_URL = 'live.mp3';
const chooseSoundBtn = el('chooseSoundBtn');
const testSoundBtn = el('testSoundBtn');
const resetSoundBtn = el('resetSoundBtn');
const soundVolume = el('soundVolume');
const soundVolumeLabel = el('soundVolumeLabel');
const soundCurrent = el('soundCurrent');
const soundStatus = el('soundStatus');

let alertSound = new Audio(DEFAULT_SOUND_URL);
let alertUrl = null;          // blob: URL for the custom sound, while one is loaded
let usingCustomSound = false;

function currentVolume() {
  const v = settings ? settings.soundVolume : 100;
  return Math.min(1, Math.max(0, v / 100));
}

function useDefaultSound() {
  if (alertUrl) { URL.revokeObjectURL(alertUrl); alertUrl = null; }
  alertSound = new Audio(DEFAULT_SOUND_URL);
  usingCustomSound = false;
}

async function loadAlertSound() {
  useDefaultSound();
  if (settings && settings.soundFile && window.soundAPI) {
    try {
      const custom = await window.soundAPI.getCustom();
      if (custom) {
        alertUrl = URL.createObjectURL(new Blob([custom.bytes], { type: custom.mime }));
        alertSound = new Audio(alertUrl);
        usingCustomSound = true;
      }
    } catch { /* keep the built-in chime */ }
  }
}

// Returns 'ok', 'fallback' (the custom sound failed, so the built-in chime
// played instead) or 'failed' (nothing could be played).
async function playAlert() {
  try {
    alertSound.volume = currentVolume();
    alertSound.currentTime = 0;
    await alertSound.play();
    return 'ok';
  } catch {
    if (!usingCustomSound) return 'failed';
  }
  useDefaultSound();
  try {
    alertSound.volume = currentVolume();
    await alertSound.play();
    return 'fallback';
  } catch {
    return 'failed';
  }
}

function updateSoundUI() {
  const custom = Boolean(settings.soundFile);
  soundCurrent.textContent = custom
    ? `Using your sound: ${settings.soundLabel || 'custom file'}`
    : 'Using the built-in chime.';
  resetSoundBtn.hidden = !custom;
  soundVolume.value = String(settings.soundVolume);
  soundVolumeLabel.textContent = `${settings.soundVolume}%`;
}

let settings = null;
let refreshTimer = null;
let lastLiveCount = 0;

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Key': SESSION_KEY
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function showBanner(message, isError = true) {
  statusBanner.textContent = message;
  statusBanner.hidden = !message;
  statusBanner.classList.toggle('error', isError);
}

function applySettingsToUI() {
  toggleAutoRefresh.checked = settings.autoRefresh;
  toggleSound.checked = settings.soundEnabled;
  toggleTheme.checked = settings.lightTheme;
  toggleVIP.checked = settings.highlightVips;
  toggleShowOffline.checked = settings.showOffline;
  refreshIntervalSelect.value = String(settings.refreshMinutes);
  clientIdInput.value = settings.clientId || '';
  credentialsStatus.textContent = settings.hasClientSecret
    ? 'Client Secret is saved.'
    : 'No Client Secret saved yet.';
  document.body.classList.toggle('light-theme', settings.lightTheme);
  applyTheme();
  updateThemeUI();
  updateOverlayUI();
  updateSoundUI();
  renderVipList();
}

function renderVipList() {
  vipListDisplay.innerHTML = '';
  settings.vips.forEach(name => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${escapeHtml(name)}</span><span class="vip-remove" data-name="${escapeHtml(name)}">✕</span>`;
    vipListDisplay.appendChild(li);
  });
}

async function refresh() {
  try {
    const data = await api('/api/streams');
    showBanner('');
    totalStreamersEl.textContent = data.total;
    liveNowEl.textContent = data.liveNow;
    lastRefreshEl.textContent = data.lastRefresh;

    if (toggleSound.checked && data.liveNow > lastLiveCount) {
      playAlert();
    }
    lastLiveCount = data.liveNow;

    if (data.offlineHidden > 0) {
      offlineHiddenNote.hidden = false;
      offlineHiddenNote.textContent = `${data.offlineHidden} offline streamer(s) hidden`;
    } else {
      offlineHiddenNote.hidden = true;
    }

    renderStreams(data.streams);
  } catch (err) {
    showBanner(err.message);
  }
}

function renderStreams(streams) {
  streamGrid.innerHTML = '';
  if (!streams.length) {
    streamGrid.innerHTML = `<p class="empty-state">No streamers to show. Add some in Settings.</p>`;
    return;
  }

  streams.forEach(stream => {
    const card = document.createElement('div');
    card.classList.add('card');
    if (!stream.isLive) card.classList.add('offline');
    if (toggleVIP.checked && stream.isVip) card.classList.add('vip');

    card.innerHTML = `
      <div class="card-header">
        <span class="username">${escapeHtml(stream.username)}</span>
        <span class="status-pill ${stream.isLive ? 'status-live' : 'status-offline'}">
          ${stream.isLive ? 'LIVE' : 'OFFLINE'}
        </span>
      </div>
      <div class="title">${escapeHtml(stream.title)}</div>
      <div class="meta-row">
        <span class="viewers">${stream.isLive ? escapeHtml(stream.viewers) + ' viewers' : ''}</span>
        <div class="meta-right">
          <span class="vip-star ${stream.isVip ? 'vip' : ''}" data-user="${escapeHtml(stream.username)}">⭐</span>
          <span class="remove-streamer" data-user="${escapeHtml(stream.username)}">➖</span>
        </div>
      </div>
    `;

    card.querySelector('.vip-star').addEventListener('click', async (e) => {
      e.stopPropagation();
      const updated = await api('/api/vip/toggle', { method: 'POST', body: { username: stream.username } });
      settings.vips = updated.vips;
      renderVipList();
      refresh();
    });

    card.querySelector('.remove-streamer').addEventListener('click', async (e) => {
      e.stopPropagation();
      await api('/api/streamers/remove', { method: 'POST', body: { username: stream.username } });
      refresh();
    });

    card.addEventListener('click', () => {
      if (window.clipAPI) window.clipAPI.copy(`!so ${stream.username}`);
      window.open(`https://twitch.tv/${stream.username}`, '_blank');
      card.classList.add('flash');
      setTimeout(() => card.classList.remove('flash'), 300);
    });

    streamGrid.appendChild(card);
  });
}

function restartAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  if (toggleAutoRefresh.checked) {
    refreshTimer = setInterval(refresh, settings.refreshMinutes * 60000);
  }
}

async function saveSetting(patch) {
  const updated = await api('/api/settings', { method: 'POST', body: patch });
  settings = { ...settings, ...updated };
}

settingsBtn.addEventListener('click', () => {
  settingsPanel.classList.add('open');
  settingsOverlay.classList.add('visible');
});
closeSettings.addEventListener('click', closeSettingsPanel);
settingsOverlay.addEventListener('click', closeSettingsPanel);
function closeSettingsPanel() {
  settingsPanel.classList.remove('open');
  settingsOverlay.classList.remove('visible');
}

toggleAutoRefresh.addEventListener('change', async () => {
  await saveSetting({ autoRefresh: toggleAutoRefresh.checked });
  restartAutoRefresh();
});
refreshIntervalSelect.addEventListener('change', async () => {
  await saveSetting({ refreshMinutes: Number(refreshIntervalSelect.value) });
  restartAutoRefresh();
});
toggleSound.addEventListener('change', () => saveSetting({ soundEnabled: toggleSound.checked }));

chooseSoundBtn.addEventListener('click', async () => {
  if (!window.soundAPI) return;
  soundStatus.textContent = '';
  const result = await window.soundAPI.choose();
  if (!result) return; // dialog was cancelled
  if (!result.ok) { soundStatus.textContent = result.error; return; }

  settings.soundFile = result.soundFile;
  settings.soundLabel = result.soundLabel;
  await loadAlertSound();
  const outcome = await playAlert(); // preview it right away
  if (outcome === 'fallback') {
    // Never keep a file that can't be played.
    await window.soundAPI.reset();
    settings.soundFile = '';
    settings.soundLabel = '';
    soundStatus.textContent = "That file couldn't be played, so the built-in chime is still in use.";
  } else {
    soundStatus.textContent = outcome === 'ok' ? 'Sound saved.' : "Sound saved, but nothing played. Check your system volume.";
  }
  updateSoundUI();
});

testSoundBtn.addEventListener('click', async () => {
  const outcome = await playAlert();
  soundStatus.textContent =
    outcome === 'ok' ? '' :
    outcome === 'fallback' ? "Your sound file couldn't be played, so the built-in chime was used." :
    "Couldn't play a sound. Check your system volume.";
});

resetSoundBtn.addEventListener('click', async () => {
  if (!window.soundAPI) return;
  await window.soundAPI.reset();
  settings.soundFile = '';
  settings.soundLabel = '';
  await loadAlertSound();
  updateSoundUI();
  soundStatus.textContent = 'Using the built-in chime.';
});

soundVolume.addEventListener('input', () => { soundVolumeLabel.textContent = `${soundVolume.value}%`; });
soundVolume.addEventListener('change', async () => {
  try {
    await saveSetting({ soundVolume: Number(soundVolume.value) });
    soundStatus.textContent = '';
    playAlert(); // let the user hear the new level
  } catch (err) {
    soundStatus.textContent = err.message;
    updateSoundUI();
  }
});
toggleTheme.addEventListener('change', () => {
  document.body.classList.toggle('light-theme', toggleTheme.checked);
  applyTheme();
  saveSetting({ lightTheme: toggleTheme.checked });
});
toggleVIP.addEventListener('change', () => { saveSetting({ highlightVips: toggleVIP.checked }); refresh(); });
toggleShowOffline.addEventListener('change', () => { saveSetting({ showOffline: toggleShowOffline.checked }); refresh(); });

saveCredentialsBtn.addEventListener('click', async () => {
  try {
    const result = await api('/api/credentials', {
      method: 'POST',
      body: { clientId: clientIdInput.value.trim(), clientSecret: clientSecretInput.value }
    });
    settings.hasClientSecret = result.hasClientSecret;
    clientSecretInput.value = '';
    credentialsStatus.textContent = result.hasClientSecret ? 'Client Secret is saved.' : 'No Client Secret saved yet.';
    refresh();
  } catch (err) {
    credentialsStatus.textContent = err.message;
  }
});

addVipBtn.addEventListener('click', async () => {
  const name = vipInput.value.trim().toLowerCase();
  if (!name) return;
  const updated = await api('/api/vip/toggle', { method: 'POST', body: { username: name } });
  settings.vips = updated.vips;
  vipInput.value = '';
  renderVipList();
  refresh();
});
vipListDisplay.addEventListener('click', async (e) => {
  if (!e.target.classList.contains('vip-remove')) return;
  const updated = await api('/api/vip/toggle', { method: 'POST', body: { username: e.target.dataset.name } });
  settings.vips = updated.vips;
  renderVipList();
  refresh();
});

addStreamersBtn.addEventListener('click', async () => {
  const text = addStreamersInput.value.trim();
  if (!text) return;
  try {
    const result = await api('/api/streamers', { method: 'POST', body: { text } });
    addStreamersInput.value = '';
    const problems = [...result.invalid.map(i => i.input), ...result.notFound];
    addStreamersStatus.textContent = problems.length
      ? `Added. Skipped: ${problems.join(', ')}`
      : 'Added.';
    refresh();
  } catch (err) {
    addStreamersStatus.textContent = err.message;
  }
});

chooseStreamersFile.addEventListener('click', async () => {
  if (!window.fileAPI) return;
  const result = await window.fileAPI.chooseStreamersFile();
  if (!result) return;
  await api('/api/streamers', { method: 'POST', body: { text: result.content } });
  refresh();
});

el('exportStreamersBtn').addEventListener('click', async () => {
  if (!window.electronAPI) return;
  const result = await window.electronAPI.exportStreamers(settings.streamers);
  if (result && result.success) alert(`Exported to: ${result.filePath}`);
});

el('refreshBtn').addEventListener('click', refresh);

// --- Accent color theme ---

const themeSwatches = el('themeSwatches');
const accentColorInput = el('accentColorInput');
const resetThemeBtn = el('resetThemeBtn');
const themeStatus = el('themeStatus');

function isLightMode() { return document.body.classList.contains('light-theme'); }

function applyTheme(accent = settings.accentColor) {
  const light = isLightMode();
  ThemeUtil.apply(document.documentElement, accent, light);
  ThemeUtil.cache(accent, light);
}

function updateThemeUI() {
  const accent = settings.accentColor;
  accentColorInput.value = accent;
  resetThemeBtn.hidden = accent === ThemeUtil.DEFAULT_ACCENT;
  themeSwatches.querySelectorAll('.swatch').forEach(btn => {
    const selected = btn.dataset.color === accent;
    btn.classList.toggle('selected', selected);
    btn.setAttribute('aria-pressed', String(selected));
  });
}

async function setAccent(color) {
  color = String(color).toLowerCase();
  if (!ThemeUtil.isVisible(color, isLightMode())) {
    themeStatus.textContent =
      `That color is too close to the ${isLightMode() ? 'light' : 'dark'} background to read. Try a different one.`;
  } else {
    try {
      await saveSetting({ accentColor: color });
      themeStatus.textContent = '';
    } catch (err) {
      themeStatus.textContent = err.message;
    }
  }
  applyTheme();   // always re-apply what is actually saved (undoes a live preview that was rejected)
  updateThemeUI();
}

ThemeUtil.PRESETS.forEach(preset => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'swatch';
  btn.dataset.color = preset.color;
  btn.title = preset.name;
  btn.setAttribute('aria-label', preset.name);
  btn.style.background = preset.color;
  btn.addEventListener('click', () => setAccent(preset.color));
  themeSwatches.appendChild(btn);
});

// Live preview while the color picker is open; saved when it closes.
accentColorInput.addEventListener('input', () => {
  if (ThemeUtil.isVisible(accentColorInput.value, isLightMode())) applyTheme(accentColorInput.value);
});
accentColorInput.addEventListener('change', () => setAccent(accentColorInput.value));
resetThemeBtn.addEventListener('click', () => setAccent(ThemeUtil.DEFAULT_ACCENT));

// --- Stream overlay (separate window; see overlay.html) ---

const overlayToggleBtn = el('overlayToggleBtn');
const overlayAutoOpen = el('overlayAutoOpen');
const overlayAlwaysOnTop = el('overlayAlwaysOnTop');
const overlaySpeed = el('overlaySpeed');
const overlayTitles = el('overlayTitles');
const overlayShowViewers = el('overlayShowViewers');
const overlayBackground = el('overlayBackground');
const overlayStatus = el('overlayStatus');

let overlayOpen = false;

function updateOverlayUI() {
  overlayToggleBtn.textContent = overlayOpen ? 'Close Overlay Window' : 'Open Overlay Window';
  overlayAutoOpen.checked = settings.overlayAutoOpen;
  overlayAlwaysOnTop.checked = settings.overlayAlwaysOnTop;
  overlaySpeed.value = settings.overlaySpeed;
  overlayTitles.value = settings.overlayTitles;
  overlayShowViewers.checked = settings.overlayShowViewers;
  overlayBackground.value = settings.overlayBackground;
}

async function saveOverlaySetting(patch) {
  try {
    await saveSetting(patch);
    overlayStatus.textContent = '';
  } catch (err) {
    overlayStatus.textContent = err.message;
    updateOverlayUI();
  }
}

overlayToggleBtn.addEventListener('click', async () => {
  if (!window.overlayAPI) return;
  if (overlayOpen) await window.overlayAPI.close();
  else await window.overlayAPI.open();
});
overlayAutoOpen.addEventListener('change', () => saveOverlaySetting({ overlayAutoOpen: overlayAutoOpen.checked }));
overlayAlwaysOnTop.addEventListener('change', async () => {
  if (!window.overlayAPI) return;
  await window.overlayAPI.setAlwaysOnTop(overlayAlwaysOnTop.checked); // the main process saves it and applies it to the open window
  settings.overlayAlwaysOnTop = overlayAlwaysOnTop.checked;
});
overlaySpeed.addEventListener('change', () => saveOverlaySetting({ overlaySpeed: overlaySpeed.value }));
overlayTitles.addEventListener('change', () => saveOverlaySetting({ overlayTitles: overlayTitles.value }));
overlayShowViewers.addEventListener('change', () => saveOverlaySetting({ overlayShowViewers: overlayShowViewers.checked }));
overlayBackground.addEventListener('change', () => saveOverlaySetting({ overlayBackground: overlayBackground.value }));

// --- Shoutouts & login (self / bot account) ---

const toggleAutoShoutout = el('toggleAutoShoutout');
const shoutoutAccountType = el('shoutoutAccountType');
const selfLoginRow = el('selfLoginRow');
const selfLoginStatus = el('selfLoginStatus');
const selfLoginBtn = el('selfLoginBtn');
const selfLogoutBtn = el('selfLogoutBtn');
const botLoginRow = el('botLoginRow');
const botLoginStatus = el('botLoginStatus');
const botLoginBtn = el('botLoginBtn');
const botLogoutBtn = el('botLogoutBtn');
const shoutoutTemplateInput = el('shoutoutTemplateInput');
const saveShoutoutBtn = el('saveShoutoutBtn');
const shoutoutStatus = el('shoutoutStatus');
const resendShoutoutsBtn = el('resendShoutoutsBtn');

function updateAccountRows() {
  botLoginRow.hidden = shoutoutAccountType.value !== 'bot';
}

async function refreshLoginStatuses() {
  const [self, bot] = await Promise.all([api('/api/login/status'), api('/api/bot-login/status')]);
  selfLoginStatus.textContent = self.loggedIn ? `Logged in as ${self.login}` : 'Not logged in';
  selfLoginBtn.hidden = self.loggedIn;
  selfLogoutBtn.hidden = !self.loggedIn;

  botLoginStatus.textContent = bot.loggedIn ? `Logged in as ${bot.login}` : 'Not logged in';
  botLoginBtn.hidden = bot.loggedIn;
  botLogoutBtn.hidden = !bot.loggedIn;
}

toggleAutoShoutout.addEventListener('change', () => saveSetting({ autoShoutout: toggleAutoShoutout.checked }));

shoutoutAccountType.addEventListener('change', async () => {
  updateAccountRows();
  try {
    await saveSetting({ shoutoutAccountType: shoutoutAccountType.value });
  } catch (err) {
    shoutoutStatus.textContent = err.message;
    shoutoutAccountType.value = settings.shoutoutAccountType; // revert on failure
    updateAccountRows();
  }
});

selfLoginBtn.addEventListener('click', async () => {
  selfLoginBtn.disabled = true;
  selfLoginStatus.textContent = 'Waiting for Twitch in your browser...';
  try {
    await api('/api/login/start', { method: 'POST' });
    await refreshLoginStatuses();
  } catch (err) {
    selfLoginStatus.textContent = err.message;
  } finally {
    selfLoginBtn.disabled = false;
  }
});
selfLogoutBtn.addEventListener('click', async () => {
  await api('/api/login/logout', { method: 'POST' });
  await refreshLoginStatuses();
});

botLoginBtn.addEventListener('click', async () => {
  botLoginBtn.disabled = true;
  botLoginStatus.textContent = 'Waiting for Twitch in your browser...';
  try {
    await api('/api/bot-login/start', { method: 'POST' });
    await refreshLoginStatuses();
  } catch (err) {
    botLoginStatus.textContent = err.message;
  } finally {
    botLoginBtn.disabled = false;
  }
});
botLogoutBtn.addEventListener('click', async () => {
  await api('/api/bot-login/logout', { method: 'POST' });
  settings = await api('/api/settings'); // account type may have reverted to "self"
  shoutoutAccountType.value = settings.shoutoutAccountType;
  updateAccountRows();
  await refreshLoginStatuses();
});

saveShoutoutBtn.addEventListener('click', async () => {
  try {
    await saveSetting({ shoutoutTemplate: shoutoutTemplateInput.value.trim() });
    shoutoutStatus.textContent = 'Saved.';
  } catch (err) {
    shoutoutStatus.textContent = err.message;
  }
});

resendShoutoutsBtn.addEventListener('click', async () => {
  resendShoutoutsBtn.disabled = true;
  resendShoutoutsBtn.textContent = 'Sending...';
  try {
    const result = await api('/api/shoutouts/resend-all', { method: 'POST' });
    const parts = [];
    if (result.sent?.length) parts.push(`Sent: ${result.sent.join(', ')}`);
    if (result.failed?.length) parts.push(`Failed: ${result.failed.map(f => f.login).join(', ')}`);
    showBanner(parts.length ? parts.join(' | ') : 'No one is currently live.', result.failed?.length > 0);
  } catch (err) {
    showBanner(err.message);
  } finally {
    resendShoutoutsBtn.disabled = false;
    resendShoutoutsBtn.textContent = 'Resend All Shoutouts';
  }
});

async function init() {
  const info = await window.serverAPI.getInfo();
  if (!info) {
    showBanner('The local server did not start. Try restarting the app.');
    return;
  }
  API_BASE = `http://127.0.0.1:${info.port}`;
  SESSION_KEY = info.sessionKey;

  settings = await api('/api/settings');
  applySettingsToUI();
  await loadAlertSound();
  if (window.overlayAPI) {
    overlayOpen = await window.overlayAPI.isOpen();
    window.overlayAPI.onState((open) => { overlayOpen = open; updateOverlayUI(); });
    updateOverlayUI();
  }
  toggleAutoShoutout.checked = settings.autoShoutout;
  shoutoutAccountType.value = settings.shoutoutAccountType;
  shoutoutTemplateInput.value = settings.shoutoutTemplate;
  updateAccountRows();
  await refreshLoginStatuses();
  await refresh();
  restartAutoRefresh();
}

init();
