const test = require('node:test');
const assert = require('node:assert');
const { parseStreamerInput, mergeStreamers } = require('../src/parse');

test('plain usernames, one per line, are lowercased', () => {
  const r = parseStreamerInput('Streamer_One\nexample_gamer\n');
  assert.deepStrictEqual(r.valid, ['streamer_one', 'example_gamer']);
  assert.strictEqual(r.invalid.length, 0);
});

test('accepts twitch.tv links in every common form', () => {
  const input = [
    'twitch.tv/alpha_one',
    'www.twitch.tv/beta_two',
    'https://twitch.tv/gamma_three',
    'https://www.twitch.tv/delta_four/',
    'https://m.twitch.tv/epsilon_five?sr=a',
    'https://www.twitch.tv/zeta_six/videos',
    'https://www.twitch.tv/popout/eta_seven/chat',
    'HTTPS://WWW.TWITCH.TV/Theta_Eight'
  ].join('\n');
  assert.deepStrictEqual(parseStreamerInput(input).valid, [
    'alpha_one', 'beta_two', 'gamma_three', 'delta_four',
    'epsilon_five', 'zeta_six', 'eta_seven', 'theta_eight'
  ]);
});

test('handles @ prefixes, commas, semicolons, and spaces', () => {
  const r = parseStreamerInput('@alpha_one, beta_two; gamma_three   delta_four');
  assert.deepStrictEqual(r.valid, ['alpha_one', 'beta_two', 'gamma_three', 'delta_four']);
});

test('removes duplicates, including link vs name', () => {
  const r = parseStreamerInput('alpha_one\nALPHA_ONE\ntwitch.tv/alpha_one');
  assert.deepStrictEqual(r.valid, ['alpha_one']);
});

test('reports invalid entries with a reason instead of dropping silently', () => {
  const r = parseStreamerInput('good_name\nno!way\nab\nthis_name_is_way_too_long_for_twitch');
  assert.deepStrictEqual(r.valid, ['good_name']);
  assert.strictEqual(r.invalid.length, 3);
  assert.ok(r.invalid.every(i => i.reason));
});

test('rejects non-channel Twitch pages', () => {
  const r = parseStreamerInput('https://www.twitch.tv/directory\nhttps://www.twitch.tv/');
  assert.strictEqual(r.valid.length, 0);
  assert.strictEqual(r.invalid.length, 2);
});

test('empty and non-string input is safe', () => {
  assert.deepStrictEqual(parseStreamerInput(''), { valid: [], invalid: [] });
  assert.deepStrictEqual(parseStreamerInput(null), { valid: [], invalid: [] });
  assert.deepStrictEqual(parseStreamerInput(undefined), { valid: [], invalid: [] });
});

test('handles Windows line endings', () => {
  assert.deepStrictEqual(parseStreamerInput('alpha_one\r\nbeta_two\r\n').valid, ['alpha_one', 'beta_two']);
});

test('mergeStreamers keeps order and avoids duplicates', () => {
  assert.deepStrictEqual(
    mergeStreamers(['alpha_one', 'beta_two'], ['Beta_Two', 'gamma_three']),
    ['alpha_one', 'beta_two', 'gamma_three']
  );
});
