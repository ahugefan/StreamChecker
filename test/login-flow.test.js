const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { runLoginFlow, REDIRECT_URI } = require('../src/login-flow');
const { TwitchLoginError } = require('../src/auth');

function jsonRes(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// Simulates Twitch (or a browser's own background requests) calling our
// local listener. `path` defaults to root, matching a real Twitch redirect.
function simulateRedirect(path, query) {
  const target = path ? `${REDIRECT_URI}/${path}` : `${REDIRECT_URI}/?${query}`;
  return new Promise((resolve, reject) => {
    http.get(target, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

function stateFromAuthorizeUrl(url) {
  return new URL(url).searchParams.get('state');
}

test('full flow: browser approval leads to tokens and identity', async () => {
  const fetchFn = async (url) => {
    if (String(url).includes('/oauth2/token')) {
      return jsonRes(200, { access_token: 'a1', refresh_token: 'r1', expires_in: 14400 });
    }
    if (String(url).includes('/oauth2/validate')) {
      return jsonRes(200, { login: 'alpha_one', user_id: '123', scopes: ['user:write:chat'] });
    }
    throw new Error('unexpected url ' + url);
  };

  const flowPromise = runLoginFlow({
    getClientId: () => 'id', getClientSecret: () => 'secret',
    scopes: ['user:write:chat'], fetchFn,
    openExternal: (url) => {
      const state = stateFromAuthorizeUrl(url);
      simulateRedirect('', `code=goodcode&state=${state}`);
    }
  });

  const result = await flowPromise;
  assert.strictEqual(result.login, 'alpha_one');
  assert.strictEqual(result.userId, '123');
  assert.strictEqual(result.accessToken, 'a1');
});

test('a stray browser request (e.g. /favicon.ico) is ignored, not treated as the callback', async () => {
  const fetchFn = async (url) => {
    if (String(url).includes('/oauth2/token')) return jsonRes(200, { access_token: 'a1', refresh_token: 'r1', expires_in: 14400 });
    if (String(url).includes('/oauth2/validate')) return jsonRes(200, { login: 'alpha_one', user_id: '123', scopes: [] });
    throw new Error('unexpected url ' + url);
  };

  const flowPromise = runLoginFlow({
    getClientId: () => 'id', getClientSecret: () => 'secret',
    scopes: ['user:write:chat'], fetchFn,
    openExternal: async (url) => {
      const state = stateFromAuthorizeUrl(url);
      // Simulate the browser's automatic favicon request arriving first...
      await simulateRedirect('favicon.ico', '');
      // ...followed by the real redirect a moment later.
      await simulateRedirect('', `code=goodcode&state=${state}`);
    }
  });

  const result = await flowPromise;
  assert.strictEqual(result.login, 'alpha_one');
});

test('a mismatched state is rejected (protects against a stale/forged redirect)', async () => {
  const flowPromise = runLoginFlow({
    getClientId: () => 'id', getClientSecret: () => 'secret',
    scopes: ['user:write:chat'], fetchFn: async () => jsonRes(200, {}),
    openExternal: () => { simulateRedirect('', 'code=x&state=wrong-state'); }
  });
  await assert.rejects(flowPromise, /state mismatch/);
});

test('the user declining on the Twitch page surfaces as a login error', async () => {
  const flowPromise = runLoginFlow({
    getClientId: () => 'id', getClientSecret: () => 'secret',
    scopes: ['user:write:chat'], fetchFn: async () => jsonRes(200, {}),
    openExternal: () => { simulateRedirect('', 'error=access_denied&error_description=User+declined'); }
  });
  await assert.rejects(flowPromise, /User declined/);
});

test('missing credentials fail fast without opening a browser', async () => {
  let opened = false;
  await assert.rejects(
    runLoginFlow({
      getClientId: () => '', getClientSecret: () => '', scopes: [],
      openExternal: () => { opened = true; }
    }),
    TwitchLoginError
  );
  assert.strictEqual(opened, false);
});
