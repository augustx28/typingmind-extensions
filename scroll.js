(function () {
  'use strict';

  const STORAGE_KEY = 'tm-scroll-positions';
  const SAVE_DEBOUNCE = 300;
  const RESTORE_DELAY = 250;
  const MAX_ENTRIES = 200;

  let currentChatId = null;
  let saveTimer = null;
  let isRestoring = false;

  function getScrollData() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch {
      return {};
    }
  }

  function setScrollData(data) {
    // Prune old entries if over limit
    const keys = Object.keys(data);
    if (keys.length > MAX_ENTRIES) {
      const sorted = keys.sort((a, b) => (data[a].ts || 0) - (data[b].ts || 0));
      const toRemove = sorted.slice(0, keys.length - MAX_ENTRIES);
      toRemove.forEach((k) => delete data[k]);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function getChatContainer() {
    return (
      document.querySelector('[data-element-id="chat-space-middle-part"]') ||
      document.querySelector('[class*="conversation"]') ||
      document.querySelector('main .overflow-y-auto')
    );
  }

  function getChatId() {
    // TypingMind uses hash-based routing
    const hash = window.location.hash;
    if (hash && hash.length > 2) return hash;
    // Fallback: count children + scrollHeight as fingerprint
    const container = getChatContainer();
    if (container) {
      return 'chat-' + container.children.length + '-' + container.scrollHeight;
    }
    return null;
  }

  function savePosition() {
    if (!currentChatId || isRestoring) return;
    const container = getChatContainer();
    if (!container) return;

    const data = getScrollData();
    data[currentChatId] = {
      top: container.scrollTop,
      height: container.scrollHeight,
      ts: Date.now(),
    };
    setScrollData(data);
  }

  function restorePosition(chatId) {
    const container = getChatContainer();
    if (!container) return;

    const data = getScrollData();
    const saved = data[chatId];

    if (saved && typeof saved.top === 'number') {
      isRestoring = true;

      // If the scroll height is similar (same chat, fully loaded), restore exact position
      // If wildly different, scale proportionally
      let targetTop = saved.top;
      if (saved.height && container.scrollHeight > 0) {
        const ratio = saved.top / saved.height;
        const heightDiff = Math.abs(container.scrollHeight - saved.height);
        // If height changed significantly, scale proportionally
        if (heightDiff > 500) {
          targetTop = Math.round(ratio * container.scrollHeight);
        }
      }

      container.scrollTop = targetTop;

      // Second pass after any lazy content loads
      setTimeout(() => {
        container.scrollTop = targetTop;
        isRestoring = false;
      }, 400);
    } else {
      // No saved position: default to top
      isRestoring = true;
      container.scrollTop = 0;
      setTimeout(() => {
        container.scrollTop = 0;
        isRestoring = false;
      }, 400);
    }
  }

  function onScroll() {
    if (isRestoring) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(savePosition, SAVE_DEBOUNCE);
  }

  function handleChatSwitch() {
    const newId = getChatId();
    if (!newId || newId === currentChatId) return;

    // Save position for the chat we're leaving
    if (currentChatId) {
      savePosition();
    }

    currentChatId = newId;

    // Restore position for the chat we're entering
    setTimeout(() => restorePosition(newId), RESTORE_DELAY);
    // Second pass for slow renders
    setTimeout(() => {
      if (currentChatId === newId && !isRestoring) {
        restorePosition(newId);
      }
    }, RESTORE_DELAY + 500);
  }

  function attachScrollListener() {
    const container = getChatContainer();
    if (!container) return;
    container.addEventListener('scroll', onScroll, { passive: true });
  }

  function init() {
    const target =
      document.querySelector('[data-element-id="chat-space-middle-part"]') ||
      document.querySelector('main') ||
      document.body;

    const observer = new MutationObserver(() => {
      handleChatSwitch();
      attachScrollListener();
    });

    observer.observe(target, { childList: true, subtree: true });

    window.addEventListener('hashchange', () => {
      setTimeout(handleChatSwitch, RESTORE_DELAY);
    });

    // Save before leaving the page entirely
    window.addEventListener('beforeunload', savePosition);

    // Initial setup
    attachScrollListener();
    currentChatId = getChatId();
  }

  if (document.readyState === 'complete') {
    init();
  } else {
    window.addEventListener('load', init);
  }
})();
