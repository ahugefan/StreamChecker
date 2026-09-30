const test = require('node:test');
const assert = require('node:assert');
const { sendChatMessage, formatMessage, ChatSendError } = require('../src/chat');

function fakeFetch(responses) {
  const calls = [];
  const queue = [...responses];
  const fn = async (url, opts) => {
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

test('formatMessage substitutes every occurrence of {username}', () => {
  assert.strictEqual(formatMessage('!so {username}', 'alpha_one'), '!so alpha_one');
  assert.strictEqual(formatMessage('go watch {username}! {username} is great', 'x'), 'go watch x! x is great');
});

test('sends the expected body and headers, and returns the message id on success', async () => {
  const fetchFn = fakeFetch([jsonRes(200, { data: [{ message_id: 'm1', is_sent: true }] })]);
  const result = await sendChatMessage({
    broadcasterId: '111', senderId: '111', message: '!so alpha_one',
    accessToken: 'tok', clientId: 'cid', fetchFn
  });
  assert.strictEqual(result.messageId, 'm1');
  const call = fetchFn.calls[0];
  assert.strictEqual(call.opts.headers.Authorization, 'Bearer tok');
  assert.strictEqual(call.opts.headers['Client-Id'], 'cid');
  const body = JSON.parse(call.opts.body);
  assert.deepStrictEqual(body, { broadcaster_id: '111', sender_id: '111', message: '!so alpha_one' });
});

test('401 raises a clear auth error', async () => {
  const fetchFn = fakeFetch([jsonRes(401, {})]);
  await assert.rejects(
    sendChatMessage({ broadcasterId: '1', senderId: '1', message: 'x', accessToken: 't', clientId: 'c', fetchFn }),
    (err) => err instanceof ChatSendError && err.code === 'auth'
  );
});

test('403 raises a forbidden error mentioning bot authorization', async () => {
  const fetchFn = fakeFetch([jsonRes(403, {})]);
  await assert.rejects(
    sendChatMessage({ broadcasterId: '1', senderId: '2', message: 'x', accessToken: 't', clientId: 'c', fetchFn }),
    (err) => err instanceof ChatSendError && err.code === 'forbidden'
  );
});

test('429 raises a rate_limited error', async () => {
  const fetchFn = fakeFetch([jsonRes(429, {})]);
  await assert.rejects(
    sendChatMessage({ broadcasterId: '1', senderId: '1', message: 'x', accessToken: 't', clientId: 'c', fetchFn }),
    (err) => err.code === 'rate_limited'
  );
});

test('a response where Twitch accepted the call but dropped the message is still an error', async () => {
  const fetchFn = fakeFetch([jsonRes(200, { data: [{ is_sent: false, drop_reason: { message: 'Message contained banned word' } }] })]);
  await assert.rejects(
    sendChatMessage({ broadcasterId: '1', senderId: '1', message: 'x', accessToken: 't', clientId: 'c', fetchFn }),
    /banned word/
  );
});

test('missing broadcaster/sender id fails fast without a network call', async () => {
  const fetchFn = fakeFetch([]);
  await assert.rejects(
    sendChatMessage({ broadcasterId: '', senderId: '', message: 'x', accessToken: 't', clientId: 'c', fetchFn }),
    (err) => err.code === 'not_configured'
  );
  assert.strictEqual(fetchFn.calls.length, 0);
});

test('a network failure is wrapped with context', async () => {
  const fetchFn = fakeFetch([async () => { throw new Error('offline'); }]);
  await assert.rejects(
    sendChatMessage({ broadcasterId: '1', senderId: '1', message: 'x', accessToken: 't', clientId: 'c', fetchFn }),
    /Could not reach Twitch.*offline/
  );
});
