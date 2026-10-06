// Settings storage in the user's app-data folder (never in the project folder).
//   settings.json  - ordinary preferences, streamer list, VIP list, Client ID
//   secrets.json   - Client Secret and login tokens, encrypted with the
//                    operating system's credential protection (Electron safeStorage)
//
// Electron's `app` and `safeStorage` are passed in so this file can be tested
// without launching Electron.

const fs = require('fs');
const path = require('path');
const { parseStreamerInput } = require('./parse');

const REFRESH_CHOICES = [1, 5, 10, 15, 30, 60];

const DEFAULTS = Object.freeze({
  clientId: '',
  channelLogin: '',            // the streamer's own channel (set by Login with Twitch)
  broadcasterUserId: '',       // Twitch numeric user ID for channelLogin
  shoutoutAccountType: 'self', // 'self' or 'bot' - which login sends the shoutout
  botLogin: '',                // bot account's Twitch username (display only)
  botUserId: '',                // bot account's Twitch numeric user ID
  streamers: [],
  vips: [],
  autoRefresh: true,
  refreshMinutes: 5,
  soundEnabled: true,
  soundFile: '',               // '' = built-in chime; otherwise custom-sound.<ext> in the config folder
  soundLabel: '',              // original file name of the custom sound (display only)
  soundVolume: 100,            // 0-100
  lightTheme: false,
  accentColor: '#9146ff',      // theme accent color as #rrggbb
  highlightVips: true,
  showOffline: true,
  autoShoutout: true,
  shoutoutTemplate: '!so {username}',
  setupComplete: false
});

const SECRET_NAMES = ['clientSecret', 'selfToken', 'botToken'];

function isLogin(v) { return typeof v === 'string' && parseStreamerInput(v).valid.length === 1; }

// Each rule returns the cleaned value, or throws with a friendly message.
const RULES = {
  clientId: v => { if (typeof v !== 'string') throw new Error('Client ID must be text'); return v.trim(); },
  channelLogin: v => {
    if (v === '') return '';
    const r = parseStreamerInput(v);
    if (r.valid.length !== 1) throw new Error('Channel must be one Twitch username');
    return r.valid[0];
  },
  broadcasterUserId: v => {
    if (typeof v !== 'string') throw new Error('broadcasterUserId must be text');
    if (v !== '' && !/^\d+$/.test(v)) throw new Error('broadcasterUserId must be numeric');
    return v;
  },
  shoutoutAccountType: v => {
    if (v !== 'self' && v !== 'bot') throw new Error("shoutoutAccountType must be 'self' or 'bot'");
    return v;
  },
  botLogin: v => {
    if (v === '') return '';
    const r = parseStreamerInput(v);
    if (r.valid.length !== 1) throw new Error('Bot account must be one Twitch username');
    return r.valid[0];
  },
  botUserId: v => {
    if (typeof v !== 'string') throw new Error('botUserId must be text');
    if (v !== '' && !/^\d+$/.test(v)) throw new Error('botUserId must be numeric');
    return v;
  },
  streamers: v => {
    if (!Array.isArray(v)) throw new Error('streamers must be a list');
    return parseStreamerInput(v.join('\n')).valid;
  },
  vips: v => {
    if (!Array.isArray(v)) throw new Error('vips must be a list');
    return parseStreamerInput(v.join('\n')).valid;
  },
  autoRefresh: bool('autoRefresh'),
  soundEnabled: bool('soundEnabled'),
  soundFile: v => {
    if (v === '') return '';
    if (typeof v !== 'string' || !/^custom-sound\.(mp3|wav|ogg)$/.test(v)) {
      throw new Error('soundFile must be empty or a custom-sound file');
    }
    return v;
  },
  soundLabel: v => {
    if (typeof v !== 'string') throw new Error('soundLabel must be text');
    return v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80);
  },
  soundVolume: v => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 100) throw new Error('soundVolume must be a whole number from 0 to 100');
    return n;
  },
  lightTheme: bool('lightTheme'),
  accentColor: v => {
    if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) {
      throw new Error('accentColor must be a color like #9146ff');
    }
    return v.toLowerCase();
  },
  highlightVips: bool('highlightVips'),
  showOffline: bool('showOffline'),
  autoShoutout: bool('autoShoutout'),
  setupComplete: bool('setupComplete'),
  refreshMinutes: v => {
    const n = Number(v);
    if (!REFRESH_CHOICES.includes(n)) throw new Error(`refreshMinutes must be one of ${REFRESH_CHOICES.join(', ')}`);
    return n;
  },
  shoutoutTemplate: v => {
    if (typeof v !== 'string') throw new Error('Shoutout message must be text');
    const t = v.trim();
    if (!t.includes('{username}')) throw new Error('Shoutout message must include {username}');
    if (t.length > 200) throw new Error('Shoutout message is too long (200 characters max)');
    return t;
  }
};

function bool(name) {
  return v => {
    if (typeof v !== 'boolean') throw new Error(`${name} must be true or false`);
    return v;
  };
}

function atomicWrite(file, text) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // Keep the unreadable file for troubleshooting instead of silently losing it.
    try { fs.renameSync(file, `${file}.corrupt-${Date.now()}`); } catch { /* ignore */ }
    return fallback;
  }
}

function createConfig({ dir, safeStorage }) {
  fs.mkdirSync(dir, { recursive: true });
  const settingsFile = path.join(dir, 'settings.json');
  const secretsFile = path.join(dir, 'secrets.json');

  function getSettings() {
    const stored = readJson(settingsFile, {});
    const merged = { ...DEFAULTS, ...stored };
    // Re-validate what came from disk; fall back to defaults for anything invalid.
    for (const key of Object.keys(DEFAULTS)) {
      try { merged[key] = RULES[key](merged[key]); }
      catch { merged[key] = DEFAULTS[key]; }
    }
    return merged;
  }

  function updateSettings(patch) {
    const current = getSettings();
    for (const [key, value] of Object.entries(patch || {})) {
      if (!(key in RULES)) throw new Error(`Unknown setting: ${key}`);
      current[key] = RULES[key](value);
    }
    atomicWrite(settingsFile, JSON.stringify(current, null, 2));
    return current;
  }

  function readSecrets() { return readJson(secretsFile, {}); }

  function setSecret(name, value) {
    if (!SECRET_NAMES.includes(name)) throw new Error(`Unknown secret: ${name}`);
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure storage is not available on this computer, so the secret was not saved.');
    }
    const secrets = readSecrets();
    if (value === null || value === '') {
      delete secrets[name];
    } else {
      secrets[name] = safeStorage.encryptString(String(value)).toString('base64');
    }
    atomicWrite(secretsFile, JSON.stringify(secrets, null, 2));
  }

  function getSecret(name) {
    if (!SECRET_NAMES.includes(name)) throw new Error(`Unknown secret: ${name}`);
    const enc = readSecrets()[name];
    if (!enc) return null;
    try { return safeStorage.decryptString(Buffer.from(enc, 'base64')); }
    catch { return null; } // e.g. file copied from another PC or user account
  }

  function hasSecret(name) { return Boolean(readSecrets()[name]); }

  function clearSecrets() {
    if (fs.existsSync(secretsFile)) fs.unlinkSync(secretsFile);
  }

  return { getSettings, updateSettings, setSecret, getSecret, hasSecret, clearSecrets, dir };
}

module.exports = { createConfig, DEFAULTS, REFRESH_CHOICES, SECRET_NAMES };
