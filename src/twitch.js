// Talks to Twitch's Helix API using an app access token (client credentials).
// This is read-only data (stream status, user lookup) - no chat, no user login.
// `fetchFn` is injected so this module can be tested without a network call;
// in the real app it defaults to the global fetch that Node/Electron provide.

const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const STREAMS_URL = 'https://api.twitch.tv/helix/streams';
const USERS_URL = 'https://api.twitch.tv/helix/users';
const MAX_LOGINS_PER_CALL = 100;
const TOKEN_SAFETY_MARGIN_MS = 60_000;

class TwitchAuthError extends Error {
  constructor(message) { super(message); this.name = 'TwitchAuthError'; }
}
class TwitchApiError extends Error {
  constructor(message, status) { super(message); this.name = 'TwitchApiError'; this.status = status; }
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function createTwitchClient({ getClientId, getClientSecret, fetchFn = fetch, now = Date.now }) {
  let cachedToken = null;
  let expiresAt = 0;

  async function getAppToken(forceRefresh = false) {
    const clientId = getClientId();
    const clientSecret = getClientSecret();
    if (!clientId || !clientSecret) {
      throw new TwitchAuthError('Client ID and Client Secret are required. Add them in Settings.');
    }

    if (!forceRefresh && cachedToken && now() < expiresAt - TOKEN_SAFETY_MARGIN_MS) {
      return cachedToken;
    }

    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials'
    });

    let res;
    try {
      res = await fetchFn(TOKEN_URL, { method: 'POST', body: params });
    } catch (err) {
      throw new TwitchAuthError(`Could not reach Twitch to sign in: ${err.message}`);
    }

    if (res.status === 400 || res.status === 401 || res.status === 403) {
      throw new TwitchAuthError('Twitch rejected the Client ID or Client Secret. Check them in Settings.');
    }
    if (!res.ok) {
      throw new TwitchApiError(`Twitch sign-in failed (status ${res.status}).`, res.status);
    }

    const data = await res.json();
    cachedToken = data.access_token;
    expiresAt = now() + data.expires_in * 1000;
    return cachedToken;
  }

  async function authedFetch(url, { retriedOnce = false } = {}) {
    const token = await getAppToken();
    const res = await fetchFn(url, {
      headers: { 'Client-ID': getClientId(), Authorization: `Bearer ${token}` }
    });

    // Token may have been revoked/expired early; try one fresh token before giving up.
    if (res.status === 401 && !retriedOnce) {
      await getAppToken(true);
      return authedFetch(url, { retriedOnce: true });
    }
    if (res.status === 429) {
      throw new TwitchApiError('Twitch is rate-limiting requests right now. Try again shortly.', 429);
    }
    if (!res.ok) {
      throw new TwitchApiError(`Twitch API request failed (status ${res.status}).`, res.status);
    }
    return res.json();
  }

  /**
   * @param {string[]} logins  Twitch usernames (already lowercase, from parse.js)
   * @returns {Promise<Map<string, object>>} login -> raw Helix stream object, only for those live
   */
  async function getLiveStreams(logins) {
    const clean = [...new Set(logins.map(l => l.toLowerCase()))].filter(Boolean);
    if (!clean.length) return new Map();

    const live = new Map();
    for (const batch of chunk(clean, MAX_LOGINS_PER_CALL)) {
      const url = new URL(STREAMS_URL);
      batch.forEach(login => url.searchParams.append('user_login', login));
      url.searchParams.set('first', '100');
      const data = await authedFetch(url.toString());
      for (const stream of data.data || []) {
        live.set(stream.user_login.toLowerCase(), stream);
      }
    }
    return live;
  }

  /**
   * Confirms which usernames are real Twitch accounts.
   * @returns {Promise<{found: string[], notFound: string[]}>}
   */
  async function validateUsernames(logins) {
    const clean = [...new Set(logins.map(l => l.toLowerCase()))].filter(Boolean);
    if (!clean.length) return { found: [], notFound: [] };

    const found = new Set();
    for (const batch of chunk(clean, MAX_LOGINS_PER_CALL)) {
      const url = new URL(USERS_URL);
      batch.forEach(login => url.searchParams.append('login', login));
      const data = await authedFetch(url.toString());
      for (const user of data.data || []) found.add(user.login.toLowerCase());
    }
    return {
      found: clean.filter(l => found.has(l)),
      notFound: clean.filter(l => !found.has(l))
    };
  }

  return { getAppToken, getLiveStreams, validateUsernames };
}

module.exports = { createTwitchClient, TwitchAuthError, TwitchApiError, MAX_LOGINS_PER_CALL };
