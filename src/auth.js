// Twitch "Login with Twitch" (OAuth Authorization Code flow) helpers.
// Pure/testable functions only - the part that needs a real browser and a
// local HTTP listener lives in main.js, since that needs Electron's `shell`.

const crypto = require('crypto');

const AUTHORIZE_URL = 'https://id.twitch.tv/oauth2/authorize';
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const VALIDATE_URL = 'https://id.twitch.tv/oauth2/validate';
const REVOKE_URL = 'https://id.twitch.tv/oauth2/revoke';

class TwitchLoginError extends Error {
  constructor(message) { super(message); this.name = 'TwitchLoginError'; }
}

function generateState() {
  return crypto.randomBytes(16).toString('hex');
}

/** Builds the URL the user's browser is sent to in order to approve access. */
function buildAuthorizeUrl({ clientId, redirectUri, scopes, state }) {
  if (!clientId) throw new TwitchLoginError('Client ID is required before logging in.');
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scopes.join(' '));
  url.searchParams.set('state', state);
  return url.toString();
}

/** Parses the redirect Twitch sends back to our local listener. */
function parseRedirectUrl(rawUrl) {
  const url = new URL(rawUrl, 'http://localhost');
  const error = url.searchParams.get('error');
  if (error) {
    const description = url.searchParams.get('error_description') || error;
    return { error: description };
  }
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code) return { error: 'Twitch did not return a login code.' };
  return { code, state };
}

async function exchangeCodeForToken({ clientId, clientSecret, code, redirectUri, fetchFn = fetch }) {
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri
  });
  const res = await fetchFn(TOKEN_URL, { method: 'POST', body: params });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new TwitchLoginError(data.message || `Twitch rejected the login (status ${res.status}).`);
  }
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in };
}

async function refreshAccessToken({ clientId, clientSecret, refreshToken, fetchFn = fetch }) {
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  });
  const res = await fetchFn(TOKEN_URL, { method: 'POST', body: params });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new TwitchLoginError('Could not refresh the Twitch login. Please log in again.');
  }
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in };
}

/** Confirms a token is still valid and returns who it belongs to. */
async function validateToken({ accessToken, fetchFn = fetch }) {
  const res = await fetchFn(VALIDATE_URL, { headers: { Authorization: `OAuth ${accessToken}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { valid: false };
  return { valid: true, login: data.login, userId: data.user_id, scopes: data.scopes || [] };
}

async function revokeToken({ clientId, accessToken, fetchFn = fetch }) {
  const params = new URLSearchParams({ client_id: clientId, token: accessToken });
  try {
    await fetchFn(`${REVOKE_URL}?${params.toString()}`, { method: 'POST' });
  } catch {
    // Best-effort: if Twitch can't be reached, we still clear the local copy.
  }
}

module.exports = {
  TwitchLoginError,
  generateState,
  buildAuthorizeUrl,
  parseRedirectUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  validateToken,
  revokeToken
};
