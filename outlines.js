// TypingMind Page Outline Extension v4.6
// Groups response headings beneath each user input.
// Toggle button (draggable) or Ctrl/Cmd + Shift + O.
//
// v4.6 changes (built on v4.3):
// - Multi-model chats: clicking a heading or input that belongs to another
//   model now switches TypingMind to that model's tab first, exactly as if
//   you clicked the tab yourself, then scrolls to the heading. Headings no
//   longer land hidden under the sticky model tab bar.
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

  const VERSION = '4.6';
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
  const DEFAULT_PANEL_WIDTH = 270;
  const SCROLL_TOP_GAP = 10;

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

  // Text limits
  const PROMPT_PREVIEW_LENGTH = 180;
  const PROMPT_TITLE_LENGTH = 1000;
  const PROMPT_LABEL_LENGTH = 300;

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
        `#${PANEL_ID}, #${TOGGLE_ID}, style[id^="${STYLE_ID}"]`
      )
      .forEach((node) => node.remove());

    delete window.__tmPageOutlineV42Loaded;
  }

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;

    style.textContent = `
      /* Toggle button */

      #${TOGGLE_ID} {
        position: fixed;
        top: 0;
        left: 0;
        z-index: 99999;
        width: ${BUTTON_SIZE}px;
        height: ${BUTTON_SIZE}px;
        padding: 0;
        border-radius: 7px;
        border: 1px solid rgba(128, 128, 128, 0.15);
        background: rgba(180, 180, 180, 0.18);
        color: rgba(100, 100, 100, 0.7);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
        box-shadow: none;
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        transform: translateY(-6px) scale(0.9);
        transition:
          opacity 0.25s ease,
          transform 0.25s ease,
          visibility 0s linear 0.25s,
          background 0.2s,
          color 0.2s,
          border-color 0.2s,
          box-shadow 0.2s;
        user-select: none;
        -webkit-user-select: none;
        -webkit-touch-callout: none;
        touch-action: none;
        -webkit-tap-highlight-color: transparent;
      }

      #${TOGGLE_ID}.chat-visible {
        opacity: 0.75;
        visibility: visible;
        pointer-events: auto;
        transform: translateY(0) scale(1);
        transition:
          opacity 0.25s ease,
          transform 0.25s ease,
          visibility 0s,
          background 0.2s,
          color 0.2s,
          border-color 0.2s,
          box-shadow 0.2s;
      }

      @media (hover: hover) {
        #${TOGGLE_ID}:hover {
          background: rgba(180, 180, 180, 0.35);
          color: rgba(60, 60, 60, 0.9);
        }

        .dark #${TOGGLE_ID}:hover {
          background: rgba(255, 255, 255, 0.15);
          color: rgba(220, 220, 220, 0.85);
        }
      }

      #${TOGGLE_ID}:active {
        background: rgba(180, 180, 180, 0.45);
      }

      #${TOGGLE_ID}.active {
        background: rgba(200, 155, 60, 0.2);
        color: rgba(190, 140, 50, 0.95);
        border-color: rgba(200, 155, 60, 0.3);
      }

      #${TOGGLE_ID}.dragging {
        cursor: grabbing;
        opacity: 1;
        background: rgba(180, 180, 180, 0.45);
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
        transition:
          background 0.2s,
          color 0.2s,
          border-color 0.2s,
          box-shadow 0.2s;
      }

      #${TOGGLE_ID}:focus-visible {
        outline: 2px solid rgba(200, 155, 60, 0.65);
        outline-offset: 2px;
      }

      .dark #${TOGGLE_ID} {
        background: rgba(255, 255, 255, 0.08);
        color: rgba(200, 200, 200, 0.55);
        border-color: rgba(255, 255, 255, 0.08);
      }

      .dark #${TOGGLE_ID}.active {
        background: rgba(210, 165, 70, 0.18);
        color: rgba(220, 175, 80, 0.95);
        border-color: rgba(210, 165, 70, 0.22);
      }

      .dark #${TOGGLE_ID}.dragging {
        background: rgba(255, 255, 255, 0.2);
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
      }

      /* While dragging, stop the page from selecting text under the cursor */

      body.tm-outline-dragging {
        user-select: none !important;
        -webkit-user-select: none !important;
        cursor: grabbing !important;
      }

      /* Panel */

      #${PANEL_ID} {
        position: fixed;
        top: 0;
        left: 0;
        z-index: 99998;
        width: ${DEFAULT_PANEL_WIDTH}px;
        max-width: calc(100vw - ${EDGE_MARGIN * 2}px);
        max-height: calc(100vh - ${EDGE_MARGIN * 2}px);
        overflow-y: auto;
        overscroll-behavior: contain;
        border-radius: 10px;
        border: 1px solid rgba(128, 128, 128, 0.15);
        background: rgba(255, 255, 255, 0.95);
        color: #222;
        box-shadow: 0 3px 14px rgba(0, 0, 0, 0.1);
        font-family:
          Inter,
          -apple-system,
          BlinkMacSystemFont,
          "Segoe UI",
          Roboto,
          sans-serif;
        font-size: 12px;
        padding: 0;
        display: block;
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        transform: scale(0.96) translateY(-6px);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        transform-origin: top right;
        transition:
          opacity 0.18s ease,
          transform 0.18s ease,
          visibility 0s linear 0.18s;
      }

      #${PANEL_ID}.visible {
        opacity: 1;
        visibility: visible;
        pointer-events: auto;
        transform: scale(1) translateY(0);
        transition:
          opacity 0.18s ease,
          transform 0.18s ease,
          visibility 0s;
      }

      .dark #${PANEL_ID} {
        background: rgba(28, 28, 32, 0.95);
        color: #ccc;
        border-color: rgba(255, 255, 255, 0.08);
        box-shadow: 0 3px 14px rgba(0, 0, 0, 0.4);
      }

      /* Panel header */

      #${PANEL_ID} .outline-header {
        position: sticky;
        top: 0;
        z-index: 2;
        padding: 8px 12px 6px;
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: #999;
        background: rgba(255, 255, 255, 0.92);
        border-bottom: 1px solid rgba(128, 128, 128, 0.1);
        display: flex;
        align-items: center;
        justify-content: space-between;
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
      }

      .dark #${PANEL_ID} .outline-header {
        color: #777;
        background: rgba(28, 28, 32, 0.92);
        border-bottom-color: rgba(255, 255, 255, 0.06);
      }

      #${PANEL_ID} .outline-count {
        font-weight: 400;
        font-size: 9px;
        color: #aaa;
        text-transform: none;
        letter-spacing: 0;
      }

      .dark #${PANEL_ID} .outline-count {
        color: #666;
      }

      /* Outline list */

      #${PANEL_ID} .outline-list {
        list-style: none;
        margin: 0;
        padding: 4px 0 7px;
      }

      #${PANEL_ID} .outline-item {
        padding: 4px 12px;
        cursor: pointer;
        transition:
          background 0.12s,
          border-color 0.12s;
        line-height: 1.35;
        white-space: normal;
        border-left: 2px solid transparent;
        display: flex;
        align-items: flex-start;
        gap: 6px;
        -webkit-tap-highlight-color: transparent;
      }

      #${PANEL_ID} .outline-item:hover {
        background: rgba(0, 0, 0, 0.035);
        border-left-color: rgba(100, 100, 100, 0.4);
      }

      .dark #${PANEL_ID} .outline-item:hover {
        background: rgba(255, 255, 255, 0.045);
        border-left-color: rgba(200, 200, 200, 0.3);
      }

      #${PANEL_ID} .outline-item:focus-visible {
        outline: 1px solid rgba(200, 155, 60, 0.65);
        outline-offset: -1px;
        background: rgba(200, 155, 60, 0.08);
      }

      #${PANEL_ID} .outline-item > span {
        min-width: 0;
        overflow-wrap: anywhere;
        word-break: break-word;
      }

      /* User input section */

      #${PANEL_ID} .outline-prompt {
        margin-top: 7px;
        padding: 7px 11px;
        font-size: 11px;
        font-weight: 600;
        line-height: 1.35;
        color: #514c40;
        background: rgba(200, 155, 60, 0.035);
        border-top: 1px solid rgba(200, 155, 60, 0.09);
        border-left-color: rgba(200, 155, 60, 0.34);
      }

      #${PANEL_ID} .outline-prompt:first-child {
        margin-top: 0;
      }

      #${PANEL_ID} .outline-prompt:hover {
        background: rgba(200, 155, 60, 0.105);
        border-left-color: rgba(190, 140, 40, 0.62);
      }

      .dark #${PANEL_ID} .outline-prompt {
        color: #c9bea2;
        background: rgba(210, 165, 70, 0.03);
        border-top-color: rgba(210, 165, 70, 0.075);
        border-left-color: rgba(210, 165, 70, 0.3);
      }

      .dark #${PANEL_ID} .outline-prompt:hover {
        background: rgba(210, 165, 70, 0.095);
        border-left-color: rgba(220, 175, 80, 0.55);
      }

      #${PANEL_ID} .outline-prompt-text {
        display: -webkit-box;
        overflow: hidden;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        line-clamp: 2;
      }

      /* Heading levels */

      #${PANEL_ID} .outline-item[data-level="1"] {
        padding-left: 14px;
        font-weight: 700;
        font-size: 12px;
      }

      #${PANEL_ID} .outline-item[data-level="2"] {
        padding-left: 25px;
        font-weight: 600;
        font-size: 11.5px;
      }

      #${PANEL_ID} .outline-item[data-level="3"] {
        padding-left: 36px;
        font-weight: 500;
        font-size: 11px;
        color: #666;
      }

      #${PANEL_ID} .outline-item[data-level="4"] {
        padding-left: 47px;
        font-weight: 400;
        font-size: 10.5px;
        color: #888;
      }

      .dark #${PANEL_ID} .outline-item[data-level="3"] {
        color: #999;
      }

      .dark #${PANEL_ID} .outline-item[data-level="4"] {
        color: #777;
      }

      /* Model icon */

      #${PANEL_ID} .outline-model-icon {
        width: 16px;
        height: 16px;
        min-width: 16px;
        min-height: 16px;
        max-width: 16px;
        max-height: 16px;
        flex: 0 0 16px;
        border-radius: 4px;
        object-fit: contain;
        opacity: 0.85;
      }

      .dark #${PANEL_ID} .outline-model-icon {
        opacity: 0.92;
      }

      /* Empty state */

      #${PANEL_ID} .outline-empty {
        padding: 16px 12px;
        text-align: center;
        color: #aaa;
        font-size: 11px;
      }

      .dark #${PANEL_ID} .outline-empty {
        color: #666;
      }

      /* Target flash */

      .tm-outline-target-flash {
        animation: tmOutlineTargetFlash 1.2s ease-out !important;
        border-radius: 4px;
      }

      @keyframes tmOutlineTargetFlash {
        0% {
          background-color: rgba(255, 200, 0, 0.32);
        }

        100% {
          background-color: transparent;
        }
      }

      /* Scrollbar */

      #${PANEL_ID}::-webkit-scrollbar {
        width: 4px;
      }

      #${PANEL_ID}::-webkit-scrollbar-track {
        background: transparent;
      }

      #${PANEL_ID}::-webkit-scrollbar-thumb {
        background: rgba(128, 128, 128, 0.23);
        border-radius: 4px;
      }

      @media (max-width: 768px) {
        #${PANEL_ID} {
          width: min(290px, calc(100vw - ${EDGE_MARGIN * 2}px));
        }
      }

      @media (prefers-reduced-motion: reduce) {
        #${TOGGLE_ID},
        #${PANEL_ID} {
          transition:
            background 0.2s,
            color 0.2s,
            border-color 0.2s;
          transform: none;
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
      'Outline · drag to move (hold first on touch) · double-click to reset · Ctrl/Cmd + Shift + O';

    button.setAttribute('aria-label', 'Toggle chat outline');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', PANEL_ID);

    button.innerHTML = `
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
        <span>Chat Outline</span>
        <span class="outline-count"></span>
      </div>
      <ul class="outline-list"></ul>
    `;

    const list = panel.querySelector('.outline-list');

    // One delegated listener for every item, so items can be reused.
    list.addEventListener('click', handleListClick);
    list.addEventListener('keydown', handleListKeydown);

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

    if (isOnChatPage()) {
      button.classList.add('chat-visible');
      return;
    }

    button.classList.remove('chat-visible');

    if (panelVisible) {
      setPanelVisibility(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Panel controls
  // ---------------------------------------------------------------------------

  function setPanelVisibility(visible) {
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

    if (avatar.tagName === 'IMG' && avatar.src) {
      iconSrc = avatar.src;
    } else {
      const image = avatar.querySelector('img');

      if (image && image.src) {
        iconSrc = image.src;
      } else {
        const svg = avatar.querySelector('svg');

        if (svg) {
          try {
            iconSrc = getSvgDataUri(svg, computedStyle.color || '#000000');
          } catch (error) {
            console.debug(
              '[Page Outline] Could not copy a model icon.',
              error
            );
          }
        }
      }
    }

    if (!iconSrc) return null;

    return {
      iconSrc,
      iconBg: background,
      iconKey: `${getNodeId(avatar)}|${background}|${iconSrc.length}`
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

    if (context && context.tab) {
      if (!isTabSelected(context.tab)) {
        // Exactly what clicking the model's tab does: select it, outline
        // its card and slide the rail to it.
        clickingTab = true;

        try {
          context.tab.click();
        } finally {
          clickingTab = false;
        }

        switchedTab = true;
      }
    } else if (context) {
      revealCard(context);
    }

    const scrollToTarget = () => {
      if (token !== navigationToken) return;
      if (!element.isConnected) return;

      scrollChatTo(element, context);

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
      icon.style.backgroundColor = entry.iconBg || 'white';

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

      emptyItem.className = 'outline-empty';
      emptyItem.textContent = 'No inputs or headings found in this chat.';

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

    const countText = countParts.join(' · ');

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
      element.closest(`#${PANEL_ID}, #${TOGGLE_ID}`)
    );
  }

  function startObserver() {
    observer = new MutationObserver((mutations) => {
      let textChanged = false;
      let structureChanged = false;

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
      window.innerWidth > 768
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

    navigationToken += 1;

    document.removeEventListener('keydown', handleKeydown, true);
    document.removeEventListener('click', handleOutsideClick, true);
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
      .querySelectorAll(`#${PANEL_ID}, #${TOGGLE_ID}, #${STYLE_ID}`)
      .forEach((node) => node.remove());

    currentEntries = [];

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

    injectStyles();
    createToggleButton();
    createPanel();
    startObserver();
    updateButtonVisibility();

    document.addEventListener('keydown', handleKeydown, true);
    document.addEventListener('click', handleOutsideClick, true);

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
      getAnchor: () => ({ ...anchor })
    };

    console.log(
      `[Page Outline v${VERSION}] Loaded. Drag the button anywhere ` +
      '(hold first on touch), double-click or double-tap it to reset, ' +
      'or press Ctrl/Cmd + Shift + O.'
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
