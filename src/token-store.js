// Stores a login's access+refresh token (plus its expiry and who it belongs
// to) as one JSON blob per role ("self" or "bot") in config's encrypted
// secret storage, and hands back a always-valid access token, refreshing
// automatically when it's close to expiring.

const { refreshAccessToken, TwitchLoginError } = require('./auth');

const ROLES = ['self', 'bot'];
const EXPIRY_SAFETY_MARGIN_MS = 60_000;

function secretName(role) {
  if (!ROLES.includes(role)) throw new Error(`Unknown token role: ${role}`);
  return role === 'self' ? 'selfToken' : 'botToken';
}

function createTokenStore({ config, getClientId, getClientSecret, fetchFn = fetch, now = Date.now }) {
  function readBlob(role) {
    const raw = config.getSecret(secretName(role));
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  function writeBlob(role, blob) {
    config.setSecret(secretName(role), JSON.stringify(blob));
  }

  function save(role, { accessToken, refreshToken, expiresIn, login, userId }) {
    writeBlob(role, { accessToken, refreshToken, expiresAt: now() + expiresIn * 1000, login, userId });
  }

  function getIdentity(role) {
    const blob = readBlob(role);
    return blob ? { login: blob.login, userId: blob.userId } : null;
  }

  function hasToken(role) { return Boolean(readBlob(role)); }

  function clear(role) { config.setSecret(secretName(role), null); }

  /** Returns a currently-valid access token for this role, refreshing it first if needed. */
  async function getValidAccessToken(role) {
    const blob = readBlob(role);
    if (!blob) throw new TwitchLoginError(`No ${role === 'bot' ? 'bot account' : ''} login saved. Log in first.`.replace('  ', ' '));

    if (now() < blob.expiresAt - EXPIRY_SAFETY_MARGIN_MS) {
      return blob.accessToken;
    }

    const clientId = getClientId();
    const clientSecret = getClientSecret();
    const refreshed = await refreshAccessToken({ clientId, clientSecret, refreshToken: blob.refreshToken, fetchFn });
    const updated = { ...blob, accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken, expiresAt: now() + refreshed.expiresIn * 1000 };
    writeBlob(role, updated);
    return updated.accessToken;
  }

  return { save, getIdentity, hasToken, clear, getValidAccessToken };
}

module.exports = { createTokenStore };
