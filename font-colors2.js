/* TypingMind: adjustable dark-mode AI response colors.
 * Edit the COLORS settings below, then save and refresh TypingMind.
 * An empty string ('') leaves that color setting unchanged.
 * Uses the same prose color variables as the original working script.
 *
 * Thinking area: the thinking text, tool-call rows (like "Parallel Web
 * search ...") and the "Worked for 6s" label. They get regular (non-italic)
 * text in every theme, plus their own dimmed colors in dark mode. The
 * thinking settings never touch your normal response text.
 *
 * Disable this script and refresh to restore the original styling.
 */
(() => {
  'use strict';

  // EDIT COLORS HERE. Example: bold: '#eeeae5'
  const COLORS = {
    // Normal response text
    body: '#dedbd7',          // Regular response text: warm light gray
    bold: '#dedbd7',          // Bold text
    headings: '#dedbd7',      // Shared heading color, including table headers
    bullets: '#dedbd7',       // Bullet dots only, not the text beside them
    numbers: '#dedbd7',       // Automatic list numbers only, not typed numbers

    // Thinking area only
    thinkingText: '#9a9894',  // Same warm tint as the body text, just dimmer
    thinkingBorder: '#62605d' // Thinking block left border: quiet warm gray
  };
  // Other thinkingText options: brighter '#a7a4a0', dimmer '#918f8c', pure gray '#999999'

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

  // Tool-call containers that TypingMind tags with their own ids.
  const TOOL_BLOCKS = [
    '[data-element-id="websearch-calls-block"]',
    '[data-element-id="provider-tool-call-block"]'
  ];

  // Plugin call row: tool icon, "Parallel  Web search", then the arguments.
  // It has no id, so it's matched by its classes inside AI responses only.
  const TOOL_ROW =
    '[data-element-id="response-block"] div.text-xs.truncate.w-full:has(> button)' +
    ':not([data-element-id="citations-block"] *)';

  // "Worked for 6s" / "Thought for 12s" toggle. It has no id or class to
  // hook, so the script finds it by its label text and tags it.
  const LABEL_ATTR = 'data-tm-thinking-label';
  const LABEL = `[${LABEL_ATTR}]`;
  const LABEL_TEXT = /^(worked|working|thought|thinking|reasoned|reasoning)\b/i;
  const CHAT_PANE = '[data-element-id="chat-space-middle-part"]';
  const RESPONSE_BLOCK = '[data-element-id="response-block"]';

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

  function color(key) {
    const value = COLORS[key];
    return typeof value === 'string' && HEX_COLOR.test(value.trim())
      ? value.trim()
      : '';
  }

  function rule(selectors, declarations) {
    return `${selectors.join(',\n')} {\n  ${declarations.join('\n  ')}\n}`;
  }

  // Dark mode only, matching how the response colors work
  function dark(selector) {
    return `.dark ${selector}`;
  }

  function buildCss() {
    const rules = [];
    const regular = ['font-style: normal !important;'];

    // Regular (non-italic) thinking-area text in every theme
    rules.push(rule(
      [THINKING, LABEL, `${LABEL} .italic`, ...TOOL_BLOCKS.map((s) => `${s} .italic`)],
      regular
    ));
    // Own rule: a browser without :has() then drops only this one
    rules.push(rule([`${TOOL_ROW} .italic`], regular));

    const responseDeclarations = Object.keys(VARIABLES)
      .filter((key) => color(key))
      .map((key) => `${VARIABLES[key]}: ${color(key)} !important;`);

    if (responseDeclarations.length) {
      rules.push(rule(['[data-element-id="ai-response"].prose'], responseDeclarations));
    }

    const text = color('thinkingText');
    const border = color('thinkingBorder');

    if (text) {
      rules.push(rule([dark(THINKING)], [
        `color: ${text} !important;`,
        ...THINKING_VARIABLES.map((variable) => `${variable}: ${text} !important;`)
      ]));

      // Tool calls and the label, including their icons and inner spans
      rules.push(rule(
        [LABEL, ...TOOL_BLOCKS].flatMap((s) => [dark(s), dark(`${s} *`)]),
        [`color: ${text} !important;`]
      ));
      rules.push(rule([dark(TOOL_ROW), dark(`${TOOL_ROW} *`)], [`color: ${text} !important;`]));
    }

    if (border) {
      rules.push(rule([dark(THINKING)], [`border-left-color: ${border} !important;`]));
    }

    return rules.join('\n\n');
  }

  /* ---------------- "Worked for" label tagging ---------------- */

  function isLabel(span) {
    const text = (span.textContent || '').trim();
    return text.length <= 60 && LABEL_TEXT.test(text);
  }

  // Tag the whole toggle so its arrow icon matches, unless the nearest
  // button is big enough to hold the response itself.
  function labelTarget(span) {
    const toggle = span.closest('button, [role="button"], summary');
    const tooBig = toggle && toggle.querySelector(
      '[data-element-id="ai-response"], [data-element-id="thinking-block"]'
    );
    return toggle && !tooBig ? toggle : span;
  }

  function markLabels() {
    const panes = document.querySelectorAll(CHAT_PANE);
    const roots = panes.length ? panes : document.querySelectorAll(RESPONSE_BLOCK);

    roots.forEach((root) => {
      const labels = new Set();

      root.querySelectorAll('span.truncate').forEach((span) => {
        if (isLabel(span)) labels.add(labelTarget(span));
      });

      root.querySelectorAll(LABEL).forEach((el) => {
        if (!labels.has(el)) el.removeAttribute(LABEL_ATTR);
      });

      labels.forEach((el) => {
        if (!el.hasAttribute(LABEL_ATTR)) el.setAttribute(LABEL_ATTR, '');
      });
    });
  }

  let markTimer = 0;

  // Runs at most every 200ms while the chat changes. Tagging is an attribute
  // change, which this observer ignores, so it can't trigger itself.
  function scheduleMark() {
    if (markTimer) return;
    markTimer = setTimeout(() => {
      markTimer = 0;
      markLabels();
    }, 200);
  }

  function watchLabels() {
    if (window.__tmThinkingLabelObserver) return; // one observer per page
    window.__tmThinkingLabelObserver = new MutationObserver(scheduleMark);
    window.__tmThinkingLabelObserver.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
    markLabels();
  }

  function install() {
    let style = document.getElementById(STYLE_ID);

    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }

    style.textContent = buildCss();
    watchLabels();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
