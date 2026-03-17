// TypingMind Text Highlighter Extension (Desktop + Mobile + Persistence)
(function () {
  const HL = 'tm-user-highlight';
  const TT = 'tm-highlight-tooltip';
  const STORE_KEY = 'tm-highlights-v2';

  // --- Styles (light highlight, no underline) ---
  function injectStyles() {
    const id = 'tm-highlighter-styles';
    if (document.getElementById(id)) return;
    const s = document.createElement('style');
    s.id = id;
    s.textContent = `
      .${HL} {
        background: rgba(255, 223, 120, 0.38);
        border-radius: 3px;
        padding: 1px 2px;
        cursor: pointer;
        transition: background 0.15s ease;
        -webkit-tap-highlight-color: transparent;
      }
      .${HL}:hover {
        background: rgba(255, 223, 120, 0.55);
      }
      .${TT} {
        position: fixed;
        z-index: 99999;
        display: flex;
        gap: 4px;
        padding: 5px 7px;
        background: #1e1e1e;
        border: 1px solid #333;
        border-radius: 10px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.35);
        font-family: 'Inter', sans-serif;
        font-size: 13px;
        font-weight: 600;
        animation: tmTTIn 0.12s ease-out;
        touch-action: manipulation;
      }
      .${TT} button {
        all: unset;
        padding: 8px 16px;
        border-radius: 8px;
        cursor: pointer;
        color: #e0e0e0;
        transition: background 0.1s ease;
        white-space: nowrap;
        -webkit-tap-highlight-color: transparent;
        user-select: none;
        -webkit-user-select: none;
      }
      .${TT} button:hover, .${TT} button:active { background: #333; }
      .${TT} .tm-btn-hl { color: #ffca3d; }
      .${TT} .tm-btn-rm { color: #ff6b6b; }
      @keyframes tmTTIn {
        from { opacity: 0; transform: translateY(4px); }
        to { opacity: 1; transform: translateY(0); }
      }
    `;
    document.head.appendChild(s);
  }

  const isTouch = () => 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  // =============================================
  // PERSISTENCE: localStorage + text matching
  // =============================================
  function getStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; }
    catch { return []; }
  }

  function setStore(arr) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(arr)); } catch {}
  }

  // Get all message containers. TypingMind uses various selectors;
  // we look for the most common assistant/user message wrappers.
  function getMsgContainers() {
    // Broad selector: prose blocks inside message wrappers
    let els = document.querySelectorAll('.prose, [class*="message-content"], [class*="markdown"]');
    if (!els.length) els = document.querySelectorAll('[class*="message"]');
    return Array.from(els);
  }

  function fingerprint(el) {
    // First 120 chars of visible text, trimmed and normalized
    return (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  }

  // Find which occurrence (0-indexed) this highlighted span is within its message
  function occurrenceIndex(hlEl, msgEl, text) {
    const full = msgEl.textContent || '';
    let idx = 0, pos = 0;
    const needle = text;
    // Walk to find the offset of hlEl's text in the full message
    const hlOffset = getTextOffset(msgEl, hlEl);
    while (pos !== -1 && pos <= hlOffset) {
      pos = full.indexOf(needle, pos);
      if (pos === -1) break;
      if (pos === hlOffset) return idx;
      pos += 1;
      idx++;
    }
    return 0;
  }

  function getTextOffset(root, target) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let offset = 0;
    while (walker.nextNode()) {
      if (target.contains(walker.currentNode)) return offset;
      offset += walker.currentNode.textContent.length;
    }
    return offset;
  }

  function saveHighlight(hlEl) {
    const msgEl = hlEl.closest('.prose, [class*="message-content"], [class*="markdown"], [class*="message"]');
    if (!msgEl) return;
    const text = hlEl.textContent;
    const fp = fingerprint(msgEl);
    const occ = occurrenceIndex(hlEl, msgEl, text);
    const store = getStore();
    // Avoid duplicates
    const exists = store.some(h => h.fp === fp && h.text === text && h.occ === occ);
    if (!exists) {
      store.push({ fp, text, occ });
      setStore(store);
    }
  }

  function removeSavedHighlight(hlEl) {
    const msgEl = hlEl.closest('.prose, [class*="message-content"], [class*="markdown"], [class*="message"]');
    if (!msgEl) return;
    const text = hlEl.textContent;
    const fp = fingerprint(msgEl);
    const occ = occurrenceIndex(hlEl, msgEl, text);
    const store = getStore().filter(h => !(h.fp === fp && h.text === text && h.occ === occ));
    setStore(store);
  }

  // Re-apply saved highlights to the current DOM
  function restoreHighlights() {
    const store = getStore();
    if (!store.length) return;

    const containers = getMsgContainers();
    const applied = new Set();

    store.forEach((entry, si) => {
      for (const el of containers) {
        const fp = fingerprint(el);
        if (fp !== entry.fp) continue;

        // Find the Nth occurrence of entry.text in this container
        const full = el.textContent || '';
        let pos = 0, occ = 0;
        while (pos !== -1) {
          pos = full.indexOf(entry.text, pos);
          if (pos === -1) break;
          if (occ === entry.occ) {
            // Check it's not already highlighted
            const key = fp + '|' + entry.text + '|' + entry.occ;
            if (applied.has(key)) break;
            if (wrapTextAtOffset(el, pos, entry.text.length)) {
              applied.add(key);
            }
            break;
          }
          pos += 1;
          occ++;
        }
        break; // Only match first container with this fingerprint
      }
    });
  }

  // Walk text nodes to find the correct offset and wrap
  function wrapTextAtOffset(root, charOffset, length) {
    // Skip if already highlighted at this spot
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let cumulative = 0;

    while (walker.nextNode()) {
      const node = walker.currentNode;
      const nodeLen = node.textContent.length;

      // Check if this text node's parent is already a highlight
      if (node.parentElement && node.parentElement.classList.contains(HL)) {
        cumulative += nodeLen;
        continue;
      }

      if (cumulative + nodeLen > charOffset) {
        const localStart = charOffset - cumulative;
        const localEnd = localStart + length;

        if (localEnd <= nodeLen) {
          const range = document.createRange();
          range.setStart(node, localStart);
          range.setEnd(node, localEnd);
          try {
            const mark = document.createElement('span');
            mark.className = HL;
            range.surroundContents(mark);
            return true;
          } catch { return false; }
        }
        return false; // Spans multiple nodes, skip for safety
      }
      cumulative += nodeLen;
    }
    return false;
  }

  // =============================================
  // TOOLTIP
  // =============================================
  let activeTooltip = null;

  function removeTooltip() {
    if (activeTooltip) { activeTooltip.remove(); activeTooltip = null; }
  }

  function showTooltip(x, y, buttons) {
    removeTooltip();
    const tt = document.createElement('div');
    tt.className = TT;

    buttons.forEach(({ label, cls, onClick }) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      if (cls) btn.classList.add(cls);
      const handler = (e) => { e.preventDefault(); e.stopPropagation(); onClick(); removeTooltip(); };
      btn.addEventListener('click', handler);
      btn.addEventListener('touchend', handler, { passive: false });
      tt.appendChild(btn);
    });

    document.body.appendChild(tt);
    activeTooltip = tt;

    const rect = tt.getBoundingClientRect();
    let px = x - rect.width / 2;
    let py = y - rect.height - 12;
    if (px < 8) px = 8;
    if (px + rect.width > window.innerWidth - 8) px = window.innerWidth - rect.width - 8;
    if (py < 8) py = y + 24;
    tt.style.left = px + 'px';
    tt.style.top = py + 'px';
  }

  // =============================================
  // HIGHLIGHT ACTIONS
  // =============================================
  function wrapSelectionWithHighlight() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
    const range = sel.getRangeAt(0);
    const text = sel.toString().trim();
    if (!text) return false;

    const anc = range.commonAncestorContainer;
    const pEl = anc.nodeType === 3 ? anc.parentElement : anc;
    if (pEl && pEl.closest('.' + HL)) return false;

    try {
      const mark = document.createElement('span');
      mark.className = HL;
      range.surroundContents(mark);
      sel.removeAllRanges();
      saveHighlight(mark);
      return true;
    } catch {
      try {
        const frag = range.extractContents();
        const mark = document.createElement('span');
        mark.className = HL;
        mark.appendChild(frag);
        range.insertNode(mark);
        sel.removeAllRanges();
        saveHighlight(mark);
        return true;
      } catch (e2) {
        console.warn('[Highlighter] Could not highlight:', e2);
        return false;
      }
    }
  }

  function removeHighlight(el) {
    if (!el || !el.classList.contains(HL)) return;
    removeSavedHighlight(el);
    const parent = el.parentNode;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
    parent.normalize();
  }

  // =============================================
  // EVENT HANDLERS
  // =============================================

  // Desktop
  function handleMouseUp(e) {
    if (isTouch()) return;
    if (e.target.closest('.' + TT)) return;
    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel ? sel.toString().trim() : '';
      if (!text) {
        const hl = e.target.closest('.' + HL);
        if (hl) {
          const r = hl.getBoundingClientRect();
          showTooltip(r.left + r.width / 2, r.top, [
            { label: '\u2715 Remove', cls: 'tm-btn-rm', onClick: () => removeHighlight(hl) },
          ]);
        } else { removeTooltip(); }
        return;
      }
      if (sel.rangeCount > 0) {
        const r = sel.getRangeAt(0).getBoundingClientRect();
        if (r.width === 0 && r.height === 0) { removeTooltip(); return; }
        showTooltip(r.left + r.width / 2, r.top, [
          { label: '\u25CF Highlight', cls: 'tm-btn-hl', onClick: () => wrapSelectionWithHighlight() },
        ]);
      }
    }, 10);
  }

  function handleMouseDown(e) {
    if (isTouch()) return;
    if (!e.target.closest('.' + TT)) removeTooltip();
  }

  // Mobile
  let selTimer = null;
  let lastSelText = '';

  function handleSelectionChange() {
    if (!isTouch()) return;
    clearTimeout(selTimer);
    selTimer = setTimeout(() => {
      const sel = window.getSelection();
      const text = sel ? sel.toString().trim() : '';
      if (!text) { if (lastSelText) removeTooltip(); lastSelText = ''; return; }
      if (text === lastSelText && activeTooltip) return;
      lastSelText = text;
      if (sel.rangeCount > 0) {
        const r = sel.getRangeAt(0).getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        showTooltip(r.left + r.width / 2, r.top, [
          { label: '\u25CF Highlight', cls: 'tm-btn-hl', onClick: () => { wrapSelectionWithHighlight(); lastSelText = ''; } },
        ]);
      }
    }, 300);
  }

  function handleTouchEnd(e) {
    if (e.target.closest('.' + TT)) return;
    setTimeout(() => {
      const sel = window.getSelection();
      if (sel && sel.toString().trim()) return;
      const touch = e.changedTouches[0];
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      const hl = el ? el.closest('.' + HL) : null;
      if (hl) {
        const r = hl.getBoundingClientRect();
        showTooltip(r.left + r.width / 2, r.top, [
          { label: '\u2715 Remove', cls: 'tm-btn-rm', onClick: () => removeHighlight(hl) },
        ]);
      } else { removeTooltip(); }
    }, 50);
  }

  function handleTouchStart(e) {
    if (!e.target.closest('.' + TT) && !e.target.closest('.' + HL)) removeTooltip();
  }

  function handleKeydown(e) {
    if (e.ctrlKey && e.shiftKey && e.key === 'H') { e.preventDefault(); wrapSelectionWithHighlight(); }
  }

  // =============================================
  // MUTATION OBSERVER: restore on DOM changes
  // =============================================
  let restoreTimer = null;

  function scheduleRestore() {
    clearTimeout(restoreTimer);
    restoreTimer = setTimeout(() => {
      // Only restore if there are saved highlights and none currently in DOM
      const store = getStore();
      if (!store.length) return;
      const existing = document.querySelectorAll('.' + HL);
      if (existing.length < store.length) {
        restoreHighlights();
      }
    }, 500);
  }

  // =============================================
  // INIT
  // =============================================
  function init() {
    injectStyles();

    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeydown);
    document.addEventListener('selectionchange', handleSelectionChange);
    document.addEventListener('touchend', handleTouchEnd, { passive: true });
    document.addEventListener('touchstart', handleTouchStart, { passive: true });

    // Restore saved highlights
    restoreHighlights();

    // Watch for TypingMind re-rendering messages
    const observer = new MutationObserver(scheduleRestore);
    observer.observe(document.body, { childList: true, subtree: true });

    console.log('[Highlighter] Text Highlighter loaded (desktop + mobile + persistence). Ctrl+Shift+H shortcut.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
