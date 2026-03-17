// TypingMind Text Highlighter Extension
// Click selected text to highlight, click highlight to remove
(function () {
  const HIGHLIGHT_CLASS = 'tm-user-highlight';
  const TOOLTIP_CLASS = 'tm-highlight-tooltip';
  const STORAGE_KEY = 'tm-highlights-data';

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
      }
      .${HIGHLIGHT_CLASS}:hover {
        background: rgba(255, 196, 61, 0.55);
      }
      .${TOOLTIP_CLASS} {
        position: fixed;
        z-index: 99999;
        display: flex;
        gap: 4px;
        padding: 4px 6px;
        background: #1e1e1e;
        border: 1px solid #333;
        border-radius: 8px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.3);
        font-family: 'Inter', sans-serif;
        font-size: 12px;
        font-weight: 600;
        animation: tmTooltipIn 0.12s ease-out;
      }
      .${TOOLTIP_CLASS} button {
        all: unset;
        padding: 5px 12px;
        border-radius: 6px;
        cursor: pointer;
        color: #e0e0e0;
        transition: background 0.1s ease;
        white-space: nowrap;
      }
      .${TOOLTIP_CLASS} button:hover {
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
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
        removeTooltip();
      });
      tooltip.appendChild(btn);
    });

    document.body.appendChild(tooltip);
    activeTooltip = tooltip;

    // Position: keep in viewport
    const rect = tooltip.getBoundingClientRect();
    let posX = x - rect.width / 2;
    let posY = y - rect.height - 10;
    if (posX < 8) posX = 8;
    if (posX + rect.width > window.innerWidth - 8) posX = window.innerWidth - rect.width - 8;
    if (posY < 8) posY = y + 20;

    tooltip.style.left = posX + 'px';
    tooltip.style.top = posY + 'px';
  }

  // --- Highlight Logic ---
  function wrapSelectionWithHighlight() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;

    const range = selection.getRangeAt(0);
    const text = selection.toString().trim();
    if (!text) return;

    // Don't re-highlight already highlighted text
    const ancestor = range.commonAncestorContainer;
    const parentEl = ancestor.nodeType === 3 ? ancestor.parentElement : ancestor;
    if (parentEl && parentEl.closest(`.${HIGHLIGHT_CLASS}`)) return;

    try {
      const mark = document.createElement('span');
      mark.className = HIGHLIGHT_CLASS;
      mark.dataset.hlId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      range.surroundContents(mark);
      selection.removeAllRanges();
    } catch (e) {
      // surroundContents fails if selection spans multiple elements
      // Fall back: extract, wrap, reinsert
      try {
        const fragment = range.extractContents();
        const mark = document.createElement('span');
        mark.className = HIGHLIGHT_CLASS;
        mark.dataset.hlId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        mark.appendChild(fragment);
        range.insertNode(mark);
        selection.removeAllRanges();
      } catch (e2) {
        console.warn('[Highlighter] Could not highlight this selection:', e2);
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

  // --- Event Handling ---
  function getChatContainer() {
    return document.querySelector('[class*="chat"]') || document.body;
  }

  function handleMouseUp(e) {
    // Ignore clicks on tooltip
    if (e.target.closest(`.${TOOLTIP_CLASS}`)) return;

    // Small delay so selection is finalized
    setTimeout(() => {
      const selection = window.getSelection();
      const selectedText = selection ? selection.toString().trim() : '';

      // Case 1: Clicked on an existing highlight (no new selection)
      if (!selectedText) {
        const hlEl = e.target.closest(`.${HIGHLIGHT_CLASS}`);
        if (hlEl) {
          const rect = hlEl.getBoundingClientRect();
          showTooltip(rect.left + rect.width / 2, rect.top, [
            {
              label: '✕ Remove',
              cls: 'tm-btn-remove',
              onClick: () => removeHighlight(hlEl),
            },
          ]);
        } else {
          removeTooltip();
        }
        return;
      }

      // Case 2: Text is selected, show highlight option
      if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
          removeTooltip();
          return;
        }

        showTooltip(rect.left + rect.width / 2, rect.top, [
          {
            label: '● Highlight',
            cls: 'tm-btn-highlight',
            onClick: () => wrapSelectionWithHighlight(),
          },
        ]);
      }
    }, 10);
  }

  function handleMouseDown(e) {
    // Dismiss tooltip when clicking elsewhere
    if (!e.target.closest(`.${TOOLTIP_CLASS}`)) {
      removeTooltip();
    }
  }

  // --- Init ---
  function init() {
    injectStyles();
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('mousedown', handleMouseDown);

    // Keyboard shortcut: Ctrl+Shift+H to highlight selection
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'H') {
        e.preventDefault();
        wrapSelectionWithHighlight();
      }
    });

    console.log('[Highlighter] TypingMind Text Highlighter loaded. Select text to highlight, click highlight to remove. Shortcut: Ctrl+Shift+H');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
