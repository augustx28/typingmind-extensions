/**
 * TypingMind Permanent Highlight Extension
 * Select text in any AI response → permanent highlight that survives chat switches.
 * Works on desktop + mobile PWA. Click highlight to remove.
 * Storage: localStorage key "tmPermanentHighlights"
 */
(() => {
  'use strict';

  const STORAGE_KEY = 'tmPermanentHighlights';
  const HIGHLIGHT_CLASS = 'tm-perm-highlight';
  const BTN_ID = 'tm-highlight-btn';
  const DEBOUNCE_MS = 180;

  // ---------- CSS ----------
  const style = document.createElement('style');
  style.textContent = `
    .${HIGHLIGHT_CLASS} {
      background-color: rgba(250, 204, 21, 0.45) !important;
      border-radius: 3px;
      padding: 0 1px;
      cursor: pointer;
      transition: background-color 0.15s;
      box-decoration-break: clone;
      -webkit-box-decoration-break: clone;
    }
    .dark .${HIGHLIGHT_CLASS},
    html.dark .${HIGHLIGHT_CLASS},
    [data-theme="dark"] .${HIGHLIGHT_CLASS} {
      background-color: rgba(234, 179, 8, 0.35) !important;
      color: inherit;
    }
    .${HIGHLIGHT_CLASS}:hover {
      background-color: rgba(245, 158, 11, 0.65) !important;
    }
    #${BTN_ID} {
      position: absolute;
      z-index: 99999;
      display: none;
      padding: 8px 14px;
      font-size: 13px;
      font-weight: 600;
      color: #fff;
      background: #2563eb;
      border: none;
      border-radius: 9999px;
      box-shadow: 0 4px 14px rgba(0,0,0,0.25);
      cursor: pointer;
      user-select: none;
      -webkit-user-select: none;
      touch-action: manipulation;
      white-space: nowrap;
    }
    #${BTN_ID}:active {
      transform: scale(0.96);
    }
  `;
  document.head.appendChild(style);

  // ---------- Storage helpers ----------
  function loadStore() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch {
      return {};
    }
  }

  function saveStore(store) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  }

  function simpleHash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    }
    return 'h' + (h >>> 0).toString(36);
  }

  function getFingerprint(el) {
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 220);
    return simpleHash(text);
  }

  // ---------- Highlight application ----------
  function wrapTextInElement(root, searchText, hlId) {
    if (!searchText || searchText.length < 2) return false;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (node.parentElement?.closest(`.${HIGHLIGHT_CLASS}`)) return NodeFilter.FILTER_REJECT;
        if (node.parentElement?.closest('script, style, textarea, input')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let node;
    const nodes = [];
    while ((node = walker.nextNode())) nodes.push(node);

    const full = nodes.map(n => n.nodeValue).join('');
    const idx = full.indexOf(searchText);
    if (idx === -1) return false;

    // Map global index back to text nodes and wrap
    let current = 0;
    let startNode = null, startOffset = 0, endNode = null, endOffset = 0;

    for (const n of nodes) {
      const len = n.nodeValue.length;
      if (!startNode && current + len > idx) {
        startNode = n;
        startOffset = idx - current;
      }
      if (startNode && current + len >= idx + searchText.length) {
        endNode = n;
        endOffset = idx + searchText.length - current;
        break;
      }
      current += len;
    }

    if (!startNode || !endNode) return false;

    try {
      const range = document.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);

      const span = document.createElement('span');
      span.className = HIGHLIGHT_CLASS;
      span.dataset.hlId = hlId;
      span.title = 'Click to remove highlight';

      range.surroundContents(span);
      return true;
    } catch (e) {
      // surroundContents fails on partial non-text; fallback simple replace on first text node
      console.warn('[TM Highlight] surround failed, skipping complex range', e);
      return false;
    }
  }

  function applyAllHighlights() {
    const store = loadStore();
    const blocks = document.querySelectorAll('[data-element-id="response-block"]');

    blocks.forEach(block => {
      // Clean previous temporary wrappers that React may have left inconsistent
      block.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach(el => {
        const parent = el.parentNode;
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
        parent.normalize();
      });

      const fp = getFingerprint(block);
      const list = store[fp];
      if (!list || !list.length) return;

      list.forEach(item => {
        wrapTextInElement(block, item.text, item.id);
      });
    });
  }

  // ---------- Floating button ----------
  let btn = document.getElementById(BTN_ID);
  if (!btn) {
    btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.textContent = '★ Highlight';
    btn.type = 'button';
    document.body.appendChild(btn);
  }

  let lastRange = null;
  let lastBlock = null;
  let lastText = '';

  function hideBtn() {
    btn.style.display = 'none';
    lastRange = null;
    lastBlock = null;
    lastText = '';
  }

  function showBtnForSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      hideBtn();
      return;
    }

    const range = sel.getRangeAt(0);
    const text = sel.toString().trim();
    if (text.length < 2) {
      hideBtn();
      return;
    }

    let node = range.commonAncestorContainer;
    if (node.nodeType === 3) node = node.parentElement;
    const block = node?.closest?.('[data-element-id="response-block"]');
    if (!block) {
      hideBtn();
      return;
    }

    // Ensure selection is fully inside the block
    if (!block.contains(range.startContainer) || !block.contains(range.endContainer)) {
      hideBtn();
      return;
    }

    lastRange = range.cloneRange();
    lastBlock = block;
    lastText = text;

    const rect = range.getBoundingClientRect();
    const scrollY = window.scrollY || document.documentElement.scrollTop;
    const scrollX = window.scrollX || document.documentElement.scrollLeft;

    btn.style.left = `${Math.max(8, rect.left + scrollX + rect.width / 2 - 50)}px`;
    btn.style.top = `${rect.bottom + scrollY + 8}px`;
    btn.style.display = 'block';
  }

  // ---------- Events ----------
  function onSelectionChange() {
    // slight delay so mobile selection finishes
    clearTimeout(onSelectionChange._t);
    onSelectionChange._t = setTimeout(showBtnForSelection, 60);
  }

  document.addEventListener('mouseup', onSelectionChange);
  document.addEventListener('touchend', onSelectionChange, { passive: true });
  document.addEventListener('selectionchange', onSelectionChange);

  // Hide when clicking elsewhere
  document.addEventListener('mousedown', (e) => {
    if (e.target !== btn && !btn.contains(e.target)) {
      // delay so button click still registers
      setTimeout(() => {
        if (!window.getSelection()?.toString().trim()) hideBtn();
      }, 10);
    }
  });

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!lastText || !lastBlock) return;

    const fp = getFingerprint(lastBlock);
    const store = loadStore();
    if (!store[fp]) store[fp] = [];

    // avoid exact duplicates
    if (store[fp].some(h => h.text === lastText)) {
      hideBtn();
      window.getSelection()?.removeAllRanges();
      applyAllHighlights();
      return;
    }

    const id = 'hl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    store[fp].push({ id, text: lastText, created: Date.now() });
    saveStore(store);

    hideBtn();
    window.getSelection()?.removeAllRanges();
    applyAllHighlights();
  });

  // Click highlight to remove
  document.addEventListener('click', (e) => {
    const hl = e.target.closest(`.${HIGHLIGHT_CLASS}`);
    if (!hl) return;

    e.preventDefault();
    e.stopPropagation();

    if (!confirm('Remove this permanent highlight?')) return;

    const id = hl.dataset.hlId;
    const store = loadStore();
    let changed = false;

    Object.keys(store).forEach(fp => {
      const before = store[fp].length;
      store[fp] = store[fp].filter(h => h.id !== id);
      if (store[fp].length !== before) changed = true;
      if (store[fp].length === 0) delete store[fp];
    });

    if (changed) {
      saveStore(store);
      // unwrap this one immediately
      const parent = hl.parentNode;
      while (hl.firstChild) parent.insertBefore(hl.firstChild, hl);
      parent.removeChild(hl);
      parent.normalize();
    }
  }, true);

  // ---------- Re-apply on DOM changes (chat switch, new messages, re-renders) ----------
  let debounceTimer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(applyAllHighlights, DEBOUNCE_MS);
  });

  function startObserver() {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: false
    });
  }

  // Initial + delayed applies (TypingMind loads chats async)
  function boot() {
    applyAllHighlights();
    startObserver();
    // extra passes for slow mobile / chat load
    setTimeout(applyAllHighlights, 600);
    setTimeout(applyAllHighlights, 1800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Public helpers
  window.tmClearAllHighlights = function () {
    if (confirm('Delete ALL permanent highlights?')) {
      localStorage.removeItem(STORAGE_KEY);
      applyAllHighlights();
      console.log('[TM Highlight] All cleared');
    }
  };

  window.tmListHighlights = function () {
    console.table(loadStore());
    return loadStore();
  };

  console.log('[TM Permanent Highlight] ready. Select text in AI replies → ★ Highlight. Click highlight to remove. tmClearAllHighlights() / tmListHighlights() available.');
})();
