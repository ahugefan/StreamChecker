const test = require('node:test');
const assert = require('node:assert/strict');
const { createAlertPlayer, formatAgo } = require('../public/alert-player');

const DEFAULT = 'chat-chime.wav';

function setup({ volume = 100, custom = null } = {}) {
  const played = [];
  const revoked = [];
  const volumes = [];
  let failUrls = new Set();
  let nextBlob = 0;

  class FakeAudio {
    constructor(url) { this.url = url; this.volume = 1; this.currentTime = 0; }
    async play() {
      if (failUrls.has(this.url)) throw new Error('cannot play');
      played.push(this.url);
      volumes.push(this.volume);
    }
  }

  const state = { volume, custom };
  const player = createAlertPlayer({
    defaultUrl: DEFAULT,
    getVolume: () => state.volume,
    getCustom: async () => {
      if (state.custom instanceof Error) throw state.custom;
      return state.custom;
    },
    makeUrl: () => `blob:custom-${++nextBlob}`,
    revokeUrl: (url) => revoked.push(url),
    AudioImpl: FakeAudio
  });
  return { player, played, revoked, volumes, state, failUrl: (u) => failUrls.add(u) };
}

const CUSTOM = { mime: 'audio/wav', bytes: new Uint8Array([1, 2, 3]) };

test('plays the built-in sound by default', async () => {
  const t = setup();
  assert.equal(await t.player.play(), 'ok');
  assert.deepEqual(t.played, [DEFAULT]);
  assert.equal(t.player.isCustom(), false);
});

test('uses the saved volume and keeps it between 0 and 1', async () => {
  const t = setup({ volume: 40 });
  await t.player.play();
  t.state.volume = 150;
  await t.player.play();
  t.state.volume = -20;
  await t.player.play();
  t.state.volume = 'loud';
  await t.player.play();
  assert.deepEqual(t.volumes, [0.4, 1, 0, 1]);
});

test('loads and plays the custom sound', async () => {
  const t = setup({ custom: CUSTOM });
  await t.player.load(true);
  assert.equal(t.player.isCustom(), true);
  assert.equal(await t.player.play(), 'ok');
  assert.deepEqual(t.played, ['blob:custom-1']);
});

test('load(false) goes back to the built-in sound and frees the custom one', async () => {
  const t = setup({ custom: CUSTOM });
  await t.player.load(true);
  await t.player.load(false);
  assert.equal(t.player.isCustom(), false);
  assert.deepEqual(t.revoked, ['blob:custom-1']);
  await t.player.play();
  assert.deepEqual(t.played, [DEFAULT]);
});

test('loading a new custom sound frees the old one', async () => {
  const t = setup({ custom: CUSTOM });
  await t.player.load(true);
  await t.player.load(true);
  assert.deepEqual(t.revoked, ['blob:custom-1']);
  await t.player.play();
  assert.deepEqual(t.played, ['blob:custom-2']);
});

test('a custom sound that is missing falls back to the built-in sound', async () => {
  const t = setup({ custom: null });
  await t.player.load(true);
  assert.equal(t.player.isCustom(), false);
  assert.equal(await t.player.play(), 'ok');
  assert.deepEqual(t.played, [DEFAULT]);
});

test('a custom sound that cannot be read falls back to the built-in sound', async () => {
  const t = setup({ custom: new Error('disk error') });
  await assert.doesNotReject(() => t.player.load(true));
  assert.equal(t.player.isCustom(), false);
});

test('a custom sound that cannot be played falls back, and stays on the built-in sound', async () => {
  const t = setup({ custom: CUSTOM });
  await t.player.load(true);
  t.failUrl('blob:custom-1');
  assert.equal(await t.player.play(), 'fallback');
  assert.deepEqual(t.played, [DEFAULT]);
  assert.equal(t.player.isCustom(), false);
  assert.deepEqual(t.revoked, ['blob:custom-1']);
  assert.equal(await t.player.play(), 'ok');
});

test('reports failure when even the built-in sound cannot play', async () => {
  const t = setup();
  t.failUrl(DEFAULT);
  assert.equal(await t.player.play(), 'failed');
});

test('reports failure when both the custom and the built-in sound fail', async () => {
  const t = setup({ custom: CUSTOM });
  await t.player.load(true);
  t.failUrl('blob:custom-1');
  t.failUrl(DEFAULT);
  assert.equal(await t.player.play(), 'failed');
});

test('formatAgo gives short readable times', () => {
  assert.equal(formatAgo(0), 'just now');
  assert.equal(formatAgo(9_999), 'just now');
  assert.equal(formatAgo(10_000), '10 sec ago');
  assert.equal(formatAgo(59_999), '59 sec ago');
  assert.equal(formatAgo(60_000), '1 min ago');
  assert.equal(formatAgo(5 * 60_000 + 30_000), '5 min ago');
  assert.equal(formatAgo(59 * 60_000), '59 min ago');
  assert.equal(formatAgo(60 * 60_000), '1 h ago');
  assert.equal(formatAgo(23 * 3_600_000), '23 h ago');
  assert.equal(formatAgo(24 * 3_600_000), '1 d ago');
  assert.equal(formatAgo(3 * 86_400_000), '3 d ago');
});

test('formatAgo copes with odd input', () => {
  assert.equal(formatAgo(-5000), 'just now');
  assert.equal(formatAgo(null), '');
  assert.equal(formatAgo(undefined), '');
  assert.equal(formatAgo(NaN), '');
  assert.equal(formatAgo('5'), '');
});
