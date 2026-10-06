// Custom live-alert sound: validate the chosen file, keep our own copy in the
// app-data folder, and read it back for playback.
//
// The copy is always named custom-sound.<ext>, so the stored setting can never
// point anywhere else on disk, and the original file can be moved or deleted
// without breaking the alert.

const fs = require('fs');
const path = require('path');

const MAX_SOUND_BYTES = 2 * 1024 * 1024; // 2 MB
const TYPES = Object.freeze({
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg'
});
const CUSTOM_PATTERN = /^custom-sound\.(mp3|wav|ogg)$/;
const TMP_PATTERN = /^custom-sound\.(mp3|wav|ogg)\.tmp$/;

// Cheap check that the file's first bytes match its extension, so a renamed
// non-audio file is turned away with a clear message.
function looksLikeAudio(ext, buf) {
  const head = (start, end) => buf.subarray(start, end).toString('latin1');
  if (ext === '.mp3') {
    return head(0, 3) === 'ID3' || (buf.length > 1 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0);
  }
  if (ext === '.wav') return buf.length >= 12 && head(0, 4) === 'RIFF' && head(8, 12) === 'WAVE';
  if (ext === '.ogg') return head(0, 4) === 'OggS';
  return false;
}

// Deletes the custom sound (and any half-written leftover). Used on reset and
// before installing a replacement.
function removeCustomSounds(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (CUSTOM_PATTERN.test(name) || TMP_PATTERN.test(name)) {
      try { fs.unlinkSync(path.join(dir, name)); } catch { /* ignore */ }
    }
  }
}

// Returns { soundFile, soundLabel } on success; throws a friendly Error otherwise.
function installSound({ sourcePath, dir }) {
  const ext = path.extname(String(sourcePath || '')).toLowerCase();
  if (!TYPES[ext]) throw new Error('Please choose an MP3, WAV or OGG file.');

  let stat;
  try { stat = fs.statSync(sourcePath); }
  catch { throw new Error('That file could not be opened.'); }
  if (!stat.isFile()) throw new Error('That file could not be opened.');
  if (stat.size === 0) throw new Error('That file is empty.');
  if (stat.size > MAX_SOUND_BYTES) throw new Error('That file is too large. Please choose a sound under 2 MB.');

  const bytes = fs.readFileSync(sourcePath);
  if (!looksLikeAudio(ext, bytes)) {
    throw new Error(`That doesn't look like a valid ${ext.slice(1).toUpperCase()} sound file.`);
  }

  fs.mkdirSync(dir, { recursive: true });
  removeCustomSounds(dir); // drops any previous custom sound, whatever its extension
  const soundFile = `custom-sound${ext}`;
  const tmp = path.join(dir, `${soundFile}.tmp`);
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, path.join(dir, soundFile));

  return { soundFile, soundLabel: path.basename(sourcePath).slice(0, 80) };
}

// Returns { mime, bytes } or null (nothing set, bad name, or file missing).
function readCustomSound({ dir, soundFile }) {
  if (typeof soundFile !== 'string' || !CUSTOM_PATTERN.test(soundFile)) return null;
  const file = path.join(dir, soundFile);
  if (!fs.existsSync(file)) return null;
  try {
    return { mime: TYPES[path.extname(soundFile)], bytes: fs.readFileSync(file) };
  } catch {
    return null;
  }
}

module.exports = { installSound, readCustomSound, removeCustomSounds, looksLikeAudio, MAX_SOUND_BYTES, CUSTOM_PATTERN };
