const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createConfig, DEFAULTS } = require('../src/config');

const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s, 'utf8'),
  decryptString: (b) => b.toString('utf8')
};

function makeConfig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-alert-settings-'));
  const config = createConfig({ dir, safeStorage: fakeSafeStorage });
  return { config, dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function withConfig(fn) {
  const ctx = makeConfig();
  try { return fn(ctx); } finally { ctx.cleanup(); }
}

test('chat alert defaults: off, 3 min quiet, 5 s cooldown, empty ignore list, default hotkey', () => {
  withConfig(({ config }) => {
    const s = config.getSettings();
    assert.equal(s.chatAlertEnabled, false);
    assert.equal(s.chatAlertQuietMinutes, 3);
    assert.equal(s.chatAlertCooldownSeconds, 5);
    assert.deepEqual(s.chatAlertIgnore, []);
    assert.equal(s.chatAlertHotkey, 'CommandOrControl+Alt+C');
    assert.equal(s.chatSoundFile, '');
    assert.equal(s.chatSoundLabel, '');
    assert.equal(s.chatSoundVolume, 100);
  });
});

test('the shipped defaults contain no personal data', () => {
  assert.deepEqual(DEFAULTS.chatAlertIgnore, []);
  assert.equal(DEFAULTS.channelLogin, '');
});

test('chat alert settings save and survive a restart', () => {
  withConfig(({ config, dir }) => {
    config.updateSettings({
      chatAlertEnabled: true,
      chatAlertQuietMinutes: 10,
      chatAlertCooldownSeconds: 30,
      chatAlertIgnore: ['nightbot', 'streamelements'],
      chatAlertHotkey: 'Ctrl+Shift+F9',
      chatSoundVolume: 40
    });
    const reopened = createConfig({ dir, safeStorage: fakeSafeStorage }).getSettings();
    assert.equal(reopened.chatAlertEnabled, true);
    assert.equal(reopened.chatAlertQuietMinutes, 10);
    assert.equal(reopened.chatAlertCooldownSeconds, 30);
    assert.deepEqual(reopened.chatAlertIgnore, ['nightbot', 'streamelements']);
    assert.equal(reopened.chatAlertHotkey, 'Ctrl+Shift+F9');
    assert.equal(reopened.chatSoundVolume, 40);
  });
});

test('chatAlertEnabled must be true or false', () => {
  withConfig(({ config }) => {
    assert.throws(() => config.updateSettings({ chatAlertEnabled: 'yes' }), /true or false/);
    assert.throws(() => config.updateSettings({ chatAlertEnabled: 1 }), /true or false/);
  });
});

test('quiet minutes accepts 0 to 120 whole numbers only', () => {
  withConfig(({ config }) => {
    for (const ok of [0, 1, 3, 120, '15']) {
      assert.doesNotThrow(() => config.updateSettings({ chatAlertQuietMinutes: ok }), String(ok));
    }
    for (const bad of [-1, 121, 2.5, 'abc', '', null, NaN]) {
      assert.throws(() => config.updateSettings({ chatAlertQuietMinutes: bad }), /whole number from 0 to 120/, String(bad));
    }
    assert.equal(config.getSettings().chatAlertQuietMinutes, 15);
  });
});

test('cooldown accepts 0 to 600 whole numbers only', () => {
  withConfig(({ config }) => {
    for (const ok of [0, 5, 600]) {
      assert.doesNotThrow(() => config.updateSettings({ chatAlertCooldownSeconds: ok }), String(ok));
    }
    for (const bad of [-5, 601, 1.5, 'x', '', null]) {
      assert.throws(() => config.updateSettings({ chatAlertCooldownSeconds: bad }), /whole number from 0 to 600/, String(bad));
    }
  });
});

test('ignore list is cleaned: lower-cased and de-duplicated, only valid usernames kept', () => {
  withConfig(({ config }) => {
    const saved = config.updateSettings({
      chatAlertIgnore: ['NightBot', 'nightbot', 'StreamElements', '###', 'bad name!!']
    });
    const list = saved.chatAlertIgnore;
    assert.deepEqual(list.slice(0, 2), ['nightbot', 'streamelements']);
    assert.equal(new Set(list).size, list.length, 'no duplicates');
    assert.ok(list.every(name => /^[a-z0-9_]{1,25}$/.test(name)), 'only valid usernames are kept');
    assert.ok(!list.includes('###'));
  });
});

test('ignore list must be a list and has a size limit', () => {
  withConfig(({ config }) => {
    assert.throws(() => config.updateSettings({ chatAlertIgnore: 'nightbot' }), /must be a list/);
    const tooMany = Array.from({ length: 201 }, (_v, i) => `chatter_${String(i).padStart(4, '0')}`);
    assert.throws(() => config.updateSettings({ chatAlertIgnore: tooMany }), /at most 200/);
    const exactly = tooMany.slice(0, 200);
    assert.equal(config.updateSettings({ chatAlertIgnore: exactly }).chatAlertIgnore.length, 200);
  });
});

test('hotkey accepts valid Electron shortcuts', () => {
  withConfig(({ config }) => {
    for (const ok of [
      'CommandOrControl+Alt+C', 'Ctrl+Alt+C', 'ctrl+alt+c', 'Alt+F9', 'Control+Shift+F12',
      'Ctrl+Space', 'Alt+Up', 'Ctrl+Alt+1', 'Ctrl+Alt+Plus', 'Super+Alt+N'
    ]) {
      assert.equal(config.updateSettings({ chatAlertHotkey: ok }).chatAlertHotkey, ok, ok);
    }
  });
});

test('an empty hotkey means no shortcut', () => {
  withConfig(({ config }) => {
    assert.equal(config.updateSettings({ chatAlertHotkey: '' }).chatAlertHotkey, '');
    assert.equal(config.updateSettings({ chatAlertHotkey: '   ' }).chatAlertHotkey, '');
  });
});

test('hotkey rejects shortcuts that would hijack normal typing or are malformed', () => {
  withConfig(({ config }) => {
    for (const bad of [
      'C',                 // bare key
      'Shift+C',           // Shift alone is still ordinary typing
      'Ctrl+',             // no key
      '+C',                // no modifier
      'Ctrl+Alt',          // modifiers only (Alt is not a key)
      'Ctrl+Ctrl+C',       // duplicate modifier
      'Banana+C',          // unknown modifier
      'Ctrl+Alt+Banana',   // unknown key
      'Ctrl+Alt+F25',      // no such function key
      'Ctrl+Alt+CC',       // two characters
      'Ctrl + Alt + C'     // spaces
    ]) {
      assert.throws(() => config.updateSettings({ chatAlertHotkey: bad }), /shortcut/, bad);
    }
    assert.throws(() => config.updateSettings({ chatAlertHotkey: 42 }), /must be text/);
    assert.throws(() => config.updateSettings({ chatAlertHotkey: null }), /must be text/);
  });
});

test('chat sound file only accepts the fixed custom-chat-sound names', () => {
  withConfig(({ config }) => {
    for (const ok of ['', 'custom-chat-sound.mp3', 'custom-chat-sound.wav', 'custom-chat-sound.ogg']) {
      assert.equal(config.updateSettings({ chatSoundFile: ok }).chatSoundFile, ok);
    }
    for (const bad of ['custom-sound.mp3', '../custom-chat-sound.mp3', 'C:\\x\\ding.mp3',
                       'custom-chat-sound.exe', 'custom-chat-sound.mp3.tmp', null, 5]) {
      assert.throws(() => config.updateSettings({ chatSoundFile: bad }), /custom-chat-sound/, String(bad));
    }
  });
});

test('the live sound file setting does not accept the chat sound name and vice versa', () => {
  withConfig(({ config }) => {
    assert.throws(() => config.updateSettings({ soundFile: 'custom-chat-sound.mp3' }), /custom-sound/);
    assert.throws(() => config.updateSettings({ chatSoundFile: 'custom-sound.mp3' }), /custom-chat-sound/);
  });
});

test('chat sound label is cleaned like the live sound label', () => {
  withConfig(({ config }) => {
    const saved = config.updateSettings({ chatSoundLabel: '  ding\u0007\u0000.mp3  ' });
    assert.equal(saved.chatSoundLabel, 'ding.mp3');
    assert.equal(config.updateSettings({ chatSoundLabel: 'x'.repeat(200) }).chatSoundLabel.length, 80);
    assert.throws(() => config.updateSettings({ chatSoundLabel: 5 }), /must be text/);
  });
});

test('chat sound volume accepts 0 to 100 whole numbers only', () => {
  withConfig(({ config }) => {
    for (const ok of [0, 50, 100]) assert.doesNotThrow(() => config.updateSettings({ chatSoundVolume: ok }));
    for (const bad of [-1, 101, 5.5, 'loud']) {
      assert.throws(() => config.updateSettings({ chatSoundVolume: bad }), /0 to 100/, String(bad));
    }
  });
});

test('a damaged settings file falls back to safe chat defaults instead of crashing', () => {
  withConfig(({ config, dir }) => {
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
      chatAlertEnabled: 'maybe',
      chatAlertQuietMinutes: -4,
      chatAlertCooldownSeconds: 'soon',
      chatAlertIgnore: 'nightbot',
      chatAlertHotkey: 'Shift+C',
      chatSoundFile: '../../evil.mp3',
      chatSoundVolume: 900,
      chatAlertQuietMinutesUnknown: 1
    }));
    const s = config.getSettings();
    assert.equal(s.chatAlertEnabled, false);
    assert.equal(s.chatAlertQuietMinutes, 3);
    assert.equal(s.chatAlertCooldownSeconds, 5);
    assert.deepEqual(s.chatAlertIgnore, []);
    assert.equal(s.chatAlertHotkey, 'CommandOrControl+Alt+C');
    assert.equal(s.chatSoundFile, '');
    assert.equal(s.chatSoundVolume, 100);
  });
});

test('one bad chat value in a patch changes nothing', () => {
  withConfig(({ config }) => {
    config.updateSettings({ chatAlertQuietMinutes: 7 });
    assert.throws(() => config.updateSettings({ chatAlertQuietMinutes: 9, chatAlertHotkey: 'C' }));
    assert.equal(config.getSettings().chatAlertQuietMinutes, 7);
  });
});

test('unknown settings are still rejected', () => {
  withConfig(({ config }) => {
    assert.throws(() => config.updateSettings({ chatAlertSomethingElse: true }), /Unknown setting/);
  });
});

test('existing settings are untouched by the new ones', () => {
  withConfig(({ config }) => {
    config.updateSettings({ soundVolume: 30, soundEnabled: false, overlaySpeed: 'fast' });
    config.updateSettings({ chatAlertEnabled: true, chatSoundVolume: 80 });
    const s = config.getSettings();
    assert.equal(s.soundVolume, 30);
    assert.equal(s.soundEnabled, false);
    assert.equal(s.overlaySpeed, 'fast');
  });
});
