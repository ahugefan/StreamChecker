// Stream overlay window: just the live streamers, in one column, scrolling in
// a loop when there are more tiles than fit. Display-only (no clicking), and it
// never shows error messages - if a refresh fails it keeps the last good list.
// Talks to the same local server as the dashboard.

let API_BASE = '';
let SESSION_KEY = '';
let settings = null;
let streams = [];
let renderedKey = '';
let lookKey = '';
let lastLoop = { distance: 0, seconds: 0 };
let refreshTimer = null;

const SETTINGS_POLL_MS = 3000; // picks up changes made in the main window's Settings

const viewport = document.getElementById('overlayViewport');
const track = document.getElementById('overlayTrack');
const emptyNote = document.getElementById('overlayEmpty');

// Settings that change how the overlay looks or behaves.
const LOOK_KEYS = [
  'lightTheme', 'accentColor', 'highlightVips', 'refreshMinutes',
  'overlaySpeed', 'overlayTitles', 'overlayShowViewers', 'overlayBackground'
];

async function api(path) {
  const res = await fetch(`${API_BASE}${path}`, { headers: { 'X-Session-Key': SESSION_KEY } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function applyLook() {
  document.body.classList.toggle('light-theme', settings.lightTheme);
  document.body.classList.toggle('overlay-green', settings.overlayBackground === 'green');
  ThemeUtil.apply(document.documentElement, settings.accentColor, settings.lightTheme);
  ThemeUtil.cache(settings.accentColor, settings.lightTheme);
}

function makeEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text; // text only, never HTML
  return node;
}

function createCard(stream) {
  const card = makeEl('div', 'card overlay-card');
  if (settings.highlightVips && stream.isVip) card.classList.add('vip');

  const header = makeEl('div', 'card-header');
  header.append(makeEl('span', 'username', stream.username), makeEl('span', 'status-pill status-live', 'LIVE'));
  card.appendChild(header);

  if (settings.overlayTitles !== 'off') {
    card.appendChild(makeEl('div', settings.overlayTitles === 'one-line' ? 'title one-line' : 'title', stream.title || ''));
  }
  if (settings.overlayShowViewers) {
    const meta = makeEl('div', 'meta-row');
    meta.appendChild(makeEl('span', 'viewers', `${stream.viewers} viewers`));
    card.appendChild(meta);
  }
  return card;
}

// Changes that need the tiles rebuilt (and the scroll restarted), as opposed to
// just new viewer counts or titles.
function structureKey(items) {
  return [
    settings.overlayTitles, settings.overlayShowViewers, settings.highlightVips,
    ...items.map(s => `${s.username}:${s.isVip ? 1 : 0}`)
  ].join('|');
}

function updateText(items) {
  const list = track.querySelector('.overlay-list');
  items.forEach((s, i) => {
    const card = list.children[i];
    if (!card) return;
    const title = card.querySelector('.title');
    if (title) title.textContent = s.title || '';
    const viewers = card.querySelector('.viewers');
    if (viewers) viewers.textContent = `${s.viewers} viewers`;
  });
}

function stopScrolling() {
  track.classList.remove('scrolling');
  lastLoop = { distance: 0, seconds: 0 };
}

// The list is shown twice, back to back, and slid up by one list length in a
// loop, so the end flows straight into the start with no jump.
function layoutScroll({ restart = false } = {}) {
  const lists = track.querySelectorAll('.overlay-list');
  lists.forEach((list, i) => { if (i > 0) list.remove(); });
  const first = lists[0];
  if (!first) return stopScrolling();

  const gap = parseFloat(getComputedStyle(first).rowGap) || 10;
  const height = first.offsetHeight;
  if (!OverlayLogic.needsScroll(height, viewport.clientHeight)) return stopScrolling();

  const copy = first.cloneNode(true);
  copy.setAttribute('aria-hidden', 'true');
  track.appendChild(copy);

  const distance = OverlayLogic.loopDistance(height, gap);
  const seconds = OverlayLogic.scrollSeconds(distance, settings.overlaySpeed);
  const changed = Math.abs(distance - lastLoop.distance) > 0.5 || Math.abs(seconds - lastLoop.seconds) > 0.05;

  if (restart) { track.classList.remove('scrolling'); void track.offsetWidth; }
  if (restart || changed) {
    track.style.setProperty('--scroll-distance', `${distance}px`);
    track.style.setProperty('--scroll-duration', `${seconds}s`);
    lastLoop = { distance, seconds };
  }
  track.classList.add('scrolling');
}

function render() {
  if (!settings) return;
  const items = OverlayLogic.selectStreams(streams);
  emptyNote.hidden = items.length > 0;

  const key = structureKey(items);
  if (key !== renderedKey || !track.querySelector('.overlay-list')) {
    track.replaceChildren();
    const list = makeEl('div', 'overlay-list');
    items.forEach(s => list.appendChild(createCard(s)));
    track.appendChild(list);
    renderedKey = key;
    layoutScroll({ restart: true });
  } else {
    updateText(items);   // same people in the same order: just refresh the numbers and titles
    layoutScroll();
  }
}

async function refreshStreams() {
  try {
    const data = await api('/api/streams');
    streams = data.streams || [];
    render();
  } catch { /* keep showing the last good list */ }
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  const minutes = settings ? settings.refreshMinutes : 5;
  refreshTimer = setTimeout(async () => { await refreshStreams(); scheduleRefresh(); }, minutes * 60000);
}

async function pollSettings() {
  try {
    settings = await api('/api/settings');
    const key = JSON.stringify(LOOK_KEYS.map(k => settings[k]));
    if (key !== lookKey) {
      lookKey = key;
      applyLook();
      render();
      scheduleRefresh();
    }
  } catch { /* try again next time */ }
}

async function init() {
  const info = window.serverAPI ? await window.serverAPI.getInfo() : null;
  if (!info) return;
  API_BASE = `http://127.0.0.1:${info.port}`;
  SESSION_KEY = info.sessionKey;

  while (!settings) {
    await pollSettings();
    if (!settings) await new Promise(resolve => setTimeout(resolve, 1000));
  }
  await refreshStreams();
  setInterval(pollSettings, SETTINGS_POLL_MS);

  let pending = false;
  new ResizeObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; layoutScroll(); });
  }).observe(viewport);
}

init();
