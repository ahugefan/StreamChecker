// Pure helper functions used by server.js. Kept separate from the Express
// wiring so they can be unit tested without needing a real HTTP server.

const crypto = require('crypto');

function formatLastRefresh(date = new Date()) {
  // Uses the computer's own local time zone and format - no hardcoded region.
  return date.toLocaleString(undefined, {
    month: '2-digit', day: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

/**
 * Combines the tracked streamer list with live data from Twitch into the
 * shape the dashboard renders.
 *
 * @param {string[]} streamers    lowercase logins, in the order they're stored
 * @param {Map<string,object>} liveMap  login -> Helix stream object (from twitch.js)
 * @param {string[]} vips
 * @param {boolean} showOffline
 * @param {Date} now
 */
function buildStreamsPayload({ streamers, liveMap, vips, showOffline, now = new Date() }) {
  const vipSet = new Set(vips.map(v => v.toLowerCase()));
  const lastRefresh = formatLastRefresh(now);

  const all = streamers.map(username => {
    const live = liveMap.get(username);
    if (live) {
      return {
        username,
        isLive: true,
        title: live.title && live.title.trim() ? live.title : 'No title available',
        viewers: live.viewer_count || 0,
        isVip: vipSet.has(username)
      };
    }
    return { username, isLive: false, title: 'No title available', viewers: 0, isVip: vipSet.has(username) };
  });

  const liveNow = all.filter(s => s.isLive).length;
  const offlineHidden = showOffline ? 0 : all.length - liveNow;
  const visible = showOffline ? all : all.filter(s => s.isLive);

  sortStreams(visible);

  return { total: all.length, liveNow, offlineHidden, lastRefresh, streams: visible };
}

/** Sorts in place: VIPs first, then live, then alphabetical. Matches the original app's ordering. */
function sortStreams(streams) {
  streams.sort((a, b) => {
    if (a.isVip !== b.isVip) return a.isVip ? -1 : 1;
    if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
    return a.username.localeCompare(b.username);
  });
  return streams;
}

/** Constant-time comparison so a session key can't be guessed via response-timing. */
function safeKeyEquals(a, b) {
  const bufA = Buffer.from(String(a ?? ''));
  const bufB = Buffer.from(String(b ?? ''));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function generateSessionKey() {
  return crypto.randomBytes(24).toString('hex');
}

module.exports = { formatLastRefresh, buildStreamsPayload, sortStreams, safeKeyEquals, generateSessionKey };
