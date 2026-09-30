// Turns whatever people paste (usernames, twitch.tv links, @names, lists
// separated by lines/commas/spaces) into clean, lowercase Twitch logins.
// This only checks the *format*. Whether the account really exists is
// confirmed later against the Twitch API.

const LOGIN_RE = /^[a-z0-9_]{3,25}$/;

// First path segments on twitch.tv that are pages, not channels.
const RESERVED_PATHS = new Set([
  'directory', 'videos', 'settings', 'downloads', 'jobs', 'p', 'store',
  'turbo', 'subscriptions', 'friends', 'wallet', 'inventory', 'drops',
  'search', 'u', 'moderator', 'dashboard', 'prime', 'login', 'signup',
  'privacy', 'legal', 'about', 'annual', 'broadcast', 'bits', 'team'
]);

const TWITCH_HOST_RE = /^(?:https?:\/\/)?(?:(?:www|m|go)\.)?twitch\.tv(?:\/|$)/i;

function extractFromLink(token) {
  // Drop query string and hash, then split the path.
  const clean = token.replace(/[?#].*$/, '');
  const afterHost = clean.replace(TWITCH_HOST_RE, '');
  const segments = afterHost.split('/').filter(Boolean);
  if (!segments.length) return { error: 'link has no channel name' };

  let first = segments[0].toLowerCase();
  // twitch.tv/popout/<name>/chat
  if (first === 'popout' && segments[1]) first = segments[1].toLowerCase();
  if (RESERVED_PATHS.has(first)) return { error: 'link is not a channel page' };
  return { login: first };
}

function checkLogin(candidate, original) {
  const login = candidate.replace(/^@/, '').toLowerCase();
  if (LOGIN_RE.test(login)) return { login };
  return { error: 'not a valid Twitch username', original };
}

/**
 * @param {string} text  Raw pasted text or file contents.
 * @returns {{valid: string[], invalid: {input: string, reason: string}[]}}
 */
function parseStreamerInput(text) {
  const valid = [];
  const invalid = [];
  const seen = new Set();

  // Split on newlines, commas, semicolons, and whitespace.
  const tokens = String(text ?? '')
    .split(/[\s,;]+/)
    .map(t => t.trim())
    .filter(Boolean);

  for (const token of tokens) {
    let result;
    if (/twitch\.tv/i.test(token)) {
      result = extractFromLink(token);
      if (result.login) result = checkLogin(result.login, token);
    } else {
      result = checkLogin(token, token);
    }

    if (result.error) {
      invalid.push({ input: token, reason: result.error });
      continue;
    }
    if (!seen.has(result.login)) {
      seen.add(result.login);
      valid.push(result.login);
    }
  }
  return { valid, invalid };
}

/** Adds new logins to an existing list without duplicates, keeping order. */
function mergeStreamers(existing, incoming) {
  const out = [];
  const seen = new Set();
  for (const name of [...existing, ...incoming]) {
    const key = String(name).toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

module.exports = { parseStreamerInput, mergeStreamers, LOGIN_RE };
