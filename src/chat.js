// Sends chat messages through Twitch's Helix "Send Chat Message" endpoint.
// This replaces the original app's tmi.js/IRC bot connection - no separate
// chat library or persistent connection is needed for a one-off message.
//
// Rate limits (per Twitch's own IRC/Chat documentation): an account that is
// not the broadcaster/mod/VIP in the target channel may send at most 20
// messages per 30 seconds; broadcasters/mods/VIPs get 100 per 30 seconds.
// Every account is also capped at 1 message per second *to that channel*.
// SHOUTOUT_DELAY_MS below is chosen to safely clear both limits regardless
// of which case applies, without needing to detect mod status.

const SEND_MESSAGE_URL = 'https://api.twitch.tv/helix/chat/messages';
const SHOUTOUT_DELAY_MS = 2000;

class ChatSendError extends Error {
  constructor(message, code) { super(message); this.name = 'ChatSendError'; this.code = code; }
}

/** Substitutes every {username} placeholder in the template. */
function formatMessage(template, username) {
  return template.split('{username}').join(username);
}

/**
 * @param {object} opts
 * @param {string} opts.broadcasterId  channel the message is posted into
 * @param {string} opts.senderId       account the message is sent as
 * @param {string} opts.message
 * @param {string} opts.accessToken    user token with the user:write:chat scope
 * @param {string} opts.clientId
 */
async function sendChatMessage({ broadcasterId, senderId, message, accessToken, clientId, fetchFn = fetch }) {
  if (!broadcasterId || !senderId) {
    throw new ChatSendError('Missing broadcaster or sender account - log in again in Settings.', 'not_configured');
  }

  let res;
  try {
    res = await fetchFn(SEND_MESSAGE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Client-Id': clientId,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ broadcaster_id: broadcasterId, sender_id: senderId, message })
    });
  } catch (err) {
    throw new ChatSendError(`Could not reach Twitch: ${err.message}`, 'network');
  }

  if (res.status === 401) throw new ChatSendError('Twitch login expired. Please log in again.', 'auth');
  if (res.status === 403) {
    throw new ChatSendError(
      'Twitch refused the message. If using a bot account, make sure the broadcaster has authorized it (channel:bot), or make the bot a moderator.',
      'forbidden'
    );
  }
  if (res.status === 429) throw new ChatSendError('Sending too many messages too quickly. Slow down and try again.', 'rate_limited');
  if (!res.ok) throw new ChatSendError(`Twitch rejected the message (status ${res.status}).`, 'unknown');

  const data = await res.json().catch(() => ({}));
  const result = (data.data && data.data[0]) || {};
  if (result.is_sent === false) {
    throw new ChatSendError(result.drop_reason?.message || 'Twitch dropped the message.', 'dropped');
  }
  return { messageId: result.message_id };
}

module.exports = { sendChatMessage, formatMessage, ChatSendError, SHOUTOUT_DELAY_MS };
