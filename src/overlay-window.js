// The stream overlay window: opening it, remembering where it was, and
// keeping it on screen. Electron's BrowserWindow and screen are passed in (like
// safeStorage in config.js) so this can be tested without launching Electron.

const DEFAULT_SIZE = Object.freeze({ width: 300, height: 600 });
const MIN_SIZE = Object.freeze({ width: 160, height: 160 });
const WINDOW_TITLE = 'Live Checker Overlay'; // what OBS lists in its Window Capture picker

// Saved position, but only if enough of the window would still be on a
// connected monitor (a monitor may have been unplugged since last time).
// Otherwise keep the saved size and let the system place it.
function visibleBounds(saved, workAreas) {
  if (!saved) return { ...DEFAULT_SIZE };
  const size = { width: saved.width, height: saved.height };
  const onScreen = (workAreas || []).some(area => {
    const overlapX = Math.min(saved.x + saved.width, area.x + area.width) - Math.max(saved.x, area.x);
    const overlapY = Math.min(saved.y + saved.height, area.y + area.height) - Math.max(saved.y, area.y);
    return overlapX >= 80 && overlapY >= 40;
  });
  return onScreen ? { x: saved.x, y: saved.y, ...size } : size;
}

function backgroundColorFor(settings) {
  if (settings.overlayBackground === 'green') return '#00ff00';
  return settings.lightTheme ? '#f4f4f8' : '#05060a';
}

function createOverlayManager({
  BrowserWindow, screen, config, preloadPath, pagePath, iconPath,
  onStateChange = () => {}, saveDelayMs = 500
}) {
  let win = null;
  let saveTimer = null;

  function isOpen() { return Boolean(win) && !win.isDestroyed(); }

  function saveBoundsNow() {
    if (!isOpen() || win.isMinimized()) return; // a minimized window reports a far-off position
    try {
      const b = win.getBounds();
      config.updateSettings({
        overlayBounds: { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }
      });
    } catch { /* not worth interrupting anything for */ }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveBoundsNow, saveDelayMs);
  }

  function open() {
    if (isOpen()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      return true;
    }
    const settings = config.getSettings();
    const workAreas = screen.getAllDisplays().map(d => d.workArea);
    win = new BrowserWindow({
      ...visibleBounds(settings.overlayBounds, workAreas),
      minWidth: MIN_SIZE.width,
      minHeight: MIN_SIZE.height,
      title: WINDOW_TITLE,
      icon: iconPath,
      alwaysOnTop: settings.overlayAlwaysOnTop,
      autoHideMenuBar: true,
      backgroundColor: backgroundColorFor(settings),
      webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false }
    });
    win.removeMenu();
    win.on('page-title-updated', (event) => event.preventDefault()); // keep the title steady for OBS
    win.on('resize', scheduleSave);
    win.on('move', scheduleSave);
    win.on('close', () => { clearTimeout(saveTimer); saveBoundsNow(); });
    win.on('closed', () => { win = null; clearTimeout(saveTimer); onStateChange(false); });
    win.loadFile(pagePath);
    onStateChange(true);
    return true;
  }

  function close() { if (isOpen()) win.close(); }

  function setAlwaysOnTop(flag) {
    const value = Boolean(flag);
    config.updateSettings({ overlayAlwaysOnTop: value });
    if (isOpen()) win.setAlwaysOnTop(value);
  }

  return { open, close, isOpen, setAlwaysOnTop };
}

module.exports = { createOverlayManager, visibleBounds, backgroundColorFor, DEFAULT_SIZE, MIN_SIZE, WINDOW_TITLE };
