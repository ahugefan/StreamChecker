// Read-only, anonymous connection to one Twitch channel's chat.
//
// Uses Twitch's chat server over a WebSocket with a random "justinfan"
// guest name, so it needs no login, no token and no extra permissions, and
// it cannot send anything. Reconnects by itself (growing delay, capped at
// 30 seconds) if the connection drops or goes silent.
//
// WebSocket and the timers are injected so this can be tested without a
// network.

const DEFAULT_URL = 'wss://irc-ws.chat.twitch.tv:443';
const CHANNEL_PATTERN = /^[a-z0-9_]{1,25}$/;
const MAX_BACKOFF_MS = 30_000;
// Twitch pings roughly every 5 minutes; no data at all for longer than this
// means the connection is dead even though it never reported closing.
const STALE_MS = 6 * 60 * 1000;

function normalizeChannel(value) {
  const name = String(value || '').trim().toLowerCase().replace(/^#/, '');
  return CHANNEL_PATTERN.test(name) ? name : null;
}

function unescapeTagValue(value) {
  return value.replace(/\\(.)/g, (_m, ch) => {
    const map = { s: ' ', ':': ';', r: '\r', n: '\n', '\\': '\\' };
    return ch in map ? map[ch] : ch;
  });
}

function parseTags(raw) {
  const tags = {};
  for (const part of raw.split(';')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq === -1) tags[part] = '';
    else tags[part.slice(0, eq)] = unescapeTagValue(part.slice(eq + 1));
  }
  return tags;
}

// Parses one chat-protocol line into { tags, prefix, command, params, trailing }.
function parseIrcLine(line) {
  let rest = String(line || '').replace(/[\r\n]+$/, '');
  if (!rest) return null;

  let tags = {};
  if (rest.startsWith('@')) {
    const space = rest.indexOf(' ');
    if (space === -1) return null;
    tags = parseTags(rest.slice(1, space));
    rest = rest.slice(space + 1);
  }

  let prefix = '';
  if (rest.startsWith(':')) {
    const space = rest.indexOf(' ');
    if (space === -1) return null;
    prefix = rest.slice(1, space);
    rest = rest.slice(space + 1);
  }

  let trailing = null;
  const trailingAt = rest.indexOf(' :');
  let head = rest;
  if (trailingAt !== -1) {
    trailing = rest.slice(trailingAt + 2);
    head = rest.slice(0, trailingAt);
  }
  const params = head.split(' ').filter(Boolean);
  const command = params.shift();
  if (!command) return null;
  return { tags, prefix, command, params, trailing };
}

// Turns a parsed PRIVMSG into { login, displayName, text, id }, else null.
function toChatMessage(parsed) {
  if (!parsed || parsed.command !== 'PRIVMSG') return null;
  const login = parsed.prefix.split('!')[0].toLowerCase();
  if (!login) return null;
  let text = parsed.trailing || '';
  if (text.startsWith('\u0001ACTION ')) text = text.slice(8).replace(/\u0001$/, ''); // "/me" messages
  return {
    login,
    displayName: parsed.tags['display-name'] || login,
    text,
    id: parsed.tags.id || ''
  };
}

function createChatListener({
  WebSocketImpl = globalThis.WebSocket,
  url = DEFAULT_URL,
  onMessage = () => {},
  onStatus = () => {},
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  random = Math.random,
  staleMs = STALE_MS
} = {}) {
  if (typeof WebSocketImpl !== 'function') throw new Error('WebSocket is not available in this environment.');

  let channel = null;
  let socket = null;
  let status = 'idle'; // 'idle' | 'connecting' | 'connected' | 'reconnecting'
  let attempt = 0;
  let retryTimer = null;
  let staleTimer = null;

  function setStatus(next) {
    if (next === status) return;
    status = next;
    try { onStatus(next); } catch { /* a listener bug must not break the connection */ }
  }

  function send(line) {
    try { if (socket) socket.send(line); } catch { /* socket is closing; the close handler recovers */ }
  }

  function clearTimers() {
    if (retryTimer) { clearTimer(retryTimer); retryTimer = null; }
    if (staleTimer) { clearTimer(staleTimer); staleTimer = null; }
  }

  // Detaches handlers first so a late event from the old socket can never
  // act on the new state.
  function detachSocket() {
    const old = socket;
    socket = null;
    if (!old) return;
    old.onopen = old.onmessage = old.onclose = old.onerror = null;
    try { old.close(); } catch { /* already closed */ }
  }

  function armStaleTimer() {
    if (staleTimer) clearTimer(staleTimer);
    staleTimer = setTimer(() => { staleTimer = null; dropAndRetry(); }, staleMs);
  }

  function dropAndRetry() {
    detachSocket();
    if (staleTimer) { clearTimer(staleTimer); staleTimer = null; }
    if (channel) scheduleReconnect();
  }

  function scheduleReconnect() {
    if (retryTimer) return;
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt) + Math.floor(random() * 500);
    attempt++;
    setStatus('reconnecting');
    retryTimer = setTimer(() => { retryTimer = null; connect(); }, delay);
  }

  function handleData(data) {
    for (const line of data.split(/\r?\n/)) {
      const parsed = parseIrcLine(line);
      if (!parsed) continue;
      switch (parsed.command) {
        case 'PING':
          send(`PONG :${parsed.trailing || 'tmi.twitch.tv'}`);
          break;
        case 'JOIN':
        case '366': // end of the user list: we are in the channel
          attempt = 0;
          setStatus('connected');
          break;
        case 'RECONNECT': // Twitch asks clients to reconnect (server maintenance)
          dropAndRetry();
          return;
        case 'PRIVMSG': {
          const message = toChatMessage(parsed);
          if (message) { try { onMessage(message); } catch { /* ignore handler errors */ } }
          break;
        }
        default:
          break;
      }
    }
  }

  function connect() {
    if (!channel) return;
    setStatus(attempt === 0 ? 'connecting' : 'reconnecting');

    let created;
    try {
      created = new WebSocketImpl(url);
    } catch {
      socket = null;
      scheduleReconnect();
      return;
    }
    socket = created;

    created.onopen = () => {
      if (socket !== created) return;
      armStaleTimer();
      send('CAP REQ :twitch.tv/tags');
      send('PASS SCHMOOPIIE');
      send(`NICK justinfan${10000 + Math.floor(random() * 90000)}`);
      send(`JOIN #${channel}`);
    };
    created.onmessage = (event) => {
      if (socket !== created) return;
      armStaleTimer();
      handleData(String(event.data));
    };
    created.onclose = () => { if (socket === created) dropAndRetry(); };
    created.onerror = () => { if (socket === created) dropAndRetry(); };
  }

  function stop() {
    channel = null;
    clearTimers();
    detachSocket();
    attempt = 0;
    setStatus('idle');
  }

  // Starts listening to a channel. Calling it again for the same channel
  // does nothing; for a different channel it switches over.
  function start(rawChannel) {
    const name = normalizeChannel(rawChannel);
    if (!name) throw new Error('That is not a valid Twitch channel name.');
    if (name === channel && (socket || retryTimer)) return;
    stop();
    channel = name;
    connect();
  }

  return { start, stop, getStatus: () => status, getChannel: () => channel };
}

module.exports = { createChatListener, parseIrcLine, toChatMessage, normalizeChannel };
