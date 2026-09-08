/* ============================================================================
 * TypingMind - Dark Input Fix  (v1.0)
 * ---------------------------------------------------------------------------
 * Replaces:
 *     .jsx-7078ffb922cb3c38 .leading-normal { background-color: #131313 }
 *     .pb-safe .bg-slate-100              { background-color: #181717 }
 *
 * Why JS instead of raw CSS:
 *   1. The .jsx-XXXXXXXX class is a styled-jsx build hash. It changes on every
 *      TypingMind release, so the CSS silently dies after an update.
 *   2. Static CSS only paints what you already know about. The leftover navy
 *      strip next to the Send button is a different element carrying Tailwind
 *      slate (#0f172a / #1e293b). This script finds ANY dark blue-tinted
 *      background inside the input area and repaints it, whatever it is called.
 *
 * Safety:
 *   - Only repaints elements whose CURRENT computed background is dark AND
 *     blue-tinted. Neutral greys and the bright blue Send button are ignored.
 *   - MutationObserver watches childList only, never attributes. No feedback
 *     loop, no mobile touch freeze.
 *
 * Console API:
 *   tmDark.off()                      disable + revert
 *   tmDark.on()                       re-enable
 *   tmDark.sweep()                    force a repaint pass
 *   tmDark.probe()                    toggle hover-inspect (logs any element)
 *   tmDark.set('boxBg', '#101010')    change a colour live
 *   tmDark.config                     read current settings
 * ========================================================================== */

(function () {
  'use strict';

  /* ------------------------------- CONFIG ------------------------------- */

  const CFG = {
    inputBg: '#131313',      // the typing area itself (textarea)
    boxBg: '#181717',        // input shell + the strip next to Send
    borderColor: '#242424',  // borders that were slate-tinted
    recolorBorders: true,

    // Navy detection. A colour counts as "navy" when every channel is dark
    // AND blue sits meaningfully above red/green.
    maxChannel: 110,         // slate-700 (85) passes, slate-500 (139) does not
    blueBias: 12,            // slate-900 rgb(15,23,42) -> b-r = 27, passes

    debounceMs: 150,
    debug: false             // set true to log every element it repaints
  };

  /* ----------------------------- INTERNALS ------------------------------ */

  const STYLE_ID = 'tm-dark-input-fix-style';
  const PAINTED = 'data-tm-dark';

  // Never touch these: interactive controls and graphics.
  const SKIP_TAGS = new Set(['BUTTON', 'A', 'SVG', 'PATH', 'IMG', 'CANVAS', 'VIDEO', 'IFRAME']);
  // These get inputBg instead of boxBg.
  const TYPE_TAGS = new Set(['TEXTAREA']);

  // Where to look. First match wins; falls back to climbing from any textarea.
  const SCOPE_SELECTOR = [
    '[data-element-id="chat-space-end-part"]',
    '[data-element-id="chat-input-textbox"]',
    '[data-element-id="chat-input-actions"]',
    '.pb-safe'
  ].join(', ');

  let timer = null;
  let observer = null;
  let alive = false;
  let probing = false;

  const log = (...a) => { if (CFG.debug) console.log('%c[tm-dark]', 'color:#7aa2f7', ...a); };

  /* ---------------------------- COLOUR MATHS ---------------------------- */

  function parseRGB(str) {
    const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?/i.exec(str || '');
    if (!m) return null;
    return {
      r: parseFloat(m[1]),
      g: parseFloat(m[2]),
      b: parseFloat(m[3]),
      a: m[4] === undefined ? 1 : parseFloat(m[4])
    };
  }

  function isNavy(str) {
    const c = parseRGB(str);
    if (!c) return false;
    if (c.a < 0.15) return false;                                  // transparent, leave it
    if (Math.max(c.r, c.g, c.b) > CFG.maxChannel) return false;    // too bright, not the shell
    if (c.b - c.r < CFG.blueBias) return false;                    // not blue-tinted
    if (c.b - c.g < Math.round(CFG.blueBias / 2)) return false;    // not blue-tinted
    return true;
  }

  /* ------------------------------ STATIC CSS ---------------------------- */
  /* Runs first so there is no navy flash before the sweep lands. */

  function injectCSS() {
    const old = document.getElementById(STYLE_ID);
    if (old) old.remove();

    const borderRules = CFG.recolorBorders
      ? `
      [data-element-id="chat-space-end-part"] div[class*="border-slate-"],
      .pb-safe div[class*="border-slate-"] {
        border-color: ${CFG.borderColor} !important;
      }`
      : '';

    const css = `
      /* typing area */
      [data-element-id="chat-space-end-part"] textarea,
      [data-element-id="chat-input-textbox"],
      [data-element-id="chat-input-textbox"] textarea,
      .pb-safe textarea,
      .pb-safe [contenteditable="true"] {
        background-color: ${CFG.inputBg} !important;
      }

      /* input shell and any slate-tinted panel behind the buttons */
      [data-element-id="chat-space-end-part"] div[class*="bg-slate-"],
      [data-element-id="chat-space-end-part"] div[class*="bg-gray-9"],
      [data-element-id="chat-space-end-part"] div[class*="bg-zinc-9"],
      .pb-safe div[class*="bg-slate-"],
      .pb-safe .bg-slate-100 {
        background-color: ${CFG.boxBg} !important;
      }
      ${borderRules}
    `;

    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = css;
    (document.head || document.documentElement).appendChild(el);
    log('css injected');
  }

  /* ------------------------------- SWEEP -------------------------------- */

  function getScopes() {
    const set = new Set();
    document.querySelectorAll(SCOPE_SELECTOR).forEach(el => set.add(el));

    // Fallback for when TypingMind renames its data-element-id values:
    // climb six levels up from every textarea on the page.
    if (!set.size) {
      document.querySelectorAll('textarea').forEach(ta => {
        let n = ta;
        for (let i = 0; i < 6 && n.parentElement; i++) n = n.parentElement;
        set.add(n);
      });
    }
    return Array.from(set);
  }

  function paint(el) {
    if (!(el instanceof HTMLElement)) return;
    if (SKIP_TAGS.has(el.tagName)) return;

    // Already handled and our inline style survived the last React render.
    if (el.getAttribute(PAINTED) === '1' && el.style.backgroundColor) return;

    const cs = getComputedStyle(el);
    let touched = false;

    if (TYPE_TAGS.has(el.tagName) || el.isContentEditable) {
      el.style.setProperty('background-color', CFG.inputBg, 'important');
      touched = true;
    } else if (isNavy(cs.backgroundColor)) {
      el.style.setProperty('background-color', CFG.boxBg, 'important');
      touched = true;
    }

    if (CFG.recolorBorders &&
        parseFloat(cs.borderTopWidth) > 0 &&
        isNavy(cs.borderTopColor)) {
      el.style.setProperty('border-color', CFG.borderColor, 'important');
      touched = true;
    }

    if (touched) {
      el.setAttribute(PAINTED, '1');
      log('repainted', el.tagName, el.getAttribute('data-element-id') || el.className, cs.backgroundColor);
    }
  }

  function sweep() {
    if (!alive) return;
    const scopes = getScopes();
    for (const root of scopes) {
      paint(root);
      const kids = root.querySelectorAll('*');
      if (kids.length > 4000) continue;   // guard against a runaway scope
      for (let i = 0; i < kids.length; i++) paint(kids[i]);
    }
  }

  function schedule() {
    if (!alive) return;
    clearTimeout(timer);
    timer = setTimeout(sweep, CFG.debounceMs);
  }

  /* ---------------------------- EVENT WIRING ---------------------------- */

  function onClick() { schedule(); }
  function onKeyUp(e) { if (e.key === 'Enter') schedule(); }
  function onResize() { schedule(); }

  function start() {
    if (alive) return;
    alive = true;

    injectCSS();
    sweep();

    // Late hydration passes. Next.js swaps class names after first paint.
    [300, 1000, 3000, 6000].forEach(ms => setTimeout(() => { if (alive) sweep(); }, ms));

    observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { childList: true, subtree: true });

    document.addEventListener('click', onClick, true);
    document.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('resize', onResize);

    log('started');
  }

  function stop() {
    alive = false;
    clearTimeout(timer);

    if (observer) { observer.disconnect(); observer = null; }
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('resize', onResize);

    const style = document.getElementById(STYLE_ID);
    if (style) style.remove();

    document.querySelectorAll('[' + PAINTED + ']').forEach(el => {
      el.style.removeProperty('background-color');
      el.style.removeProperty('border-color');
      el.removeAttribute(PAINTED);
    });

    if (probing) toggleProbe();
    log('stopped and reverted');
  }

  /* ------------------------------- PROBE -------------------------------- */
  /* tmDark.probe() then hover the mystery element. Details go to console. */

  function onProbeOver(e) {
    const el = e.target;
    if (!(el instanceof HTMLElement)) return;
    el.dataset.tmPrevOutline = el.style.outline || '';
    el.style.outline = '2px solid #ff3b3b';
    const cs = getComputedStyle(el);
    console.log('[tm-probe]', {
      tag: el.tagName,
      elementId: el.getAttribute('data-element-id') || null,
      classes: typeof el.className === 'string' ? el.className : String(el.className),
      background: cs.backgroundColor,
      border: cs.borderColor,
      readsAsNavy: isNavy(cs.backgroundColor),
      node: el
    });
  }

  function onProbeOut(e) {
    const el = e.target;
    if (!(el instanceof HTMLElement)) return;
    el.style.outline = el.dataset.tmPrevOutline || '';
    delete el.dataset.tmPrevOutline;
  }

  function toggleProbe() {
    if (probing) {
      document.removeEventListener('mouseover', onProbeOver, true);
      document.removeEventListener('mouseout', onProbeOut, true);
      probing = false;
      console.log('[tm-dark] probe OFF');
    } else {
      document.addEventListener('mouseover', onProbeOver, true);
      document.addEventListener('mouseout', onProbeOut, true);
      probing = true;
      console.log('[tm-dark] probe ON - hover the navy strip, then read the log');
    }
    return probing;
  }

  /* -------------------------------- API --------------------------------- */

  // Clean up a previous copy if the extension gets loaded twice.
  if (window.tmDark && typeof window.tmDark.off === 'function') {
    try { window.tmDark.off(); } catch (err) { /* previous version already gone */ }
  }

  window.tmDark = {
    on: start,
    off: stop,
    sweep: sweep,
    probe: toggleProbe,
    set: function (key, value) {
      if (!(key in CFG)) {
        console.warn('[tm-dark] unknown setting:', key, '- valid keys:', Object.keys(CFG).join(', '));
        return false;
      }
      CFG[key] = value;
      document.querySelectorAll('[' + PAINTED + ']').forEach(el => el.removeAttribute(PAINTED));
      injectCSS();
      sweep();
      console.log('[tm-dark]', key, '=', value);
      return true;
    },
    config: CFG,
    version: '1.0'
  };

  /* -------------------------------- BOOT -------------------------------- */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
