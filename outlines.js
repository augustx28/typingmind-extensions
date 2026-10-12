// TypingMind Page Outline Extension v5.4
// Groups response headings beneath each user input.
// Open it with the button (draggable), Ctrl/Cmd + Shift + O, or a swipe
// left on the chat (touch screens). Swipe the open panel right to close it.
//
// v5.4 changes:
// - "Outline" now has its own row in TypingMind's chat menu (the chevron at
//   the top right), right under "Search in chat", with a pin like the other
//   rows. Pinned shows the floating button; unpinned hides it, and the swipe
//   and Ctrl/Cmd + Shift + O still open the outline. Tapping the row opens
//   it too. The setting is saved on each device, and starts pinned.
// - The row is copied from TypingMind's own rows, so it looks the same,
//   pin icons included.
// - Nothing else changed.
//
// v5.3 changes:
// - The "Outline" title is dimmed to the same quiet tone as the count.
// - The open button has a slightly warmer tone in both themes.
// - Inputs sit in a soft rounded box instead of next to a speech bubble.
//   The box marks where each exchange starts, so the divider line is gone.
//
// v5.2 changes:
// - Dimmer text in dark mode. Headings, inputs, the small labels and the
//   speech bubbles each step down a notch. Light mode is unchanged.
//
// v5.1 changes:
// - Darker dark mode: the panel is back to v4.8's depth, still warm, and
//   its text is a touch softer.
// - The rounded-square button and its original icon are back. At rest it
//   is see-through like v4.8, so it stays quiet. It still lifts while you
//   drag it, and the open state is gray instead of gold.
// - Swipe is built in. Swipe left anywhere on the chat to open the outline;
//   a quick flick works too. It doesn't need the screen edge, where
//   Android's Back swipe lives. The message box, dialogs, and content that
//   scrolls sideways (wide code blocks, tables) keep their own swipes.
// - Drag the open panel to the right to close it. It follows your finger,
//   then slides away, or springs back if you let go early.
// - Opened by a swipe, the panel slides in from the right.
// - If the old right-edge swipe add-on is still loaded, it is switched off,
//   since the swipe now lives here.
//
// v5.0 changes (design only; everything works the same as v4.8):
// - New palette: quiet warm grays in light and dark mode. The gold accent
//   is gone everywhere: inputs, the open button, focus rings and the wash
//   that marks where a jump lands.
// - Inputs lose the tinted band and gold bar. A small speech bubble marks
//   each one and a hairline separates one exchange from the next.
// - Headings hang under their input, indented by level. In multi-model
//   chats each model's icon sits in the same left column as the bubbles,
//   right where that model's answer starts.
// - Round toggle button with an outline icon. It lifts while you drag it.
// - Softer panel: rounder corners, layered shadow, plain "Outline" title,
//   and a header line that only shows once the list scrolls under it.
// - Smoother motion: the panel grows out of the button and settles on an
//   ease-out curve. Closing is quicker than opening.
// - Uses TypingMind's own font, so a custom font carries over.
// - Bigger text and rows on touch screens, and the button's tap area
//   reaches a few pixels past its edge. Hover highlights only show with a
//   mouse, so a tapped row no longer stays lit on a phone.
// - The right-edge swipe add-on is no longer part of this file. Every id
//   and class it uses is unchanged, so it still works if pasted back.
//
// v4.8 changes:
// - Model icons are round, like TypingMind's own avatars, instead of
//   rounded squares. Dark logos no longer show white corners or a white
//   rim: the white fill behind logo images now stops just inside the edge.
// - Logos that TypingMind draws inside a colored circle (GPT, Claude) keep
//   the same margin they have in TypingMind, so the circle never cuts them.
// - Logo images are stretched or letterboxed exactly as TypingMind draws
//   them, so a logo that isn't square no longer gets white bars.
// - Icons are a little bigger (20px, was 16px), every model's icon is the
//   same size, and each one sits centered on its heading's first line
//   without making the row taller.
//
// v4.7 changes:
// - Clicking an input scrolls to it with no flash, so the chat bubble keeps
//   its shape and color. Headings still flash.
// - Switching models from the outline no longer leaves an outline around
//   the model's card. It selects the model through the card's own name
//   button instead of the tab.
//
// v4.6 changes (built on v4.3):
// - Multi-model chats: clicking a heading or input that belongs to another
//   model now switches TypingMind to that model first, then scrolls to the
//   heading. Headings no longer land hidden under the sticky model tab bar.
// - The button no longer wanders after a window resize. Its spot is saved
//   relative to the nearest corner of the screen. Shrinking the window only
//   pushes it inward while the window is too small; restore the window and
//   it goes back to exactly where you left it.
// - Touch: the button only moves after you hold it for 250 ms, so a quick
//   swipe or sloppy tap that starts on it can't drag it away. Mouse drags
//   work as before. Double-tap to reset now works on phones too.
// - Model icons only come from the model's own response card, so a stray
//   avatar from the sidebar can't show up next to a heading.
// - Faster on long chats and during streaming:
//   - The "am I on a chat page" check runs at most ~8 times a second and
//     only when elements are added or removed, not on every streamed token.
//   - The outline list is patched in place instead of rebuilt, so a tap on
//     an item can't get lost when a refresh lands mid-tap.
//   - Prompt text and thinking-block checks are cached per element.
//   - Removed a fallback that measured every div on the page whenever the
//     chat was empty.
// - Headings are only taken from AI responses, so headings from dialogs or
//   the empty-chat screen never leak into the outline.
// - If a message re-renders (a reply finishing its stream, for example)
//   right before you click it, the outline finds the new copy instead of
//   doing nothing.

(function () {
  'use strict';

  const VERSION = '5.4';
  const NAMESPACE = '__tmPageOutline';

  const PANEL_ID = 'tm-page-outline-panel';
  const TOGGLE_ID = 'tm-page-outline-toggle';
  const STYLE_ID = 'tm-page-outline-styles';
  const STORAGE_KEY = 'tm-page-outline-button-position';

  const USER_MESSAGE_SELECTOR = '[data-element-id="user-message"]';
  const AI_RESPONSE_SELECTOR = '[data-element-id="ai-response"]';
  const CHAT_SCROLLER_SELECTOR = '[data-element-id="chat-space-middle-part"]';
  const CHAT_SPACE_SELECTOR = '[data-element-id="chat-space"]';

  // Every user input plus every h1-h4 inside an AI response, returned by the
  // browser already in document order.
  const OUTLINE_ITEM_SELECTOR = [
    USER_MESSAGE_SELECTOR,
    ...['h1', 'h2', 'h3', 'h4'].map((tag) => `${AI_RESPONSE_SELECTOR} ${tag}`)
  ].join(', ');

  // Multi-model chats: each model's reply is a card <div id="response-...">
  // inside a horizontal rail, with a sticky tab bar above the rail.
  const RESPONSE_CARD_SELECTOR = 'div[id^="response-"]';
  const MODEL_AVATAR_SELECTOR = '.w-7.h-7.rounded-full';
  const SELECTED_TAB_CLASS = 'border-blue-500';

  // Containers that hold the model's thinking / reasoning output.
  // Headings inside any of these are skipped.
  const THINKING_BLOCK_SELECTOR = [
    'details',
    '[data-element-id*="thinking"]',
    '[data-element-id*="thought"]',
    '[data-element-id*="reasoning"]',
    '[class*="thinking"]',
    '[class*="thought"]',
    '[class*="reasoning"]'
  ].join(', ');

  const THINKING_LABEL_PATTERN =
    /\b(thought|thoughts|thinking|reasoning|reasoned)\b/i;

  // Geometry
  const BUTTON_SIZE = 32;
  const EDGE_MARGIN = 8;
  const PANEL_GAP = 8;
  const MIN_PANEL_HEIGHT = 140;
  const DEFAULT_PANEL_WIDTH = 288;
  const SCROLL_TOP_GAP = 10;
  const ICON_SIZE = 20;

  const DEFAULT_ANCHOR = Object.freeze({
    x: 'right',
    dx: 12,
    y: 'top',
    dy: 50
  });

  // Interaction
  const MOUSE_DRAG_THRESHOLD = 5;
  const TOUCH_HOLD_MS = 250;
  const TOUCH_SLOP = 10;
  const DOUBLE_TAP_MS = 320;
  const CLICK_SUPPRESS_MS = 450;
  const FLASH_DELAY_MS = 180;
  const REFRESH_DEBOUNCE_MS = 450;
  const REFRESH_MAX_WAIT_MS = 1600;
  const VISIBILITY_THROTTLE_MS = 120;

  // Swipe gestures (touch only)
  const SWIPE_DECIDE_PX = 10;       // travel before the direction is judged
  const SWIPE_RATIO = 1.6;          // sideways must beat vertical by this much
  const SWIPE_DECIDE_MS = 450;      // slower starts are scrolls or selections
  const SWIPE_OPEN_PX = 56;         // left travel that opens the panel
  const SWIPE_FLICK_PX = 26;        // a fast flick needs only this much
  const SWIPE_FLICK_SPEED = 0.3;    // px per ms
  const SWIPE_CLOSE_PX = 72;        // right drag on the panel that closes it
  const SWIPE_CLOSE_FLICK_PX = 24;  // or a fast flick this long
  const SWIPE_RESET_MS = 260;       // after a swipe close, before reuse

  // Swipes that start on these keep their own behavior.
  const SWIPE_EXCLUDE_SELECTOR = [
    `#${TOGGLE_ID}`,
    `#${PANEL_ID}`,
    'input',
    'textarea',
    'select',
    '[contenteditable=""]',
    '[contenteditable="true"]',
    'dialog',
    '[role="dialog"]',
    '[aria-modal="true"]',
    '[role="menu"]',
    '[role="listbox"]',
    '[data-element-id="side-bar"]',
    '[data-element-id="sidebar"]'
  ].join(', ');

  // TypingMind's chat menu (see "Outline row in TypingMind's chat menu")
  const PIN_STORAGE_KEY = 'tm-page-outline-pinned';
  const MENU_LABELS = [
    'Search in chat',
    'Share',
    'Reset chat',
    'Clear context',
    'Toggle select mode',
    'About this chat'
  ];
  const MENU_MARKERS = MENU_LABELS.filter((label) => label !== 'Share');
  const MENU_ROW_ATTR = 'data-po-menu-item';
  const MENU_PIN_ATTR = 'data-po-menu-pin';
  const MENU_SKIP_SELECTOR = [
    AI_RESPONSE_SELECTOR,
    USER_MESSAGE_SELECTOR,
    `#${PANEL_ID}`,
    `#${TOGGLE_ID}`,
    `[${MENU_ROW_ATTR}]`
  ].join(', ');
  const MENU_TRIGGER_WINDOW_MS = 1500;
  const MENU_CLOSE_GRACE_MS = 700;
  const MENU_FALLBACK_CLOSE_MS = 300;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // Text limits
  const PROMPT_PREVIEW_LENGTH = 180;
  const PROMPT_TITLE_LENGTH = 1000;
  const PROMPT_LABEL_LENGTH = 300;

  // Button icon
  const TOGGLE_ICON = `
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <line x1="3" y1="6" x2="21" y2="6"></line>
      <line x1="3" y1="12" x2="15" y2="12"></line>
      <line x1="3" y1="18" x2="11" y2="18"></line>
    </svg>
  `;

  let panelVisible = false;
  let destroyed = false;
  let observer = null;

  let refreshTimer = null;
  let visibilityTimer = null;
  let refreshPendingSince = 0;
  let nextNodeId = 1;
  let currentEntries = [];

  // anchor = where you put the button (saved, never changed by a resize).
  // buttonPosition = where it is drawn right now (anchor fitted to window).
  let anchor = null;
  let buttonPosition = null;

  let dragState = null;
  let dragFrame = null;
  let resizeFrame = null;
  let suppressClickUntil = 0;
  let lastTapTime = 0;
  let navigationToken = 0;
  let clickingTab = false;

  let chatSwipe = null;
  let panelSwipe = null;
  let panelSwipeFrame = null;
  let poseTimer = null;
  let suppressOutsideCloseUntil = 0;

  let buttonPinned = true;
  let onChatPage = false;
  let menuRow = null;
  let lastPress = null;

  const nodeIds = new WeakMap();
  const flashTimers = new WeakMap();
  const iconCache = new WeakMap();
  const promptCache = new WeakMap();
  const thinkingCache = new WeakMap();

  removePreviousInstance();

  // ---------------------------------------------------------------------------
  // Previous instance cleanup
  // ---------------------------------------------------------------------------

  function removePreviousInstance() {
    const previous = window[NAMESPACE];

    if (previous && typeof previous.destroy === 'function') {
      try {
        previous.destroy();
      } catch (error) {
        console.debug(
          '[Page Outline] Could not destroy the previous instance.',
          error
        );
      }
    }

    // Older versions had no destroy hook, so clear their nodes and guards.
    document
      .querySelectorAll(
        `#${PANEL_ID}, #${TOGGLE_ID}, style[id^="${STYLE_ID}"], [data-po-menu-item]`
      )
      .forEach((node) => node.remove());

    delete window.__tmPageOutlineV42Loaded;

    // The swipe is built in now, so switch off the old right-edge add-on
    // if it is still loaded. Otherwise both would answer the same swipe.
    const oldSwipe = window.__tmPageOutlineSwipe;

    if (oldSwipe && typeof oldSwipe.destroy === 'function') {
      try {
        oldSwipe.destroy();
      } catch (error) {
        console.debug(
          '[Page Outline] Could not switch off the old swipe add-on.',
          error
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;

    const toggle = `#${TOGGLE_ID}`;
    const panel = `#${PANEL_ID}`;

    style.textContent = `
      /* Palette: warm grays with only a few RGB points of warmth, so they
         read as gray first. Light theme here, dark theme right below. */

      ${toggle},
      ${panel} {
        --po-surface: #ffffff;
        --po-text: #2b2a28;
        --po-text-2: #5a5752;
        --po-text-3: #77736d;
        --po-icon: #8f8b85;
        --po-line: rgba(70, 60, 45, 0.11);
        --po-hover: rgba(70, 60, 45, 0.055);
        --po-press: rgba(70, 60, 45, 0.095);
        --po-focus: rgba(70, 60, 45, 0.55);
        --po-scroll: rgba(70, 60, 45, 0.2);
        --po-btn: rgba(120, 108, 90, 0.1);
        --po-btn-hover: rgba(120, 108, 90, 0.17);
        --po-btn-on: rgba(146, 120, 88, 0.21);
        --po-btn-on-icon: #342e27;
        --po-box: rgba(120, 108, 90, 0.065);
        --po-box-line: rgba(110, 98, 80, 0.12);
        --po-box-hover: rgba(120, 108, 90, 0.11);
        --po-box-press: rgba(120, 108, 90, 0.15);
        --po-btn-line: rgba(110, 98, 80, 0.13);
        --po-btn-icon: rgba(88, 80, 68, 0.75);
        --po-btn-icon-hover: rgba(58, 53, 46, 0.9);
        --po-shadow:
          0 1px 2px rgba(40, 32, 20, 0.05),
          0 6px 16px -4px rgba(40, 32, 20, 0.1),
          0 20px 40px -12px rgba(40, 32, 20, 0.16);
        --po-ease: cubic-bezier(0.22, 1, 0.36, 1);
        --po-fs: 13px;
        --po-fs-sm: 12.5px;
        --po-fs-xs: 11.5px;
        --po-lh: 1.35;
      }

      .dark ${toggle},
      .dark ${panel} {
        --po-surface: #1c1b19;
        --po-text: #c4c1bb;
        --po-text-2: #9f9b95;
        --po-text-3: #86827c;
        --po-icon: #7d7973;
        --po-line: rgba(255, 246, 232, 0.085);
        --po-hover: rgba(255, 246, 232, 0.055);
        --po-press: rgba(255, 246, 232, 0.09);
        --po-focus: rgba(255, 246, 232, 0.4);
        --po-scroll: rgba(255, 246, 232, 0.16);
        --po-btn: rgba(255, 246, 232, 0.06);
        --po-btn-hover: rgba(255, 246, 232, 0.11);
        --po-btn-on: rgba(255, 233, 206, 0.145);
        --po-btn-on-icon: #cdc6bb;
        --po-box: rgba(255, 246, 232, 0.05);
        --po-box-line: rgba(255, 246, 232, 0.075);
        --po-box-hover: rgba(255, 246, 232, 0.085);
        --po-box-press: rgba(255, 246, 232, 0.11);
        --po-btn-line: rgba(255, 246, 232, 0.08);
        --po-btn-icon: rgba(226, 219, 207, 0.6);
        --po-btn-icon-hover: rgba(236, 230, 219, 0.88);
        --po-shadow:
          0 0 0 0.5px rgba(0, 0, 0, 0.35),
          0 8px 24px -6px rgba(0, 0, 0, 0.6),
          0 24px 48px -16px rgba(0, 0, 0, 0.55),
          inset 0 1px 0 rgba(255, 250, 240, 0.035);
      }

      @media (pointer: coarse) {
        ${toggle},
        ${panel} {
          --po-fs: 13.5px;
          --po-fs-sm: 13px;
          --po-fs-xs: 12px;
        }
      }

      /* Toggle button: rounded square, see-through at rest */

      ${toggle} {
        position: fixed;
        top: 0;
        left: 0;
        z-index: 99999;
        box-sizing: border-box;
        width: ${BUTTON_SIZE}px;
        height: ${BUTTON_SIZE}px;
        margin: 0;
        padding: 0;
        border-radius: 7px;
        border: 1px solid var(--po-btn-line);
        background: var(--po-btn);
        color: var(--po-btn-icon);
        box-shadow: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
        outline: none;
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        transform: scale(0.9);
        transition:
          opacity 0.2s ease,
          transform 0.28s var(--po-ease),
          visibility 0s linear 0.2s,
          background-color 0.18s ease,
          color 0.18s ease,
          border-color 0.18s ease,
          box-shadow 0.22s ease;
        user-select: none;
        -webkit-user-select: none;
        -webkit-touch-callout: none;
        touch-action: none;
        -webkit-tap-highlight-color: transparent;
      }

      ${toggle} svg {
        display: block;
        width: 14px;
        height: 14px;
        pointer-events: none;
      }

      ${toggle}.chat-visible {
        opacity: 0.7;
        visibility: visible;
        pointer-events: auto;
        transform: scale(1);
        transition:
          opacity 0.2s ease,
          transform 0.28s var(--po-ease),
          visibility 0s,
          background-color 0.18s ease,
          color 0.18s ease,
          border-color 0.18s ease,
          box-shadow 0.22s ease;
      }

      @media (hover: hover) {
        ${toggle}:hover {
          opacity: 1;
          background: var(--po-btn-hover);
          color: var(--po-btn-icon-hover);
        }
      }

      ${toggle}:active {
        background: var(--po-btn-on);
      }

      ${toggle}.active {
        opacity: 1;
        background: var(--po-btn-on);
        color: var(--po-btn-on-icon);
      }

      /* Lifted while dragging. On touch it lifts as soon as the hold is
         long enough, which tells you the button is ready to move. */

      ${toggle}.dragging {
        opacity: 1;
        cursor: grabbing;
        background: var(--po-surface);
        border-color: var(--po-line);
        color: var(--po-text-2);
        box-shadow: var(--po-shadow);
        transform: scale(1.06);
        transition:
          transform 0.22s var(--po-ease),
          box-shadow 0.22s ease,
          background-color 0.18s ease,
          color 0.18s ease;
      }

      ${toggle}:focus-visible {
        outline: 2px solid var(--po-focus);
        outline-offset: 2px;
      }

      /* A few extra pixels of tap area around the button on touch screens. */

      @media (pointer: coarse) {
        ${toggle}::before {
          content: '';
          position: absolute;
          inset: -7px;
          border-radius: 12px;
        }
      }

      /* While dragging, stop the page from selecting text under the cursor */

      body.tm-outline-dragging {
        user-select: none !important;
        -webkit-user-select: none !important;
        cursor: grabbing !important;
      }

      /* Panel */

      ${panel} {
        position: fixed;
        top: 0;
        left: 0;
        z-index: 99998;
        box-sizing: border-box;
        width: ${DEFAULT_PANEL_WIDTH}px;
        max-width: calc(100vw - ${EDGE_MARGIN * 2}px);
        max-height: calc(100vh - ${EDGE_MARGIN * 2}px);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        margin: 0;
        padding: 0;
        border-radius: 14px;
        border: 1px solid var(--po-line);
        background: var(--po-surface);
        color: var(--po-text);
        box-shadow: var(--po-shadow);
        font-family: inherit;
        font-size: var(--po-fs);
        font-weight: 400;
        font-style: normal;
        line-height: var(--po-lh);
        letter-spacing: normal;
        text-align: left;
        text-transform: none;
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        transform: scale(0.96);
        transform-origin: top right;
        touch-action: pan-y;
        transition:
          opacity 0.12s ease-in,
          transform 0.12s ease-in,
          visibility 0s linear 0.12s;
      }

      ${panel}.visible {
        opacity: 1;
        visibility: visible;
        pointer-events: auto;
        transform: none;
        transition:
          opacity 0.18s ease-out,
          transform 0.26s var(--po-ease),
          visibility 0s;
      }

      .dark ${panel} {
        color-scheme: dark;
      }

      /* Swipe poses. Opened by a swipe, the panel slides in from the right,
         and a swipe close sends it back out that way. While a finger drags
         it, it follows with no easing. */

      ${panel}.from-edge:not(.visible) {
        transform: translateX(20px);
      }

      ${panel}.swipe-closing {
        transition:
          opacity 0.2s ease-out,
          transform 0.22s var(--po-ease),
          visibility 0s linear 0.22s;
      }

      ${panel}.tracking,
      ${panel}.no-anim {
        transition: none !important;
      }

      /* Panel header */

      ${panel} .outline-header {
        flex: 0 0 auto;
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 16px 8px;
        border-bottom: 1px solid transparent;
        transition: border-color 0.2s ease;
      }

      /* The header line only shows once the list scrolls under it. */

      ${panel}.is-scrolled .outline-header {
        border-bottom-color: var(--po-line);
      }

      ${panel} .outline-title {
        font-size: var(--po-fs);
        font-weight: 600;
        color: var(--po-text-3);
      }

      ${panel} .outline-count {
        font-size: var(--po-fs-xs);
        color: var(--po-text-3);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }

      /* Outline list */

      ${panel} .outline-list {
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
        touch-action: pan-y;
        list-style: none;
        margin: 0;
        padding: 0 0 8px;
        scrollbar-width: thin;
        scrollbar-color: var(--po-scroll) transparent;
      }

      /* Rows. Headings keep a 20px column on their left where, in
         multi-model chats, each model's icon marks where its answer starts. */

      ${panel} .outline-item {
        --po-pad-y: 4px;
        --po-indent: 36px;
        position: relative;
        display: flex;
        align-items: flex-start;
        gap: 8px;
        margin: 0 6px;
        padding: var(--po-pad-y) 10px var(--po-pad-y) var(--po-indent);
        border-radius: 8px;
        cursor: pointer;
        color: var(--po-text);
        font-size: var(--po-fs);
        white-space: normal;
        outline: none;
        transition:
          background-color 0.14s ease,
          color 0.14s ease;
        -webkit-tap-highlight-color: transparent;
      }

      ${panel} .outline-item > span {
        flex: 1 1 auto;
        min-width: 0;
        overflow-wrap: anywhere;
        word-break: break-word;
      }

      @media (pointer: coarse) {
        ${panel} .outline-item {
          --po-pad-y: 5px;
        }
      }

      @media (hover: hover) {
        ${panel} .outline-item:hover {
          background-color: var(--po-hover);
        }

        ${panel} .outline-prompt:hover {
          color: var(--po-text);
          background-color: var(--po-box-hover);
        }
      }

      ${panel} .outline-item:active {
        background-color: var(--po-press);
      }

      ${panel} .outline-item:focus-visible {
        box-shadow: inset 0 0 0 2px var(--po-focus);
      }

      /* User input: a soft rounded box that opens each exchange. Its left
         edge lines up with the model icons below it. */

      ${panel} .outline-prompt {
        margin: 12px 12px 4px;
        padding: 7px 11px;
        border: 1px solid var(--po-box-line);
        border-radius: 12px;
        background-color: var(--po-box);
        color: var(--po-text-2);
        font-size: var(--po-fs-sm);
        font-weight: 500;
      }

      ${panel} .outline-prompt:first-child {
        margin-top: 2px;
      }

      ${panel} .outline-prompt:active {
        background-color: var(--po-box-press);
      }

      @media (pointer: coarse) {
        ${panel} .outline-prompt {
          padding: 8px 12px;
        }
      }

      ${panel} .outline-prompt-text {
        display: -webkit-box;
        overflow: hidden;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        line-clamp: 2;
      }

      /* Heading levels: indent carries the level, weight and tone back it
         up. Level 1 is the top heading of each answer. */

      ${panel} .outline-item[data-level="1"] {
        --po-indent: 36px;
        font-weight: 600;
      }

      ${panel} .outline-item[data-level="2"] {
        --po-indent: 48px;
      }

      ${panel} .outline-item[data-level="3"] {
        --po-indent: 60px;
        color: var(--po-text-2);
        font-size: var(--po-fs-sm);
      }

      ${panel} .outline-item[data-level="4"] {
        --po-indent: 72px;
        color: var(--po-text-3);
        font-size: var(--po-fs-sm);
      }

      /* Model icon: round, like TypingMind's own avatars. It sits in the
         left column, centered on the heading's first line. */

      ${panel} .outline-model-icon {
        position: absolute;
        left: 6px;
        top: calc(var(--po-pad-y) + (var(--po-lh) * 1em - ${ICON_SIZE}px) / 2);
        box-sizing: border-box;
        width: ${ICON_SIZE}px;
        height: ${ICON_SIZE}px;
        min-width: ${ICON_SIZE}px;
        min-height: ${ICON_SIZE}px;
        max-width: ${ICON_SIZE}px;
        max-height: ${ICON_SIZE}px;
        margin: 0;
        border-radius: 50%;
        object-fit: contain;
        opacity: 0.9;
      }

      /* Empty state */

      ${panel} .outline-empty {
        margin: 0;
        padding: 14px 20px 20px;
        text-align: center;
        font-size: var(--po-fs-sm);
        line-height: 1.5;
        color: var(--po-text-3);
      }

      ${panel} .outline-empty-title {
        display: block;
        margin-bottom: 2px;
        font-size: var(--po-fs);
        font-weight: 600;
        color: var(--po-text-2);
      }

      /* Scrollbar (Safari; Chrome and Firefox use scrollbar-color above) */

      ${panel} .outline-list::-webkit-scrollbar {
        width: 10px;
      }

      ${panel} .outline-list::-webkit-scrollbar-track {
        background: transparent;
      }

      ${panel} .outline-list::-webkit-scrollbar-thumb {
        background-color: var(--po-scroll);
        background-clip: padding-box;
        border: 3px solid transparent;
        border-radius: 10px;
      }

      @media (max-width: 768px) {
        ${panel} {
          width: min(320px, calc(100vw - ${EDGE_MARGIN * 2}px));
        }
      }

      /* Where a jump lands: a soft warm wash that fades out. */

      .tm-outline-target-flash {
        --po-flash: rgba(110, 92, 64, 0.16);
        border-radius: 6px;
        animation: tmOutlineTargetFlash 1.2s ease-out !important;
      }

      .dark .tm-outline-target-flash {
        --po-flash: rgba(255, 240, 215, 0.13);
      }

      @keyframes tmOutlineTargetFlash {
        0%,
        20% {
          background-color: var(--po-flash);
          box-shadow: 0 0 0 6px var(--po-flash);
        }

        100% {
          background-color: transparent;
          box-shadow: 0 0 0 6px transparent;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        ${toggle},
        ${toggle}.chat-visible,
        ${toggle}.dragging,
        ${panel},
        ${panel}.visible {
          transform: none !important;
        }
      }
    `;

    document.head.appendChild(style);
  }

  // ---------------------------------------------------------------------------
  // Button position
  //
  // The saved spot is an anchor: which horizontal edge (left/right) and
  // which vertical edge (top/bottom) the button is nearest to, plus the
  // distance from each. A resize re-fits the anchor to the new window but
  // never overwrites it, so shrinking and restoring the window is lossless.
  // Only a drag or a reset changes the anchor.
  // ---------------------------------------------------------------------------

  function getViewport() {
    return {
      width: window.innerWidth,
      height: window.innerHeight
    };
  }

  function clampPosition(position) {
    const { width, height } = getViewport();

    const maxLeft = Math.max(
      EDGE_MARGIN,
      width - BUTTON_SIZE - EDGE_MARGIN
    );

    const maxTop = Math.max(
      EDGE_MARGIN,
      height - BUTTON_SIZE - EDGE_MARGIN
    );

    return {
      left: Math.round(
        Math.min(Math.max(position.left, EDGE_MARGIN), maxLeft)
      ),
      top: Math.round(
        Math.min(Math.max(position.top, EDGE_MARGIN), maxTop)
      )
    };
  }

  function isValidAnchor(value) {
    return Boolean(
      value &&
      (value.x === 'left' || value.x === 'right') &&
      (value.y === 'top' || value.y === 'bottom') &&
      Number.isFinite(value.dx) &&
      Number.isFinite(value.dy)
    );
  }

  function anchorToPosition(value) {
    const { width, height } = getViewport();

    return clampPosition({
      left: value.x === 'right'
        ? width - BUTTON_SIZE - value.dx
        : value.dx,
      top: value.y === 'bottom'
        ? height - BUTTON_SIZE - value.dy
        : value.dy
    });
  }

  function positionToAnchor(position) {
    const { width, height } = getViewport();
    const placed = clampPosition(position);

    const nearRight = placed.left + BUTTON_SIZE / 2 > width / 2;
    const nearBottom = placed.top + BUTTON_SIZE / 2 > height / 2;

    return {
      x: nearRight ? 'right' : 'left',
      dx: Math.round(
        nearRight ? width - BUTTON_SIZE - placed.left : placed.left
      ),
      y: nearBottom ? 'bottom' : 'top',
      dy: Math.round(
        nearBottom ? height - BUTTON_SIZE - placed.top : placed.top
      )
    };
  }

  function loadAnchor() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);

      if (!raw) {
        return { ...DEFAULT_ANCHOR };
      }

      const saved = JSON.parse(raw);

      if (isValidAnchor(saved)) {
        return {
          x: saved.x,
          dx: saved.dx,
          y: saved.y,
          dy: saved.dy
        };
      }

      // v4.3 and older saved raw left/top pixels. Convert once.
      if (
        saved &&
        Number.isFinite(saved.left) &&
        Number.isFinite(saved.top)
      ) {
        const migrated = positionToAnchor(saved);
        writeAnchor(migrated);
        return migrated;
      }
    } catch (error) {
      console.debug(
        '[Page Outline] Could not read the saved button position.',
        error
      );
    }

    return { ...DEFAULT_ANCHOR };
  }

  function writeAnchor(value) {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ v: 2, ...value })
      );
    } catch (error) {
      console.debug(
        '[Page Outline] Could not save the button position.',
        error
      );
    }
  }

  function applyButtonPosition() {
    const button = document.getElementById(TOGGLE_ID);

    if (!button || !buttonPosition) return;

    button.style.left = `${buttonPosition.left}px`;
    button.style.top = `${buttonPosition.top}px`;
  }

  function fitButtonToWindow() {
    buttonPosition = anchorToPosition(anchor);
    applyButtonPosition();
  }

  function resetPosition() {
    anchor = { ...DEFAULT_ANCHOR };
    writeAnchor(anchor);
    fitButtonToWindow();
    positionPanel();
  }

  // ---------------------------------------------------------------------------
  // Panel placement
  // ---------------------------------------------------------------------------

  function positionPanel() {
    const panel = document.getElementById(PANEL_ID);

    if (!panel || !buttonPosition) return;

    const { width: viewportWidth, height: viewportHeight } = getViewport();

    const buttonBottom = buttonPosition.top + BUTTON_SIZE;

    const spaceBelow =
      viewportHeight - buttonBottom - PANEL_GAP - EDGE_MARGIN;

    const spaceAbove =
      buttonPosition.top - PANEL_GAP - EDGE_MARGIN;

    const placeBelow =
      spaceBelow >= MIN_PANEL_HEIGHT || spaceBelow >= spaceAbove;

    const available = Math.max(
      MIN_PANEL_HEIGHT,
      placeBelow ? spaceBelow : spaceAbove
    );

    panel.style.maxHeight = `${Math.round(
      Math.min(available, viewportHeight - EDGE_MARGIN * 2)
    )}px`;

    // Read after the max-height write so the measurement is current.
    const panelWidth = panel.offsetWidth || DEFAULT_PANEL_WIDTH;
    const panelHeight = panel.offsetHeight || MIN_PANEL_HEIGHT;

    const alignRight =
      buttonPosition.left + BUTTON_SIZE / 2 > viewportWidth / 2;

    const maxLeft = Math.max(
      EDGE_MARGIN,
      viewportWidth - panelWidth - EDGE_MARGIN
    );

    let left = alignRight
      ? buttonPosition.left + BUTTON_SIZE - panelWidth
      : buttonPosition.left;

    left = Math.min(Math.max(left, EDGE_MARGIN), maxLeft);

    const maxTop = Math.max(
      EDGE_MARGIN,
      viewportHeight - panelHeight - EDGE_MARGIN
    );

    let top = placeBelow
      ? buttonBottom + PANEL_GAP
      : buttonPosition.top - PANEL_GAP - panelHeight;

    top = Math.min(Math.max(top, EDGE_MARGIN), maxTop);

    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;

    panel.style.transformOrigin =
      `${placeBelow ? 'top' : 'bottom'} ${alignRight ? 'right' : 'left'}`;
  }

  // ---------------------------------------------------------------------------
  // Dragging and tapping
  //
  // Mouse: press and move 5px to drag; a plain click toggles.
  // Touch / pen: hold 250 ms (the button lifts), then move to drag. A touch
  // that moves before the hold finishes is treated as a swipe and ignored.
  // Taps are handled here on pointerup, because some phones drop the
  // browser's own click after a long press.
  // ---------------------------------------------------------------------------

  function clearHoldTimer(state) {
    if (state && state.holdTimer) {
      clearTimeout(state.holdTimer);
      state.holdTimer = null;
    }
  }

  function handleDragStart(event) {
    if (event.isPrimary === false) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (!buttonPosition) return;

    clearHoldTimer(dragState);

    const button = event.currentTarget;
    const touchLike = event.pointerType !== 'mouse';

    const state = {
      pointerId: event.pointerId,
      touchLike,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      originLeft: buttonPosition.left,
      originTop: buttonPosition.top,
      armed: !touchLike,
      cancelled: false,
      moved: false,
      holdTimer: null
    };

    if (touchLike) {
      state.holdTimer = setTimeout(() => {
        state.holdTimer = null;

        if (dragState !== state || state.cancelled) return;

        state.armed = true;

        // Measure the drag from where the finger is now, so any wobble
        // during the hold doesn't make the button jump.
        state.startX = state.lastX;
        state.startY = state.lastY;

        button.classList.add('dragging');

        try {
          if (navigator.vibrate) navigator.vibrate(8);
        } catch (error) {
          // Haptics are optional.
        }
      }, TOUCH_HOLD_MS);
    }

    dragState = state;

    try {
      button.setPointerCapture(event.pointerId);
    } catch (error) {
      // Capture is a nicety; window listeners still track the pointer.
    }
  }

  function handleDragMove(event) {
    const state = dragState;

    if (!state || event.pointerId !== state.pointerId) return;
    if (state.cancelled) return;

    state.lastX = event.clientX;
    state.lastY = event.clientY;

    const deltaX = event.clientX - state.startX;
    const deltaY = event.clientY - state.startY;

    if (!state.moved) {
      const distance = Math.max(Math.abs(deltaX), Math.abs(deltaY));

      if (!state.armed) {
        // A touch that travels before the hold finishes is a swipe.
        if (distance > TOUCH_SLOP) {
          state.cancelled = true;
          clearHoldTimer(state);
        }

        return;
      }

      const threshold = state.touchLike ? 2 : MOUSE_DRAG_THRESHOLD;

      if (distance < threshold) return;

      state.moved = true;

      const button = document.getElementById(TOGGLE_ID);

      if (button) {
        button.classList.add('dragging');
      }

      document.body.classList.add('tm-outline-dragging');
    }

    if (event.cancelable) {
      event.preventDefault();
    }

    buttonPosition = clampPosition({
      left: state.originLeft + deltaX,
      top: state.originTop + deltaY
    });

    if (dragFrame) return;

    dragFrame = requestAnimationFrame(() => {
      dragFrame = null;
      applyButtonPosition();

      if (panelVisible) {
        positionPanel();
      }
    });
  }

  function handleDragEnd(event) {
    const state = dragState;

    if (!state || event.pointerId !== state.pointerId) return;

    dragState = null;
    clearHoldTimer(state);

    if (dragFrame) {
      cancelAnimationFrame(dragFrame);
      dragFrame = null;
    }

    const button = document.getElementById(TOGGLE_ID);

    if (button) {
      button.classList.remove('dragging');

      try {
        if (button.hasPointerCapture(state.pointerId)) {
          button.releasePointerCapture(state.pointerId);
        }
      } catch (error) {
        // Nothing to release.
      }
    }

    document.body.classList.remove('tm-outline-dragging');

    if (state.moved) {
      // Swallow the click that fires right after a drag.
      suppressClickUntil = performance.now() + CLICK_SUPPRESS_MS;

      anchor = positionToAnchor(buttonPosition);
      writeAnchor(anchor);
      fitButtonToWindow();

      if (panelVisible) {
        positionPanel();
      }

      return;
    }

    // Mouse clicks and keyboard presses go through the normal click event.
    if (!state.touchLike) return;

    // Touch / pen: this pointerup is the tap. Ignore the click that follows.
    suppressClickUntil = performance.now() + CLICK_SUPPRESS_MS;

    if (state.cancelled || event.type !== 'pointerup') return;

    const now = performance.now();

    if (now - lastTapTime < DOUBLE_TAP_MS) {
      // Double-tap: undo the first tap's toggle and reset the spot.
      lastTapTime = 0;
      togglePanel();
      resetPosition();
      return;
    }

    lastTapTime = now;
    togglePanel();
  }

  // ---------------------------------------------------------------------------
  // UI creation
  // ---------------------------------------------------------------------------

  function createToggleButton() {
    if (document.getElementById(TOGGLE_ID)) return;

    const button = document.createElement('button');

    button.id = TOGGLE_ID;
    button.type = 'button';

    button.title =
      'Outline (Ctrl/Cmd + Shift + O)\n' +
      'Drag to move (hold first on touch). Double-click to reset.';

    button.setAttribute('aria-label', 'Toggle chat outline');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', PANEL_ID);

    button.innerHTML = TOGGLE_ICON;

    // Place it before it ever paints.
    button.style.left = `${buttonPosition.left}px`;
    button.style.top = `${buttonPosition.top}px`;

    button.addEventListener('pointerdown', handleDragStart);
    button.addEventListener('click', handleToggleClick);
    button.addEventListener('dblclick', handleToggleDoubleClick);

    // A long press must not open the phone's context menu or callout.
    button.addEventListener('contextmenu', (event) => {
      event.preventDefault();
    });

    document.body.appendChild(button);
  }

  function createPanel() {
    if (document.getElementById(PANEL_ID)) return;

    const panel = document.createElement('nav');

    panel.id = PANEL_ID;
    panel.setAttribute('aria-label', 'Chat outline');

    panel.innerHTML = `
      <div class="outline-header">
        <span class="outline-title">Outline</span>
        <span class="outline-count"></span>
      </div>
      <ul class="outline-list"></ul>
    `;

    const list = panel.querySelector('.outline-list');

    // One delegated listener for every item, so items can be reused.
    list.addEventListener('click', handleListClick);
    list.addEventListener('keydown', handleListKeydown);
    list.addEventListener('scroll', handleListScroll, { passive: true });

    // Drag the open panel to the right to close it.
    panel.addEventListener('touchstart', handlePanelSwipeStart, { passive: true });
    panel.addEventListener('touchmove', handlePanelSwipeMove, { passive: true });
    panel.addEventListener('touchend', handlePanelSwipeEnd, { passive: true });
    panel.addEventListener('touchcancel', handlePanelSwipeEnd, { passive: true });

    document.body.appendChild(panel);

    positionPanel();
  }

  // ---------------------------------------------------------------------------
  // Chat detection
  // ---------------------------------------------------------------------------

  function isOnChatPage() {
    const chatSignals = [
      CHAT_SCROLLER_SELECTOR,
      CHAT_SPACE_SELECTOR,
      '[data-element-id="chat-input-textbox"]',
      USER_MESSAGE_SELECTOR,
      AI_RESPONSE_SELECTOR,
      'textarea[placeholder*="message" i]'
    ];

    const hasChat = chatSignals.some((selector) => {
      return Boolean(document.querySelector(selector));
    });

    if (!hasChat) return false;

    if (window.innerWidth <= 768) {
      const sidebarSelectors = [
        '[data-element-id="side-bar"]',
        '[data-element-id="sidebar"]',
        '[data-element-id="side-bar-background"]',
        '[data-element-id="sidebar-background"]'
      ];

      for (const selector of sidebarSelectors) {
        const sidebar = document.querySelector(selector);

        if (!sidebar) continue;

        const rect = sidebar.getBoundingClientRect();

        if (
          rect.width > 100 &&
          rect.right > 0 &&
          rect.left < window.innerWidth
        ) {
          return false;
        }
      }
    }

    return true;
  }

  function updateButtonVisibility() {
    const button = document.getElementById(TOGGLE_ID);

    if (!button) return;

    // Never yank the button out from under an active drag.
    if (dragState) return;

    onChatPage = isOnChatPage();

    // Unpinned in TypingMind's chat menu: the button stays hidden, but the
    // swipe and the shortcut still work.
    button.classList.toggle('chat-visible', onChatPage && buttonPinned);

    if (!onChatPage && panelVisible) {
      setPanelVisibility(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Panel controls
  // ---------------------------------------------------------------------------

  // Put the panel in its start pose without animating, so the next open or
  // close moves from the right place. fromEdge picks the slide-from-the-right
  // pose that swipes use; otherwise the panel grows out of the button.
  function resetPanelPose(fromEdge) {
    if (poseTimer) {
      clearTimeout(poseTimer);
      poseTimer = null;
    }

    const panel = document.getElementById(PANEL_ID);

    if (!panel) return;

    const settled =
      !panel.classList.contains('tracking') &&
      !panel.classList.contains('swipe-closing') &&
      !panel.style.transform &&
      !panel.style.opacity &&
      panel.classList.contains('from-edge') === fromEdge;

    if (settled) return;

    panel.classList.add('no-anim');
    panel.classList.remove('tracking', 'swipe-closing');
    panel.classList.toggle('from-edge', fromEdge);
    panel.style.transform = '';
    panel.style.opacity = '';

    // Commit the pose before transitions come back on.
    void panel.offsetWidth;

    panel.classList.remove('no-anim');
  }

  function setPanelVisibility(visible, options = {}) {
    if (!options.keepPose) {
      cancelPanelSwipe();
      resetPanelPose(Boolean(options.fromEdge));
    }

    panelVisible = visible;

    const panel = document.getElementById(PANEL_ID);
    const button = document.getElementById(TOGGLE_ID);

    if (panel) {
      panel.classList.toggle('visible', visible);
    }

    if (button) {
      button.classList.toggle('active', visible);
      button.setAttribute('aria-expanded', String(visible));
    }

    if (visible) {
      refreshOutline();
      positionPanel();
    } else if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
      refreshPendingSince = 0;
    }
  }

  function togglePanel() {
    setPanelVisibility(!panelVisible);
  }

  function handleToggleClick(event) {
    if (performance.now() < suppressClickUntil) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    togglePanel();
  }

  function handleToggleDoubleClick(event) {
    event.preventDefault();
    resetPosition();
  }

  // ---------------------------------------------------------------------------
  // Swipe gestures (touch only)
  //
  // Open: swipe left anywhere on the chat; a quick flick works too. It does
  // not depend on the screen edge, where Android's Back swipe lives.
  // Close: drag the open panel to the right. It follows the finger, then
  // slides away, or springs back if you let go early.
  //
  // Every listener is passive, so none of this can hold up scrolling.
  // ---------------------------------------------------------------------------

  function vibrate(duration) {
    try {
      if (navigator.vibrate) navigator.vibrate(duration);
    } catch (error) {
      // Haptics are optional.
    }
  }

  // Content that scrolls sideways (wide code blocks, tables, the model
  // rail) keeps its own swipe.
  function insideSidewaysScroller(element) {
    let node = element;

    while (
      node &&
      node !== document.body &&
      node !== document.documentElement
    ) {
      if (node.scrollWidth > node.clientWidth + 1) {
        const overflowX = getComputedStyle(node).overflowX;

        if (
          overflowX === 'auto' ||
          overflowX === 'scroll' ||
          overflowX === 'overlay'
        ) {
          return true;
        }
      }

      node = node.parentElement;
    }

    return false;
  }

  function hasTextSelection() {
    try {
      const selection = window.getSelection();

      return Boolean(
        selection &&
        !selection.isCollapsed &&
        String(selection).trim()
      );
    } catch (error) {
      return false;
    }
  }

  function openFromSwipe() {
    if (panelVisible) return;

    // The finger lifting can land as a click outside the panel; ignore it.
    suppressOutsideCloseUntil = performance.now() + CLICK_SUPPRESS_MS;

    setPanelVisibility(true, { fromEdge: true });
    vibrate(8);
  }

  function handleChatSwipeStart(event) {
    chatSwipe = null;

    if (event.touches.length !== 1) return;
    if (panelVisible || dragState) return;

    // Works with the button hidden too; only the chat page matters.
    if (!onChatPage) return;

    const target = event.target instanceof Element ? event.target : null;

    if (!target || target.closest(SWIPE_EXCLUDE_SELECTOR)) return;

    const touch = event.touches[0];
    const now = performance.now();

    chatSwipe = {
      target,
      startX: touch.clientX,
      startY: touch.clientY,
      startTime: now,
      lastX: touch.clientX,
      lastTime: now,
      speed: 0,
      committed: false
    };
  }

  function handleChatSwipeMove(event) {
    const swipe = chatSwipe;

    if (!swipe) return;

    if (event.touches.length !== 1) {
      chatSwipe = null;
      return;
    }

    const touch = event.touches[0];
    const now = performance.now();
    const deltaX = touch.clientX - swipe.startX;
    const deltaY = touch.clientY - swipe.startY;

    if (!swipe.committed) {
      const distance = Math.max(Math.abs(deltaX), Math.abs(deltaY));

      if (distance < SWIPE_DECIDE_PX) return;

      const leftward =
        deltaX < 0 && Math.abs(deltaX) > Math.abs(deltaY) * SWIPE_RATIO;

      // Scrolling, a slow drag, selecting text or a sideways scroller:
      // not ours.
      if (
        !leftward ||
        now - swipe.startTime > SWIPE_DECIDE_MS ||
        panelVisible ||
        hasTextSelection() ||
        insideSidewaysScroller(swipe.target)
      ) {
        chatSwipe = null;
        return;
      }

      swipe.committed = true;
    }

    swipe.speed = (swipe.lastX - touch.clientX) / Math.max(1, now - swipe.lastTime);
    swipe.lastX = touch.clientX;
    swipe.lastTime = now;

    if (
      -deltaX >= SWIPE_OPEN_PX &&
      Math.abs(deltaX) > Math.abs(deltaY) * SWIPE_RATIO
    ) {
      chatSwipe = null;
      openFromSwipe();
    }
  }

  function handleChatSwipeEnd(event) {
    const swipe = chatSwipe;

    chatSwipe = null;

    if (!swipe || !swipe.committed || event.type !== 'touchend') return;

    // A short swipe still opens if it was quick.
    const touch = event.changedTouches && event.changedTouches[0];
    const deltaX = (touch ? touch.clientX : swipe.lastX) - swipe.startX;
    const deltaY = (touch ? touch.clientY : swipe.startY) - swipe.startY;
    const averageSpeed =
      -deltaX / Math.max(1, performance.now() - swipe.startTime);

    if (
      -deltaX >= SWIPE_FLICK_PX &&
      Math.abs(deltaX) > Math.abs(deltaY) * SWIPE_RATIO &&
      Math.max(averageSpeed, swipe.speed) >= SWIPE_FLICK_SPEED
    ) {
      openFromSwipe();
    }
  }

  function handlePanelSwipeStart(event) {
    cancelPanelSwipe();

    if (!panelVisible || event.touches.length !== 1) return;

    const touch = event.touches[0];
    const now = performance.now();

    panelSwipe = {
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      lastTime: now,
      speed: 0,
      offset: 0,
      committed: false,
      past: false
    };
  }

  function handlePanelSwipeMove(event) {
    const swipe = panelSwipe;

    if (!swipe) return;

    if (event.touches.length !== 1 || !panelVisible) {
      cancelPanelSwipe();
      return;
    }

    const touch = event.touches[0];
    const now = performance.now();
    const deltaX = touch.clientX - swipe.startX;
    const deltaY = touch.clientY - swipe.startY;

    if (!swipe.committed) {
      const distance = Math.max(Math.abs(deltaX), Math.abs(deltaY));

      if (distance < SWIPE_DECIDE_PX) return;

      // Up and down is the list scrolling. Only a drag to the right closes.
      if (!(deltaX > 0 && Math.abs(deltaX) > Math.abs(deltaY) * SWIPE_RATIO)) {
        panelSwipe = null;
        return;
      }

      swipe.committed = true;

      const panel = document.getElementById(PANEL_ID);

      if (panel) {
        panel.classList.add('tracking');
      }
    }

    swipe.speed = (touch.clientX - swipe.lastX) / Math.max(1, now - swipe.lastTime);
    swipe.lastX = touch.clientX;
    swipe.lastTime = now;
    swipe.offset = Math.max(0, deltaX);

    // A light tick once the drag is far enough to close on release.
    const past = swipe.offset >= SWIPE_CLOSE_PX;

    if (past && !swipe.past) {
      vibrate(6);
    }

    swipe.past = past;

    if (panelSwipeFrame) return;

    panelSwipeFrame = requestAnimationFrame(() => {
      panelSwipeFrame = null;

      const current = panelSwipe;
      const panel = document.getElementById(PANEL_ID);

      if (!current || !current.committed || !panel) return;

      // Stays solid while it follows the finger, so it never turns
      // see-through over the chat; it only eases off past the close point.
      const beyond = Math.max(0, current.offset - SWIPE_CLOSE_PX);

      panel.style.transform = `translateX(${Math.round(current.offset)}px)`;
      panel.style.opacity = String(
        Math.max(0.7, 1 - beyond / 400).toFixed(3)
      );
    });
  }

  function handlePanelSwipeEnd(event) {
    const swipe = panelSwipe;

    if (!swipe || !swipe.committed) {
      panelSwipe = null;
      return;
    }

    const quick =
      swipe.speed >= SWIPE_FLICK_SPEED &&
      swipe.offset >= SWIPE_CLOSE_FLICK_PX;

    if (
      event.type === 'touchend' &&
      (swipe.offset >= SWIPE_CLOSE_PX || quick)
    ) {
      panelSwipe = null;

      if (panelSwipeFrame) {
        cancelAnimationFrame(panelSwipeFrame);
        panelSwipeFrame = null;
      }

      closeFromSwipe(swipe.offset);
      return;
    }

    // Let go early: spring back into place.
    cancelPanelSwipe();
  }

  // Ends a panel drag and, if the panel had moved, lets it ease back.
  function cancelPanelSwipe() {
    const swipe = panelSwipe;

    panelSwipe = null;

    if (panelSwipeFrame) {
      cancelAnimationFrame(panelSwipeFrame);
      panelSwipeFrame = null;
    }

    if (!swipe || !swipe.committed) return;

    const panel = document.getElementById(PANEL_ID);

    if (!panel) return;

    panel.classList.remove('tracking');
    panel.style.transform = '';
    panel.style.opacity = '';
  }

  function closeFromSwipe(offset) {
    const panel = document.getElementById(PANEL_ID);

    if (!panel) {
      setPanelVisibility(false);
      return;
    }

    // Carry on from where the finger left it and slide out to the right.
    panel.classList.remove('tracking');
    panel.classList.add('swipe-closing');
    panel.style.transform = `translateX(${Math.round(offset + 56)}px)`;
    panel.style.opacity = '0';

    setPanelVisibility(false, { keepPose: true });

    // Once it's out of sight, put the pose back for the next open.
    poseTimer = setTimeout(() => {
      poseTimer = null;
      resetPanelPose(false);
    }, SWIPE_RESET_MS);
  }

  // ---------------------------------------------------------------------------
  // "Outline" row in TypingMind's chat menu
  //
  // The chevron at the top right of a chat opens TypingMind's menu of chat
  // actions (Search in chat, Share, Reset chat and so on), each with a pin.
  // This adds an "Outline" row to that menu. Its pin decides whether the
  // floating button shows: pinned shows it, unpinned hides it. The swipe and
  // the shortcut open the outline either way, and tapping the row opens it
  // too. The choice is saved on each device.
  //
  // TypingMind gives this menu no stable ids, so it is found by its labels,
  // and the row is a copy of one of TypingMind's own rows, so it looks the
  // same, pin icon included. If an update renames those labels, the row
  // just stops showing up; __tmPageOutline.setPinned(true) in a desktop
  // console brings the button back.
  // ---------------------------------------------------------------------------

  function loadPinned() {
    try {
      return localStorage.getItem(PIN_STORAGE_KEY) !== '0';
    } catch (error) {
      return true;
    }
  }

  function setPinned(value) {
    buttonPinned = Boolean(value);

    try {
      localStorage.setItem(PIN_STORAGE_KEY, buttonPinned ? '1' : '0');
    } catch (error) {
      console.debug('[Page Outline] Could not save the pin setting.', error);
    }

    updateButtonVisibility();
    renderMenuPin();
  }

  // Remembers the last thing pressed, so the button that opened the menu
  // can be pressed again to close it if nothing else does.
  function rememberPress(event) {
    if (event.target instanceof Element) {
      lastPress = { element: event.target, time: performance.now() };
    }
  }

  function menuRowReady() {
    return Boolean(
      menuRow &&
      menuRow.row.isConnected &&
      menuRow.list.isConnected
    );
  }

  // Checks newly added nodes for TypingMind's chat menu.
  function scanForChatMenu(nodes) {
    for (const node of nodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      if (node.closest(MENU_SKIP_SELECTOR)) continue;

      const text = node.textContent;

      if (!text || text.length > 20000) continue;
      if (!MENU_MARKERS.some((label) => text.includes(label))) continue;

      if (attachToChatMenu(node)) return true;
    }

    return false;
  }

  // The menu may already be on the page when the script starts.
  function scanPageForChatMenu() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let seen = 0;

    while (walker.nextNode()) {
      seen += 1;

      if (seen > 200000) return;

      const node = walker.currentNode;

      if (!MENU_MARKERS.includes(node.nodeValue.trim())) continue;

      const element = node.parentElement;

      if (!element || element.closest(MENU_SKIP_SELECTOR)) continue;
      if (attachToChatMenu(element)) return;
    }
  }

  // From somewhere inside the menu, climb until an element holds its rows.
  function attachToChatMenu(start) {
    let scope = start;

    for (let depth = 0; scope && depth < 8; depth += 1) {
      if (scope === document.body || scope === document.documentElement) {
        break;
      }

      const found = findMenuRows(scope);

      if (found) {
        addMenuRow(found);
        return true;
      }

      scope = scope.parentElement;
    }

    return false;
  }

  function findMenuRows(scope) {
    const labelNodes = [];
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    let seen = 0;

    while (walker.nextNode()) {
      seen += 1;

      // Far too much text to be a small menu.
      if (seen > 400) return null;

      if (MENU_LABELS.includes(walker.currentNode.nodeValue.trim())) {
        labelNodes.push(walker.currentNode);
      }
    }

    if (labelNodes.length < 3) return null;

    // A row is the largest element that holds only its own label.
    const rows = labelNodes.map((textNode) => {
      let row = textNode.parentElement;

      while (
        row !== scope &&
        row.parentElement &&
        !labelNodes.some((other) => {
          return other !== textNode && row.parentElement.contains(other);
        })
      ) {
        row = row.parentElement;
      }

      return { label: textNode.nodeValue.trim(), row };
    });

    // Rows that share a parent form the list.
    const groups = new Map();

    for (const entry of rows) {
      const parent = entry.row.parentElement;

      if (!parent) continue;

      if (!groups.has(parent)) {
        groups.set(parent, []);
      }

      groups.get(parent).push(entry);
    }

    let list = null;
    let listRows = [];

    for (const [parent, members] of groups) {
      if (members.length > listRows.length) {
        list = parent;
        listRows = members;
      }
    }

    if (!list || listRows.length < 2) return null;

    // Every TypingMind row has an icon and a pin.
    const looksRight = listRows.every((entry) => {
      return entry.row.querySelectorAll('svg').length >= 2;
    });

    return looksRight ? { list, rows: listRows } : null;
  }

  // The pin is the last icon in a row; its control is the button around it.
  function findRowPin(row) {
    const icons = row.querySelectorAll('svg');

    if (icons.length < 2) return null;

    const svg = icons[icons.length - 1];
    let control = svg.closest('button, [role="button"]');

    if (
      !control ||
      control === row ||
      !row.contains(control) ||
      control.contains(icons[0])
    ) {
      const parent = svg.parentElement;

      control =
        parent && parent !== row && !parent.contains(icons[0])
          ? parent
          : svg;
    }

    return { svg, control };
  }

  // TypingMind shows a filled pin for pinned actions and an outline pin
  // for the rest.
  function svgLooksFilled(svg) {
    const shapes = svg.querySelectorAll(
      'path, circle, rect, polygon, ellipse'
    );

    for (const shape of shapes) {
      // The invisible sizing box some icon sets include.
      if (
        shape.getAttribute('stroke') === 'none' &&
        shape.getAttribute('fill') === 'none'
      ) {
        continue;
      }

      const fill = getComputedStyle(shape).fill;

      if (
        fill &&
        fill !== 'none' &&
        fill !== 'transparent' &&
        !/rgba\([^)]*,\s*0\)$/.test(fill)
      ) {
        return true;
      }
    }

    return false;
  }

  function collectPinSamples(rows) {
    const samples = { pinned: null, unpinned: null };

    for (const { row } of rows) {
      const pin = findRowPin(row);

      if (!pin) continue;

      const sample = {
        svg: pin.svg.cloneNode(true),
        controlClass:
          pin.control !== pin.svg ? pin.control.getAttribute('class') : null,
        tooltip: pin.control.getAttribute('data-tooltip-content'),
        tooltipId: pin.control.getAttribute('data-tooltip-id'),
        title: pin.control.getAttribute('title')
      };

      if (svgLooksFilled(pin.svg)) {
        samples.pinned = samples.pinned || sample;
      } else {
        samples.unpinned = samples.unpinned || sample;
      }
    }

    return samples;
  }

  // Strip what would tie the copy to the row it came from.
  function cleanClone(row) {
    const attributes = [
      'id',
      'aria-controls',
      'aria-labelledby',
      'aria-describedby',
      'aria-checked',
      'aria-selected',
      'data-headlessui-state',
      'data-active',
      'data-focus',
      'data-hover',
      'data-selected',
      'data-highlighted',
      'data-tooltip-id',
      'data-tooltip-content'
    ];

    for (const element of [row, ...row.querySelectorAll('*')]) {
      for (const name of attributes) {
        element.removeAttribute(name);
      }
    }
  }

  function replaceLabel(row, oldLabel, newLabel) {
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);

    while (walker.nextNode()) {
      const node = walker.currentNode;

      if (node.nodeValue.trim() === oldLabel) {
        node.nodeValue = node.nodeValue.replace(oldLabel, newLabel);
        break;
      }
    }

    for (const element of [row, ...row.querySelectorAll('[title], [aria-label]')]) {
      for (const name of ['title', 'aria-label']) {
        const value = element.getAttribute(name);

        if (value && value.includes(oldLabel)) {
          element.setAttribute(name, value.replace(oldLabel, newLabel));
        }
      }
    }
  }

  function createSvg(like, extra) {
    const svg = document.createElementNS(SVG_NS, 'svg');

    for (const name of ['class', 'width', 'height', 'style']) {
      const value = like && like.getAttribute(name);

      if (value) {
        svg.setAttribute(name, value);
      }
    }

    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute(
      'stroke-width',
      (like && like.getAttribute('stroke-width')) || '2'
    );
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');

    for (const [name, value] of Object.entries(extra || {})) {
      svg.setAttribute(name, value);
    }

    return svg;
  }

  // The outline icon, sized and stroked like the icon it replaces.
  function makeMenuIcon(like) {
    const svg = createSvg(like, { fill: 'none' });

    for (const [x1, y, x2] of [[4, 6, 20], [4, 12, 15], [4, 18, 11]]) {
      const line = document.createElementNS(SVG_NS, 'line');

      line.setAttribute('x1', String(x1));
      line.setAttribute('y1', String(y));
      line.setAttribute('x2', String(x2));
      line.setAttribute('y2', String(y));
      svg.appendChild(line);
    }

    return svg;
  }

  // Only used when TypingMind's menu has no pin in the state we need.
  function makeFallbackPin(pinned, like) {
    const svg = createSvg(like, { fill: 'none' });
    const head = document.createElementNS(SVG_NS, 'path');
    const needle = document.createElementNS(SVG_NS, 'path');

    head.setAttribute('d', 'M9 4h6l-1 5l3 3v2H7v-2l3-3z');
    head.setAttribute('fill', pinned ? 'currentColor' : 'none');
    needle.setAttribute('d', 'M12 14v6');

    svg.append(head, needle);

    return svg;
  }

  function findMenuTrigger(list) {
    const outsideUs = (element) => {
      return (
        element &&
        element.isConnected &&
        !list.contains(element) &&
        !element.closest(`#${PANEL_ID}, #${TOGGLE_ID}`)
      );
    };

    // Whatever was pressed just before the menu appeared.
    if (
      lastPress &&
      performance.now() - lastPress.time < MENU_TRIGGER_WINDOW_MS &&
      outsideUs(lastPress.element)
    ) {
      return (
        lastPress.element.closest('button, [role="button"], a') ||
        lastPress.element
      );
    }

    // Or a button that says it has a menu open.
    const expanded = document.querySelectorAll(
      '[aria-haspopup][aria-expanded="true"], button[aria-expanded="true"]'
    );

    for (const element of expanded) {
      if (outsideUs(element)) return element;
    }

    return null;
  }

  function addMenuRow({ list, rows }) {
    list
      .querySelectorAll(`[${MENU_ROW_ATTR}]`)
      .forEach((node) => node.remove());

    const template =
      rows.find((entry) => entry.label === 'Toggle select mode') ||
      rows[rows.length - 1];

    const row = template.row.cloneNode(true);

    cleanClone(row);
    row.setAttribute(MENU_ROW_ATTR, 'outline');
    replaceLabel(row, template.label, 'Outline');

    const pin = findRowPin(row);
    const icon = row.querySelector('svg');

    if (icon && (!pin || icon !== pin.svg)) {
      icon.replaceWith(makeMenuIcon(icon));
    }

    // Right under "Search in chat", the other way to find your way around.
    const after = rows.find((entry) => entry.label === 'Search in chat');

    if (after && after.row.parentElement === list) {
      after.row.after(row);
    } else {
      list.appendChild(row);
    }

    row.addEventListener('click', handleMenuRowClick);

    menuRow = {
      list,
      row,
      pin,
      samples: collectPinSamples(rows),
      rows,
      trigger: findMenuTrigger(list)
    };

    renderMenuPin();
  }

  // Shows the pin filled or outlined to match the button's state, using
  // TypingMind's own pin icons.
  function renderMenuPin() {
    if (!menuRowReady() || !menuRow.pin) return;

    const { pin } = menuRow;
    const want = buttonPinned ? 'pinned' : 'unpinned';

    if (!menuRow.samples[want]) {
      menuRow.samples = collectPinSamples(
        menuRow.rows.filter((entry) => entry.row.isConnected)
      );
    }

    const sample = menuRow.samples[want];
    const next = sample
      ? sample.svg.cloneNode(true)
      : makeFallbackPin(buttonPinned, pin.svg);

    const controlIsIcon = pin.control === pin.svg;

    pin.svg.replaceWith(next);
    pin.svg = next;

    if (controlIsIcon) {
      pin.control = next;
    } else if (sample && sample.controlClass !== null) {
      pin.control.setAttribute('class', sample.controlClass);
    }

    const copied = [
      ['data-tooltip-content', sample && sample.tooltip],
      ['data-tooltip-id', sample && sample.tooltipId],
      ['title', sample && sample.title]
    ];

    for (const [name, value] of copied) {
      if (value) {
        pin.control.setAttribute(name, value);
      } else {
        pin.control.removeAttribute(name);
      }
    }

    pin.control.setAttribute(MENU_PIN_ATTR, '');
    pin.control.setAttribute(
      'aria-label',
      buttonPinned ? 'Hide the outline button' : 'Show the outline button'
    );

    if (pin.control instanceof HTMLElement) {
      pin.control.setAttribute('aria-pressed', String(buttonPinned));
    }
  }

  function handleMenuRowClick(event) {
    const target = event.target instanceof Element ? event.target : null;

    // The pin shows or hides the button and leaves the menu open.
    if (target && target.closest(`[${MENU_PIN_ATTR}]`)) {
      event.preventDefault();
      event.stopPropagation();
      setPinned(!buttonPinned);
      return;
    }

    // The row opens the outline. The click carries on to TypingMind, so a
    // menu that closes itself on a tap still does.
    const menu = menuRow;

    suppressOutsideCloseUntil = performance.now() + MENU_CLOSE_GRACE_MS;

    requestAnimationFrame(() => {
      if (menu && menu.list.isConnected) {
        closeChatMenu(menu);
      }

      suppressOutsideCloseUntil = performance.now() + MENU_CLOSE_GRACE_MS;

      if (!panelVisible) {
        setPanelVisibility(true);
      }
    });
  }

  function sendEvent(target, type, Constructor, init) {
    try {
      const event = new Constructor(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        ...init
      });

      if (type === 'keydown') {
        Object.defineProperty(event, 'keyCode', { get: () => 27 });
        Object.defineProperty(event, 'which', { get: () => 27 });
      }

      target.dispatchEvent(event);
    } catch (error) {
      // Older browsers: skip this way of closing.
    }
  }

  // TypingMind's menu has no close call we can reach, so close it the way a
  // person would: Escape, then a tap outside it, then, if it is somehow
  // still open, the button that opened it.
  function closeChatMenu(menu) {
    const { list } = menu;
    const point = { clientX: 0, clientY: 0, button: 0, view: window };
    const pointer = { ...point, pointerType: 'mouse', isPrimary: true };

    sendEvent(list, 'keydown', KeyboardEvent, { key: 'Escape', code: 'Escape' });

    if (window.PointerEvent) {
      sendEvent(document.body, 'pointerdown', PointerEvent, pointer);
    }

    sendEvent(document.body, 'mousedown', MouseEvent, point);

    if (window.PointerEvent) {
      sendEvent(document.body, 'pointerup', PointerEvent, pointer);
    }

    sendEvent(document.body, 'mouseup', MouseEvent, point);
    sendEvent(document.body, 'click', MouseEvent, point);

    setTimeout(() => {
      const trigger = menu.trigger;

      if (!list.isConnected || !trigger || !trigger.isConnected) return;
      if (list.contains(trigger)) return;
      if (trigger.getAttribute('aria-expanded') === 'false') return;

      suppressOutsideCloseUntil = performance.now() + MENU_CLOSE_GRACE_MS;
      trigger.click();
    }, MENU_FALLBACK_CLOSE_MS);
  }

  // ---------------------------------------------------------------------------
  // Chat container
  // ---------------------------------------------------------------------------

  function containsMessages(element) {
    return Boolean(
      element.querySelector(`${USER_MESSAGE_SELECTOR}, ${AI_RESPONSE_SELECTOR}`)
    );
  }

  function getChatContainer() {
    for (const selector of [CHAT_SCROLLER_SELECTOR, CHAT_SPACE_SELECTOR]) {
      const element = document.querySelector(selector);

      if (element && containsMessages(element)) {
        return element;
      }
    }

    // Unknown layout: climb from the first message to the element that
    // holds more than one message.
    const firstMessage = document.querySelector(
      `${USER_MESSAGE_SELECTOR}, ${AI_RESPONSE_SELECTOR}`
    );

    if (!firstMessage) return null;

    let parent = firstMessage.parentElement;

    while (parent && parent !== document.body) {
      if (
        parent.querySelectorAll(
          `${USER_MESSAGE_SELECTOR}, ${AI_RESPONSE_SELECTOR}`
        ).length > 1
      ) {
        return parent;
      }

      parent = parent.parentElement;
    }

    return document.body;
  }

  // ---------------------------------------------------------------------------
  // General helpers
  // ---------------------------------------------------------------------------

  function normalizeText(value) {
    return String(value || '')
      .replace(/[​-‍﻿]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function shortenText(value, maximumLength = PROMPT_PREVIEW_LENGTH) {
    const text = normalizeText(value);

    if (text.length <= maximumLength) {
      return text;
    }

    return `${text.slice(0, maximumLength - 1).trim()}…`;
  }

  function plural(count, word) {
    return `${count} ${word}${count === 1 ? '' : 's'}`;
  }

  function isRendered(element) {
    if (!element || !element.isConnected) return false;

    // Cheap layout test first; display:none elements have no boxes.
    if (element.getClientRects().length === 0) return false;

    return getComputedStyle(element).visibility !== 'hidden';
  }

  function getNodeId(element) {
    if (!nodeIds.has(element)) {
      nodeIds.set(element, nextNodeId++);
    }

    return nodeIds.get(element);
  }

  function prefersReducedMotion() {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (error) {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Thinking block detection
  // ---------------------------------------------------------------------------

  function isInsideThinkingBlock(heading) {
    // A heading never moves between containers, so the answer is stable.
    const cached = thinkingCache.get(heading);

    if (cached !== undefined) return cached;

    const result = detectThinkingBlock(heading);

    thinkingCache.set(heading, result);

    return result;
  }

  function detectThinkingBlock(heading) {
    // Fast path: known thinking / reasoning containers.
    if (heading.closest(THINKING_BLOCK_SELECTOR)) {
      return true;
    }

    // Fallback: walk up to the response root looking for a wrapper
    // whose direct toggle label reads like "Thought for 12 seconds",
    // "Thinking...", "Reasoning", etc.
    const response = heading.closest(AI_RESPONSE_SELECTOR);
    let node = heading.parentElement;

    while (
      node &&
      node !== response &&
      node !== document.body
    ) {
      const label = node.querySelector(
        ':scope > summary, :scope > button, :scope > [role="button"]'
      );

      if (label) {
        const labelText = normalizeText(
          label.textContent
        ).slice(0, 80);

        if (THINKING_LABEL_PATTERN.test(labelText)) {
          return true;
        }
      }

      node = node.parentElement;
    }

    return false;
  }

  // ---------------------------------------------------------------------------
  // User input extraction
  // ---------------------------------------------------------------------------

  function textFingerprint(text) {
    return `${text.length}:${text.slice(0, 64)}:${text.slice(-64)}`;
  }

  function extractUserPrompt(messageElement) {
    const editor = messageElement.querySelector('textarea');

    if (editor && normalizeText(editor.value)) {
      return normalizeText(editor.value);
    }

    // Long pasted prompts are expensive to clean up, so reuse the last
    // result until the message text actually changes.
    const fingerprint = textFingerprint(messageElement.textContent || '');
    const cached = promptCache.get(messageElement);

    if (cached && cached.fingerprint === fingerprint) {
      return cached.text;
    }

    const text = readUserPrompt(messageElement);

    promptCache.set(messageElement, { fingerprint, text });

    return text;
  }

  function readUserPrompt(messageElement) {
    const preferredSelectors = [
      '[data-element-id="user-message-content"]',
      '[data-element-id="message-content"]',
      '.prose',
      '.markdown-body',
      '[class*="whitespace-pre-wrap"]'
    ];

    for (const selector of preferredSelectors) {
      const content = messageElement.querySelector(selector);

      if (content) {
        const text = normalizeText(content.textContent);

        if (text) {
          return text;
        }
      }
    }

    const clone = messageElement.cloneNode(true);

    clone.querySelectorAll(`
      button,
      [role="button"],
      svg,
      img,
      picture,
      video,
      audio,
      canvas,
      script,
      style,
      noscript,
      [aria-hidden="true"],
      [data-element-id*="message-action"]
    `).forEach((element) => element.remove());

    return normalizeText(clone.textContent);
  }

  // ---------------------------------------------------------------------------
  // Multi-model response cards
  // ---------------------------------------------------------------------------

  // The model card a message belongs to, or null for single-model chats.
  function findResponseCard(element) {
    let node = element;

    while (node && node !== document.body) {
      const card = node.closest(RESPONSE_CARD_SELECTOR);

      if (!card) return null;

      // A div with a response-* id inside a reply's own markdown is not a
      // model card; keep climbing.
      if (!card.closest(AI_RESPONSE_SELECTOR)) {
        return card;
      }

      node = card.parentElement;
    }

    return null;
  }

  function getCardTitle(card) {
    const header = card.querySelector('button');

    return header ? normalizeText(header.textContent) : '';
  }

  function findTabBar(group, rail) {
    const siblings = Array.from(group.children).filter((child) => {
      return child !== rail && Boolean(child.querySelector('button'));
    });

    return (
      siblings.find((child) => {
        return (
          child.classList.contains('sticky') &&
          child.classList.contains('top-0')
        );
      }) ||
      null
    );
  }

  function pickTab(tabs, cards, card) {
    if (!tabs.length) return null;

    // Desktop renders every card side by side, in tab order.
    const index = cards.indexOf(card);

    if (index >= 0 && tabs.length === cards.length) {
      return tabs[index];
    }

    // Phone layout renders only the open card, so match the model name.
    const title = getCardTitle(card);

    if (!title) return null;

    const matches = tabs.filter((tab) => {
      const label = normalizeText(
        tab.getAttribute('data-tooltip-content')
      ).replace(/^Finalized by\s*/i, '');

      return label === title;
    });

    return matches.length === 1 ? matches[0] : null;
  }

  function getMultiModelContext(element) {
    const card = findResponseCard(element);

    if (!card) return null;

    const rail = card.parentElement;
    const group = rail ? rail.parentElement : null;

    if (!rail || !group) {
      return { card, rail: null, tabBar: null, tab: null };
    }

    const cards = Array.from(rail.children).filter((child) => {
      return child.matches(RESPONSE_CARD_SELECTOR);
    });

    const tabBar = findTabBar(group, rail);

    const tabs = tabBar
      ? Array.from(tabBar.querySelectorAll(':scope > div > button'))
      : [];

    return {
      card,
      rail,
      tabBar,
      tab: pickTab(tabs, cards, card)
    };
  }

  function isTabSelected(tab) {
    return tab.classList.contains(SELECTED_TAB_CLASS);
  }

  // The model name button at the top of a card. Only trusted when it looks
  // exactly like that button (model avatar, a name, no tooltip), so an
  // action button such as "Set as primary" or "Delete" is never clicked.
  function getCardTitleButton(card) {
    const button = card.querySelector('button');

    if (!button) return null;
    if (button.hasAttribute('data-tooltip-id')) return null;
    if (button.closest(AI_RESPONSE_SELECTOR)) return null;
    if (!button.querySelector(MODEL_AVATAR_SELECTOR)) return null;
    if (!normalizeText(button.textContent)) return null;

    return button;
  }

  // ---------------------------------------------------------------------------
  // Model icon detection
  // ---------------------------------------------------------------------------

  function getSvgDataUri(svg, color) {
    // Cheap fingerprint so a swapped-out icon in a reused node is noticed
    // without serializing the SVG on every refresh.
    const fingerprint = [
      color,
      svg.childElementCount,
      svg.getAttribute('viewBox') || ''
    ].join('|');

    const cached = iconCache.get(svg);

    if (cached && cached.fingerprint === fingerprint) {
      return cached.dataUri;
    }

    const clone = svg.cloneNode(true);

    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

    let serialized = new XMLSerializer().serializeToString(clone);

    serialized = serialized.replace(/currentColor/gi, color);

    const dataUri =
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;

    iconCache.set(svg, { fingerprint, dataUri });

    return dataUri;
  }

  // How much empty ring TypingMind leaves around a logo drawn inside a
  // colored circle (GPT, Claude, finalized), scaled to the outline's icon.
  // Keeps the logo inside the circle instead of cut off by it.
  function measureGlyphPadding(avatar, glyph) {
    const outer = avatar.getBoundingClientRect();
    const inner = glyph.getBoundingClientRect();

    if (!outer.width || !inner.width || !inner.height) return 0;

    const share = Math.min(
      1,
      Math.max(inner.width, inner.height) / outer.width
    );

    return Math.round((1 - share) * (ICON_SIZE / 2) * 100) / 100;
  }

  // The model avatar in a card's header, as an image the panel can show.
  function getCardIcon(card) {
    const avatar = card.querySelector(MODEL_AVATAR_SELECTOR);

    if (!avatar) return null;

    const computedStyle = getComputedStyle(avatar);
    const computedBackground = computedStyle.backgroundColor;

    let background = '#ffffff';

    if (
      computedBackground &&
      computedBackground !== 'rgba(0, 0, 0, 0)' &&
      computedBackground !== 'transparent'
    ) {
      background = computedBackground;
    }

    let iconSrc = null;
    let iconKind = 'image';
    let iconFit = '';
    let iconPad = 0;

    const image = avatar.tagName === 'IMG'
      ? avatar
      : avatar.querySelector('img');

    if (image && image.src) {
      iconSrc = image.src;

      // Draw the logo the way TypingMind does (stretched or letterboxed).
      iconFit = getComputedStyle(image).objectFit || '';
    } else {
      const svg = avatar.querySelector('svg');

      if (svg) {
        try {
          iconSrc = getSvgDataUri(svg, computedStyle.color || '#000000');
          iconKind = 'glyph';
          iconPad = measureGlyphPadding(avatar, svg);
        } catch (error) {
          console.debug(
            '[Page Outline] Could not copy a model icon.',
            error
          );
        }
      }
    }

    if (!iconSrc) return null;

    return {
      iconSrc,
      iconBg: background,
      iconKind,
      iconFit,
      iconPad,
      iconKey: [
        getNodeId(avatar),
        background,
        iconSrc.length,
        iconKind,
        iconFit,
        iconPad
      ].join('|')
    };
  }

  // ---------------------------------------------------------------------------
  // Build grouped outline
  // ---------------------------------------------------------------------------

  function applySectionHeadingLevels(entries) {
    let currentSection = [];

    function finishSection() {
      if (!currentSection.length) return;

      const minimumLevel = Math.min(
        ...currentSection.map((entry) => entry.level)
      );

      for (const entry of currentSection) {
        entry.displayLevel = Math.min(
          entry.level - minimumLevel + 1,
          4
        );
      }

      currentSection = [];
    }

    for (const entry of entries) {
      if (entry.type === 'prompt') {
        finishSection();
      } else {
        currentSection.push(entry);
      }
    }

    finishSection();
  }

  function getOutlineData() {
    const container = getChatContainer();

    if (!container) {
      return { entries: [], inputCount: 0, headingCount: 0 };
    }

    const nodes = container.querySelectorAll(OUTLINE_ITEM_SELECTOR);
    const cardsWithIcon = new Set();
    const entries = [];

    let inputNumber = 0;
    let headingCount = 0;

    for (const element of nodes) {
      if (!isRendered(element)) continue;

      if (element.matches(USER_MESSAGE_SELECTOR)) {
        inputNumber += 1;

        const fullText =
          extractUserPrompt(element) || `Input ${inputNumber}`;

        entries.push({
          type: 'prompt',
          element,
          index: entries.length,
          inputNumber,
          fullText,
          text: shortenText(fullText)
        });

        continue;
      }

      if (isInsideThinkingBlock(element)) continue;

      const text = normalizeText(element.textContent);

      if (!text) continue;

      // First heading in each model's card carries that model's icon.
      let icon = null;
      const card = findResponseCard(element);

      if (card && !cardsWithIcon.has(card)) {
        cardsWithIcon.add(card);
        icon = getCardIcon(card);
      }

      entries.push({
        type: 'heading',
        element,
        index: entries.length,
        text,
        level: Number.parseInt(element.tagName.charAt(1), 10),
        displayLevel: 1,
        iconSrc: icon ? icon.iconSrc : null,
        iconBg: icon ? icon.iconBg : null,
        iconKind: icon ? icon.iconKind : '',
        iconFit: icon ? icon.iconFit : '',
        iconPad: icon ? icon.iconPad : 0,
        iconKey: icon ? icon.iconKey : ''
      });

      headingCount += 1;
    }

    applySectionHeadingLevels(entries);

    return {
      entries,
      inputCount: inputNumber,
      headingCount
    };
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  function flashElement(element) {
    const previousTimer = flashTimers.get(element);

    if (previousTimer) {
      clearTimeout(previousTimer);
    }

    element.classList.remove('tm-outline-target-flash');

    // Force the animation to restart when clicking the same item twice.
    void element.offsetWidth;

    element.classList.add('tm-outline-target-flash');

    const timer = setTimeout(() => {
      element.classList.remove('tm-outline-target-flash');
      flashTimers.delete(element);
    }, 1250);

    flashTimers.set(element, timer);
  }

  function findVerticalScroller(element) {
    const chatScroller = element.closest(CHAT_SCROLLER_SELECTOR);

    if (
      chatScroller &&
      chatScroller.scrollHeight > chatScroller.clientHeight
    ) {
      return chatScroller;
    }

    let node = element.parentElement;

    while (
      node &&
      node !== document.body &&
      node !== document.documentElement
    ) {
      if (node.scrollHeight > node.clientHeight + 1) {
        const overflowY = getComputedStyle(node).overflowY;

        if (
          overflowY === 'auto' ||
          overflowY === 'scroll' ||
          overflowY === 'overlay'
        ) {
          return node;
        }
      }

      node = node.parentElement;
    }

    return null;
  }

  // Scroll only the chat vertically. Using scrollIntoView here would also
  // yank the multi-model rail sideways and cut off TypingMind's own
  // smooth slide to the selected model.
  function scrollChatTo(element, context) {
    const behavior = prefersReducedMotion() ? 'auto' : 'smooth';
    const scroller = findVerticalScroller(element);

    if (!scroller) {
      element.scrollIntoView({
        behavior,
        block: 'start',
        inline: 'nearest'
      });

      return;
    }

    // Keep the heading clear of the sticky model tab bar (its height plus
    // wherever it sticks, in case another extension moves it down).
    let stickyOffset = 0;

    if (context && context.tabBar) {
      const stickyTop =
        Number.parseFloat(getComputedStyle(context.tabBar).top) || 0;

      stickyOffset =
        Math.max(0, stickyTop) +
        context.tabBar.getBoundingClientRect().height;
    }

    const scrollerRect = scroller.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();

    const target =
      scroller.scrollTop +
      (elementRect.top - scrollerRect.top - scroller.clientTop) -
      stickyOffset -
      SCROLL_TOP_GAP;

    const maxScroll = scroller.scrollHeight - scroller.clientHeight;

    scroller.scrollTo({
      top: Math.round(Math.max(0, Math.min(target, maxScroll))),
      behavior
    });
  }

  // No tab bar found (layout changed): at least slide the card into view.
  function revealCard(context) {
    const { rail, card } = context;

    if (!rail || rail.scrollWidth <= rail.clientWidth + 1) return;

    const railRect = rail.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();

    if (
      cardRect.left >= railRect.left - 1 &&
      cardRect.right <= railRect.right + 1
    ) {
      return;
    }

    const paddingLeft =
      Number.parseFloat(getComputedStyle(rail).paddingLeft) || 0;

    rail.scrollTo({
      left: Math.max(
        0,
        rail.scrollLeft + (cardRect.left - railRect.left) - paddingLeft - 10
      ),
      behavior: prefersReducedMotion() ? 'auto' : 'smooth'
    });
  }

  function navigateToElement(element) {
    const token = ++navigationToken;
    const context = getMultiModelContext(element);

    let switchedTab = false;

    if (context && !(context.tab && isTabSelected(context.tab))) {
      // Clicking the card's own name selects the model and slides the rail
      // to it without the highlight outline a tab click leaves around the
      // card. The tab is only a fallback if the name button can't be
      // confirmed.
      const switcher = getCardTitleButton(context.card) || context.tab;

      if (switcher) {
        clickingTab = true;

        try {
          switcher.click();
        } finally {
          clickingTab = false;
        }

        switchedTab = true;
      } else {
        revealCard(context);
      }
    }

    const scrollToTarget = () => {
      if (token !== navigationToken) return;
      if (!element.isConnected) return;

      scrollChatTo(element, context);

      // Only headings flash. Flashing an input squares off its bubble and
      // hides its color, so inputs just scroll into place.
      if (element.matches(USER_MESSAGE_SELECTOR)) return;

      setTimeout(() => {
        if (element.isConnected) {
          flashElement(element);
        }
      }, FLASH_DELAY_MS);
    };

    if (switchedTab) {
      // TypingMind scrolls to the end of the card on the next frame after a
      // tab click. Wait until that has been issued, then override it.
      requestAnimationFrame(() => requestAnimationFrame(scrollToTarget));
    } else {
      scrollToTarget();
    }
  }

  // The element can be replaced by a re-render between the last refresh and
  // the click. Find the same item in a fresh outline.
  function findReplacementEntry(staleEntry) {
    let best = null;
    let bestDistance = Infinity;

    for (const entry of currentEntries) {
      if (entry.type !== staleEntry.type) continue;
      if (!entry.element.isConnected) continue;

      const sameText = entry.type === 'prompt'
        ? entry.fullText === staleEntry.fullText
        : entry.text === staleEntry.text;

      if (!sameText) continue;

      const distance = Math.abs(entry.index - staleEntry.index);

      if (distance < bestDistance) {
        best = entry;
        bestDistance = distance;
      }
    }

    return best;
  }

  function activateEntry(entry) {
    if (!entry) return;

    if (entry.element && entry.element.isConnected) {
      navigateToElement(entry.element);
      return;
    }

    refreshOutline();

    const replacement = findReplacementEntry(entry);

    if (replacement) {
      navigateToElement(replacement.element);
    }
  }

  function getItemFromEvent(event) {
    const target = event.target;

    if (!target || typeof target.closest !== 'function') return null;

    const item = target.closest('.outline-item');

    return item && item.__tmOutlineEntry ? item : null;
  }

  function handleListClick(event) {
    const item = getItemFromEvent(event);

    if (!item) return;

    activateEntry(item.__tmOutlineEntry);
  }

  function handleListKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;

    const item = getItemFromEvent(event);

    if (!item) return;

    event.preventDefault();
    activateEntry(item.__tmOutlineEntry);
  }

  // Show the header's bottom line only while the list is scrolled.
  function handleListScroll(event) {
    const list = event.currentTarget;
    const panel = list.parentElement;

    if (!panel) return;

    const scrolled = list.scrollTop > 0;

    if (panel.classList.contains('is-scrolled') !== scrolled) {
      panel.classList.toggle('is-scrolled', scrolled);
    }
  }

  // ---------------------------------------------------------------------------
  // Render outline
  // ---------------------------------------------------------------------------

  function getEntryKey(entry) {
    const elementId = getNodeId(entry.element);

    if (entry.type === 'prompt') {
      return [
        'p',
        elementId,
        entry.inputNumber,
        entry.fullText.slice(0, PROMPT_TITLE_LENGTH)
      ].join(':');
    }

    return [
      'h',
      elementId,
      entry.displayLevel,
      entry.iconKey,
      entry.text
    ].join(':');
  }

  function createPromptItem(entry) {
    const item = document.createElement('li');

    item.className = 'outline-item outline-prompt';
    item.title = entry.fullText.slice(0, PROMPT_TITLE_LENGTH);
    item.tabIndex = 0;
    item.setAttribute('role', 'button');

    item.setAttribute(
      'aria-label',
      `Input ${entry.inputNumber}: ${shortenText(entry.fullText, PROMPT_LABEL_LENGTH)}`
    );

    const text = document.createElement('span');

    text.className = 'outline-prompt-text';
    text.textContent = entry.text;

    item.appendChild(text);

    return item;
  }

  function createHeadingItem(entry) {
    const item = document.createElement('li');

    item.className = 'outline-item';
    item.title = entry.text;
    item.tabIndex = 0;
    item.setAttribute('role', 'button');

    item.setAttribute(
      'data-level',
      String(entry.displayLevel)
    );

    if (entry.iconSrc) {
      const icon = document.createElement('img');

      icon.src = entry.iconSrc;
      icon.className = 'outline-model-icon';
      icon.alt = '';
      icon.loading = 'lazy';

      const background = entry.iconBg || 'white';

      if (entry.iconKind === 'glyph') {
        // A logo inside a colored circle: fill the whole circle, keep the
        // logo's margin so the round edge never cuts it.
        icon.style.backgroundColor = background;

        if (entry.iconPad) {
          icon.style.padding = `${entry.iconPad}px`;
        }
      } else {
        // A logo image: TypingMind clips it to a circle over a white fill.
        // The fill stops just inside the edge, so it can't show through as
        // white corners or a white ring around dark logos.
        icon.style.background =
          `radial-gradient(circle closest-side, ${background} ` +
          'calc(100% - 1px), transparent calc(100% - 0.5px))';

        if (entry.iconFit) {
          icon.style.objectFit = entry.iconFit;
        }
      }

      icon.addEventListener('error', () => {
        icon.remove();
      });

      item.appendChild(icon);
    }

    const text = document.createElement('span');
    text.textContent = entry.text;

    item.appendChild(text);

    return item;
  }

  function createItem(entry, key) {
    const item = entry.type === 'prompt'
      ? createPromptItem(entry)
      : createHeadingItem(entry);

    item.__tmOutlineKey = key;

    return item;
  }

  // Patch the list in place: unchanged items stay the same DOM nodes, so
  // the panel doesn't flicker and a tap in progress is never lost.
  // Returns true when anything changed.
  function renderEntries(list, entries) {
    if (entries.length === 0) {
      const first = list.firstElementChild;

      if (
        list.childElementCount === 1 &&
        first.classList.contains('outline-empty')
      ) {
        return false;
      }

      const emptyItem = document.createElement('li');
      const emptyTitle = document.createElement('span');

      emptyItem.className = 'outline-empty';
      emptyTitle.className = 'outline-empty-title';
      emptyTitle.textContent = 'Nothing to outline yet';

      emptyItem.append(
        emptyTitle,
        "Your messages and each reply's headings show up here."
      );

      list.replaceChildren(emptyItem);

      return true;
    }

    const reusable = new Map();

    for (const child of list.children) {
      if (child.__tmOutlineKey) {
        reusable.set(child.__tmOutlineKey, child);
      }
    }

    let changed = false;
    let index = 0;

    for (const entry of entries) {
      const key = getEntryKey(entry);
      const current = list.children[index];

      if (current && current.__tmOutlineKey === key) {
        current.__tmOutlineEntry = entry;
        reusable.delete(key);
        index += 1;
        continue;
      }

      let item = reusable.get(key);

      if (item) {
        reusable.delete(key);
      } else {
        item = createItem(entry, key);
      }

      item.__tmOutlineEntry = entry;
      list.insertBefore(item, current || null);

      changed = true;
      index += 1;
    }

    while (list.children.length > index) {
      list.lastElementChild.remove();
      changed = true;
    }

    return changed;
  }

  function refreshOutline() {
    const panel = document.getElementById(PANEL_ID);

    if (!panel) return;

    const list = panel.querySelector('.outline-list');

    const countElement = panel.querySelector(
      '.outline-count'
    );

    if (!list || !countElement) return;

    const {
      entries,
      inputCount,
      headingCount
    } = getOutlineData();

    currentEntries = entries;

    const countParts = [];

    if (inputCount) {
      countParts.push(plural(inputCount, 'input'));
    }

    if (headingCount) {
      countParts.push(plural(headingCount, 'heading'));
    }

    const countText = countParts.join(', ');

    if (countElement.textContent !== countText) {
      countElement.textContent = countText;
    }

    if (renderEntries(list, entries)) {
      // Content height changed, so re-measure the placement.
      positionPanel();
    }
  }

  // ---------------------------------------------------------------------------
  // Refresh scheduling
  // ---------------------------------------------------------------------------

  function runRefresh() {
    refreshTimer = null;
    refreshPendingSince = 0;

    if (panelVisible) {
      refreshOutline();
    }
  }

  function scheduleRefresh() {
    // No point walking the chat while the panel is closed.
    if (!panelVisible) {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }

      refreshPendingSince = 0;
      return;
    }

    const now = performance.now();

    if (!refreshPendingSince) {
      refreshPendingSince = now;
    }

    // Streaming replies mutate the DOM nonstop, which would reset the
    // debounce forever. Force a refresh once the max wait is hit.
    if (now - refreshPendingSince >= REFRESH_MAX_WAIT_MS) {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }

      runRefresh();
      return;
    }

    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }

    refreshTimer = setTimeout(runRefresh, REFRESH_DEBOUNCE_MS);
  }

  // Throttled, not debounced: runs at most every 120 ms even while the DOM
  // changes nonstop, and never more often than that.
  function scheduleVisibilityCheck() {
    if (visibilityTimer) return;

    visibilityTimer = setTimeout(() => {
      visibilityTimer = null;
      updateButtonVisibility();
    }, VISIBILITY_THROTTLE_MS);
  }

  function mutationBelongsToExtension(mutation) {
    const target = mutation.target;

    const element =
      target.nodeType === Node.ELEMENT_NODE
        ? target
        : target.parentElement;

    if (!element) return false;

    return Boolean(
      element.id === PANEL_ID ||
      element.id === TOGGLE_ID ||
      element.closest(`#${PANEL_ID}, #${TOGGLE_ID}, [${MENU_ROW_ATTR}]`)
    );
  }

  function startObserver() {
    observer = new MutationObserver((mutations) => {
      let textChanged = false;
      let structureChanged = false;

      // TypingMind's chat menu just opened: add the Outline row. This runs
      // before the browser paints, so the menu never shows without it.
      if (!menuRowReady()) {
        for (const mutation of mutations) {
          if (mutation.type !== 'childList' || !mutation.addedNodes.length) {
            continue;
          }

          if (scanForChatMenu(mutation.addedNodes)) break;
        }
      }

      for (const mutation of mutations) {
        const structural = mutation.type === 'childList';

        // Streamed tokens only matter while the panel is open.
        if (!structural && !panelVisible) continue;

        if (mutationBelongsToExtension(mutation)) continue;

        if (structural) {
          structureChanged = true;
          break;
        }

        textChanged = true;
      }

      if (!structureChanged && !textChanged) return;

      if (panelVisible) {
        scheduleRefresh();
      }

      if (structureChanged) {
        scheduleVisibilityCheck();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  // ---------------------------------------------------------------------------
  // Keyboard, resize and mobile behavior
  // ---------------------------------------------------------------------------

  function handleKeydown(event) {
    if (event.key === 'Escape' && panelVisible) {
      setPanelVisibility(false);
      return;
    }

    const modifierPressed =
      event.ctrlKey || event.metaKey;

    const isShortcut =
      modifierPressed &&
      event.shiftKey &&
      typeof event.key === 'string' &&
      event.key.toLowerCase() === 'o';

    if (!isShortcut) return;
    if (!isOnChatPage()) return;

    event.preventDefault();

    // Capture phase + stop, so a stale older copy of this script can't
    // toggle the panel a second time on the same keypress.
    event.stopPropagation();

    if (typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    }

    togglePanel();
  }

  function handleOutsideClick(event) {
    if (
      !panelVisible ||
      clickingTab ||
      window.innerWidth > 768 ||
      performance.now() < suppressOutsideCloseUntil
    ) {
      return;
    }

    const panel = document.getElementById(PANEL_ID);
    const button = document.getElementById(TOGGLE_ID);

    const clickedInsidePanel =
      panel && panel.contains(event.target);

    const clickedToggle =
      button && button.contains(event.target);

    if (!clickedInsidePanel && !clickedToggle) {
      setPanelVisibility(false);
    }
  }

  function handleResize() {
    scheduleVisibilityCheck();

    if (resizeFrame) return;

    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null;

      // Don't fight an active drag.
      if (dragState && dragState.moved) return;

      // Re-fit the saved spot to the new window. The saved spot itself is
      // untouched, so the button returns when the window grows back.
      fitButtonToWindow();
      positionPanel();
    });
  }

  // ---------------------------------------------------------------------------
  // Teardown
  // ---------------------------------------------------------------------------

  function destroy() {
    if (destroyed) return;

    destroyed = true;

    if (observer) {
      observer.disconnect();
      observer = null;
    }

    clearHoldTimer(dragState);
    dragState = null;

    if (refreshTimer) clearTimeout(refreshTimer);
    if (visibilityTimer) clearTimeout(visibilityTimer);
    if (dragFrame) cancelAnimationFrame(dragFrame);
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    if (panelSwipeFrame) cancelAnimationFrame(panelSwipeFrame);
    if (poseTimer) clearTimeout(poseTimer);

    chatSwipe = null;
    panelSwipe = null;
    panelSwipeFrame = null;
    poseTimer = null;

    navigationToken += 1;

    document.removeEventListener('keydown', handleKeydown, true);
    document.removeEventListener('click', handleOutsideClick, true);
    document.removeEventListener('pointerdown', rememberPress, true);
    document.removeEventListener('click', rememberPress, true);
    document.removeEventListener('touchstart', handleChatSwipeStart);
    document.removeEventListener('touchmove', handleChatSwipeMove);
    document.removeEventListener('touchend', handleChatSwipeEnd);
    document.removeEventListener('touchcancel', handleChatSwipeEnd);
    window.removeEventListener('pointermove', handleDragMove);
    window.removeEventListener('pointerup', handleDragEnd);
    window.removeEventListener('pointercancel', handleDragEnd);
    window.removeEventListener('resize', handleResize);
    window.removeEventListener('popstate', scheduleVisibilityCheck);
    window.removeEventListener('hashchange', scheduleVisibilityCheck);

    document.body.classList.remove('tm-outline-dragging');

    document
      .querySelectorAll('.tm-outline-target-flash')
      .forEach((node) => {
        node.classList.remove('tm-outline-target-flash');
      });

    document
      .querySelectorAll(
        `#${PANEL_ID}, #${TOGGLE_ID}, #${STYLE_ID}, [${MENU_ROW_ATTR}]`
      )
      .forEach((node) => node.remove());

    currentEntries = [];
    menuRow = null;

    if (
      window[NAMESPACE] &&
      window[NAMESPACE].version === VERSION
    ) {
      delete window[NAMESPACE];
    }
  }

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  function init() {
    if (destroyed) return;

    anchor = loadAnchor();
    buttonPosition = anchorToPosition(anchor);
    buttonPinned = loadPinned();

    injectStyles();
    createToggleButton();
    createPanel();
    startObserver();
    updateButtonVisibility();
    scanPageForChatMenu();

    document.addEventListener('keydown', handleKeydown, true);
    document.addEventListener('click', handleOutsideClick, true);

    // Remembers which button opened TypingMind's chat menu.
    document.addEventListener('pointerdown', rememberPress, { capture: true, passive: true });
    document.addEventListener('click', rememberPress, { capture: true, passive: true });

    // Swipe left on the chat to open. Passive, so scrolling never waits.
    document.addEventListener('touchstart', handleChatSwipeStart, { passive: true });
    document.addEventListener('touchmove', handleChatSwipeMove, { passive: true });
    document.addEventListener('touchend', handleChatSwipeEnd, { passive: true });
    document.addEventListener('touchcancel', handleChatSwipeEnd, { passive: true });

    window.addEventListener('pointermove', handleDragMove);
    window.addEventListener('pointerup', handleDragEnd);
    window.addEventListener('pointercancel', handleDragEnd);

    window.addEventListener('resize', handleResize, { passive: true });
    window.addEventListener('popstate', scheduleVisibilityCheck);
    window.addEventListener('hashchange', scheduleVisibilityCheck);

    window[NAMESPACE] = {
      version: VERSION,
      destroy,
      toggle: togglePanel,
      refresh: refreshOutline,
      resetPosition,
      getPosition: () => ({ ...buttonPosition }),
      getAnchor: () => ({ ...anchor }),
      setPinned,
      isPinned: () => buttonPinned
    };

    console.log(
      `[Page Outline v${VERSION}] Loaded. Drag the button anywhere ` +
      '(hold first on touch), double-click or double-tap it to reset, ' +
      'press Ctrl/Cmd + Shift + O, or swipe left on the chat to open.'
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
