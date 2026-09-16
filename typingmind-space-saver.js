/* =====================================================================
 * TypingMind - Space Saver  v1.0
 * ---------------------------------------------------------------------
 * More room for the chat on phone and desktop:
 *   1. Header slides away when you scroll down, comes back when you
 *      scroll up. It floats over the chat, so hiding it never makes
 *      the text jump.
 *   2. The model + plugin row above the input hides with the header.
 *   3. Input tools collapse until you tap the message box. They stay
 *      visible while you type, while a reply streams (Stop button),
 *      while editing, and while a menu from the box is open.
 *   4. Tighter spacing around the header and input.
 *   5. A small tab sits above the input:
 *        tap           = show / hide the header
 *        hold          = options (right-click also works on desktop)
 *      Desktop shortcut: Ctrl+Shift+H (Cmd+Shift+H on Mac)
 *   Options are saved separately for the phone and desktop layouts.
 *
 * Install: TypingMind -> Settings -> Advanced Settings -> Extensions ->
 * paste the URL of this file -> Install -> restart the app.
 *
 * Console: tmSpace.toggle() / .show() / .hide() / .options() / .reset()
 * Kill switch (until reload): tmSpace.off()
 *
 * Mapped against TypingMind's build from 2026-09-03:
 *   header wrapper   = the element right before [chat-space-middle-part]
 *   model/plugin row = the element right before [chat-space-end-part]
 *   input tools      = [chat-input-actions]; Send/Stop live in its last div
 * No MutationObserver. Capture-phase listeners, one ResizeObserver with a
 * storm watchdog, and a light 700ms poll that only re-binds elements.
 * ===================================================================*/
(() => {
  'use strict';

  const VERSION = '1.0';
  const STORE_KEY = 'tm-space-saver:v1';

  // Swap versions cleanly: tear down any copy that is already running.
  try {
    if (typeof window.__tssTeardown === 'function') window.__tssTeardown();
  } catch (e) { /* ignore */ }

  const supportsHas = (() => {
    try { return CSS.supports('selector(:has(+ *))'); } catch (e) { return false; }
  })();
  if (!supportsHas) {
    console.warn('[Space Saver] This browser does not support CSS :has(). Extension not loaded.');
    return;
  }

  /* ------------------------- constants ------------------------- */
  const SEL = {
    pane: '[data-element-id="chat-space-middle-part"]',
    head: '[data-element-id="chat-space-beginning-part"]',
    end: '[data-element-id="chat-space-end-part"]',
  };

  const T = {
    hideAfter: 36,     // px of user scroll down before the header hides
    showAfter: 48,     // px of user scroll up before it comes back
    holdPx: 120,       // after a manual toggle, ignore auto rules until you scroll this far
    pollMs: 700,
    longPressMs: 420,
    tabW: 48,
    tabH: 22,
  };

  const POPUP_SEL = [
    '[role="menu"]',
    '[role="listbox"]',
    '[role="dialog"]:not(.tss-sheet)',
    '[id^="headlessui-popover-panel"]',
    '[id^="headlessui-menu-items"]',
    '[id^="headlessui-listbox-options"]',
  ].join(',');

  const SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End', ' ']);
  const MODES = ['auto', 'manual', 'off'];
  const DEFAULTS = { mode: 'auto', models: true, tools: true, dense: true };

  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || '');
  const SHORTCUT = isMac ? 'Cmd+Shift+H' : 'Ctrl+Shift+H';

  const root = document.documentElement;
  const mqPhone = window.matchMedia('(max-width: 767.98px)');

  /* ------------------------- storage ------------------------- */
  function cleanProfile(p) {
    const out = Object.assign({}, DEFAULTS, p && typeof p === 'object' ? p : {});
    if (!MODES.includes(out.mode)) out.mode = DEFAULTS.mode;
    out.models = !!out.models;
    out.tools = !!out.tools;
    out.dense = !!out.dense;
    return out;
  }

  function loadStore() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (e) { s = {}; }
    return {
      phone: cleanProfile(s.phone),
      desktop: cleanProfile(s.desktop),
      hinted: !!s.hinted,
    };
  }

  let store = loadStore();

  function saveStore() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* storage blocked */ }
  }

  const isPhone = () => mqPhone.matches;
  const cfg = () => store[isPhone() ? 'phone' : 'desktop'];

  /* ------------------------- styles ------------------------- */
  const CSS_TEXT = String.raw`
/* 1. Header floats over the chat instead of pushing it down */
html.tss-on [data-element-id="chat-space-background"] div:has(> [data-element-id="chat-space-middle-part"]) {
  position: relative;
}
html.tss-on [data-element-id="chat-space-background"] div:has(+ [data-element-id="chat-space-middle-part"]) {
  position: absolute !important;
  top: 0;
  left: 0;
  right: 0;
  transition: transform .26s cubic-bezier(.2,.8,.2,1), opacity .2s ease, visibility 0s linear 0s;
}
html.tss-on:not(.dark) [data-element-id="chat-space-background"] div:has(+ [data-element-id="chat-space-middle-part"]) {
  background-color: var(--tss-bg, rgba(255,255,255,.92)) !important;
}
html.tss-on.tss-hide [data-element-id="chat-space-background"] div:has(+ [data-element-id="chat-space-middle-part"]) {
  transform: translateY(calc(-100% - 4px));
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: transform .26s cubic-bezier(.2,.8,.2,1), opacity .2s ease, visibility 0s linear .26s;
}
html.tss-on [data-element-id="chat-space-middle-part"] > .dynamic-chat-content-container {
  padding-top: calc(1rem + var(--tss-head, 54px)) !important;
}
html.tss-on { --tss-stick: var(--tss-head, 54px); }
html.tss-on.tss-hide { --tss-stick: 0px; }
html.tss-on [data-element-id="chat-space-middle-part"] {
  scroll-padding-top: var(--tss-stick);
}
/* Sticky bars inside the chat (multi-model tabs, code block headers) sit under the header */
html.tss-on [data-element-id="chat-space-middle-part"] .sticky.top-0 {
  top: var(--tss-stick) !important;
  transition: top .26s cubic-bezier(.2,.8,.2,1);
}
/* Multi-model tabs stop sticking while the header is tucked away */
html.tss-on.tss-hide [data-element-id="chat-space-middle-part"] .sticky.top-0.z-\[5\] {
  position: relative !important;
}

/* 2. Model + plugin row floats above the input and hides with the header */
html.tss-on.tss-models div:has(+ [data-element-id="chat-space-end-part"]) {
  position: absolute !important;
  left: 0;
  right: 0;
  bottom: 100%;
  z-index: 40;
  padding-top: 8px !important;
  padding-bottom: 2px !important;
  background: linear-gradient(to top, var(--tss-bg, transparent) 70%, transparent);
  transition: transform .22s cubic-bezier(.2,.8,.2,1), opacity .18s ease, visibility 0s linear 0s;
}
html.tss-on.tss-models.tss-hide div:has(+ [data-element-id="chat-space-end-part"]) {
  transform: translateY(10px);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: transform .22s cubic-bezier(.2,.8,.2,1), opacity .18s ease, visibility 0s linear .22s;
}
/* Keep the end of the chat clear of the floating row */
html.tss-on.tss-models [data-element-id="chat-space-middle-part"] [data-element-id="scroll-padding"] {
  margin-top: var(--tss-row, 44px);
}
/* Soft fade where the chat meets the input while the row is tucked away (the tab sits on it) */
html.tss-on.tss-models div:has(> [data-element-id="chat-space-end-part"])::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: 100%;
  height: 28px;
  z-index: 39;
  pointer-events: none;
  background: linear-gradient(to bottom, transparent, var(--tss-bg, transparent) 80%);
  opacity: 0;
  transition: opacity .2s ease;
}
html.tss-on.tss-models.tss-hide div:has(> [data-element-id="chat-space-end-part"])::before {
  opacity: 1;
}

/* 3. Input tools collapse while the box is idle */
html.tss-tools [data-element-id="chat-space-end-part"]:not(:focus-within):not(:has(#chat-input-textbox:not(:placeholder-shown))) [data-element-id="chat-input-actions"]:not(:has(> div:last-child > *)) {
  display: none !important;
}
html.tss-tools [data-element-id="chat-input-actions"] {
  transition: opacity .16s ease;
}
@starting-style {
  html.tss-tools [data-element-id="chat-input-actions"] { opacity: 0; }
}

/* 4. Tighter spacing */
html.tss-dense div:has(> [data-element-id="chat-space-end-part"]) {
  padding-top: 4px !important;
}
html.tss-dense [data-element-id="chat-space-end-part"] > div:has(> [data-element-id="message-input"]) {
  margin-bottom: 10px !important;
}
html.tss-dense.tss-phone [data-element-id="chat-space-end-part"] > div:has(> [data-element-id="message-input"]) {
  margin-bottom: 6px !important;
}
html.tss-dense.tss-phone #chat-input-textbox {
  padding-top: 9px !important;
  padding-bottom: 9px !important;
}
html.tss-dense.tss-phone div:has(> div > [data-element-id="chat-space-end-part"]) {
  padding-left: 10px !important;
  padding-right: 10px !important;
}
html.tss-dense.tss-phone [data-element-id="chat-space-middle-part"] > .dynamic-chat-content-container {
  padding-left: 8px !important;
  padding-right: 8px !important;
}
html.tss-dense.tss-phone [data-element-id="chat-space-beginning-part"] {
  min-height: 46px !important;
  padding-top: 4px !important;
  padding-bottom: 4px !important;
}

/* 5. Pull tab */
div:has(> .tss-tab) { position: relative; }
.tss-tab {
  position: absolute;
  z-index: 45;
  top: var(--tss-tab-top, -24px);
  left: var(--tss-tab-x, 50%);
  width: ${T.tabW}px;
  height: ${T.tabH}px;
  margin: 0 0 0 -${T.tabW / 2}px;
  padding: 0;
  border: 0;
  border-radius: 11px;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  touch-action: none;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  --tss-tab-color: #ffffff;
  transition: top .24s cubic-bezier(.2,.8,.2,1);
}
html:not(.dark) .tss-tab { --tss-tab-color: #0f172a; }
.tss-tab::before {
  content: "";
  display: block;
  width: 32px;
  height: 4px;
  border-radius: 999px;
  background: var(--tss-tab-color);
  opacity: .28;
  transition: opacity .15s ease, width .15s ease;
}
html.tss-on.tss-models.tss-hide .tss-tab { top: -24px !important; }
html.tss-hide .tss-tab::before { opacity: .42; }
.tss-tab.tss-press::before { opacity: .8; width: 42px; }
@media (hover: hover) {
  .tss-tab:hover::before { opacity: .62; width: 38px; }
}
.tss-tab:focus-visible { outline: 2px solid rgba(148,163,184,.8); outline-offset: -1px; }

/* Options sheet */
.tss-sheet {
  position: fixed;
  z-index: 2147483000;
  box-sizing: border-box;
  width: min(300px, calc(100vw - 16px));
  padding: 14px 14px 6px;
  border-radius: 16px;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.35;
  color: #ececf1;
  background: var(--main-dark-popup-color, #1f1f22);
  border: 1px solid rgba(255,255,255,.09);
  box-shadow: 0 12px 40px rgba(0,0,0,.45);
  -webkit-tap-highlight-color: transparent;
  animation: tss-pop .16s cubic-bezier(.2,.8,.2,1);
}
html:not(.dark) .tss-sheet {
  color: #0f172a;
  background: #ffffff;
  border-color: rgba(15,23,42,.08);
  box-shadow: 0 12px 40px rgba(15,23,42,.18);
}
@keyframes tss-pop {
  from { opacity: 0; transform: translateY(6px) scale(.98); }
  to { opacity: 1; transform: none; }
}
.tss-title { font-size: 14px; font-weight: 600; }
.tss-sub { font-size: 12px; opacity: .55; margin-top: 1px; }
.tss-seg {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 2px;
  margin-top: 12px;
  padding: 2px;
  border-radius: 10px;
  background: rgba(255,255,255,.06);
}
html:not(.dark) .tss-seg { background: rgba(15,23,42,.05); }
.tss-seg button {
  all: unset;
  box-sizing: border-box;
  padding: 7px 0;
  border-radius: 8px;
  text-align: center;
  font-size: 13px;
  cursor: pointer;
  opacity: .7;
}
.tss-seg button[aria-checked="true"] {
  opacity: 1;
  font-weight: 600;
  background: rgba(255,255,255,.14);
}
html:not(.dark) .tss-seg button[aria-checked="true"] {
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(15,23,42,.14);
}
.tss-note { margin: 8px 2px 6px; min-height: 2.7em; font-size: 12px; opacity: .55; }
.tss-opt {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 2px;
  border-top: 1px solid rgba(255,255,255,.07);
  cursor: pointer;
}
html:not(.dark) .tss-opt { border-top-color: rgba(15,23,42,.07); }
.tss-opt[aria-disabled="true"] { opacity: .4; cursor: default; }
.tss-switch {
  all: unset;
  flex: none;
  position: relative;
  width: 34px;
  height: 20px;
  border-radius: 999px;
  background: rgba(255,255,255,.16);
  cursor: pointer;
  transition: background .15s ease;
}
.tss-switch::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #a1a1aa;
  transition: transform .15s cubic-bezier(.2,.8,.2,1), background .15s ease;
}
.tss-switch[aria-checked="true"] { background: rgba(255,255,255,.86); }
.tss-switch[aria-checked="true"]::after { transform: translateX(14px); background: #18181b; }
html:not(.dark) .tss-switch { background: rgba(15,23,42,.14); }
html:not(.dark) .tss-switch::after { background: #ffffff; box-shadow: 0 1px 2px rgba(15,23,42,.25); }
html:not(.dark) .tss-switch[aria-checked="true"] { background: #0f172a; }
html:not(.dark) .tss-switch[aria-checked="true"]::after { background: #ffffff; }
.tss-seg button:focus-visible,
.tss-switch:focus-visible { outline: 2px solid rgba(148,163,184,.8); outline-offset: 1px; }

/* First-run hint */
.tss-toast {
  position: fixed;
  z-index: 2147483000;
  box-sizing: border-box;
  max-width: min(280px, calc(100vw - 24px));
  padding: 8px 12px;
  border-radius: 12px;
  font-family: inherit;
  font-size: 12.5px;
  line-height: 1.35;
  text-align: center;
  color: #ececf1;
  background: rgba(32,32,36,.97);
  border: 1px solid rgba(255,255,255,.08);
  box-shadow: 0 8px 24px rgba(0,0,0,.35);
  animation: tss-pop .18s cubic-bezier(.2,.8,.2,1);
}
html:not(.dark) .tss-toast {
  color: #0f172a;
  background: rgba(255,255,255,.98);
  border-color: rgba(15,23,42,.08);
}

@media (prefers-reduced-motion: reduce) {
  html.tss-on [data-element-id="chat-space-background"] div:has(+ [data-element-id="chat-space-middle-part"]),
  html.tss-on.tss-models div:has(+ [data-element-id="chat-space-end-part"]),
  html.tss-on.tss-models div:has(> [data-element-id="chat-space-end-part"])::before,
  html.tss-on [data-element-id="chat-space-middle-part"] .sticky.top-0,
  html.tss-tools [data-element-id="chat-input-actions"],
  .tss-tab, .tss-tab::before, .tss-sheet, .tss-toast, .tss-switch, .tss-switch::after {
    transition: none !important;
    animation: none !important;
  }
}
@media print {
  .tss-tab, .tss-sheet, .tss-toast { display: none !important; }
}
`;

  /* ------------------------- state ------------------------- */
  let pane = null;
  let head = null;
  let row = null;
  let footer = null;
  let headOk = false;
  let rowOk = false;
  let headH = 54;
  let hidden = false;

  let lastY = 0;
  let acc = 0;
  let holdY = null;
  let rafId = 0;
  let placeRaf = 0;

  let touchInPane = false;
  let lastTouchEnd = -1e9;
  let lastWheel = -1e9;
  let lastKey = -1e9;
  let barDrag = false;
  let gestureDir = 0; // +1 = toward the bottom, -1 = toward the top, 0 = unknown

  let tabEl = null;
  let sheetEl = null;
  let toastEl = null;
  let toastTimer = 0;
  let hintTimer = 0;

  let ro = null;
  let roDisabled = false;
  let roHits = 0;
  let roWindow = 0;

  let pollTimer = 0;
  let pollTick = 0;
  let lastDark = null;
  let lastDense = null;

  const varCache = Object.create(null);
  const cleanups = [];

  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    cleanups.push(() => target.removeEventListener(type, fn, opts));
  }

  function setVar(name, value) {
    if (varCache[name] === value) return;
    varCache[name] = value;
    root.style.setProperty(name, value);
  }

  const now = () => performance.now();

  function isEditable(el) {
    return !!(el && el.nodeType === 1 &&
      (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)));
  }

  // Finger down, scrollbar drag, or a wheel/key event this instant
  function inputActive() {
    const t = now();
    return touchInPane || barDrag || t - lastWheel < 120 || t - lastKey < 250;
  }

  // Did this scroll come from the user? Momentum after a flick, a smooth
  // wheel animation, or a key repeat keeps going the same way, never backwards.
  // A scroll in the other direction inside that window is TypingMind
  // (auto-scroll) or another extension (Page Outline jump), so it is ignored.
  function userDriven(dy) {
    if (touchInPane || barDrag) return true;
    const t = now();
    const inWindow = t - lastTouchEnd < 1200 || t - lastWheel < 350 || t - lastKey < 700;
    if (!inWindow) return false;
    return gestureDir === 0 || Math.sign(dy) === gestureDir;
  }

  function popupOpen() {
    try { return !!document.querySelector(POPUP_SEL); } catch (e) { return false; }
  }

  /* ------------------------- colors ------------------------- */
  function alphaOf(c) {
    if (!c || c === 'transparent') return 0;
    let m = c.match(/\/\s*([\d.]+)(%?)\s*\)\s*$/);
    if (m) return m[2] ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
    m = c.match(/^rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)$/);
    if (m) return parseFloat(m[1]);
    return 1;
  }

  function detectBg() {
    let el = pane;
    while (el && el !== root) {
      const bg = getComputedStyle(el).backgroundColor;
      if (alphaOf(bg) >= 0.9) return bg;
      el = el.parentElement;
    }
    const b = document.body ? getComputedStyle(document.body).backgroundColor : '';
    if (alphaOf(b) >= 0.9) return b;
    return root.classList.contains('dark') ? 'rgb(24, 24, 27)' : 'rgb(255, 255, 255)';
  }

  function updateBg() {
    if (!pane) return;
    setVar('--tss-bg', detectBg());
  }

  /* ------------------------- classes ------------------------- */
  function applyClasses() {
    const c = cfg();
    const phone = isPhone();
    root.classList.toggle('tss-phone', phone);
    root.classList.toggle('tss-on', c.mode !== 'off' && headOk);
    root.classList.toggle('tss-models', c.models && rowOk);
    root.classList.toggle('tss-tools', c.tools);
    root.classList.toggle('tss-dense', c.dense);
    if (c.mode === 'off' || !headOk) setHidden(false);

    const denseKey = (c.dense ? 'd' : 'n') + (phone ? 'p' : 'w');
    if (lastDense !== null && lastDense !== denseKey) {
      // TypingMind's auto-growing textarea re-measures on window resize
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    }
    lastDense = denseKey;

    if (tabEl) {
      tabEl.title = phone ? '' : (hidden ? 'Show header' : 'Hide header') + ' (' + SHORTCUT + '). Right-click for options';
    }
    schedulePlaceTab();
  }

  function setHidden(value, manual) {
    let v = !!value;
    if (cfg().mode === 'off' || !headOk) v = false;
    if (manual) {
      holdY = pane ? pane.scrollTop : 0;
      acc = 0;
    }
    if (v === hidden) return;
    hidden = v;
    root.classList.toggle('tss-hide', v);
    if (tabEl) {
      tabEl.setAttribute('aria-label', v ? 'Show header' : 'Hide header');
      tabEl.setAttribute('aria-expanded', String(!v));
      if (!isPhone()) {
        tabEl.title = (v ? 'Show header' : 'Hide header') + ' (' + SHORTCUT + '). Right-click for options';
      }
    }
    if (v && head && head.contains(document.activeElement)) {
      try { document.activeElement.blur(); } catch (e) { /* ignore */ }
    }
  }

  /* ------------------------- measuring ------------------------- */
  function measureHead() {
    if (!head || !head.isConnected) return;
    const h = head.offsetHeight;
    if (h > 0) {
      headH = h;
      setVar('--tss-head', h + 'px');
    }
  }

  function measureRow() {
    if (!row || !row.isConnected) return;
    const h = row.offsetHeight;
    if (h > 0) setVar('--tss-row', h + 'px');
  }

  function placeTab() {
    placeRaf = 0;
    if (!tabEl || !footer || tabEl.parentElement !== footer) return;
    let top = -(T.tabH + 2);
    let x = Math.round(footer.clientWidth / 2);
    if (row && row.isConnected && row.parentElement === footer && row.offsetHeight > 0) {
      top = row.offsetTop + Math.round((row.offsetHeight - T.tabH) / 2);
      const kids = row.children;
      if (kids.length >= 2) {
        const fr = footer.getBoundingClientRect();
        const a = kids[0].getBoundingClientRect();
        const b = kids[kids.length - 1].getBoundingClientRect();
        if (b.left - a.right >= T.tabW + 8) x = Math.round((a.right + b.left) / 2 - fr.left);
      }
    }
    setVar('--tss-tab-top', top + 'px');
    setVar('--tss-tab-x', x + 'px');
  }

  function schedulePlaceTab() {
    if (!placeRaf) placeRaf = requestAnimationFrame(placeTab);
  }

  function makeRO() {
    if (!('ResizeObserver' in window)) { roDisabled = true; return; }
    ro = new ResizeObserver((entries) => {
      const t = now();
      if (t - roWindow > 2000) { roWindow = t; roHits = 0; }
      if (++roHits > 240) {
        ro.disconnect();
        roDisabled = true;
        console.warn('[Space Saver] Resize storm detected. Switched to polling.');
        return;
      }
      for (const entry of entries) {
        if (entry.target === head) measureHead();
        else if (entry.target === row) measureRow();
      }
      schedulePlaceTab();
    });
  }

  /* ------------------------- binding ------------------------- */
  function bindPane(p) {
    pane = p || null;
    lastY = pane ? pane.scrollTop : 0;
    acc = 0;
    holdY = null;
    if (pane) updateBg();
  }

  function bindHead(h) {
    if (head && ro && !roDisabled) ro.unobserve(head);
    head = h || null;
    headOk = !!(head && head.nodeType === 1 && head.querySelector(SEL.head));
    if (head && ro && !roDisabled) ro.observe(head);
    measureHead();
    applyClasses();
  }

  function bindFooter(r, f) {
    if (row && ro && !roDisabled) ro.unobserve(row);
    row = r || null;
    footer = f || null;
    rowOk = !!(row && row.nodeType === 1 && row.querySelector('button') && !row.querySelector('textarea'));
    if (row && ro && !roDisabled) ro.observe(row);
    measureRow();
    if (footer) {
      if (tabEl.parentElement !== footer) footer.appendChild(tabEl);
      if (!store.hinted && !hintTimer) hintTimer = setTimeout(maybeHint, 1800);
    } else if (tabEl.isConnected) {
      tabEl.remove();
    }
    applyClasses();
  }

  function sync() {
    const p = document.querySelector(SEL.pane);
    if (p !== pane) bindPane(p);
    if (!pane) {
      if (head || row || footer) { bindHead(null); bindFooter(null, null); }
      return;
    }
    const h = pane.previousElementSibling;
    if (h !== head) bindHead(h);
    const column = pane.parentElement;
    const end = column ? column.querySelector(SEL.end) : null;
    const r = end ? end.previousElementSibling : null;
    const f = end ? end.parentElement : null;
    if (r !== row || f !== footer) bindFooter(r, f);
    else if (footer && tabEl.parentElement !== footer) footer.appendChild(tabEl);
    if (roDisabled) { measureHead(); measureRow(); }
    schedulePlaceTab();
  }

  /* ------------------------- scroll logic ------------------------- */
  function tick() {
    rafId = 0;
    const el = pane;
    if (!el || !el.isConnected) return;
    const y = el.scrollTop;
    const dy = y - lastY;
    lastY = y;

    if (dy !== 0 && (touchInPane || barDrag)) gestureDir = Math.sign(dy);

    if (cfg().mode !== 'auto' || !headOk) return;

    const user = userDriven(dy);
    if (!user && Math.abs(dy) > el.clientHeight) acc = 0; // chat switch or jump: keep state

    if (y <= headH + 16) {
      if (holdY === null) setHidden(false);
      acc = 0;
      return;
    }
    if (holdY !== null) {
      if (Math.abs(y - holdY) < T.holdPx) return;
      holdY = null;
      acc = 0;
    }
    if (!user || dy === 0) return;

    if ((dy > 0 && acc < 0) || (dy < 0 && acc > 0)) acc = 0;
    acc += dy;
    if (acc >= T.hideAfter) {
      acc = 0;
      if (!hidden && !popupOpen()) setHidden(true);
    } else if (acc <= -T.showAfter) {
      acc = 0;
      if (hidden) setHidden(false);
    }
  }

  function onScroll(e) {
    const t = e.target;
    if (t !== pane) {
      if (!(t instanceof Element) || !t.matches(SEL.pane)) return;
      bindPane(t);
    }
    if (inputActive()) {
      if (sheetEl) closeSheet(false);
      if (toastEl) closeToast(false);
    }
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  /* ------------------------- tab ------------------------- */
  function onTabTap() {
    closeToast(true);
    if (sheetEl) { closeSheet(false); return; }
    if (cfg().mode === 'off') { openSheet(); return; }
    setHidden(!hidden, true);
  }

  function makeTab() {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tss-tab';
    b.setAttribute('aria-label', 'Hide header');
    b.setAttribute('aria-expanded', 'true');

    let timer = 0;
    let sx = 0;
    let sy = 0;
    let down = false;
    let cancelled = false;
    let pid = null;
    let lastType = 'mouse';
    let lastHandled = -1e9; // a press we already acted on; the browser's follow-up click is ignored

    const release = () => {
      clearTimeout(timer);
      timer = 0;
      down = false;
      b.classList.remove('tss-press');
      if (pid !== null) {
        try { b.releasePointerCapture(pid); } catch (e) { /* ignore */ }
        pid = null;
      }
    };

    b.addEventListener('pointerdown', (e) => {
      lastType = e.pointerType || 'mouse';
      // Keep focus where it is. Otherwise pressing the tab blurs the message
      // box, idle tools collapse, the footer shrinks, and the tab slides out
      // from under the pointer mid-press (and the phone keyboard would close).
      e.preventDefault();
      if (e.button !== 0) return;
      down = true;
      cancelled = false;
      sx = e.clientX;
      sy = e.clientY;
      pid = e.pointerId;
      try { b.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      b.classList.add('tss-press');
      timer = setTimeout(() => {
        cancelled = true;
        lastHandled = now();
        b.classList.remove('tss-press');
        try { if (navigator.vibrate) navigator.vibrate(8); } catch (err) { /* ignore */ }
        openSheet();
      }, T.longPressMs);
    });

    b.addEventListener('pointermove', (e) => {
      if (!down) return;
      if (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10) {
        cancelled = true;
        lastHandled = now();
        release();
      }
    });

    b.addEventListener('pointerup', () => {
      if (!down) return;
      const wasCancelled = cancelled;
      release();
      if (!wasCancelled) {
        lastHandled = now();
        onTabTap();
      }
    });

    b.addEventListener('pointercancel', () => {
      cancelled = true;
      lastHandled = now();
      release();
    });

    // Presses are handled above. A click that arrives on its own (screen reader
    // activation, element.click()) still works; the browser's duplicate click
    // right after a handled press is ignored.
    b.addEventListener('click', (e) => {
      e.preventDefault();
      if (now() - lastHandled > 700) onTabTap();
    });

    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (lastType === 'mouse' && now() - lastHandled > 700) {
        lastHandled = now();
        openSheet();
      }
    });

    b.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (e.repeat) return;
        lastHandled = now();
        onTabTap();
        return;
      }
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault();
        lastHandled = now();
        openSheet();
      }
    });

    return b;
  }

  /* ------------------------- options sheet ------------------------- */
  function modeNote(mode) {
    if (mode === 'auto') return 'Hides when you scroll down. Scroll up or tap the tab to bring it back.';
    if (mode === 'manual') {
      return isPhone()
        ? 'Stays where you leave it. Tap the tab to show or hide it.'
        : 'Stays where you leave it. Tap the tab or press ' + SHORTCUT + '.';
    }
    return 'Normal TypingMind header. Tap the tab to open these options.';
  }

  function renderSheet() {
    if (!sheetEl) return;
    const c = cfg();
    sheetEl.querySelector('.tss-sub').textContent = isPhone() ? 'Phone layout' : 'Desktop layout';
    sheetEl.querySelectorAll('.tss-seg button').forEach((btn) => {
      btn.setAttribute('aria-checked', String(btn.dataset.mode === c.mode));
      btn.tabIndex = btn.dataset.mode === c.mode ? 0 : -1;
    });
    sheetEl.querySelector('.tss-note').textContent = modeNote(c.mode);
    sheetEl.querySelectorAll('.tss-opt').forEach((opt) => {
      const key = opt.dataset.key;
      const sw = opt.querySelector('.tss-switch');
      sw.setAttribute('aria-checked', String(!!c[key]));
      const disabled = key === 'models' && c.mode === 'off';
      opt.setAttribute('aria-disabled', String(disabled));
      sw.disabled = disabled;
    });
  }

  function positionSheet() {
    if (!sheetEl) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = sheetEl.offsetWidth;
    const h = sheetEl.offsetHeight;
    const r = tabEl && tabEl.isConnected ? tabEl.getBoundingClientRect() : null;
    const hasAnchor = !!(r && r.width);
    const cx = hasAnchor ? r.left + r.width / 2 : vw / 2;
    const left = Math.max(8, Math.min(vw - w - 8, Math.round(cx - w / 2)));
    let top = hasAnchor ? Math.round(r.top - h - 8) : Math.round((vh - h) / 2);
    if (top < 8) top = hasAnchor ? Math.min(vh - h - 8, Math.round(r.bottom + 8)) : 8;
    sheetEl.style.left = left + 'px';
    sheetEl.style.top = Math.max(8, top) + 'px';
  }

  function setMode(mode) {
    const c = cfg();
    if (!MODES.includes(mode) || c.mode === mode) return;
    c.mode = mode;
    saveStore();
    holdY = null;
    acc = 0;
    applyClasses();
    renderSheet();
    requestAnimationFrame(positionSheet);
  }

  function toggleOption(key) {
    const c = cfg();
    if (key === 'models' && c.mode === 'off') return;
    c[key] = !c[key];
    saveStore();
    applyClasses();
    renderSheet();
    requestAnimationFrame(positionSheet);
  }

  function openSheet() {
    closeToast(true);
    if (sheetEl) { closeSheet(false); return; }
    const el = document.createElement('div');
    el.className = 'tss-sheet';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Space Saver options');
    el.innerHTML =
      '<div class="tss-title">Space Saver</div>' +
      '<div class="tss-sub"></div>' +
      '<div class="tss-seg" role="radiogroup" aria-label="Header">' +
        '<button type="button" role="radio" data-mode="auto">Auto-hide</button>' +
        '<button type="button" role="radio" data-mode="manual">Manual</button>' +
        '<button type="button" role="radio" data-mode="off">Off</button>' +
      '</div>' +
      '<div class="tss-note"></div>' +
      '<div class="tss-opt" data-key="models"><span>Hide model row with header</span>' +
        '<button type="button" class="tss-switch" role="switch" aria-label="Hide model row with header"></button></div>' +
      '<div class="tss-opt" data-key="tools"><span>Hide input tools until you tap the box</span>' +
        '<button type="button" class="tss-switch" role="switch" aria-label="Hide input tools until you tap the box"></button></div>' +
      '<div class="tss-opt" data-key="dense"><span>Tighter spacing</span>' +
        '<button type="button" class="tss-switch" role="switch" aria-label="Tighter spacing"></button></div>';

    // Pointer presses inside the sheet must not pull focus out of the message box
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); });

    el.addEventListener('click', (e) => {
      const seg = e.target.closest('.tss-seg button');
      if (seg) { setMode(seg.dataset.mode); return; }
      const opt = e.target.closest('.tss-opt');
      if (opt) toggleOption(opt.dataset.key);
    });

    el.addEventListener('keydown', (e) => {
      const seg = e.target.closest && e.target.closest('.tss-seg button');
      if (!seg || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      e.preventDefault();
      const i = MODES.indexOf(seg.dataset.mode);
      const next = MODES[(i + (e.key === 'ArrowRight' ? 1 : MODES.length - 1)) % MODES.length];
      setMode(next);
      const btn = el.querySelector('.tss-seg button[data-mode="' + next + '"]');
      if (btn) btn.focus();
    });

    document.body.appendChild(el);
    sheetEl = el;
    renderSheet();
    positionSheet();
    if (tabEl && document.activeElement === tabEl) {
      const current = el.querySelector('.tss-seg button[aria-checked="true"]');
      if (current) current.focus();
    }
  }

  function closeSheet(restoreFocus) {
    if (!sheetEl) return;
    const hadFocus = sheetEl.contains(document.activeElement);
    sheetEl.remove();
    sheetEl = null;
    if ((restoreFocus || hadFocus) && tabEl && tabEl.isConnected) {
      try { tabEl.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }
  }

  /* ------------------------- first-run hint ------------------------- */
  function maybeHint() {
    hintTimer = 0;
    if (store.hinted || toastEl || !tabEl || !tabEl.isConnected) return;
    const r = tabEl.getBoundingClientRect();
    if (!r.width || r.top < 80 || r.bottom > window.innerHeight) {
      hintTimer = setTimeout(maybeHint, 3000);
      return;
    }
    store.hinted = true;
    saveStore();
    const t = document.createElement('div');
    t.className = 'tss-toast';
    t.setAttribute('role', 'status');
    t.textContent = isPhone()
      ? 'Tap this tab to show or hide the header. Hold it for options.'
      : 'Tap this tab or press ' + SHORTCUT + ' to show or hide the header. Right-click it for options.';
    t.addEventListener('click', () => closeToast(true));
    document.body.appendChild(t);
    const w = t.offsetWidth;
    const h = t.offsetHeight;
    const cx = r.left + r.width / 2;
    t.style.left = Math.max(12, Math.min(window.innerWidth - w - 12, Math.round(cx - w / 2))) + 'px';
    t.style.top = Math.max(12, Math.round(r.top - h - 10)) + 'px';
    toastEl = t;
    toastTimer = setTimeout(() => closeToast(true), 5200);
  }

  function closeToast(markSeen) {
    if (markSeen && !store.hinted) { store.hinted = true; saveStore(); }
    clearTimeout(toastTimer);
    toastTimer = 0;
    if (toastEl) { toastEl.remove(); toastEl = null; }
  }

  /* ------------------------- global listeners ------------------------- */
  function installListeners() {
    on(document, 'scroll', onScroll, { capture: true, passive: true });

    on(document, 'touchstart', (e) => {
      const t = e.target;
      touchInPane = !!(pane && t instanceof Node && pane.contains(t));
      if (touchInPane) gestureDir = 0;
    }, { capture: true, passive: true });

    const endTouch = () => {
      if (touchInPane) lastTouchEnd = now();
      touchInPane = false;
    };
    on(document, 'touchend', endTouch, { capture: true, passive: true });
    on(document, 'touchcancel', endTouch, { capture: true, passive: true });

    on(document, 'wheel', (e) => {
      if (!pane || !(e.target instanceof Node) || !pane.contains(e.target)) return;
      if (e.deltaY === 0) return; // horizontal scrolling (code blocks, tables)
      lastWheel = now();
      gestureDir = Math.sign(e.deltaY);
    }, { capture: true, passive: true });

    on(document, 'pointerdown', (e) => {
      if (pane && e.target === pane && e.pointerType === 'mouse') barDrag = true; // scrollbar drag
      if (sheetEl && !sheetEl.contains(e.target) && !(tabEl && tabEl.contains(e.target))) closeSheet(false);
      if (toastEl && !(tabEl && tabEl.contains(e.target))) closeToast(true);
    }, true);

    on(window, 'pointerup', () => {
      if (barDrag) { barDrag = false; lastWheel = now(); }
    }, true);

    on(document, 'keydown', (e) => {
      if (e.isComposing) return;
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.code === 'KeyH') {
        if (!pane || cfg().mode === 'off' || !headOk) return;
        e.preventDefault();
        e.stopPropagation();
        setHidden(!hidden, true);
        return;
      }
      if (e.key === 'Escape' && sheetEl) {
        e.preventDefault();
        e.stopPropagation();
        closeSheet(true);
        return;
      }
      if (SCROLL_KEYS.has(e.key) && !isEditable(e.target)) {
        lastKey = now();
        const up = e.key === 'PageUp' || e.key === 'ArrowUp' || e.key === 'Home' || (e.key === ' ' && e.shiftKey);
        gestureDir = up ? -1 : 1;
      }
    }, true);

    on(window, 'resize', () => {
      schedulePlaceTab();
      if (sheetEl) requestAnimationFrame(positionSheet);
    }, { passive: true });

    on(document, 'visibilitychange', () => {
      if (!document.hidden) sync();
    });

    const onDevice = () => {
      closeSheet(false);
      holdY = null;
      acc = 0;
      applyClasses();
    };
    if (mqPhone.addEventListener) {
      mqPhone.addEventListener('change', onDevice);
      cleanups.push(() => mqPhone.removeEventListener('change', onDevice));
    } else if (mqPhone.addListener) {
      mqPhone.addListener(onDevice);
      cleanups.push(() => mqPhone.removeListener(onDevice));
    }
  }

  /* ------------------------- lifecycle ------------------------- */
  function teardown() {
    cleanups.splice(0).forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } });
    clearInterval(pollTimer);
    clearTimeout(hintTimer);
    if (ro) ro.disconnect();
    if (rafId) cancelAnimationFrame(rafId);
    if (placeRaf) cancelAnimationFrame(placeRaf);
    closeSheet(false);
    closeToast(false);
    if (tabEl) tabEl.remove();
    const style = document.getElementById('tss-style');
    if (style) style.remove();
    ['tss-on', 'tss-hide', 'tss-models', 'tss-tools', 'tss-dense', 'tss-phone']
      .forEach((c) => root.classList.remove(c));
    ['--tss-head', '--tss-row', '--tss-bg', '--tss-tab-top', '--tss-tab-x']
      .forEach((v) => root.style.removeProperty(v));
    if (window.tmSpace && window.tmSpace.version === VERSION) delete window.tmSpace;
    window.__tssTeardown = null;
    console.log('[Space Saver] Off until the app reloads.');
  }

  function init() {
    const style = document.createElement('style');
    style.id = 'tss-style';
    style.textContent = CSS_TEXT;
    (document.head || root).appendChild(style);

    tabEl = makeTab();
    makeRO();
    installListeners();
    applyClasses();
    sync();

    pollTimer = setInterval(() => {
      if (document.hidden) return;
      pollTick++;
      sync();
      const dark = root.classList.contains('dark');
      if (dark !== lastDark || pollTick % 8 === 0) {
        lastDark = dark;
        updateBg();
      }
    }, T.pollMs);

    window.__tssTeardown = teardown;
    window.tmSpace = {
      version: VERSION,
      show: () => setHidden(false, true),
      hide: () => setHidden(true, true),
      toggle: () => setHidden(!hidden, true),
      options: () => openSheet(),
      settings: () => JSON.parse(JSON.stringify(store)),
      reset: () => {
        store = { phone: cleanProfile(null), desktop: cleanProfile(null), hinted: true };
        saveStore();
        holdY = null;
        applyClasses();
        renderSheet();
      },
      off: teardown,
    };

    console.log('[Space Saver] v' + VERSION + ' ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
