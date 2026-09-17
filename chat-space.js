/* =====================================================================
 * TypingMind - Space Saver  v2.0
 * ---------------------------------------------------------------------
 * More reading room on phone and desktop.
 *
 *   1. Header slides away when you scroll down. Scrolling up does not
 *      bring it back (on purpose). It comes back when you tap the handle,
 *      open another chat, or the chat is too short to scroll.
 *   2. The model / Thinking / reasoning row hides with the header.
 *   3. Input tools collapse while the message box is idle. They stay open
 *      while you type, while a reply streams, while a menu is open, and
 *      for a few seconds after you touch any of them.
 *   4. Tighter spacing around the header and input.
 *   5. A small handle floats above the input area. It never sits on top
 *      of TypingMind's own buttons.
 *        tap    = show / hide the header
 *        hold   = options (right-click also works on desktop)
 *        Alt+Shift+H (Option+Shift+H on Mac) = show / hide the header
 *
 *   Colors are read from whatever TypingMind is actually showing (light,
 *   dark, system or custom theme) and update the moment the theme changes.
 *   Options are saved separately for the phone and desktop layouts.
 *
 * Install: TypingMind -> Settings -> Advanced Settings -> Extensions ->
 *          paste the URL of this file -> Install -> restart the app.
 *
 * Console: tmSpace.toggle() .show() .hide() .options() .reset() .debug()
 * Kill switch (until reload): tmSpace.off()
 *
 * Fail-safe: if TypingMind changes its layout and a part can't be found
 * or looks wrong, that feature turns itself off and the app falls back
 * to its normal layout instead of breaking.
 *
 * How it hooks in:
 *   - Only stable data-element-id hooks are used to find parts. Wrapper
 *     elements get tagged with data-tss-* attributes, and all CSS targets
 *     those tags (no heavy :has() selectors running on every DOM change).
 *   - Observers are narrow and loop-safe: childList-only on two wrapper
 *     elements, and a filtered attribute watch on <html>/<body> for theme
 *     changes. Plus a light 800ms poll as a safety net.
 * ===================================================================*/
(() => {
  'use strict';

  const VERSION = '2.0.0';
  const STORE_KEY = 'tm-space-saver:v2';
  const LEGACY_KEYS = ['tm-space-saver:v1'];
  const LOG = '[Space Saver]';

  // Swap versions cleanly: tear down any copy that is already running.
  try {
    if (typeof window.__tssTeardown === 'function') window.__tssTeardown();
  } catch (e) { /* ignore */ }

  const root = document.documentElement;

  /* =================================================================
   * Config
   * =================================================================*/

  const SEL = {
    pane: '[data-element-id="chat-space-middle-part"]',
    headInner: '[data-element-id="chat-space-beginning-part"]',
    end: '[data-element-id="chat-space-end-part"]',
    input: '[data-element-id="message-input"]',
    textbox: '#chat-input-textbox',
    actions: '[data-element-id="chat-input-actions"]',
  };

  const T = {
    hideAfter: 40,        // px of deliberate downward scroll before hiding
    holdPx: 120,          // after a manual toggle, ignore this much scroll
    pollMs: 800,
    longPressMs: 450,
    collapseDelayMs: 300, // idle time before input tools collapse
    toolsGraceMs: 2500,   // tools stay open this long after you touch them
    outsideQuietMs: 600,  // no auto-hide right after tapping app controls
    pointerStuckMs: 12000, // safety net for a pointerup that never arrives
    tabW: 44,
    tabH: 22,
    tabGap: 6,
  };

  const MODES = ['auto', 'manual', 'off'];
  const DEFAULTS = { mode: 'auto', models: true, tools: true, dense: true };
  const ROLES = ['col', 'head', 'row', 'footer', 'dock', 'content', 'inputwrap'];
  const STATE_CLASSES = [
    'tss-on', 'tss-hide', 'tss-models', 'tss-tools',
    'tss-idle', 'tss-dense', 'tss-phone', 'tss-ready',
  ];

  const INTERACTIVE = [
    'button', 'a[href]', 'input', 'select', 'textarea', 'summary',
    '[role="button"]', '[role="link"]', '[role="menuitem"]', '[role="tab"]',
    '[role="switch"]', '[role="checkbox"]', '[contenteditable="true"]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  const POPUP_SEL = (() => {
    const list = [
      '[role="menu"]',
      '[role="listbox"]',
      '[role="dialog"]',
      '[role="alertdialog"]',
      '[data-radix-popper-content-wrapper]',
      '[id^="headlessui-menu-items"]',
      '[id^="headlessui-listbox-options"]',
      '[id^="headlessui-popover-panel"]',
      '[id^="headlessui-dialog"]',
    ];
    try {
      if (window.CSS && CSS.supports('selector(:popover-open)')) list.push(':popover-open');
    } catch (e) { /* ignore */ }
    return list.join(',');
  })();

  // A trigger button whose menu is open (Thinking, reasoning level, model...)
  const OPEN_TRIGGER_SEL = '[aria-haspopup]:not([aria-haspopup="false"])[aria-expanded="true"]';

  const SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End', ' ']);
  const STOP_RE = /\bstop\b/i;

  const isApple = /mac|iphone|ipad|ipod/i.test(
    (navigator.userAgentData && navigator.userAgentData.platform) ||
    navigator.platform || navigator.userAgent || ''
  );
  const SHORTCUT = isApple ? 'Option+Shift+H' : 'Alt+Shift+H';

  function mq(query) {
    try {
      return window.matchMedia(query);
    } catch (e) {
      return { matches: false };
    }
  }

  const mqPhone = mq('(max-width: 767.98px)');
  const mqDark = mq('(prefers-color-scheme: dark)');

  const queueMicro = typeof window.queueMicrotask === 'function'
    ? (fn) => window.queueMicrotask(fn)
    : (fn) => Promise.resolve().then(fn);

  /* =================================================================
   * Storage
   * =================================================================*/

  function readJSON(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function cleanProfile(p) {
    const src = p && typeof p === 'object' ? p : {};
    return {
      mode: MODES.includes(src.mode) ? src.mode : DEFAULTS.mode,
      models: typeof src.models === 'boolean' ? src.models : DEFAULTS.models,
      tools: typeof src.tools === 'boolean' ? src.tools : DEFAULTS.tools,
      dense: typeof src.dense === 'boolean' ? src.dense : DEFAULTS.dense,
    };
  }

  function loadStore() {
    let s = readJSON(STORE_KEY);
    if (!s) {
      for (const key of LEGACY_KEYS) {
        s = readJSON(key);
        if (s) break;
      }
    }
    s = s && typeof s === 'object' ? s : {};
    return {
      phone: cleanProfile(s.phone),
      desktop: cleanProfile(s.desktop),
      hinted: !!s.hinted,
    };
  }

  let store = loadStore();

  function saveStore() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (e) { /* storage blocked */ }
  }

  const isPhone = () => !!mqPhone.matches;
  const cfg = () => store[isPhone() ? 'phone' : 'desktop'];

  /* =================================================================
   * Styles
   * =================================================================*/

  const CSS_TEXT = String.raw`
:root {
  --tss-tab-w: ${T.tabW}px;
  --tss-tab-h: ${T.tabH}px;
  --tss-tab-gap: ${T.tabGap}px;
  --tss-tab-space: ${T.tabH + T.tabGap * 2}px;
  --tss-ease: cubic-bezier(.2, .8, .2, 1);
}

/* ---------- Theme tokens (picked from the real background) ---------- */

html {
  --tss-fg: #0f172a;
  --tss-muted: rgba(15, 23, 42, .56);
  --tss-line: rgba(15, 23, 42, .10);
  --tss-pill: rgba(255, 255, 255, .86);
  --tss-surface: var(--tss-bg, #ffffff);
  --tss-seg: rgba(15, 23, 42, .05);
  --tss-seg-on: #ffffff;
  --tss-seg-on-shadow: 0 1px 2px rgba(15, 23, 42, .14);
  --tss-shadow: 0 12px 40px rgba(15, 23, 42, .18);
  --tss-switch-off: rgba(15, 23, 42, .14);
  --tss-switch-on: #0f172a;
  --tss-knob-off: #ffffff;
  --tss-knob-on: #ffffff;
  --tss-focus: rgba(100, 116, 139, .7);
}

html[data-tss-theme="dark"] {
  --tss-fg: #ececf1;
  --tss-muted: rgba(236, 236, 241, .56);
  --tss-line: rgba(255, 255, 255, .10);
  --tss-pill: rgba(39, 39, 42, .82);
  --tss-surface: #1f1f23;
  --tss-seg: rgba(255, 255, 255, .06);
  --tss-seg-on: rgba(255, 255, 255, .14);
  --tss-seg-on-shadow: none;
  --tss-shadow: 0 12px 40px rgba(0, 0, 0, .45);
  --tss-switch-off: rgba(255, 255, 255, .16);
  --tss-switch-on: rgba(255, 255, 255, .88);
  --tss-knob-off: #a1a1aa;
  --tss-knob-on: #18181b;
  --tss-focus: rgba(148, 163, 184, .8);
}

@supports (color: color-mix(in srgb, red, blue)) {
  html {
    --tss-pill: color-mix(in srgb, var(--tss-bg, #ffffff) 86%, transparent);
  }
  html[data-tss-theme="dark"] {
    --tss-pill: color-mix(in srgb, var(--tss-bg, #18181b) 82%, #ffffff 4%);
    --tss-surface: color-mix(in srgb, var(--tss-bg, #18181b) 92%, #ffffff);
  }
}

/* ---------- 1. Header floats over the chat ---------- */

html.tss-on [data-tss-col] {
  position: relative;
}

html.tss-on [data-tss-head] {
  position: absolute !important;
  top: 0;
  left: 0;
  right: 0;
  z-index: 20;
  background-color: var(--tss-bg, Canvas) !important;
  transition:
    transform .26s var(--tss-ease),
    opacity .2s ease,
    visibility 0s linear 0s;
}

html.tss-on.tss-hide [data-tss-head] {
  transform: translateY(calc(-100% - 4px));
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition:
    transform .26s var(--tss-ease),
    opacity .2s ease,
    visibility 0s linear .26s;
}

/* Chat keeps a fixed top gap so hiding the header never makes text jump */
html.tss-on [data-tss-content] {
  padding-top: calc(var(--tss-content-pad, 1rem) + var(--tss-head, 54px)) !important;
}

html.tss-on {
  --tss-stick: var(--tss-head, 54px);
}

html.tss-on.tss-hide {
  --tss-stick: 0px;
}

html.tss-on [data-element-id="chat-space-middle-part"] {
  scroll-padding-top: var(--tss-stick);
}

/* Sticky bars inside the chat sit under the header */
html.tss-on [data-element-id="chat-space-middle-part"] .sticky.top-0 {
  top: var(--tss-stick) !important;
  transition: top .26s var(--tss-ease);
}

/* Multi-model tabs stop sticking while the header is hidden */
html.tss-on.tss-hide [data-element-id="chat-space-middle-part"] .sticky.top-0[class~="z-[5]"] {
  position: relative !important;
}

/* ---------- 2. Model / Thinking / reasoning row ---------- */

html.tss-ready [data-tss-footer],
html.tss-models [data-tss-footer] {
  position: relative;
}

html.tss-models [data-tss-row] {
  position: absolute !important;
  left: 0;
  right: 0;
  bottom: 100%;
  z-index: 40;
  padding-top: 8px !important;
  padding-bottom: 2px !important;
  background: linear-gradient(to top, var(--tss-bg, Canvas) 70%, transparent);
  transition:
    transform .22s var(--tss-ease),
    opacity .18s ease,
    visibility 0s linear 0s;
}

html.tss-models.tss-hide [data-tss-row] {
  transform: translateY(10px);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition:
    transform .22s var(--tss-ease),
    opacity .18s ease,
    visibility 0s linear .22s;
}

/* Keep the end of the chat clear of the handle and the floating row */
html.tss-ready [data-element-id="chat-space-middle-part"] [data-element-id="scroll-padding"] {
  margin-top: var(--tss-tab-space);
}

html.tss-models [data-element-id="chat-space-middle-part"] [data-element-id="scroll-padding"] {
  margin-top: calc(var(--tss-row, 44px) + var(--tss-tab-space));
}

/* Soft fade where the chat meets the input while the row is hidden */
html.tss-models [data-tss-footer]::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: 100%;
  height: 28px;
  z-index: 39;
  pointer-events: none;
  background: linear-gradient(to bottom, transparent, var(--tss-bg, Canvas) 80%);
  opacity: 0;
  transition: opacity .2s ease;
}

html.tss-models.tss-hide [data-tss-footer]::before {
  opacity: 1;
}

/* ---------- 3. Input tools collapse while idle (JS decides "idle") ---------- */

html.tss-tools.tss-idle [data-element-id="chat-space-end-part"] [data-element-id="chat-input-actions"] {
  display: none !important;
}

html.tss-tools [data-element-id="chat-space-end-part"] [data-element-id="chat-input-actions"] {
  transition: opacity .16s ease;
}

@starting-style {
  html.tss-tools [data-element-id="chat-space-end-part"] [data-element-id="chat-input-actions"] {
    opacity: 0;
  }
}

/* ---------- 4. Tighter spacing ---------- */

html.tss-dense [data-tss-footer] {
  padding-top: 4px !important;
}

html.tss-dense [data-tss-inputwrap] {
  margin-bottom: 10px !important;
}

html.tss-dense.tss-phone [data-tss-inputwrap] {
  margin-bottom: 6px !important;
}

html.tss-dense.tss-phone #chat-input-textbox {
  padding-top: 9px !important;
  padding-bottom: 9px !important;
}

html.tss-dense.tss-phone [data-tss-dock] {
  padding-left: 10px !important;
  padding-right: 10px !important;
}

html.tss-dense.tss-phone [data-tss-content] {
  padding-left: 8px !important;
  padding-right: 8px !important;
}

html.tss-dense.tss-phone [data-element-id="chat-space-beginning-part"] {
  min-height: 46px !important;
  padding-top: 4px !important;
  padding-bottom: 4px !important;
}

/* ---------- 5. Handle ---------- */

.tss-tab {
  all: unset;
  box-sizing: border-box;
  position: absolute;
  z-index: 45;
  top: calc(-1 * (var(--tss-tab-h) + var(--tss-tab-gap)));
  left: 50%;
  width: var(--tss-tab-w);
  height: var(--tss-tab-h);
  margin-left: calc(var(--tss-tab-w) / -2);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  color: var(--tss-fg);
  background: var(--tss-pill);
  box-shadow: inset 0 0 0 1px var(--tss-line);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  cursor: pointer;
  touch-action: none;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  opacity: .6;
  transition:
    top .24s var(--tss-ease),
    left .2s var(--tss-ease),
    opacity .15s ease,
    transform .15s ease;
}

/* Bigger touch target without a bigger look */
.tss-tab::after {
  content: "";
  position: absolute;
  inset: -8px -10px -4px;
}

.tss-tab::before {
  content: "";
  display: block;
  box-sizing: border-box;
  width: 8px;
  height: 8px;
  border-right: 2px solid currentColor;
  border-bottom: 2px solid currentColor;
  opacity: .7;
  transform: translateY(2px) rotate(-135deg);
  transition: transform .18s var(--tss-ease), opacity .15s ease;
}

/* Header hidden: chevron points down ("pull it back") */
html.tss-hide .tss-tab::before {
  transform: translateY(-2px) rotate(45deg);
  opacity: .9;
}

/* Sit above the model row while it is showing, never on top of it */
html.tss-models:not(.tss-hide) .tss-tab {
  top: calc(-1 * (var(--tss-row, 44px) + var(--tss-tab-h) + var(--tss-tab-gap)));
}

html:not(.tss-on) .tss-tab {
  opacity: .4;
}

.tss-tab.tss-press {
  opacity: 1;
  transform: scale(.94);
}

@media (hover: hover) {
  .tss-tab:hover {
    opacity: 1;
  }
}

.tss-tab:focus-visible {
  opacity: 1;
  outline: 2px solid var(--tss-focus);
  outline-offset: 2px;
}

/* ---------- Options sheet ---------- */

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
  color: var(--tss-fg);
  background: var(--tss-surface);
  box-shadow: 0 0 0 1px var(--tss-line), var(--tss-shadow);
  -webkit-tap-highlight-color: transparent;
  animation: tss-pop .16s var(--tss-ease);
}

@keyframes tss-pop {
  from { opacity: 0; transform: translateY(6px) scale(.98); }
  to { opacity: 1; transform: none; }
}

.tss-title {
  font-size: 14px;
  font-weight: 600;
}

.tss-sub {
  margin-top: 1px;
  font-size: 12px;
  color: var(--tss-muted);
}

.tss-seg {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 2px;
  margin-top: 12px;
  padding: 2px;
  border-radius: 10px;
  background: var(--tss-seg);
}

.tss-seg button {
  all: unset;
  box-sizing: border-box;
  padding: 7px 0;
  border-radius: 8px;
  text-align: center;
  font-size: 13px;
  color: var(--tss-fg);
  cursor: pointer;
  opacity: .7;
}

.tss-seg button[aria-checked="true"] {
  opacity: 1;
  font-weight: 600;
  background: var(--tss-seg-on);
  box-shadow: var(--tss-seg-on-shadow);
}

.tss-note {
  min-height: 2.7em;
  margin: 8px 2px 6px;
  font-size: 12px;
  color: var(--tss-muted);
}

.tss-opt {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 2px;
  border-top: 1px solid var(--tss-line);
  cursor: pointer;
}

.tss-opt[aria-disabled="true"] {
  opacity: .4;
  cursor: default;
}

.tss-switch {
  all: unset;
  flex: none;
  position: relative;
  width: 34px;
  height: 20px;
  border-radius: 999px;
  background: var(--tss-switch-off);
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
  background: var(--tss-knob-off);
  box-shadow: 0 1px 2px rgba(0, 0, 0, .2);
  transition: transform .15s var(--tss-ease), background .15s ease;
}

.tss-switch[aria-checked="true"] {
  background: var(--tss-switch-on);
}

.tss-switch[aria-checked="true"]::after {
  transform: translateX(14px);
  background: var(--tss-knob-on);
}

.tss-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 2px 6px;
  border-top: 1px solid var(--tss-line);
  font-size: 12px;
  color: var(--tss-muted);
}

.tss-link {
  all: unset;
  flex: none;
  padding: 2px 4px;
  border-radius: 6px;
  color: var(--tss-muted);
  cursor: pointer;
}

@media (hover: hover) {
  .tss-link:hover {
    color: var(--tss-fg);
  }
}

.tss-seg button:focus-visible,
.tss-switch:focus-visible,
.tss-link:focus-visible {
  outline: 2px solid var(--tss-focus);
  outline-offset: 1px;
}

/* ---------- First-run hint ---------- */

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
  color: var(--tss-fg);
  background: var(--tss-surface);
  box-shadow: 0 0 0 1px var(--tss-line), var(--tss-shadow);
  animation: tss-pop .18s var(--tss-ease);
}

@media (prefers-reduced-motion: reduce) {
  html.tss-on [data-tss-head],
  html.tss-models [data-tss-row],
  html.tss-models [data-tss-footer]::before,
  html.tss-on [data-element-id="chat-space-middle-part"] .sticky.top-0,
  html.tss-tools [data-element-id="chat-input-actions"],
  .tss-tab,
  .tss-tab::before,
  .tss-sheet,
  .tss-toast,
  .tss-switch,
  .tss-switch::after {
    transition: none !important;
    animation: none !important;
  }
}

@media print {
  .tss-tab,
  .tss-sheet,
  .tss-toast {
    display: none !important;
  }
}
`;

  /* =================================================================
   * State
   * =================================================================*/

  const parts = {
    pane: null,
    end: null,
    col: null,
    head: null,
    row: null,
    footer: null,
    dock: null,
    content: null,
    inputwrap: null,
  };

  let dead = false;

  let headOk = false;
  let rowOk = false;
  let headH = 54;
  let rowH = 44;

  let hidden = false;
  let idle = false;

  let lastY = 0;
  let lastClientH = 0;
  let acc = 0;
  let holdY = null;

  let rafId = 0;
  let placeRaf = 0;
  let placeTimer = 0;
  let measureRaf = 0;

  let touchInPane = false;
  let barDrag = false;
  let gestureDir = 0;
  let lastTouchEnd = -1e9;
  let lastWheel = -1e9;
  let lastKey = -1e9;
  let lastOutside = -1e9;

  let pointerDownAt = 0;
  let hoverFooter = false;
  let lastToolsTouch = -1e9;
  let collapseTimer = 0;
  let graceTimer = 0;

  let tabEl = null;
  let sheetEl = null;
  let toastEl = null;
  let styleEl = null;
  let varsEl = null;
  let tabSlot = 'center';

  let toastTimer = 0;
  let hintTimer = 0;
  let pollTimer = 0;
  let pollTick = 0;

  let ro = null;
  let roDisabled = false;
  let roHits = 0;
  let roWindow = 0;
  const roTargets = new Set();

  let structMO = null;
  let themeMO = null;
  let lastThemeSig = '';
  let themeTimers = [];

  let syncQueued = false;
  let lastLoc = '';

  const cleanups = [];

  /* =================================================================
   * Helpers
   * =================================================================*/

  const now = () => performance.now();

  function on(target, type, fn, opts) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(type, fn, opts);
    cleanups.push(() => target.removeEventListener(type, fn, opts));
  }

  function onMQ(m, fn) {
    if (!m) return;
    if (typeof m.addEventListener === 'function') {
      m.addEventListener('change', fn);
      cleanups.push(() => m.removeEventListener('change', fn));
    } else if (typeof m.addListener === 'function') {
      m.addListener(fn);
      cleanups.push(() => m.removeListener(fn));
    }
  }

  function setClass(name, value) {
    const v = !!value;
    if (root.classList.contains(name) !== v) root.classList.toggle(name, v);
  }

  function isEditable(el) {
    return !!(
      el &&
      el.nodeType === 1 &&
      (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
    );
  }

  function isShown(el) {
    if (!el || !el.isConnected) return false;
    if (typeof el.checkVisibility === 'function') {
      try {
        return el.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true });
      } catch (e) { /* fall through */ }
    }
    if (!el.getClientRects().length) return false;
    return getComputedStyle(el).visibility !== 'hidden';
  }

  function directChild(ancestor, el) {
    let n = el;
    while (n && n.parentElement !== ancestor) n = n.parentElement;
    return n || null;
  }

  const inUI = (el) => !!(el && el.nodeType === 1 && el.closest('.tss-ui'));

  function safeClosest(el, selector) {
    try {
      return el && el.nodeType === 1 ? el.closest(selector) : null;
    } catch (e) {
      return null;
    }
  }

  function h(tag, attrs, kids) {
    const n = document.createElement(tag);
    if (attrs) {
      for (const key of Object.keys(attrs)) {
        if (key === 'text') n.textContent = attrs[key];
        else if (key === 'class') n.className = attrs[key];
        else n.setAttribute(key, attrs[key]);
      }
    }
    if (kids) kids.forEach((k) => k && n.appendChild(k));
    return n;
  }

  /* CSS variables live in our own <style>, not on <html style>.
   * Writing to <html style> would wake anything watching <html>. */
  const vars = Object.create(null);
  let varsQueued = false;

  function setVar(name, value) {
    if (vars[name] === value) return;
    vars[name] = value;
    if (!varsQueued) {
      varsQueued = true;
      queueMicro(flushVars);
    }
  }

  function flushVars() {
    varsQueued = false;
    if (!varsEl) return;
    let css = ':root{';
    for (const key in vars) css += key + ':' + vars[key] + ';';
    css += '}';
    if (varsEl.textContent !== css) varsEl.textContent = css;
  }

  /* =================================================================
   * Theme
   * Reads the real background behind the chat, so light, dark, system
   * and custom themes all work, whether or not a .dark class is used.
   * =================================================================*/

  let probeCtx;

  function parseColor(input) {
    if (!input) return null;
    const s = String(input).trim();
    if (s === 'transparent') return [0, 0, 0, 0];

    const m = s.match(
      /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+)(%?))?\s*\)$/i
    );
    if (m) {
      let a = m[4] === undefined ? 1 : parseFloat(m[4]);
      if (m[5]) a /= 100;
      return [+m[1], +m[2], +m[3], a];
    }

    // oklch(), lab(), color(srgb ...) and friends: let a 1px canvas convert it
    try {
      if (probeCtx === undefined) {
        const c = document.createElement('canvas');
        c.width = 1;
        c.height = 1;
        probeCtx = c.getContext('2d', { willReadFrequently: true }) || null;
      }
      if (!probeCtx) return null;
      probeCtx.clearRect(0, 0, 1, 1);
      probeCtx.fillStyle = 'rgba(0, 0, 0, 0)';
      probeCtx.fillStyle = s;
      probeCtx.fillRect(0, 0, 1, 1);
      const d = probeCtx.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3] / 255];
    } catch (e) {
      return null;
    }
  }

  function opaqueBgFrom(start) {
    for (let n = start; n && n.nodeType === 1; n = n.parentElement) {
      const c = parseColor(getComputedStyle(n).backgroundColor);
      if (c && c[3] >= 0.9) return c;
    }
    return null;
  }

  function updateTheme() {
    if (dead) return;
    const start = parts.pane || document.querySelector(SEL.pane) || document.body;
    const c = start ? opaqueBgFrom(start) : null;

    let dark;
    let bg;

    if (c) {
      bg = 'rgb(' + Math.round(c[0]) + ', ' + Math.round(c[1]) + ', ' + Math.round(c[2]) + ')';
      dark = (c[0] * 299 + c[1] * 587 + c[2] * 114) / 1000 < 128;
    } else {
      dark = root.classList.contains('dark') ||
        (!root.classList.contains('light') && !!mqDark.matches);
      bg = dark ? 'rgb(24, 24, 27)' : 'rgb(255, 255, 255)';
    }

    setVar('--tss-bg', bg);

    const theme = dark ? 'dark' : 'light';
    if (root.getAttribute('data-tss-theme') !== theme) {
      root.setAttribute('data-tss-theme', theme);
    }
  }

  // Themes often fade their colors. Sample a few times so we never lock
  // onto a half-finished transition color.
  function themeBurst() {
    themeTimers.forEach(clearTimeout);
    updateTheme();
    themeTimers = [60, 180, 400, 800, 1400].map((ms) => setTimeout(updateTheme, ms));
  }

  function themeSig() {
    const b = document.body;
    const rootClasses = Array.prototype.filter
      .call(root.classList, (c) => c.indexOf('tss-') !== 0)
      .join(' ');
    return [
      rootClasses,
      root.getAttribute('style') || '',
      root.getAttribute('data-theme') || '',
      b ? b.getAttribute('class') || '' : '',
      b ? b.getAttribute('style') || '' : '',
    ].join('|');
  }

  function watchTheme() {
    if (!('MutationObserver' in window)) return;
    lastThemeSig = themeSig();
    themeMO = new MutationObserver(() => {
      const sig = themeSig();
      if (sig === lastThemeSig) return; // our own class flips land here and stop
      lastThemeSig = sig;
      themeBurst();
    });
    const opts = {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme', 'data-mode', 'data-color-scheme'],
    };
    themeMO.observe(root, opts);
    if (document.body) themeMO.observe(document.body, opts);
  }

  /* =================================================================
   * Finding TypingMind's parts
   * =================================================================*/

  function setRole(role, el) {
    const attr = 'data-tss-' + role;
    const prev = parts[role];
    if (prev === el) {
      if (el && !el.hasAttribute(attr)) el.setAttribute(attr, '');
      return false;
    }
    if (prev) prev.removeAttribute(attr);
    parts[role] = el || null;
    if (el) el.setAttribute(attr, '');
    return true;
  }

  function queueSync() {
    if (syncQueued || dead) return;
    syncQueued = true;
    queueMicro(() => {
      syncQueued = false;
      sync();
    });
  }

  function watchStructure() {
    if (!structMO) return;
    structMO.disconnect();
    const targets = [parts.col, parts.col && parts.col.parentElement, parts.footer];
    targets.forEach((el) => {
      if (el) structMO.observe(el, { childList: true });
    });
  }

  function roWatch(list) {
    if (!ro || roDisabled) return;
    const want = new Set(list.filter(Boolean));
    roTargets.forEach((el) => {
      if (!want.has(el)) {
        ro.unobserve(el);
        roTargets.delete(el);
      }
    });
    want.forEach((el) => {
      if (!roTargets.has(el)) {
        ro.observe(el);
        roTargets.add(el);
      }
    });
  }

  function sync() {
    if (dead) return;
    try {
      syncParts();
    } catch (e) {
      console.warn(LOG, 'sync failed', e);
    }
  }

  function syncParts() {
    if (styleEl && !styleEl.isConnected) (document.head || root).appendChild(styleEl);
    if (varsEl && !varsEl.isConnected) (document.head || root).appendChild(varsEl);

    const pane = document.querySelector(SEL.pane);
    const col = pane ? pane.parentElement : null;

    // Header wrapper: the column child that holds the header and sits before the chat
    let head = null;
    if (col) {
      const inner = col.querySelector(SEL.headInner);
      const cand = inner && !pane.contains(inner) ? directChild(col, inner) : null;
      if (
        cand &&
        cand !== pane &&
        (cand.compareDocumentPosition(pane) & Node.DOCUMENT_POSITION_FOLLOWING)
      ) {
        head = cand;
      }
    }

    let end = col ? col.querySelector(SEL.end) : null;
    if (end && pane.contains(end)) end = null;

    const footer = end ? end.parentElement : null;

    // Model / plugin / Thinking row: the element right before the input part
    let row = end ? end.previousElementSibling : null;
    if (
      row &&
      (
        row === pane ||
        row === head ||
        row.contains(pane) ||
        row === tabEl ||
        row.querySelector('textarea, [contenteditable="true"]') ||
        !row.querySelector('button, [role="button"], select')
      )
    ) {
      row = null;
    }

    const dock = footer ? footer.parentElement : null;

    let content = null;
    if (pane) {
      content = pane.querySelector(':scope > .dynamic-chat-content-container');
      if (!content) {
        const first = pane.firstElementChild;
        if (first && first.getAttribute('data-element-id') !== 'scroll-padding') content = first;
      }
    }

    const inputEl = end ? end.querySelector(SEL.input) : null;
    const inputwrap =
      inputEl && inputEl.parentElement && inputEl.parentElement.parentElement === end
        ? inputEl.parentElement
        : null;

    // New chat pane = new chat. Reset scroll tracking and bring the header back.
    if (pane !== parts.pane) {
      const hadPane = !!parts.pane;
      parts.pane = pane;
      lastY = pane ? pane.scrollTop : 0;
      lastClientH = pane ? pane.clientHeight : 0;
      acc = 0;
      holdY = null;
      if (hadPane && pane && cfg().mode === 'auto') setHidden(false);
      updateTheme();
    }

    const endChanged = end !== parts.end;
    parts.end = end;

    // Remember TypingMind's own top padding before we override it
    if (content && content !== parts.content) {
      setVar('--tss-content-pad', getComputedStyle(content).paddingTop || '1rem');
    }

    let changed = endChanged;
    changed = setRole('col', col) || changed;
    changed = setRole('head', head) || changed;
    changed = setRole('row', row) || changed;
    changed = setRole('footer', footer) || changed;
    changed = setRole('dock', dock) || changed;
    changed = setRole('content', content) || changed;
    changed = setRole('inputwrap', inputwrap) || changed;

    if (tabEl) {
      if (footer && tabEl.parentElement !== footer) {
        footer.appendChild(tabEl);
        changed = true;
      } else if (!footer && tabEl.parentElement) {
        tabEl.remove();
        changed = true;
      }
    }

    if (changed) {
      roWatch([head, row, end]);
      watchStructure();
      measureHead();
      measureRow();
      applyClasses();
      if (footer && !store.hinted && !hintTimer) hintTimer = setTimeout(maybeHint, 1800);
    } else if (roDisabled) {
      measureHead();
      measureRow();
    }
  }

  /* =================================================================
   * Measuring (with sanity checks so a layout change can't break things)
   * =================================================================*/

  function measureHead() {
    const el = parts.head;
    let ok = false;
    if (el && el.isConnected) {
      const hh = el.offsetHeight;
      ok = hh > 0 && hh < window.innerHeight * 0.45;
      if (ok) {
        headH = hh;
        setVar('--tss-head', hh + 'px');
      }
    }
    if (ok !== headOk) {
      headOk = ok;
      applyClasses();
    }
  }

  function measureRow() {
    const el = parts.row;
    let ok = false;
    if (el && el.isConnected) {
      const rh = el.offsetHeight;
      ok = rh > 0 && rh < window.innerHeight * 0.35;
      if (ok) {
        rowH = rh;
        setVar('--tss-row', rh + 'px');
      }
    }
    if (ok !== rowOk) {
      rowOk = ok;
      applyClasses();
    }
  }

  function remeasureContentPad() {
    const c = parts.content;
    if (!c) return;
    c.removeAttribute('data-tss-content');
    setVar('--tss-content-pad', getComputedStyle(c).paddingTop || '1rem');
    c.setAttribute('data-tss-content', '');
  }

  function scheduleMeasure() {
    if (measureRaf || dead) return;
    measureRaf = requestAnimationFrame(() => {
      measureRaf = 0;
      measureHead();
      measureRow();
      schedulePlaceTab();
    });
  }

  function makeRO() {
    if (!('ResizeObserver' in window)) {
      roDisabled = true;
      return;
    }
    ro = new ResizeObserver(() => {
      const t = now();
      if (t - roWindow > 2000) {
        roWindow = t;
        roHits = 0;
      }
      if (++roHits > 240) {
        ro.disconnect();
        roTargets.clear();
        roDisabled = true;
        console.warn(LOG, 'Resize storm detected. Switched to polling.');
        return;
      }
      // Measure on the next frame, never inside the observer callback
      scheduleMeasure();
    });
  }

  /* =================================================================
   * Classes and header state
   * =================================================================*/

  function applyClasses() {
    if (dead) return;
    const c = cfg();
    const on = c.mode !== 'off' && headOk;

    setClass('tss-phone', isPhone());
    setClass('tss-on', on);
    setClass('tss-models', on && c.models && rowOk);
    setClass('tss-tools', c.tools && !!parts.end);
    setClass('tss-dense', c.dense);
    setClass('tss-ready', !!(parts.footer && tabEl && tabEl.parentElement === parts.footer));

    if (!on && hidden) setHidden(false);

    updateTools();
    updateTabLabel();
    schedulePlaceTab();
  }

  function setHidden(value, manual) {
    const v = !!value && cfg().mode !== 'off' && headOk;

    if (manual) {
      holdY = parts.pane ? parts.pane.scrollTop : 0;
      acc = 0;
    }

    if (v === hidden) return;
    hidden = v;
    setClass('tss-hide', v);
    updateTabLabel();
    schedulePlaceTab();

    if (v && parts.head && parts.head.contains(document.activeElement)) {
      try {
        document.activeElement.blur();
      } catch (e) { /* ignore */ }
    }
  }

  function updateTabLabel() {
    if (!tabEl) return;
    const on = cfg().mode !== 'off' && headOk;
    const label = !on ? 'Space Saver options' : hidden ? 'Show header' : 'Hide header';

    tabEl.setAttribute('aria-label', label);

    if (on) tabEl.setAttribute('aria-expanded', String(!hidden));
    else tabEl.removeAttribute('aria-expanded');

    const title = isPhone()
      ? ''
      : on
        ? label + ' (' + SHORTCUT + '). Right-click for options'
        : 'Space Saver options';

    if (tabEl.title !== title) tabEl.title = title;
  }

  function checkRoute() {
    const loc = location.pathname + location.search + location.hash;
    if (loc === lastLoc) return;
    const first = lastLoc === '';
    lastLoc = loc;
    if (!first && cfg().mode === 'auto') {
      acc = 0;
      holdY = null;
      setHidden(false);
    }
  }

  // Nothing to scroll = nothing to make room for. Bring the header back.
  function checkShortChat() {
    const p = parts.pane;
    if (!hidden || !p || cfg().mode !== 'auto') return;
    if (p.scrollHeight <= p.clientHeight + 4) setHidden(false);
  }

  function popupOpen() {
    let list;
    try {
      list = document.querySelectorAll(POPUP_SEL);
    } catch (e) {
      list = [];
    }
    for (const el of list) {
      if (!inUI(el) && isShown(el)) return true;
    }
    for (const scope of [parts.footer, parts.head]) {
      if (!scope) continue;
      const trigger = scope.querySelector(OPEN_TRIGGER_SEL);
      if (trigger && isShown(trigger)) return true;
    }
    return false;
  }

  /* =================================================================
   * Scroll: header hides on deliberate scroll down only
   * =================================================================*/

  function inputActive() {
    const t = now();
    return touchInPane || barDrag || t - lastWheel < 120 || t - lastKey < 250;
  }

  function userDriven(dy) {
    if (touchInPane || barDrag) return true;
    const t = now();
    const recent = t - lastTouchEnd < 1200 || t - lastWheel < 350 || t - lastKey < 700;
    if (!recent) return false;
    return gestureDir === 0 || Math.sign(dy) === gestureDir;
  }

  function tick() {
    rafId = 0;
    const el = parts.pane;
    if (!el || !el.isConnected) return;

    const y = el.scrollTop;
    const ch = el.clientHeight;
    const dy = y - lastY;
    const resized = ch !== lastClientH;

    lastY = y;
    lastClientH = ch;

    if (dy !== 0 && (touchInPane || barDrag)) gestureDir = Math.sign(dy);

    if (cfg().mode !== 'auto' || !headOk) return;

    // The chat area changed size (tools opened, keyboard, row wrapped).
    // Any scroll jump from that is not you scrolling.
    if (resized) {
      acc = 0;
      return;
    }

    if (holdY !== null) {
      if (Math.abs(y - holdY) < T.holdPx) return;
      holdY = null;
      acc = 0;
    }

    // One-way: scrolling up never re-opens the header
    if (dy <= 0) {
      if (dy < 0) acc = 0;
      return;
    }

    if (!userDriven(dy)) return;

    if (y <= headH + 16) {
      acc = 0;
      return;
    }

    // You just tapped an app control (Thinking, reasoning, model...). Stay put.
    if (now() - lastOutside < T.outsideQuietMs) {
      acc = 0;
      return;
    }

    acc += dy;
    if (acc < T.hideAfter) return;
    acc = 0;

    if (!hidden && !popupOpen()) setHidden(true);
  }

  function onScroll(e) {
    const t = e.target;

    if (t !== parts.pane) {
      if (!(t instanceof Element) || !t.matches(SEL.pane)) return;
      sync();
      if (t !== parts.pane) return;
    }

    if (inputActive()) {
      if (sheetEl) closeSheet(false);
      if (toastEl) closeToast(false);
    }

    if (!rafId) rafId = requestAnimationFrame(tick);

    // Re-check the handle's spot now and then (floating buttons can appear on scroll)
    if (!placeTimer) {
      placeTimer = setTimeout(() => {
        placeTimer = 0;
        schedulePlaceTab();
      }, 220);
    }
  }

  /* =================================================================
   * Input tools: collapse only when truly idle
   * =================================================================*/

  function textboxHasText() {
    const end = parts.end;
    const tb =
      (end && end.querySelector(SEL.textbox)) ||
      document.querySelector(SEL.textbox) ||
      (end && end.querySelector('textarea, [contenteditable="true"]'));
    if (!tb) return false;
    const v = typeof tb.value === 'string' ? tb.value : tb.textContent;
    return !!(v && v.length);
  }

  /* The Send / Stop button lives in the last slot of the actions row, and
   * TypingMind only fills that slot when there is something to send or stop.
   * A filled slot means the row must stay visible, whatever else is true. */
  function actionsBusy() {
    const end = parts.end;
    if (!end) return false;

    const actions = end.querySelector(SEL.actions);
    if (actions) {
      const last = actions.lastElementChild;
      if (last && last.childElementCount > 0) return true;
    }

    // Belt and braces: a visible Stop button anywhere in the input area
    const list = end.querySelectorAll('button, [role="button"]');
    for (const b of list) {
      if (inUI(b)) continue;
      const label =
        (b.getAttribute('aria-label') || '') + ' ' +
        (b.getAttribute('title') || '') + ' ' +
        (b.getAttribute('data-element-id') || '') + ' ' +
        (b.textContent || '').slice(0, 40);
      if (STOP_RE.test(label) && isShown(b)) return true;
    }

    return false;
  }

  function footerFocused() {
    const ae = document.activeElement;
    return !!(
      ae &&
      ae !== document.body &&
      ae !== tabEl &&
      parts.footer &&
      parts.footer.contains(ae)
    );
  }

  function toolsNeeded() {
    // A pointerup can go missing (element removed mid-tap, gesture stolen by
    // the OS). Never let a stuck flag pin the tools open forever.
    if (pointerDownAt && now() - pointerDownAt > T.pointerStuckMs) pointerDownAt = 0;

    // These open the tools
    if (footerFocused()) return true;
    if (textboxHasText()) return true;
    if (actionsBusy()) return true;

    // These only keep already-open tools open (no surprise layout jumps)
    if (!idle) {
      if (pointerDownAt || hoverFooter) return true;
      if (now() - lastToolsTouch < T.toolsGraceMs) return true;
      if (popupOpen()) return true;
    }

    return false;
  }

  function setIdle(value) {
    const v = !!value;
    if (v === idle) return;
    idle = v;
    setClass('tss-idle', v);
    schedulePlaceTab();
  }

  function updateTools() {
    if (dead) return;

    if (!cfg().tools || !parts.end) {
      clearTimeout(collapseTimer);
      collapseTimer = 0;
      setIdle(false);
      return;
    }

    if (toolsNeeded()) {
      clearTimeout(collapseTimer);
      collapseTimer = 0;
      setIdle(false);
      return;
    }

    if (idle || collapseTimer) return;

    collapseTimer = setTimeout(() => {
      collapseTimer = 0;
      if (!dead && cfg().tools && parts.end && !toolsNeeded()) setIdle(true);
    }, T.collapseDelayMs);
  }

  function touchTools() {
    lastToolsTouch = now();
    clearTimeout(graceTimer);
    graceTimer = setTimeout(updateTools, T.toolsGraceMs + 30);
  }

  /* =================================================================
   * Handle placement: above the input stack, never on a button
   * =================================================================*/

  function schedulePlaceTab() {
    if (!placeRaf && !dead) placeRaf = requestAnimationFrame(placeTab);
  }

  function isFloating(el) {
    const pane = parts.pane;
    if (!pane || !pane.contains(el)) return true;
    for (let n = el; n && n !== pane; n = n.parentElement) {
      const p = getComputedStyle(n).position;
      if (p === 'fixed' || p === 'absolute' || p === 'sticky') return true;
    }
    return false;
  }

  // True if a floating app control (like a scroll-to-bottom button) is at x,y
  function controlUnder(x, y) {
    if (typeof document.elementsFromPoint !== 'function') return false;
    let stack;
    try {
      stack = document.elementsFromPoint(x, y);
    } catch (e) {
      return false;
    }
    for (const el of stack) {
      if (el === tabEl || inUI(el)) continue;
      const hit = safeClosest(el, INTERACTIVE);
      if (!hit || (parts.pane && hit.contains(parts.pane))) return false;
      return isFloating(hit);
    }
    return false;
  }

  function placeTab() {
    placeRaf = 0;
    const f = parts.footer;
    if (!tabEl || !f || tabEl.parentElement !== f) return;

    const fr = f.getBoundingClientRect();
    if (!fr.width) return;

    const endRect = parts.end ? parts.end.getBoundingClientRect() : null;
    const ar = endRect && endRect.width ? endRect : fr;
    const half = T.tabW / 2;
    const originX = fr.left + f.clientLeft;

    const clamp = (x) => Math.max(half + 6, Math.min(f.clientWidth - half - 6, x));

    const slots = {
      center: clamp(ar.left + ar.width / 2 - originX),
      right: clamp(ar.right - originX - half - 10),
      left: clamp(ar.left - originX + half + 10),
    };

    const rowUp = root.classList.contains('tss-models') && !hidden;
    const localTop = -((rowUp ? rowH : 0) + T.tabH + T.tabGap);
    const vy = fr.top + f.clientTop + localTop + T.tabH / 2;

    const clear = (slot) => {
      const vx = slots[slot] + originX;
      return (
        !controlUnder(vx, vy) &&
        !controlUnder(vx - half + 4, vy) &&
        !controlUnder(vx + half - 4, vy)
      );
    };

    let pick = tabSlot;
    if (vy > 0 && vy < window.innerHeight) {
      if (clear('center')) pick = 'center';
      else if (tabSlot !== 'center' && clear(tabSlot)) pick = tabSlot;
      else if (clear('right')) pick = 'right';
      else if (clear('left')) pick = 'left';
    }

    tabSlot = pick;
    const px = Math.round(slots[pick]) + 'px';
    if (tabEl.style.left !== px) tabEl.style.left = px;
  }

  /* =================================================================
   * Handle
   * =================================================================*/

  function onTabTap() {
    closeToast(true);

    if (sheetEl) {
      closeSheet(false);
      return;
    }

    if (cfg().mode === 'off' || !headOk) {
      openSheet();
      return;
    }

    setHidden(!hidden, true);
  }

  function makeTab() {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tss-ui tss-tab';

    let timer = 0;
    let sx = 0;
    let sy = 0;
    let down = false;
    let cancelled = false;
    let pid = null;
    let lastType = 'mouse';
    let lastHandled = -1e9;

    const release = () => {
      clearTimeout(timer);
      timer = 0;
      down = false;
      b.classList.remove('tss-press');
      if (pid !== null) {
        try {
          b.releasePointerCapture(pid);
        } catch (e) { /* ignore */ }
        pid = null;
      }
    };

    b.addEventListener('pointerdown', (e) => {
      lastType = e.pointerType || 'mouse';

      // Keep focus in the message box so nothing shifts under your finger
      e.preventDefault();

      if (e.button !== 0) return;

      down = true;
      cancelled = false;
      sx = e.clientX;
      sy = e.clientY;
      pid = e.pointerId;

      try {
        b.setPointerCapture(e.pointerId);
      } catch (err) { /* ignore */ }

      b.classList.add('tss-press');

      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = 0;
        cancelled = true;
        lastHandled = now();
        b.classList.remove('tss-press');
        try {
          if (navigator.vibrate) navigator.vibrate(8);
        } catch (err) { /* ignore */ }
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

    // Pointer events handle taps. Click stays for keyboard and screen readers.
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

  /* =================================================================
   * Options sheet
   * =================================================================*/

  const OPTIONS = [
    { key: 'models', label: 'Hide model row with header' },
    { key: 'tools', label: 'Collapse input tools when idle' },
    { key: 'dense', label: 'Tighter spacing' },
  ];

  const MODE_LABELS = { auto: 'Auto-hide', manual: 'Manual', off: 'Off' };

  function modeNote(mode) {
    if (mode === 'auto') {
      return 'Hides when you scroll down. Comes back when you tap the handle or open another chat.';
    }
    if (mode === 'manual') {
      return isPhone()
        ? 'Stays where you leave it. Tap the handle to show or hide it.'
        : 'Stays where you leave it. Tap the handle or press ' + SHORTCUT + '.';
    }
    return 'Normal TypingMind header. Tap the handle to open these options.';
  }

  function renderSheet() {
    if (!sheetEl) return;
    const c = cfg();

    sheetEl.querySelector('.tss-sub').textContent = isPhone() ? 'Phone layout' : 'Desktop layout';

    sheetEl.querySelectorAll('.tss-seg button').forEach((btn) => {
      const active = btn.getAttribute('data-mode') === c.mode;
      btn.setAttribute('aria-checked', String(active));
      btn.tabIndex = active ? 0 : -1;
    });

    sheetEl.querySelector('.tss-note').textContent = modeNote(c.mode);

    sheetEl.querySelectorAll('.tss-opt').forEach((opt) => {
      const key = opt.getAttribute('data-key');
      const sw = opt.querySelector('.tss-switch');
      const disabled = key === 'models' && c.mode === 'off';
      sw.setAttribute('aria-checked', String(!!c[key]));
      sw.disabled = disabled;
      opt.setAttribute('aria-disabled', String(disabled));
    });

    sheetEl.querySelector('.tss-hint').textContent = isPhone()
      ? 'Hold the handle to open this'
      : SHORTCUT + ' toggles the header';
  }

  function positionSheet() {
    if (!sheetEl) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = sheetEl.offsetWidth;
    const hgt = sheetEl.offsetHeight;
    const r = tabEl && tabEl.isConnected ? tabEl.getBoundingClientRect() : null;
    const anchored = !!(r && r.width);

    const cx = anchored ? r.left + r.width / 2 : vw / 2;
    const left = Math.max(8, Math.min(vw - w - 8, Math.round(cx - w / 2)));

    let top = anchored ? Math.round(r.top - hgt - 10) : Math.round((vh - hgt) / 2);
    if (top < 8) top = anchored ? Math.min(vh - hgt - 8, Math.round(r.bottom + 10)) : 8;

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

    // Let TypingMind re-fit the text box after spacing changes
    if (key === 'dense') {
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    }
  }

  function resetProfile() {
    store[isPhone() ? 'phone' : 'desktop'] = cleanProfile(null);
    saveStore();
    holdY = null;
    acc = 0;
    applyClasses();
    renderSheet();
    requestAnimationFrame(() => {
      positionSheet();
      window.dispatchEvent(new Event('resize'));
    });
  }

  function openSheet() {
    closeToast(true);

    if (sheetEl) {
      closeSheet(false);
      return;
    }

    const seg = h(
      'div',
      { class: 'tss-seg', role: 'radiogroup', 'aria-label': 'Header behavior' },
      MODES.map((m) => h('button', { type: 'button', role: 'radio', 'data-mode': m, text: MODE_LABELS[m] }))
    );

    const opts = OPTIONS.map((o) =>
      h('div', { class: 'tss-opt', 'data-key': o.key }, [
        h('span', { text: o.label }),
        h('button', { type: 'button', class: 'tss-switch', role: 'switch', 'aria-label': o.label }),
      ])
    );

    const sheet = h(
      'div',
      { class: 'tss-ui tss-sheet', role: 'dialog', 'aria-label': 'Space Saver options' },
      [
        h('div', { class: 'tss-title', text: 'Space Saver' }),
        h('div', { class: 'tss-sub' }),
        seg,
        h('div', { class: 'tss-note' }),
      ]
        .concat(opts)
        .concat([
          h('div', { class: 'tss-foot' }, [
            h('span', { class: 'tss-hint' }),
            h('button', { type: 'button', class: 'tss-link', 'data-action': 'reset', text: 'Reset' }),
          ]),
        ])
    );

    // Pressing options must not pull focus out of the message box
    sheet.addEventListener('pointerdown', (e) => e.preventDefault());

    sheet.addEventListener('click', (e) => {
      const t = e.target;

      const segBtn = safeClosest(t, '.tss-seg button');
      if (segBtn) {
        setMode(segBtn.getAttribute('data-mode'));
        return;
      }

      if (safeClosest(t, '[data-action="reset"]')) {
        resetProfile();
        return;
      }

      const opt = safeClosest(t, '.tss-opt');
      if (opt) toggleOption(opt.getAttribute('data-key'));
    });

    sheet.addEventListener('keydown', (e) => {
      const segBtn = safeClosest(e.target, '.tss-seg button');
      if (!segBtn || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      e.preventDefault();
      const i = MODES.indexOf(segBtn.getAttribute('data-mode'));
      const next = MODES[(i + (e.key === 'ArrowRight' ? 1 : MODES.length - 1)) % MODES.length];
      setMode(next);
      const btn = sheet.querySelector('.tss-seg button[data-mode="' + next + '"]');
      if (btn) btn.focus();
    });

    document.body.appendChild(sheet);
    sheetEl = sheet;
    renderSheet();
    positionSheet();

    if (tabEl && document.activeElement === tabEl) {
      const current = sheet.querySelector('.tss-seg button[aria-checked="true"]');
      if (current) current.focus();
    }
  }

  function closeSheet(restoreFocus) {
    if (!sheetEl) return;
    const hadFocus = sheetEl.contains(document.activeElement);
    sheetEl.remove();
    sheetEl = null;
    if ((restoreFocus || hadFocus) && tabEl && tabEl.isConnected) {
      try {
        tabEl.focus({ preventScroll: true });
      } catch (e) { /* ignore */ }
    }
  }

  /* =================================================================
   * First-run hint
   * =================================================================*/

  function maybeHint() {
    hintTimer = 0;
    if (dead || store.hinted || toastEl || !tabEl || !tabEl.isConnected) return;

    const r = tabEl.getBoundingClientRect();
    if (!r.width || r.top < 80 || r.bottom > window.innerHeight) {
      hintTimer = setTimeout(maybeHint, 3000);
      return;
    }

    store.hinted = true;
    saveStore();

    const t = h('div', {
      class: 'tss-ui tss-toast',
      role: 'status',
      text: isPhone()
        ? 'Tap the handle to show or hide the header. Hold it for options.'
        : 'Tap the handle or press ' + SHORTCUT + ' to show or hide the header. Right-click it for options.',
    });

    t.addEventListener('click', () => closeToast(true));
    document.body.appendChild(t);

    const w = t.offsetWidth;
    const hgt = t.offsetHeight;
    const cx = r.left + r.width / 2;

    t.style.left = Math.max(12, Math.min(window.innerWidth - w - 12, Math.round(cx - w / 2))) + 'px';
    t.style.top = Math.max(12, Math.round(r.top - hgt - 10)) + 'px';

    toastEl = t;
    toastTimer = setTimeout(() => closeToast(true), 5200);
  }

  function closeToast(markSeen) {
    if (markSeen && !store.hinted) {
      store.hinted = true;
      saveStore();
    }
    clearTimeout(toastTimer);
    toastTimer = 0;
    if (toastEl) {
      toastEl.remove();
      toastEl = null;
    }
  }

  /* =================================================================
   * Global listeners
   * =================================================================*/

  function keyScrollsPane(t) {
    if (!t || t === document.body || t === root) return true;
    if (!(t instanceof Element) || !parts.pane || !parts.pane.contains(t)) return false;
    if (isEditable(t)) return false;
    const ctl = safeClosest(t, INTERACTIVE);
    return !ctl || ctl === parts.pane || ctl.contains(parts.pane);
  }

  function installListeners() {
    on(document, 'scroll', onScroll, { capture: true, passive: true });

    on(document, 'touchstart', (e) => {
      const t = e.target;
      touchInPane = !!(parts.pane && t instanceof Node && parts.pane.contains(t));
      if (touchInPane) gestureDir = 0;
    }, { capture: true, passive: true });

    const endTouch = () => {
      if (touchInPane) lastTouchEnd = now();
      touchInPane = false;
    };
    on(document, 'touchend', endTouch, { capture: true, passive: true });
    on(document, 'touchcancel', endTouch, { capture: true, passive: true });

    on(document, 'wheel', (e) => {
      if (!parts.pane || !(e.target instanceof Node) || !parts.pane.contains(e.target)) return;
      if (e.deltaY === 0) return;
      lastWheel = now();
      gestureDir = Math.sign(e.deltaY);
    }, { capture: true, passive: true });

    on(document, 'pointerdown', (e) => {
      const t = e.target instanceof Node ? e.target : null;
      const onTab = !!(t && tabEl && tabEl.contains(t));

      if (parts.pane && t === parts.pane && e.pointerType === 'mouse') barDrag = true;

      if (t && !onTab && !inUI(t)) {
        const inFooter = !!(parts.footer && parts.footer.contains(t));
        if (inFooter) {
          pointerDownAt = now();
          touchTools();
        } else if (!idle && safeClosest(t, POPUP_SEL)) {
          touchTools(); // picking an option in a menu that came from the tools
        }
        if (!(parts.pane && parts.pane.contains(t))) lastOutside = now();
      }

      if (sheetEl && !(t && sheetEl.contains(t)) && !onTab) closeSheet(false);
      if (toastEl && !onTab) closeToast(true);
    }, true);

    const pointerEnd = () => {
      if (barDrag) {
        barDrag = false;
        lastWheel = now();
      }
      if (pointerDownAt) {
        pointerDownAt = 0;
        touchTools();
        updateTools();
      }
    };
    on(window, 'pointerup', pointerEnd, true);
    on(window, 'pointercancel', pointerEnd, true);

    on(document, 'pointerover', (e) => {
      if (e.pointerType !== 'mouse') return;
      const inside = !!(parts.footer && e.target instanceof Node && parts.footer.contains(e.target));
      if (inside !== hoverFooter) {
        hoverFooter = inside;
        if (!inside) updateTools();
      }
    }, { capture: true, passive: true });

    on(document, 'pointerout', (e) => {
      if (e.pointerType === 'mouse' && !e.relatedTarget && hoverFooter) {
        hoverFooter = false;
        updateTools();
      }
    }, { capture: true, passive: true });

    on(document, 'focusin', () => updateTools(), true);
    on(document, 'focusout', () => setTimeout(updateTools, 0), true);

    on(document, 'input', (e) => {
      if (parts.footer && e.target instanceof Node && parts.footer.contains(e.target)) updateTools();
    }, true);

    // Theme switches happen from a click somewhere. Re-read colors right after.
    on(document, 'click', () => {
      setTimeout(updateTools, 0);
      themeTimers.forEach(clearTimeout);
      themeTimers = [50, 250, 700].map((ms) => setTimeout(updateTheme, ms));
    }, true);

    on(document, 'transitionend', (e) => {
      if (e.propertyName !== 'background-color') return;
      const t = e.target;
      if (t instanceof Element && parts.pane && t.contains(parts.pane)) updateTheme();
    }, { capture: true, passive: true });

    on(document, 'keydown', (e) => {
      if (e.isComposing) return;

      if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyH') {
        if (!parts.pane || cfg().mode === 'off' || !headOk) return;
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

      if (SCROLL_KEYS.has(e.key) && keyScrollsPane(e.target)) {
        lastKey = now();
        const up =
          e.key === 'PageUp' ||
          e.key === 'ArrowUp' ||
          e.key === 'Home' ||
          (e.key === ' ' && e.shiftKey);
        gestureDir = up ? -1 : 1;
      }
    }, true);

    const onResize = () => {
      schedulePlaceTab();
      scheduleMeasure();
      if (sheetEl) requestAnimationFrame(positionSheet);
    };
    on(window, 'resize', onResize, { passive: true });
    if (window.visualViewport) on(window.visualViewport, 'resize', onResize, { passive: true });

    on(document, 'visibilitychange', () => {
      if (document.hidden) return;
      sync();
      themeBurst();
      updateTools();
    });

    on(window, 'popstate', checkRoute);
    on(window, 'hashchange', checkRoute);

    onMQ(mqPhone, () => {
      closeSheet(false);
      holdY = null;
      acc = 0;
      remeasureContentPad();
      applyClasses();
      scheduleMeasure();
    });

    onMQ(mqDark, themeBurst);
  }

  /* =================================================================
   * Lifecycle
   * =================================================================*/

  function teardown() {
    if (dead) return;
    dead = true;

    cleanups.splice(0).forEach((fn) => {
      try {
        fn();
      } catch (e) { /* ignore */ }
    });

    clearInterval(pollTimer);
    [hintTimer, toastTimer, collapseTimer, graceTimer, placeTimer].forEach(clearTimeout);
    themeTimers.forEach(clearTimeout);

    if (ro) ro.disconnect();
    if (structMO) structMO.disconnect();
    if (themeMO) themeMO.disconnect();
    if (rafId) cancelAnimationFrame(rafId);
    if (placeRaf) cancelAnimationFrame(placeRaf);
    if (measureRaf) cancelAnimationFrame(measureRaf);

    closeSheet(false);
    closeToast(false);
    if (tabEl) tabEl.remove();

    ROLES.forEach((role) => {
      if (parts[role]) parts[role].removeAttribute('data-tss-' + role);
      parts[role] = null;
    });

    [styleEl, varsEl].forEach((n) => n && n.remove());

    STATE_CLASSES.forEach((c) => root.classList.remove(c));
    root.removeAttribute('data-tss-theme');

    if (window.tmSpace && window.tmSpace.version === VERSION) delete window.tmSpace;
    window.__tssTeardown = null;

    console.log(LOG, 'Off until the app reloads.');
  }

  function init() {
    if (dead) return;

    // Clean out anything an older version left behind
    const oldStyle = document.getElementById('tss-style');
    if (oldStyle) oldStyle.remove();
    ['--tss-head', '--tss-row', '--tss-bg', '--tss-tab-top', '--tss-tab-x'].forEach((v) =>
      root.style.removeProperty(v)
    );

    styleEl = document.createElement('style');
    styleEl.id = 'tss-style';
    styleEl.textContent = CSS_TEXT;

    varsEl = document.createElement('style');
    varsEl.id = 'tss-vars';

    const host = document.head || root;
    host.appendChild(styleEl);
    host.appendChild(varsEl);

    tabEl = makeTab();
    makeRO();
    if ('MutationObserver' in window) structMO = new MutationObserver(queueSync);

    updateTheme();
    watchTheme();
    installListeners();

    lastLoc = location.pathname + location.search + location.hash;

    sync();
    applyClasses();

    pollTimer = setInterval(() => {
      if (document.hidden || dead) return;
      pollTick++;
      sync();
      // A feature that measured badly earlier gets another chance every tick
      if (roDisabled || !headOk || (cfg().models && !rowOk)) scheduleMeasure();
      checkRoute();
      checkShortChat();
      updateTools();
      updateTheme();
      if (pollTick % 3 === 0) schedulePlaceTab();
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
        acc = 0;
        applyClasses();
        renderSheet();
      },
      debug: () => {
        const found = {};
        Object.keys(parts).forEach((k) => {
          found[k] = !!parts[k];
        });
        const info = {
          version: VERSION,
          layout: isPhone() ? 'phone' : 'desktop',
          settings: Object.assign({}, cfg()),
          headerFound: headOk,
          modelRowFound: rowOk,
          headerHidden: hidden,
          toolsCollapsed: idle,
          theme: root.getAttribute('data-tss-theme'),
          background: vars['--tss-bg'],
          handleSlot: tabSlot,
          resizeObserver: roDisabled ? 'polling' : 'on',
          parts: found,
        };
        console.log(LOG, info);
        return info;
      },
      off: teardown,
    };

    console.log(LOG, 'v' + VERSION + ' ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
