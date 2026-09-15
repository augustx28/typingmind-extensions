/* TypingMind: adjustable dark-mode AI response colors.
 * Edit the COLORS settings below, then save and refresh TypingMind.
 * An empty string ('') leaves that color setting unchanged.
 * Uses the same prose color variables as the original working script.
 * Disable this script and refresh to restore the original styling.
 */
(() => {
  'use strict';

  // EDIT COLORS HERE. Example: bold: '#eeeae5'
  const COLORS = {
    body: '#dedbd7', // Regular response text: warm light gray
    bold: 'dedbd7',        // Bold text
    headings: 'dedbd7',    // Shared heading color, including table headers
    bullets: 'dedbd7',     // Bullet dots only, not the text beside them
    numbers: 'dedbd7'      // Automatic list numbers only, not typed numbers
  };

  const STYLE_ID = 'tm-warm-gray-response-text';

  const VARIABLES = {
    body: '--tw-prose-invert-body',
    bold: '--tw-prose-invert-bold',
    headings: '--tw-prose-invert-headings',
    bullets: '--tw-prose-invert-bullets',
    numbers: '--tw-prose-invert-counters'
  };

  function install() {
    const declarations = Object.entries(COLORS)
      .filter(([, color]) =>
        typeof color === 'string' &&
        /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color.trim())
      )
      .map(([key, color]) =>
        `${VARIABLES[key]}: ${color.trim()} !important;`
      )
      .join('\n');

    let style = document.getElementById(STYLE_ID);

    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }

    style.textContent = `
      [data-element-id="ai-response"].prose {
        ${declarations}
      }
    `;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
