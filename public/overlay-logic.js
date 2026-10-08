// Pure helpers for the stream overlay window (public/overlay.js).
// Kept free of any page code so they can be tested from Node.

(function () {
  // How fast the list scrolls, in pixels per second.
  const SPEEDS = Object.freeze({ slow: 25, medium: 45, fast: 80 });
  const MIN_LOOP_SECONDS = 8;

  // The overlay only shows people who are live right now.
  function selectStreams(streams) {
    return (Array.isArray(streams) ? streams : []).filter(s => s && s.isLive);
  }

  function pixelsPerSecond(speed) {
    return SPEEDS[speed] || SPEEDS.medium;
  }

  // Scroll only when the list is taller than the window (1px of slack avoids
  // jitter from rounding).
  function needsScroll(listHeight, viewportHeight) {
    return listHeight > viewportHeight + 1;
  }

  // The list is shown twice, one copy right after the other, and slid up by
  // this distance before starting over. The second copy overlaps the first
  // one's bottom padding (one gap), so the space between the last tile and the
  // first tile of the next lap equals the space between any two tiles.
  function loopDistance(listHeight, gap) {
    return Math.max(0, listHeight - gap);
  }

  function scrollSeconds(distance, speed) {
    return Math.max(MIN_LOOP_SECONDS, distance / pixelsPerSecond(speed));
  }

  const api = { SPEEDS, MIN_LOOP_SECONDS, selectStreams, pixelsPerSecond, needsScroll, loopDistance, scrollSeconds };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.OverlayLogic = api;
})();
