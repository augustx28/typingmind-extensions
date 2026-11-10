/* ============================================================
   TypingMind Table Tweaks  v2.0
   - Rounded corners drawn by the table itself, so the outer line
     follows the curve on all 4 corners (chat + expanded view)
   - Warm gray grid lines instead of TypingMind's blue-gray
   - Dark mode header row: black
   - Expanded table view: navy panel -> warm dark gray
   Only the values in SETTINGS need editing.
   ============================================================ */
(() => {
  const EXT_ID = 'tm-table-tweaks';
  if (window.__tmTableTweaks) return; // already running
  window.__tmTableTweaks = true;

  /* ---------------- SETTINGS ---------------- */
  const RADIUS = 12;                 // corner roundness in px
  const HEADER_BG_DARK = '#000000';  // dark mode header row
  const FRAME_DARK = '#4a4744';      // dark mode outer line
  const LINE_DARK = '#3a3836';       // dark mode inner lines
  const PANEL_DARK = '#282624';      // expanded view panel (was navy #0f172a)
  const FRAME_LIGHT = '#d6d3d1';     // light mode outer line
  const LINE_LIGHT = '#e7e5e4';      // light mode inner lines
  /* ------------------------------------------ */

  const STYLE_ID = EXT_ID + '-style';
  const INNER = Math.max(RADIUS - 1, 0);
  const T = '.tm-table table';

  const CSS = `
    /* 1) The table draws its own rounded frame. TypingMind uses
          border-collapse: collapse, which ignores border-radius, so the
          outer line stayed square and got clipped at the corners. */
    ${T} {
      --tmtt-frame: ${FRAME_LIGHT};
      --tmtt-line: ${LINE_LIGHT};
      border-collapse: separate !important;
      border-spacing: 0 !important;
      border: 1px solid var(--tmtt-frame) !important;
      border-radius: ${RADIUS}px !important;
    }
    .dark ${T} {
      --tmtt-frame: ${FRAME_DARK};
      --tmtt-line: ${LINE_DARK};
    }

    /* 2) Grid: each cell draws only its right and bottom line,
          so no line is ever doubled up. */
    ${T} > * > tr > * {
      border: 0 !important;
      border-right: 1px solid var(--tmtt-line) !important;
      border-bottom: 1px solid var(--tmtt-line) !important;
    }
    ${T} > * > tr > :last-child {
      border-right: 0 !important;
    }
    ${T} > :last-child > tr:last-child > * {
      border-bottom: 0 !important;
    }

    /* 3) Corner cells follow the frame's curve. */
    ${T} > :first-child > tr:first-child > :first-child {
      border-top-left-radius: ${INNER}px !important;
    }
    ${T} > :first-child > tr:first-child > :last-child {
      border-top-right-radius: ${INNER}px !important;
    }
    ${T} > :last-child > tr:last-child > :first-child {
      border-bottom-left-radius: ${INNER}px !important;
    }
    ${T} > :last-child > tr:last-child > :last-child {
      border-bottom-right-radius: ${INNER}px !important;
    }

    /* 4) Dark mode header: black, painted on the cells only so it
          stays inside the rounded corners. */
    .dark ${T} > thead,
    .dark ${T} > thead > tr {
      background-color: transparent !important;
      background-image: none !important;
    }
    .dark ${T} > thead > tr > * {
      background-color: ${HEADER_BG_DARK} !important;
      background-image: none !important;
    }
  `;

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  /* ---------- Expanded view: navy panel -> warm gray ----------
     The expanded table sits on a navy (slate-900) panel. Instead of
     guessing TypingMind's class names, this checks each table box and
     its 3 nearest parents and repaints only dark blue backgrounds.
     Everything else is left alone. */
  const PANEL_RGB = [1, 3, 5].map((i) => parseInt(PANEL_DARK.slice(i, i + 2), 16)).join(', ');
  const seen = new WeakSet();
  let probe = null;

  function isDark() {
    return document.documentElement.classList.contains('dark') ||
      (document.body && document.body.classList.contains('dark'));
  }

  // Reads any CSS color (rgb, hex, oklch...) as [r, g, b, a] via a 1px canvas.
  function readColor(css) {
    if (!css || css === 'transparent' || css === 'rgba(0, 0, 0, 0)') return null;
    if (!probe) {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      probe = c.getContext('2d', { willReadFrequently: true });
    }
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = '#000';
    probe.fillStyle = css;
    probe.fillRect(0, 0, 1, 1);
    const d = probe.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  }

  function isDarkBlue(c) {
    if (!c) return false;
    const [r, g, b, a] = c;
    return a > 0.3 && b - r >= 8 && b >= g && Math.max(r, g, b) < 100;
  }

  function warmPanels() {
    if (!isDark()) return;
    document.querySelectorAll('.tm-table').forEach((box) => {
      if (seen.has(box)) return;
      seen.add(box);
      let el = box;
      for (let i = 0; i < 4 && el && el !== document.body; i++, el = el.parentElement) {
        const c = readColor(getComputedStyle(el).backgroundColor);
        if (isDarkBlue(c)) {
          el.style.setProperty('background-color', `rgba(${PANEL_RGB}, ${c[3]})`, 'important');
        }
      }
    });
  }

  // Only watches for added/removed elements (never attributes), at most
  // one cheap scan per frame, so it can't loop or slow down streaming.
  let queued = false;
  function queueScan() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      warmPanels();
    });
  }

  function start() {
    injectStyle();
    warmPanels();
    new MutationObserver(queueScan).observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
