// Ties the chat-alert pieces together in the main process: reads the saved
// settings, runs the anonymous chat listener while alerts are on, applies the
// alert rules to each chat message, and owns the global on/off shortcut.
//
// Everything Electron-specific (the shortcut registry, the listener factory,
// the clock) is passed in, so this can be tested without Electron or a network.
//
// The chat connection only exists while alerts are turned on and a channel is
// known (set by Login with Twitch). Turned off, nothing connects to Twitch.
//
// Settings are re-read by refresh(), which main.js calls on a timer and right
// after the button or shortcut changes something, so edits made anywhere
// (Settings panel, login, logout) take effect within a few seconds.

function createChatAlertService({
  config,
  createListener,   // ({ onMessage, onStatus }) => { start(channel), stop() }
  createGate,       // ({ now }) => { observe, setEnabled, getLastActivityAt }
  globalShortcut,   // Electron's globalShortcut (register / unregister)
  onState = () => {},
  onAlert = () => {},
  now = Date.now
}) {
  const gate = createGate({ now });
  let settings = config.getSettings();
  let listenerStatus = 'idle';
  let registeredHotkey = '';
  let hotkeyError = '';
  let lastSnapshot = '';

  const listener = createListener({
    onMessage: handleMessage,
    onStatus: (status) => { listenerStatus = status; emitIfChanged(); }
  });

  function alertOptions() {
    return {
      ownerLogin: settings.channelLogin,
      ignoreList: settings.chatAlertIgnore,
      quietMinutes: settings.chatAlertQuietMinutes,
      cooldownSeconds: settings.chatAlertCooldownSeconds
    };
  }

  function handleMessage(message) {
    const decision = gate.observe(message, alertOptions());
    if (decision.alert) {
      try { onAlert({ login: message.login, displayName: message.displayName, at: now() }); }
      catch { /* an alert handler bug must not stop chat listening */ }
    }
  }

  function getState() {
    return {
      enabled: Boolean(settings.chatAlertEnabled),
      canListen: Boolean(settings.channelLogin),
      channel: settings.channelLogin || '',
      status: listenerStatus,
      hotkey: settings.chatAlertHotkey,
      hotkeyActive: registeredHotkey !== '',
      hotkeyError,
      lastActivityAt: gate.getLastActivityAt()
    };
  }

  // Tells the window about changes. lastActivityAt is left out of the
  // comparison on purpose: it changes with every chat message, and the window
  // asks for it with getState() when it wants it.
  function emitIfChanged() {
    const { lastActivityAt, ...rest } = getState();
    const snapshot = JSON.stringify(rest);
    if (snapshot === lastSnapshot) return;
    lastSnapshot = snapshot;
    try { onState(getState()); } catch { /* ignore window errors */ }
  }

  function syncListener() {
    if (settings.chatAlertEnabled && settings.channelLogin) {
      try { listener.start(settings.channelLogin); }
      catch { /* an unusable channel name just means nothing to listen to */ }
    } else {
      listener.stop();
    }
  }

  function syncHotkey() {
    const wanted = settings.chatAlertHotkey;
    if (wanted === registeredHotkey && (wanted === '' || hotkeyError === '')) return;

    if (registeredHotkey) {
      try { globalShortcut.unregister(registeredHotkey); } catch { /* already gone */ }
      registeredHotkey = '';
    }
    if (wanted === '') { hotkeyError = ''; return; }

    let ok = false;
    const onPress = () => { try { toggle(); } catch { /* settings could not be saved; try again next press */ } };
    try { ok = globalShortcut.register(wanted, onPress); } catch { ok = false; }
    if (ok) {
      registeredHotkey = wanted;
      hotkeyError = '';
    } else {
      hotkeyError = `The shortcut ${wanted} could not be set. Another program may be using it.`;
    }
  }

  function refresh() {
    try {
      settings = config.getSettings();
    } catch {
      return; // keep working with the last good settings
    }
    gate.setEnabled(settings.chatAlertEnabled);
    syncListener();
    syncHotkey();
    emitIfChanged();
  }

  function setEnabled(value) {
    config.updateSettings({ chatAlertEnabled: Boolean(value) });
    refresh();
    return getState();
  }

  function toggle() {
    return setEnabled(!settings.chatAlertEnabled);
  }

  function shutdown() {
    listener.stop();
    if (registeredHotkey) {
      try { globalShortcut.unregister(registeredHotkey); } catch { /* ignore */ }
      registeredHotkey = '';
    }
  }

  return { refresh, setEnabled, toggle, getState, shutdown };
}

module.exports = { createChatAlertService };
