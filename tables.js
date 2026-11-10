/* ============================================================
   TypingMind Table Tweaks  v1.0
   1) Rounder corners on chat tables (light + dark mode)
   2) Dark mode header row: gray #374151 -> black
   Only the two values below need editing.
   ============================================================ */
(() => {
  const STYLE_ID = 'tm-table-tweaks-v1';

  const RADIUS = 12;                // corner roundness in px. Higher = curvier
  const HEADER_BG_DARK = '#000000'; // dark mode header row color

  const INNER = Math.max(RADIUS - 1, 0); // corner cells sit inside the 1px border

  const CSS = `
    /* 1) Rounder corners. .tm-table is the scroll box around each table and
          clips everything inside it, so the header row follows the curve. */
    .tm-table {
      border-radius: ${RADIUS}px !important;
    }

    /* 1b) Same curve on the <table> and its 4 corner cells, in case the
           border is drawn on the table itself. Does nothing otherwise. */
    .tm-table > table {
      border-radius: ${RADIUS}px !important;
    }
    .tm-table > table > thead > tr:first-child > :first-child {
      border-top-left-radius: ${INNER}px !important;
    }
    .tm-table > table > thead > tr:first-child > :last-child {
      border-top-right-radius: ${INNER}px !important;
    }
    .tm-table > table > tbody > tr:last-child > :first-child {
      border-bottom-left-radius: ${INNER}px !important;
    }
    .tm-table > table > tbody > tr:last-child > :last-child {
      border-bottom-right-radius: ${INNER}px !important;
    }

    /* 2) Dark mode header: black instead of #374151. The color goes on the
          header cells only (thead and row cleared), so it can't poke out
          past the rounded corners. */
    .dark .tm-table thead,
    .dark .tm-table thead > tr {
      background-color: transparent !important;
      background-image: none !important;
    }
    .dark .tm-table thead > tr > th,
    .dark .tm-table thead > tr > td {
      background-color: ${HEADER_BG_DARK} !important;
      background-image: none !important;
    }
  `;

  function inject() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
