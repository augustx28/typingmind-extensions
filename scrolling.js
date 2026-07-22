/**
 * TypingMind Extension: Scroll Memory
 *
 * - Remembers your scroll position per chat and restores it instantly
 *   (no animation, no visible jump) when you reopen that chat.
 * - Chats with NO saved position open at the TOP instead of the bottom.
 * - Keeps correcting for a moment while messages/images finish rendering,
 *   then hands control back to you. Any touch/scroll from you cancels it.
 *
 * Install: TypingMind → Settings → Advanced Settings → Extensions →
 * paste the URL of this file → reload the app.
 */
(() => {
  'use strict';
  if (window.__tmScrollMemoryLoaded) return;
  window.__tmScrollMemoryLoaded = true;

  const STORAGE_KEY = 'tm_scroll_memory_v1';
  const MAX_ENTRIES = 300;      // number of recent chats to remember
  const ENFORCE_MS = 900;       // minimum time to pin position after opening a chat
  const HARD_CAP_MS = 5000;     // max time to keep correcting while content still loads
  const HEIGHT_SETTLE_MS = 400; // stop once chat height has been stable this long

  /* ---------- storage ---------- */
  const readStore = () => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
    catch { return {}; }
  };
  const writeStore = (s) => {
    try {
      const keys = Object.keys(s);
      if (keys.length > MAX_ENTRIES) {
        keys.sort((a, b) => (s[a].t || 0) - (s[b].t || 0))
          .slice(0, keys.length - MAX_ENTRIES)
          .forEach((k) => delete s[k]);
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch { /* storage full / private mode — ignore */ }
  };
  const store = readStore();

  /* ---------- helpers ---------- */
  const chatId = () => {
    const m = (location.hash || '').match(/chat=([^&/?#]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  };

  // Find the scrollable container that holds the chat messages.
  const findScroller = () => {
    const mid = document.querySelector('[data-element-id="chat-space-middle-part"]');
    let el = mid && mid.parentElement;
    while (el && el !== document.documentElement) {
      const cs = getComputedStyle(el);
      if (/(auto|scroll|overlay)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight) return el;
      el = el.parentElement;
    }
    return null;
  };

  /* ---------- state ---------- */
  let activeId = null;
  let scroller = null;
  let suppressSave = false;
  let enforceTarget = null; // number (px) or 'top'
  let enforceUntil = 0;
  let hardCapUntil = 0;
  let lastHeight = 0;
  let lastHeightChange = 0;
  let rafId = 0;
  let saveTimer = 0;
  let lastSaveAt = 0;
  let findTimer = 0;

  /* ---------- saving ---------- */
  const saveNow = () => {
    if (!activeId || !scroller || !scroller.isConnected || suppressSave) return;
    store[activeId] = { y: Math.round(scroller.scrollTop), t: Date.now() };
    writeStore(store);
  };

  const onScroll = () => {
    if (suppressSave) return;
    const now = Date.now();
    if (now - lastSaveAt > 300) { lastSaveAt = now; saveNow(); }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 250);
  };

  /* ---------- restoring ---------- */
  const stopEnforcing = () => {
    enforceUntil = 0;
    hardCapUntil = 0;
    suppressSave = false;
    if (scroller && scroller.dataset.tmPrevSb !== undefined) {
      scroller.style.scrollBehavior = scroller.dataset.tmPrevSb;
      delete scroller.dataset.tmPrevSb;
    }
  };

  const applyTarget = () => {
    if (!scroller) return;
    const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const y = enforceTarget === 'top' ? 0 : Math.min(enforceTarget, max);
    if (Math.abs(scroller.scrollTop - y) > 1) scroller.scrollTop = y;
  };

  const enforceLoop = () => {
    if (!scroller || !scroller.isConnected) { stopEnforcing(); return; }
    const now = Date.now();
    const h = scroller.scrollHeight;
    if (h !== lastHeight) { lastHeight = h; lastHeightChange = now; }
    const stillActive =
      now < enforceUntil ||
      (now < hardCapUntil && now - lastHeightChange < HEIGHT_SETTLE_MS);
    if (!stillActive) { stopEnforcing(); return; }
    applyTarget();
    rafId = requestAnimationFrame(enforceLoop);
  };

  const USER_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
  const onUserInput = () => stopEnforcing();

  const attach = (el) => {
    if (scroller === el) return;
    if (scroller) {
      scroller.removeEventListener('scroll', onScroll);
      USER_EVENTS.forEach((ev) => scroller.removeEventListener(ev, onUserInput));
    }
    scroller = el;
    if (scroller) {
      scroller.addEventListener('scroll', onScroll, { passive: true });
      USER_EVENTS.forEach((ev) => scroller.addEventListener(ev, onUserInput, { passive: true }));
    }
  };

  const restore = () => {
    const saved = store[activeId];
    enforceTarget = saved && Number.isFinite(saved.y) ? saved.y : 'top';
    suppressSave = true;
    lastHeight = 0;
    lastHeightChange = Date.now();
    enforceUntil = Date.now() + ENFORCE_MS;
    hardCapUntil = Date.now() + HARD_CAP_MS;
    // Kill any smooth-scroll animation so the jump is instant and invisible.
    scroller.dataset.tmPrevSb = scroller.style.scrollBehavior || '';
    scroller.style.scrollBehavior = 'auto';
    cancelAnimationFrame(rafId);
    applyTarget();
    rafId = requestAnimationFrame(enforceLoop);
  };

  const onChatOpened = () => {
    activeId = chatId();
    stopEnforcing();
    cancelAnimationFrame(rafId);
    attach(null);
    clearInterval(findTimer);
    if (!activeId) return;
    const started = Date.now();
    findTimer = setInterval(() => {
      const el = findScroller();
      if (el) {
        clearInterval(findTimer);
        attach(el);
        restore();
      } else if (Date.now() - started > 8000) {
        clearInterval(findTimer);
      }
    }, 40);
  };

  /* ---------- route / lifecycle hooks ---------- */
  let lastRouteKey = null;
  const routeCheck = () => {
    const key = chatId();
    if (key !== lastRouteKey) {
      lastRouteKey = key;
      onChatOpened();
    } else if (activeId && (!scroller || !scroller.isConnected)) {
      // App re-rendered the container without changing chats — reattach quietly.
      const el = findScroller();
      if (el) attach(el);
    }
  };

  ['pushState', 'replaceState'].forEach((fn) => {
    const orig = history[fn];
    history[fn] = function (...args) {
      const r = orig.apply(this, args);
      routeCheck();
      return r;
    };
  });
  window.addEventListener('hashchange', routeCheck);
  window.addEventListener('popstate', routeCheck);
  setInterval(routeCheck, 500); // safety net for silent re-renders

  const flush = () => { clearTimeout(saveTimer); saveNow(); };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });

  routeCheck(); // first load
})();
