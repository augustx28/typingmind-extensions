// TypingMind Page Outline Extension v4.3
// Groups response headings beneath each user input.
// Toggle button (draggable) or Ctrl/Cmd + Shift + O.
//
// v4.3 changes:
// - The toggle button can be dragged anywhere on screen with mouse, touch,
//   or pen (Pointer Events + touch-action: none, so a touch drag never
//   scrolls the chat). Position is saved to localStorage and restored.
// - A drag never fires the toggle; a tap/click still opens and closes.
// - The panel now anchors to the button: it flips above/below and
//   left/right based on available space, and its max-height is sized to
//   the viewport instead of assuming the button sits top-right.
// - Double-click / double-tap the button snaps it back to the default spot.
// - Escape closes the panel.
// - Fixed: on long streaming replies the 450 ms debounce kept resetting, so
//   the outline never updated until the stream paused. Added a 1.6 s max
//   wait so it refreshes while text is still arriving.
// - Fixed: model-icon SVGs were re-serialized to data URIs on every
//   refresh. Now cached per icon element.
// - Refresh work is skipped entirely while the panel is closed.
// - isRendered() checks layout boxes before calling getComputedStyle
//   (cheaper on very long chats).
// - Loading this script now tears down any previous version first, and
//   window.__tmPageOutline.destroy() removes everything cleanly.
//   Note: still reload the page after swapping versions, so the old
//   copy's listeners are gone for good.

(function () {
  'use strict';

  const VERSION = '4.3';
  const NAMESPACE = '__tmPageOutline';

  const PANEL_ID = 'tm-page-outline-panel';
  const TOGGLE_ID = 'tm-page-outline-toggle';
  const STYLE_ID = 'tm-page-outline-styles';
  const STORAGE_KEY = 'tm-page-outline-button-position';

  const USER_MESSAGE_SELECTOR = '[data-element-id="user-message"]';
  const AI_RESPONSE_SELECTOR = '[data-element-id="ai-response"]';

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
  const BUTTON_SIZE = 30;
  const EDGE_MARGIN = 8;
  const PANEL_GAP = 8;
  const MIN_PANEL_HEIGHT = 140;
  const DEFAULT_PANEL_WIDTH = 270;

  // Interaction
  const DRAG_THRESHOLD = 4;
  const CLICK_SUPPRESS_MS = 250;
  const REFRESH_DEBOUNCE_MS = 450;
  const REFRESH_MAX_WAIT_MS = 1600;
  const VISIBILITY_DEBOUNCE_MS = 250;

  let panelVisible = false;
  let destroyed = false;
  let observer = null;

  let refreshTimer = null;
  let visibilityTimer = null;
  let refreshPendingSince = 0;
  let lastOutlineSignature = null;
  let nextNodeId = 1;

  let buttonPosition = null;
  let dragState = null;
  let dragFrame = null;
  let resizeFrame = null;
  let lastDragEndTime = 0;

  const nodeIds = new WeakMap();
  const flashTimers = new WeakMap();
  const iconCache = new WeakMap();

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
        touch-action: none;
        -webkit-tap-highlight-color: transparent;
      }

      #${TOGGLE_ID}.chat-visible {
        opacity: 0.3;
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

      #${TOGGLE_ID}:hover {
        background: rgba(180, 180, 180, 0.35);
        color: rgba(60, 60, 60, 0.9);
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

      .dark #${TOGGLE_ID}:hover {
        background: rgba(255, 255, 255, 0.15);
        color: rgba(220, 220, 220, 0.85);
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
        font-weight: 600;
        font-size: 12px;
      }

      #${PANEL_ID} .outline-item[data-level="2"] {
        padding-left: 25px;
        font-weight: 500;
        font-size: 11.5px;
      }

      #${PANEL_ID} .outline-item[data-level="3"] {
        padding-left: 36px;
        font-weight: 400;
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
  // ---------------------------------------------------------------------------

  function getDefaultPosition() {
    return {
      left: window.innerWidth - BUTTON_SIZE - 12,
      top: 50
    };
  }

  function clampPosition(position) {
    const maxLeft = Math.max(
      EDGE_MARGIN,
      window.innerWidth - BUTTON_SIZE - EDGE_MARGIN
    );

    const maxTop = Math.max(
      EDGE_MARGIN,
      window.innerHeight - BUTTON_SIZE - EDGE_MARGIN
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

  function loadPosition() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);

      if (!raw) {
        return clampPosition(getDefaultPosition());
      }

      const saved = JSON.parse(raw);

      if (
        !saved ||
        !Number.isFinite(saved.left) ||
        !Number.isFinite(saved.top)
      ) {
        return clampPosition(getDefaultPosition());
      }

      return clampPosition(saved);
    } catch (error) {
      console.debug(
        '[Page Outline] Could not read the saved button position.',
        error
      );

      return clampPosition(getDefaultPosition());
    }
  }

  function savePosition() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(buttonPosition)
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

  function resetPosition() {
    buttonPosition = clampPosition(getDefaultPosition());
    applyButtonPosition();
    positionPanel();
    savePosition();
  }

  // ---------------------------------------------------------------------------
  // Panel placement
  // ---------------------------------------------------------------------------

  function positionPanel() {
    const panel = document.getElementById(PANEL_ID);

    if (!panel || !buttonPosition) return;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

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
  // Dragging
  // ---------------------------------------------------------------------------

  function handleDragStart(event) {
    if (event.isPrimary === false) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originLeft: buttonPosition.left,
      originTop: buttonPosition.top,
      moved: false
    };

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch (error) {
      // Capture is a nicety; window listeners still track the pointer.
    }
  }

  function handleDragMove(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;

    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;

    if (!dragState.moved) {
      if (
        Math.abs(deltaX) < DRAG_THRESHOLD &&
        Math.abs(deltaY) < DRAG_THRESHOLD
      ) {
        return;
      }

      dragState.moved = true;

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
      left: dragState.originLeft + deltaX,
      top: dragState.originTop + deltaY
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
    if (!dragState || event.pointerId !== dragState.pointerId) return;

    const wasDragged = dragState.moved;
    const pointerId = dragState.pointerId;
    const button = document.getElementById(TOGGLE_ID);

    dragState = null;

    if (dragFrame) {
      cancelAnimationFrame(dragFrame);
      dragFrame = null;
    }

    if (button) {
      button.classList.remove('dragging');

      try {
        if (button.hasPointerCapture(pointerId)) {
          button.releasePointerCapture(pointerId);
        }
      } catch (error) {
        // Nothing to release.
      }
    }

    document.body.classList.remove('tm-outline-dragging');

    if (!wasDragged) return;

    // Swallow the click that fires right after a drag.
    lastDragEndTime = performance.now();

    applyButtonPosition();

    if (panelVisible) {
      positionPanel();
    }

    savePosition();
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
      'Outline · drag to move · double-click to reset · Ctrl/Cmd + Shift + O';

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

    document.body.appendChild(panel);

    positionPanel();
  }

  // ---------------------------------------------------------------------------
  // Chat detection
  // ---------------------------------------------------------------------------

  function isOnChatPage() {
    const chatSignals = [
      '[data-element-id="chat-space-middle-part"]',
      '[data-element-id="chat-space"]',
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
    }
  }

  function togglePanel() {
    setPanelVisibility(!panelVisible);
  }

  function handleToggleClick(event) {
    if (performance.now() - lastDragEndTime < CLICK_SUPPRESS_MS) {
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

  function getChatContainer() {
    const selectors = [
      '[data-element-id="chat-space-middle-part"]',
      '[data-element-id="chat-space"]',
      '.chat-messages',
      '[role="main"]',
      'main'
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);

      if (
        element &&
        (
          element.querySelector(USER_MESSAGE_SELECTOR) ||
          element.querySelector(AI_RESPONSE_SELECTOR)
        )
      ) {
        return element;
      }
    }

    const firstMessage = document.querySelector(
      `${USER_MESSAGE_SELECTOR}, ${AI_RESPONSE_SELECTOR}`
    );

    if (firstMessage) {
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
    }

    const candidates = document.querySelectorAll('div[class]');
    let best = null;
    let bestArea = 0;

    for (const candidate of candidates) {
      if (
        candidate.scrollHeight <= candidate.clientHeight + 100 ||
        candidate.clientHeight <= 200
      ) {
        continue;
      }

      const rect = candidate.getBoundingClientRect();
      const area = rect.width * rect.height;

      if (area > bestArea) {
        bestArea = area;
        best = candidate;
      }
    }

    return best || document.body;
  }

  // ---------------------------------------------------------------------------
  // General helpers
  // ---------------------------------------------------------------------------

  function normalizeText(value) {
    return String(value || '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function shortenText(value, maximumLength = 180) {
    const text = normalizeText(value);

    if (text.length <= maximumLength) {
      return text;
    }

    return `${text.slice(0, maximumLength - 1).trim()}…`;
  }

  function isRendered(element) {
    if (!element || !element.isConnected) return false;

    // Cheap layout test first; display:none elements have no boxes.
    if (element.getClientRects().length === 0) return false;

    return getComputedStyle(element).visibility !== 'hidden';
  }

  function isBefore(first, second) {
    if (!first || !second || first === second) return false;

    return Boolean(
      first.compareDocumentPosition(second) &
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  }

  function compareByDocumentOrder(first, second) {
    if (first.element === second.element) return 0;

    const position = first.element.compareDocumentPosition(
      second.element
    );

    if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
      return -1;
    }

    if (position & Node.DOCUMENT_POSITION_PRECEDING) {
      return 1;
    }

    return 0;
  }

  function getNodeId(element) {
    if (!nodeIds.has(element)) {
      nodeIds.set(element, nextNodeId++);
    }

    return nodeIds.get(element);
  }

  // ---------------------------------------------------------------------------
  // Thinking block detection
  // ---------------------------------------------------------------------------

  function isInsideThinkingBlock(heading) {
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

  function extractUserPrompt(messageElement) {
    const editor = messageElement.querySelector('textarea');

    if (editor && normalizeText(editor.value)) {
      return normalizeText(editor.value);
    }

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

  function getAllModelIcons() {
    const icons = [];

    const avatars = document.querySelectorAll(
      '.w-7.h-7.rounded-full'
    );

    for (const avatar of avatars) {
      if (!avatar.isConnected) continue;

      if (avatar.closest(`#${PANEL_ID}, #${TOGGLE_ID}`)) {
        continue;
      }

      if (avatar.closest(USER_MESSAGE_SELECTOR)) {
        continue;
      }

      if (avatar.closest('button[data-tooltip-id="global"]')) {
        continue;
      }

      let background = '#ffffff';

      const computedStyle = getComputedStyle(avatar);
      const computedBackground = computedStyle.backgroundColor;

      if (
        computedBackground &&
        computedBackground !== 'rgba(0, 0, 0, 0)' &&
        computedBackground !== 'transparent'
      ) {
        background = computedBackground;
      }

      if (avatar.tagName === 'IMG' && avatar.src) {
        icons.push({
          element: avatar,
          iconSrc: avatar.src,
          iconBg: background
        });

        continue;
      }

      const image = avatar.querySelector('img');

      if (image && image.src) {
        icons.push({
          element: avatar,
          iconSrc: image.src,
          iconBg: background
        });

        continue;
      }

      const svg = avatar.querySelector('svg');

      if (!svg) continue;

      try {
        icons.push({
          element: avatar,
          iconSrc: getSvgDataUri(
            svg,
            computedStyle.color || '#000000'
          ),
          iconBg: background
        });
      } catch (error) {
        console.debug(
          '[Page Outline] Could not copy a model icon.',
          error
        );
      }
    }

    return icons;
  }

  function findModelForHeading(heading, modelIcons) {
    const response = heading.closest(AI_RESPONSE_SELECTOR);

    if (response) {
      let closestInsideResponse = null;

      for (const modelIcon of modelIcons) {
        if (
          response.contains(modelIcon.element) &&
          isBefore(modelIcon.element, heading)
        ) {
          closestInsideResponse = modelIcon;
        }
      }

      if (closestInsideResponse) {
        return closestInsideResponse;
      }
    }

    let closestPrecedingIcon = null;

    for (const modelIcon of modelIcons) {
      if (isBefore(modelIcon.element, heading)) {
        closestPrecedingIcon = modelIcon;
      }
    }

    return closestPrecedingIcon;
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

    const userMessages = Array.from(
      container.querySelectorAll(USER_MESSAGE_SELECTOR)
    ).filter(isRendered);

    const aiResponses = Array.from(
      container.querySelectorAll(AI_RESPONSE_SELECTOR)
    ).filter(isRendered);

    let headings = Array.from(
      container.querySelectorAll('h1, h2, h3, h4')
    ).filter(isRendered);

    if (aiResponses.length > 0) {
      headings = headings.filter((heading) => {
        return Boolean(
          heading.closest(AI_RESPONSE_SELECTOR)
        );
      });
    } else {
      headings = headings.filter((heading) => {
        return !heading.closest(USER_MESSAGE_SELECTOR);
      });
    }

    // Skip headings that live inside thinking / reasoning blocks.
    headings = headings.filter((heading) => {
      return !isInsideThinkingBlock(heading);
    });

    const modelIcons = getAllModelIcons();
    const seenModels = new Set();

    const rawItems = [
      ...userMessages.map((element) => ({
        type: 'prompt',
        element
      })),
      ...headings.map((element) => ({
        type: 'heading',
        element
      }))
    ].sort(compareByDocumentOrder);

    const entries = [];

    let inputNumber = 0;
    let headingCount = 0;

    for (const item of rawItems) {
      if (item.type === 'prompt') {
        inputNumber += 1;

        const fullText = extractUserPrompt(item.element);
        const fallbackText = `Input ${inputNumber}`;

        entries.push({
          type: 'prompt',
          element: item.element,
          inputNumber,
          fullText: fullText || fallbackText,
          text: shortenText(fullText || fallbackText)
        });

        continue;
      }

      const text = normalizeText(item.element.textContent);

      if (!text) continue;

      const level = Number.parseInt(
        item.element.tagName.charAt(1),
        10
      );

      let iconSrc = null;
      let iconBg = null;

      const model = findModelForHeading(
        item.element,
        modelIcons
      );

      if (model && !seenModels.has(model.element)) {
        seenModels.add(model.element);
        iconSrc = model.iconSrc;
        iconBg = model.iconBg;
      }

      entries.push({
        type: 'heading',
        element: item.element,
        text,
        level,
        displayLevel: 1,
        iconSrc,
        iconBg
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

  function navigateToElement(element) {
    if (!element || !element.isConnected) {
      refreshOutline();
      return;
    }

    element.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
      inline: 'nearest'
    });

    setTimeout(() => {
      flashElement(element);
    }, 180);
  }

  function makeNavigable(listItem, targetElement) {
    listItem.tabIndex = 0;
    listItem.setAttribute('role', 'button');

    listItem.addEventListener('click', () => {
      navigateToElement(targetElement);
    });

    listItem.addEventListener('keydown', (event) => {
      if (
        event.key !== 'Enter' &&
        event.key !== ' '
      ) {
        return;
      }

      event.preventDefault();
      navigateToElement(targetElement);
    });
  }

  // ---------------------------------------------------------------------------
  // Render outline
  // ---------------------------------------------------------------------------

  function buildOutlineSignature(entries) {
    return entries.map((entry) => {
      const elementId = getNodeId(entry.element);

      if (entry.type === 'prompt') {
        return `p:${elementId}:${entry.fullText}`;
      }

      return [
        'h',
        elementId,
        entry.level,
        entry.text,
        entry.iconSrc ? 'icon' : 'no-icon'
      ].join(':');
    }).join('|');
  }

  function createPromptItem(entry) {
    const item = document.createElement('li');

    item.className = 'outline-item outline-prompt';
    item.title = entry.fullText.slice(0, 1000);

    item.setAttribute(
      'aria-label',
      `Input ${entry.inputNumber}: ${entry.fullText}`
    );

    const text = document.createElement('span');

    text.className = 'outline-prompt-text';
    text.textContent = entry.text;

    item.appendChild(text);

    makeNavigable(item, entry.element);

    return item;
  }

  function createHeadingItem(entry) {
    const item = document.createElement('li');

    item.className = 'outline-item';

    item.setAttribute(
      'data-level',
      String(entry.displayLevel)
    );

    item.title = entry.text;

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

    makeNavigable(item, entry.element);

    return item;
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

    const countParts = [];

    if (inputCount) {
      countParts.push(`${inputCount} inputs`);
    }

    if (headingCount) {
      countParts.push(`${headingCount} headings`);
    }

    countElement.textContent = countParts.join(' · ');

    const signature = buildOutlineSignature(entries);

    if (
      signature === lastOutlineSignature &&
      list.childElementCount > 0
    ) {
      return;
    }

    lastOutlineSignature = signature;

    const previousScrollTop = panel.scrollTop;
    const fragment = document.createDocumentFragment();

    if (entries.length === 0) {
      const emptyItem = document.createElement('li');

      emptyItem.className = 'outline-empty';
      emptyItem.textContent =
        'No inputs or headings found in this chat.';

      fragment.appendChild(emptyItem);
    } else {
      for (const entry of entries) {
        if (entry.type === 'prompt') {
          fragment.appendChild(
            createPromptItem(entry)
          );
        } else {
          fragment.appendChild(
            createHeadingItem(entry)
          );
        }
      }
    }

    list.replaceChildren(fragment);

    // Content height changed, so re-measure the placement.
    positionPanel();

    requestAnimationFrame(() => {
      panel.scrollTop = previousScrollTop;
    });
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

    // Streaming replies mutate the DOM nonstop, which used to reset the
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

  function scheduleVisibilityCheck() {
    if (visibilityTimer) {
      clearTimeout(visibilityTimer);
    }

    visibilityTimer = setTimeout(() => {
      visibilityTimer = null;
      updateButtonVisibility();
    }, VISIBILITY_DEBOUNCE_MS);
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
      const hasRelevantMutation = mutations.some(
        (mutation) => {
          return !mutationBelongsToExtension(mutation);
        }
      );

      if (!hasRelevantMutation) return;

      scheduleRefresh();
      scheduleVisibilityCheck();
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
      buttonPosition = clampPosition(buttonPosition);
      applyButtonPosition();
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

    if (refreshTimer) clearTimeout(refreshTimer);
    if (visibilityTimer) clearTimeout(visibilityTimer);
    if (dragFrame) cancelAnimationFrame(dragFrame);
    if (resizeFrame) cancelAnimationFrame(resizeFrame);

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
    buttonPosition = loadPosition();

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
      getPosition: () => ({ ...buttonPosition })
    };

    console.log(
      `[Page Outline v${VERSION}] Loaded. Drag the button anywhere, ` +
      'double-click it to reset, or press Ctrl/Cmd + Shift + O.'
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
