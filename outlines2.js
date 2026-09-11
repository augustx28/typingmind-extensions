// TypingMind Page Outline v4.4 - COMPLETE REPLACEMENT.
// Replace your previous outline script and its styling add-on.
// Save, then reload TypingMind.

;(function () {
  'use strict';

  const VERSION = '4.4';
  const NAMESPACE = '__tmPageOutline';
  const PANEL_ID = 'tm-page-outline-panel';
  const TOGGLE_ID = 'tm-page-outline-toggle';
  const STYLE_ID = 'tm-page-outline-styles';
  const STORAGE_KEY = 'tm-page-outline-button-position';
  const USER_SELECTOR = '[data-element-id="user-message"]';
  const AI_SELECTOR = '[data-element-id="ai-response"]';

  // Increase these numbers if you want larger text later.
  const DESKTOP_BOOST_PX = 2;
  const MOBILE_BOOST_PX = 3;

  const BUTTON_SIZE = 32;
  const EDGE = 8;
  const GAP = 8;

  const THINKING_SELECTOR = [
    'details',
    '[data-element-id*="thinking"]',
    '[data-element-id*="thought"]',
    '[data-element-id*="reasoning"]',
    '[class*="thinking"]',
    '[class*="thought"]',
    '[class*="reasoning"]'
  ].join(', ');

  const THINKING_LABEL =
    /\b(thought|thoughts|thinking|reasoning|reasoned)\b/i;

  const previous = window[NAMESPACE];

  if (previous && typeof previous.destroy === 'function') {
    try {
      previous.destroy();
    } catch (error) {
      console.debug(error);
    }
  }

  document.querySelectorAll(
    `#${PANEL_ID}, #${TOGGLE_ID}, style[id^="${STYLE_ID}"]`
  ).forEach((node) => node.remove());

  delete window.__tmPageOutlineV42Loaded;

  let button;
  let panel;
  let observer;
  let visible = false;
  let destroyed = false;
  let position = null;
  let drag = null;
  let dragFrame = null;
  let resizeFrame = null;
  let refreshTimer = null;
  let maxRefreshTimer = null;
  let lastDragEnd = -Infinity;
  let lastSignature = null;
  let nextNodeId = 1;

  const nodeIds = new WeakMap();
  const iconCache = new WeakMap();
  const flashTimers = new Map();
  const navigationTimers = new Set();

  // Styles

  function injectStyles() {
    const style = document.createElement('style');
    style.id = STYLE_ID;

    style.textContent = `
      #${TOGGLE_ID},
      #${PANEL_ID},
      #${PANEL_ID} * {
        box-sizing: border-box;
      }

      #${TOGGLE_ID} {
        position: fixed;
        top: 0;
        left: 0;
        z-index: 99999;
        width: ${BUTTON_SIZE}px;
        height: ${BUTTON_SIZE}px;
        min-width: ${BUTTON_SIZE}px;
        min-height: ${BUTTON_SIZE}px;
        margin: 0;
        padding: 0;
        border-radius: 7px;
        border: 1px solid rgba(128,128,128,.22);
        background: rgba(240,240,242,.96);
        color: #606067;
        display: flex !important;
        align-items: center;
        justify-content: center;
        visibility: visible !important;
        opacity: 1 !important;
        pointer-events: auto !important;
        transform: none !important;
        cursor: pointer;
        line-height: 1;
        appearance: none;
        user-select: none;
        -webkit-user-select: none;
        touch-action: none;
        -webkit-tap-highlight-color: transparent;
        transition: background .2s, color .2s, border-color .2s;
      }

      #${TOGGLE_ID}:hover {
        background: #e3e3e7;
        color: #34343b;
      }

      #${TOGGLE_ID}.active {
        background: rgba(200,155,60,.2);
        color: #9a6c20;
        border-color: rgba(200,155,60,.4);
      }

      #${TOGGLE_ID}.dragging {
        cursor: grabbing;
      }

      #${TOGGLE_ID}:focus-visible {
        outline: 2px solid rgba(200,155,60,.8);
        outline-offset: 2px;
      }

      .dark #${TOGGLE_ID} {
        background: rgba(42,42,47,.96);
        color: #c0c0ca;
        border-color: rgba(255,255,255,.14);
      }

      .dark #${TOGGLE_ID}:hover {
        background: #3b3b42;
        color: #eee;
      }

      .dark #${TOGGLE_ID}.active {
        background: rgba(80,65,34,.96);
        color: #dcaf50;
        border-color: rgba(210,165,70,.35);
      }

      body.tm-outline-dragging {
        user-select: none !important;
        -webkit-user-select: none !important;
        cursor: grabbing !important;
      }

      #${PANEL_ID} {
        --tm-outline-font-boost: ${DESKTOP_BOOST_PX}px;
        position: fixed;
        top: 0;
        left: 0;
        z-index: 99998;
        width: 290px;
        max-width: calc(100vw - 16px);
        max-height: calc(100vh - 16px);
        overflow-y: auto;
        overflow-x: hidden;
        overscroll-behavior: contain;
        scroll-padding-block: 48px 8px;
        margin: 0;
        padding: 0;
        border-radius: 12px;
        border: 1px solid rgba(128,128,128,.15);
        background: rgba(255,255,255,.95);
        color: #242428;
        box-shadow: 0 8px 28px rgba(0,0,0,.13);
        font-family:
          Inter,
          -apple-system,
          BlinkMacSystemFont,
          "Segoe UI",
          Roboto,
          sans-serif;
        font-size: calc(12px + var(--tm-outline-font-boost));
        display: block;
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        transform: scale(.96) translateY(-6px);
        transform-origin: top right;
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        transition:
          opacity .18s,
          transform .18s,
          visibility 0s linear .18s;
      }

      #${PANEL_ID}.visible {
        opacity: 1;
        visibility: visible;
        pointer-events: auto;
        transform: none;
        transition: opacity .18s, transform .18s, visibility 0s;
      }

      .dark #${PANEL_ID} {
        background: rgba(28,28,32,.95);
        color: #e6e6e9;
        border-color: rgba(255,255,255,.08);
        box-shadow: 0 8px 28px rgba(0,0,0,.4);
      }

      #${PANEL_ID} .outline-header {
        position: sticky;
        top: 0;
        z-index: 2;
        padding: 10px 12px 9px;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: .65px;
        line-height: 1.4;
        color: #686873;
        background: rgba(255,255,255,.95);
        border-bottom: 1px solid rgba(128,128,128,.1);
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 3px 8px;
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
      }

      .dark #${PANEL_ID} .outline-header {
        color: #aaaab4;
        background: rgba(28,28,32,.95);
        border-bottom-color: rgba(255,255,255,.06);
      }

      #${PANEL_ID} .outline-count {
        margin-left: auto;
        font-size: 11px;
        font-weight: 400;
        text-transform: none;
        letter-spacing: 0;
        font-variant-numeric: tabular-nums;
      }

      #${PANEL_ID} .outline-list {
        list-style: none;
        margin: 0;
        padding: 5px 0 8px;
      }

      #${PANEL_ID} .outline-item {
        min-height: 32px;
        margin: 0;
        padding: 6px 12px;
        cursor: pointer;
        line-height: 1.45;
        white-space: normal;
        border-left: 2px solid transparent;
        display: flex;
        align-items: flex-start;
        gap: 8px;
        transition: background .12s, border-color .12s;
      }

      #${PANEL_ID} .outline-item:hover {
        background: rgba(0,0,0,.035);
        border-left-color: rgba(100,100,100,.4);
      }

      .dark #${PANEL_ID} .outline-item:hover {
        background: rgba(255,255,255,.045);
        border-left-color: rgba(200,200,200,.3);
      }

      #${PANEL_ID} .outline-item:focus-visible {
        outline: 2px solid rgba(190,140,40,.8);
        outline-offset: -2px;
        background: rgba(200,155,60,.08);
      }

      #${PANEL_ID} .outline-item:active {
        background: rgba(200,155,60,.12);
      }

      #${PANEL_ID} .outline-item > span {
        flex: 1 1 auto;
        min-width: 0;
        overflow-wrap: anywhere;
        word-break: break-word;
      }

      #${PANEL_ID} .outline-prompt {
        margin-top: 9px;
        padding: 9px 11px;
        font-size: calc(11px + var(--tm-outline-font-boost));
        font-weight: 600;
        color: #514c40;
        background: rgba(200,155,60,.035);
        border-top: 1px solid rgba(200,155,60,.09);
        border-left-color: rgba(200,155,60,.34);
      }

      #${PANEL_ID} .outline-prompt:first-child {
        margin-top: 0;
      }

      #${PANEL_ID} .outline-prompt:hover {
        background: rgba(200,155,60,.105);
        border-left-color: rgba(190,140,40,.62);
      }

      .dark #${PANEL_ID} .outline-prompt {
        color: #c9bea2;
        background: rgba(210,165,70,.03);
        border-top-color: rgba(210,165,70,.075);
        border-left-color: rgba(210,165,70,.3);
      }

      .dark #${PANEL_ID} .outline-prompt:hover {
        background: rgba(210,165,70,.095);
        border-left-color: rgba(220,175,80,.55);
      }

      #${PANEL_ID} .outline-prompt-text {
        display: -webkit-box;
        overflow: hidden;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        line-clamp: 2;
      }

      #${PANEL_ID} .outline-item[data-level="1"] {
        padding-left: 14px;
        font-weight: 800;
        letter-spacing: -.01em;
        font-size: calc(12px + var(--tm-outline-font-boost));
      }

      #${PANEL_ID} .outline-item[data-level="2"] {
        padding-left: 25px;
        font-weight: 600;
        font-size: calc(11.5px + var(--tm-outline-font-boost));
      }

      #${PANEL_ID} .outline-item[data-level="3"] {
        padding-left: 36px;
        font-weight: 500;
        color: #555560;
        font-size: calc(11px + var(--tm-outline-font-boost));
      }

      #${PANEL_ID} .outline-item[data-level="4"] {
        padding-left: 47px;
        font-weight: 400;
        color: #686873;
        font-size: calc(10.5px + var(--tm-outline-font-boost));
      }

      .dark #${PANEL_ID} .outline-item[data-level="3"] {
        color: #b5b5be;
      }

      .dark #${PANEL_ID} .outline-item[data-level="4"] {
        color: #a0a0ab;
      }

      #${PANEL_ID} .outline-model-icon {
        width: 16px;
        height: 16px;
        min-width: 16px;
        min-height: 16px;
        max-width: 16px;
        max-height: 16px;
        flex: 0 0 16px;
        margin-top: 2px;
        border-radius: 4px;
        object-fit: contain;
        opacity: .9;
      }

      #${PANEL_ID} .outline-empty {
        padding: 16px 12px;
        text-align: center;
        line-height: 1.5;
        color: #686873;
        font-size: calc(11px + var(--tm-outline-font-boost));
      }

      .dark #${PANEL_ID} .outline-empty {
        color: #aaaab4;
      }

      #${PANEL_ID}::-webkit-scrollbar {
        width: 4px;
      }

      #${PANEL_ID}::-webkit-scrollbar-track {
        background: transparent;
      }

      #${PANEL_ID}::-webkit-scrollbar-thumb {
        background: rgba(128,128,128,.23);
        border-radius: 4px;
      }

      .tm-outline-target-flash {
        animation: tmOutlineTargetFlash 1.2s ease-out !important;
        border-radius: 4px;
      }

      @keyframes tmOutlineTargetFlash {
        from {
          background-color: rgba(255,200,0,.32);
        }
        to {
          background-color: transparent;
        }
      }

      @media (max-width: 768px), (pointer: coarse) {
        #${PANEL_ID} {
          --tm-outline-font-boost: ${MOBILE_BOOST_PX}px;
        }

        #${PANEL_ID} .outline-item {
          min-height: 44px;
          padding-top: 10px;
          padding-bottom: 10px;
        }

        #${PANEL_ID} .outline-header,
        #${PANEL_ID} .outline-count {
          font-size: 12px;
        }
      }

      @media (max-width: 768px) {
        #${PANEL_ID} {
          width: min(320px, calc(100vw - 16px));
        }
      }

      @media (prefers-reduced-motion: reduce) {
        #${TOGGLE_ID},
        #${PANEL_ID} {
          transition: none;
          transform: none;
        }

        .tm-outline-target-flash {
          animation: none !important;
        }
      }
    `;

    document.head.appendChild(style);
  }

  // Positioning

  function clamp(value, low, high) {
    return Math.min(Math.max(value, low), high);
  }

  function clampPosition(value) {
    return {
      left: Math.round(
        clamp(
          value.left,
          EDGE,
          Math.max(EDGE, innerWidth - BUTTON_SIZE - EDGE)
        )
      ),
      top: Math.round(
        clamp(
          value.top,
          EDGE,
          Math.max(EDGE, innerHeight - BUTTON_SIZE - EDGE)
        )
      )
    };
  }

  function defaultPosition() {
    return clampPosition({
      left: innerWidth - BUTTON_SIZE - 12,
      top: 50
    });
  }

  function loadPosition() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));

      if (
        saved &&
        Number.isFinite(saved.left) &&
        Number.isFinite(saved.top)
      ) {
        return clampPosition(saved);
      }
    } catch (error) {
      console.debug('[Page Outline] Saved position unavailable.', error);
    }

    return defaultPosition();
  }

  function savePosition() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(position));
    } catch (error) {
      console.debug('[Page Outline] Could not save position.', error);
    }
  }

  function placeButton() {
    if (!button || !position) return;

    button.style.left = `${position.left}px`;
    button.style.top = `${position.top}px`;
  }

  function placePanel() {
    if (!panel || !position) return;

    const below =
      innerHeight - position.top - BUTTON_SIZE - GAP - EDGE;

    const above = position.top - GAP - EDGE;
    const placeBelow = below >= 140 || below >= above;
    const available = Math.max(140, placeBelow ? below : above);

    panel.style.maxHeight = `${
      Math.max(0, Math.min(available, innerHeight - EDGE * 2))
    }px`;

    const width = panel.offsetWidth || 290;
    const height = panel.offsetHeight || 140;

    const alignRight =
      position.left + BUTTON_SIZE / 2 > innerWidth / 2;

    const left = alignRight
      ? position.left + BUTTON_SIZE - width
      : position.left;

    const top = placeBelow
      ? position.top + BUTTON_SIZE + GAP
      : position.top - GAP - height;

    panel.style.left = `${
      Math.round(
        clamp(left, EDGE, Math.max(EDGE, innerWidth - width - EDGE))
      )
    }px`;

    panel.style.top = `${
      Math.round(
        clamp(top, EDGE, Math.max(EDGE, innerHeight - height - EDGE))
      )
    }px`;

    panel.style.transformOrigin =
      `${placeBelow ? 'top' : 'bottom'} ${alignRight ? 'right' : 'left'}`;
  }

  function resetPosition() {
    position = defaultPosition();
    placeButton();
    placePanel();
    savePosition();
  }

  // Dragging

  function onDragStart(event) {
    if (
      event.isPrimary === false ||
      (event.pointerType === 'mouse' && event.button !== 0)
    ) {
      return;
    }

    drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: position.left,
      top: position.top,
      moved: false
    };

    try {
      button.setPointerCapture(event.pointerId);
    } catch (_) {}
  }

  function onDragMove(event) {
    if (!drag || event.pointerId !== drag.id) return;

    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;

    if (
      !drag.moved &&
      Math.abs(dx) < 4 &&
      Math.abs(dy) < 4
    ) {
      return;
    }

    drag.moved = true;
    button.classList.add('dragging');
    document.body.classList.add('tm-outline-dragging');

    if (event.cancelable) event.preventDefault();

    position = clampPosition({
      left: drag.left + dx,
      top: drag.top + dy
    });

    if (dragFrame !== null) return;

    dragFrame = requestAnimationFrame(() => {
      dragFrame = null;
      placeButton();
      if (visible) placePanel();
    });
  }

  function onDragEnd(event) {
    if (!drag || event.pointerId !== drag.id) return;

    const moved = drag.moved;
    const id = drag.id;

    drag = null;

    if (dragFrame !== null) {
      cancelAnimationFrame(dragFrame);
      dragFrame = null;
    }

    button.classList.remove('dragging');
    document.body.classList.remove('tm-outline-dragging');

    try {
      if (button.hasPointerCapture(id)) {
        button.releasePointerCapture(id);
      }
    } catch (_) {}

    if (!moved) return;

    lastDragEnd = performance.now();
    placeButton();

    if (visible) placePanel();

    savePosition();
  }

  // Create the button and panel

  function createUI() {
    button = document.createElement('button');
    button.id = TOGGLE_ID;
    button.type = 'button';

    button.title =
      'Outline · drag to move · double-click to reset · Ctrl/Cmd + Shift + O';

    button.setAttribute('aria-label', 'Toggle chat outline');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', PANEL_ID);

    button.innerHTML = `
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
        aria-hidden="true"
      >
        <path d="M3 6h18M3 12h12M3 18h8"/>
      </svg>
    `;

    button.addEventListener('pointerdown', onDragStart);

    button.addEventListener('click', (event) => {
      if (performance.now() - lastDragEnd < 250) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      toggle();
    });

    button.addEventListener('dblclick', (event) => {
      event.preventDefault();
      resetPosition();
    });

    placeButton();
    document.body.appendChild(button);

    panel = document.createElement('nav');
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
    placePanel();
  }

  // Helpers

  function text(value) {
    return String(value || '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function rendered(element) {
    return Boolean(
      element &&
      element.isConnected &&
      element.getClientRects().length &&
      getComputedStyle(element).visibility !== 'hidden'
    );
  }

  function before(a, b) {
    return Boolean(
      a &&
      b &&
      a !== b &&
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    );
  }

  function nodeId(element) {
    if (!nodeIds.has(element)) {
      nodeIds.set(element, nextNodeId++);
    }

    return nodeIds.get(element);
  }

  function chatContainer() {
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
        element.querySelector(`${USER_SELECTOR}, ${AI_SELECTOR}`)
      ) {
        return element;
      }
    }

    const first = document.querySelector(
      `${USER_SELECTOR}, ${AI_SELECTOR}`
    );

    if (first) {
      let parent = first.parentElement;

      while (parent && parent !== document.body) {
        if (
          parent.querySelectorAll(
            `${USER_SELECTOR}, ${AI_SELECTOR}`
          ).length > 1
        ) {
          return parent;
        }

        parent = parent.parentElement;
      }
    }

    let best = null;
    let area = 0;

    for (const candidate of document.querySelectorAll('div[class]')) {
      if (candidate.closest(`#${PANEL_ID}`)) continue;

      if (
        candidate.scrollHeight <= candidate.clientHeight + 100 ||
        candidate.clientHeight <= 200
      ) {
        continue;
      }

      const rect = candidate.getBoundingClientRect();

      if (rect.width * rect.height > area) {
        best = candidate;
        area = rect.width * rect.height;
      }
    }

    return best || document.body;
  }

  function inThinkingBlock(heading) {
    if (heading.closest(THINKING_SELECTOR)) return true;

    const response = heading.closest(AI_SELECTOR);
    let node = heading.parentElement;

    while (
      node &&
      node !== response &&
      node !== document.body
    ) {
      const label = node.querySelector(
        ':scope > summary, :scope > button, :scope > [role="button"]'
      );

      if (
        label &&
        THINKING_LABEL.test(text(label.textContent).slice(0, 80))
      ) {
        return true;
      }

      node = node.parentElement;
    }

    return false;
  }

  function promptText(element) {
    const editor = element.querySelector('textarea');

    if (editor && text(editor.value)) {
      return text(editor.value);
    }

    const selectors = [
      '[data-element-id="user-message-content"]',
      '[data-element-id="message-content"]',
      '.prose',
      '.markdown-body',
      '[class*="whitespace-pre-wrap"]'
    ];

    for (const selector of selectors) {
      const content = element.querySelector(selector);

      if (content && text(content.textContent)) {
        return text(content.textContent);
      }
    }

    const clone = element.cloneNode(true);

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
    `).forEach((node) => node.remove());

    return text(clone.textContent);
  }

  // Model icons

  function svgData(svg, color) {
    const fingerprint = [
      color,
      svg.childElementCount,
      svg.getAttribute('viewBox') || ''
    ].join('|');

    const cached = iconCache.get(svg);

    if (cached && cached.fingerprint === fingerprint) {
      return cached.data;
    }

    const clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

    const xml = new XMLSerializer()
      .serializeToString(clone)
      .replace(/currentColor/gi, color);

    const data =
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;

    iconCache.set(svg, { fingerprint, data });

    return data;
  }

  function modelIcons() {
    const result = [];

    for (
      const avatar of document.querySelectorAll('.w-7.h-7.rounded-full')
    ) {
      if (
        !avatar.isConnected ||
        avatar.closest(`#${PANEL_ID}, #${TOGGLE_ID}`) ||
        avatar.closest(USER_SELECTOR) ||
        avatar.closest('button[data-tooltip-id="global"]')
      ) {
        continue;
      }

      const computed = getComputedStyle(avatar);
      let background = computed.backgroundColor;

      if (
        !background ||
        background === 'transparent' ||
        background === 'rgba(0, 0, 0, 0)'
      ) {
        background = '#fff';
      }

      const image = avatar.tagName === 'IMG'
        ? avatar
        : avatar.querySelector('img');

      if (image && image.src) {
        result.push({
          element: avatar,
          src: image.src,
          background
        });

        continue;
      }

      const svg = avatar.querySelector('svg');

      if (svg) {
        try {
          result.push({
            element: avatar,
            src: svgData(svg, computed.color || '#000'),
            background
          });
        } catch (error) {
          console.debug('[Page Outline] Could not copy icon.', error);
        }
      }
    }

    return result;
  }

  function headingModel(heading, icons) {
    const response = heading.closest(AI_SELECTOR);
    let inside = null;
    let preceding = null;

    for (const icon of icons) {
      if (!before(icon.element, heading)) continue;

      preceding = icon;

      if (response && response.contains(icon.element)) {
        inside = icon;
      }
    }

    return inside || preceding;
  }

  // Build the grouped outline

  function outlineData() {
    const container = chatContainer();

    const prompts = Array.from(
      container.querySelectorAll(USER_SELECTOR)
    ).filter(rendered);

    const responses = Array.from(
      container.querySelectorAll(AI_SELECTOR)
    ).filter(rendered);

    const headings = Array.from(
      container.querySelectorAll('h1,h2,h3,h4')
    ).filter((heading) =>
      rendered(heading) &&
      !heading.closest(`#${PANEL_ID}, #${TOGGLE_ID}`) &&
      (
        responses.length
          ? heading.closest(AI_SELECTOR)
          : !heading.closest(USER_SELECTOR)
      ) &&
      !inThinkingBlock(heading)
    );

    const items = [
      ...prompts.map((element) => ({
        type: 'prompt',
        element
      })),
      ...headings.map((element) => ({
        type: 'heading',
        element
      }))
    ].sort((a, b) =>
      a.element === b.element
        ? 0
        : before(a.element, b.element) ? -1 : 1
    );

    const icons = modelIcons();
    const seen = new Set();
    const entries = [];

    let inputs = 0;
    let count = 0;

    for (const item of items) {
      if (item.type === 'prompt') {
        inputs++;

        const fullText =
          promptText(item.element) || `Input ${inputs}`;

        entries.push({
          ...item,
          fullText,
          number: inputs,
          text: fullText.length > 180
            ? fullText.slice(0, 179).trim() + '…'
            : fullText
        });
      } else {
        const label = text(item.element.textContent);

        if (!label) continue;

        const model = headingModel(item.element, icons);

        const icon = model && !seen.has(model.element)
          ? model
          : null;

        if (icon) seen.add(icon.element);

        entries.push({
          ...item,
          text: label,
          level: Number(item.element.tagName[1]),
          displayLevel: 1,
          icon
        });

        count++;
      }
    }

    let section = [];

    function finishSection() {
      if (!section.length) return;

      const minimum = Math.min(
        ...section.map((entry) => entry.level)
      );

      for (const entry of section) {
        entry.displayLevel = Math.min(
          entry.level - minimum + 1,
          4
        );
      }

      section = [];
    }

    for (const entry of entries) {
      if (entry.type === 'prompt') {
        finishSection();
      } else {
        section.push(entry);
      }
    }

    finishSection();

    return { entries, inputs, count };
  }

  // Navigate to a heading or prompt

  function navigate(element) {
    if (!element || !element.isConnected) {
      refresh();
      return;
    }

    const reduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;

    element.scrollIntoView({
      behavior: reduced ? 'auto' : 'smooth',
      block: 'start',
      inline: 'nearest'
    });

    if (reduced) return;

    const timer = setTimeout(() => {
      navigationTimers.delete(timer);

      if (destroyed || !element.isConnected) return;

      if (flashTimers.has(element)) {
        clearTimeout(flashTimers.get(element));
      }

      element.classList.remove('tm-outline-target-flash');
      void element.offsetWidth;
      element.classList.add('tm-outline-target-flash');

      flashTimers.set(
        element,
        setTimeout(() => {
          element.classList.remove('tm-outline-target-flash');
          flashTimers.delete(element);
        }, 1250)
      );
    }, 180);

    navigationTimers.add(timer);
  }

  function createItem(entry) {
    const item = document.createElement('li');

    item.className =
      'outline-item' +
      (entry.type === 'prompt' ? ' outline-prompt' : '');

    item.tabIndex = 0;
    item.setAttribute('role', 'button');
    item.title = (entry.fullText || entry.text).slice(0, 1000);

    if (entry.type === 'prompt') {
      item.setAttribute(
        'aria-label',
        `Input ${entry.number}: ${entry.fullText}`
      );
    } else {
      item.setAttribute('data-level', String(entry.displayLevel));

      if (entry.icon) {
        const image = document.createElement('img');

        image.className = 'outline-model-icon';
        image.src = entry.icon.src;
        image.alt = '';
        image.loading = 'lazy';
        image.style.backgroundColor = entry.icon.background;

        image.addEventListener('error', () => image.remove());
        item.appendChild(image);
      }
    }

    const label = document.createElement('span');
    label.textContent = entry.text;

    if (entry.type === 'prompt') {
      label.className = 'outline-prompt-text';
    }

    item.appendChild(label);

    item.addEventListener('click', () => {
      navigate(entry.element);
    });

    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        navigate(entry.element);
      }
    });

    return item;
  }

  // Refresh and render

  function refresh() {
    if (destroyed || !panel) return;

    const list = panel.querySelector('.outline-list');
    const counter = panel.querySelector('.outline-count');
    const { entries, inputs, count } = outlineData();

    counter.textContent = [
      inputs ? `${inputs} input${inputs === 1 ? '' : 's'}` : '',
      count ? `${count} heading${count === 1 ? '' : 's'}` : ''
    ].filter(Boolean).join(' · ');

    const signature = JSON.stringify(
      entries.map((entry) => [
        nodeId(entry.element),
        entry.type,
        entry.fullText || entry.text,
        entry.displayLevel,
        entry.icon ? entry.icon.src : ''
      ])
    );

    if (
      signature === lastSignature &&
      list.childElementCount
    ) {
      placePanel();
      return;
    }

    lastSignature = signature;

    const scrollTop = panel.scrollTop;
    const fragment = document.createDocumentFragment();

    if (!entries.length) {
      const empty = document.createElement('li');

      empty.className = 'outline-empty';
      empty.textContent =
        'No inputs or headings found in this chat.';

      fragment.appendChild(empty);
    } else {
      for (const entry of entries) {
        fragment.appendChild(createItem(entry));
      }
    }

    list.replaceChildren(fragment);
    placePanel();
    panel.scrollTop = scrollTop;
  }

  function clearRefresh() {
    clearTimeout(refreshTimer);
    clearTimeout(maxRefreshTimer);
    refreshTimer = null;
    maxRefreshTimer = null;
  }

  function runRefresh() {
    clearRefresh();

    if (visible && !destroyed) {
      refresh();
    }
  }

  function scheduleRefresh() {
    if (!visible || destroyed) return;

    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(runRefresh, 450);

    if (maxRefreshTimer === null) {
      maxRefreshTimer = setTimeout(runRefresh, 1600);
    }
  }

  // Panel controls

  function setVisible(value) {
    if (destroyed || !panel || !button) return;

    visible = value;

    panel.classList.toggle('visible', value);
    button.classList.toggle('active', value);
    button.setAttribute('aria-expanded', String(value));

    if (value) {
      refresh();
      placePanel();
    } else {
      clearRefresh();
    }
  }

  function toggle() {
    setVisible(!visible);
  }

  function onKeydown(event) {
    if (event.key === 'Escape' && visible) {
      setVisible(false);
      return;
    }

    if (
      !(event.ctrlKey || event.metaKey) ||
      !event.shiftKey ||
      String(event.key).toLowerCase() !== 'o'
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    toggle();
  }

  function onOutsideClick(event) {
    if (
      visible &&
      innerWidth <= 768 &&
      !panel.contains(event.target) &&
      !button.contains(event.target)
    ) {
      setVisible(false);
    }
  }

  function onResize() {
    if (
      resizeFrame !== null ||
      destroyed ||
      !position
    ) {
      return;
    }

    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null;
      position = clampPosition(position);
      placeButton();
      placePanel();
    });
  }

  // Cleanup

  function destroy() {
    if (destroyed) return;

    destroyed = true;

    document.removeEventListener('DOMContentLoaded', init);

    if (observer) observer.disconnect();

    clearRefresh();

    if (dragFrame !== null) {
      cancelAnimationFrame(dragFrame);
    }

    if (resizeFrame !== null) {
      cancelAnimationFrame(resizeFrame);
    }

    for (const timer of navigationTimers) {
      clearTimeout(timer);
    }

    for (const [element, timer] of flashTimers) {
      clearTimeout(timer);
      element.classList.remove('tm-outline-target-flash');
    }

    navigationTimers.clear();
    flashTimers.clear();

    document.removeEventListener('keydown', onKeydown, true);
    document.removeEventListener('click', onOutsideClick, true);

    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    window.removeEventListener('pointercancel', onDragEnd);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('popstate', scheduleRefresh);
    window.removeEventListener('hashchange', scheduleRefresh);

    if (document.body) {
      document.body.classList.remove('tm-outline-dragging');
    }

    document.querySelectorAll(
      `#${PANEL_ID}, #${TOGGLE_ID}, #${STYLE_ID}`
    ).forEach((node) => node.remove());

    if (
      window[NAMESPACE] &&
      window[NAMESPACE].destroy === destroy
    ) {
      delete window[NAMESPACE];
    }
  }

  // Startup

  function init() {
    if (destroyed || !document.body) return;

    position = loadPosition();

    injectStyles();
    createUI();

    document.addEventListener('keydown', onKeydown, true);
    document.addEventListener('click', onOutsideClick, true);

    window.addEventListener(
      'pointermove',
      onDragMove,
      { passive: false }
    );

    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('pointercancel', onDragEnd);
    window.addEventListener(
      'resize',
      onResize,
      { passive: true }
    );

    window.addEventListener('popstate', scheduleRefresh);
    window.addEventListener('hashchange', scheduleRefresh);

    observer = new MutationObserver((mutations) => {
      if (!visible) return;

      const relevant = mutations.some((mutation) => {
        const element =
          mutation.target.nodeType === Node.ELEMENT_NODE
            ? mutation.target
            : mutation.target.parentElement;

        return (
          !element ||
          !element.closest(`#${PANEL_ID}, #${TOGGLE_ID}`)
        );
      });

      if (relevant) scheduleRefresh();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    console.log(
      `[Page Outline v${VERSION}] Ready. ` +
      'Drag the button or press Ctrl/Cmd + Shift + O.'
    );
  }

  window[NAMESPACE] = {
    version: VERSION,
    destroy,
    toggle,
    refresh,
    resetPosition,
    getPosition: () => position ? { ...position } : null
  };

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      init,
      { once: true }
    );
  } else {
    init();
  }
})();
