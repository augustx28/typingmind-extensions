// TypingMind Page Outline Extension v4
// Floating outline/TOC panel from user prompts + headers in the active chat.
// Button only visible on chat pages. Ctrl+Shift+O shortcut.

(function () {
  'use strict';

  const PANEL_ID = 'tm-page-outline-panel';
  const TOGGLE_ID = 'tm-page-outline-toggle';
  const STYLE_ID = 'tm-page-outline-styles';

  // ── Inject Styles ──────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `

      /* ── Toggle Button ──────────────────────────────────────────────── */
      #${TOGGLE_ID} {
        position: fixed;
        top: 50px;
        right: 12px;
        z-index: 99999;
        width: 28px;
        height: 28px;
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
        transition: background 0.2s, color 0.2s;
        user-select: none;
        -webkit-tap-highlight-color: transparent;
        padding: 0;
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
        color: rgba(190, 140, 50, 0.9);
        border-color: rgba(200, 155, 60, 0.3);
      }
      #${TOGGLE_ID}.active:hover {
        background: rgba(200, 155, 60, 0.3);
      }

      .dark #${TOGGLE_ID} {
        background: rgba(255, 255, 255, 0.08);
        color: rgba(200, 200, 200, 0.5);
        border-color: rgba(255, 255, 255, 0.08);
      }
      .dark #${TOGGLE_ID}:hover {
        background: rgba(255, 255, 255, 0.15);
        color: rgba(220, 220, 220, 0.8);
      }
      .dark #${TOGGLE_ID}:active {
        background: rgba(255, 255, 255, 0.2);
      }
      .dark #${TOGGLE_ID}.active {
        background: rgba(210, 165, 70, 0.18);
        color: rgba(220, 175, 80, 0.9);
        border-color: rgba(210, 165, 70, 0.22);
      }
      .dark #${TOGGLE_ID}.active:hover {
        background: rgba(210, 165, 70, 0.28);
      }

      /* ── Panel ──────────────────────────────────────────────────────── */
      #${PANEL_ID} {
        position: fixed;
        top: 84px;
        right: 12px;
        z-index: 99998;
        width: 250px;
        max-height: calc(100vh - 110px);
        overflow-y: auto;
        border-radius: 10px;
        border: 1px solid rgba(128, 128, 128, 0.15);
        background: rgba(255, 255, 255, 0.95);
        color: #222;
        box-shadow: 0 3px 14px rgba(0, 0, 0, 0.1);
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 12px;
        padding: 0;
        display: none;
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        transform-origin: top right;
        animation: tmOutlineFadeIn 0.15s ease-out;
      }
      @keyframes tmOutlineFadeIn {
        from { opacity: 0; transform: scale(0.95) translateY(-4px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
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

      /* ── Panel Header ───────────────────────────────────────────────── */
      #${PANEL_ID} .outline-header {
        padding: 8px 12px 6px;
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: #999;
        border-bottom: 1px solid rgba(128, 128, 128, 0.1);
        display: flex;
        align-items: center;
        justify-content: space-between;
        position: sticky;
        top: 0;
        background: inherit;
        z-index: 1;
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
      }
      .dark #${PANEL_ID} .outline-header {
        color: #666;
        border-bottom-color: rgba(255, 255, 255, 0.06);
      }

      #${PANEL_ID} .outline-header .outline-count {
        font-weight: 400;
        font-size: 9px;
        color: #bbb;
      }
      .dark #${PANEL_ID} .outline-header .outline-count {
        color: #555;
      }

      /* ── Outline List ───────────────────────────────────────────────── */
      #${PANEL_ID} .outline-list {
        list-style: none;
        margin: 0;
        padding: 4px 0;
      }

      #${PANEL_ID} .outline-item {
        padding: 4px 12px;
        cursor: pointer;
        transition: background 0.12s;
        line-height: 1.35;
        white-space: normal;
        overflow: visible;
        text-overflow: clip;
        border-left: 2px solid transparent;
        display: flex;
        align-items: flex-start;
        gap: 6px;
      }
      #${PANEL_ID} .outline-item > span {
        overflow: visible;
        text-overflow: clip;
        white-space: normal;
        overflow-wrap: anywhere;
        word-break: break-word;
        min-width: 0;
      }
      #${PANEL_ID} .outline-model-icon {
        width: 16px;
        height: 16px;
        min-width: 16px;
        min-height: 16px;
        max-width: 16px;
        max-height: 16px;
        border-radius: 4px;
        flex-shrink: 0;
        object-fit: contain;
        opacity: 0.85;
      }
      .dark #${PANEL_ID} .outline-model-icon {
        opacity: 0.9;
      }
      #${PANEL_ID} .outline-item:hover {
        background: rgba(0, 0, 0, 0.03);
        border-left-color: rgba(100, 100, 100, 0.4);
      }
      .dark #${PANEL_ID} .outline-item:hover {
        background: rgba(255, 255, 255, 0.04);
        border-left-color: rgba(200, 200, 200, 0.3);
      }

      /* User prompt section rows */
      #${PANEL_ID} .outline-item.outline-user {
        margin-top: 6px;
        padding: 7px 10px 7px 10px;
        border-left: 2px solid rgba(59, 130, 246, 0.55);
        background: rgba(59, 130, 246, 0.06);
        border-radius: 0 6px 6px 0;
        font-weight: 600;
        font-size: 11.5px;
        color: #1e3a5f;
        gap: 7px;
      }
      #${PANEL_ID} .outline-item.outline-user:first-child {
        margin-top: 2px;
      }
      #${PANEL_ID} .outline-item.outline-user:hover {
        background: rgba(59, 130, 246, 0.12);
        border-left-color: rgba(59, 130, 246, 0.8);
      }
      .dark #${PANEL_ID} .outline-item.outline-user {
        border-left-color: rgba(96, 165, 250, 0.55);
        background: rgba(96, 165, 250, 0.08);
        color: #bfdbfe;
      }
      .dark #${PANEL_ID} .outline-item.outline-user:hover {
        background: rgba(96, 165, 250, 0.14);
        border-left-color: rgba(96, 165, 250, 0.85);
      }

      #${PANEL_ID} .outline-user-badge {
        flex-shrink: 0;
        width: 16px;
        height: 16px;
        min-width: 16px;
        border-radius: 4px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: rgba(59, 130, 246, 0.18);
        color: #2563eb;
        font-size: 8px;
        font-weight: 700;
        letter-spacing: 0;
        line-height: 1;
        margin-top: 1px;
      }
      .dark #${PANEL_ID} .outline-user-badge {
        background: rgba(96, 165, 250, 0.18);
        color: #93c5fd;
      }

      #${PANEL_ID} .outline-user-text {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        font-weight: 600;
      }

      #${PANEL_ID} .outline-item[data-level="1"] {
        font-weight: 600;
        font-size: 12px;
        padding-left: 12px;
      }
      #${PANEL_ID} .outline-item[data-level="2"] {
        font-weight: 500;
        font-size: 11.5px;
        padding-left: 22px;
      }
      #${PANEL_ID} .outline-item[data-level="3"] {
        font-weight: 400;
        font-size: 11px;
        padding-left: 32px;
        color: #666;
      }
      .dark #${PANEL_ID} .outline-item[data-level="3"] {
        color: #888;
      }
      #${PANEL_ID} .outline-item[data-level="4"] {
        font-weight: 400;
        font-size: 10.5px;
        padding-left: 42px;
        color: #888;
      }
      .dark #${PANEL_ID} .outline-item[data-level="4"] {
        color: #666;
      }

      #${PANEL_ID} .outline-empty {
        padding: 16px 12px;
        text-align: center;
        color: #aaa;
        font-size: 11px;
      }
      .dark #${PANEL_ID} .outline-empty {
        color: #555;
      }

      /* ── Scrollbar ──────────────────────────────────────────────────── */
      #${PANEL_ID}::-webkit-scrollbar { width: 3px; }
      #${PANEL_ID}::-webkit-scrollbar-track { background: transparent; }
      #${PANEL_ID}::-webkit-scrollbar-thumb {
        background: rgba(128, 128, 128, 0.2);
        border-radius: 3px;
      }
    `;
    document.head.appendChild(style);
  }

  // ── Create UI Elements ─────────────────────────────────────────────────────
  function createToggleButton() {
    if (document.getElementById(TOGGLE_ID)) return;
    const btn = document.createElement('button');
    btn.id = TOGGLE_ID;
    btn.title = 'Toggle Outline (Ctrl+Shift+O)';
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="11" y2="18"/></svg>`;
    btn.addEventListener('click', togglePanel);
    document.body.appendChild(btn);
  }

  function createPanel() {
    if (document.getElementById(PANEL_ID)) return;
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="outline-header">
        <span>Outline</span>
        <span class="outline-count"></span>
      </div>
      <ul class="outline-list"></ul>
    `;
    document.body.appendChild(panel);
  }

  // ── Chat page detection ────────────────────────────────────────────────────
  function isOnChatPage() {
    const chatSignals = [
      '[data-element-id="chat-space-middle-part"]',
      '[data-element-id="chat-space"]',
      '[data-element-id="chat-input-textbox"]',
      'textarea[placeholder*="message"]',
      'textarea[placeholder*="Message"]',
    ];
    let hasChat = false;
    for (const sel of chatSignals) {
      if (document.querySelector(sel)) { hasChat = true; break; }
    }
    if (!hasChat) return false;

    if (window.innerWidth <= 768) {
      const sidebarSelectors = [
        '[data-element-id="side-bar"]',
        '[data-element-id="sidebar"]',
        '[data-element-id="side-bar-background"]',
        '[data-element-id="sidebar-background"]',
      ];
      for (const sel of sidebarSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 100 && rect.right > 0 && rect.left < window.innerWidth) {
            return false;
          }
        }
      }
    }

    return true;
  }

  function updateButtonVisibility() {
    const btn = document.getElementById(TOGGLE_ID);
    if (!btn) return;
    if (isOnChatPage()) {
      btn.classList.add('chat-visible');
    } else {
      btn.classList.remove('chat-visible');
      if (panelVisible) {
        panelVisible = false;
        const panel = document.getElementById(PANEL_ID);
        if (panel) panel.classList.remove('visible');
        btn.classList.remove('active');
      }
    }
  }

  // ── Toggle Logic ───────────────────────────────────────────────────────────
  let panelVisible = false;

  function togglePanel() {
    const panel = document.getElementById(PANEL_ID);
    const btn = document.getElementById(TOGGLE_ID);
    if (!panel) return;

    panelVisible = !panelVisible;
    panel.classList.toggle('visible', panelVisible);
    if (btn) btn.classList.toggle('active', panelVisible);
    if (panelVisible) refreshOutline();
  }

  // ── Find the chat scroll container ─────────────────────────────────────────
  function getChatContainer() {
    const selectors = [
      '[data-element-id="chat-space-middle-part"]',
      '[data-element-id="chat-space"]',
      '.chat-messages',
      'main',
      '[role="main"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    const candidates = document.querySelectorAll('div[class]');
    let best = null;
    let bestArea = 0;
    for (const c of candidates) {
      if (c.scrollHeight > c.clientHeight + 100 && c.clientHeight > 200) {
        const rect = c.getBoundingClientRect();
        const area = rect.width * rect.height;
        if (area > bestArea) {
          bestArea = area;
          best = c;
        }
      }
    }
    return best || document.body;
  }

  // ── Model icons ────────────────────────────────────────────────────────────
  function getAllModelIcons() {
    const icons = [];
    const avatars = document.querySelectorAll('.w-7.h-7.rounded-full');

    for (const avatar of avatars) {
      if (avatar.closest('button[data-tooltip-id="global"]')) continue;

      let bg = '#ffffff';
      const c = getComputedStyle(avatar).backgroundColor;
      if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') bg = c;

      if (avatar.tagName === 'IMG' && avatar.src) {
        icons.push({ element: avatar, iconSrc: avatar.src, iconBg: bg });
        continue;
      }

      const img = avatar.querySelector('img');
      if (img && img.src) {
        icons.push({ element: avatar, iconSrc: img.src, iconBg: bg });
        continue;
      }

      const svg = avatar.querySelector('svg');
      if (svg) {
        try {
          const computedColor = getComputedStyle(avatar).color || '#000000';
          const clone = svg.cloneNode(true);
          clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
          let str = new XMLSerializer().serializeToString(clone);
          str = str.replace(/currentColor/gi, computedColor);
          const dataUri = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(str)));
          icons.push({ element: avatar, iconSrc: dataUri, iconBg: bg });
        } catch (e) { /* skip */ }
      }
    }

    return icons;
  }

  function findModelForHeading(heading, modelIcons) {
    let closest = null;
    for (const mi of modelIcons) {
      const order = heading.compareDocumentPosition(mi.element);
      if (order & Node.DOCUMENT_POSITION_PRECEDING) {
        closest = mi;
      }
    }
    return closest;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function ensureId(el, prefix, index) {
    if (el.id) return el.id;
    el.id = `${prefix}-${index}`;
    return el.id;
  }

  function cleanText(raw) {
    return (raw || '').replace(/\s+/g, ' ').trim();
  }

  function truncate(text, max) {
    if (!text) return '';
    if (text.length <= max) return text;
    return text.slice(0, max - 1).trimEnd() + '…';
  }

  // ── Build outline items: user prompts + headings in DOM order ──────────────
  function getOutlineItems() {
    const container = getChatContainer();
    const modelIcons = getAllModelIcons();
    const nodes = [];

    // User prompts
    const userMessages = container.querySelectorAll('[data-element-id="user-message"]');
    userMessages.forEach((el, i) => {
      // Prefer direct text content, skip empty / attachment-only shells
      const text = cleanText(el.innerText || el.textContent);
      if (!text) return;

      const id = ensureId(el, 'tm-outline-user', i);
      nodes.push({
        type: 'user',
        text: truncate(text, 120),
        fullText: text,
        level: 0,
        id,
        element: el,
        iconSrc: null,
        iconBg: null,
      });
    });

    // Headings from AI responses (skip anything inside a user message)
    const headings = container.querySelectorAll('h1, h2, h3, h4');
    const seenModels = new Set();

    headings.forEach((h, i) => {
      if (h.closest('[data-element-id="user-message"]')) return;
      // Skip outline panel itself if somehow nested
      if (h.closest(`#${PANEL_ID}`)) return;

      const text = cleanText(h.textContent);
      if (!text) return;

      const level = parseInt(h.tagName.charAt(1), 10);
      const id = ensureId(h, 'tm-outline-heading', i);

      let iconSrc = null;
      let iconBg = null;
      const model = findModelForHeading(h, modelIcons);
      if (model && !seenModels.has(model.element)) {
        seenModels.add(model.element);
        iconSrc = model.iconSrc;
        iconBg = model.iconBg;
      }

      nodes.push({
        type: 'heading',
        text: truncate(text, 140),
        fullText: text,
        level,
        id,
        element: h,
        iconSrc,
        iconBg,
      });
    });

    // Sort by document order
    nodes.sort((a, b) => {
      if (a.element === b.element) return 0;
      const pos = a.element.compareDocumentPosition(b.element);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });

    return nodes;
  }

  function flashElement(el) {
    if (!el) return;
    const prev = el.style.transition;
    const prevBg = el.style.backgroundColor;
    el.style.transition = 'background-color 0.3s';
    el.style.backgroundColor = 'rgba(255, 200, 0, 0.18)';
    setTimeout(() => {
      el.style.backgroundColor = prevBg || '';
      setTimeout(() => { el.style.transition = prev || ''; }, 300);
    }, 1000);
  }

  function scrollToItem(item) {
    item.element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    flashElement(item.element);
  }

  // ── Refresh the outline list ───────────────────────────────────────────────
  function refreshOutline() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    const list = panel.querySelector('.outline-list');
    const countEl = panel.querySelector('.outline-count');
    const items = getOutlineItems();

    list.innerHTML = '';

    const promptCount = items.filter((i) => i.type === 'user').length;
    const headingCount = items.filter((i) => i.type === 'heading').length;

    if (items.length === 0) {
      countEl.textContent = '';
      list.innerHTML = '<li class="outline-empty">No prompts or headings in this chat.</li>';
      return;
    }

    if (promptCount && headingCount) {
      countEl.textContent = `${promptCount} · ${headingCount}`;
      countEl.title = `${promptCount} prompts, ${headingCount} headings`;
    } else if (promptCount) {
      countEl.textContent = `${promptCount}`;
      countEl.title = `${promptCount} prompts`;
    } else {
      countEl.textContent = `${headingCount}`;
      countEl.title = `${headingCount} headings`;
    }

    const headingLevels = items.filter((i) => i.type === 'heading').map((i) => i.level);
    const minLevel = headingLevels.length ? Math.min(...headingLevels) : 1;

    items.forEach((item) => {
      const li = document.createElement('li');
      li.className = 'outline-item';
      li.title = item.fullText;

      if (item.type === 'user') {
        li.classList.add('outline-user');

        const badge = document.createElement('span');
        badge.className = 'outline-user-badge';
        badge.textContent = 'You';
        badge.setAttribute('aria-hidden', 'true');
        li.appendChild(badge);

        const span = document.createElement('span');
        span.className = 'outline-user-text';
        span.textContent = item.text;
        li.appendChild(span);
      } else {
        li.setAttribute('data-level', Math.min(item.level - minLevel + 1, 4));

        if (item.iconSrc) {
          const icon = document.createElement('img');
          icon.src = item.iconSrc;
          icon.className = 'outline-model-icon';
          icon.alt = '';
          icon.style.backgroundColor = item.iconBg || 'white';
          li.appendChild(icon);
        }

        const span = document.createElement('span');
        span.textContent = item.text;
        li.appendChild(span);
      }

      li.addEventListener('click', () => scrollToItem(item));
      list.appendChild(li);
    });
  }

  // ── Auto-refresh on DOM changes ────────────────────────────────────────────
  let refreshTimer = null;
  let visibilityTimer = null;

  function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      if (panelVisible) refreshOutline();
    }, 500);
  }

  function scheduleVisibilityCheck() {
    if (visibilityTimer) clearTimeout(visibilityTimer);
    visibilityTimer = setTimeout(updateButtonVisibility, 300);
  }

  function startObserver() {
    const observer = new MutationObserver(() => {
      scheduleRefresh();
      scheduleVisibilityCheck();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ── Keyboard shortcut ──────────────────────────────────────────────────────
  function handleKeydown(e) {
    if (e.ctrlKey && e.shiftKey && (e.key === 'O' || e.key === 'o')) {
      e.preventDefault();
      if (isOnChatPage()) togglePanel();
    }
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  function init() {
    injectStyles();
    createToggleButton();
    createPanel();
    startObserver();
    updateButtonVisibility();
    document.addEventListener('keydown', handleKeydown);

    document.addEventListener('click', (e) => {
      if (!panelVisible || window.innerWidth > 768) return;
      const panel = document.getElementById(PANEL_ID);
      const btn = document.getElementById(TOGGLE_ID);
      if (panel && !panel.contains(e.target) && btn && !btn.contains(e.target)) {
        togglePanel();
      }
    }, true);

    console.log('[Page Outline v4] Loaded. Toggle: button or Ctrl+Shift+O');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
