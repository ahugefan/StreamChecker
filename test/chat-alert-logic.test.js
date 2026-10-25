const test = require('node:test');
const assert = require('node:assert/strict');
const { createAlertGate } = require('../src/chat-alert-logic');

const MIN = 60_000;

function setup(options = {}) {
  let t = 1_000_000;
  const gate = createAlertGate({ now: () => t });
  const opts = { ownerLogin: 'me', ignoreList: [], quietMinutes: 3, cooldownSeconds: 0, ...options };
  return {
    gate,
    advance: (ms) => { t += ms; },
    say: (login) => gate.observe({ login }, opts)
  };
}

test('the first message alerts', () => {
  const { say } = setup();
  assert.deepEqual(say('alice'), { alert: true, reason: 'alert' });
});

test('a busy chat stays quiet, the first message after a lull alerts', () => {
  const { say, advance } = setup({ quietMinutes: 3 });
  assert.equal(say('alice').alert, true);
  advance(30_000);
  assert.deepEqual(say('bob'), { alert: false, reason: 'busy' });
  advance(2 * MIN);
  assert.equal(say('alice').alert, false); // 2 min since bob: still busy
  advance(3 * MIN + 1);
  assert.equal(say('carol').alert, true);  // 3+ min of silence
});

test('quietMinutes 0 turns auto-quiet off', () => {
  const { say, advance } = setup({ quietMinutes: 0 });
  assert.equal(say('alice').alert, true);
  advance(1000);
  assert.equal(say('bob').alert, true);
});

test('ignored accounts never alert, in any letter case or with @', () => {
  const { say } = setup({ ignoreList: ['Nightbot', '@StreamElements'] });
  assert.deepEqual(say('nightbot'), { alert: false, reason: 'ignored' });
  assert.deepEqual(say('STREAMELEMENTS'), { alert: false, reason: 'ignored' });
});

test("the streamer's own messages never alert", () => {
  const { say } = setup({ ownerLogin: 'MyChannel' });
  assert.equal(say('mychannel').reason, 'ignored');
});

test('ignored messages do not break the silence', () => {
  const { say, advance } = setup({ ignoreList: ['nightbot'], quietMinutes: 3 });
  assert.equal(say('alice').alert, true);
  advance(4 * MIN);
  say('nightbot'); // a bot timer fires
  advance(1000);
  assert.equal(say('bob').alert, true); // still counts as a lull for real chatters
});

test('a message with no sender is ignored', () => {
  const { gate } = setup();
  assert.equal(gate.observe({ login: '' }, {}).reason, 'ignored');
  assert.equal(gate.observe({}, {}).reason, 'ignored');
});

test('cooldown allows at most one alert per window', () => {
  const { say, advance } = setup({ quietMinutes: 0, cooldownSeconds: 10 });
  assert.equal(say('a').alert, true);
  advance(5000);
  assert.deepEqual(say('b'), { alert: false, reason: 'cooldown' });
  advance(5000);
  assert.equal(say('c').alert, true);
});

test('with alerts off nothing alerts, but activity is still tracked', () => {
  const { gate, say, advance } = setup({ quietMinutes: 3 });
  gate.setEnabled(false);
  assert.deepEqual(say('alice'), { alert: false, reason: 'off' });
  advance(1000);
  gate.setEnabled(true);
  // Chat was active one second ago, so turning alerts back on does not ping.
  assert.equal(say('bob').reason, 'busy');
});

test('getLastActivityAt reports the last counted message only', () => {
  const { gate, say, advance } = setup({ ignoreList: ['bot'] });
  assert.equal(gate.getLastActivityAt(), null);
  say('alice');
  const first = gate.getLastActivityAt();
  advance(5000);
  say('bot');
  assert.equal(gate.getLastActivityAt(), first);
  advance(5000);
  say('bob');
  assert.equal(gate.getLastActivityAt(), first + 10_000);
});

test('isEnabled reflects setEnabled and starts on', () => {
  const { gate } = setup();
  assert.equal(gate.isEnabled(), true);
  gate.setEnabled(false);
  assert.equal(gate.isEnabled(), false);
});
