let API_BASE = '';
let SESSION_KEY = '';

const el = (id) => document.getElementById(id);

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Session-Key': SESSION_KEY },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const state = { wantsShoutout: null };

function stepOrder() {
  const order = ['welcome', 'credentials', 'shoutout-choice'];
  if (state.wantsShoutout) order.push('login', 'shoutout-message');
  order.push('streamers', 'finish');
  return order;
}

let currentIndex = 0;

function currentId() { return stepOrder()[currentIndex]; }

function render() {
  const order = stepOrder();
  const id = order[currentIndex];
  document.querySelectorAll('.step').forEach(s => { s.hidden = true; });
  el(`step-${id}`).hidden = false;
  el('stepCount').textContent = `Step ${currentIndex + 1} of ${order.length}`;

  el('backBtn').style.visibility = currentIndex === 0 ? 'hidden' : 'visible';
  el('skipBtn').hidden = id !== 'streamers';
  el('nextBtn').textContent = id === 'finish' ? 'Finish' : 'Next';
  el('nextBtn').disabled = false;

  if (id === 'credentials') {
    el('nextBtn').disabled = !(el('clientIdInput').value.trim());
  }
  if (id === 'shoutout-choice') {
    el('nextBtn').disabled = state.wantsShoutout === null;
  }
  if (id === 'login') {
    el('nextBtn').disabled = !state.loggedIn;
  }
}

function goTo(index) { currentIndex = Math.max(0, Math.min(stepOrder().length - 1, index)); render(); }

el('backBtn').addEventListener('click', () => goTo(currentIndex - 1));
el('skipBtn').addEventListener('click', () => advance());

el('clientIdInput').addEventListener('input', () => {
  if (currentId() === 'credentials') el('nextBtn').disabled = !el('clientIdInput').value.trim();
});

el('choiceYes').addEventListener('click', () => selectChoice(true));
el('choiceNo').addEventListener('click', () => selectChoice(false));
function selectChoice(yes) {
  state.wantsShoutout = yes;
  el('choiceYes').classList.toggle('selected', yes);
  el('choiceNo').classList.toggle('selected', !yes);
  el('nextBtn').disabled = false;
}

el('loginBtn').addEventListener('click', async () => {
  const status = el('loginStatus');
  el('loginBtn').disabled = true;
  status.className = 'status-line';
  status.innerHTML = `<span class="spinner"></span>Waiting for Twitch in your browser...`;
  try {
    const result = await api('/api/login/start', { method: 'POST' });
    state.loggedIn = true;
    status.className = 'status-line ok';
    status.textContent = `Logged in as ${result.login}.`;
    el('nextBtn').disabled = false;
  } catch (err) {
    status.className = 'status-line error';
    status.textContent = err.message;
  } finally {
    el('loginBtn').disabled = false;
  }
});

async function saveCredentialsIfNeeded() {
  const clientId = el('clientIdInput').value.trim();
  const clientSecret = el('clientSecretInput').value;
  if (!clientId) return true;
  try {
    await api('/api/credentials', { method: 'POST', body: { clientId, clientSecret } });
    el('credentialsStatus').className = 'status-line';
    el('credentialsStatus').textContent = '';
    return true;
  } catch (err) {
    el('credentialsStatus').className = 'status-line error';
    el('credentialsStatus').textContent = err.message;
    return false;
  }
}

async function saveShoutoutMessageIfNeeded() {
  const template = el('shoutoutTemplateInput').value.trim();
  try {
    await api('/api/settings', { method: 'POST', body: { shoutoutTemplate: template, autoShoutout: true } });
    return true;
  } catch (err) {
    el('shoutoutStatus').className = 'status-line error';
    el('shoutoutStatus').textContent = err.message;
    return false;
  }
}

async function saveStreamersIfAny() {
  const text = el('streamersInput').value.trim();
  if (!text) return true;
  try {
    const result = await api('/api/streamers', { method: 'POST', body: { text } });
    const problems = [...result.invalid.map(i => i.input), ...result.notFound];
    if (problems.length) {
      el('streamersStatus').className = 'status-line error';
      el('streamersStatus').textContent = `Added the rest. Skipped: ${problems.join(', ')}`;
      return false; // let the user see what was skipped before moving on
    }
    return true;
  } catch (err) {
    el('streamersStatus').className = 'status-line error';
    el('streamersStatus').textContent = err.message;
    return false;
  }
}

async function finishWizard() {
  await api('/api/setup/complete', { method: 'POST' });
  await window.navAPI.goToDashboard();
}

async function advance() {
  const id = currentId();

  if (id === 'credentials') {
    const ok = await saveCredentialsIfNeeded();
    if (!ok) return;
  } else if (id === 'shoutout-choice' && state.wantsShoutout === false) {
    await api('/api/settings', { method: 'POST', body: { autoShoutout: false } }).catch(() => {});
  } else if (id === 'shoutout-message') {
    const ok = await saveShoutoutMessageIfNeeded();
    if (!ok) return;
  } else if (id === 'streamers') {
    // Allow a second click to proceed even if some entries were skipped.
    const clean = await saveStreamersIfAny();
    if (!clean && el('streamersInput').value.trim() && !el('streamersInput').dataset.warned) {
      el('streamersInput').dataset.warned = '1';
      return;
    }
  } else if (id === 'finish') {
    el('nextBtn').disabled = true;
    await finishWizard();
    return;
  }

  goTo(currentIndex + 1);
}

el('nextBtn').addEventListener('click', advance);

async function init() {
  const info = await window.serverAPI.getInfo();
  API_BASE = `http://127.0.0.1:${info.port}`;
  SESSION_KEY = info.sessionKey;
  render();
}
init();
