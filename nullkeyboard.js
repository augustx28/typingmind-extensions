/* TypingMind: kill auto-focus so the mobile keyboard stops popping open.
   Covers the chat input (same as before) + text fields inside panels/popups
   like the plugins panel, tool switcher, model list, dialogs.
   Real taps and Tab-key navigation still focus normally. */

(function () {
  'use strict';

  // Flip to true, open the plugin panel, then read the console to see exactly
  // which element grabs focus. Add its selector to EXTRA_GUARDED below if needed.
  const DEBUG = false;

  const CHAT_INPUT_SELECTOR =
    '#chat-input-textbox, [data-element-id="chat-input-textbox"]';

  // Add exact selectors here if something still slips through.
  const EXTRA_GUARDED = [
    '[data-element-id*="plugin" i]',
    '[data-element-id*="tool" i]'
  ].join(',');

  // Any panel / popup / dialog: text fields inside these shouldn't steal focus on open.
  const PANEL_SELECTOR = [
    '[role="dialog"]',
    '[role="menu"]',
    '[role="listbox"]',
    '[data-headlessui-state]',
    '[data-radix-popper-content-wrapper]',
    '[id*="plugin" i]',
    '[class*="plugin" i]',
    '[aria-label*="plugin" i]',
    EXTRA_GUARDED
  ].join(',');

  const FIELD_SELECTOR =
    'input:not([type="checkbox"]):not([type="radio"]):not([type="range"])' +
    ':not([type="file"]):not([type="button"]):not([type="submit"]), ' +
    'textarea, [contenteditable="true"], [contenteditable=""]';

  const TAP_WINDOW = 800; // ms a real tap counts as "user asked for this"
  const MAX_BLURS = 6;    // stop fighting a component that keeps re-focusing

  let tapRaw = null;
  let tapField = null;
  let tapAt = 0;
  let tabAt = 0;
  const hits = new WeakMap();

  const closest = (n, sel) => (n && n.closest ? n.closest(sel) : null);

  function isGuarded(el) {
    if (!el || el.nodeType !== 1 || !el.matches) return false;
    if (closest(el, CHAT_INPUT_SELECTOR)) return true;
    return !!(el.matches(FIELD_SELECTOR) && closest(el, PANEL_SELECTOR));
  }

  function userAskedFor(el) {
    const now = Date.now();
    if (now - tabAt < TAP_WINDOW) return true;              // keyboard nav
    if (!tapRaw || now - tapAt > TAP_WINDOW) return false;  // no recent tap
    if (tapField === el) return true;                       // tapped the field itself

    const label = closest(tapRaw, 'label');
    if (label && label.htmlFor && el.id && label.htmlFor === el.id) return true;

    // Tapping a button/menu item that then force-focuses a field: block it.
    if (
      closest(
        tapRaw,
        'button, a, summary, [role="button"], [role="menuitem"], [role="tab"], [role="switch"]'
      )
    ) {
      return false;
    }

    // Tapped the padded wrapper around a field: allow.
    return !!(tapRaw.contains && tapRaw.contains(el));
  }

  function overLimit(el) {
    const now = Date.now();
    const rec = hits.get(el);
    if (!rec || now - rec.at > 3000) {
      hits.set(el, { n: 1, at: now });
      return false;
    }
    rec.n += 1;
    rec.at = now;
    return rec.n > MAX_BLURS;
  }

  ['pointerdown', 'mousedown', 'touchstart'].forEach((type) => {
    document.addEventListener(
      type,
      (e) => {
        tapRaw = e.target;
        tapField = closest(e.target, FIELD_SELECTOR + ',' + CHAT_INPUT_SELECTOR);
        tapAt = Date.now();
      },
      true
    );
  });

  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Tab') tabAt = Date.now();
    },
    true
  );

  document.addEventListener(
    'focusin',
    (e) => {
      const el = e.target;
      if (DEBUG) {
        console.log(
          '[focus]',
          el.tagName,
          el.id || '',
          (el.getAttribute && el.getAttribute('data-element-id')) || '',
          (typeof el.className === 'string' && el.className) || ''
        );
      }
      if (!isGuarded(el)) return;
      if (userAskedFor(el)) return;
      if (overLimit(el)) return;

      el.blur();
      // iOS sometimes re-grabs focus a frame later.
      requestAnimationFrame(() => {
        if (document.activeElement === el && !userAskedFor(el)) el.blur();
      });
    },
    true
  );

  // Belt and braces: strip autofocus attributes on anything React mounts.
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      for (const node of r.addedNodes) {
        if (!node || node.nodeType !== 1) continue;
        if (node.hasAttribute && node.hasAttribute('autofocus')) {
          node.removeAttribute('autofocus');
        }
        if (node.querySelectorAll) {
          node.querySelectorAll('[autofocus]').forEach((k) =>
            k.removeAttribute('autofocus')
          );
        }
      }
    }
  });

  const start = () =>
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
