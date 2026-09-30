// Decides when to send shoutouts: watches the broadcaster's own live status
// (to know when a "session" starts/ends, like the original app), and sends
// one shoutout per tracked streamer per session once they're seen live.
//
// This module only decides *what* to send and *when*; actually posting to
// Twitch is injected as `sendChatMessage` / `getAccessToken` so this stays
// testable without any network access.

const { formatMessage, SHOUTOUT_DELAY_MS } = require('./chat');

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

/**
 * @param {object} opts
 * @param {object} opts.config          from src/config.js
 * @param {object} opts.twitchClient    from src/twitch.js (getLiveStreams)
 * @param {(role:'self'|'bot')=>Promise<string>} opts.getAccessToken
 * @param {typeof sendChatMessage} opts.sendChatMessage
 * @param {(ms:number)=>Promise<void>} [opts.sleepFn]
 */
function createShoutoutEngine({ config, twitchClient, getAccessToken, sendChatMessage, sleepFn = sleep }) {
  let broadcasterLive = false;
  let sentThisSession = new Set();

  function senderFor(settings) {
    return settings.shoutoutAccountType === 'bot'
      ? { senderId: settings.botUserId, role: 'bot' }
      : { senderId: settings.broadcasterUserId, role: 'self' };
  }

  async function sendOne(settings, login) {
    const { senderId, role } = senderFor(settings);
    const accessToken = await getAccessToken(role);
    const message = formatMessage(settings.shoutoutTemplate, login);
    await sendChatMessage({
      broadcasterId: settings.broadcasterUserId,
      senderId,
      message,
      accessToken,
      clientId: settings.clientId
    });
  }

  /** Checks live status and sends shoutouts for anyone newly live. Call this on a timer. */
  async function runOnce() {
    const settings = config.getSettings();
    if (!settings.autoShoutout) return { skipped: 'auto-shoutout is off' };
    if (!settings.broadcasterUserId || !settings.channelLogin) return { skipped: 'not logged in' };

    const ownStatus = await twitchClient.getLiveStreams([settings.channelLogin]);
    const isLiveNow = ownStatus.has(settings.channelLogin);

    if (isLiveNow && !broadcasterLive) sentThisSession = new Set();
    broadcasterLive = isLiveNow;
    if (!isLiveNow) return { broadcasterLive: false };

    const targets = settings.streamers.filter(s => s !== settings.channelLogin);
    const liveMap = await twitchClient.getLiveStreams(targets);

    const sent = [];
    const failed = [];
    for (const login of liveMap.keys()) {
      if (sentThisSession.has(login)) continue;
      try {
        await sendOne(settings, login);
        sentThisSession.add(login);
        sent.push(login);
      } catch (err) {
        failed.push({ login, error: err.message });
      }
      await sleepFn(SHOUTOUT_DELAY_MS);
    }
    return { broadcasterLive: true, sent, failed };
  }

  /** Re-sends to every currently-live tracked streamer, regardless of session history ("Resend All"). */
  async function resendAll() {
    const settings = config.getSettings();
    const targets = settings.streamers.filter(s => s !== settings.channelLogin);
    const liveMap = await twitchClient.getLiveStreams(targets);

    const sent = [];
    const failed = [];
    for (const login of liveMap.keys()) {
      try {
        await sendOne(settings, login);
        sentThisSession.add(login);
        sent.push(login);
      } catch (err) {
        failed.push({ login, error: err.message });
      }
      await sleepFn(SHOUTOUT_DELAY_MS);
    }
    return { sent, failed };
  }

  function hasSentThisSession(login) { return sentThisSession.has(login); }
  function resetSession() { sentThisSession = new Set(); broadcasterLive = false; }

  return { runOnce, resendAll, hasSentThisSession, resetSession };
}

module.exports = { createShoutoutEngine };
