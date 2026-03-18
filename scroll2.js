(function () {
  'use strict';

  const STORAGE_KEY = 'tm-scroll-positions';
  const SAVE_DEBOUNCE = 300;
  const RESTORE_DELAY = 250;
  const MAX_ENTRIES = 200;

  let currentChatId = null;
  let saveTimer = null;
  let isRestoring = false;

  // Inject a cloak style so we can hide the container during restore (prevents flash)
  const cloakStyleId = 'tm-scroll-cloak-style';
  function injectCloakStyle() {
    if (document.getElementById(cloakStyleId)) return;
    const style = document.createElement('style');
    style.id = cloakStyleId;
    style.textContent = `
      .tm-scroll-cloaked {
        opacity: 0 !important;
        transition: none !important;
      }
      .tm-scroll-reveal {
        opacity: 1 !important;
        transition: opacity 60ms ease !important;
      }
    `;
    document.head.appendChild(style);
  }

  function cloakContainer(container) {
    if (!container) return;
    container.classList.remove('tm-scroll-reveal');
    container.classList.add('tm-scroll-cloaked');
  }

  function revealContainer(container) {
    if (!container) return;
    container.classList.remove('tm-scroll-cloaked');
    container.classList.add('tm-scroll-reveal');
  }

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

    // Cloak immediately to prevent flash
    cloakContainer(container);
    isRestoring = true;

    if (saved && typeof saved.top === 'number') {
      let targetTop = saved.top;
      if (saved.height && container.scrollHeight > 0) {
        const ratio = saved.top / saved.height;
        const heightDiff = Math.abs(container.scrollHeight - saved.height);
        if (heightDiff > 500) {
          targetTop = Math.round(ratio * container.scrollHeight);
        }
      }

      container.scrollTop = targetTop;

      // Second pass after any lazy content loads, then reveal
      setTimeout(() => {
        container.scrollTop = targetTop;
        revealContainer(container);
        isRestoring = false;
      }, 150);
    } else {
      // No saved position: default to top
      container.scrollTop = 0;
      setTimeout(() => {
        container.scrollTop = 0;
        revealContainer(container);
        isRestoring = false;
      }, 150);
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

    // Cloak immediately so user never sees the default position
    const container = getChatContainer();
    cloakContainer(container);

    // Restore position for the chat we're entering
    setTimeout(() => restorePosition(newId), RESTORE_DELAY);
    // Safety fallback: if restore somehow didn't reveal, force it
    setTimeout(() => {
      const c = getChatContainer();
      if (c && c.classList.contains('tm-scroll-cloaked')) {
        revealContainer(c);
        isRestoring = false;
      }
    }, RESTORE_DELAY + 800);
  }

  function attachScrollListener() {
    const container = getChatContainer();
    if (!container) return;
    container.addEventListener('scroll', onScroll, { passive: true });
  }

  function init() {
    injectCloakStyle();

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
      const c = getChatContainer();
      cloakContainer(c);
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
