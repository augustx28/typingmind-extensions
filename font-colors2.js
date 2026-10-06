/* TypingMind: adjustable AI response colors.
 * Edit the COLORS settings below, then save and refresh TypingMind.
 * An empty string ('') leaves that color setting unchanged.
 * Uses the same prose color variables as the original working script.
 *
 * Response text colors apply in dark mode.
 * Thinking area: the thinking text, tool-call rows (like "Parallel Web
 * search ...") and the "Worked for 6s" label get regular (non-italic) text
 * and warm gray colors in dark and light mode. TypingMind's own effects are
 * left alone: the label keeps its moving shimmer while it's working and its
 * hover effect once it's done. The thinking settings never touch your normal
 * response text.
 *
 * Check which version is running: type tmFontColorsVersion in the console.
 * Disable this script and refresh to restore the original styling.
 */
(() => {
  'use strict';

  const VERSION = 5;

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

  // Thinking area colors use extra-specific selectors instead of !important,
  // so they beat TypingMind's color classes but never its animations.
  // (A doubled attribute selector matches the same element, it just ranks
  // higher.)
  const twice = (selector) => selector + selector;

  // Thinking text
  const THINKING = '[data-element-id="thinking-block"]';

  // Tool-call containers that TypingMind tags with their own ids
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
  // hook, so the script finds it by its label text and tags it "live" while
  // it's still working or animating, and "done" once it's finished. Only a
  // done label that isn't under the mouse gets recolored, so TypingMind's
  // shimmer and hover effects play exactly as before.
  const LABEL_ATTR = 'data-tm-thinking-label';
  const LABEL = `[${LABEL_ATTR}]`;
  const DONE_LABEL = `[${LABEL_ATTR}="done"]:not(:hover)`;
  const LABEL_TEXT = /^(worked|working|thought|thinking|reasoned|reasoning)\b/i;
  const LIVE_TEXT = /^(working|thinking|reasoning)\b/i;
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
      rules.push(rule([scope(twice(THINKING))], [
        `color: ${text};`,
        ...THINKING_VARIABLES.map((variable) => `${variable}: ${text};`)
      ]));

      // Containers only: their text inherits the color, and anything inside
      // with its own effect (shimmer, hover) keeps it. Icons get it directly.
      rules.push(rule(
        [...TOOL_BLOCKS.map(twice), DONE_LABEL].flatMap((s) => [scope(s), scope(`${s} svg`)]),
        [`color: ${text};`]
      ));

      // Own rule: a browser without :has() then drops only this one
      rules.push(rule([scope(TOOL_ROW), scope(`${TOOL_ROW} svg`)], [`color: ${text};`]));
    }

    if (border) {
      rules.push(rule([scope(twice(THINKING))], [`border-left-color: ${border};`]));
    }

    return rules;
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

    THEMES.forEach((theme) => rules.push(...themeRules(theme)));

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

  // Live = still working ("Working for 3s") or running a CSS animation such
  // as the shimmer. Hover fades are transitions, not animations, so they
  // don't count.
  function isLive(target, span) {
    if (LIVE_TEXT.test((span.textContent || '').trim())) return true;
    if (typeof target.getAnimations !== 'function' || typeof CSSAnimation === 'undefined') {
      return false;
    }
    return target.getAnimations({ subtree: true })
      .some((animation) => animation instanceof CSSAnimation);
  }

  let liveTimer = 0;

  function markLabels() {
    const panes = document.querySelectorAll(CHAT_PANE);
    const roots = panes.length ? panes : document.querySelectorAll(RESPONSE_BLOCK);
    let anyLive = false;

    roots.forEach((root) => {
      const labels = new Map();

      root.querySelectorAll('span.truncate').forEach((span) => {
        if (!isLabel(span)) return;
        const target = labelTarget(span);
        labels.set(target, isLive(target, span) ? 'live' : 'done');
      });

      root.querySelectorAll(LABEL).forEach((el) => {
        if (!labels.has(el)) el.removeAttribute(LABEL_ATTR);
      });

      labels.forEach((state, el) => {
        if (state === 'live') anyLive = true;
        if (el.getAttribute(LABEL_ATTR) !== state) el.setAttribute(LABEL_ATTR, state);
      });
    });

    // A label can stop animating without any DOM change to notice, so
    // re-check once a second, only while one is still live.
    clearTimeout(liveTimer);
    liveTimer = anyLive ? setTimeout(markLabels, 1000) : 0;
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
    window.tmFontColorsVersion = VERSION;
    watchLabels();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
