// Tests for the stream overlay: scroll logic (public/overlay-logic.js), the
// window manager (src/overlay-window.js, with a stand-in for Electron's
// BrowserWindow) and the overlay settings (src/config.js).
// Run with: node --test

const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Logic = require('../public/overlay-logic.js');
const { createOverlayManager, visibleBounds, backgroundColorFor, DEFAULT_SIZE, MIN_SIZE, WINDOW_TITLE } = require('../src/overlay-window');
const { createConfig, DEFAULTS } = require('../src/config');

function makeConfig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-overlay-'));
  return createConfig({ dir, safeStorage: { isEncryptionAvailable: () => true } });
}
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- scroll logic ---

test('the overlay shows only people who are live, in the order given', () => {
  const streams = [
    { username: 'a', isLive: true }, { username: 'b', isLive: false },
    { username: 'c', isLive: true }, null, { username: 'd' }
  ];
  assert.deepEqual(Logic.selectStreams(streams).map(s => s.username), ['a', 'c']);
  assert.deepEqual(Logic.selectStreams(undefined), []);
});

test('scrolling starts only when the list is taller than the window', () => {
  assert.equal(Logic.needsScroll(600, 540), true);
  assert.equal(Logic.needsScroll(540, 540), false);
  assert.equal(Logic.needsScroll(540.5, 540), false); // rounding slack
  assert.equal(Logic.needsScroll(0, 540), false);
});

test('the loop distance leaves the same gap at the seam as between tiles', () => {
  assert.equal(Logic.loopDistance(1294, 10), 1284);
  assert.equal(Logic.loopDistance(5, 10), 0);
});

test('speed stays constant in pixels per second, with a sensible minimum loop time', () => {
  assert.equal(Logic.scrollSeconds(1800, 'medium'), 1800 / 45);
  assert.ok(Logic.scrollSeconds(1800, 'fast') < Logic.scrollSeconds(1800, 'medium'));
  assert.ok(Logic.scrollSeconds(1800, 'slow') > Logic.scrollSeconds(1800, 'medium'));
  assert.equal(Logic.scrollSeconds(100, 'fast'), Logic.MIN_LOOP_SECONDS);
  assert.equal(Logic.scrollSeconds(1800, 'warp'), 1800 / 45); // unknown speed falls back to medium
});

// --- settings ---

test('overlay settings have safe defaults', () => {
  const s = makeConfig().getSettings();
  assert.equal(s.overlayAutoOpen, false);
  assert.equal(s.overlayAlwaysOnTop, false);
  assert.equal(s.overlaySpeed, 'medium');
  assert.equal(s.overlayTitles, 'full');
  assert.equal(s.overlayShowViewers, true);
  assert.equal(s.overlayBackground, 'theme');
  assert.equal(s.overlayBounds, null);
  assert.equal(DEFAULTS.overlayBounds, null);
});

test('overlay choices only accept the listed values', () => {
  const cfg = makeConfig();
  assert.equal(cfg.updateSettings({ overlaySpeed: 'slow' }).overlaySpeed, 'slow');
  assert.equal(cfg.updateSettings({ overlayTitles: 'one-line' }).overlayTitles, 'one-line');
  assert.equal(cfg.updateSettings({ overlayTitles: 'off' }).overlayTitles, 'off');
  assert.equal(cfg.updateSettings({ overlayBackground: 'green' }).overlayBackground, 'green');
  assert.throws(() => cfg.updateSettings({ overlaySpeed: 'warp' }), /overlaySpeed/);
  assert.throws(() => cfg.updateSettings({ overlayTitles: 'tiny' }), /overlayTitles/);
  assert.throws(() => cfg.updateSettings({ overlayBackground: 'url(x)' }), /overlayBackground/);
  assert.throws(() => cfg.updateSettings({ overlayShowViewers: 'yes' }), /overlayShowViewers/);
  assert.throws(() => cfg.updateSettings({ overlayAutoOpen: 1 }), /overlayAutoOpen/);
});

test('overlayBounds accepts a sensible window rectangle (including negative multi-monitor positions) or null', () => {
  const cfg = makeConfig();
  const bounds = { x: -1200, y: 40, width: 280, height: 540 };
  assert.deepEqual(cfg.updateSettings({ overlayBounds: bounds }).overlayBounds, bounds);
  assert.deepEqual(cfg.getSettings().overlayBounds, bounds);
  assert.equal(cfg.updateSettings({ overlayBounds: null }).overlayBounds, null);
});

test('overlayBounds rejects junk', () => {
  const cfg = makeConfig();
  for (const bad of [{}, { x: 1, y: 1, width: 300 }, { x: 1.5, y: 1, width: 300, height: 300 },
    { x: 0, y: 0, width: 5, height: 300 }, { x: 0, y: 0, width: 300, height: 99999 },
    { x: 99999, y: 0, width: 300, height: 300 }, 'big', 7]) {
    assert.throws(() => cfg.updateSettings({ overlayBounds: bad }), /overlayBounds/);
  }
});

// --- window position helper ---

const SCREEN = [{ x: 0, y: 0, width: 1920, height: 1040 }];

test('with nothing saved, the overlay opens at its default size and lets the system place it', () => {
  assert.deepEqual(visibleBounds(null, SCREEN), DEFAULT_SIZE);
});

test('a saved position on a connected monitor is restored', () => {
  const saved = { x: 1600, y: 20, width: 280, height: 540 };
  assert.deepEqual(visibleBounds(saved, SCREEN), saved);
});

test('a saved position on a monitor that is gone keeps the size but drops the position', () => {
  const saved = { x: -2000, y: 100, width: 280, height: 540 };
  assert.deepEqual(visibleBounds(saved, SCREEN), { width: 280, height: 540 });
  assert.deepEqual(visibleBounds({ x: 5000, y: 0, width: 280, height: 540 }, SCREEN), { width: 280, height: 540 });
});

test('a window mostly off the edge is still restored if enough of it is visible, but not if only a sliver is', () => {
  assert.equal(visibleBounds({ x: 1800, y: 0, width: 280, height: 540 }, SCREEN).x, 1800);       // 120px showing
  assert.equal(visibleBounds({ x: 1900, y: 0, width: 280, height: 540 }, SCREEN).x, undefined);  // 20px showing
});

test('a saved position on a second monitor is restored when that monitor is connected', () => {
  const two = [...SCREEN, { x: -1920, y: 0, width: 1920, height: 1080 }];
  const saved = { x: -400, y: 50, width: 280, height: 540 };
  assert.deepEqual(visibleBounds(saved, two), saved);
});

test('the window background matches the chosen look, so it never flashes the wrong color', () => {
  assert.equal(backgroundColorFor({ overlayBackground: 'green', lightTheme: false }), '#00ff00');
  assert.equal(backgroundColorFor({ overlayBackground: 'green', lightTheme: true }), '#00ff00');
  assert.equal(backgroundColorFor({ overlayBackground: 'theme', lightTheme: false }), '#05060a');
  assert.equal(backgroundColorFor({ overlayBackground: 'theme', lightTheme: true }), '#f4f4f8');
});

// --- window manager, with a stand-in BrowserWindow ---

class FakeWindow extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.destroyed = false;
    this.minimized = false;
    this.alwaysOnTop = options.alwaysOnTop;
    this.bounds = { x: options.x ?? 100, y: options.y ?? 100, width: options.width, height: options.height };
    this.calls = [];
    FakeWindow.created.push(this);
  }
  removeMenu() { this.calls.push('removeMenu'); }
  loadFile(file) { this.loadedFile = file; }
  isDestroyed() { return this.destroyed; }
  isMinimized() { return this.minimized; }
  restore() { this.minimized = false; this.calls.push('restore'); }
  show() { this.calls.push('show'); }
  focus() { this.calls.push('focus'); }
  getBounds() { return this.bounds; }
  setAlwaysOnTop(flag) { this.alwaysOnTop = flag; }
  close() { this.emit('close'); this.destroyed = true; this.emit('closed'); }
}

function setup(overrides = {}) {
  FakeWindow.created = [];
  const config = makeConfig();
  const states = [];
  const manager = createOverlayManager({
    BrowserWindow: FakeWindow,
    screen: { getAllDisplays: () => [{ workArea: SCREEN[0] }] },
    config,
    preloadPath: '/app/preload.js',
    pagePath: '/app/public/overlay.html',
    iconPath: '/app/icon.png',
    onStateChange: (open) => states.push(open),
    saveDelayMs: 5,
    ...overrides
  });
  return { manager, config, states };
}

test('opening creates a titled, resizable window that loads the overlay page with the same safe settings as the main window', () => {
  const { manager, states } = setup();
  assert.equal(manager.isOpen(), false);
  manager.open();
  const win = FakeWindow.created[0];
  assert.equal(FakeWindow.created.length, 1);
  assert.equal(manager.isOpen(), true);
  assert.equal(win.options.title, WINDOW_TITLE);
  assert.equal(win.options.width, DEFAULT_SIZE.width);
  assert.equal(win.options.minWidth, MIN_SIZE.width);
  assert.equal(win.options.webPreferences.preload, '/app/preload.js');
  assert.equal(win.options.webPreferences.contextIsolation, true);
  assert.equal(win.options.webPreferences.nodeIntegration, false);
  assert.equal(win.loadedFile, '/app/public/overlay.html');
  assert.ok(win.calls.includes('removeMenu'));
  assert.deepEqual(states, [true]);
});

test('opening again brings the existing window forward instead of making a second one', () => {
  const { manager } = setup();
  manager.open();
  const win = FakeWindow.created[0];
  win.minimized = true;
  manager.open();
  assert.equal(FakeWindow.created.length, 1);
  assert.ok(win.calls.includes('restore') && win.calls.includes('show') && win.calls.includes('focus'));
});

test('the window keeps its title even if the page tries to change it (OBS finds it by title)', () => {
  const { manager } = setup();
  manager.open();
  let prevented = false;
  FakeWindow.created[0].emit('page-title-updated', { preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
});

test('closing the window reports closed, so the Settings button can switch back', () => {
  const { manager, states } = setup();
  manager.open();
  manager.close();
  assert.equal(manager.isOpen(), false);
  assert.deepEqual(states, [true, false]);
  manager.open(); // and it can be opened again
  assert.equal(FakeWindow.created.length, 2);
  assert.equal(manager.isOpen(), true);
});

test('close() with nothing open does nothing', () => {
  const { manager, states } = setup();
  manager.close();
  assert.deepEqual(states, []);
});

test('moving or resizing saves the position shortly after, and the next launch reuses it', async () => {
  const { manager, config } = setup();
  manager.open();
  const win = FakeWindow.created[0];
  win.bounds = { x: 1500, y: 30, width: 266, height: 540 };
  win.emit('resize'); win.emit('move'); win.emit('resize');
  assert.equal(config.getSettings().overlayBounds, null); // not yet: waits until the dragging settles
  await wait(40);
  assert.deepEqual(config.getSettings().overlayBounds, { x: 1500, y: 30, width: 266, height: 540 });
  manager.close();

  manager.open();
  const next = FakeWindow.created[1];
  assert.equal(next.options.x, 1500);
  assert.equal(next.options.width, 266);
  assert.equal(next.options.height, 540);
});

test('the position is saved when the window closes, even if closed straight after moving', () => {
  const { manager, config } = setup();
  manager.open();
  FakeWindow.created[0].bounds = { x: 700, y: 60, width: 300, height: 620 };
  manager.close();
  assert.deepEqual(config.getSettings().overlayBounds, { x: 700, y: 60, width: 300, height: 620 });
});

test('a minimized window (which reports a far-off position) never overwrites the saved position', async () => {
  const { manager, config } = setup();
  manager.open();
  const win = FakeWindow.created[0];
  win.bounds = { x: 800, y: 80, width: 300, height: 600 };
  win.emit('move'); await wait(40);
  win.minimized = true;
  win.bounds = { x: -32000, y: -32000, width: 160, height: 28 };
  win.emit('move'); await wait(40);
  assert.deepEqual(config.getSettings().overlayBounds, { x: 800, y: 80, width: 300, height: 600 });
});

test('a saved position on a monitor that is no longer connected is not used', () => {
  const { manager, config } = setup();
  config.updateSettings({ overlayBounds: { x: -3000, y: 0, width: 280, height: 540 } });
  manager.open();
  const options = FakeWindow.created[0].options;
  assert.equal(options.x, undefined);
  assert.equal(options.width, 280);
});

test('keep-on-top is saved, and applied to a window that is already open', () => {
  const { manager, config } = setup();
  manager.open();
  const win = FakeWindow.created[0];
  assert.equal(win.alwaysOnTop, false);
  manager.setAlwaysOnTop(true);
  assert.equal(win.alwaysOnTop, true);
  assert.equal(config.getSettings().overlayAlwaysOnTop, true);
  manager.close();
  manager.open();
  assert.equal(FakeWindow.created[1].options.alwaysOnTop, true); // and remembered for next time
});

test('keep-on-top can be set while the overlay is closed', () => {
  const { manager, config } = setup();
  manager.setAlwaysOnTop(true);
  assert.equal(config.getSettings().overlayAlwaysOnTop, true);
  assert.equal(manager.isOpen(), false);
});

test('the green background setting colors the window from the first frame', () => {
  const { manager, config } = setup();
  config.updateSettings({ overlayBackground: 'green' });
  manager.open();
  assert.equal(FakeWindow.created[0].options.backgroundColor, '#00ff00');
});
