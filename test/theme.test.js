// Tests for the accent-color theme (public/theme.js) and its setting (src/config.js).
// Run with: node --test

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Theme = require('../public/theme.js');
const { createConfig, DEFAULTS } = require('../src/config');

function makeConfig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-theme-'));
  return createConfig({ dir, safeStorage: { isEncryptionAvailable: () => true } });
}

test('contrast math: black on white is 21, identical colors are 1', () => {
  assert.equal(Math.round(Theme.contrast('#000000', '#ffffff')), 21);
  assert.equal(Theme.contrast('#9146ff', '#9146ff'), 1);
});

test('the default purple keeps today\'s look: white button text, unchanged heading color', () => {
  assert.equal(Theme.DEFAULT_ACCENT, '#9146ff');
  for (const light of [false, true]) {
    const v = Theme.vars('#9146ff', light);
    assert.equal(v['--accent'], '#9146ff');
    assert.equal(v['--accent-rgb'], '145 70 255');
    assert.equal(v['--on-accent'], '#ffffff');
    assert.equal(v['--accent-text'], '#9146ff');
  }
});

test('light accents get dark button text, dark accents get white', () => {
  assert.equal(Theme.onAccent('#ffee00'), '#111111');
  assert.equal(Theme.onAccent('#f97316'), '#111111');
  assert.equal(Theme.onAccent('#3b82f6'), '#ffffff');
  assert.equal(Theme.onAccent('#1e1b4b'), '#ffffff');
});

test('accent used as text is lightened on dark surfaces and darkened on light ones, only when needed', () => {
  const dark = Theme.SURFACES.dark, light = Theme.SURFACES.light;
  const dim = Theme.readableOn('#101040', dark);
  assert.notEqual(dim, '#101040');
  assert.ok(Theme.contrast(dim, dark) >= 3);
  const pale = Theme.readableOn('#ffee00', light);
  assert.notEqual(pale, '#ffee00');
  assert.ok(Theme.contrast(pale, light) >= 3);
  assert.equal(Theme.readableOn('#9146ff', dark), '#9146ff'); // already readable: untouched
});

test('colors that vanish into the background are rejected, per mode', () => {
  assert.equal(Theme.isVisible('#000000', false), false);   // black on the dark panel
  assert.equal(Theme.isVisible('#ffffff', true), false);    // white on the light panel
  assert.equal(Theme.isVisible('#ffffff', false), true);
  assert.equal(Theme.isVisible('#000000', true), true);
  assert.equal(Theme.isVisible('not-a-color', false), false);
});

test('every preset is a valid color that is visible and readable in both modes', () => {
  assert.ok(Theme.PRESETS.length >= 5);
  assert.equal(Theme.PRESETS[0].color, Theme.DEFAULT_ACCENT);
  for (const { name, color } of Theme.PRESETS) {
    assert.ok(name && Theme.hexToRgb(color), name);
    for (const light of [false, true]) {
      assert.ok(Theme.isVisible(color, light), `${name} visible (light=${light})`);
      const v = Theme.vars(color, light);
      const surface = light ? Theme.SURFACES.light : Theme.SURFACES.dark;
      assert.ok(Theme.contrast(v['--accent-text'], surface) >= 3, `${name} text (light=${light})`);
      assert.ok(Theme.contrast(v['--on-accent'], color) >= 3, `${name} button text`);
    }
  }
});

test('vars() falls back to the default accent for invalid input', () => {
  assert.equal(Theme.vars('banana', false)['--accent'], '#9146ff');
  assert.equal(Theme.vars('#ABCDEF', false)['--accent'], '#abcdef');
});

// --- settings rule ---

test('accentColor defaults to the Twitch purple and saves lowercase #rrggbb', () => {
  assert.equal(DEFAULTS.accentColor, '#9146ff');
  const cfg = makeConfig();
  assert.equal(cfg.getSettings().accentColor, '#9146ff');
  assert.equal(cfg.updateSettings({ accentColor: '#3B82F6' }).accentColor, '#3b82f6');
  assert.equal(cfg.getSettings().accentColor, '#3b82f6');
});

test('accentColor rejects anything that is not a 6-digit hex color', () => {
  const cfg = makeConfig();
  for (const bad of ['red', '#fff', '9146ff', '#9146ff; background:url(x)', 'url(javascript:1)', '', 5, null]) {
    assert.throws(() => cfg.updateSettings({ accentColor: bad }), /accentColor/);
  }
});

test('older settings files without accentColor load with the default', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-theme-'));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ lightTheme: true }));
  const s = createConfig({ dir, safeStorage: { isEncryptionAvailable: () => true } }).getSettings();
  assert.equal(s.lightTheme, true);
  assert.equal(s.accentColor, '#9146ff');
});
