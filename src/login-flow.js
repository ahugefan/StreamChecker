// Orchestrates one "Login with Twitch" attempt: opens the user's browser,
// runs a short-lived local HTTP listener to catch the redirect, exchanges
// the code for tokens, and confirms who logged in.
//
// This must run on the exact port registered as the app's Redirect URL on
// Twitch (http://localhost:3000), so it's a separate, temporary listener
// from the dashboard's own API server rather than sharing its (floating) port.

const http = require('http');
const {
  generateState, buildAuthorizeUrl, parseRedirectUrl,
  exchangeCodeForToken, validateToken, TwitchLoginError
} = require('./auth');

const LOGIN_PORT = 3000;
const LOGIN_TIMEOUT_MS = 120_000;
const REDIRECT_URI = `http://localhost:${LOGIN_PORT}`;

function page(title, message) {
  return `<!DOCTYPE html><html><head><title>${title}</title>
  <style>body{font-family:system-ui,sans-serif;background:#05060a;color:#f5f5ff;
  display:grid;place-items:center;height:100vh;margin:0}
  div{text-align:center}h1{color:#9146ff}</style></head>
  <body><div><h1>${title}</h1><p>${message}</p></div></body></html>`;
}

/**
 * @param {object} opts
 * @param {()=>string} opts.getClientId
 * @param {()=>string} opts.getClientSecret
 * @param {string[]} opts.scopes
 * @param {(url:string)=>void} opts.openExternal  e.g. Electron's shell.openExternal
 * @param {typeof fetch} [opts.fetchFn]
 * @returns {Promise<{login:string, userId:string, accessToken:string, refreshToken:string, expiresIn:number, scopes:string[]}>}
 */
function runLoginFlow({ getClientId, getClientSecret, scopes, openExternal, fetchFn = fetch }) {
  const clientId = getClientId();
  const clientSecret = getClientSecret();
  if (!clientId || !clientSecret) {
    return Promise.reject(new TwitchLoginError('Add your Client ID and Client Secret before logging in.'));
  }

  const state = generateState();
  const authorizeUrl = buildAuthorizeUrl({ clientId, redirectUri: REDIRECT_URI, scopes, state });

  return new Promise((resolve, reject) => {
    let settled = false;
    const server = http.createServer((req, res) => {
      // Browsers request things like /favicon.ico on their own; only the
      // root path is the actual Twitch redirect, so ignore anything else
      // without treating it as (or consuming) our one real callback.
      const { pathname } = new URL(req.url, 'http://localhost');
      if (pathname !== '/') {
        res.statusCode = 204;
        res.end();
        return;
      }

      const result = parseRedirectUrl(`http://localhost${req.url}`);

      if (result.error) {
        res.end(page('Login cancelled', result.error));
        finish(reject, new TwitchLoginError(result.error));
        return;
      }
      if (result.state !== state) {
        res.end(page('Login failed', 'The response did not match this login attempt. Please try again.'));
        finish(reject, new TwitchLoginError('Login state mismatch (possible stale or duplicate attempt).'));
        return;
      }

      res.end(page('Logged in', 'You can close this window and return to Twitch Live Checker.'));

      exchangeCodeForToken({ clientId, clientSecret, code: result.code, redirectUri: REDIRECT_URI, fetchFn })
        .then(tokens => validateToken({ accessToken: tokens.accessToken, fetchFn })
          .then(info => {
            if (!info.valid) throw new TwitchLoginError('Twitch could not confirm the new login.');
            finish(resolve, { ...tokens, login: info.login, userId: info.userId, scopes: info.scopes });
          }))
        .catch(err => finish(reject, err));
    });

    function finish(fn, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      fn(value);
    }

    const timer = setTimeout(() => {
      finish(reject, new TwitchLoginError('Login timed out. Please try again.'));
    }, LOGIN_TIMEOUT_MS);

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        finish(reject, new TwitchLoginError(
          `Port ${LOGIN_PORT} is already in use by another program, so Twitch can't redirect back here. Close whatever is using that port and try again.`
        ));
      } else {
        finish(reject, err);
      }
    });

    server.listen(LOGIN_PORT, '127.0.0.1', () => {
      openExternal(authorizeUrl);
    });
  });
}

module.exports = { runLoginFlow, REDIRECT_URI, LOGIN_PORT };
