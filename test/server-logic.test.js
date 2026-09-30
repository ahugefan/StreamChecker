const test = require('node:test');
const assert = require('node:assert');
const {
  buildStreamsPayload, sortStreams, safeKeyEquals, generateSessionKey, formatLastRefresh
} = require('../src/server-logic');

test('formatLastRefresh produces a non-empty local-time string', () => {
  const s = formatLastRefresh(new Date('2026-09-28T13:41:00Z'));
  assert.ok(typeof s === 'string' && s.length > 0);
});

test('buildStreamsPayload marks live vs offline correctly', () => {
  const liveMap = new Map([['alpha_one', { title: 'Playing', viewer_count: 42 }]]);
  const payload = buildStreamsPayload({
    streamers: ['alpha_one', 'beta_two'], liveMap, vips: [], showOffline: true
  });
  assert.strictEqual(payload.total, 2);
  assert.strictEqual(payload.liveNow, 1);
  assert.strictEqual(payload.offlineHidden, 0);
  const alpha = payload.streams.find(s => s.username === 'alpha_one');
  assert.strictEqual(alpha.isLive, true);
  assert.strictEqual(alpha.viewers, 42);
  const beta = payload.streams.find(s => s.username === 'beta_two');
  assert.strictEqual(beta.isLive, false);
  assert.strictEqual(beta.title, 'No title available');
});

test('a blank title from Twitch falls back to "No title available"', () => {
  const liveMap = new Map([['alpha_one', { title: '   ', viewer_count: 3 }]]);
  const payload = buildStreamsPayload({ streamers: ['alpha_one'], liveMap, vips: [], showOffline: true });
  assert.strictEqual(payload.streams[0].title, 'No title available');
});

test('showOffline=false hides offline streamers but keeps them in the total', () => {
  const liveMap = new Map([['alpha_one', { title: 't', viewer_count: 1 }]]);
  const payload = buildStreamsPayload({
    streamers: ['alpha_one', 'beta_two', 'gamma_three'], liveMap, vips: [], showOffline: false
  });
  assert.strictEqual(payload.total, 3);
  assert.strictEqual(payload.liveNow, 1);
  assert.strictEqual(payload.offlineHidden, 2);
  assert.strictEqual(payload.streams.length, 1);
  assert.strictEqual(payload.streams[0].username, 'alpha_one');
});

test('sorting puts VIPs first, then live, then alphabetical', () => {
  const liveMap = new Map([
    ['charlie', { title: 't', viewer_count: 1 }],
    ['delta', { title: 't', viewer_count: 1 }]
  ]);
  const payload = buildStreamsPayload({
    streamers: ['delta', 'alpha', 'bravo', 'charlie'],
    liveMap, vips: ['bravo'], showOffline: true
  });
  assert.deepStrictEqual(payload.streams.map(s => s.username), ['bravo', 'charlie', 'delta', 'alpha']);
});

test('sortStreams is stable for equal-rank entries (alphabetical order holds)', () => {
  const streams = [
    { username: 'zulu', isLive: false, isVip: false },
    { username: 'alpha', isLive: false, isVip: false }
  ];
  sortStreams(streams);
  assert.deepStrictEqual(streams.map(s => s.username), ['alpha', 'zulu']);
});

test('empty streamer list produces an empty, valid payload', () => {
  const payload = buildStreamsPayload({ streamers: [], liveMap: new Map(), vips: [], showOffline: true });
  assert.strictEqual(payload.total, 0);
  assert.strictEqual(payload.liveNow, 0);
  assert.deepStrictEqual(payload.streams, []);
});

test('safeKeyEquals matches equal keys and rejects different ones', () => {
  const key = generateSessionKey();
  assert.strictEqual(safeKeyEquals(key, key), true);
  assert.strictEqual(safeKeyEquals(key, 'wrong'), false);
  assert.strictEqual(safeKeyEquals(key, key.slice(0, -1)), false);
});

test('safeKeyEquals handles missing/undefined values without throwing', () => {
  assert.strictEqual(safeKeyEquals(undefined, undefined), true);
  assert.strictEqual(safeKeyEquals('abc', undefined), false);
  assert.strictEqual(safeKeyEquals(undefined, 'abc'), false);
});

test('generateSessionKey produces long, unique keys', () => {
  const a = generateSessionKey();
  const b = generateSessionKey();
  assert.notStrictEqual(a, b);
  assert.ok(a.length >= 32);
});
