(() => {
  'use strict';

  const EXT_ID = 'typingmind-remember-chat-scroll-v1';
  const STORAGE_PREFIX = `${EXT_ID}:`;
  const SAVE_DELAY = 100;
  const RESTORE_WINDOW = 2500;

  let activeScroller = null;
  let activeChatKey = null;
  let saveTimer = null;
  let restoreSession = 0;
  let userInteracted = false;

  /* ─────────────────────────────────────────────
     Get a stable ID for the currently opened chat
  ───────────────────────────────────────────── */

  function getChatKey() {
    const url = new URL(window.location.href);

    // Preserve pathname + query because TypingMind may use either
    // to identify the currently opened chat.
    return `${url.pathname}${url.search}`;
  }

  /* ─────────────────────────────────────────────
     Find the actual chat scroll container
  ───────────────────────────────────────────── */

  function findChatScroller() {
    // Start from actual message elements so we don't accidentally
    // remember the sidebar's scroll position.
    const message =
      document.querySelector('[data-element-id="user-message"]') ||
      document.querySelector('[data-element-id*="assistant-message"]') ||
      document.querySelector('[data-element-id*="message"]');

    if (message) {
      let el = message.parentElement;

      while (el && el !== document.body) {
        const style = window.getComputedStyle(el);

        const isScrollable =
          /auto|scroll/.test(style.overflowY) &&
          el.scrollHeight > el.clientHeight;

        if (isScrollable) {
          return el;
        }

        el = el.parentElement;
      }
    }

    // TypingMind fallback selectors.
    const candidates = [
      ...document.querySelectorAll(
        '.overflow-y-auto, [class*="overflow-y-auto"]'
      ),
    ];

    const valid = candidates.filter((el) => {
      if (el.clientHeight < 250) return false;
      if (el.scrollHeight <= el.clientHeight) return false;

      // Prefer a container that contains chat messages.
      return Boolean(
        el.querySelector(
          '[data-element-id="user-message"], [data-element-id*="message"]'
        )
      );
    });

    if (!valid.length) return null;

    // The main conversation area will generally be the largest.
    return valid.sort(
      (a, b) =>
        b.clientWidth * b.clientHeight -
        a.clientWidth * a.clientHeight
    )[0];
  }

  /* ─────────────────────────────────────────────
     Storage
  ───────────────────────────────────────────── */

  function storageKey(chatKey) {
    return STORAGE_PREFIX + encodeURIComponent(chatKey);
  }

  function getSavedPosition(chatKey) {
    try {
      const raw = localStorage.getItem(storageKey(chatKey));
      if (!raw) return null;

      const data = JSON.parse(raw);

      if (
        typeof data.scrollTop !== 'number' ||
        typeof data.scrollHeight !== 'number'
      ) {
        return null;
      }

      return data;
    } catch {
      return null;
    }
  }

  function savePosition() {
    if (!activeScroller || !activeChatKey) return;

    try {
      const maxScroll = Math.max(
        0,
        activeScroller.scrollHeight - activeScroller.clientHeight
      );

      const scrollTop = activeScroller.scrollTop;

      const data = {
        scrollTop,
        scrollHeight: activeScroller.scrollHeight,
        clientHeight: activeScroller.clientHeight,

        // Extra measurements make restoration more reliable
        // if the rendered chat height changes slightly.
        distanceFromBottom: Math.max(0, maxScroll - scrollTop),

        ratio:
          maxScroll > 0
            ? Math.min(1, Math.max(0, scrollTop / maxScroll))
            : 0,

        savedAt: Date.now(),
      };

      localStorage.setItem(
        storageKey(activeChatKey),
        JSON.stringify(data)
      );
    } catch {
      // Never interfere with TypingMind if storage is unavailable.
    }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);

    saveTimer = setTimeout(() => {
      savePosition();
    }, SAVE_DELAY);
  }

  /* ─────────────────────────────────────────────
     Restore
  ───────────────────────────────────────────── */

  function calculateTarget(scroller, saved) {
    const currentMax = Math.max(
      0,
      scroller.scrollHeight - scroller.clientHeight
    );

    const oldMax = Math.max(
      0,
      saved.scrollHeight - saved.clientHeight
    );

    // If the chat's rendered height is basically unchanged,
    // restore the exact pixel location.
    const heightDifference = Math.abs(
      scroller.scrollHeight - saved.scrollHeight
    );

    if (heightDifference < 100) {
      return Math.min(saved.scrollTop, currentMax);
    }

    /*
      If layout changed slightly, decide which reference is safer.

      Near the bottom:
      preserve distance from bottom.

      Elsewhere:
      preserve relative position through the conversation.
    */

    const wasNearBottom =
      saved.distanceFromBottom < 500 ||
      (oldMax > 0 && saved.scrollTop / oldMax > 0.92);

    if (wasNearBottom) {
      return Math.max(
        0,
        currentMax - saved.distanceFromBottom
      );
    }

    return currentMax * saved.ratio;
  }

  function setScrollInstantly(scroller, top) {
    const previousBehavior = scroller.style.scrollBehavior;

    // Prevent CSS smooth scrolling from causing a visible glide.
    scroller.style.scrollBehavior = 'auto';

    scroller.scrollTop = top;

    requestAnimationFrame(() => {
      scroller.style.scrollBehavior = previousBehavior;
    });
  }

  async function restorePosition(scroller, chatKey) {
    const saved = getSavedPosition(chatKey);
    if (!saved) return;

    const session = ++restoreSession;
    const startedAt = performance.now();

    userInteracted = false;

    /*
      TypingMind/React can render a chat in stages.

      We retry briefly while the messages finish rendering.
      The moment the user touches or scrolls manually, restoration stops.
    */

    let lastHeight = -1;
    let stableFrames = 0;

    while (
      session === restoreSession &&
      !userInteracted &&
      performance.now() - startedAt < RESTORE_WINDOW
    ) {
      if (!document.contains(scroller)) return;

      const target = calculateTarget(scroller, saved);

      setScrollInstantly(scroller, target);

      if (scroller.scrollHeight === lastHeight) {
        stableFrames++;
      } else {
        stableFrames = 0;
        lastHeight = scroller.scrollHeight;
      }

      // Several stable frames usually means the conversation
      // has finished rendering.
      if (stableFrames >= 5) {
        setScrollInstantly(
          scroller,
          calculateTarget(scroller, saved)
        );

        return;
      }

      await new Promise((resolve) =>
        requestAnimationFrame(resolve)
      );
    }
  }

  /* ─────────────────────────────────────────────
     Attach to the current conversation
  ───────────────────────────────────────────── */

  function detachScroller() {
    if (!activeScroller) return;

    savePosition();

    activeScroller.removeEventListener(
      'scroll',
      handleScroll
    );

    activeScroller.removeEventListener(
      'touchstart',
      handleUserInteraction
    );

    activeScroller.removeEventListener(
      'wheel',
      handleUserInteraction
    );

    activeScroller.removeEventListener(
      'pointerdown',
      handleUserInteraction
    );

    activeScroller = null;
  }

  function handleScroll() {
    scheduleSave();
  }

  function handleUserInteraction() {
    userInteracted = true;

    // Cancel any pending automatic restoration immediately.
    restoreSession++;
  }

  function attachScroller(scroller, chatKey) {
    if (
      activeScroller === scroller &&
      activeChatKey === chatKey
    ) {
      return;
    }

    detachScroller();

    activeScroller = scroller;
    activeChatKey = chatKey;
    userInteracted = false;

    scroller.addEventListener('scroll', handleScroll, {
      passive: true,
    });

    scroller.addEventListener(
      'touchstart',
      handleUserInteraction,
      { passive: true }
    );

    scroller.addEventListener(
      'wheel',
      handleUserInteraction,
      { passive: true }
    );

    scroller.addEventListener(
      'pointerdown',
      handleUserInteraction,
      { passive: true }
    );

    restorePosition(scroller, chatKey);
  }

  /* ─────────────────────────────────────────────
     Detect chat changes
  ───────────────────────────────────────────── */

  function checkCurrentChat() {
    const chatKey = getChatKey();
    const scroller = findChatScroller();

    if (!scroller) return;

    if (
      chatKey !== activeChatKey ||
      scroller !== activeScroller
    ) {
      attachScroller(scroller, chatKey);
    }
  }

  // Watch React/TypingMind DOM changes.
  const observer = new MutationObserver(() => {
    checkCurrentChat();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  /* ─────────────────────────────────────────────
     Detect SPA navigation immediately
  ───────────────────────────────────────────── */

  function handleBeforeNavigation() {
    savePosition();

    restoreSession++;
    userInteracted = false;

    // Give React a moment to swap the conversation DOM.
    requestAnimationFrame(() => {
      requestAnimationFrame(checkCurrentChat);
    });
  }

  const originalPushState = history.pushState;

  history.pushState = function (...args) {
    savePosition();

    const result = originalPushState.apply(this, args);

    handleBeforeNavigation();

    return result;
  };

  const originalReplaceState = history.replaceState;

  history.replaceState = function (...args) {
    const result = originalReplaceState.apply(this, args);

    requestAnimationFrame(checkCurrentChat);

    return result;
  };

  window.addEventListener('popstate', () => {
    handleBeforeNavigation();
  });

  /* ─────────────────────────────────────────────
     Mobile/browser lifecycle protection
  ───────────────────────────────────────────── */

  window.addEventListener('pagehide', savePosition);

  window.addEventListener('beforeunload', savePosition);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      savePosition();
    } else {
      requestAnimationFrame(checkCurrentChat);
    }
  });

  /* ─────────────────────────────────────────────
     Initial startup
  ───────────────────────────────────────────── */

  checkCurrentChat();

  // Useful during initial TypingMind startup.
  setTimeout(checkCurrentChat, 250);
  setTimeout(checkCurrentChat, 750);
  setTimeout(checkCurrentChat, 1500);

  console.log(`[${EXT_ID}] Loaded`);
})();
