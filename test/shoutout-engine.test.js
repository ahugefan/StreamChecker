const test = require('node:test');
const assert = require('node:assert');
const { createShoutoutEngine } = require('../src/shoutout-engine');

// Minimal fake config: just enough of the real config.js surface for this engine.
function fakeConfig(overrides = {}) {
  let settings = {
    autoShoutout: true,
    broadcasterUserId: '999',
    channelLogin: 'my_channel',
    shoutoutAccountType: 'self',
    botUserId: '',
    streamers: ['alpha_one', 'beta_two', 'my_channel'],
    shoutoutTemplate: '!so {username}',
    clientId: 'cid',
    ...overrides
  };
  return { getSettings: () => settings };
}

// liveLogins: array of logins currently live (the fake Twitch client "knows" these).
function fakeTwitchClient(liveLogins) {
  return {
    getLiveStreams: async (logins) => {
      const map = new Map();
      for (const l of logins) if (liveLogins.includes(l)) map.set(l, { title: 't', viewer_count: 1 });
      return map;
    }
  };
}

function noopSleep() { return Promise.resolve(); }

test('does nothing when autoShoutout is off', async () => {
  const engine = createShoutoutEngine({
    config: fakeConfig({ autoShoutout: false }),
    twitchClient: fakeTwitchClient(['my_channel', 'alpha_one']),
    getAccessToken: async () => 'tok',
    sendChatMessage: async () => { throw new Error('should not be called'); },
    sleepFn: noopSleep
  });
  const result = await engine.runOnce();
  assert.ok(result.skipped);
});

test('does nothing when not logged in (no broadcasterUserId)', async () => {
  const engine = createShoutoutEngine({
    config: fakeConfig({ broadcasterUserId: '' }),
    twitchClient: fakeTwitchClient(['my_channel']),
    getAccessToken: async () => 'tok',
    sendChatMessage: async () => { throw new Error('should not be called'); },
    sleepFn: noopSleep
  });
  const result = await engine.runOnce();
  assert.ok(result.skipped);
});

test('sends nothing while the broadcaster is offline', async () => {
  const engine = createShoutoutEngine({
    config: fakeConfig(),
    twitchClient: fakeTwitchClient(['alpha_one']), // broadcaster not live
    getAccessToken: async () => 'tok',
    sendChatMessage: async () => { throw new Error('should not be called'); },
    sleepFn: noopSleep
  });
  const result = await engine.runOnce();
  assert.strictEqual(result.broadcasterLive, false);
});

test('sends a shoutout for each live tracked streamer once the broadcaster is live', async () => {
  const sent = [];
  const engine = createShoutoutEngine({
    config: fakeConfig(),
    twitchClient: fakeTwitchClient(['my_channel', 'alpha_one', 'beta_two']),
    getAccessToken: async (role) => `tok-${role}`,
    sendChatMessage: async ({ broadcasterId, senderId, message }) => { sent.push({ broadcasterId, senderId, message }); },
    sleepFn: noopSleep
  });
  const result = await engine.runOnce();
  assert.deepStrictEqual(result.sent.sort(), ['alpha_one', 'beta_two']);
  assert.strictEqual(sent.length, 2);
  assert.ok(sent.every(s => s.broadcasterId === '999' && s.senderId === '999'));
  assert.ok(sent.some(s => s.message === '!so alpha_one'));
});

test('never shouts out the broadcaster themselves', async () => {
  const sent = [];
  const engine = createShoutoutEngine({
    config: fakeConfig({ streamers: ['my_channel'] }),
    twitchClient: fakeTwitchClient(['my_channel']),
    getAccessToken: async () => 'tok',
    sendChatMessage: async (args) => sent.push(args),
    sleepFn: noopSleep
  });
  await engine.runOnce();
  assert.strictEqual(sent.length, 0);
});

test('does not repeat a shoutout for the same streamer within one live session', async () => {
  const sent = [];
  const engine = createShoutoutEngine({
    config: fakeConfig(),
    twitchClient: fakeTwitchClient(['my_channel', 'alpha_one']),
    getAccessToken: async () => 'tok',
    sendChatMessage: async (args) => sent.push(args),
    sleepFn: noopSleep
  });
  await engine.runOnce();
  await engine.runOnce();
  assert.strictEqual(sent.length, 1);
});

test('a new broadcaster session (offline then live again) resets who has been shouted out', async () => {
  const sent = [];
  let live = ['my_channel', 'alpha_one'];
  const engine = createShoutoutEngine({
    config: fakeConfig(),
    twitchClient: { getLiveStreams: async (logins) => new Map(logins.filter(l => live.includes(l)).map(l => [l, { viewer_count: 1 }])) },
    getAccessToken: async () => 'tok',
    sendChatMessage: async (args) => sent.push(args),
    sleepFn: noopSleep
  });
  await engine.runOnce(); // sends for alpha_one
  live = []; // broadcaster goes offline
  await engine.runOnce(); // no-op
  live = ['my_channel', 'alpha_one']; // broadcaster live again, new session
  await engine.runOnce(); // should send again
  assert.strictEqual(sent.length, 2);
});

test('uses the bot account credentials and identity when shoutoutAccountType is bot', async () => {
  const sent = [];
  const engine = createShoutoutEngine({
    config: fakeConfig({ shoutoutAccountType: 'bot', botUserId: '555' }),
    twitchClient: fakeTwitchClient(['my_channel', 'alpha_one']),
    getAccessToken: async (role) => (role === 'bot' ? 'bot-token' : 'self-token'),
    sendChatMessage: async (args) => sent.push(args),
    sleepFn: noopSleep
  });
  await engine.runOnce();
  assert.strictEqual(sent[0].senderId, '555');
  assert.strictEqual(sent[0].accessToken, 'bot-token');
});

test('one failed send does not block the others, and is reported', async () => {
  const engine = createShoutoutEngine({
    config: fakeConfig(),
    twitchClient: fakeTwitchClient(['my_channel', 'alpha_one', 'beta_two']),
    getAccessToken: async () => 'tok',
    sendChatMessage: async ({ message }) => { if (message.includes('alpha_one')) throw new Error('boom'); },
    sleepFn: noopSleep
  });
  const result = await engine.runOnce();
  assert.deepStrictEqual(result.sent, ['beta_two']);
  assert.strictEqual(result.failed.length, 1);
  assert.strictEqual(result.failed[0].login, 'alpha_one');
});

test('resendAll sends to every currently-live streamer even if already shouted this session', async () => {
  const sent = [];
  const engine = createShoutoutEngine({
    config: fakeConfig(),
    twitchClient: fakeTwitchClient(['my_channel', 'alpha_one']),
    getAccessToken: async () => 'tok',
    sendChatMessage: async (args) => sent.push(args),
    sleepFn: noopSleep
  });
  await engine.runOnce();       // sends once
  const result = await engine.resendAll(); // sends again regardless
  assert.strictEqual(sent.length, 2);
  assert.deepStrictEqual(result.sent, ['alpha_one']);
});
