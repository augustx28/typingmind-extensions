/* TypingMind: warmer light-gray AI response text.
 * Changes the dark-mode prose body color, leaving separate heading,
 * bold, link, code, and highlight color rules intact.
 * Disable this script and refresh to restore the original styling.
 */
(() => {
  'use strict';

  const TEXT_COLOR = '#dedbd7';
  const STYLE_ID = 'tm-warm-gray-response-text';

  function install() {
    let style = document.getElementById(STYLE_ID);

    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }

    style.textContent = `
      [data-element-id="ai-response"].prose {
        --tw-prose-invert-body: ${TEXT_COLOR} !important;
      }
    `;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
