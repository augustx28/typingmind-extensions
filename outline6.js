// TypingMind Page Outline Extension v4
// Groups AI response headings beneath each user question.
// Toggle with Ctrl+Shift+O or Cmd+Shift+O.

(function () {
  'use strict';

  const INSTANCE_KEY = '__tmPageOutlineV4';

  // Cleanly remove a previous v4 instance if the extension is reloaded.
  if (window[INSTANCE_KEY]?.destroy) {
    try {
      window[INSTANCE_KEY].destroy();
    } catch (_) {}
  }

  const PANEL_ID = 'tm-page-outline-panel-v4';
  const TOGGLE_ID = 'tm-page-outline-toggle-v4';
  const STYLE_ID = 'tm-page-outline-styles-v4';

  const CONFIG = {
    PANEL_WIDTH: 260,
    PROMPT_PREVIEW_CHARS: 180,
    TITLE_MAX_CHARS: 1000,
    REFRESH_DELAY: 250,
    VISIBILITY_DELAY: 250,

    // Set this to false if you only want questions that contain AI headings.
    SHOW_ALL_QUESTIONS: true,
  };

  let panelVisible = false;
  let initialized = false;
  let destroyed = false;
  let observer = null;
  let refreshTimer = null;
  let visibilityTimer = null;
  let visibilityInterval = null;
  let lastOutlineSignature = null;

  const iconCache = new WeakMap();
  const nodeIds = new WeakMap();
  let nextNodeId = 1;

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------

  function injectStyles() {
    const oldStyle = document.getElementById(STYLE_ID);
    if (oldStyle) oldStyle.remove();

    const style = document.createElement('style');
    style.id = STYLE_ID;

    style.textContent = `
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
          border-color 0.2s,
          transform 0.12s;
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
        transform: scale(0.94);
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
        color: rgba(230, 230, 230, 0.85);
      }

      .dark #${TOGGLE_ID}.active {
        background: rgba(210, 165, 70, 0.18);
        color: rgba(225, 180, 85, 0.95);
        border-color: rgba(210, 165, 70, 0.24);
      }

      #${PANEL_ID} {
        position: fixed;
        top: 84px;
        right: 12px;
        z-index: 99998;
        width: ${CONFIG.PANEL_WIDTH}px;
        max-width: calc(100vw - 24px);
        max-height: calc(100vh - 110px);
        padding: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
        border-radius: 10px;
        border: 1px solid rgba(128, 128, 128, 0.15);
        background: rgba(255, 255, 255, 0.96);
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
        display: none;
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        transform-origin: top right;
        animation: tmOutlineV4FadeIn 0.15s ease-out;
      }

      #${PANEL_ID}.visible {
        display: block;
      }

      .dark #${PANEL_ID} {
        background: rgba(28, 28, 32, 0.96);
        color: #ccc;
        border-color: rgba(255, 255, 255, 0.08);
        box-shadow: 0 3px 14px rgba(0, 0, 0, 0.4);
      }

      @keyframes tmOutlineV4FadeIn {
        from {
          opacity: 0;
          transform: scale(0.95) translateY(-4px);
        }

        to {
          opacity: 1;
          transform: scale(1) translateY(0);
        }
      }

      #${PANEL_ID} .outline-header {
        position: sticky;
        top: 0;
        z-index: 4;
        padding: 8px 12px 7px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-bottom: 1px solid rgba(128, 128, 128, 0.12);
        background: rgba(255, 255, 255, 0.96);
        color: #8b8b8b;
        font-size: 10px;
        font-weight: 650;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
      }

      .dark #${PANEL_ID} .outline-header {
        background: rgba(28, 28, 32, 0.96);
        color: #737373;
        border-bottom-color: rgba(255, 255, 255, 0.06);
      }

      #${PANEL_ID} .outline-count {
        color: #aaa;
        font-size: 9px;
        font-weight: 450;
        letter-spacing: 0;
        text-transform: none;
      }

      .dark #${PANEL_ID} .outline-count {
        color: #646464;
      }

      #${PANEL_ID} .outline-list {
        list-style: none;
        margin: 0;
        padding: 4px 0 6px;
      }

      #${PANEL_ID} .outline-entry {
        list-style: none;
        margin: 0;
        padding: 0;
      }

      #${PANEL_ID} .outline-row {
        width: 100%;
        margin: 0;
        border: 0;
        border-left: 2px solid transparent;
        background: transparent;
        color: inherit;
        cursor: pointer;
        display: flex;
        align-items: flex-start;
        gap: 6px;
        text-align: left;
        font: inherit;
        line-height: 1.35;
        transition:
          background 0.12s,
          border-color 0.12s,
          color 0.12s;
      }

      #${PANEL_ID} .outline-row:hover {
        background: rgba(0, 0, 0, 0.035);
        border-left-color: rgba(100, 100, 100, 0.4);
      }

      .dark #${PANEL_ID} .outline-row:hover {
        background: rgba(255, 255, 255, 0.045);
        border-left-color: rgba(200, 200, 200, 0.3);
      }

      #${PANEL_ID} .outline-row.selected {
        background: rgba(200, 155, 60, 0.1);
        border-left-color: rgba(200, 155, 60, 0.65);
      }

      .dark #${PANEL_ID} .outline-row.selected {
        background: rgba(210, 165, 70, 0.1);
        border-left-color: rgba(220, 175, 80, 0.65);
      }

      #${PANEL_ID} .outline-row:focus-visible {
        outline: 2px solid rgba(200, 155, 60, 0.55);
        outline-offset: -2px;
      }

      #${PANEL_ID} .outline-prompt-item {
        margin-top: 5px;
        padding-top: 5px;
        border-top: 1px solid rgba(128, 128, 128, 0.11);
      }

      #${PANEL_ID} .outline-prompt-item:first-child {
        margin-top: 0;
        padding-top: 0;
        border-top: 0;
      }

      .dark #${PANEL_ID} .outline-prompt-item {
        border-top-color: rgba(255, 255, 255, 0.07);
      }

      #${PANEL_ID} .outline-prompt-row {
        padding: 7px 9px 7px 9px;
        background: rgba(200, 155, 60, 0.055);
        border-left-color: rgba(200, 155, 60, 0.28);
        font-size: 11px;
        font-weight: 560;
      }

      #${PANEL_ID} .outline-prompt-row:hover {
        background: rgba(200, 155, 60, 0.11);
        border-left-color: rgba(200, 155, 60, 0.65);
      }

      .dark #${PANEL_ID} .outline-prompt-row {
        background: rgba(210, 165, 70, 0.055);
        border-left-color: rgba(210, 165, 70, 0.24);
      }

      .dark #${PANEL_ID} .outline-prompt-row:hover {
        background: rgba(210, 165, 70, 0.11);
        border-left-color: rgba(220, 175, 80, 0.65);
      }

      #${PANEL_ID} .outline-question-badge {
        flex: 0 0 auto;
        min-width: 24px;
        height: 18px;
        padding: 0 5px;
        border-radius: 5px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: rgba(200, 155, 60, 0.15);
        color: rgba(160, 112, 25, 0.95);
        font-size: 9px;
        font-weight: 700;
        line-height: 1;
      }

      .dark #${PANEL_ID} .outline-question-badge {
        background: rgba(210, 165, 70, 0.14);
        color: rgba(225, 180, 85, 0.95);
      }

      #${PANEL_ID} .outline-question-text {
        min-width: 0;
        flex: 1 1 auto;
        overflow: hidden;
        overflow-wrap: anywhere;
        word-break: break-word;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 3;
      }

      #${PANEL_ID} .outline-question-heading-count {
        flex: 0 0 auto;
        margin-top: 1px;
        min-width: 17px;
        height: 17px;
        border-radius: 9px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: rgba(128, 128, 128, 0.1);
        color: #999;
        font-size: 8.5px;
        font-weight: 550;
      }

      .dark #${PANEL_ID} .outline-question-heading-count {
        background: rgba(255, 255, 255, 0.07);
        color: #777;
      }

      #${PANEL_ID} .outline-heading-row {
        padding-top: 4px;
        padding-bottom: 4px;
        padding-right: 10px;
      }

      #${PANEL_ID} .outline-heading-item[data-level="1"] .outline-heading-row {
        padding-left: 12px;
        font-size: 12px;
        font-weight: 620;
      }

      #${PANEL_ID} .outline-heading-item[data-level="2"] .outline-heading-row {
        padding-left: 22px;
        font-size: 11.5px;
        font-weight: 520;
      }

      #${PANEL_ID} .outline-heading-item[data-level="3"] .outline-heading-row {
        padding-left: 32px;
        color: #666;
        font-size: 11px;
        font-weight: 420;
      }

      .dark #${PANEL_ID} .outline-heading-item[data-level="3"] .outline-heading-row {
        color: #909090;
      }

      #${PANEL_ID} .outline-heading-item[data-level="4"] .outline-heading-row {
        padding-left: 42px;
        color: #888;
        font-size: 10.5px;
        font-weight: 400;
      }

      .dark #${PANEL_ID} .outline-heading-item[data-level="4"] .outline-heading-row {
        color: #707070;
      }

      #${PANEL_ID} .outline-item-text {
        min-width: 0;
        flex: 1 1 auto;
        white-space: normal;
        overflow-wrap: anywhere;
        word-break: break-word;
      }

      #${PANEL_ID} .outline-model-icon {
        width: 16px;
        height: 16px;
        min-width: 16px;
        min-height: 16px;
        max-width: 16px;
        max-height: 16px;
        border-radius: 4px;
        flex: 0 0 auto;
        object-fit: contain;
        opacity: 0.88;
      }

      .dark #${PANEL_ID} .outline-model-icon {
        opacity: 0.92;
      }

      #${PANEL_ID} .outline-empty {
        padding: 18px 12px;
        color: #aaa;
        font-size: 11px;
        text-align: center;
      }

      .dark #${PANEL_ID} .outline-empty {
        color: #606060;
      }

      #${PANEL_ID}::-webkit-scrollbar {
        width: 4px;
      }

      #${PANEL_ID}::-webkit-scrollbar-track {
        background: transparent;
      }

      #${PANEL_ID}::-webkit-scrollbar-thumb {
        background: rgba(128, 128, 128, 0.22);
        border-radius: 4px;
      }

      .tm-outline-v4-target-flash {
        animation: tmOutlineV4TargetFlash 1.15s ease-out !important;
        border-radius: 5px;
      }

      @keyframes tmOutlineV4TargetFlash {
        0% {
          background-color: rgba(255, 200, 0, 0);
          box-shadow: 0 0 0 0 rgba(255, 200, 0, 0);
        }

        22% {
          background-color: rgba(255, 200, 0, 0.2);
          box-shadow: 0 0 0 4px rgba(255, 200, 0, 0.12);
        }

        100% {
          background-color: rgba(255, 200, 0, 0);
          box-shadow: 0 0 0 0 rgba(255, 200, 0, 0);
        }
      }

      @media (max-width: 768px) {
        #${PANEL_ID} {
          right: 10px;
          width: min(${CONFIG.PANEL_WIDTH}px, calc(100vw - 20px));
          max-height: calc(100vh - 105px);
        }

        #${TOGGLE_ID} {
          right: 10px;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        #${PANEL_ID},
        #${TOGGLE_ID},
        #${PANEL_ID} .outline-row,
        .tm-outline-v4-target-flash {
          animation: none !important;
          transition: none !important;
          scroll-behavior: auto !important;
        }
      }
    `;

    document.head.appendChild(style);
  }

  // ---------------------------------------------------------------------------
  // UI creation
  // ---------------------------------------------------------------------------

  function removeLegacyUi() {
    [
      'tm-page-outline-panel',
      'tm-page-outline-toggle',
      'tm-page-outline-styles',
      PANEL_ID,
      TOGGLE_ID,
      STYLE_ID,
    ].forEach((id) => {
      document.getElementById(id)?.remove();
    });
  }

  function createToggleButton() {
    const button = document.createElement('button');

    button.id = TOGGLE_ID;
    button.type = 'button';
    button.title = 'Toggle chat outline (Ctrl/Command + Shift + O)';
    button.setAttribute('aria-label', 'Toggle chat outline');
    button.setAttribute('aria-controls', PANEL_ID);
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
    const panel = document.createElement('nav');

    panel.id = PANEL_ID;
    panel.setAttribute('aria-label', 'Chat questions and response outline');

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
      '[data-element-id="message-input"]',
      'textarea[placeholder*="message" i]',
    ];

    if (!chatSignals.some((selector) => document.querySelector(selector))) {
      return false;
    }

    if (window.innerWidth <= 768) {
      const sidebarSelectors = [
        '[data-element-id="side-bar"]',
        '[data-element-id="sidebar"]',
        '[data-element-id="side-bar-background"]',
        '[data-element-id="sidebar-background"]',
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

  function getChatContainer() {
    const selectors = [
      '[data-element-id="chat-space-middle-part"]',
      '[data-element-id="chat-space"]',
      '.chat-messages',
      'main',
      '[role="main"]',
    ];

    let bestElement = null;
    let bestScore = -1;

    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);

      for (const element of elements) {
        if (
          element.id === PANEL_ID ||
          element.closest(`#${PANEL_ID}`)
        ) {
          continue;
        }

        const rect = element.getBoundingClientRect();

        let score = 0;
        score += element.querySelectorAll(
          '[data-element-id="user-message"]'
        ).length * 5;

        score += element.querySelectorAll(
          '[data-element-id="ai-response"]'
        ).length * 3;

        if (rect.width > 150 && rect.height > 150) {
          score += 2;
        }

        if (score > bestScore) {
          bestScore = score;
          bestElement = element;
        }
      }

      if (bestElement && bestScore > 2) {
        return bestElement;
      }
    }

    return bestElement || document.body;
  }

  function updateButtonVisibility() {
    if (destroyed) return;

    const button = document.getElementById(TOGGLE_ID);
    if (!button) return;

    const onChatPage = isOnChatPage();

    button.classList.toggle('chat-visible', onChatPage);
    button.setAttribute('aria-hidden', String(!onChatPage));

    if (!onChatPage && panelVisible) {
      setPanelVisibility(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Panel state
  // ---------------------------------------------------------------------------

  function setPanelVisibility(visible) {
    const panel = document.getElementById(PANEL_ID);
    const button = document.getElementById(TOGGLE_ID);

    if (!panel || !button) return;

    panelVisible = Boolean(visible);

    panel.classList.toggle('visible', panelVisible);
    button.classList.toggle('active', panelVisible);
    button.setAttribute('aria-expanded', String(panelVisible));

    if (panelVisible) {
      refreshOutline();
    }
  }

  function togglePanel() {
    if (!isOnChatPage() && !panelVisible) return;
    setPanelVisibility(!panelVisible);
  }

  // ---------------------------------------------------------------------------
  // Text helpers
  // ---------------------------------------------------------------------------

  function normalizeText(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function shortenText(text, maxLength) {
    const normalized = normalizeText(text);

    if (normalized.length <= maxLength) {
      return normalized;
    }

    return `${normalized.slice(0, Math.max(1, maxLength - 1)).trim()}…`;
  }

  function extractUserMessageText(element) {
    const clone = element.cloneNode(true);

    clone.querySelectorAll(`
      button,
      script,
      style,
      svg,
      .sr-only,
      [aria-hidden="true"],
      [data-element-id="additional-actions-of-response-container"]
    `).forEach((node) => node.remove());

    return normalizeText(clone.textContent);
  }

  function getNodeId(element) {
    if (!element || typeof element !== 'object') return 'none';

    if (!nodeIds.has(element)) {
      nodeIds.set(element, nextNodeId++);
    }

    return nodeIds.get(element);
  }

  function compareDomElements(a, b) {
    if (a.element === b.element) return 0;

    const position = a.element.compareDocumentPosition(b.element);

    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;

    return 0;
  }

  // ---------------------------------------------------------------------------
  // Model icons
  // ---------------------------------------------------------------------------

  function extractIconInfo(avatar) {
    if (!avatar) return null;

    if (iconCache.has(avatar)) {
      return iconCache.get(avatar);
    }

    let background = '#ffffff';
    const computedStyle = getComputedStyle(avatar);
    const computedBackground = computedStyle.backgroundColor;

    if (
      computedBackground &&
      computedBackground !== 'transparent' &&
      computedBackground !== 'rgba(0, 0, 0, 0)'
    ) {
      background = computedBackground;
    }

    let result = null;

    const image =
      avatar.tagName === 'IMG'
        ? avatar
        : avatar.querySelector('img');

    if (image && (image.currentSrc || image.src)) {
      result = {
        iconSrc: image.currentSrc || image.src,
        iconBg: background,
      };

      iconCache.set(avatar, result);
      return result;
    }

    const svg =
      avatar.tagName === 'SVG'
        ? avatar
        : avatar.querySelector('svg');

    if (svg) {
      try {
        const clone = svg.cloneNode(true);
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

        const resolvedColor =
          getComputedStyle(avatar).color || '#000000';

        let serialized = new XMLSerializer().serializeToString(clone);
        serialized = serialized.replace(
          /currentColor/gi,
          resolvedColor
        );

        result = {
          iconSrc:
            'data:image/svg+xml;charset=utf-8,' +
            encodeURIComponent(serialized),
          iconBg: background,
        };
      } catch (_) {
        result = null;
      }
    }

    iconCache.set(avatar, result);
    return result;
  }

  function getAllModelIcons(container) {
    const models = [];
    const avatars = container.querySelectorAll(
      '.w-7.h-7.rounded-full'
    );

    for (const avatar of avatars) {
      if (avatar.closest('button[data-tooltip-id="global"]')) {
        continue;
      }

      const info = extractIconInfo(avatar);
      if (!info) continue;

      models.push({
        element: avatar,
        info,
      });
    }

    return models;
  }

  function findFallbackModelForHeading(heading, models) {
    let closest = null;

    for (const model of models) {
      const position = heading.compareDocumentPosition(
        model.element
      );

      if (position & Node.DOCUMENT_POSITION_PRECEDING) {
        closest = model;
      }
    }

    return closest;
  }

  function getModelMarkerForHeading(
    heading,
    fallbackModels
  ) {
    const responseBlock = heading.closest(
      '[data-element-id="response-block"]'
    );

    if (responseBlock) {
      const avatarContainer =
        responseBlock.querySelector(
          '[data-element-id="chat-avatar-container"]'
        ) || responseBlock;

      let avatar = null;

      if (
        avatarContainer.matches?.(
          '.w-7.h-7.rounded-full'
        )
      ) {
        avatar = avatarContainer;
      } else {
        avatar = avatarContainer.querySelector(
          '.w-7.h-7.rounded-full'
        );
      }

      const info = extractIconInfo(avatar);

      if (info) {
        return {
          key: responseBlock,
          info,
        };
      }
    }

    const fallback = findFallbackModelForHeading(
      heading,
      fallbackModels
    );

    if (!fallback) return null;

    return {
      key: fallback.element,
      info: fallback.info,
    };
  }

  // ---------------------------------------------------------------------------
  // Collect questions and headings
  // ---------------------------------------------------------------------------

  function getAssistantHeadingElements(container) {
    const headingSet = new Set();
    const assistantRoots = container.querySelectorAll(
      '[data-element-id="ai-response"]'
    );

    if (assistantRoots.length) {
      assistantRoots.forEach((root) => {
        root.querySelectorAll('h1, h2, h3, h4').forEach(
          (heading) => headingSet.add(heading)
        );
      });
    } else {
      // Fallback for future TypingMind markup changes.
      container
        .querySelectorAll('h1, h2, h3, h4')
        .forEach((heading) => {
          if (
            !heading.closest(
              '[data-element-id="user-message"]'
            ) &&
            !heading.closest(`#${PANEL_ID}`)
          ) {
            headingSet.add(heading);
          }
        });
    }

    return [...headingSet];
  }

  function collectOutlineData() {
    const container = getChatContainer();
    const nodes = [];

    const promptElements = [
      ...new Set(
        container.querySelectorAll(
          '[data-element-id="user-message"]'
        )
      ),
    ];

    for (const element of promptElements) {
      const extractedText = extractUserMessageText(element);

      nodes.push({
        type: 'prompt',
        element,
        text:
          extractedText ||
          'Image or attachment message',
      });
    }

    const headingElements =
      getAssistantHeadingElements(container);

    for (const element of headingElements) {
      const text = normalizeText(element.textContent);
      if (!text) continue;

      nodes.push({
        type: 'heading',
        element,
        text,
        level: Number.parseInt(
          element.tagName.slice(1),
          10
        ),
      });
    }

    nodes.sort(compareDomElements);

    const fallbackModels = getAllModelIcons(container);
    const seenModelMarkers = new WeakSet();

    const groups = [];
    const orphanHeadings = [];
    let currentGroup = null;

    for (const node of nodes) {
      if (node.type === 'prompt') {
        currentGroup = {
          prompt: node,
          headings: [],
        };

        groups.push(currentGroup);
        continue;
      }

      const marker = getModelMarkerForHeading(
        node.element,
        fallbackModels
      );

      node.iconSrc = null;
      node.iconBg = null;
      node.iconKey = null;

      if (
        marker &&
        marker.key &&
        !seenModelMarkers.has(marker.key)
      ) {
        seenModelMarkers.add(marker.key);

        node.iconSrc = marker.info.iconSrc;
        node.iconBg = marker.info.iconBg;
        node.iconKey = marker.key;
      }

      if (currentGroup) {
        currentGroup.headings.push(node);
      } else {
        orphanHeadings.push(node);
      }
    }

    const visibleGroups = CONFIG.SHOW_ALL_QUESTIONS
      ? groups
      : groups.filter((group) => group.headings.length);

    return {
      container,
      groups: visibleGroups,
      orphanHeadings,
    };
  }

  function createOutlineSignature(data) {
    const parts = [
      `container:${getNodeId(data.container)}`,
    ];

    for (const heading of data.orphanHeadings) {
      parts.push(
        [
          'orphan',
          getNodeId(heading.element),
          heading.level,
          heading.text,
          getNodeId(heading.iconKey),
        ].join(':')
      );
    }

    for (const group of data.groups) {
      parts.push(
        [
          'prompt',
          getNodeId(group.prompt.element),
          group.prompt.text,
        ].join(':')
      );

      for (const heading of group.headings) {
        parts.push(
          [
            'heading',
            getNodeId(heading.element),
            heading.level,
            heading.text,
            getNodeId(heading.iconKey),
          ].join(':')
        );
      }
    }

    return parts.join('|');
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  function getScrollBehavior() {
    return window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches
      ? 'auto'
      : 'smooth';
  }

  function navigateToElement(target, selectedRow) {
    if (!target?.isConnected) {
      scheduleRefresh();
      return;
    }

    const panel = document.getElementById(PANEL_ID);

    panel
      ?.querySelectorAll('.outline-row.selected')
      .forEach((row) => {
        row.classList.remove('selected');
        row.removeAttribute('aria-current');
      });

    selectedRow.classList.add('selected');
    selectedRow.setAttribute('aria-current', 'location');

    target.scrollIntoView({
      behavior: getScrollBehavior(),
      block: 'center',
      inline: 'nearest',
    });

    target.classList.remove(
      'tm-outline-v4-target-flash'
    );

    // Force the animation to restart if the same target is clicked twice.
    void target.offsetWidth;

    target.classList.add(
      'tm-outline-v4-target-flash'
    );

    window.setTimeout(() => {
      target.classList.remove(
        'tm-outline-v4-target-flash'
      );
    }, 1200);

    if (window.innerWidth <= 768) {
      window.setTimeout(() => {
        setPanelVisibility(false);
      }, 80);
    }
  }

  // ---------------------------------------------------------------------------
  // Outline rendering
  // ---------------------------------------------------------------------------

  function createPromptItem(group, questionNumber) {
    const item = document.createElement('li');
    item.className =
      'outline-entry outline-prompt-item';

    const row = document.createElement('button');
    row.type = 'button';
    row.className =
      'outline-row outline-prompt-row';

    const fullText = group.prompt.text;
    const previewText = shortenText(
      fullText,
      CONFIG.PROMPT_PREVIEW_CHARS
    );

    row.title = shortenText(
      fullText,
      CONFIG.TITLE_MAX_CHARS
    );

    row.setAttribute(
      'aria-label',
      `Question ${questionNumber}: ${previewText}`
    );

    const badge = document.createElement('span');
    badge.className = 'outline-question-badge';
    badge.textContent = `Q${questionNumber}`;
    badge.setAttribute('aria-hidden', 'true');

    const text = document.createElement('span');
    text.className = 'outline-question-text';
    text.textContent = previewText;

    row.appendChild(badge);
    row.appendChild(text);

    if (group.headings.length) {
      const count = document.createElement('span');
      count.className =
        'outline-question-heading-count';
      count.textContent = String(group.headings.length);
      count.title = `${group.headings.length} headings`;
      count.setAttribute('aria-hidden', 'true');
      row.appendChild(count);
    }

    row.addEventListener('click', () => {
      navigateToElement(group.prompt.element, row);
    });

    item.appendChild(row);
    return item;
  }

  function createHeadingItem(heading, normalizedLevel) {
    const item = document.createElement('li');

    item.className =
      'outline-entry outline-heading-item';

    item.setAttribute(
      'data-level',
      String(Math.min(Math.max(normalizedLevel, 1), 4))
    );

    const row = document.createElement('button');
    row.type = 'button';
    row.className =
      'outline-row outline-heading-row';

    row.title = shortenText(
      heading.text,
      CONFIG.TITLE_MAX_CHARS
    );

    row.setAttribute(
      'aria-label',
      `Heading: ${heading.text}`
    );

    if (heading.iconSrc) {
      const icon = document.createElement('img');

      icon.src = heading.iconSrc;
      icon.className = 'outline-model-icon';
      icon.alt = '';
      icon.setAttribute('aria-hidden', 'true');
      icon.style.backgroundColor =
        heading.iconBg || 'white';

      row.appendChild(icon);
    }

    const text = document.createElement('span');
    text.className = 'outline-item-text';
    text.textContent = heading.text;

    row.appendChild(text);

    row.addEventListener('click', () => {
      navigateToElement(heading.element, row);
    });

    item.appendChild(row);
    return item;
  }

  function appendHeadings(
    fragment,
    headings
  ) {
    if (!headings.length) return;

    const minimumLevel = Math.min(
      ...headings.map((heading) => heading.level)
    );

    for (const heading of headings) {
      const normalizedLevel =
        heading.level - minimumLevel + 1;

      fragment.appendChild(
        createHeadingItem(
          heading,
          normalizedLevel
        )
      );
    }
  }

  function refreshOutline() {
    if (destroyed || !panelVisible) return;

    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    const list = panel.querySelector('.outline-list');
    const countElement =
      panel.querySelector('.outline-count');

    if (!list || !countElement) return;

    const data = collectOutlineData();
    const signature = createOutlineSignature(data);

    // Skip rebuilding the panel when regular AI streaming text changes
    // but the questions and headings stay the same.
    if (signature === lastOutlineSignature) {
      return;
    }

    lastOutlineSignature = signature;

    const previousScrollTop = panel.scrollTop;
    const fragment = document.createDocumentFragment();

    const promptCount = data.groups.length;

    const headingCount =
      data.orphanHeadings.length +
      data.groups.reduce(
        (total, group) => total + group.headings.length,
        0
      );

    const countParts = [];

    if (promptCount) countParts.push(`${promptCount} Q`);
    if (headingCount) countParts.push(`${headingCount} H`);

    countElement.textContent = countParts.join(' · ');

    appendHeadings(fragment, data.orphanHeadings);

    data.groups.forEach((group, index) => {
      fragment.appendChild(
        createPromptItem(group, index + 1)
      );

      appendHeadings(fragment, group.headings);
    });

    if (!promptCount && !headingCount) {
      const empty = document.createElement('li');
      empty.className = 'outline-empty';
      empty.textContent =
        'No questions or response headings found.';
      fragment.appendChild(empty);
    }

    list.replaceChildren(fragment);

    panel.scrollTop = Math.min(
      previousScrollTop,
      Math.max(0, panel.scrollHeight - panel.clientHeight)
    );
  }

  // ---------------------------------------------------------------------------
  // Mutation handling
  // ---------------------------------------------------------------------------

  function isInsideExtensionUi(node) {
    const element =
      node?.nodeType === Node.ELEMENT_NODE
        ? node
        : node?.parentElement;

    if (!element) return false;

    return Boolean(
      element.id === PANEL_ID ||
        element.id === TOGGLE_ID ||
        element.closest?.(
          `#${PANEL_ID}, #${TOGGLE_ID}`
        )
    );
  }

  function nodeMatchesOrContains(node, selector) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    return Boolean(
      node.matches?.(selector) ||
        node.querySelector?.(selector)
    );
  }

  function mutationAffectsOutline(mutation) {
    const relevantSelector = [
      '[data-element-id="user-message"]',
      '[data-element-id="response-block"]',
      '[data-element-id="chat-space-middle-part"]',
      '.w-7.h-7.rounded-full',
      'h1',
      'h2',
      'h3',
      'h4',
    ].join(',');

    const targetElement =
      mutation.target.nodeType === Node.ELEMENT_NODE
        ? mutation.target
        : mutation.target.parentElement;

    if (
      targetElement?.closest?.(
        '[data-element-id="user-message"], h1, h2, h3, h4'
      )
    ) {
      return true;
    }

    if (
      mutation.type === 'attributes' &&
      targetElement?.closest?.(
        '.w-7.h-7.rounded-full'
      )
    ) {
      return true;
    }

    if (mutation.type === 'childList') {
      const changedNodes = [
        ...mutation.addedNodes,
        ...mutation.removedNodes,
      ];

      return changedNodes.some((node) =>
        nodeMatchesOrContains(node, relevantSelector)
      );
    }

    return false;
  }

  function scheduleRefresh() {
    if (destroyed) return;

    window.clearTimeout(refreshTimer);

    refreshTimer = window.setTimeout(() => {
      if (panelVisible) refreshOutline();
    }, CONFIG.REFRESH_DELAY);
  }

  function scheduleVisibilityCheck() {
    if (destroyed) return;

    window.clearTimeout(visibilityTimer);

    visibilityTimer = window.setTimeout(
      updateButtonVisibility,
      CONFIG.VISIBILITY_DELAY
    );
  }

  function startObserver() {
    observer = new MutationObserver((mutations) => {
      let hasExternalMutation = false;
      let outlineChanged = false;

      for (const mutation of mutations) {
        if (isInsideExtensionUi(mutation.target)) {
          continue;
        }

        hasExternalMutation = true;

        if (mutationAffectsOutline(mutation)) {
          outlineChanged = true;
        }
      }

      if (!hasExternalMutation) return;

      scheduleVisibilityCheck();

      if (outlineChanged && panelVisible) {
        scheduleRefresh();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['src'],
    });
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  function handleKeydown(event) {
    if (event.repeat) return;

    if (
      event.key === 'Escape' &&
      panelVisible
    ) {
      event.preventDefault();
      setPanelVisibility(false);
      return;
    }

    const modifierPressed =
      event.ctrlKey || event.metaKey;

    if (
      modifierPressed &&
      event.shiftKey &&
      event.key.toLowerCase() === 'o'
    ) {
      event.preventDefault();

      if (isOnChatPage()) {
        togglePanel();
      }
    }
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

    if (
      panel &&
      !panel.contains(event.target) &&
      button &&
      !button.contains(event.target)
    ) {
      setPanelVisibility(false);
    }
  }

  function handleWindowChange() {
    scheduleVisibilityCheck();

    if (panelVisible) {
      scheduleRefresh();
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  function init() {
    if (initialized || destroyed || !document.body) {
      return;
    }

    initialized = true;

    removeLegacyUi();
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
      handleWindowChange,
      { passive: true }
    );

    window.addEventListener(
      'popstate',
      handleWindowChange
    );

    window.addEventListener(
      'hashchange',
      handleWindowChange
    );

    // Backup check for SPA navigation that changes no relevant DOM nodes.
    visibilityInterval = window.setInterval(
      updateButtonVisibility,
      2000
    );

    console.log(
      '[TypingMind Chat Outline v4] Loaded.'
    );
  }

  function destroy() {
    if (destroyed) return;

    destroyed = true;
    observer?.disconnect();

    window.clearTimeout(refreshTimer);
    window.clearTimeout(visibilityTimer);
    window.clearInterval(visibilityInterval);

    document.removeEventListener(
      'DOMContentLoaded',
      init
    );

    document.removeEventListener(
      'keydown',
      handleKeydown
    );

    document.removeEventListener(
      'click',
      handleOutsideClick,
      true
    );

    window.removeEventListener(
      'resize',
      handleWindowChange
    );

    window.removeEventListener(
      'popstate',
      handleWindowChange
    );

    window.removeEventListener(
      'hashchange',
      handleWindowChange
    );

    document.getElementById(PANEL_ID)?.remove();
    document.getElementById(TOGGLE_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();

    if (window[INSTANCE_KEY]?.destroy === destroy) {
      delete window[INSTANCE_KEY];
    }
  }

  window[INSTANCE_KEY] = { destroy };

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
