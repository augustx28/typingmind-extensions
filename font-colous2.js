/* TypingMind: adjustable dark-mode AI response colors.
 * Edit the COLORS settings below, then save and refresh TypingMind.
 * An empty string ('') leaves that color setting unchanged.
 * Uses the same prose color variables as the original working script.
 * Thinking block: regular (non-italic) text in every theme, plus its own
 * dimmed text color and border color in dark mode.
 * Disable this script and refresh to restore the original styling.
 */
(() => {
  'use strict';

  // EDIT COLORS HERE. Example: bold: '#eeeae5'
  const COLORS = {
    body: '#dedbd7',          // Regular response text: warm light gray
    bold: '#dedbd7',          // Bold text
    headings: '#dedbd7',      // Shared heading color, including table headers
    bullets: '#dedbd7',       // Bullet dots only, not the text beside them
    numbers: '#dedbd7',       // Automatic list numbers only, not typed numbers
    thinkingText: '#a39b92',  // Expanded thinking text: warm, dimmer than body
    thinkingBorder: '#6b645c' // Thinking block left border: quiet warm gray
  };
  // Other thinkingText options: brighter '#b5ada3', dimmer '#938b82', warmer '#a8998a'

  const STYLE_ID = 'tm-warm-gray-response-text';
  const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
  const THINKING = '[data-element-id="thinking-block"]';

  // Response colors go through Tailwind's dark-mode prose variables.
  const VARIABLES = {
    body: '--tw-prose-invert-body',
    bold: '--tw-prose-invert-bold',
    headings: '--tw-prose-invert-headings',
    bullets: '--tw-prose-invert-bullets',
    numbers: '--tw-prose-invert-counters'
  };

  // The thinking block hard-codes its color with a Tailwind class, so it
  // needs a direct override. These prose variables are reset inside it so
  // bold text, headings, list markers, links, quotes and inline code dim
  // along with the rest of the thinking text.
  const THINKING_VARIABLES = [
    '--tw-prose-bold',
    '--tw-prose-headings',
    '--tw-prose-bullets',
    '--tw-prose-counters',
    '--tw-prose-links',
    '--tw-prose-quotes',
    '--tw-prose-code'
  ];

  function color(key) {
    const value = COLORS[key];
    return typeof value === 'string' && HEX_COLOR.test(value.trim())
      ? value.trim()
      : '';
  }

  function buildCss() {
    const responseDeclarations = Object.keys(VARIABLES)
      .filter((key) => color(key))
      .map((key) => `${VARIABLES[key]}: ${color(key)} !important;`);

    const thinkingDeclarations = [];
    const thinkingText = color('thinkingText');
    const thinkingBorder = color('thinkingBorder');

    if (thinkingText) {
      thinkingDeclarations.push(`color: ${thinkingText} !important;`);
      THINKING_VARIABLES.forEach((variable) => {
        thinkingDeclarations.push(`${variable}: ${thinkingText} !important;`);
      });
    }

    if (thinkingBorder) {
      thinkingDeclarations.push(`border-left-color: ${thinkingBorder} !important;`);
    }

    // Regular (non-italic) thinking text in every theme
    const rules = [`${THINKING} {\n  font-style: normal !important;\n}`];

    if (responseDeclarations.length) {
      rules.push(
        `[data-element-id="ai-response"].prose {\n  ${responseDeclarations.join('\n  ')}\n}`
      );
    }

    // Thinking colors in dark mode only, matching the response colors above
    if (thinkingDeclarations.length) {
      rules.push(`.dark ${THINKING} {\n  ${thinkingDeclarations.join('\n  ')}\n}`);
    }

    return rules.join('\n\n');
  }

  function install() {
    let style = document.getElementById(STYLE_ID);

    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }

    style.textContent = buildCss();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
