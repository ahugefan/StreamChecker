const test = require('node:test');
const assert = require('node:assert');
const {
  TwitchLoginError, generateState, buildAuthorizeUrl, parseRedirectUrl,
  exchangeCodeForToken, refreshAccessToken, validateToken, revokeToken
} = require('../src/auth');

function fakeFetch(responses) {
  const calls = [];
  const queue = [...responses];
  const fn = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    const next = queue.shift();
    if (!next) throw new Error('fakeFetch: no more canned responses');
    return typeof next === 'function' ? next(url, opts) : next;
  };
  fn.calls = calls;
  return fn;
}
function jsonRes(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test('generateState produces long, unique values', () => {
  const a = generateState(), b = generateState();
  assert.notStrictEqual(a, b);
  assert.ok(a.length >= 16);
});

test('buildAuthorizeUrl includes all required parameters', () => {
  const url = new URL(buildAuthorizeUrl({
    clientId: 'abc123',
    redirectUri: 'http://localhost:3000',
    scopes: ['user:write:chat', 'user:read:chat'],
    state: 'xyz'
  }));
  assert.strictEqual(url.origin + url.pathname, 'https://id.twitch.tv/oauth2/authorize');
  assert.strictEqual(url.searchParams.get('client_id'), 'abc123');
  assert.strictEqual(url.searchParams.get('redirect_uri'), 'http://localhost:3000');
  assert.strictEqual(url.searchParams.get('response_type'), 'code');
  assert.strictEqual(url.searchParams.get('scope'), 'user:write:chat user:read:chat');
  assert.strictEqual(url.searchParams.get('state'), 'xyz');
});

test('buildAuthorizeUrl refuses to build without a Client ID', () => {
  assert.throws(
    () => buildAuthorizeUrl({ clientId: '', redirectUri: 'http://localhost:3000', scopes: [], state: 's' }),
    TwitchLoginError
  );
});

test('parseRedirectUrl extracts the code and state on success', () => {
  const result = parseRedirectUrl('http://localhost:3000/?code=abc&state=xyz&scope=user%3Awrite%3Achat');
  assert.deepStrictEqual(result, { code: 'abc', state: 'xyz' });
});

test('parseRedirectUrl surfaces a Twitch-provided error description', () => {
  const result = parseRedirectUrl('http://localhost:3000/?error=access_denied&error_description=User+declined');
  assert.deepStrictEqual(result, { error: 'User declined' });
});

test('parseRedirectUrl reports a missing code as an error instead of throwing', () => {
  const result = parseRedirectUrl('http://localhost:3000/?state=xyz');
  assert.ok(result.error);
});

test('exchangeCodeForToken sends the expected fields and returns tokens', async () => {
  const fetchFn = fakeFetch([jsonRes(200, { access_token: 'a1', refresh_token: 'r1', expires_in: 14400 })]);
  const result = await exchangeCodeForToken({
    clientId: 'id', clientSecret: 'secret', code: 'c1',
    redirectUri: 'http://localhost:3000', fetchFn
  });
  assert.deepStrictEqual(result, { accessToken: 'a1', refreshToken: 'r1', expiresIn: 14400 });
  const sentBody = fetchFn.calls[0].opts.body.toString();
  assert.ok(sentBody.includes('grant_type=authorization_code'));
  assert.ok(sentBody.includes('code=c1'));
});

test('exchangeCodeForToken raises a friendly error on rejection', async () => {
  const fetchFn = fakeFetch([jsonRes(400, { message: 'Invalid authorization code' })]);
  await assert.rejects(
    () => exchangeCodeForToken({ clientId: 'id', clientSecret: 's', code: 'bad', redirectUri: 'x', fetchFn }),
    /Invalid authorization code/
  );
});

test('refreshAccessToken returns a new token pair', async () => {
  const fetchFn = fakeFetch([jsonRes(200, { access_token: 'a2', refresh_token: 'r2', expires_in: 14400 })]);
  const result = await refreshAccessToken({ clientId: 'id', clientSecret: 's', refreshToken: 'r1', fetchFn });
  assert.strictEqual(result.accessToken, 'a2');
});

test('refreshAccessToken raises TwitchLoginError when the refresh token is dead', async () => {
  const fetchFn = fakeFetch([jsonRes(400, { message: 'Invalid refresh token' })]);
  await assert.rejects(
    () => refreshAccessToken({ clientId: 'id', clientSecret: 's', refreshToken: 'dead', fetchFn }),
    TwitchLoginError
  );
});

test('validateToken returns login/userId/scopes for a good token', async () => {
  const fetchFn = fakeFetch([jsonRes(200, { login: 'alpha_one', user_id: '123', scopes: ['user:write:chat'] })]);
  const result = await validateToken({ accessToken: 'a1', fetchFn });
  assert.deepStrictEqual(result, { valid: true, login: 'alpha_one', userId: '123', scopes: ['user:write:chat'] });
});

test('validateToken reports invalid instead of throwing on a dead token', async () => {
  const fetchFn = fakeFetch([jsonRes(401, { message: 'invalid access token' })]);
  const result = await validateToken({ accessToken: 'dead', fetchFn });
  assert.deepStrictEqual(result, { valid: false });
});

test('revokeToken does not throw even if Twitch cannot be reached', async () => {
  const fetchFn = fakeFetch([async () => { throw new Error('offline'); }]);
  await assert.doesNotReject(() => revokeToken({ clientId: 'id', accessToken: 'a1', fetchFn }));
});
