const test = require('node:test');
const assert = require('node:assert');
const { createTwitchClient, TwitchAuthError, TwitchApiError, MAX_LOGINS_PER_CALL } = require('../src/twitch');

// A tiny fake `fetch` driven by a queue of canned responses, and a call log
// so tests can assert on exactly what URLs/bodies were sent.
function fakeFetch(responses) {
  const calls = [];
  const queue = [...responses];
  const fn = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    const next = queue.shift();
    if (!next) throw new Error('fakeFetch: no more canned responses');
    if (typeof next === 'function') return next(url, opts);
    return next;
  };
  fn.calls = calls;
  return fn;
}
function jsonRes(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function client(fetchFn, overrides = {}) {
  return createTwitchClient({
    getClientId: () => 'test-client-id',
    getClientSecret: () => 'test-secret',
    fetchFn,
    now: () => 1_000_000,
    ...overrides
  });
}

test('throws a friendly error when credentials are missing', async () => {
  const c = createTwitchClient({ getClientId: () => '', getClientSecret: () => '', fetchFn: fakeFetch([]) });
  await assert.rejects(() => c.getAppToken(), TwitchAuthError);
});

test('fetches and caches an app token', async () => {
  const fetchFn = fakeFetch([jsonRes(200, { access_token: 'tok-1', expires_in: 3600 })]);
  const c = client(fetchFn);
  assert.strictEqual(await c.getAppToken(), 'tok-1');
  assert.strictEqual(await c.getAppToken(), 'tok-1'); // second call uses cache
  assert.strictEqual(fetchFn.calls.length, 1);
});

test('refreshes the token once it is near expiry', async () => {
  let t = 1_000_000;
  const fetchFn = fakeFetch([
    jsonRes(200, { access_token: 'tok-1', expires_in: 100 }), // expires at 1,100,000
    jsonRes(200, { access_token: 'tok-2', expires_in: 3600 })
  ]);
  const c = client(fetchFn, { now: () => t });
  assert.strictEqual(await c.getAppToken(), 'tok-1');
  t = 1_050_000; // inside the 60s safety margin before expiry
  assert.strictEqual(await c.getAppToken(), 'tok-2');
});

test('bad credentials raise TwitchAuthError, not a generic failure', async () => {
  const fetchFn = fakeFetch([jsonRes(401, { message: 'invalid client secret' })]);
  const c = client(fetchFn);
  await assert.rejects(() => c.getAppToken(), TwitchAuthError);
});

test('network failure while getting a token raises TwitchAuthError with context', async () => {
  const fetchFn = fakeFetch([async () => { throw new Error('DNS lookup failed'); }]);
  const c = client(fetchFn);
  await assert.rejects(() => c.getAppToken(), /Could not reach Twitch.*DNS lookup failed/);
});

test('getLiveStreams returns only the streamers who are live', async () => {
  const fetchFn = fakeFetch([
    jsonRes(200, { access_token: 'tok-1', expires_in: 3600 }),
    jsonRes(200, { data: [
      { user_login: 'alpha_one', title: 'Playing games', viewer_count: 42 }
    ] })
  ]);
  const c = client(fetchFn);
  const live = await c.getLiveStreams(['alpha_one', 'beta_two']);
  assert.strictEqual(live.size, 1);
  assert.strictEqual(live.get('alpha_one').viewer_count, 42);
  assert.strictEqual(live.has('beta_two'), false);
});

test('getLiveStreams with an empty list makes no network call', async () => {
  const fetchFn = fakeFetch([]);
  const c = client(fetchFn);
  const live = await c.getLiveStreams([]);
  assert.strictEqual(live.size, 0);
  assert.strictEqual(fetchFn.calls.length, 0);
});

test('getLiveStreams batches more than 100 logins into multiple requests', async () => {
  const names = Array.from({ length: 150 }, (_, i) => `user${i}`);
  const fetchFn = fakeFetch([
    jsonRes(200, { access_token: 'tok-1', expires_in: 3600 }),
    jsonRes(200, { data: [{ user_login: 'user0', title: 't', viewer_count: 1 }] }),
    jsonRes(200, { data: [{ user_login: 'user140', title: 't2', viewer_count: 2 }] })
  ]);
  const c = client(fetchFn);
  const live = await c.getLiveStreams(names);
  assert.strictEqual(live.size, 2);
  // one token call + two stream calls, each capped at MAX_LOGINS_PER_CALL logins
  const streamCalls = fetchFn.calls.filter(c => c.url.includes('/helix/streams'));
  assert.strictEqual(streamCalls.length, 2);
  for (const call of streamCalls) {
    const count = (call.url.match(/user_login=/g) || []).length;
    assert.ok(count <= MAX_LOGINS_PER_CALL);
  }
});

test('duplicate and mixed-case logins are deduplicated before the request', async () => {
  const fetchFn = fakeFetch([
    jsonRes(200, { access_token: 'tok-1', expires_in: 3600 }),
    jsonRes(200, { data: [] })
  ]);
  const c = client(fetchFn);
  await c.getLiveStreams(['Alpha_One', 'alpha_one', 'ALPHA_ONE']);
  const streamCall = fetchFn.calls.find(c => c.url.includes('/helix/streams'));
  assert.strictEqual((streamCall.url.match(/user_login=/g) || []).length, 1);
});

test('retries once with a fresh token on a 401 from the streams endpoint', async () => {
  const fetchFn = fakeFetch([
    jsonRes(200, { access_token: 'tok-1', expires_in: 3600 }),
    jsonRes(401, { message: 'expired' }),
    jsonRes(200, { access_token: 'tok-2', expires_in: 3600 }),
    jsonRes(200, { data: [{ user_login: 'alpha_one', title: 't', viewer_count: 5 }] })
  ]);
  const c = client(fetchFn);
  const live = await c.getLiveStreams(['alpha_one']);
  assert.strictEqual(live.get('alpha_one').viewer_count, 5);
});

test('a 429 from Twitch raises a clear rate-limit error', async () => {
  const fetchFn = fakeFetch([
    jsonRes(200, { access_token: 'tok-1', expires_in: 3600 }),
    jsonRes(429, { message: 'rate limited' })
  ]);
  const c = client(fetchFn);
  await assert.rejects(() => c.getLiveStreams(['alpha_one']), TwitchApiError);
});

test('validateUsernames splits input into found and notFound', async () => {
  const fetchFn = fakeFetch([
    jsonRes(200, { access_token: 'tok-1', expires_in: 3600 }),
    jsonRes(200, { data: [{ login: 'alpha_one' }] })
  ]);
  const c = client(fetchFn);
  const result = await c.validateUsernames(['alpha_one', 'ghost_user_9999']);
  assert.deepStrictEqual(result.found, ['alpha_one']);
  assert.deepStrictEqual(result.notFound, ['ghost_user_9999']);
});

test('validateUsernames with an empty list makes no network call', async () => {
  const fetchFn = fakeFetch([]);
  const c = client(fetchFn);
  const result = await c.validateUsernames([]);
  assert.deepStrictEqual(result, { found: [], notFound: [] });
  assert.strictEqual(fetchFn.calls.length, 0);
});
