// Turns a key press into a shortcut string such as "Ctrl+Alt+C", for the
// "click here, then press the keys" shortcut field in Settings.
//
// Pure logic (no page access), so it can be tested in Node. In the page it is
// available as the global HotkeyUtil; in Node it is exported.

(function (root) {
  const MODIFIER_CODES = new Set([
    'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight',
    'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight', 'OS', 'AltGraph'
  ]);

  const NAMED_KEYS = {
    Space: 'Space', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
    Enter: 'Enter', NumpadEnter: 'Enter', Home: 'Home', End: 'End',
    PageUp: 'PageUp', PageDown: 'PageDown',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right'
  };

  function keyNameFromCode(code) {
    let m = /^Key([A-Z])$/.exec(code);
    if (m) return m[1];
    m = /^Digit(\d)$/.exec(code);
    if (m) return m[1];
    m = /^F(\d{1,2})$/.exec(code);
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= 24) return `F${Number(m[1])}`;
    return NAMED_KEYS[code] || null;
  }

  // event: { code, ctrlKey, altKey, shiftKey, metaKey }
  // Returns one of:
  //   null                       only a modifier is down so far; keep waiting
  //   { cancel: true }           Escape was pressed
  //   { error: 'message' }       a key combination that cannot be used
  //   { accelerator: 'Ctrl+C' }  a usable shortcut
  function fromKeyEvent(event) {
    const code = String((event && event.code) || '');
    if (!code || MODIFIER_CODES.has(code)) return null;
    if (code === 'Escape') return { cancel: true };

    const key = keyNameFromCode(code);
    if (!key) return { error: 'That key cannot be used in a shortcut. Try a letter, number or function key.' };

    const modifiers = [];
    if (event.ctrlKey) modifiers.push('Ctrl');
    if (event.altKey) modifiers.push('Alt');
    if (event.shiftKey) modifiers.push('Shift');
    if (event.metaKey) modifiers.push('Super');

    // Shift alone is still ordinary typing, so another modifier is required.
    if (!modifiers.some((m) => m !== 'Shift')) {
      return { error: 'Hold Ctrl, Alt or the Windows key while you press the key.' };
    }
    return { accelerator: [...modifiers, key].join('+') };
  }

  // "CommandOrControl+Alt+C" reads better as "Ctrl+Alt+C" on Windows.
  function displayName(accelerator) {
    return String(accelerator || '')
      .replace(/CommandOrControl|CmdOrCtrl|Control/gi, 'Ctrl')
      .replace(/Super/gi, 'Win');
  }

  const api = { fromKeyEvent, displayName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HotkeyUtil = api;
})(typeof window !== 'undefined' ? window : globalThis);
