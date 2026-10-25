// Plays an alert sound: the built-in one, or the user's own file, falling back
// to the built-in one if the user's file cannot be played. Everything the
// browser provides (Audio, object URLs) is passed in, so this can be tested
// in Node. In the page it is available as the global AlertPlayer.

(function (root) {
  function createAlertPlayer({ defaultUrl, getVolume, getCustom, makeUrl, revokeUrl, AudioImpl }) {
    let audio = new AudioImpl(defaultUrl);
    let objectUrl = null;
    let usingCustom = false;

    function volume() {
      const v = Number(getVolume());
      return Math.min(1, Math.max(0, (Number.isFinite(v) ? v : 100) / 100));
    }

    function useDefault() {
      if (objectUrl) { revokeUrl(objectUrl); objectUrl = null; }
      audio = new AudioImpl(defaultUrl);
      usingCustom = false;
    }

    // Call after the saved sound changes. hasCustom says whether the settings
    // name a custom file; getCustom() returns { mime, bytes } or null.
    async function load(hasCustom) {
      useDefault();
      if (!hasCustom) return;
      try {
        const data = await getCustom();
        if (data) {
          objectUrl = makeUrl(data);
          audio = new AudioImpl(objectUrl);
          usingCustom = true;
        }
      } catch { /* keep the built-in sound */ }
    }

    // 'ok', 'fallback' (the custom sound failed, so the built-in one played)
    // or 'failed' (nothing could be played).
    async function play() {
      try {
        audio.volume = volume();
        audio.currentTime = 0;
        await audio.play();
        return 'ok';
      } catch {
        if (!usingCustom) return 'failed';
      }
      useDefault();
      try {
        audio.volume = volume();
        await audio.play();
        return 'fallback';
      } catch {
        return 'failed';
      }
    }

    return { load, play, isCustom: () => usingCustom };
  }

  // "just now", "42 sec ago", "5 min ago", "3 h ago", "2 d ago".
  function formatAgo(ms) {
    if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
    const seconds = Math.floor(Math.max(0, ms) / 1000);
    if (seconds < 10) return 'just now';
    if (seconds < 60) return `${seconds} sec ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    return `${Math.floor(hours / 24)} d ago`;
  }

  const api = { createAlertPlayer, formatAgo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AlertPlayer = api;
})(typeof window !== 'undefined' ? window : globalThis);
