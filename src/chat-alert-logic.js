// Decides whether a chat message should trigger an alert. Pure logic: no
// network, no Electron, and the clock is injected so it can be tested.
//
// Rules, in order:
//   1. Messages from ignored accounts (bots) and from the streamer's own
//      account are skipped completely. They do not count as chat activity,
//      so a bot posting a timer never "breaks the silence".
//   2. Every other message counts as activity, even when alerts are off or
//      suppressed, so switching alerts back on during a busy chat does not
//      immediately ping.
//   3. Alerts off -> no alert.
//   4. Auto-quiet: if chat was active within the last `quietMinutes`, no
//      alert (a busy chat stays quiet; the first message after a lull gets
//      through). 0 turns auto-quiet off, so every message can alert.
//   5. Cooldown: at most one alert per `cooldownSeconds`. 0 turns it off.

function normalizeLogin(value) {
  return String(value || '').trim().toLowerCase().replace(/^@/, '');
}

function createAlertGate({ now = Date.now } = {}) {
  let enabled = true;
  let lastActivityAt = null;
  let lastAlertAt = null;

  // message: { login }
  // options: { ownerLogin, ignoreList, quietMinutes, cooldownSeconds }
  // Returns { alert: boolean, reason: 'alert'|'off'|'busy'|'cooldown'|'ignored' }
  function observe(message, options = {}) {
    const t = now();
    const login = normalizeLogin(message && message.login);

    const ignored = new Set((options.ignoreList || []).map(normalizeLogin));
    const owner = normalizeLogin(options.ownerLogin);
    if (owner) ignored.add(owner);
    if (!login || ignored.has(login)) return { alert: false, reason: 'ignored' };

    const silentForMs = lastActivityAt === null ? Infinity : t - lastActivityAt;
    lastActivityAt = t;

    if (!enabled) return { alert: false, reason: 'off' };

    const quietMs = Math.max(0, Number(options.quietMinutes) || 0) * 60_000;
    if (quietMs > 0 && silentForMs < quietMs) return { alert: false, reason: 'busy' };

    const cooldownMs = Math.max(0, Number(options.cooldownSeconds) || 0) * 1000;
    if (cooldownMs > 0 && lastAlertAt !== null && t - lastAlertAt < cooldownMs) {
      return { alert: false, reason: 'cooldown' };
    }

    lastAlertAt = t;
    return { alert: true, reason: 'alert' };
  }

  return {
    observe,
    setEnabled(value) { enabled = Boolean(value); },
    isEnabled() { return enabled; },
    // Time (ms since epoch) of the last counted chat message, or null.
    getLastActivityAt() { return lastActivityAt; }
  };
}

module.exports = { createAlertGate, normalizeLogin };
