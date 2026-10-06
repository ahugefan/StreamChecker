// Tests for the custom alert sound (src/sound.js) and its settings rules (src/config.js).
// Written for Node's built-in test runner (node --test). If your project uses
// Jest or Vitest, the assertions translate directly.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { installSound, readCustomSound, removeCustomSounds, MAX_SOUND_BYTES } = require('../src/sound');
const { createConfig, DEFAULTS } = require('../src/config');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'lc-sound-')); }

// Minimal byte patterns that pass the format check.
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(200, 1)]);
const WAV = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(200, 1)]);
const OGG = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(200, 1)]);

function writeSource(name, bytes) {
  const file = path.join(tmpDir(), name);
  fs.writeFileSync(file, bytes);
  return file;
}

test('installs mp3, wav and ogg files as custom-sound.<ext>', () => {
  for (const [name, bytes, ext] of [['ding.mp3', MP3, '.mp3'], ['ding.WAV', WAV, '.wav'], ['ding.ogg', OGG, '.ogg']]) {
    const dir = tmpDir();
    const result = installSound({ sourcePath: writeSource(name, bytes), dir });
    assert.equal(result.soundFile, `custom-sound${ext}`);
    assert.equal(result.soundLabel, name);
    assert.deepEqual(fs.readFileSync(path.join(dir, result.soundFile)), bytes);
  }
});

test('the copy survives deleting the original file', () => {
  const dir = tmpDir();
  const source = writeSource('mine.mp3', MP3);
  const { soundFile } = installSound({ sourcePath: source, dir });
  fs.unlinkSync(source);
  const sound = readCustomSound({ dir, soundFile });
  assert.equal(sound.mime, 'audio/mpeg');
  assert.deepEqual(Buffer.from(sound.bytes), MP3);
});

test('rejects unsupported extensions', () => {
  assert.throws(() => installSound({ sourcePath: writeSource('song.flac', MP3), dir: tmpDir() }), /MP3, WAV or OGG/);
  assert.throws(() => installSound({ sourcePath: writeSource('virus.exe', MP3), dir: tmpDir() }), /MP3, WAV or OGG/);
});

test('rejects files that are too large or empty', () => {
  const big = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(MAX_SOUND_BYTES, 1)]);
  assert.throws(() => installSound({ sourcePath: writeSource('big.mp3', big), dir: tmpDir() }), /too large/);
  assert.throws(() => installSound({ sourcePath: writeSource('empty.mp3', Buffer.alloc(0)), dir: tmpDir() }), /empty/);
});

test('rejects renamed non-audio files', () => {
  assert.throws(() => installSound({ sourcePath: writeSource('fake.mp3', Buffer.from('MZ not audio at all')), dir: tmpDir() }), /valid MP3/);
  assert.throws(() => installSound({ sourcePath: writeSource('fake.wav', OGG), dir: tmpDir() }), /valid WAV/);
});

test('rejects a missing source file', () => {
  assert.throws(() => installSound({ sourcePath: path.join(tmpDir(), 'nope.mp3'), dir: tmpDir() }), /could not be opened/);
});

test('choosing a new sound replaces the old one, even with a different extension', () => {
  const dir = tmpDir();
  installSound({ sourcePath: writeSource('a.mp3', MP3), dir });
  installSound({ sourcePath: writeSource('b.wav', WAV), dir });
  const files = fs.readdirSync(dir).sort();
  assert.deepEqual(files, ['custom-sound.wav']);
});

test('removeCustomSounds clears the sound and any leftover temp file', () => {
  const dir = tmpDir();
  installSound({ sourcePath: writeSource('a.ogg', OGG), dir });
  fs.writeFileSync(path.join(dir, 'custom-sound.ogg.tmp'), 'x');
  fs.writeFileSync(path.join(dir, 'settings.json'), '{}');
  removeCustomSounds(dir);
  assert.deepEqual(fs.readdirSync(dir), ['settings.json']);
});

test('readCustomSound returns null for empty, missing, or path-traversal names', () => {
  const dir = tmpDir();
  assert.equal(readCustomSound({ dir, soundFile: '' }), null);
  assert.equal(readCustomSound({ dir, soundFile: 'custom-sound.mp3' }), null); // not installed
  assert.equal(readCustomSound({ dir, soundFile: '../settings.json' }), null);
  assert.equal(readCustomSound({ dir, soundFile: '..\\secrets.json' }), null);
  assert.equal(readCustomSound({ dir, soundFile: 'custom-sound.mp3/../../x' }), null);
});

// --- settings rules ---

function makeConfig() {
  return createConfig({ dir: tmpDir(), safeStorage: { isEncryptionAvailable: () => true } });
}

test('sound settings have safe defaults (built-in chime, full volume)', () => {
  assert.equal(DEFAULTS.soundFile, '');
  assert.equal(DEFAULTS.soundLabel, '');
  assert.equal(DEFAULTS.soundVolume, 100);
  const s = makeConfig().getSettings();
  assert.equal(s.soundFile, '');
  assert.equal(s.soundVolume, 100);
});

test('soundFile only accepts empty or a custom-sound file name', () => {
  const cfg = makeConfig();
  assert.equal(cfg.updateSettings({ soundFile: 'custom-sound.mp3' }).soundFile, 'custom-sound.mp3');
  assert.equal(cfg.updateSettings({ soundFile: '' }).soundFile, '');
  for (const bad of ['../secrets.json', 'C:\\Windows\\win.ini', 'custom-sound.exe', 'live.mp3', 42, null]) {
    assert.throws(() => cfg.updateSettings({ soundFile: bad }), /soundFile/);
  }
});

test('soundVolume accepts whole numbers 0-100 only', () => {
  const cfg = makeConfig();
  assert.equal(cfg.updateSettings({ soundVolume: 0 }).soundVolume, 0);
  assert.equal(cfg.updateSettings({ soundVolume: 55 }).soundVolume, 55);
  for (const bad of [-1, 101, 12.5, 'loud', NaN]) {
    assert.throws(() => cfg.updateSettings({ soundVolume: bad }), /soundVolume/);
  }
});

test('soundLabel is trimmed, stripped of control characters, and length-limited', () => {
  const cfg = makeConfig();
  assert.equal(cfg.updateSettings({ soundLabel: '  my\nsound.mp3 ' }).soundLabel, 'mysound.mp3');
  assert.equal(cfg.updateSettings({ soundLabel: 'x'.repeat(200) }).soundLabel.length, 80);
  assert.throws(() => cfg.updateSettings({ soundLabel: 5 }), /soundLabel/);
});

test('existing settings files without sound keys load with the defaults', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ refreshMinutes: 10, soundEnabled: false }));
  const s = createConfig({ dir, safeStorage: { isEncryptionAvailable: () => true } }).getSettings();
  assert.equal(s.refreshMinutes, 10);
  assert.equal(s.soundEnabled, false);
  assert.equal(s.soundFile, '');
  assert.equal(s.soundVolume, 100);
});

test('full flow: choose -> saved in settings -> readable for playback -> reset', () => {
  const dir = tmpDir();
  const cfg = createConfig({ dir, safeStorage: { isEncryptionAvailable: () => true } });

  // what the "choose-sound-file" handler does
  const installed = installSound({ sourcePath: writeSource('alert.mp3', MP3), dir: cfg.dir });
  const saved = cfg.updateSettings(installed);
  assert.equal(saved.soundFile, 'custom-sound.mp3');
  assert.equal(saved.soundLabel, 'alert.mp3');

  // what the "get-custom-sound" handler does
  const sound = readCustomSound({ dir: cfg.dir, soundFile: cfg.getSettings().soundFile });
  assert.equal(sound.mime, 'audio/mpeg');

  // what the "reset-sound" handler does
  removeCustomSounds(cfg.dir);
  cfg.updateSettings({ soundFile: '', soundLabel: '' });
  assert.equal(readCustomSound({ dir: cfg.dir, soundFile: cfg.getSettings().soundFile }), null);
  assert.equal(fs.readdirSync(cfg.dir).filter(f => f.startsWith('custom-sound')).length, 0);
});

test('a missing custom file (deleted by hand) simply reads as "no custom sound"', () => {
  const dir = tmpDir();
  const cfg = createConfig({ dir, safeStorage: { isEncryptionAvailable: () => true } });
  cfg.updateSettings({ soundFile: 'custom-sound.wav' });
  assert.equal(readCustomSound({ dir: cfg.dir, soundFile: cfg.getSettings().soundFile }), null);
});
