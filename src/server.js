// Local HTTP API for the dashboard UI. Bound to 127.0.0.1 only (never
// 0.0.0.0), so nothing outside this computer can reach it, and every
// request must carry the per-launch session key so no other local app
// can call it either.

const express = require('express');
const {
  buildStreamsPayload, safeKeyEquals, generateSessionKey
} = require('./server-logic');
const { parseStreamerInput, mergeStreamers } = require('./parse');
const { revokeToken } = require('./auth');

// channel:bot is requested for the broadcaster's own login up front (even
// though it's only used in "bot account" mode) so switching modes later in
// Settings never requires the streamer to log in a second time.
const SELF_LOGIN_SCOPES = ['user:write:chat', 'channel:bot'];
const BOT_LOGIN_SCOPES = ['user:write:chat', 'user:bot'];

// `runLogin` is injected (rather than imported directly) because it needs
// Electron's `shell.openExternal` to launch the system browser - see main.js.
// `tokenStore` and `shoutoutEngine` are likewise injected so this stays
// testable without real Twitch credentials or encrypted storage.
function createServer({ config, twitchClient, runLogin, tokenStore, shoutoutEngine, fetchFn = fetch }) {
  const sessionKey = generateSessionKey();
  const app = express();
  app.use(express.json());

  app.use((req, res, next) => {
    if (!safeKeyEquals(req.get('X-Session-Key'), sessionKey)) {
      return res.status(401).json({ error: 'Missing or invalid session key.' });
    }
    next();
  });

  app.get('/api/streams', async (_req, res) => {
    const settings = config.getSettings();
    try {
      const liveMap = await twitchClient.getLiveStreams(settings.streamers);
      const payload = buildStreamsPayload({
        streamers: settings.streamers,
        liveMap,
        vips: settings.vips,
        showOffline: settings.showOffline
      });
      res.json(payload);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  app.get('/api/settings', (_req, res) => {
    const settings = config.getSettings();
    res.json({ ...settings, hasClientSecret: config.hasSecret('clientSecret') });
  });

  app.post('/api/settings', (req, res) => {
    const patch = req.body || {};
    if (patch.shoutoutAccountType === 'bot' && !tokenStore.hasToken('bot')) {
      return res.status(400).json({ error: 'Log in with the bot account before switching to it.' });
    }
    try {
      const updated = config.updateSettings(patch);
      res.json({ ...updated, hasClientSecret: config.hasSecret('clientSecret') });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/credentials', async (req, res) => {
    const { clientId, clientSecret } = req.body || {};
    try {
      if (typeof clientId === 'string') config.updateSettings({ clientId });
      if (typeof clientSecret === 'string' && clientSecret.length) {
        config.setSecret('clientSecret', clientSecret);
      }
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    res.json({ success: true, hasClientSecret: config.hasSecret('clientSecret') });
  });

  app.post('/api/streamers', async (req, res) => {
    const { text } = req.body || {};
    const parsed = parseStreamerInput(text || '');
    try {
      let toAdd = parsed.valid;
      let notFound = [];
      if (toAdd.length) {
        const checked = await twitchClient.validateUsernames(toAdd);
        toAdd = checked.found;
        notFound = checked.notFound;
      }
      const current = config.getSettings().streamers;
      const updated = config.updateSettings({ streamers: mergeStreamers(current, toAdd) });
      res.json({ streamers: updated.streamers, invalid: parsed.invalid, notFound });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  app.post('/api/streamers/remove', (req, res) => {
    const { username } = req.body || {};
    const current = config.getSettings().streamers;
    const updated = config.updateSettings({
      streamers: current.filter(s => s !== String(username || '').toLowerCase())
    });
    res.json({ streamers: updated.streamers });
  });

  app.post('/api/vip/toggle', (req, res) => {
    const { username } = req.body || {};
    const login = String(username || '').toLowerCase();
    const current = config.getSettings().vips;
    const vips = current.includes(login) ? current.filter(v => v !== login) : [...current, login];
    const updated = config.updateSettings({ vips });
    res.json({ vips: updated.vips });
  });

  // --- Login with Twitch (used by the setup wizard and later Settings) ---
  // Two independent logins can exist: "self" (the streamer, always used to
  // read stream data) and "bot" (optional, only needed if shoutouts should
  // be sent from a separate bot account instead).

  async function doLogin(role, scopes) {
    if (!runLogin) throw new Error('Login is not available in this environment.');
    const result = await runLogin(scopes);
    tokenStore.save(role, result);
    return result;
  }

  async function doLogout(role) {
    const identity = tokenStore.getIdentity(role);
    const clientId = config.getSettings().clientId;
    if (identity) {
      try {
        const accessToken = await tokenStore.getValidAccessToken(role);
        await revokeToken({ clientId, accessToken, fetchFn });
      } catch { /* best-effort - still clear the local copy below */ }
    }
    tokenStore.clear(role);
  }

  app.get('/api/login/status', (_req, res) => {
    const settings = config.getSettings();
    res.json({ loggedIn: tokenStore.hasToken('self'), login: settings.channelLogin || null });
  });

  app.post('/api/login/start', async (_req, res) => {
    try {
      const result = await doLogin('self', SELF_LOGIN_SCOPES);
      config.updateSettings({ channelLogin: result.login, broadcasterUserId: result.userId });
      res.json({ success: true, login: result.login });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/login/logout', async (_req, res) => {
    await doLogout('self');
    config.updateSettings({ channelLogin: '', broadcasterUserId: '' });
    res.json({ success: true });
  });

  app.get('/api/bot-login/status', (_req, res) => {
    const settings = config.getSettings();
    res.json({ loggedIn: tokenStore.hasToken('bot'), login: settings.botLogin || null });
  });

  app.post('/api/bot-login/start', async (_req, res) => {
    try {
      const result = await doLogin('bot', BOT_LOGIN_SCOPES);
      config.updateSettings({ botLogin: result.login, botUserId: result.userId });
      res.json({ success: true, login: result.login });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/bot-login/logout', async (_req, res) => {
    await doLogout('bot');
    const patch = { botLogin: '', botUserId: '' };
    // Fall back to sending as the streamer's own account rather than leaving
    // auto-shoutout pointed at a bot login that no longer exists.
    if (config.getSettings().shoutoutAccountType === 'bot') patch.shoutoutAccountType = 'self';
    config.updateSettings(patch);
    res.json({ success: true });
  });

  // --- Shoutouts ---

  app.post('/api/shoutouts/resend-all', async (_req, res) => {
    try {
      const result = await shoutoutEngine.resendAll();
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  // --- Setup wizard ---

  app.get('/api/setup/status', (_req, res) => {
    res.json({ setupComplete: config.getSettings().setupComplete });
  });

  app.post('/api/setup/complete', (_req, res) => {
    const updated = config.updateSettings({ setupComplete: true });
    res.json({ setupComplete: updated.setupComplete });
  });

  // Starts at 3300, not 3000 - port 3000 is reserved for the Twitch OAuth
  // redirect (see login-flow.js), which must always be free for that moment.
  function listen(startPort = 3300, maxAttempts = 20) {
    return new Promise((resolve, reject) => {
      let port = startPort;
      let attempts = 0;
      function tryListen() {
        const server = app
          .listen(port, '127.0.0.1', () => resolve({ port, sessionKey, server }))
          .on('error', (err) => {
            if (err.code === 'EADDRINUSE' && attempts < maxAttempts) {
              attempts++; port++; setTimeout(tryListen, 150);
            } else {
              reject(err);
            }
          });
      }
      tryListen();
    });
  }

  return { app, listen };
}

module.exports = { createServer };
