const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createChatListener, parseIrcLine, toChatMessage, normalizeChannel
} = require('../src/chat-listener');

// ---- helpers ----

class FakeWS {
  constructor(url) {
    this.url = url;
    this.sent = [];
    this.closed = false;
    FakeWS.instances.push(this);
  }
  send(line) { this.sent.push(line); }
  close() { this.closed = true; if (this.onclose) this.onclose({}); }
  open() { if (this.onopen) this.onopen({}); }
  receive(data) { if (this.onmessage) this.onmessage({ data }); }
  fail() { if (this.onerror) this.onerror({}); }
}

const STALE = 999_999;

function setup() {
  FakeWS.instances = [];
  const pending = new Map();
  let nextId = 0;
  const messages = [];
  const statuses = [];
  const listener = createChatListener({
    WebSocketImpl: FakeWS,
    onMessage: (m) => messages.push(m),
    onStatus: (s) => statuses.push(s),
    setTimer: (fn, ms) => { const id = ++nextId; pending.set(id, { fn, ms }); return id; },
    clearTimer: (id) => pending.delete(id),
    random: () => 0,
    staleMs: STALE
  });
  const fire = (predicate) => {
    for (const [id, timer] of pending) {
      if (predicate(timer.ms)) { pending.delete(id); timer.fn(); return timer.ms; }
    }
    throw new Error('no matching timer');
  };
  return {
    listener, messages, statuses, pending,
    ws: () => FakeWS.instances[FakeWS.instances.length - 1],
    count: () => FakeWS.instances.length,
    fireRetry: () => fire((ms) => ms < 100_000),
    fireStale: () => fire((ms) => ms === STALE),
    retryDelays: () => [...pending.values()].map((t) => t.ms).filter((ms) => ms < 100_000)
  };
}

const PRIVMSG = '@badge-info=;display-name=Alice;id=abc-123 :alice!alice@alice.tmi.twitch.tv PRIVMSG #mychannel :hello there';

// ---- parsing ----

test('parseIrcLine reads tags, prefix, command and text', () => {
  const p = parseIrcLine(PRIVMSG);
  assert.equal(p.command, 'PRIVMSG');
  assert.equal(p.tags['display-name'], 'Alice');
  assert.equal(p.prefix, 'alice!alice@alice.tmi.twitch.tv');
  assert.deepEqual(p.params, ['#mychannel']);
  assert.equal(p.trailing, 'hello there');
});

test('parseIrcLine handles PING, numerics and junk', () => {
  assert.equal(parseIrcLine('PING :tmi.twitch.tv').command, 'PING');
  assert.equal(parseIrcLine('PING :tmi.twitch.tv').trailing, 'tmi.twitch.tv');
  assert.equal(parseIrcLine(':tmi.twitch.tv 001 justinfan1 :Welcome, GLHF!').command, '001');
  assert.equal(parseIrcLine(''), null);
  assert.equal(parseIrcLine(null), null);
  assert.equal(parseIrcLine('@only-tags'), null);
});

test('tag values are unescaped', () => {
  const p = parseIrcLine('@display-name=A\\sB;note=x\\:y\\\\z :a!a@a PRIVMSG #c :hi');
  assert.equal(p.tags['display-name'], 'A B');
  assert.equal(p.tags.note, 'x;y\\z');
});

test('toChatMessage builds a message, strips /me, ignores other commands', () => {
  assert.deepEqual(toChatMessage(parseIrcLine(PRIVMSG)),
    { login: 'alice', displayName: 'Alice', text: 'hello there', id: 'abc-123' });
  const action = toChatMessage(parseIrcLine(':bob!bob@bob PRIVMSG #c :\u0001ACTION waves\u0001'));
  assert.equal(action.text, 'waves');
  assert.equal(action.displayName, 'bob');
  assert.equal(toChatMessage(parseIrcLine('PING :x')), null);
});

test('normalizeChannel accepts valid names only', () => {
  assert.equal(normalizeChannel('#MyChannel'), 'mychannel');
  assert.equal(normalizeChannel('  some_user1 '), 'some_user1');
  assert.equal(normalizeChannel(''), null);
  assert.equal(normalizeChannel('bad name'), null);
  assert.equal(normalizeChannel('a'.repeat(26)), null);
  assert.equal(normalizeChannel(null), null);
});

// ---- connection ----

test('start connects anonymously and joins the channel', () => {
  const { listener, ws, statuses } = setup();
  listener.start('MyChannel');
  assert.equal(listener.getChannel(), 'mychannel');
  assert.equal(listener.getStatus(), 'connecting');
  ws().open();
  assert.equal(ws().sent[0], 'CAP REQ :twitch.tv/tags');
  assert.match(ws().sent[2], /^NICK justinfan\d+$/);
  assert.equal(ws().sent[3], 'JOIN #mychannel');
  assert.ok(!ws().sent.some((l) => /oauth/i.test(l)), 'must never send a real token');
  ws().receive(':justinfan1!justinfan1@justinfan1.tmi.twitch.tv JOIN #mychannel\r\n');
  assert.equal(listener.getStatus(), 'connected');
  assert.deepEqual(statuses, ['connecting', 'connected']);
});

test('start rejects an invalid channel', () => {
  const { listener } = setup();
  assert.throws(() => listener.start('not valid!'), /valid Twitch channel/);
});

test('chat messages reach onMessage, several lines in one frame', () => {
  const { listener, ws, messages } = setup();
  listener.start('mychannel');
  ws().open();
  ws().receive(`${PRIVMSG}\r\n:bob!bob@bob.tmi.twitch.tv PRIVMSG #mychannel :second\r\n`);
  assert.deepEqual(messages.map((m) => [m.login, m.text]), [['alice', 'hello there'], ['bob', 'second']]);
});

test('PING is answered with PONG', () => {
  const { listener, ws } = setup();
  listener.start('mychannel');
  ws().open();
  ws().receive('PING :tmi.twitch.tv\r\n');
  assert.equal(ws().sent.at(-1), 'PONG :tmi.twitch.tv');
});

test('a throwing onMessage handler does not break the connection', () => {
  FakeWS.instances = [];
  const listener = createChatListener({
    WebSocketImpl: FakeWS,
    onMessage: () => { throw new Error('boom'); },
    setTimer: () => 1, clearTimer: () => {}, random: () => 0
  });
  listener.start('mychannel');
  const socket = FakeWS.instances[0];
  socket.open();
  assert.doesNotThrow(() => socket.receive(`${PRIVMSG}\r\n`));
});

// ---- reconnecting ----

test('reconnects after the connection closes, with a growing delay', () => {
  const t = setup();
  t.listener.start('mychannel');
  t.ws().close();
  assert.equal(t.listener.getStatus(), 'reconnecting');
  assert.deepEqual(t.retryDelays(), [1000]);
  t.fireRetry();
  assert.equal(t.count(), 2);
  t.ws().close();
  assert.deepEqual(t.retryDelays(), [2000]);
  t.fireRetry();
  t.ws().close();
  assert.deepEqual(t.retryDelays(), [4000]);
});

test('the delay never grows past 30 seconds', () => {
  const t = setup();
  t.listener.start('mychannel');
  for (let i = 0; i < 12; i++) { t.ws().close(); t.fireRetry(); }
  t.ws().close();
  assert.deepEqual(t.retryDelays(), [30_000]);
});

test('a successful join resets the delay', () => {
  const t = setup();
  t.listener.start('mychannel');
  t.ws().close(); t.fireRetry();
  t.ws().close(); t.fireRetry();
  t.ws().open();
  t.ws().receive(':j!j@j JOIN #mychannel\r\n');
  assert.equal(t.listener.getStatus(), 'connected');
  t.ws().close();
  assert.deepEqual(t.retryDelays(), [1000]);
});

test('a socket error also triggers one reconnect, not two', () => {
  const t = setup();
  t.listener.start('mychannel');
  t.ws().fail();
  assert.equal(t.retryDelays().length, 1);
});

test('the RECONNECT command from Twitch triggers a reconnect', () => {
  const t = setup();
  t.listener.start('mychannel');
  t.ws().open();
  t.ws().receive(':tmi.twitch.tv RECONNECT\r\n');
  assert.equal(t.listener.getStatus(), 'reconnecting');
  t.fireRetry();
  assert.equal(t.count(), 2);
});

test('a connection that goes silent is dropped and retried', () => {
  const t = setup();
  t.listener.start('mychannel');
  t.ws().open();
  t.fireStale();
  assert.equal(t.listener.getStatus(), 'reconnecting');
  t.fireRetry();
  assert.equal(t.count(), 2);
});

test('incoming data resets the silence timer', () => {
  const t = setup();
  t.listener.start('mychannel');
  t.ws().open();
  t.ws().receive('PING :tmi.twitch.tv\r\n');
  assert.equal([...t.pending.values()].filter((x) => x.ms === STALE).length, 1);
});

// ---- stopping and switching ----

test('stop closes the socket, cancels retries and goes idle', () => {
  const t = setup();
  t.listener.start('mychannel');
  const first = t.ws();
  t.listener.stop();
  assert.equal(first.closed, true);
  assert.equal(t.listener.getStatus(), 'idle');
  assert.equal(t.listener.getChannel(), null);
  assert.equal(t.pending.size, 0);
});

test('stop during a pending retry prevents the reconnect', () => {
  const t = setup();
  t.listener.start('mychannel');
  t.ws().close();
  t.listener.stop();
  assert.equal(t.pending.size, 0);
  assert.equal(t.count(), 1);
});

test('late events from a stopped socket are ignored', () => {
  const t = setup();
  t.listener.start('mychannel');
  const old = t.ws();
  t.listener.stop();
  old.receive(`${PRIVMSG}\r\n`);
  old.close();
  assert.equal(t.messages.length, 0);
  assert.equal(t.pending.size, 0);
});

test('starting the same channel again does nothing', () => {
  const t = setup();
  t.listener.start('mychannel');
  t.listener.start('MyChannel');
  assert.equal(t.count(), 1);
});

test('starting a different channel switches over', () => {
  const t = setup();
  t.listener.start('first');
  const old = t.ws();
  t.listener.start('second');
  assert.equal(old.closed, true);
  assert.equal(t.count(), 2);
  t.ws().open();
  assert.equal(t.ws().sent.at(-1), 'JOIN #second');
});

test('after stop, start works again', () => {
  const t = setup();
  t.listener.start('mychannel');
  t.listener.stop();
  t.listener.start('mychannel');
  assert.equal(t.count(), 2);
  assert.equal(t.listener.getStatus(), 'connecting');
});

test('a WebSocket constructor failure schedules a retry instead of throwing', () => {
  let attempts = 0;
  class Broken { constructor() { attempts++; throw new Error('no network'); } }
  const timers = [];
  const listener = createChatListener({
    WebSocketImpl: Broken,
    setTimer: (fn, ms) => { timers.push(ms); return timers.length; },
    clearTimer: () => {},
    random: () => 0
  });
  assert.doesNotThrow(() => listener.start('mychannel'));
  assert.equal(attempts, 1);
  assert.deepEqual(timers, [1000]);
  assert.equal(listener.getStatus(), 'reconnecting');
});
