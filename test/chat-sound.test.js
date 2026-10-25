const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  installSound, readCustomSound, removeCustomSounds, CUSTOM_PATTERN,
  installChatSound, readCustomChatSound, removeCustomChatSounds, CHAT_CUSTOM_PATTERN,
  MAX_SOUND_BYTES
} = require('../src/sound');

const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64, 1)]);
const WAV = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(32)]);
const OGG = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(32, 2)]);

function withDirs(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-sound-'));
  const dir = path.join(root, 'config');
  const src = path.join(root, 'source');
  fs.mkdirSync(src);
  const write = (name, bytes) => { const p = path.join(src, name); fs.writeFileSync(p, bytes); return p; };
  try { return fn({ dir, write }); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('installChatSound copies the file under the fixed chat name and reports it', () => {
  withDirs(({ dir, write }) => {
    const result = installChatSound({ sourcePath: write('My Ding.mp3', MP3), dir });
    assert.deepEqual(result, { soundFile: 'custom-chat-sound.mp3', soundLabel: 'My Ding.mp3' });
    assert.deepEqual(fs.readFileSync(path.join(dir, 'custom-chat-sound.mp3')), MP3);
  });
});

test('readCustomChatSound returns the bytes and the right type for each format', () => {
  withDirs(({ dir, write }) => {
    for (const [name, bytes, mime] of [
      ['a.mp3', MP3, 'audio/mpeg'], ['a.wav', WAV, 'audio/wav'], ['a.ogg', OGG, 'audio/ogg']
    ]) {
      const { soundFile } = installChatSound({ sourcePath: write(name, bytes), dir });
      const read = readCustomChatSound({ dir, soundFile });
      assert.equal(read.mime, mime);
      assert.deepEqual(read.bytes, bytes);
    }
  });
});

test('installing a new chat sound replaces the old one, whatever its format', () => {
  withDirs(({ dir, write }) => {
    installChatSound({ sourcePath: write('a.mp3', MP3), dir });
    installChatSound({ sourcePath: write('b.wav', WAV), dir });
    const files = fs.readdirSync(dir).sort();
    assert.deepEqual(files, ['custom-chat-sound.wav']);
  });
});

test('the chat sound and the live sound are fully independent', () => {
  withDirs(({ dir, write }) => {
    installSound({ sourcePath: write('live.mp3', MP3), dir });
    installChatSound({ sourcePath: write('chat.wav', WAV), dir });
    assert.deepEqual(fs.readdirSync(dir).sort(), ['custom-chat-sound.wav', 'custom-sound.mp3']);

    // Replacing one leaves the other alone.
    installChatSound({ sourcePath: write('chat2.ogg', OGG), dir });
    assert.deepEqual(fs.readdirSync(dir).sort(), ['custom-chat-sound.ogg', 'custom-sound.mp3']);
    installSound({ sourcePath: write('live2.wav', WAV), dir });
    assert.deepEqual(fs.readdirSync(dir).sort(), ['custom-chat-sound.ogg', 'custom-sound.wav']);

    // Resetting one leaves the other alone.
    removeCustomChatSounds(dir);
    assert.deepEqual(fs.readdirSync(dir), ['custom-sound.wav']);
    installChatSound({ sourcePath: write('chat3.mp3', MP3), dir });
    removeCustomSounds(dir);
    assert.deepEqual(fs.readdirSync(dir), ['custom-chat-sound.mp3']);
  });
});

test('each reader refuses the other sound\'s file name', () => {
  withDirs(({ dir, write }) => {
    installSound({ sourcePath: write('live.mp3', MP3), dir });
    installChatSound({ sourcePath: write('chat.mp3', MP3), dir });
    assert.equal(readCustomChatSound({ dir, soundFile: 'custom-sound.mp3' }), null);
    assert.equal(readCustomSound({ dir, soundFile: 'custom-chat-sound.mp3' }), null);
  });
});

test('readCustomChatSound returns null for nothing set, bad names and missing files', () => {
  withDirs(({ dir }) => {
    fs.mkdirSync(dir, { recursive: true });
    assert.equal(readCustomChatSound({ dir, soundFile: '' }), null);
    assert.equal(readCustomChatSound({ dir, soundFile: undefined }), null);
    assert.equal(readCustomChatSound({ dir, soundFile: '../secrets.json' }), null);
    assert.equal(readCustomChatSound({ dir, soundFile: 'custom-chat-sound.mp3' }), null); // not there
  });
});

test('removeCustomChatSounds also clears a half-written leftover and ignores other files', () => {
  withDirs(({ dir }) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'custom-chat-sound.mp3.tmp'), 'x');
    fs.writeFileSync(path.join(dir, 'settings.json'), '{}');
    fs.writeFileSync(path.join(dir, 'secrets.json'), '{}');
    removeCustomChatSounds(dir);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['secrets.json', 'settings.json']);
  });
  withDirs(({ dir }) => assert.doesNotThrow(() => removeCustomChatSounds(path.join(dir, 'missing'))));
});

test('installChatSound turns away bad files with a friendly message', () => {
  withDirs(({ dir, write }) => {
    assert.throws(() => installChatSound({ sourcePath: write('x.txt', 'hi'), dir }), /MP3, WAV or OGG/);
    assert.throws(() => installChatSound({ sourcePath: path.join(dir, 'nope.mp3'), dir }), /could not be opened/);
    assert.throws(() => installChatSound({ sourcePath: write('empty.mp3', Buffer.alloc(0)), dir }), /empty/);
    assert.throws(() => installChatSound({ sourcePath: write('fake.mp3', Buffer.from('not audio at all')), dir }),
      /valid MP3 sound file/);
    assert.throws(() => installChatSound({ sourcePath: write('big.mp3', Buffer.concat([Buffer.from('ID3'), Buffer.alloc(MAX_SOUND_BYTES)])), dir }),
      /under 2 MB/);
    assert.equal(fs.existsSync(dir) ? fs.readdirSync(dir).length : 0, 0, 'a rejected file must leave nothing behind');
  });
});

test('a rejected new chat sound keeps the previous one', () => {
  withDirs(({ dir, write }) => {
    installChatSound({ sourcePath: write('good.mp3', MP3), dir });
    assert.throws(() => installChatSound({ sourcePath: write('bad.mp3', Buffer.from('nope')), dir }));
    assert.deepEqual(fs.readdirSync(dir), ['custom-chat-sound.mp3']);
  });
});

test('the file name patterns match only their own sound', () => {
  assert.ok(CUSTOM_PATTERN.test('custom-sound.mp3'));
  assert.ok(!CUSTOM_PATTERN.test('custom-chat-sound.mp3'));
  assert.ok(CHAT_CUSTOM_PATTERN.test('custom-chat-sound.ogg'));
  assert.ok(!CHAT_CUSTOM_PATTERN.test('custom-sound.ogg'));
  assert.ok(!CHAT_CUSTOM_PATTERN.test('custom-chat-sound.mp3.tmp'));
});

test('live sound behaviour is unchanged (regression)', () => {
  withDirs(({ dir, write }) => {
    assert.deepEqual(installSound({ sourcePath: write('Chime.MP3', MP3), dir }),
      { soundFile: 'custom-sound.mp3', soundLabel: 'Chime.MP3' });
    assert.equal(readCustomSound({ dir, soundFile: 'custom-sound.mp3' }).mime, 'audio/mpeg');
    assert.throws(() => installSound({ sourcePath: write('x.txt', 'hi'), dir }), /MP3, WAV or OGG/);
    removeCustomSounds(dir);
    assert.equal(readCustomSound({ dir, soundFile: 'custom-sound.mp3' }), null);
  });
});
