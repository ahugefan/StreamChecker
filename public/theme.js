// Accent-color theming. Loaded in <head> so a saved theme can be applied
// before the first paint (no flash of the default color on launch).
//
// One accent color drives the buttons, highlights and borders. From it we
// derive the other colors that need to stay readable:
//   --on-accent    text color on accent-filled buttons (white or near-black)
//   --accent-text  the accent when used as text/headings on the current
//                  background, lightened or darkened only if it would be hard to read
//
// Also loadable from Node (module.exports) so the color math can be tested.

(function () {
  const DEFAULT_ACCENT = '#9146ff';
  const SURFACES = { dark: '#0d0f17', light: '#ffffff' }; // the Settings panel background in each mode
  const CACHE_KEY = 'liveChecker.theme';

  const PRESETS = [
    { name: 'Twitch Purple', color: '#9146ff' },
    { name: 'Calm Blue', color: '#3b82f6' },
    { name: 'Teal', color: '#14b8a6' },
    { name: 'Forest Green', color: '#16a34a' },
    { name: 'Sunset Orange', color: '#f97316' },
    { name: 'Rose', color: '#f43f5e' }
  ];

  function hexToRgb(hex) {
    const m = /^#([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgbToHex(rgb) {
    return '#' + rgb.map(c => Math.round(c).toString(16).padStart(2, '0')).join('');
  }

  function luminance(rgb) {
    const [r, g, b] = rgb.map(c => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  // WCAG contrast ratio: 1 (identical) to 21 (black on white).
  function contrast(hexA, hexB) {
    const a = luminance(hexToRgb(hexA));
    const b = luminance(hexToRgb(hexB));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }

  function mix(hexA, hexB, t) {
    const a = hexToRgb(hexA), b = hexToRgb(hexB);
    return rgbToHex(a.map((c, i) => c + (b[i] - c) * t));
  }

  // White text unless the accent is too light for it.
  function onAccent(hex) {
    return contrast(hex, '#ffffff') >= 3.5 ? '#ffffff' : '#111111';
  }

  // The accent as text on a given surface: unchanged if already readable,
  // otherwise nudged toward white (dark surface) or black (light surface).
  function readableOn(hex, surface, min = 3) {
    const toward = luminance(hexToRgb(surface)) < 0.5 ? '#ffffff' : '#000000';
    let out = hex;
    for (let t = 0.1; contrast(out, surface) < min && t <= 1.0001; t += 0.1) {
      out = mix(hex, toward, t);
    }
    return out;
  }

  // Rejects colors that would nearly vanish into the background.
  function isVisible(hex, light) {
    if (!hexToRgb(hex)) return false;
    return contrast(hex, light ? SURFACES.light : SURFACES.dark) >= 1.8;
  }

  function vars(hex, light) {
    const accent = hexToRgb(hex) ? String(hex).toLowerCase() : DEFAULT_ACCENT;
    return {
      '--accent': accent,
      '--accent-rgb': hexToRgb(accent).join(' '),
      '--on-accent': onAccent(accent),
      '--accent-text': readableOn(accent, light ? SURFACES.light : SURFACES.dark)
    };
  }

  function apply(root, hex, light) {
    for (const [name, value] of Object.entries(vars(hex, light))) {
      root.style.setProperty(name, value);
    }
  }

  // Remembers the last theme in this window's own storage purely so the next
  // launch can paint it immediately. settings.json stays the source of truth.
  function cache(accent, light) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ accent, light: Boolean(light) })); }
    catch { /* storage unavailable - harmless */ }
  }

  function applyCached() {
    try {
      const saved = JSON.parse(localStorage.getItem(CACHE_KEY));
      if (saved && hexToRgb(saved.accent)) {
        apply(document.documentElement, saved.accent, Boolean(saved.light));
        return saved;
      }
    } catch { /* ignore */ }
    return null;
  }

  const api = {
    DEFAULT_ACCENT, PRESETS, SURFACES,
    hexToRgb, contrast, onAccent, readableOn, isVisible, vars, apply, cache, applyCached
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') {
    window.ThemeUtil = api;
    const saved = applyCached();
    if (saved && saved.light) {
      document.addEventListener('DOMContentLoaded', () => document.body.classList.add('light-theme'));
    }
  }
})();
