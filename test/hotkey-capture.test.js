const test = require('node:test');
const assert = require('node:assert/strict');
const { fromKeyEvent, displayName } = require('../public/hotkey-capture');
const { createConfig } = require('../src/config');
const fs = require('fs');
const os = require('os');
const path = require('path');

const press = (code, mods = {}) => fromKeyEvent({
  code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods
});

test('Ctrl+Alt+letter builds a shortcut', () => {
  assert.deepEqual(press('KeyC', { ctrlKey: true, altKey: true }), { accelerator: 'Ctrl+Alt+C' });
});

test('modifiers always come out in the same order', () => {
  assert.deepEqual(press('KeyN', { metaKey: true, shiftKey: true, altKey: true, ctrlKey: true }),
    { accelerator: 'Ctrl+Alt+Shift+Super+N' });
});

test('digits, function keys and named keys work', () => {
  assert.equal(press('Digit5', { ctrlKey: true }).accelerator, 'Ctrl+5');
  assert.equal(press('F9', { altKey: true }).accelerator, 'Alt+F9');
  assert.equal(press('F24', { altKey: true }).accelerator, 'Alt+F24');
  assert.equal(press('Space', { ctrlKey: true }).accelerator, 'Ctrl+Space');
  assert.equal(press('ArrowUp', { ctrlKey: true }).accelerator, 'Ctrl+Up');
  assert.equal(press('PageDown', { altKey: true }).accelerator, 'Alt+PageDown');
  assert.equal(press('NumpadEnter', { ctrlKey: true }).accelerator, 'Ctrl+Enter');
});

test('pressing only a modifier keeps waiting', () => {
  for (const code of ['ControlLeft', 'ControlRight', 'AltLeft', 'ShiftLeft', 'MetaLeft', 'MetaRight']) {
    assert.equal(press(code, { ctrlKey: true }), null, code);
  }
  assert.equal(fromKeyEvent({}), null);
  assert.equal(fromKeyEvent(null), null);
});

test('Escape cancels', () => {
  assert.deepEqual(press('Escape'), { cancel: true });
  assert.deepEqual(press('Escape', { ctrlKey: true }), { cancel: true });
});

test('a bare key or Shift plus a key is turned away with a clear message', () => {
  assert.match(press('KeyC').error, /Ctrl, Alt or the Windows key/);
  assert.match(press('KeyC', { shiftKey: true }).error, /Ctrl, Alt or the Windows key/);
});

test('keys that cannot be used are turned away', () => {
  for (const code of ['F25', 'Numpad5', 'BracketLeft', 'ContextMenu', 'MediaPlayPause', 'F0']) {
    assert.match(press(code, { ctrlKey: true }).error, /cannot be used/, code);
  }
});

test('displayName shows friendly key names', () => {
  assert.equal(displayName('CommandOrControl+Alt+C'), 'Ctrl+Alt+C');
  assert.equal(displayName('Control+Shift+F9'), 'Ctrl+Shift+F9');
  assert.equal(displayName('Super+Alt+N'), 'Win+Alt+N');
  assert.equal(displayName(''), '');
  assert.equal(displayName(undefined), '');
});

test('every shortcut the capture field can produce is accepted by the settings', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotkey-capture-'));
  try {
    const config = createConfig({
      dir,
      safeStorage: { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() }
    });
    const codes = ['KeyA', 'KeyZ', 'Digit0', 'Digit9', 'F1', 'F12', 'F24', 'Space', 'Tab', 'Backspace', 'Delete',
      'Insert', 'Enter', 'Home', 'End', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    const modSets = [
      { ctrlKey: true }, { altKey: true }, { metaKey: true },
      { ctrlKey: true, altKey: true }, { ctrlKey: true, shiftKey: true }, { ctrlKey: true, altKey: true, shiftKey: true, metaKey: true }
    ];
    for (const code of codes) {
      for (const mods of modSets) {
        const { accelerator } = press(code, mods);
        assert.equal(config.updateSettings({ chatAlertHotkey: accelerator }).chatAlertHotkey, accelerator, accelerator);
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
