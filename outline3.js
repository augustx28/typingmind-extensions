// TypingMind Page Outline Extension v3
// Floating outline/TOC panel from headers in the active chat.
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
        width: 230px;
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
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        border-left: 2px solid transparent;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      #${PANEL_ID} .outline-item > span {
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
      }
      #${PANEL_ID} .outline-model-icon {
        width: 14px;
        height: 14px;
        border-radius: 3px;
        flex-shrink: 0;
        object-fit: contain;
        opacity: 0.7;
      }
      #${PANEL_ID} .outline-item:hover {
        background: rgba(0, 0, 0, 0.03);
        border-left-color: rgba(100, 100, 100, 0.4);
      }
      .dark #${PANEL_ID} .outline-item:hover {
        background: rgba(255, 255, 255, 0.04);
        border-left-color: rgba(200, 200, 200, 0.3);
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
  // Show button only when a chat conversation is active.
  // Checks for the chat input area or message container as signals.
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

    // On mobile only, hide when sidebar/menu is open (covering the chat)
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
      // Also hide panel if navigating away
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

  // ── Find model icon for a heading ───────────────────────────────────────────
  function findModelIcon(headingEl) {
    // Walk up from the heading to find the message container,
    // then look for the model icon (img) within that block.
    let node = headingEl;
    for (let i = 0; i < 20 && node && node !== document.body; i++) {
      node = node.parentElement;
      if (!node) break;

      // Look for an img that's likely a model icon:
      // small image near the top of a message block (avatar/logo area)
      const imgs = node.querySelectorAll('img');
      for (const img of imgs) {
        const src = img.src || '';
        const w = img.naturalWidth || img.width || 0;
        // Model icons are typically small avatars, skip large content images
        if (src && (w <= 80 || img.classList.length > 0) && !src.startsWith('data:image/svg')) {
          // Heuristic: icon is above or beside the heading, not inside response content
          const imgRect = img.getBoundingClientRect();
          const headingRect = headingEl.getBoundingClientRect();
          if (imgRect.top <= headingRect.top + 10) {
            return src;
          }
        }
      }
    }
    return null;
  }

  // ── Scan headings ──────────────────────────────────────────────────────────
  function getHeadings() {
    const container = getChatContainer();
    const headings = container.querySelectorAll('h1, h2, h3, h4');
    const results = [];
    headings.forEach((h, i) => {
      const text = h.textContent.trim();
      if (!text) return;
      const level = parseInt(h.tagName.charAt(1), 10);
      if (!h.id) {
        h.id = `tm-outline-heading-${i}-${Date.now()}`;
      }
      const iconSrc = findModelIcon(h);
      results.push({ text, level, id: h.id, element: h, iconSrc });
    });
    return results;
  }

  // ── Refresh the outline list ───────────────────────────────────────────────
  function refreshOutline() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    const list = panel.querySelector('.outline-list');
    const countEl = panel.querySelector('.outline-count');
    const headings = getHeadings();

    list.innerHTML = '';
    countEl.textContent = headings.length ? `${headings.length}` : '';

    if (headings.length === 0) {
      list.innerHTML = '<li class="outline-empty">No headings in this chat.</li>';
      return;
    }

    const minLevel = Math.min(...headings.map((h) => h.level));

    headings.forEach((h) => {
      const li = document.createElement('li');
      li.className = 'outline-item';
      li.setAttribute('data-level', Math.min(h.level - minLevel + 1, 4));
      li.title = h.text;

      if (h.iconSrc) {
        const icon = document.createElement('img');
        icon.src = h.iconSrc;
        icon.className = 'outline-model-icon';
        icon.alt = '';
        li.appendChild(icon);
      }

      const span = document.createElement('span');
      span.textContent = h.text;
      li.appendChild(span);
      li.addEventListener('click', () => {
        h.element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        const prev = h.element.style.transition;
        const prevBg = h.element.style.backgroundColor;
        h.element.style.transition = 'background-color 0.3s';
        h.element.style.backgroundColor = 'rgba(255, 200, 0, 0.18)';
        setTimeout(() => {
          h.element.style.backgroundColor = prevBg || '';
          setTimeout(() => { h.element.style.transition = prev || ''; }, 300);
        }, 1000);
      });
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
    if (e.ctrlKey && e.shiftKey && e.key === 'O') {
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

    // On mobile, tap anywhere outside panel/button to close
    document.addEventListener('click', (e) => {
      if (!panelVisible || window.innerWidth > 768) return;
      const panel = document.getElementById(PANEL_ID);
      const btn = document.getElementById(TOGGLE_ID);
      if (panel && !panel.contains(e.target) && btn && !btn.contains(e.target)) {
        togglePanel();
      }
    }, true);

    console.log('[Page Outline v3] Loaded. Toggle: button or Ctrl+Shift+O');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
