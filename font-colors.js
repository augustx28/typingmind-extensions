// ==UserScript==
// @name         TypingMind Text Colors
// @namespace    tm-text-colors
// @version      1.0
// @description  Heading shades, warm gray body text, and Claude clay bold for TypingMind AI replies.
// @match        https://www.typingmind.com/*
// @match        https://typingmind.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/*
 * TypingMind Text Colors v1.0
 *
 * Works as a TypingMind extension (Preferences > Advanced Settings >
 * Extensions) or as a Tampermonkey userscript.
 *
 * Pure CSS injection: no MutationObservers, no event listeners, no timers.
 * Styles AI replies only, in dark mode only (by default). Thinking and
 * reasoning blocks keep TypingMind's default look.
 *
 * Live tweaking from the desktop console (lasts until reload):
 *   tmTextColors.set({ h2: '#E8A58C', bold: '#CFCBC0' })
 *   tmTextColors.get()     show current colors
 *   tmTextColors.reset()   back to the COLORS block below
 *   tmTextColors.off()     remove all styling
 *   tmTextColors.on()      bring it back
 *   tmTextColors.check()   diagnostics if colors are not showing
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // CONFIG
  // Any CSS color works (hex, rgb(), hsl()). Set a value to null to leave
  // TypingMind's default color for that element alone.
  // ---------------------------------------------------------------------------

  const COLORS = {
    h1: '#FFFFFF',   // white
    h2: '#F0EEE6',   // warm ivory
    h3: '#E0DCD1',   // light warm gray
    h4: '#CFCBC0',   // warm gray
    h5: '#C0BCB1',   // deeper warm gray
    h6: '#B0AEA5',   // Anthropic mid gray
    text: '#D6D3CA', // paragraphs, list items, table cells
    bold: '#CFCBC0'  // Claude clay orange. Lighter version: '#CFCBC0'
  };

  // '.dark' limits styling to dark mode, so a white H1 never lands on a
  // white background. Use '' to apply in both light and dark mode.
  const THEME_SCOPE = '.dark';

  // Wrapper TypingMind puts around every AI reply. If a TypingMind update
  // renames it, this is the only line to change.
  const RESPONSE_SELECTOR = '[data-element-id="ai-response"]';

  // Anything inside these keeps TypingMind's default styling
  // (thinking and reasoning panels, collapsible tool output).
  const SKIP_INSIDE = [
    'details',
    '[data-element-id*="thinking"]',
    '[data-element-id*="thought"]',
    '[data-element-id*="reasoning"]',
    '[class*="thinking"]',
    '[class*="thought"]',
    '[class*="reasoning"]'
  ];

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  const VERSION = '1.0';
  const STYLE_ID = 'tm-text-colors';
  const LOG = '[TM Text Colors]';
  const HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
  const KEYS = Object.keys(COLORS);

  const DEFAULTS = Object.freeze(sanitize(COLORS));
  let current = { ...DEFAULTS };
  let enabled = true;

  function isValidColor(value) {
    if (typeof value !== 'string' || !value.trim()) return false;

    if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') {
      return CSS.supports('color', value.trim());
    }

    return /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value.trim());
  }

  function sanitize(colors) {
    const clean = {};

    KEYS.forEach((key) => {
      const value = colors[key];

      if (value === null || value === undefined) {
        clean[key] = null;
      } else if (isValidColor(value)) {
        clean[key] = value.trim();
      } else {
        console.warn(`${LOG} "${value}" is not a valid color for ${key}. Skipping it.`);
        clean[key] = null;
      }
    });

    return clean;
  }

  function buildCss(colors) {
    const root = `${THEME_SCOPE} ${RESPONSE_SELECTOR}`.trim();
    const skip = `:not(:is(${SKIP_INSIDE.join(', ')}) *)`;
    const rules = [];

    if (colors.text) {
      rules.push(
        `${root} :is(p, li, td, dd, dt)${skip} { color: ${colors.text} !important; }`
      );
    }

    HEADINGS.forEach((tag) => {
      if (colors[tag]) {
        rules.push(`${root} ${tag}${skip} { color: ${colors[tag]} !important; }`);
      }
    });

    if (colors.bold) {
      rules.push(
        `${root} :is(strong, b)${skip} { color: ${colors.bold} !important; }`
      );

      // Bold words inside a heading keep that heading's shade. This selector
      // is one step more specific than the bold rule above, so it wins.
      rules.push(
        `${root} :is(${HEADINGS.join(', ')}) :is(strong, b)${skip} { color: inherit !important; }`
      );
    }

    return `/* ${LOG} v${VERSION} */\n${rules.join('\n')}\n`;
  }

  function render() {
    const existing = document.getElementById(STYLE_ID);

    if (!enabled) {
      if (existing) existing.remove();
      return;
    }

    const style = existing || document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = buildCss(current);

    if (!existing) {
      (document.head || document.documentElement).appendChild(style);
    }
  }

  // ---------------------------------------------------------------------------
  // Console API
  // ---------------------------------------------------------------------------

  function set(overrides) {
    if (!overrides || typeof overrides !== 'object') {
      console.warn(`${LOG} Pass an object, e.g. tmTextColors.set({ h2: '#E8A58C' })`);
      return { ...current };
    }

    Object.keys(overrides).forEach((key) => {
      if (!KEYS.includes(key)) {
        console.warn(`${LOG} Unknown key "${key}". Valid keys: ${KEYS.join(', ')}`);
        return;
      }

      const value = overrides[key];

      if (value === null) {
        current[key] = null;
      } else if (isValidColor(value)) {
        current[key] = value.trim();
      } else {
        console.warn(`${LOG} "${value}" is not a valid color for ${key}.`);
      }
    });

    render();
    return { ...current };
  }

  function check() {
    const scopedSelector = `${THEME_SCOPE} ${RESPONSE_SELECTOR}`.trim();

    const report = {
      version: VERSION,
      enabled,
      styleInjected: Boolean(document.getElementById(STYLE_ID)),
      aiRepliesFound: document.querySelectorAll(RESPONSE_SELECTOR).length,
      aiRepliesStyled: document.querySelectorAll(scopedSelector).length
    };

    console.table(report);

    if (report.aiRepliesFound === 0) {
      console.warn(
        `${LOG} No AI replies matched ${RESPONSE_SELECTOR}. Open a chat first. ` +
        'If replies are on screen, TypingMind renamed the element: inspect one ' +
        'and update RESPONSE_SELECTOR.'
      );
    } else if (report.aiRepliesStyled === 0) {
      console.warn(
        `${LOG} Replies found, but no "${THEME_SCOPE}" parent. Switch to dark ` +
        "mode, or set THEME_SCOPE to ''."
      );
    }

    return report;
  }

  window.tmTextColors = {
    version: VERSION,
    set,
    get: () => ({ ...current }),
    reset() {
      current = { ...DEFAULTS };
      render();
      return { ...current };
    },
    on() {
      enabled = true;
      render();
    },
    off() {
      enabled = false;
      render();
    },
    check
  };

  render();
})();
