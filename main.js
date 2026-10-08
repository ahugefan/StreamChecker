const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, safeStorage, dialog, clipboard, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { createConfig } = require('./src/config');
const { createTwitchClient } = require('./src/twitch');
const { createTokenStore } = require('./src/token-store');
const { createShoutoutEngine } = require('./src/shoutout-engine');
const { sendChatMessage } = require('./src/chat');
const { createServer } = require('./src/server');
const { runLoginFlow } = require('./src/login-flow');
const { installSound, readCustomSound, removeCustomSounds } = require('./src/sound');
const { createOverlayManager } = require('./src/overlay-window');

const SHOUTOUT_CHECK_INTERVAL_MS = 60_000;

let mainWindow = null;
let tray = null;
let quitting = false;
let serverInfo = null; // { port, sessionKey }
let config = null;
let loginInProgress = false;
let shoutoutTimer = null;
let overlay = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}
app.on('second-instance', () => {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
});

async function runLogin(scopes) {
  // Only one login attempt (one local listener on port 3000) at a time.
  if (loginInProgress) throw new Error('A login attempt is already in progress.');
  loginInProgress = true;
  try {
    return await runLoginFlow({
      getClientId: () => config.getSettings().clientId,
      getClientSecret: () => config.getSecret('clientSecret'),
      scopes,
      openExternal: (url) => shell.openExternal(url)
    });
  } finally {
    loginInProgress = false;
  }
}

async function startBackend() {
  const configDir = path.join(app.getPath('userData'), 'config');
  config = createConfig({ dir: configDir, safeStorage });

  overlay = createOverlayManager({
    BrowserWindow,
    screen,
    config,
    preloadPath: path.join(__dirname, 'preload.js'),
    pagePath: path.join(__dirname, 'public', 'overlay.html'),
    iconPath: path.join(__dirname, 'public', 'icons', 'app-icon.png'),
    // Lets the Settings button in the main window say "Open" or "Close" correctly.
    onStateChange: (open) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('overlay-state', open);
    }
  });

  const getClientId = () => config.getSettings().clientId;
  const getClientSecret = () => config.getSecret('clientSecret');

  const twitchClient = createTwitchClient({ getClientId, getClientSecret });
  const tokenStore = createTokenStore({ config, getClientId, getClientSecret });
  const shoutoutEngine = createShoutoutEngine({
    config,
    twitchClient,
    getAccessToken: (role) => tokenStore.getValidAccessToken(role),
    sendChatMessage
  });

  const server = createServer({ config, twitchClient, runLogin, tokenStore, shoutoutEngine });
  const { port, sessionKey } = await server.listen(3300, 20);
  serverInfo = { port, sessionKey };

  // Checks live status and sends any pending shoutouts on a timer. Errors
  // here (e.g. Twitch briefly unreachable) are logged, not fatal - the next
  // tick tries again.
  shoutoutTimer = setInterval(() => {
    shoutoutEngine.runOnce().catch(err => console.error('[shoutout]', err.message));
  }, SHOUTOUT_CHECK_INTERVAL_MS);
}

// Renderer asks for this once at startup instead of the port/key being
// guessable from a URL or an environment variable.
ipcMain.handle('get-server-info', () => serverInfo);

// Which page to load first: the wizard, until setup has been completed once.
ipcMain.handle('get-launch-page', () => {
  const done = config ? config.getSettings().setupComplete : false;
  return done ? 'index.html' : 'setup.html';
});

ipcMain.handle('go-to-dashboard', () => {
  if (mainWindow) mainWindow.loadFile(path.join(__dirname, 'public', 'index.html'));
});

ipcMain.handle('export-streamers', async (_event, streamers) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Export Streamers',
    defaultPath: 'streamers_export.txt',
    filters: [{ name: 'Text Files', extensions: ['txt'] }]
  });
  if (canceled || !filePath) return { success: false };
  try {
    fs.writeFileSync(filePath, streamers.join('\n'), 'utf-8');
    return { success: true, filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('choose-streamers-file', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Choose Streamers File',
    filters: [{ name: 'Text Files', extensions: ['txt'] }],
    properties: ['openFile']
  });
  if (result.canceled || !result.filePaths.length) return null;
  const content = fs.readFileSync(result.filePaths[0], 'utf-8');
  return { filePath: result.filePaths[0], content };
});

// --- Custom live-alert sound ---
// The chosen file is copied into the app's config folder (see src/sound.js),
// so the setting only ever stores a fixed file name, never a path.

ipcMain.handle('choose-sound-file', async () => {
  if (!config) return { ok: false, error: 'Settings are not available right now.' };
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose Live Alert Sound',
    filters: [{ name: 'Sound Files', extensions: ['mp3', 'wav', 'ogg'] }],
    properties: ['openFile']
  });
  if (result.canceled || !result.filePaths.length) return null;
  try {
    const installed = installSound({ sourcePath: result.filePaths[0], dir: config.dir });
    const updated = config.updateSettings(installed);
    return { ok: true, soundFile: updated.soundFile, soundLabel: updated.soundLabel };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('get-custom-sound', () => {
  if (!config) return null;
  return readCustomSound({ dir: config.dir, soundFile: config.getSettings().soundFile });
});

ipcMain.handle('reset-sound', () => {
  if (!config) return { ok: false };
  removeCustomSounds(config.dir);
  config.updateSettings({ soundFile: '', soundLabel: '' });
  return { ok: true };
});

// --- Stream overlay window ---

ipcMain.handle('overlay-open', () => (overlay ? overlay.open() : false));
ipcMain.handle('overlay-close', () => { if (overlay) overlay.close(); return true; });
ipcMain.handle('overlay-is-open', () => Boolean(overlay && overlay.isOpen()));
ipcMain.handle('overlay-set-always-on-top', (_event, flag) => {
  if (overlay) overlay.setAlwaysOnTop(Boolean(flag));
  return true;
});

ipcMain.handle('copy-to-clipboard', (_event, text) => {
  clipboard.writeText(text || '');
  return true;
});

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, 'public', 'icons', 'app-icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  const launchPage = config && config.getSettings().setupComplete ? 'index.html' : 'setup.html';
  mainWindow.loadFile(path.join(__dirname, 'public', launchPage));
  mainWindow.on('close', (event) => {
    if (!quitting) { event.preventDefault(); mainWindow.hide(); }
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'public', 'icons', 'tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('Twitch Live Checker');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show', click: () => mainWindow && mainWindow.show() },
    { label: 'Open Overlay', click: () => overlay && overlay.open() },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on('click', () => mainWindow && mainWindow.show());
}

app.whenReady().then(async () => {
  try {
    await startBackend();
  } catch (err) {
    dialog.showErrorBox('Twitch Live Checker', `Could not start the local server:\n${err.message}`);
  }
  await createWindow();
  createTray();
  // Bring the stream overlay back automatically if the user asked for that
  // (and setup has been finished, so there is something to show).
  if (config && overlay) {
    const settings = config.getSettings();
    if (settings.setupComplete && settings.overlayAutoOpen) overlay.open();
  }
});

app.on('before-quit', () => {
  quitting = true;
  if (shoutoutTimer) clearInterval(shoutoutTimer);
});
