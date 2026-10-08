/* =====================================================================
 * TypingMind - Space Saver  v4.5.1
 * ---------------------------------------------------------------------
 * One control that minimizes the chat furniture, and leaves it that way.
 *
 *   Tap the chevron above the message box and the header, the model /
 *   Thinking / reasoning row and the message box itself all collapse.
 *   The chat gets the whole screen, top to bottom, with only the chevron
 *   left, floating just above the bottom edge. Tap it again and
 *   everything comes back. Nothing moves on its own while you read.
 *
 *   Getting back to typing:
 *     - tap the chevron, or press Alt+Shift+H (Option+Shift+H on Mac)
 *     - on a computer, just start typing: the box comes back and the
 *       first letter lands in it
 *     - tap Edit on one of your messages and the box comes back for it
 *     - a new, empty chat always opens with the box showing
 *
 *   Every chat remembers how you left it. Minimize chat A, open chat B,
 *   come back to A and it is still minimized, even after a reload.
 *   A chat you have never toggled keeps whatever you are looking at
 *   when you open it, so switching never makes the layout jump.
 *
 *   Prefer the old behavior, where the box stays and only its tools
 *   fold away? Turn off "Also minimize the message box" in the options.
 *
 *   Auto-hide is still available in the options for anyone who wants
 *   things to duck away as they scroll, but it is off by default.
 *
 *   Extras, all optional:
 *     - a soft fade where the chat meets the message box
 *     - tighter spacing around the header and input
 *
 *   Hold the chevron (or right-click it) for options.
 *
 * Design rules this version follows:
 *   - Nothing paints a background over the chat. The chevron's chip and
 *     the bottom fade are both built from TypingMind's own text color
 *     and from transparency, so every theme (light, dark, system,
 *     custom) is correct the instant it changes, with no color
 *     detection and no delay anywhere in the chat area.
 *   - Collapsing happens by removing things from the layout, never by
 *     floating them over the chat, so nothing can overlap or misalign.
 *     The one exception is the chevron when everything is minimized: it
 *     floats over the faded end of the chat, so the chat can use the
 *     whole screen.
 *   - Nothing animates its position. The chevron is pinned with CSS, the
 *     footer's own animation is switched off, and every change lands in
 *     a single frame. While you scroll, nothing moves but the chat.
 *   - The extension never scrolls the chat by itself. The only scroll
 *     change it makes is the one that keeps your words in place at the
 *     moment you tap, and it also takes over a delayed spacer resize of
 *     TypingMind's that used to shift the chat half a second later.
 *   - The layout only changes when you tap, type, press Edit or open a
 *     different chat. Never while you read.
 *
 * Install: TypingMind -> Settings -> Advanced Settings -> Extensions ->
 *          paste the URL of this file -> Install -> restart the app.
 *
 * Console: tmSpace.toggle() .show() .hide() .options() .reset() .debug()
 *          tmSpace.forgetChats() clears the per-chat memory only
 * Kill switch (until reload): tmSpace.off()
 *
 * Fail-safe: if TypingMind changes its layout and a part cannot be
 * found or measures wrong, that feature turns itself off and the app
 * falls back to its normal layout instead of breaking.
 * ===================================================================*/
(() => {
  'use strict';

  const VERSION = '4.5.1';
  const STORE_KEY = 'tm-space-saver:v2';
  const LEGACY_KEYS = ['tm-space-saver:v1'];
  const CHATS_KEY = 'tm-space-saver:chats';
  const CHAT_CAP = 500;   // chats remembered before the oldest are dropped
  const SCHEMA = 4;
  const LOG = '[Space Saver]';

  // TypingMind keeps the open chat's id in the URL (#chat=<id>). The
  // pattern also accepts ?chat=, chatId= and /chat/<id>, so a change in
  // URL style keeps working. If no id is found at all, the extension
  // simply falls back to one shared state for every chat.
  const CHAT_RE = /(?:^|[#?&\/;])chat(?:[_-]?id)?[=\/:]([A-Za-z0-9_.~-]{4,128})/i;

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
    // A chat containing any of these has something to read
    message: [
      '[data-element-id="user-message"]',
      '[data-element-id="ai-response"]',
      '[data-element-id="response-block"]',
    ].join(','),
    editButton: '[data-element-id="edit-message-button"]',
    editLabel: '[data-element-id="edit-message-label"]',
  };

  const T = {
    hideAfter: 40,        // auto-hide mode: px of scroll before things duck away
    holdPx: 120,          // auto-hide mode: scroll to ignore after a manual tap
    pollMs: 800,
    longPressMs: 450,
    outsideQuietMs: 600,  // auto-hide mode: quiet window after tapping a control
    tabW: 22,             // same as the height, so the chip is a circle
    tabH: 22,
    tabGap: 8,            // clear space between the chip and the message box
    floatGap: 8,          // fully minimized: chip's distance from the bottom edge
    floatFade: 44,        // fully minimized: height of the fade under the chip
    floatClear: 44,       // fully minimized: extra room after the last message
    entryMs: 3000,        // after opening a chat, how long to watch for it being new
    emptyMs: 300,         // how long a chat must stay empty to count as new
    entryStepMs: 100,
  };

  // The chip's whole height plus the gap, so it never touches the box
  T.tabRise = T.tabH + T.tabGap;

  const MODES = ['manual', 'auto', 'off'];
  const DEFAULTS = { mode: 'manual', models: true, box: true, tools: true, fade: true, dense: true };
  const ROLES = ['pane', 'col', 'head', 'row', 'footer', 'dock', 'content', 'inputwrap', 'end'];
  const STATE_CLASSES = [
    'tss-on', 'tss-hide', 'tss-head', 'tss-models', 'tss-box', 'tss-tools',
    'tss-fold', 'tss-fade', 'tss-dense', 'tss-phone', 'tss-ready',
  ];

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

  const INTERACTIVE = [
    'button', 'a[href]', 'input', 'select', 'textarea', 'summary',
    '[role="button"]', '[role="link"]', '[role="menuitem"]', '[role="tab"]',
    '[role="switch"]', '[role="checkbox"]', '[contenteditable="true"]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

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
  const mqFine = mq('(pointer: fine)');

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

  function cleanProfile(p, resetMode) {
    const src = p && typeof p === 'object' ? p : {};
    const bool = (v, d) => (typeof v === 'boolean' ? v : d);
    return {
      mode: !resetMode && MODES.includes(src.mode) ? src.mode : DEFAULTS.mode,
      models: bool(src.models, DEFAULTS.models),
      box: bool(src.box, DEFAULTS.box),
      tools: bool(src.tools, DEFAULTS.tools),
      fade: bool(src.fade, DEFAULTS.fade),
      dense: bool(src.dense, DEFAULTS.dense),
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

    // Older versions defaulted to auto-hide. Move those installs to the
    // manual default once, keeping every other choice intact.
    const stale = s.v !== SCHEMA;

    return {
      v: SCHEMA,
      phone: cleanProfile(s.phone, stale),
      desktop: cleanProfile(s.desktop, stale),
      hinted: !!s.hinted,
    };
  }

  let store = loadStore();

  function saveStore() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (e) { /* storage blocked */ }
  }

  saveStore();

  const isPhone = () => !!mqPhone.matches;
  const cfg = () => store[isPhone() ? 'phone' : 'desktop'];

  /* ---------- Per-chat memory ----------
     { v, last, map: { "c:<chatId>": [minimized 0|1, lastTouched ms] } }
     Keys are prefixed so an id can never collide with an object builtin. */

  function emptyChats() {
    return { v: 1, last: false, map: Object.create(null) };
  }

  function loadChats() {
    const s = readJSON(CHATS_KEY);
    const out = emptyChats();
    if (!s || typeof s !== 'object') return out;
    out.last = !!s.last;
    if (s.map && typeof s.map === 'object') {
      for (const k of Object.keys(s.map)) {
        const r = s.map[k];
        if (k.startsWith('c:') && Array.isArray(r) && (r[0] === 0 || r[0] === 1)) {
          out.map[k] = [r[0], +r[1] || 0];
        }
      }
    }
    return out;
  }

  let chats = loadChats();

  function saveChats() {
    try {
      localStorage.setItem(CHATS_KEY, JSON.stringify(chats));
    } catch (e) { /* storage blocked or full */ }
  }

  function currentChatKey() {
    const m = (location.hash + '&' + location.search + '&' + location.pathname).match(CHAT_RE);
    return m ? m[1] : null;
  }

  // true / false when this chat has a saved state, null when it has none
  function recall(key) {
    const r = key ? chats.map['c:' + key] : null;
    return r ? r[0] === 1 : null;
  }

  function remember(key, value) {
    chats.last = !!value;
    if (key) {
      chats.map['c:' + key] = [value ? 1 : 0, Date.now()];
      const keys = Object.keys(chats.map);
      if (keys.length > CHAT_CAP) {
        keys.sort((a, b) => chats.map[a][1] - chats.map[b][1]);
        keys.slice(0, keys.length - CHAT_CAP + 50).forEach((k) => delete chats.map[k]);
      }
    }
    saveChats();
  }

  /* =================================================================
   * Styles
   *
   * Every rule either removes something from the layout, nudges
   * spacing, or draws with currentColor. Nothing in the chat area
   * names a color, so nothing can be out of step with your theme.
   * =================================================================*/

  const CSS_TEXT = String.raw`
/* ---------- Minimized: the header leaves the layout ----------
   JS corrects the scroll position in the same frame, so the chat you
   are reading does not move; the header's space fills with content. */

html.tss-head.tss-hide [data-tss-head] {
  display: none !important;
}

/* ---------- Minimized: the model / Thinking / reasoning row too ---------- */

html.tss-models.tss-hide [data-tss-row] {
  display: none !important;
}

/* ---------- Minimized: the message box and everything around it ----------
   Attachments, conversation starters, the box and its tools all leave
   the layout, and the footer that held them shrinks to nothing, so the
   chat runs to the bottom of the screen. The model row follows its own
   option above. On a phone with a home bar the footer keeps exactly the
   system's safe area and nothing more. */

html.tss-box.tss-hide [data-tss-footer] {
  padding-top: 0 !important;
  padding-bottom: env(safe-area-inset-bottom, 0px) !important;
}

html.tss-box.tss-hide [data-tss-footer] > :not(.tss-tab):not([data-tss-row]) {
  display: none !important;
}

/* The end of the chat clears the floating chevron, so the last line of
   a reply never ends up under it. */
html.tss-box.tss-hide [data-tss-pane] > [data-element-id="scroll-padding"] {
  margin-top: ${T.floatClear}px !important;
}

/* ---------- Minimized with the box kept: its tools fold away ---------- */

html.tss-tools.tss-fold [data-tss-end] [data-element-id="chat-input-actions"] {
  display: none !important;
}

/* ---------- Soft fade where the chat meets the message box ----------
   This fades the chat's own pixels with a mask. It paints nothing, so
   it cannot be the wrong color and it cannot show a band at the sides. */

html.tss-fade [data-tss-pane],
html.tss-box.tss-hide [data-tss-pane] {
  --tss-fade: 30px;
  -webkit-mask-image:
    linear-gradient(to bottom, #000 calc(100% - var(--tss-fade)), transparent 100%);
  mask-image:
    linear-gradient(to bottom, #000 calc(100% - var(--tss-fade)), transparent 100%);
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
}

html.tss-fade.tss-phone [data-tss-pane] {
  --tss-fade: 22px;
}

/* Fully minimized, the chevron floats over the end of the chat, so the
   fade is always there and shaped to sit under it. */
html.tss-box.tss-hide [data-tss-pane] {
  -webkit-mask-image: linear-gradient(to bottom,
    #000 calc(100% - ${T.floatFade}px),
    rgba(0, 0, 0, .35) calc(100% - 26px),
    transparent calc(100% - 6px));
  mask-image: linear-gradient(to bottom,
    #000 calc(100% - ${T.floatFade}px),
    rgba(0, 0, 0, .35) calc(100% - 26px),
    transparent calc(100% - 6px));
}

/* ---------- Tighter spacing ----------
   Vertical only. Left and right padding is left exactly as TypingMind
   sets it, on every screen size, so the text keeps its own margins. */

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

html.tss-dense.tss-phone [data-element-id="chat-space-beginning-part"] {
  min-height: 46px !important;
  padding-top: 4px !important;
  padding-bottom: 4px !important;
}

/* ---------- The chevron ----------
   A small chip centred just above the message box. Its tint and its
   ring are made from the app's own text color, so it reads correctly
   on any theme without a single line of color code.

   It never animates its position or size. TypingMind animates the
   footer it lives in, so that animation is switched off too: every
   change lands in one frame and nothing slides afterwards. */

html.tss-ready [data-tss-footer] {
  position: relative;
  transition: none !important;
}

.tss-tab {
  all: unset;
  box-sizing: border-box;
  position: absolute;
  z-index: 6;
  top: var(--tss-top, -${T.tabRise}px);
  left: var(--tss-left, 50%);
  width: ${T.tabW}px;
  height: ${T.tabH}px;
  display: flex;
  align-items: center;
  justify-content: center;
  transform: translateX(-50%);
  /* An arrow drawn from two borders sits off-centre once rotated. These
     nudges put its visual middle on the circle's middle. */
  --tss-up-y: 2.5px;
  --tss-down-y: -3.25px;
  border-radius: 999px;
  background: rgba(128, 128, 128, .10);
  box-shadow: inset 0 0 0 1px rgba(128, 128, 128, .15);
  cursor: pointer;
  touch-action: none;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  transition: background .15s ease, box-shadow .15s ease;
}

/* Fully minimized: the chevron floats just above the bottom of the
   screen (or just above the model row, if that stays), over the faded
   end of the chat. CSS alone anchors it to the footer, so nothing
   recalculates it and it can't drift while you scroll. */
html.tss-box.tss-hide .tss-tab {
  top: auto;
  bottom: calc(100% + ${T.floatGap}px);
  left: 50%;
}

@supports (color: color-mix(in srgb, red, blue)) {
  .tss-tab {
    background: color-mix(in srgb, currentColor 7%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 11%, transparent);
  }
}

/* Comfortable touch target without a bigger mark on screen. The same
   46 by 40 area as before the chip became a circle. */
.tss-tab::after {
  content: "";
  position: absolute;
  inset: -9px -12px;
}

/* At the bottom edge the target stops short of the edge, so it can never
   push the page past the bottom of the screen and make it scrollable. */
html.tss-box.tss-hide .tss-tab::after {
  inset: -9px -12px -${T.floatGap - 2}px;
}

.tss-tab::before {
  content: "";
  display: block;
  box-sizing: border-box;
  width: 9px;
  height: 9px;
  border-right: 1.75px solid currentColor;
  border-bottom: 1.75px solid currentColor;
  opacity: .5;
  transform: translateY(var(--tss-up-y)) rotate(-135deg);
  transition: opacity .15s ease;
}

/* Box kept: the chevron points down while minimized, "bring it all back" */
html.tss-hide .tss-tab::before {
  transform: translateY(var(--tss-down-y)) rotate(45deg);
}

/* Box minimized too: the chip works like the handle of a bottom drawer.
   Down tucks everything away, up brings it back. */
html.tss-box .tss-tab::before {
  transform: translateY(var(--tss-down-y)) rotate(45deg);
}

html.tss-box.tss-hide .tss-tab::before {
  transform: translateY(var(--tss-up-y)) rotate(-135deg);
}

@media (hover: hover) {
  .tss-tab:hover {
    background: rgba(128, 128, 128, .17);
  }
  .tss-tab:hover::before {
    opacity: .8;
  }
}

@supports (color: color-mix(in srgb, red, blue)) {
  @media (hover: hover) {
    .tss-tab:hover {
      background: color-mix(in srgb, currentColor 13%, transparent);
    }
  }
}

/* Pressed: a little brighter, never smaller or moved */
.tss-tab.tss-press {
  background: rgba(128, 128, 128, .2);
}

@supports (color: color-mix(in srgb, red, blue)) {
  .tss-tab.tss-press {
    background: color-mix(in srgb, currentColor 16%, transparent);
  }
}

.tss-tab.tss-press::before {
  opacity: .9;
}

.tss-tab:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}

.tss-tab:focus-visible::before {
  opacity: .9;
}

/* ---------- Options panel ----------
   Colors are set on the element when it opens, from whatever the app is
   actually showing at that moment. Nothing here is theme-guessed. */

.tss-sheet {
  position: fixed;
  z-index: 2147483000;
  box-sizing: border-box;
  width: min(300px, calc(100vw - 16px));
  padding: 14px 14px 6px;
  border-radius: 14px;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.35;
  color: var(--tss-fg);
  background: var(--tss-surface);
  box-shadow: 0 0 0 1px var(--tss-line), var(--tss-shadow);
  -webkit-tap-highlight-color: transparent;
  animation: tss-pop .16s cubic-bezier(.2, .8, .2, 1);
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
  opacity: .65;
}

.tss-seg button[aria-checked="true"] {
  opacity: 1;
  font-weight: 600;
  background: var(--tss-seg-on);
  box-shadow: var(--tss-seg-shadow);
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
  padding: 9px 2px;
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
  transition: transform .15s cubic-bezier(.2, .8, .2, 1), background .15s ease;
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
  outline: 2px solid var(--tss-muted);
  outline-offset: 1px;
}

/* ---------- First-run hint ---------- */

.tss-toast {
  position: fixed;
  z-index: 2147483000;
  box-sizing: border-box;
  max-width: min(272px, calc(100vw - 24px));
  padding: 8px 12px;
  border-radius: 10px;
  font-family: inherit;
  font-size: 12.5px;
  line-height: 1.35;
  text-align: center;
  color: var(--tss-fg);
  background: var(--tss-surface);
  box-shadow: 0 0 0 1px var(--tss-line), var(--tss-shadow);
  animation: tss-pop .18s cubic-bezier(.2, .8, .2, 1);
}

@media (prefers-reduced-motion: reduce) {
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
    col: null,
    head: null,
    row: null,
    footer: null,
    dock: null,
    content: null,
    inputwrap: null,
    end: null,
  };

  let dead = false;

  let headOk = false;
  let rowOk = false;
  let boxOk = false;
  let headH = 54;
  let rowH = 44;

  // want:   what you asked for in the chat that is open now
  // hidden: what is actually applied on screen right now
  // Keeping them apart means a header that vanishes for a moment while
  // TypingMind swaps chats can no longer wipe out your choice.
  let want = false;
  let hidden = false;
  let folded = false;
  let chatKey = null;

  // Opening a chat starts a short watch: a chat with no saved state that
  // turns out to be empty is a new chat, and gets the message box back.
  let entryAt = -1e9;
  let entryManual = false;
  let emptySince = 0;
  let entryTimer = 0;
  let editing = false;

  let lastY = 0;
  let lastClientH = 0;
  let acc = 0;
  let holdY = null;

  let rafId = 0;
  let placeRaf = 0;
  let measureRaf = 0;

  let touchInPane = false;
  let barDrag = false;
  let gestureDir = 0;
  let lastTouchEnd = -1e9;
  let lastWheel = -1e9;
  let lastKey = -1e9;
  let lastOutside = -1e9;

  let tabEl = null;
  let sheetEl = null;
  let toastEl = null;
  let styleEl = null;
  let ghost = null;   // where the last chevron tap ended, to swallow its stray click

  let toastTimer = 0;
  let hintTimer = 0;
  let pollTimer = 0;

  let ro = null;
  let roDisabled = false;
  let roHits = 0;
  let roWindow = 0;
  const roTargets = new Set();

  let structMO = null;
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

  const hasClass = (name) => root.classList.contains(name);

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

  // The element that really has focus, looking inside shadow roots, so an
  // input inside another extension's widget is never mistaken for "none".
  function deepActive() {
    let a = document.activeElement;
    try {
      while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    } catch (e) { /* closed or detached root */ }
    return a;
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

  /* =================================================================
   * Panel colors
   *
   * Only the options panel and the first-run hint need a surface of
   * their own. Both read the app's real background once, at the moment
   * they open, so they are never out of step with the theme and there
   * is nothing to keep in sync while you read.
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

  function paintSurface(el) {
    const start = parts.pane || document.querySelector(SEL.pane) || document.body;
    const c = start ? opaqueBgFrom(start) : null;

    let r;
    let g;
    let b;
    let dark;

    if (c) {
      r = Math.round(c[0]);
      g = Math.round(c[1]);
      b = Math.round(c[2]);
      dark = (r * 299 + g * 587 + b * 114) / 1000 < 128;
    } else {
      dark = root.classList.contains('dark') ||
        (!root.classList.contains('light') && !!mqDark.matches);
      r = g = dark ? 24 : 255;
      b = dark ? 27 : 255;
    }

    const lift = (v) => Math.min(255, Math.round(v + (255 - v) * 0.07));
    const surface = dark
      ? 'rgb(' + lift(r) + ', ' + lift(g) + ', ' + lift(b) + ')'
      : 'rgb(255, 255, 255)';

    const set = (name, value) => el.style.setProperty(name, value);

    set('--tss-surface', surface);
    set('--tss-fg', dark ? '#ececf1' : '#0f172a');
    set('--tss-muted', dark ? 'rgba(236, 236, 241, .55)' : 'rgba(15, 23, 42, .55)');
    set('--tss-line', dark ? 'rgba(255, 255, 255, .10)' : 'rgba(15, 23, 42, .09)');
    set('--tss-seg', dark ? 'rgba(255, 255, 255, .06)' : 'rgba(15, 23, 42, .05)');
    set('--tss-seg-on', dark ? 'rgba(255, 255, 255, .13)' : '#ffffff');
    set('--tss-seg-shadow', dark ? 'none' : '0 1px 2px rgba(15, 23, 42, .14)');
    set('--tss-shadow', dark ? '0 10px 34px rgba(0, 0, 0, .5)' : '0 10px 34px rgba(15, 23, 42, .16)');
    set('--tss-switch-off', dark ? 'rgba(255, 255, 255, .16)' : 'rgba(15, 23, 42, .14)');
    set('--tss-switch-on', dark ? 'rgba(255, 255, 255, .86)' : '#0f172a');
    set('--tss-knob-off', dark ? '#a1a1aa' : '#ffffff');
    set('--tss-knob-on', dark ? '#18181b' : '#ffffff');
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

    // The chat area is gone (switching chats, app still loading). Watch the
    // whole page until it is back, so it is picked up the moment it
    // renders instead of on the next poll, then narrow down again.
    if (!parts.pane || !parts.col) {
      structMO.observe(document.body || root, { childList: true, subtree: true });
      return;
    }

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
      checkRoute();
      syncParts();
    } catch (e) {
      console.warn(LOG, 'sync failed', e);
    }
  }

  function syncParts() {
    if (styleEl && !styleEl.isConnected) (document.head || root).appendChild(styleEl);

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
        row === tabEl ||
        row.contains(pane) ||
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

    // Minimizing the box hides every child of the footer except the
    // chevron and the model row. That is only safe while the footer holds
    // the composer and nothing else, so check before allowing it.
    const nextBoxOk = !!(
      pane && col && footer && end &&
      footer !== col &&
      footer !== document.body &&
      footer !== root &&
      !footer.contains(pane) &&
      !(head && footer.contains(head))
    );

    // A new chat pane means a new chat: reset scroll tracking. In manual
    // mode each chat's own saved state is restored by checkRoute().
    const paneChanged = pane !== parts.pane;
    if (paneChanged) {
      const hadPane = !!parts.pane;
      if (parts.pane) parts.pane.removeAttribute('data-tss-pane');
      parts.pane = pane;
      if (pane) pane.setAttribute('data-tss-pane', '');
      lastY = pane ? pane.scrollTop : 0;
      lastClientH = pane ? pane.clientHeight : 0;
      acc = 0;
      holdY = null;
      if (hadPane && pane && cfg().mode === 'auto') setWant(false);
    } else if (pane && !pane.hasAttribute('data-tss-pane')) {
      pane.setAttribute('data-tss-pane', '');
    }

    let changed = paneChanged;
    changed = setRole('col', col) || changed;
    changed = setRole('head', head) || changed;
    changed = setRole('row', row) || changed;
    changed = setRole('footer', footer) || changed;
    changed = setRole('dock', dock) || changed;
    changed = setRole('content', content) || changed;
    changed = setRole('inputwrap', inputwrap) || changed;
    changed = setRole('end', end) || changed;

    if (nextBoxOk !== boxOk) {
      boxOk = nextBoxOk;
      changed = true;
    }

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
      roWatch([head, row, end, footer]);
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
   * Measuring, with sanity checks so a layout change cannot break things
   * =================================================================*/

  function measureHead() {
    const el = parts.head;
    let ok = false;
    if (el && el.isConnected && !(hidden && headOk)) {
      const hh = el.offsetHeight;
      ok = hh > 0 && hh < window.innerHeight * 0.45;
      if (ok) headH = hh;
    } else if (el && el.isConnected) {
      ok = true; // collapsed on purpose, keep the last good measurement
    }
    if (ok !== headOk) {
      headOk = ok;
      applyClasses();
    }
  }

  function measureRow() {
    const el = parts.row;
    let ok = false;
    if (el && el.isConnected && !(hidden && rowOk && cfg().models)) {
      const rh = el.offsetHeight;
      ok = rh > 0 && rh < window.innerHeight * 0.35;
      if (ok) rowH = rh;
    } else if (el && el.isConnected) {
      ok = true;
    }
    if (ok !== rowOk) {
      rowOk = ok;
      applyClasses();
    }
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
   * Classes and minimized state
   * =================================================================*/

  // Minimizing is available when at least one part it acts on was found
  function canHide() {
    const c = cfg();
    if (c.mode === 'off') return false;
    return headOk || (c.box && boxOk) || (c.models && rowOk);
  }

  // The message box is minimized right now
  const boxMin = () => hidden && hasClass('tss-box');

  function applyClasses() {
    if (dead) return;
    const c = cfg();
    const active = canHide();

    setClass('tss-phone', isPhone());
    setClass('tss-on', active);
    setClass('tss-head', active && headOk);
    setClass('tss-models', active && c.models && rowOk);
    setClass('tss-box', active && c.box && boxOk);
    setClass('tss-tools', c.tools && !!parts.end);
    setClass('tss-fade', c.fade && !!parts.pane);
    setClass('tss-dense', c.dense);
    setClass('tss-ready', !!(parts.footer && tabEl && tabEl.parentElement === parts.footer));

    // Re-apply your choice whenever the parts come back. If a part is
    // missing for a moment, the layout shows it, but the choice is kept.
    applyHidden(want && active);

    // An option changed while minimized: never leave focus inside
    // something that just left the screen.
    if (hidden) releaseFocus();

    updateTools();
    updateTabLabel();
    schedulePlaceTab();
  }

  /* Record what you want for this chat, then apply it if possible.
   * manual = you did it (tap, shortcut, typing, Edit, console). Only
   * manual choices in Manual mode are saved to the chat's memory. */
  function setWant(value, manual) {
    const v = !!value;
    if (manual) {
      entryManual = true;
      holdY = parts.pane ? parts.pane.scrollTop : 0;
      acc = 0;
      if (cfg().mode === 'manual') remember(chatKey, v);
    }
    want = v;
    applyHidden(v && canHide());
  }

  /* Focus must never stay inside something that is leaving the screen:
   * a hidden message box would swallow your typing, and on a phone it
   * would keep the keyboard open over nothing. */
  function releaseFocus() {
    const ae = document.activeElement;
    if (!ae || ae === document.body || ae === root || ae === tabEl) return;
    const zones = [];
    if (hasClass('tss-head')) zones.push(parts.head);
    if (hasClass('tss-models')) zones.push(parts.row);
    if (hasClass('tss-box')) zones.push(parts.footer);
    if (zones.some((z) => z && z.contains(ae))) {
      try {
        ae.blur();
      } catch (e) { /* ignore */ }
    }
  }

  /* TypingMind keeps an empty spacer under the last message, sized from
   * the chat area's height, so a short reply can scroll up to the top. It
   * re-sizes that spacer half a second after the chat area changes size,
   * and if you are near the end of the chat that late re-size shifts the
   * text on its own. That was the "auto scroll" after a toggle. Here the
   * same re-size happens in the same frame as the toggle instead.
   * It only runs while TypingMind's spacer still matches this formula, so
   * if they ever change theirs, this quietly steps aside. */
  function spacerFor(paneH) {
    const items = document.querySelectorAll('.dynamic-chat-content-container > *');
    if (!items.length) return 1;
    const post = document.querySelector('.post-message-content');
    const postH = post ? post.offsetHeight : 0;
    const last = items[items.length - 1];
    const lastH = last ? last.offsetHeight : 0;
    return Math.max(1, Math.min(paneH - postH - lastH - 100, window.innerHeight));
  }

  function spacerInSync(p) {
    let sp = null;
    try {
      sp = p.querySelector(':scope > [data-element-id="scroll-padding"]');
    } catch (e) {
      return null;
    }
    if (!sp) return null;
    const raw = sp.style.paddingBottom;
    if (!/^\d+(\.\d+)?px$/.test(raw)) return null;
    return Math.abs(parseFloat(raw) - spacerFor(p.clientHeight)) <= 1 ? sp : null;
  }

  /* Collapsing the header changes where the chat pane starts. Measure the
   * pane before and after the class flips and move the scroll position by
   * the same amount, so the words you are reading stay exactly where they
   * are and the freed space fills with more conversation. The message
   * box leaving only makes the pane taller at the bottom, which needs no
   * correction. */
  function applyHidden(value) {
    const v = !!value;
    if (v === hidden) return;

    if (v) releaseFocus();

    const p = parts.pane && parts.pane.isConnected ? parts.pane : null;
    const before = p ? p.getBoundingClientRect().top : null;
    const spacer = p ? spacerInSync(p) : null;

    hidden = v;
    setClass('tss-hide', v);

    // Resize TypingMind's spacer now, in this frame, instead of letting
    // TypingMind do it half a second later and shift the chat on its own.
    if (spacer) {
      const next = spacerFor(p.clientHeight) + 'px';
      if (spacer.style.paddingBottom !== next) spacer.style.paddingBottom = next;
    }

    if (p && before !== null) {
      const delta = before - p.getBoundingClientRect().top;
      if (delta) {
        const max = Math.max(0, p.scrollHeight - p.clientHeight);
        const next = Math.max(0, Math.min(max, p.scrollTop - delta));
        if (next !== p.scrollTop) p.scrollTop = next;
        lastY = p.scrollTop;
        lastClientH = p.clientHeight;
      }
    }

    updateTools();
    updateTabLabel();

    // Coming back: put the chevron above the box in this same frame, so
    // it never shows for a frame at the bottom edge where it used to be.
    if (!v) placeTab();
    else schedulePlaceTab();
  }

  function updateTabLabel() {
    if (!tabEl) return;
    const active = canHide();
    const what = hasClass('tss-box') ? 'the header and message box' : 'the header';
    const label = !active
      ? 'Space Saver options'
      : hidden ? 'Bring back ' + what : 'Minimize ' + what;

    if (tabEl.getAttribute('aria-label') !== label) tabEl.setAttribute('aria-label', label);

    if (active) tabEl.setAttribute('aria-expanded', String(!hidden));
    else tabEl.removeAttribute('aria-expanded');

    const title = isPhone()
      ? ''
      : active
        ? label + ' (' + SHORTCUT + '). Right-click for options'
        : 'Space Saver options';

    if (tabEl.title !== title) tabEl.title = title;
  }

  /* Runs on every URL change, however TypingMind makes it (hash, history,
   * Navigation API), and is cheap enough to call from the poll and from
   * DOM changes as a safety net. */
  function checkRoute() {
    if (dead) return;
    const loc = location.pathname + location.search + location.hash;
    if (loc === lastLoc) return;
    lastLoc = loc;

    const key = currentChatKey();
    const keyChanged = key !== chatKey;
    chatKey = key;

    if (keyChanged) beginEntry();

    if (cfg().mode === 'auto') {
      acc = 0;
      holdY = null;
      setWant(false);
      return;
    }

    // Manual / Off: bring back how you left this chat. Settings pages and
    // other non-chat URLs have no id and leave everything as it is.
    if (!keyChanged) return;
    const saved = recall(key);
    if (saved !== null && saved !== want) {
      acc = 0;
      holdY = null;
      setWant(saved);
    }
  }

  /* =================================================================
   * New chats
   *
   * A minimized box is the right call for reading, never for a chat
   * with nothing in it yet. When you open a chat that has no saved state
   * of its own and it stays empty for a moment, it is a new chat, so the
   * box comes back once, right as the chat opens. Nothing is saved, and
   * nothing changes after that, including when the first reply arrives.
   * =================================================================*/

  function beginEntry() {
    entryAt = now();
    entryManual = false;
    emptySince = 0;
    if (!entryTimer && !dead) entryTimer = setTimeout(checkEntry, T.entryStepMs);
  }

  function chatIsEmpty() {
    const p = document.querySelector(SEL.pane);
    if (!p || !p.isConnected) return false;
    return !p.querySelector(SEL.message);
  }

  function checkEntry() {
    entryTimer = 0;
    if (dead) return;

    const t = now();
    const c = cfg();
    if (t - entryAt > T.entryMs) return;
    if (entryManual || !want || c.mode !== 'manual' || !c.box) return;
    if (recall(chatKey) !== null) return;

    if (!chatIsEmpty()) {
      // Possibly the previous chat, still on screen for a moment. Keep watching.
      emptySince = 0;
    } else {
      if (!emptySince) emptySince = t;
      if (t - emptySince >= T.emptyMs) {
        setWant(false);
        // TypingMind focuses the box when a new chat opens. The box was
        // hidden at that moment, so finish the job for it, on computers
        // only, so a phone never pops its keyboard on its own.
        if (mqFine.matches) focusBox(false);
        return;
      }
    }

    entryTimer = setTimeout(checkEntry, T.entryStepMs);
  }

  /* =================================================================
   * Getting back to the message box
   * =================================================================*/

  function textbox() {
    return (parts.end && parts.end.querySelector(SEL.textbox)) || document.querySelector(SEL.textbox);
  }

  /* Put the cursor in the message box. Unless forced, never while you
   * are in another field, a menu or a dialog, so it can't pull you out
   * of something you are doing. A button keeping focus after a click,
   * like New chat, doesn't count. */
  function focusBox(force) {
    const tb = textbox();
    if (!tb || !tb.isConnected) return false;
    if (!force) {
      const ae = deepActive();
      if (ae && ae !== tb && isEditable(ae)) return false;
      if (ae && safeClosest(ae, POPUP_SEL)) return false;
    }
    try {
      tb.focus({ preventScroll: true });
    } catch (e) {
      return false;
    }
    return document.activeElement === tb;
  }

  // Something you did needs the box (Edit on a message): bring it back
  function composerNeeded() {
    if (!boxMin()) return;
    setWant(false, true);
    focusBox(false);
  }

  // Edit, however it was started, shows a label inside the hidden box
  function checkEditing() {
    const end = parts.end;
    const isEditing = !!(end && end.querySelector(SEL.editLabel));
    if (isEditing && !editing) composerNeeded();
    editing = isEditing;
  }

  /* Typing with nothing focused brings the box back and the keystroke
   * lands in it. It only ever happens while the box is
   * minimized, and never while any field, menu or dialog has your
   * attention, so it cannot steal keys from anything else. */
  function quietTarget(t) {
    if (!t || t === document.body || t === root || t === document) return true;
    if (!(t instanceof Element)) return false;
    if (inUI(t) || isEditable(t)) return false;
    if (!parts.pane || !parts.pane.contains(t)) return false;
    const ctl = safeClosest(t, INTERACTIVE);
    return !ctl || ctl === parts.pane || ctl.contains(parts.pane);
  }

  function onTypeKey(e) {
    if (dead || e.defaultPrevented || e.isComposing || e.repeat) return;
    // A phone's on-screen keyboard only types into a focused field, which
    // never counts as quiet below, so this is keyboards only by nature.
    if (!boxMin()) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (typeof e.key !== 'string' || e.key.length !== 1 || e.key === ' ') return;

    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    if (!quietTarget(path[0] || e.target) || !quietTarget(deepActive())) return;
    if (sheetEl || popupOpen()) return;

    // Selected text means you may be using a highlighter or copy shortcut
    try {
      const sel = window.getSelection && window.getSelection();
      if (sel && !sel.isCollapsed && String(sel).trim()) return;
    } catch (err) { /* ignore */ }

    setWant(false, true);
    focusBox(true);
  }

  // Auto-hide only: nothing to scroll means nothing to make room for
  function checkShortChat() {
    const p = parts.pane;
    if (!hidden || !p || cfg().mode !== 'auto') return;
    if (p.scrollHeight <= p.clientHeight + 4) setWant(false);
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
   * Auto-hide mode only: things duck away on deliberate downward scroll
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

    if (cfg().mode !== 'auto' || !canHide()) return;

    // The chat area changed size (tools folded, keyboard, row wrapped).
    // A scroll jump caused by that is not you scrolling.
    if (resized) {
      acc = 0;
      return;
    }

    if (holdY !== null) {
      if (Math.abs(y - holdY) < T.holdPx) return;
      holdY = null;
      acc = 0;
    }

    // One-way: scrolling up never brings things back
    if (dy <= 0) {
      if (dy < 0) acc = 0;
      return;
    }

    if (!userDriven(dy)) return;

    if (y <= headH + 16) {
      acc = 0;
      return;
    }

    // You just tapped an app control (Thinking, reasoning, model). Stay put.
    if (now() - lastOutside < T.outsideQuietMs) {
      acc = 0;
      return;
    }

    acc += dy;
    if (acc < T.hideAfter) return;
    acc = 0;

    if (!hidden && !popupOpen()) setWant(true);
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

    if (cfg().mode !== 'auto') return;
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  /* =================================================================
   * Input tools (only when the message box itself is kept)
   *
   * They fold only while you are minimized, so nothing folds on a timer
   * and nothing folds because you touched a control. They come straight
   * back whenever you are actually using the composer.
   * =================================================================*/

  function textboxHasText() {
    const tb = textbox() || (parts.end && parts.end.querySelector('textarea, [contenteditable="true"]'));
    if (!tb) return false;
    const v = typeof tb.value === 'string' ? tb.value : tb.textContent;
    return !!(v && v.length);
  }

  /* The Send / Stop button lives in the last slot of the actions row, and
   * TypingMind only fills that slot when there is something to send or
   * stop. A filled slot means the row stays, whatever else is true. */
  function actionsBusy() {
    const end = parts.end;
    if (!end) return false;

    const actions = end.querySelector(SEL.actions);
    if (actions) {
      const last = actions.lastElementChild;
      if (last && last.childElementCount > 0) return true;
    }

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

  function toolsMustShow() {
    const end = parts.end;
    if (!end) return true;

    // Anything in the composer has focus: the box, a tool button, an
    // attachment. The model row is deliberately not included, so tapping
    // Thinking or a reasoning level never moves the layout.
    const ae = document.activeElement;
    if (ae && ae !== document.body && ae !== tabEl && end.contains(ae)) return true;

    // A menu opened from one of the tools is on screen
    if (end.querySelector(OPEN_TRIGGER_SEL)) return true;

    if (textboxHasText()) return true;
    if (actionsBusy()) return true;

    return false;
  }

  function updateTools() {
    if (dead) return;
    const next = !!(cfg().tools && hidden && parts.end && !boxMin() && !toolsMustShow());
    if (next === folded) return;
    folded = next;
    setClass('tss-fold', next);
    schedulePlaceTab();
  }

  /* =================================================================
   * Chevron placement: centred on the message box, just above it. When
   * the box is minimized, CSS pins the chevron to the bottom edge
   * instead, and nothing here touches it.
   * =================================================================*/

  function schedulePlaceTab() {
    if (!placeRaf && !dead) placeRaf = requestAnimationFrame(placeTab);
  }

  function setTabVar(name, value) {
    if (tabEl.style.getPropertyValue(name) !== value) tabEl.style.setProperty(name, value);
  }

  function placeTab() {
    if (placeRaf) {
      cancelAnimationFrame(placeRaf);
      placeRaf = 0;
    }
    const f = parts.footer;
    const end = parts.end;
    if (!tabEl || !f || tabEl.parentElement !== f) return;
    if (boxMin()) return;

    const fr = f.getBoundingClientRect();
    if (!fr.width) return;

    // Offsets inside the footer's padding box, which is this button's
    // containing block. Independent of how TypingMind nests the composer.
    const originX = fr.left + f.clientLeft;
    const originY = fr.top + f.clientTop;

    let top = -T.tabRise;
    let left = f.clientWidth / 2;

    const er = end && end.isConnected ? end.getBoundingClientRect() : null;
    if (er && er.width) {
      top = er.top - originY - T.tabRise;
      left = er.left - originX + er.width / 2;
    }

    // Exact values, never rounded: rounding can flip a pixel back and
    // forth on screens with fractional scaling.
    setTabVar('--tss-top', top.toFixed(2) + 'px');
    setTabVar('--tss-left', left.toFixed(2) + 'px');
  }

  /* =================================================================
   * Chevron
   * =================================================================*/

  /* source: 'mouse' | 'touch' | 'pen' | 'key'
   * Bringing things back with a mouse puts the cursor in the box, the
   * way TypingMind does on a computer. A tap on a phone never does, so
   * the keyboard only opens when you tap into the box yourself. */
  function onTabTap(source) {
    closeToast(true);

    if (sheetEl) {
      closeSheet(false);
      return;
    }

    if (!canHide()) {
      openSheet();
      return;
    }

    const restoring = hidden;
    setWant(!hidden, true);
    if (restoring && source === 'mouse') focusBox(false);
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

      // Keep focus where it is so nothing shifts under your finger
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

    b.addEventListener('pointerup', (e) => {
      if (!down) return;
      const wasCancelled = cancelled;
      release();
      // The chevron moves when the box comes and goes. Whatever ends up
      // under your finger must not get the click this tap produces.
      ghost = { x: e.clientX, y: e.clientY, t: now() };
      if (!wasCancelled) {
        lastHandled = now();
        onTabTap(lastType);
      }
    });

    // A touch that ends on the chevron never turns into mouse events or a
    // click on something else.
    b.addEventListener('touchend', (e) => {
      if (e.cancelable) e.preventDefault();
    }, { passive: false });

    // The chevron sits over the chat. A mouse wheel over it scrolls the
    // chat, exactly as if the chevron were not there.
    b.addEventListener('wheel', (e) => {
      const p = parts.pane;
      if (!p || e.ctrlKey || !e.deltaY) return;
      const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? p.clientHeight : 1;
      e.preventDefault();
      lastWheel = now();
      gestureDir = Math.sign(e.deltaY);
      p.scrollBy(0, e.deltaY * unit);
    }, { passive: false });

    b.addEventListener('pointercancel', () => {
      cancelled = true;
      lastHandled = now();
      release();
    });

    // Pointer events handle taps. Click stays for keyboard and screen readers.
    b.addEventListener('click', (e) => {
      e.preventDefault();
      if (now() - lastHandled > 700) onTabTap('key');
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
        onTabTap('key');
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
   * Options panel
   * =================================================================*/

  const OPTIONS = [
    { key: 'models', label: 'Also minimize the model row' },
    { key: 'box', label: 'Also minimize the message box' },
    { key: 'tools', label: 'Also minimize the input tools' },
    { key: 'fade', label: 'Fade the bottom of the chat' },
    { key: 'dense', label: 'Tighter spacing' },
  ];

  const MODE_LABELS = { manual: 'Manual', auto: 'Auto-hide', off: 'Off' };

  // Options that only mean something while minimizing is on
  const MIN_KEYS = new Set(['models', 'box', 'tools']);

  function optionDisabled(key, c) {
    if (MIN_KEYS.has(key) && c.mode === 'off') return true;
    // The tools leave together with the box, so their switch has no say
    return key === 'tools' && c.box;
  }

  function modeNote(mode) {
    const c = cfg();
    if (mode === 'manual') {
      if (isPhone()) {
        return 'Nothing moves on its own. Tap the chevron to minimize, tap it again to bring everything back.';
      }
      return 'Nothing moves on its own. Tap the chevron or press ' + SHORTCUT +
        ' to minimize, again to restore.' + (c.box ? ' Typing also brings the box back.' : '');
    }
    if (mode === 'auto') {
      return 'Minimizes on its own when you scroll down. Comes back when you tap the chevron or open another chat.';
    }
    return 'Normal TypingMind layout. Tap the chevron to open these options.';
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
      const disabled = optionDisabled(key, c);
      const checked = key === 'tools' && c.box ? true : !!c[key];
      sw.setAttribute('aria-checked', String(checked));
      sw.disabled = disabled;
      opt.setAttribute('aria-disabled', String(disabled));
    });

    sheetEl.querySelector('.tss-hint').textContent = isPhone()
      ? 'Hold the chevron to open this'
      : SHORTCUT + ' minimizes and restores';
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
    if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key) || key === 'mode') return;
    if (optionDisabled(key, c)) return;
    c[key] = !c[key];
    saveStore();
    applyClasses();
    renderSheet();
    requestAnimationFrame(positionSheet);

    // Let TypingMind re-fit the text box after spacing changes
    if (key === 'dense' || key === 'box') {
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    }
  }

  function resetProfile() {
    store[isPhone() ? 'phone' : 'desktop'] = cleanProfile(null);
    saveStore();
    holdY = null;
    acc = 0;
    setWant(false, true);
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
      { class: 'tss-seg', role: 'radiogroup', 'aria-label': 'Behavior' },
      MODES.map((m) => h('button', {
        type: 'button', role: 'radio', 'data-mode': m, text: MODE_LABELS[m],
      }))
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

    paintSurface(sheet);
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
        ? 'Tap the chevron to minimize everything, tap again to bring it back. Hold it for options.'
        : 'Tap the chevron, or press ' + SHORTCUT +
          ', to minimize everything. Right-click it for options.',
    });

    t.addEventListener('click', () => closeToast(true));
    paintSurface(t);
    document.body.appendChild(t);

    const w = t.offsetWidth;
    const hgt = t.offsetHeight;
    const cx = r.left + r.width / 2;

    t.style.left = Math.max(12, Math.min(window.innerWidth - w - 12, Math.round(cx - w / 2))) + 'px';
    t.style.top = Math.max(12, Math.round(r.top - hgt - 10)) + 'px';

    toastEl = t;
    toastTimer = setTimeout(() => closeToast(true), 5600);
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
    // Last line of defence for a chevron tap: if the click it makes lands
    // on something else because the layout moved, it never arrives there.
    on(window, 'click', (e) => {
      const g = ghost;
      if (!g) return;
      if (now() - g.t > 700) {
        ghost = null;
        return;
      }
      const t = e.target instanceof Node ? e.target : null;
      if (t && tabEl && tabEl.contains(t)) return;
      if (Math.abs(e.clientX - g.x) <= 24 && Math.abs(e.clientY - g.y) <= 24) {
        ghost = null;
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);

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

      if (t && !onTab && !inUI(t) && !(parts.pane && parts.pane.contains(t))) {
        lastOutside = now();
      }

      if (sheetEl && !(t && sheetEl.contains(t)) && !onTab) closeSheet(false);
      if (toastEl && !onTab) closeToast(true);
    }, true);

    const pointerEnd = () => {
      if (barDrag) {
        barDrag = false;
        lastWheel = now();
      }
    };
    on(window, 'pointerup', pointerEnd, true);
    on(window, 'pointercancel', pointerEnd, true);

    on(document, 'focusin', () => updateTools(), true);
    on(document, 'focusout', () => setTimeout(updateTools, 0), true);

    on(document, 'input', (e) => {
      if (parts.footer && e.target instanceof Node && parts.footer.contains(e.target)) updateTools();
    }, true);

    // A click is how you usually open another chat, or start editing a
    // message. Check right after TypingMind handles it, and once more in
    // case the URL updates late.
    on(document, 'click', (e) => {
      const edit = e.target instanceof Element ? safeClosest(e.target, SEL.editButton) : null;
      setTimeout(() => {
        checkRoute();
        if (edit) composerNeeded();
        checkEditing();
        updateTools();
      }, 0);
      setTimeout(checkRoute, 150);
    }, true);

    on(document, 'keydown', (e) => {
      if (e.isComposing) return;

      if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyH') {
        if (!parts.pane || !canHide()) return;
        e.preventDefault();
        e.stopPropagation();
        const restoring = hidden;
        setWant(!hidden, true);
        if (restoring) focusBox(false);
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

    // Bubble phase on purpose: TypingMind and other extensions see the
    // key first, and anything they claim is left alone.
    on(document, 'keydown', onTypeKey, false);

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
      updateTools();
      schedulePlaceTab();
    });

    on(window, 'popstate', checkRoute);
    on(window, 'hashchange', checkRoute);

    // Chromium and newer Safari report every URL change here, including
    // history.replaceState, so chat switches are caught instantly.
    const nav = window.navigation;
    if (nav && typeof nav.addEventListener === 'function') {
      on(nav, 'currententrychange', () => queueMicro(checkRoute));
    }

    // Another TypingMind tab changed a setting or a chat's state
    on(window, 'storage', (e) => {
      if (e.key === CHATS_KEY) {
        chats = loadChats();
      } else if (e.key === STORE_KEY) {
        const s = readJSON(STORE_KEY);
        if (s && s.v === SCHEMA) {
          store = loadStore();
          applyClasses();
          renderSheet();
        }
      }
    });

    onMQ(mqPhone, () => {
      closeSheet(false);
      holdY = null;
      acc = 0;
      applyClasses();
      scheduleMeasure();
    });
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
    [hintTimer, toastTimer, entryTimer].forEach(clearTimeout);

    if (ro) ro.disconnect();
    if (structMO) structMO.disconnect();
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

    if (styleEl) styleEl.remove();

    STATE_CLASSES.forEach((c) => root.classList.remove(c));
    root.removeAttribute('data-tss-theme');

    if (window.tmSpace && window.tmSpace.version === VERSION) delete window.tmSpace;
    window.__tssTeardown = null;

    console.log(LOG, 'Off until the app reloads.');
  }

  function init() {
    if (dead) return;

    // Clean out anything an older version left behind
    ['tss-style', 'tss-vars'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });
    ['--tss-head', '--tss-row', '--tss-bg', '--tss-tab-top', '--tss-tab-x', '--tss-content-pad']
      .forEach((v) => root.style.removeProperty(v));
    root.removeAttribute('data-tss-theme');

    styleEl = document.createElement('style');
    styleEl.id = 'tss-style';
    styleEl.textContent = CSS_TEXT;
    (document.head || root).appendChild(styleEl);

    tabEl = makeTab();
    makeRO();
    if ('MutationObserver' in window) structMO = new MutationObserver(queueSync);

    installListeners();

    // Start the open chat the way you left it. The parts are applied as
    // soon as they have been found and measured.
    lastLoc = location.pathname + location.search + location.hash;
    chatKey = currentChatKey();
    const saved = recall(chatKey);
    want = saved !== null ? saved : chats.last;
    if (cfg().mode === 'auto') want = false;
    beginEntry();

    sync();
    watchStructure(); // covers the app not having rendered the chat yet
    applyClasses();

    pollTimer = setInterval(() => {
      if (document.hidden || dead) return;
      sync(); // also checks the URL
      // A feature that measured badly earlier gets another chance every tick
      if (roDisabled || !headOk || (cfg().models && !rowOk)) scheduleMeasure();
      checkShortChat();
      checkEditing();
      updateTools();
      schedulePlaceTab();
    }, T.pollMs);

    window.__tssTeardown = teardown;

    window.tmSpace = {
      version: VERSION,
      show: () => setWant(false, true),
      hide: () => setWant(true, true),
      toggle: () => setWant(!hidden, true),
      options: () => openSheet(),
      settings: () => ({
        settings: JSON.parse(JSON.stringify(store)),
        chatsRemembered: Object.keys(chats.map).length,
      }),
      forgetChats: () => {
        chats = emptyChats();
        saveChats();
      },
      reset: () => {
        store = {
          v: SCHEMA,
          phone: cleanProfile(null),
          desktop: cleanProfile(null),
          hinted: true,
        };
        saveStore();
        chats = emptyChats();
        saveChats();
        holdY = null;
        acc = 0;
        setWant(false);
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
          headerHeight: headH,
          modelRowFound: rowOk,
          modelRowHeight: rowH,
          messageBoxFound: boxOk,
          chatId: chatKey,
          chatRemembered: recall(chatKey),
          chatsRemembered: Object.keys(chats.map).length,
          wanted: want,
          minimized: hidden,
          boxMinimized: boxMin(),
          toolsFolded: folded,
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
