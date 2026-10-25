const test = require('node:test');
const assert = require('node:assert/strict');
const { createChatAlertService } = require('../src/chat-alert-service');
const { createAlertGate } = require('../src/chat-alert-logic');

const MIN = 60_000;

function setup(initial = {}) {
  const store = {
    channelLogin: 'mychannel',
    chatAlertEnabled: false,
    chatAlertQuietMinutes: 3,
    chatAlertCooldownSeconds: 0,
    chatAlertIgnore: [],
    chatAlertHotkey: 'Ctrl+Alt+C',
    ...initial
  };
  const config = {
    getSettings: () => ({ ...store }),
    updateSettings: (patch) => { Object.assign(store, patch); return { ...store }; }
  };

  const listenerCalls = [];
  let handlers;
  const createListener = (h) => {
    handlers = h;
    return {
      start: (channel) => listenerCalls.push(['start', channel]),
      stop: () => listenerCalls.push(['stop'])
    };
  };

  const shortcuts = new Map();           // accelerator -> callback
  const shortcutLog = [];
  let registerResult = true;
  let registerThrows = false;
  const globalShortcut = {
    register: (accelerator, cb) => {
      shortcutLog.push(['register', accelerator]);
      if (registerThrows) throw new Error('invalid accelerator');
      if (!registerResult) return false;
      shortcuts.set(accelerator, cb);
      return true;
    },
    unregister: (accelerator) => { shortcutLog.push(['unregister', accelerator]); shortcuts.delete(accelerator); }
  };

  let t = 1_000_000;
  const states = [];
  const alerts = [];
  const service = createChatAlertService({
    config,
    createListener,
    createGate: createAlertGate,
    globalShortcut,
    onState: (s) => states.push(s),
    onAlert: (a) => alerts.push(a),
    now: () => t
  });

  return {
    service, store, states, alerts, listenerCalls, shortcuts, shortcutLog,
    chat: (login, displayName = login) => handlers.onMessage({ login, displayName, text: 'hi', id: '' }),
    status: (s) => handlers.onStatus(s),
    advance: (ms) => { t += ms; },
    failRegister: (v = true) => { registerResult = !v; },
    throwOnRegister: (v = true) => { registerThrows = v; }
  };
}

// ---- starting up ----

test('with alerts off, nothing connects to Twitch but the shortcut is registered', () => {
  const t = setup();
  t.service.refresh();
  assert.deepEqual(t.listenerCalls, [['stop']]);
  assert.ok(t.shortcuts.has('Ctrl+Alt+C'));
  const state = t.service.getState();
  assert.equal(state.enabled, false);
  assert.equal(state.hotkeyActive, true);
});

test('turning alerts on connects to the saved channel and saves the choice', () => {
  const t = setup();
  t.service.refresh();
  const state = t.service.setEnabled(true);
  assert.equal(t.store.chatAlertEnabled, true);
  assert.deepEqual(t.listenerCalls.at(-1), ['start', 'mychannel']);
  assert.equal(state.enabled, true);
});

test('starting with alerts already on connects right away', () => {
  const t = setup({ chatAlertEnabled: true });
  t.service.refresh();
  assert.deepEqual(t.listenerCalls.at(-1), ['start', 'mychannel']);
});

test('turning alerts on without a logged-in channel waits, then connects after login', () => {
  const t = setup({ channelLogin: '' });
  t.service.refresh();
  const state = t.service.setEnabled(true);
  assert.equal(state.enabled, true);
  assert.equal(state.canListen, false);
  assert.ok(!t.listenerCalls.some(c => c[0] === 'start'));

  t.store.channelLogin = 'newlogin';   // Login with Twitch completes
  t.service.refresh();
  assert.deepEqual(t.listenerCalls.at(-1), ['start', 'newlogin']);
  assert.equal(t.service.getState().canListen, true);
});

test('turning alerts off disconnects', () => {
  const t = setup({ chatAlertEnabled: true });
  t.service.refresh();
  t.service.setEnabled(false);
  assert.deepEqual(t.listenerCalls.at(-1), ['stop']);
  assert.equal(t.store.chatAlertEnabled, false);
});

test('logging out while alerts are on disconnects; a different channel switches over', () => {
  const t = setup({ chatAlertEnabled: true });
  t.service.refresh();
  t.store.channelLogin = '';
  t.service.refresh();
  assert.deepEqual(t.listenerCalls.at(-1), ['stop']);
  t.store.channelLogin = 'other';
  t.service.refresh();
  assert.deepEqual(t.listenerCalls.at(-1), ['start', 'other']);
});

// ---- toggling ----

test('toggle flips the state each time', () => {
  const t = setup();
  t.service.refresh();
  assert.equal(t.service.toggle().enabled, true);
  assert.equal(t.service.toggle().enabled, false);
  assert.equal(t.service.toggle().enabled, true);
});

test('pressing the shortcut toggles alerts', () => {
  const t = setup();
  t.service.refresh();
  t.shortcuts.get('Ctrl+Alt+C')();
  assert.equal(t.store.chatAlertEnabled, true);
  assert.deepEqual(t.listenerCalls.at(-1), ['start', 'mychannel']);
  t.shortcuts.get('Ctrl+Alt+C')();
  assert.equal(t.store.chatAlertEnabled, false);
});

test('a failed save during a shortcut press does not throw', () => {
  const store = { channelLogin: 'c', chatAlertEnabled: false, chatAlertQuietMinutes: 3, chatAlertCooldownSeconds: 0, chatAlertIgnore: [], chatAlertHotkey: 'Ctrl+Alt+C' };
  let press;
  const service = createChatAlertService({
    config: {
      getSettings: () => ({ ...store }),
      updateSettings: () => { throw new Error('disk full'); }
    },
    createListener: () => ({ start() {}, stop() {} }),
    createGate: createAlertGate,
    globalShortcut: { register: (_acc, cb) => { press = cb; return true; }, unregister() {} }
  });
  service.refresh();
  assert.equal(typeof press, 'function');
  assert.doesNotThrow(() => press());
  assert.equal(service.getState().enabled, false);
});

// ---- the shortcut ----

test('changing the shortcut in settings re-registers it', () => {
  const t = setup();
  t.service.refresh();
  t.store.chatAlertHotkey = 'Alt+F9';
  t.service.refresh();
  assert.ok(!t.shortcuts.has('Ctrl+Alt+C'));
  assert.ok(t.shortcuts.has('Alt+F9'));
  assert.equal(t.service.getState().hotkey, 'Alt+F9');
});

test('clearing the shortcut removes it', () => {
  const t = setup();
  t.service.refresh();
  t.store.chatAlertHotkey = '';
  t.service.refresh();
  assert.equal(t.shortcuts.size, 0);
  const state = t.service.getState();
  assert.equal(state.hotkeyActive, false);
  assert.equal(state.hotkeyError, '');
});

test('an empty shortcut is never registered', () => {
  const t = setup({ chatAlertHotkey: '' });
  t.service.refresh();
  assert.equal(t.shortcutLog.length, 0);
});

test('a shortcut another program is using is reported, and retried later', () => {
  const t = setup();
  t.failRegister();
  t.service.refresh();
  let state = t.service.getState();
  assert.equal(state.hotkeyActive, false);
  assert.match(state.hotkeyError, /Ctrl\+Alt\+C could not be set/);

  t.failRegister(false);               // the other program let go of it
  t.service.refresh();
  state = t.service.getState();
  assert.equal(state.hotkeyActive, true);
  assert.equal(state.hotkeyError, '');
});

test('a shortcut the system rejects by throwing is handled', () => {
  const t = setup();
  t.throwOnRegister();
  assert.doesNotThrow(() => t.service.refresh());
  assert.match(t.service.getState().hotkeyError, /could not be set/);
});

test('refreshing with nothing changed does not re-register the shortcut', () => {
  const t = setup();
  t.service.refresh();
  const before = t.shortcutLog.length;
  t.service.refresh();
  t.service.refresh();
  assert.equal(t.shortcutLog.length, before);
});

// ---- chat messages ----

test('the first chat message after a lull alerts, with who sent it', () => {
  const t = setup({ chatAlertEnabled: true });
  t.service.refresh();
  t.chat('alice', 'Alice');
  assert.equal(t.alerts.length, 1);
  assert.equal(t.alerts[0].login, 'alice');
  assert.equal(t.alerts[0].displayName, 'Alice');
});

test('a busy chat stays quiet and the next lull alerts again', () => {
  const t = setup({ chatAlertEnabled: true, chatAlertQuietMinutes: 3 });
  t.service.refresh();
  t.chat('alice');
  t.advance(10_000);
  t.chat('bob');
  t.advance(10_000);
  t.chat('carol');
  assert.equal(t.alerts.length, 1);
  t.advance(4 * MIN);
  t.chat('dave');
  assert.equal(t.alerts.length, 2);
});

test('bots on the ignore list and the streamer never alert', () => {
  const t = setup({ chatAlertEnabled: true, chatAlertIgnore: ['nightbot'] });
  t.service.refresh();
  t.chat('nightbot');
  t.chat('mychannel');
  assert.equal(t.alerts.length, 0);
  t.chat('alice');
  assert.equal(t.alerts.length, 1);
});

test('changed alert settings apply on the next refresh', () => {
  const t = setup({ chatAlertEnabled: true, chatAlertQuietMinutes: 3 });
  t.service.refresh();
  t.chat('alice');
  t.advance(1000);
  t.chat('bob');
  assert.equal(t.alerts.length, 1);          // bob was inside the quiet window

  t.store.chatAlertQuietMinutes = 0;         // alert on every message
  t.store.chatAlertIgnore = ['carol'];
  t.service.refresh();
  t.advance(1000);
  t.chat('bob');
  t.chat('carol');
  assert.equal(t.alerts.length, 2);          // bob alerts now, carol is ignored
});

test('a throwing alert handler does not stop chat processing', () => {
  const store = { channelLogin: 'c', chatAlertEnabled: true, chatAlertQuietMinutes: 0, chatAlertCooldownSeconds: 0, chatAlertIgnore: [], chatAlertHotkey: '' };
  let handlers;
  const service = createChatAlertService({
    config: { getSettings: () => ({ ...store }), updateSettings: () => ({}) },
    createListener: (h) => { handlers = h; return { start() {}, stop() {} }; },
    createGate: createAlertGate,
    globalShortcut: { register: () => true, unregister() {} },
    onAlert: () => { throw new Error('boom'); }
  });
  service.refresh();
  assert.doesNotThrow(() => handlers.onMessage({ login: 'alice', displayName: 'Alice', text: '', id: '' }));
});

// ---- state reporting ----

test('connection status changes are reported to the window', () => {
  const t = setup({ chatAlertEnabled: true });
  t.service.refresh();
  t.status('connecting');
  t.status('connected');
  t.status('reconnecting');
  assert.deepEqual(t.states.map(s => s.status).slice(-3), ['connecting', 'connected', 'reconnecting']);
});

test('chat messages alone do not flood the window with state updates', () => {
  const t = setup({ chatAlertEnabled: true });
  t.service.refresh();
  t.status('connected');
  const before = t.states.length;
  for (let i = 0; i < 50; i++) { t.advance(100); t.chat(`user${i}`); }
  assert.equal(t.states.length, before);
});

test('getState reports when chat was last active', () => {
  const t = setup({ chatAlertEnabled: true });
  t.service.refresh();
  assert.equal(t.service.getState().lastActivityAt, null);
  t.chat('alice');
  assert.equal(t.service.getState().lastActivityAt, 1_000_000);
});

test('an unchanged refresh reports nothing new; a real change reports once', () => {
  const t = setup();
  t.service.refresh();
  const first = t.states.length;
  t.service.refresh();
  assert.equal(t.states.length, first);
  t.service.setEnabled(true);
  assert.equal(t.states.length, first + 1);
});

test('a throwing state handler does not break the service', () => {
  const store = { channelLogin: 'c', chatAlertEnabled: false, chatAlertQuietMinutes: 3, chatAlertCooldownSeconds: 0, chatAlertIgnore: [], chatAlertHotkey: '' };
  const service = createChatAlertService({
    config: { getSettings: () => ({ ...store }), updateSettings: (p) => Object.assign(store, p) },
    createListener: () => ({ start() {}, stop() {} }),
    createGate: createAlertGate,
    globalShortcut: { register: () => true, unregister() {} },
    onState: () => { throw new Error('window gone'); }
  });
  assert.doesNotThrow(() => service.refresh());
  assert.doesNotThrow(() => service.setEnabled(true));
});

test('if settings cannot be read, the last good settings keep working', () => {
  const store = { channelLogin: 'c', chatAlertEnabled: true, chatAlertQuietMinutes: 3, chatAlertCooldownSeconds: 0, chatAlertIgnore: [], chatAlertHotkey: '' };
  let fail = false;
  const service = createChatAlertService({
    config: { getSettings: () => { if (fail) throw new Error('disk error'); return { ...store }; }, updateSettings: () => ({}) },
    createListener: () => ({ start() {}, stop() {} }),
    createGate: createAlertGate,
    globalShortcut: { register: () => true, unregister() {} }
  });
  service.refresh();
  fail = true;
  assert.doesNotThrow(() => service.refresh());
  assert.equal(service.getState().enabled, true);
});

// ---- shutting down ----

test('shutdown disconnects and releases the shortcut', () => {
  const t = setup({ chatAlertEnabled: true });
  t.service.refresh();
  t.service.shutdown();
  assert.deepEqual(t.listenerCalls.at(-1), ['stop']);
  assert.equal(t.shortcuts.size, 0);
  assert.equal(t.service.getState().hotkeyActive, false);
});
