/* =====================================================================
 * TypingMind — Scroll Memory
 * ---------------------------------------------------------------------
 * • Reopen a chat → you land exactly where you left off (per chat)
 * • Chats with no saved spot → open at the TOP instead of the bottom
 * • Restore is instant (no visible jump), and it never fights you:
 *   the moment you touch/scroll, the extension backs off
 * • Works on desktop and the mobile PWA; positions persist across
 *   app restarts (saved in localStorage on each device)
 *
 * Install: TypingMind → Settings → Advanced Settings → Extensions →
 * paste the URL of this file → Install → restart the app.
 *
 * Verified against TypingMind's app code:
 *   - The chat scroll pane is [data-element-id="chat-space-middle-part"]
 *   - Messages are [data-element-id="response-block"]
 *   - The open chat lives in the URL as #chat=<id> (set via
 *     history.replaceState, so we hook history + poll as a fallback)
 * ===================================================================*/
(() => {
  'use strict';

  if (window.__TM_SCROLL_MEMORY__) return; // avoid double-install
  window.__TM_SCROLL_MEMORY__ = true;

  const CFG = {
    storageKey: 'tm-scroll-memory:v1',
    maxChats: 500,        // prune oldest entries beyond this
    bottomSlopPx: 80,     // this close to the bottom counts as "at bottom"
    holdMs: 2200,         // max time to defend the restored spot while the chat renders
    minHoldMs: 700,       // never release earlier than this (TM's own auto-scroll can be late)
    settleFrames: 10,     // consecutive stable frames before releasing early
    saveDebounceMs: 120,
    pollMs: 250,
  };

  const SCROLLER_SEL = '[data-element-id="chat-space-middle-part"]';
  const BLOCK_SEL = '[data-element-id="response-block"]';
  const COMPOSE_SEL =
    '[data-element-id="chat-input-textbox"],[data-element-id="send-button"]';

  /* ------------------------- storage ------------------------- */
  let store = {};
  try { store = JSON.parse(localStorage.getItem(CFG.storageKey) || '{}') || {}; }
  catch (e) { store = {}; }

  let writeTimer = null;
  function persist(immediate) {
    if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
    const write = () => {
      try {
        const ids = Object.keys(store);
        if (ids.length > CFG.maxChats) {
          ids.sort((a, b) => (store[a].t || 0) - (store[b].t || 0))
            .slice(0, ids.length - CFG.maxChats)
            .forEach((id) => delete store[id]);
        }
        localStorage.setItem(CFG.storageKey, JSON.stringify(store));
      } catch (e) { /* storage full/blocked — fail silently */ }
    };
    if (immediate) write(); else writeTimer = setTimeout(write, 300);
  }

  /* ------------------------- helpers ------------------------- */
  function chatIdFromURL() {
    const m = window.location.hash.match(/[#&]chat=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function getScroller() {
    const el = document.querySelector(SCROLLER_SEL);
    if (el) return el;
    // Fallback if TypingMind ever renames the id:
    // nearest scrollable ancestor of a message block.
    let n = document.querySelector(BLOCK_SEL);
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll' || cs.overflowY === 'overlay') &&
          n.scrollHeight > n.clientHeight) return n;
      n = n.parentElement;
    }
    return null;
  }

  const maxTop = (el) => Math.max(0, el.scrollHeight - el.clientHeight);

  /* Anchor = which message sits at the top of the view. Restoring by
   * anchor survives late-loading images/code blocks better than a raw
   * pixel offset, so you come back to the same *message*. */
  function captureAnchor(el) {
    try {
      const blocks = el.querySelectorAll(BLOCK_SEL);
      if (!blocks.length) return null;
      const paneTop = el.getBoundingClientRect().top;
      for (let i = 0; i < blocks.length; i++) {
        const r = blocks[i].getBoundingClientRect();
        if (r.bottom > paneTop + 1) {
          return { i, off: Math.round(paneTop - r.top) };
        }
      }
      return { i: blocks.length - 1, off: 0 };
    } catch (e) { return null; }
  }

  function topFromAnchor(el, a) {
    if (!a) return null;
    const blocks = el.querySelectorAll(BLOCK_SEL);
    const b = blocks[a.i];
    if (!b) return null;
    const delta = b.getBoundingClientRect().top - el.getBoundingClientRect().top;
    return el.scrollTop + delta + a.off;
  }

  /* ------------------------- state ------------------------- */
  let currentId = undefined; // undefined = not initialized, null = "new chat" screen
  let scroller = null;
  let restoring = false;
  let saveTimer = null;
  let lastCompose = 0;       // last time the user touched the input box / send button

  /* ------------------------- saving ------------------------- */
  function record(id) {
    if (!id || restoring) return;
    const el = scroller;
    if (!el || !el.isConnected || el.clientHeight === 0) return;
    const mt = maxTop(el);
    store[id] = {
      t: Date.now(),
      top: el.scrollTop,
      atBottom: mt - el.scrollTop <= CFG.bottomSlopPx,
      a: captureAnchor(el),
    };
    persist(false);
  }

  // One capturing listener catches scrolls of the chat pane no matter
  // how often React re-renders it.
  document.addEventListener('scroll', (e) => {
    if (restoring) return;
    if (!scroller || e.target !== scroller) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => record(currentId), CFG.saveDebounceMs);
  }, { capture: true, passive: true });

  // Used to tell "user just sent the first message of a new chat"
  // apart from "user opened an existing chat".
  const markCompose = (e) => {
    const t = e.target;
    if (t instanceof Element && t.closest(COMPOSE_SEL)) lastCompose = Date.now();
  };
  window.addEventListener('pointerdown', markCompose, { capture: true, passive: true });
  window.addEventListener('keydown', markCompose, { capture: true, passive: true });

  /* ------------------------- restoring ------------------------- */
  function desiredTop(rec, el) {
    const mt = maxTop(el);
    if (!rec) return 0;                 // never visited → start at the TOP
    if (rec.atBottom) return mt;        // was reading the end → back to the end
    const a = topFromAnchor(el, rec.a);
    const t = (a == null) ? rec.top : a;
    return Math.min(Math.max(0, t), mt);
  }

  function restore(id) {
    const rec = store[id]; // may be undefined → top of chat
    restoring = true;

    const started = performance.now();
    let stableFrames = 0;
    let lastHeight = -1;
    let cancelled = false;

    // The instant the user interacts, stop steering.
    const cancel = () => { cancelled = true; };
    const keyCancel = (e) => {
      if (['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' ']
        .includes(e.key)) cancelled = true;
    };
    window.addEventListener('wheel', cancel, { capture: true, passive: true });
    window.addEventListener('touchstart', cancel, { capture: true, passive: true });
    window.addEventListener('keydown', keyCancel, true);

    const done = () => {
      window.removeEventListener('wheel', cancel, true);
      window.removeEventListener('touchstart', cancel, true);
      window.removeEventListener('keydown', keyCancel, true);
      restoring = false;
      if (currentId === id) record(id); // stamp the spot (marks fresh chats as "top")
    };

    // Pin the target position every frame for a short window. This is
    // what beats TypingMind's own jump-to-bottom without any visible
    // animation — the pane simply appears already in place.
    const tick = () => {
      if (cancelled || currentId !== id) return done();
      const el = getScroller();
      if (el) {
        scroller = el;
        const want = desiredTop(rec, el);
        if (Math.abs(el.scrollTop - want) > 1) {
          el.scrollTop = want; // instant, no smooth animation = no visible jump
          stableFrames = 0;
        } else if (el.scrollHeight === lastHeight) {
          stableFrames++;
        } else {
          stableFrames = 0;
        }
        lastHeight = el.scrollHeight;
        if (stableFrames >= CFG.settleFrames &&
            performance.now() - started > CFG.minHoldMs) return done();
      }
      if (performance.now() - started > CFG.holdMs) return done();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /* --------------------- chat switch detection --------------------- */
  function syncChat() {
    const id = chatIdFromURL();
    if (id === currentId) return;

    const prev = currentId;
    if (prev && !restoring) record(prev); // save the spot we're leaving
    currentId = id;

    if (!id) return; // "new chat" screen — nothing to restore

    // Deep link straight to a message (#chat=..&messageId=..):
    // let TypingMind position on that message instead.
    if (/[#&]messageId=/.test(window.location.hash)) return;

    // A brand-new chat that just received its id because the user sent
    // the first message — don't yank the view around.
    if (prev === null && Date.now() - lastCompose < 5000) return;

    restore(id);
  }

  // TypingMind switches chats via history.replaceState (which fires no
  // hashchange event), so hook history and also poll as a safety net.
  ['pushState', 'replaceState'].forEach((fn) => {
    const orig = history[fn];
    history[fn] = function (...args) {
      const r = orig.apply(this, args);
      setTimeout(syncChat, 0);
      return r;
    };
  });
  window.addEventListener('hashchange', syncChat);
  window.addEventListener('popstate', syncChat);
  setInterval(syncChat, CFG.pollMs);

  // If the chat pane gets re-created without a URL change (e.g. after
  // closing a settings screen), put the user back where they were.
  setInterval(() => {
    if (restoring || !currentId) return;
    const el = getScroller();
    if (!el || el === scroller) return;
    const remounted = scroller && !scroller.isConnected;
    scroller = el;
    if (remounted) restore(currentId);
  }, CFG.pollMs);

  // Make sure the latest position survives closing the app/tab —
  // important on mobile, where the PWA can be killed at any time.
  const flush = () => {
    if (saveTimer) clearTimeout(saveTimer);
    record(currentId);
    persist(true);
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flush();
  });

  // Tiny debug/maintenance API
  window.TMScrollMemory = {
    clear() { store = {}; persist(true); },
    dump() { return JSON.parse(JSON.stringify(store)); },
  };

  /* ------------------------- boot ------------------------- */
  syncChat();
  console.log('[TM Scroll Memory] active');
})();
