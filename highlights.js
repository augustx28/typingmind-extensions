// TypingMind Text Highlighter Extension (Desktop + Mobile)
// Select text to highlight, tap/click highlight to remove
(function () {
  const HIGHLIGHT_CLASS = 'tm-user-highlight';
  const TOOLTIP_CLASS = 'tm-highlight-tooltip';

  // --- Styles ---
  function injectStyles() {
    const id = 'tm-highlighter-styles';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      .${HIGHLIGHT_CLASS} {
        background: rgba(255, 196, 61, 0.35);
        border-bottom: 2px solid rgba(255, 170, 0, 0.6);
        border-radius: 3px;
        padding: 1px 2px;
        cursor: pointer;
        transition: background 0.15s ease;
        -webkit-tap-highlight-color: transparent;
      }
      .${HIGHLIGHT_CLASS}:hover {
        background: rgba(255, 196, 61, 0.55);
      }
      .${TOOLTIP_CLASS} {
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
        animation: tmTooltipIn 0.12s ease-out;
        touch-action: manipulation;
      }
      .${TOOLTIP_CLASS} button {
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
      .${TOOLTIP_CLASS} button:hover,
      .${TOOLTIP_CLASS} button:active {
        background: #333;
      }
      .${TOOLTIP_CLASS} .tm-btn-highlight {
        color: #ffca3d;
      }
      .${TOOLTIP_CLASS} .tm-btn-remove {
        color: #ff6b6b;
      }
      @keyframes tmTooltipIn {
        from { opacity: 0; transform: translateY(4px); }
        to { opacity: 1; transform: translateY(0); }
      }
    `;
    document.head.appendChild(style);
  }

  // --- Device detection ---
  const isTouchDevice = () => 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  // --- Tooltip Management ---
  let activeTooltip = null;

  function removeTooltip() {
    if (activeTooltip) {
      activeTooltip.remove();
      activeTooltip = null;
    }
  }

  function showTooltip(x, y, buttons) {
    removeTooltip();
    const tooltip = document.createElement('div');
    tooltip.className = TOOLTIP_CLASS;

    buttons.forEach(({ label, cls, onClick }) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      if (cls) btn.classList.add(cls);

      const handler = (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
        removeTooltip();
      };
      btn.addEventListener('click', handler);
      btn.addEventListener('touchend', handler, { passive: false });

      tooltip.appendChild(btn);
    });

    document.body.appendChild(tooltip);
    activeTooltip = tooltip;

    const rect = tooltip.getBoundingClientRect();
    let posX = x - rect.width / 2;
    let posY = y - rect.height - 12;
    if (posX < 8) posX = 8;
    if (posX + rect.width > window.innerWidth - 8) posX = window.innerWidth - rect.width - 8;
    if (posY < 8) posY = y + 24;

    tooltip.style.left = posX + 'px';
    tooltip.style.top = posY + 'px';
  }

  // --- Highlight Logic ---
  function wrapSelectionWithHighlight() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false;

    const range = selection.getRangeAt(0);
    const text = selection.toString().trim();
    if (!text) return false;

    const ancestor = range.commonAncestorContainer;
    const parentEl = ancestor.nodeType === 3 ? ancestor.parentElement : ancestor;
    if (parentEl && parentEl.closest('.' + HIGHLIGHT_CLASS)) return false;

    try {
      const mark = document.createElement('span');
      mark.className = HIGHLIGHT_CLASS;
      mark.dataset.hlId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      range.surroundContents(mark);
      selection.removeAllRanges();
      return true;
    } catch (e) {
      try {
        const fragment = range.extractContents();
        const mark = document.createElement('span');
        mark.className = HIGHLIGHT_CLASS;
        mark.dataset.hlId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        mark.appendChild(fragment);
        range.insertNode(mark);
        selection.removeAllRanges();
        return true;
      } catch (e2) {
        console.warn('[Highlighter] Could not highlight this selection:', e2);
        return false;
      }
    }
  }

  function removeHighlight(el) {
    if (!el || !el.classList.contains(HIGHLIGHT_CLASS)) return;
    const parent = el.parentNode;
    while (el.firstChild) {
      parent.insertBefore(el.firstChild, el);
    }
    parent.removeChild(el);
    parent.normalize();
  }

  // --- Desktop: mouse events ---
  function handleMouseUp(e) {
    if (isTouchDevice()) return;
    if (e.target.closest('.' + TOOLTIP_CLASS)) return;

    setTimeout(() => {
      const selection = window.getSelection();
      const selectedText = selection ? selection.toString().trim() : '';

      if (!selectedText) {
        const hlEl = e.target.closest('.' + HIGHLIGHT_CLASS);
        if (hlEl) {
          const rect = hlEl.getBoundingClientRect();
          showTooltip(rect.left + rect.width / 2, rect.top, [
            { label: '\u2715 Remove', cls: 'tm-btn-remove', onClick: () => removeHighlight(hlEl) },
          ]);
        } else {
          removeTooltip();
        }
        return;
      }

      if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) { removeTooltip(); return; }
        showTooltip(rect.left + rect.width / 2, rect.top, [
          { label: '\u25CF Highlight', cls: 'tm-btn-highlight', onClick: () => wrapSelectionWithHighlight() },
        ]);
      }
    }, 10);
  }

  function handleMouseDown(e) {
    if (isTouchDevice()) return;
    if (!e.target.closest('.' + TOOLTIP_CLASS)) removeTooltip();
  }

  // --- Mobile: selectionchange + tap on highlights ---
  let selectionCheckTimer = null;
  let lastSelectionText = '';

  function handleSelectionChange() {
    if (!isTouchDevice()) return;

    clearTimeout(selectionCheckTimer);
    selectionCheckTimer = setTimeout(() => {
      const selection = window.getSelection();
      const text = selection ? selection.toString().trim() : '';

      if (!text) {
        if (lastSelectionText) removeTooltip();
        lastSelectionText = '';
        return;
      }

      if (text === lastSelectionText && activeTooltip) return;
      lastSelectionText = text;

      if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return;

        showTooltip(rect.left + rect.width / 2, rect.top, [
          {
            label: '\u25CF Highlight',
            cls: 'tm-btn-highlight',
            onClick: () => {
              wrapSelectionWithHighlight();
              lastSelectionText = '';
            },
          },
        ]);
      }
    }, 300);
  }

  function handleTouchEnd(e) {
    if (e.target.closest('.' + TOOLTIP_CLASS)) return;

    setTimeout(() => {
      const selection = window.getSelection();
      const text = selection ? selection.toString().trim() : '';
      if (text) return;

      const touch = e.changedTouches[0];
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      const hlEl = el ? el.closest('.' + HIGHLIGHT_CLASS) : null;

      if (hlEl) {
        const rect = hlEl.getBoundingClientRect();
        showTooltip(rect.left + rect.width / 2, rect.top, [
          { label: '\u2715 Remove', cls: 'tm-btn-remove', onClick: () => removeHighlight(hlEl) },
        ]);
      } else {
        removeTooltip();
      }
    }, 50);
  }

  function handleTouchStart(e) {
    if (!e.target.closest('.' + TOOLTIP_CLASS) && !e.target.closest('.' + HIGHLIGHT_CLASS)) {
      removeTooltip();
    }
  }

  // --- Keyboard shortcut (desktop) ---
  function handleKeydown(e) {
    if (e.ctrlKey && e.shiftKey && e.key === 'H') {
      e.preventDefault();
      wrapSelectionWithHighlight();
    }
  }

  // --- Init ---
  function init() {
    injectStyles();

    // Desktop
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeydown);

    // Mobile
    document.addEventListener('selectionchange', handleSelectionChange);
    document.addEventListener('touchend', handleTouchEnd, { passive: true });
    document.addEventListener('touchstart', handleTouchStart, { passive: true });

    console.log('[Highlighter] Text Highlighter loaded (desktop + mobile). Select text to highlight, tap/click to remove.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
