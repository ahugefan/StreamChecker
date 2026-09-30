const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createConfig, DEFAULTS } = require('../src/config');

// Stand-in for Electron's safeStorage: reversible "encryption" good enough to test.
const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: s => Buffer.from('ENC:' + s, 'utf8'),
  decryptString: b => {
    const t = b.toString('utf8');
    if (!t.startsWith('ENC:')) throw new Error('bad data');
    return t.slice(4);
  }
};

function freshConfig(safeStorage = fakeSafeStorage) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tlc-test-'));
  return { dir, cfg: createConfig({ dir, safeStorage }) };
}

test('first run returns defaults with an empty streamer list', () => {
  const { cfg } = freshConfig();
  const s = cfg.getSettings();
  assert.deepStrictEqual(s, { ...DEFAULTS });
  assert.deepStrictEqual(s.streamers, []);
  assert.strictEqual(s.showOffline, true);
});

test('updates persist across a fresh load', () => {
  const { dir, cfg } = freshConfig();
  cfg.updateSettings({ showOffline: false, refreshMinutes: 10, lightTheme: true });
  const reloaded = createConfig({ dir, safeStorage: fakeSafeStorage }).getSettings();
  assert.strictEqual(reloaded.showOffline, false);
  assert.strictEqual(reloaded.refreshMinutes, 10);
  assert.strictEqual(reloaded.lightTheme, true);
});

test('streamer and VIP lists are cleaned through the parser', () => {
  const { cfg } = freshConfig();
  const s = cfg.updateSettings({
    streamers: ['Alpha_One', 'twitch.tv/beta_two', 'alpha_one', 'no!way'],
    vips: ['ALPHA_ONE']
  });
  assert.deepStrictEqual(s.streamers, ['alpha_one', 'beta_two']);
  assert.deepStrictEqual(s.vips, ['alpha_one']);
});

test('rejects unknown settings and invalid values', () => {
  const { cfg } = freshConfig();
  assert.throws(() => cfg.updateSettings({ nope: 1 }), /Unknown setting/);
  assert.throws(() => cfg.updateSettings({ refreshMinutes: 7 }), /refreshMinutes/);
  assert.throws(() => cfg.updateSettings({ showOffline: 'yes' }), /true or false/);
  assert.throws(() => cfg.updateSettings({ shoutoutTemplate: 'no placeholder' }), /\{username\}/);
  assert.throws(() => cfg.updateSettings({ channelLogin: 'two names' }), /one Twitch username/);
});

test('custom shoutout template is accepted', () => {
  const { cfg } = freshConfig();
  const s = cfg.updateSettings({ shoutoutTemplate: '  Go follow {username}!  ' });
  assert.strictEqual(s.shoutoutTemplate, 'Go follow {username}!');
});

test('secrets are stored encrypted, never as plain text', () => {
  const { dir, cfg } = freshConfig();
  cfg.setSecret('clientSecret', 'super-secret-value');
  const raw = fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8');
  assert.ok(!raw.includes('super-secret-value'));
  assert.strictEqual(cfg.getSecret('clientSecret'), 'super-secret-value');
  assert.strictEqual(cfg.hasSecret('clientSecret'), true);
});

test('secrets never leak into settings.json', () => {
  const { dir, cfg } = freshConfig();
  cfg.setSecret('selfToken', 'tok-123');
  cfg.updateSettings({ clientId: 'public-id' });
  const raw = fs.readFileSync(path.join(dir, 'settings.json'), 'utf8');
  assert.ok(!raw.includes('tok-123'));
});

test('refuses to save a secret when secure storage is unavailable', () => {
  const { dir, cfg } = freshConfig({ ...fakeSafeStorage, isEncryptionAvailable: () => false });
  assert.throws(() => cfg.setSecret('clientSecret', 'x'), /not available/);
  assert.ok(!fs.existsSync(path.join(dir, 'secrets.json')));
});

test('clearing a secret and clearSecrets both work', () => {
  const { cfg } = freshConfig();
  cfg.setSecret('clientSecret', 'a');
  cfg.setSecret('selfToken', 'b');
  cfg.setSecret('clientSecret', null);
  assert.strictEqual(cfg.getSecret('clientSecret'), null);
  assert.strictEqual(cfg.getSecret('selfToken'), 'b');
  cfg.clearSecrets();
  assert.strictEqual(cfg.getSecret('selfToken'), null);
});

test('secret that cannot be decrypted returns null instead of crashing', () => {
  const { dir, cfg } = freshConfig();
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ clientSecret: Buffer.from('garbage').toString('base64') }));
  assert.strictEqual(cfg.getSecret('clientSecret'), null);
});

test('a corrupted settings file is set aside and defaults are used', () => {
  const { dir, cfg } = freshConfig();
  fs.writeFileSync(path.join(dir, 'settings.json'), '{ not valid json');
  const s = cfg.getSettings();
  assert.deepStrictEqual(s, { ...DEFAULTS });
  assert.ok(fs.readdirSync(dir).some(f => f.startsWith('settings.json.corrupt-')));
});

test('invalid values already on disk fall back to defaults per setting', () => {
  const { dir, cfg } = freshConfig();
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ refreshMinutes: 999, lightTheme: true }));
  const s = cfg.getSettings();
  assert.strictEqual(s.refreshMinutes, DEFAULTS.refreshMinutes);
  assert.strictEqual(s.lightTheme, true);
});

test('unknown secret names are rejected', () => {
  const { cfg } = freshConfig();
  assert.throws(() => cfg.setSecret('other', 'x'), /Unknown secret/);
  assert.throws(() => cfg.getSecret('other'), /Unknown secret/);
});
