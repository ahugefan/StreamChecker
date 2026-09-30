const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createConfig } = require('../src/config');
const { createTokenStore } = require('../src/token-store');

const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: s => Buffer.from('ENC:' + s, 'utf8'),
  decryptString: b => {
    const t = b.toString('utf8');
    if (!t.startsWith('ENC:')) throw new Error('bad data');
    return t.slice(4);
  }
};

function fakeFetch(responses) {
  const queue = [...responses];
  return async () => queue.shift();
}
function jsonRes(status, body) { return { ok: status >= 200 && status < 300, status, json: async () => body }; }

function setup({ now = () => 1_000_000, fetchFn = fakeFetch([]) } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tlc-token-test-'));
  const config = createConfig({ dir, safeStorage: fakeSafeStorage });
  config.updateSettings({ clientId: 'the-client-id' });
  const store = createTokenStore({
    config, getClientId: () => 'the-client-id', getClientSecret: () => 'the-secret',
    fetchFn, now
  });
  return { config, store };
}

test('save then getIdentity round-trips login/userId for the right role', () => {
  const { store } = setup();
  store.save('self', { accessToken: 'a1', refreshToken: 'r1', expiresIn: 14400, login: 'alpha_one', userId: '111' });
  assert.deepStrictEqual(store.getIdentity('self'), { login: 'alpha_one', userId: '111' });
  assert.strictEqual(store.getIdentity('bot'), null);
});

test('self and bot tokens are stored independently', () => {
  const { store } = setup();
  store.save('self', { accessToken: 'a1', refreshToken: 'r1', expiresIn: 14400, login: 'alpha_one', userId: '111' });
  store.save('bot', { accessToken: 'a2', refreshToken: 'r2', expiresIn: 14400, login: 'bot_two', userId: '222' });
  assert.strictEqual(store.hasToken('self'), true);
  assert.strictEqual(store.hasToken('bot'), true);
  assert.deepStrictEqual(store.getIdentity('bot'), { login: 'bot_two', userId: '222' });
});

test('secrets.json never contains the raw token strings in plain text', () => {
  const { config, store } = setup();
  store.save('self', { accessToken: 'super-secret-token', refreshToken: 'r1', expiresIn: 14400, login: 'a', userId: '1' });
  const raw = fs.readFileSync(path.join(config.dir, 'secrets.json'), 'utf8');
  assert.ok(!raw.includes('super-secret-token'));
});

test('getValidAccessToken returns the cached token when not near expiry', async () => {
  let t = 1_000_000;
  const { store } = setup({ now: () => t });
  store.save('self', { accessToken: 'a1', refreshToken: 'r1', expiresIn: 14400, login: 'a', userId: '1' });
  assert.strictEqual(await store.getValidAccessToken('self'), 'a1');
});

test('getValidAccessToken refreshes once the token is near expiry, and persists the new one', async () => {
  let t = 1_000_000;
  const fetchFn = fakeFetch([jsonRes(200, { access_token: 'a2', refresh_token: 'r2', expires_in: 14400 })]);
  const { store } = setup({ now: () => t, fetchFn });
  store.save('self', { accessToken: 'a1', refreshToken: 'r1', expiresIn: 100, login: 'a', userId: '1' }); // expires at 1,100,000
  t = 1_050_000; // inside the 60s safety margin
  assert.strictEqual(await store.getValidAccessToken('self'), 'a2');
  // and the refreshed token is what's cached now
  assert.strictEqual(await store.getValidAccessToken('self'), 'a2');
});

test('getValidAccessToken throws a clear error when nothing is saved for that role', async () => {
  const { store } = setup();
  await assert.rejects(store.getValidAccessToken('bot'), /No bot account login saved/);
});

test('clear removes the token for just that role', () => {
  const { store } = setup();
  store.save('self', { accessToken: 'a1', refreshToken: 'r1', expiresIn: 14400, login: 'a', userId: '1' });
  store.save('bot', { accessToken: 'a2', refreshToken: 'r2', expiresIn: 14400, login: 'b', userId: '2' });
  store.clear('self');
  assert.strictEqual(store.hasToken('self'), false);
  assert.strictEqual(store.hasToken('bot'), true);
});
