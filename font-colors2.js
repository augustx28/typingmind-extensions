/* TypingMind: adjustable AI response colors.
 * Edit the COLORS settings below, then save and refresh TypingMind.
 * An empty string ('') leaves that color setting unchanged.
 * Uses the same prose color variables as the original working script.
 *
 * Response text colors apply in dark mode.
 * Thinking area: the thinking text and tool-call rows (like "Parallel Web
 * search ...") get regular (non-italic) text and warm gray colors in dark
 * and light mode. The "Worked for 6s" label is left exactly as TypingMind
 * draws it. The thinking settings never touch your normal response text.
 *
 * Check which version is running: type tmFontColorsVersion in the console.
 * Disable this script and refresh to restore the original styling.
 */
(() => {
  'use strict';

  const VERSION = 6;

  // EDIT COLORS HERE. Example: bold: '#eeeae5'
  const COLORS = {
    // Normal response text (dark mode)
    body: '#dedbd7',           // Regular response text: warm light gray
    bold: '#dedbd7',           // Bold text
    headings: '#dedbd7',       // Shared heading color, including table headers
    bullets: '#dedbd7',        // Bullet dots only, not the text beside them
    numbers: '#dedbd7',        // Automatic list numbers only, not typed numbers

    // Thinking area, dark mode
    thinkingText: '#9a9894',   // Same warm tint as the body text, just dimmer
    thinkingBorder: '#62605d', // Thinking block left border

    // Thinking area, light mode
    lightThinkingText: '#6b6865',  // Warm gray, lighter than the answer text
    lightThinkingBorder: '#dad7d3' // Thinking block left border
  };
  // Other dark thinkingText options: brighter '#a7a4a0', dimmer '#918f8c', pure gray '#999999'

  const STYLE_ID = 'tm-warm-gray-response-text';
  const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

  // Response colors go through Tailwind's dark-mode prose variables.
  const VARIABLES = {
    body: '--tw-prose-invert-body',
    bold: '--tw-prose-invert-bold',
    headings: '--tw-prose-invert-headings',
    bullets: '--tw-prose-invert-bullets',
    numbers: '--tw-prose-invert-counters'
  };

  /* ---------------- Thinking area selectors ---------------- */

  // Thinking text. Its color is hard-coded with a Tailwind class, so it
  // needs a direct override instead of the prose variables above.
  const THINKING = '[data-element-id="thinking-block"]';

  // Plugin call row: tool icon, "Parallel  Web search", then the arguments
  // in italics. It has no id, so it's matched by its classes inside AI
  // responses, and only when it shows italic arguments, so a header such as
  // "Worked for 6s" can never match. A row that's animating is left alone.
  const TOOL_ROW =
    '[data-element-id="response-block"] div.text-xs.truncate.w-full' +
    ':has(> button):has(> span.italic)' +
    ':not([class*="animate-"]):not([class*="shimmer"]):not(.text-transparent)' +
    ':not([data-element-id="citations-block"] *)';

  // Prose variables reset inside the thinking block, so bold text, headings,
  // list markers, links, quotes and inline code dim with the rest of it.
  const THINKING_VARIABLES = [
    '--tw-prose-bold',
    '--tw-prose-headings',
    '--tw-prose-bullets',
    '--tw-prose-counters',
    '--tw-prose-links',
    '--tw-prose-quotes',
    '--tw-prose-code'
  ];

  // Light rules skip anything inside .dark and dark rules need it, so the
  // two never overlap, wherever TypingMind puts its .dark class.
  const THEMES = [
    {
      scope: (selector) => `${selector}:not(.dark *)`,
      text: 'lightThinkingText',
      border: 'lightThinkingBorder'
    },
    {
      scope: (selector) => `.dark ${selector}`,
      text: 'thinkingText',
      border: 'thinkingBorder'
    }
  ];

  function color(key) {
    const value = COLORS[key];
    return typeof value === 'string' && HEX_COLOR.test(value.trim())
      ? value.trim()
      : '';
  }

  function rule(selectors, declarations) {
    return `${selectors.join(',\n')} {\n  ${declarations.join('\n  ')}\n}`;
  }

  function themeRules(theme) {
    const rules = [];
    const text = color(theme.text);
    const border = color(theme.border);
    const scope = theme.scope;

    if (text) {
      rules.push(rule([scope(THINKING)], [
        `color: ${text} !important;`,
        ...THINKING_VARIABLES.map((variable) => `${variable}: ${text} !important;`)
      ]));

      // The row itself, so its text inherits the color and anything inside
      // with its own effect keeps it. Icons get it directly. Own rule: a
      // browser without :has() then drops only this one.
      rules.push(rule([scope(TOOL_ROW), scope(`${TOOL_ROW} svg`)], [`color: ${text};`]));
    }

    if (border) {
      rules.push(rule([scope(THINKING)], [`border-left-color: ${border} !important;`]));
    }

    return rules;
  }

  function buildCss() {
    const rules = [];
    const regular = ['font-style: normal !important;'];

    // Regular (non-italic) thinking text and tool arguments in every theme
    rules.push(rule([THINKING], regular));
    rules.push(rule([`${TOOL_ROW} .italic`], regular));

    const responseDeclarations = Object.keys(VARIABLES)
      .filter((key) => color(key))
      .map((key) => `${VARIABLES[key]}: ${color(key)} !important;`);

    if (responseDeclarations.length) {
      rules.push(rule(['[data-element-id="ai-response"].prose'], responseDeclarations));
    }

    THEMES.forEach((theme) => rules.push(...themeRules(theme)));

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
    window.tmFontColorsVersion = VERSION;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
