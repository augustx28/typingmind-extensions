// TypingMind Outline: larger fonts and improved heading hierarchy.
// Paste AFTER your existing outline script.

;(function () {
  'use strict';

  // Increase these numbers if you want larger text later.
  const DESKTOP_BOOST_PX = 2;
  const MOBILE_BOOST_PX = 3;

  const START = '/* tm-outline-readability:start */';
  const END = '/* tm-outline-readability:end */';

  function applyReadability() {
    const style = document.getElementById('tm-page-outline-styles');

    if (!style) {
      console.warn(
        '[Page Outline] Place this add-on after the original outline script.'
      );
      return;
    }

    // Replace previous add-on styles without creating duplicates.
    let originalCSS = style.textContent;
    const startIndex = originalCSS.indexOf(START);
    const endIndex = originalCSS.indexOf(END, startIndex);

    if (startIndex !== -1 && endIndex !== -1) {
      originalCSS =
        originalCSS.slice(0, startIndex) +
        originalCSS.slice(endIndex + END.length);
    }

    style.textContent = originalCSS + `
      ${START}

      /* Panel sizing and appearance */

      #tm-page-outline-panel,
      #tm-page-outline-panel * {
        box-sizing: border-box;
      }

      #tm-page-outline-panel {
        --tm-outline-font-boost: ${DESKTOP_BOOST_PX}px;
        width: 290px;
        max-width: calc(100vw - 16px);
        overflow-x: hidden;
        border-radius: 12px;
        font-size: calc(12px + var(--tm-outline-font-boost));
        color: #242428;
        scroll-padding-block: 48px 8px;
        box-shadow: 0 8px 28px rgba(0, 0, 0, 0.13);
      }

      .dark #tm-page-outline-panel {
        color: #e6e6e9;
        box-shadow: 0 8px 28px rgba(0, 0, 0, 0.4);
      }

      /* Panel header */

      #tm-page-outline-panel .outline-header {
        padding: 10px 12px 9px;
        font-size: 11px;
        font-weight: 600;
        line-height: 1.4;
        letter-spacing: 0.65px;
        color: #686873;
        flex-wrap: wrap;
        gap: 3px 8px;
      }

      #tm-page-outline-panel .outline-count {
        margin-left: auto;
        font-size: 11px;
        font-weight: 400;
        font-variant-numeric: tabular-nums;
        color: #686873;
      }

      .dark #tm-page-outline-panel .outline-header,
      .dark #tm-page-outline-panel .outline-count {
        color: #aaaab4;
      }

      /* List spacing and interaction */

      #tm-page-outline-panel .outline-list {
        padding: 5px 0 8px;
      }

      #tm-page-outline-panel .outline-item {
        min-height: 32px;
        padding-top: 6px;
        padding-bottom: 6px;
        gap: 8px;
        line-height: 1.45;
      }

      #tm-page-outline-panel .outline-item > span {
        flex: 1 1 auto;
      }

      #tm-page-outline-panel .outline-item:focus-visible {
        outline: 2px solid rgba(190, 140, 40, 0.8);
        outline-offset: -2px;
      }

      #tm-page-outline-panel .outline-item:active {
        background: rgba(200, 155, 60, 0.12);
      }

      .dark #tm-page-outline-panel .outline-item:active {
        background: rgba(210, 165, 70, 0.14);
      }

      /* User prompts */

      #tm-page-outline-panel .outline-prompt {
        margin-top: 9px;
        padding-top: 9px;
        padding-bottom: 9px;
        font-size: calc(11px + var(--tm-outline-font-boost));
        font-weight: 600;
        line-height: 1.45;
      }

      /* Heading hierarchy: strongest to lightest */

      #tm-page-outline-panel .outline-item[data-level="1"] {
        font-size: calc(12px + var(--tm-outline-font-boost));
        font-weight: 800;
        letter-spacing: -0.01em;
      }

      #tm-page-outline-panel .outline-item[data-level="2"] {
        font-size: calc(11.5px + var(--tm-outline-font-boost));
        font-weight: 600;
      }

      #tm-page-outline-panel .outline-item[data-level="3"] {
        font-size: calc(11px + var(--tm-outline-font-boost));
        font-weight: 500;
        color: #555560;
      }

      #tm-page-outline-panel .outline-item[data-level="4"] {
        font-size: calc(10.5px + var(--tm-outline-font-boost));
        font-weight: 400;
        color: #686873;
      }

      .dark #tm-page-outline-panel .outline-item[data-level="3"] {
        color: #b5b5be;
      }

      .dark #tm-page-outline-panel .outline-item[data-level="4"] {
        color: #a0a0ab;
      }

      /* Model icons and empty state */

      #tm-page-outline-panel .outline-model-icon {
        margin-top: 2px;
      }

      #tm-page-outline-panel .outline-empty {
        font-size: calc(11px + var(--tm-outline-font-boost));
        line-height: 1.5;
        color: #686873;
      }

      .dark #tm-page-outline-panel .outline-empty {
        color: #aaaab4;
      }

      /* Larger text and easier tapping on phones */

      @media (max-width: 768px), (pointer: coarse) {
        #tm-page-outline-panel {
          --tm-outline-font-boost: ${MOBILE_BOOST_PX}px;
        }

        #tm-page-outline-panel .outline-item {
          min-height: 44px;
          padding-top: 10px;
          padding-bottom: 10px;
        }

        #tm-page-outline-panel .outline-header,
        #tm-page-outline-panel .outline-count {
          font-size: 12px;
        }
      }

      @media (max-width: 768px) {
        #tm-page-outline-panel {
          width: min(320px, calc(100vw - 16px));
        }
      }

      ${END}
    `;
  }

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      applyReadability,
      { once: true }
    );
  } else {
    applyReadability();
  }
})();
