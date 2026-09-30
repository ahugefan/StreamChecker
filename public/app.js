// Dashboard front-end. Talks only to our own local server (via api()), which
// requires the session key obtained from the main process over IPC.

let API_BASE = '';
let SESSION_KEY = '';

const el = (id) => document.getElementById(id);
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

const liveSound = new Audio('live.mp3');

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
  renderVipList();
}

function renderVipList() {
  vipListDisplay.innerHTML = '';
  settings.vips.forEach(name => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${name}</span><span class="vip-remove" data-name="${name}">✕</span>`;
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
      liveSound.play().catch(() => {});
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
        <span class="username">${stream.username}</span>
        <span class="status-pill ${stream.isLive ? 'status-live' : 'status-offline'}">
          ${stream.isLive ? 'LIVE' : 'OFFLINE'}
        </span>
      </div>
      <div class="title">${stream.title}</div>
      <div class="meta-row">
        <span class="viewers">${stream.isLive ? stream.viewers + ' viewers' : ''}</span>
        <div class="meta-right">
          <span class="vip-star ${stream.isVip ? 'vip' : ''}" data-user="${stream.username}">⭐</span>
          <span class="remove-streamer" data-user="${stream.username}">➖</span>
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
toggleTheme.addEventListener('change', () => {
  document.body.classList.toggle('light-theme', toggleTheme.checked);
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
  toggleAutoShoutout.checked = settings.autoShoutout;
  shoutoutAccountType.value = settings.shoutoutAccountType;
  shoutoutTemplateInput.value = settings.shoutoutTemplate;
  updateAccountRows();
  await refreshLoginStatuses();
  await refresh();
  restartAutoRefresh();
}

init();
