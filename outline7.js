// TypingMind Page Outline Extension v4.1
// Groups response headings beneath each user input.
// Toggle button or Ctrl/Cmd + Shift + O.

(function () {
  'use strict';

  if (window.__tmPageOutlineV41Loaded) {
    console.log('[Page Outline v4.1] Already loaded.');
    return;
  }

  window.__tmPageOutlineV41Loaded = true;

  const PANEL_ID = 'tm-page-outline-panel';
  const TOGGLE_ID = 'tm-page-outline-toggle';
  const STYLE_ID = 'tm-page-outline-styles-v41';

  const USER_MESSAGE_SELECTOR = '[data-element-id="user-message"]';
  const AI_RESPONSE_SELECTOR = '[data-element-id="ai-response"]';

  let panelVisible = false;
  let refreshTimer = null;
  let visibilityTimer = null;
  let lastOutlineSignature = null;
  let nextNodeId = 1;

  const nodeIds = new WeakMap();
  const flashTimers = new WeakMap();

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
        top: 50px;
        right: 12px;
        z-index: 99999;
        width: 28px;
        height: 28px;
        padding: 0;
        border-radius: 7px;
        border: 1px solid rgba(128, 128, 128, 0.15);
        background: rgba(180, 180, 180, 0.18);
        color: rgba(100, 100, 100, 0.7);
        cursor: pointer;
        display: none;
        align-items: center;
        justify-content: center;
        line-height: 1;
        box-shadow: none;
        transition:
          background 0.2s,
          color 0.2s,
          border-color 0.2s;
        user-select: none;
        -webkit-tap-highlight-color: transparent;
      }

      #${TOGGLE_ID}.chat-visible {
        display: flex;
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

      /* Panel */

      #${PANEL_ID} {
        position: fixed;
        top: 84px;
        right: 12px;
        z-index: 99998;
        width: 270px;
        max-width: calc(100vw - 24px);
        max-height: calc(100vh - 110px);
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
        display: none;
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        transform-origin: top right;
        animation: tmOutlineFadeIn 0.15s ease-out;
      }

      #${PANEL_ID}.visible {
        display: block;
      }

      .dark #${PANEL_ID} {
        background: rgba(28, 28, 32, 0.95);
        color: #ccc;
        border-color: rgba(255, 255, 255, 0.08);
        box-shadow: 0 3px 14px rgba(0, 0, 0, 0.4);
      }

      @keyframes tmOutlineFadeIn {
        from {
          opacity: 0;
          transform: scale(0.95) translateY(-4px);
        }

        to {
          opacity: 1;
          transform: scale(1) translateY(0);
        }
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
        background: rgba(200, 155, 60, 0.06);
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
        background: rgba(210, 165, 70, 0.055);
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
          width: min(290px, calc(100vw - 24px));
        }
      }
    `;

    document.head.appendChild(style);
  }

  // ---------------------------------------------------------------------------
  // UI creation
  // ---------------------------------------------------------------------------

  function createToggleButton() {
    if (document.getElementById(TOGGLE_ID)) return;

    const button = document.createElement('button');

    button.id = TOGGLE_ID;
    button.type = 'button';
    button.title = 'Toggle Outline (Ctrl/Cmd + Shift + O)';
    button.setAttribute('aria-label', 'Toggle chat outline');
    button.setAttribute('aria-expanded', 'false');

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

    button.addEventListener('click', togglePanel);
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
    }
  }

  function togglePanel() {
    setPanelVisibility(!panelVisible);
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

    const style = getComputedStyle(element);

    if (
      style.display === 'none' ||
      style.visibility === 'hidden'
    ) {
      return false;
    }

    return element.getClientRects().length > 0;
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
        const computedColor = computedStyle.color || '#000000';
        const clone = svg.cloneNode(true);

        clone.setAttribute(
          'xmlns',
          'http://www.w3.org/2000/svg'
        );

        let serialized = new XMLSerializer().serializeToString(
          clone
        );

        serialized = serialized.replace(
          /currentColor/gi,
          computedColor
        );

        const dataUri =
          `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;

        icons.push({
          element: avatar,
          iconSrc: dataUri,
          iconBg: background
        });
      } catch (error) {
        console.debug(
          '[Page Outline v4.1] Could not copy a model icon.',
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

    requestAnimationFrame(() => {
      panel.scrollTop = previousScrollTop;
    });
  }

  // ---------------------------------------------------------------------------
  // Refresh scheduling
  // ---------------------------------------------------------------------------

  function scheduleRefresh() {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }

    refreshTimer = setTimeout(() => {
      refreshTimer = null;

      if (panelVisible) {
        refreshOutline();
      }
    }, 450);
  }

  function scheduleVisibilityCheck() {
    if (visibilityTimer) {
      clearTimeout(visibilityTimer);
    }

    visibilityTimer = setTimeout(() => {
      visibilityTimer = null;
      updateButtonVisibility();
    }, 250);
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
    const observer = new MutationObserver((mutations) => {
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
  // Keyboard and mobile behavior
  // ---------------------------------------------------------------------------

  function handleKeydown(event) {
    const modifierPressed =
      event.ctrlKey || event.metaKey;

    const isShortcut =
      modifierPressed &&
      event.shiftKey &&
      event.key.toLowerCase() === 'o';

    if (!isShortcut) return;
    if (!isOnChatPage()) return;

    event.preventDefault();
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

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  function init() {
    injectStyles();
    createToggleButton();
    createPanel();
    startObserver();
    updateButtonVisibility();

    document.addEventListener(
      'keydown',
      handleKeydown
    );

    document.addEventListener(
      'click',
      handleOutsideClick,
      true
    );

    window.addEventListener(
      'resize',
      scheduleVisibilityCheck,
      { passive: true }
    );

    window.addEventListener(
      'popstate',
      scheduleVisibilityCheck
    );

    window.addEventListener(
      'hashchange',
      scheduleVisibilityCheck
    );

    console.log(
      '[Page Outline v4.1] Loaded. Toggle with the button or Ctrl/Cmd + Shift + O.'
    );
  }

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
