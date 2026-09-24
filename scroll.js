/* =====================================================================
 * TypingMind — Scroll Memory v2
 * ---------------------------------------------------------------------
 * • Reopen a chat → you land exactly where you left off (per chat)
 * • Chat with no saved spot → you land at the START of the latest answer,
 *   right below the "Thought for…" / web-search / tool blocks
 * • New messages arrived since you last looked (other device, regenerate)
 *   → you land at the start of the newest answer instead of your old spot
 * • Event-driven: no per-frame loops, no always-on 250ms timers.
 *   Idle cost is one cheap check per second while the app is visible.
 * • Never fights you: any wheel / touch / click / nav key hands control back
 *
 * Install: TypingMind → Settings → Advanced Settings → Extensions →
 * paste the URL of this file → Install → restart the app.
 * Replaces v1. Reuses v1's saved positions (same storage key).
 *
 * Verified against TypingMind's current app bundle (Sep 2026):
 *   - Scroll pane:  [data-element-id="chat-space-middle-part"]
 *   - Each message: wrapper div with classes message-index-N message-id-<uuid>
 *   - AI answer:    [data-element-id="ai-response"][data-message-uuid] whose
 *                   direct children are the rendered markdown blocks
 *   - Preamble:     thinking-block / websearch-calls-block /
 *                   provider-tool-call-block (direct children of ai-response)
 *   - Chats with 100+ messages lazy-render off-screen messages as fixed-
 *     height placeholders, so we anchor by message uuid, never by index
 *   - On open, TM jumps to the bottom inside a React effect; we correct it
 *     inside the scroll event, which runs before paint, so no visible jump
 *
 * Console helpers: TMScrollMemory.dump() / .forget(chatId) / .clear() / .off()
 * Emergency: load TypingMind with ?safe_mode=1 to skip all extensions.
 * ===================================================================*/
(() => {
  'use strict';

  if (window.__TM_SCROLL_MEMORY__) return; // one copy only (also blocks v1 + v2 together)
  window.__TM_SCROLL_MEMORY__ = 2;

  const CFG = {
    storageKey: 'tm-scroll-memory:v1', // kept from v1 so your saved spots carry over
    maxChats: 500,          // prune oldest entries beyond this
    bottomSlopPx: 80,       // this close to the bottom counts as "at bottom"
    landingGapPx: 12,       // breathing room above the landing spot
    waitMs: 5000,           // max wait for a chat to render (cold start on phone)
    minHoldMs: 800,         // defend the spot at least this long (TM's jump can be late)
    quietMs: 500,           // then release once nothing has moved for this long
    maxHoldMs: 2500,        // hard stop
    tickMs: 150,            // safety re-check interval, only while holding
    saveDebounceMs: 150,    // save this long after scrolling stops
    persistDelayMs: 2000,   // batch localStorage writes
    pollMs: 1000,           // fallback chat-switch / remount check (visible tab only)
  };

  const SEL = {
    scroller: '[data-element-id="chat-space-middle-part"]',
    msg: '[class*="message-id-"]',
    block: '[data-element-id="response-block"]',
    ai: '[data-element-id="ai-response"]',
    list: '.dynamic-chat-content-container',
    compose: '[data-element-id="chat-input-textbox"],[data-element-id="message-input"],[data-element-id="send-button"]',
  };
  const PREAMBLE_ID = /^(thinking-block|websearch-calls-block|provider-tool-call-block)$|thinking|reasoning|tool-call|calls-block/;
  const SKIP_ID = /citations-block|additional-actions|streaming-block/;
  const PREAMBLE_LABEL = /^\s*(thought|thinking|reasoned|reasoning)\b/i;
  const NAV_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' ']);

  let disabled = false;

  /* ============================ storage ============================ */
  let store = {};
  try { store = JSON.parse(localStorage.getItem(CFG.storageKey) || '{}') || {}; }
  catch (e) { store = {}; }

  let dirty = false;
  let persistTimer = 0;

  function writeNow() {
    if (!dirty) return;
    dirty = false;
    try {
      // Merge with what's on disk so two open TM windows don't wipe each other.
      let disk = {};
      try { disk = JSON.parse(localStorage.getItem(CFG.storageKey) || '{}') || {}; } catch (e) { /* corrupt, overwrite */ }
      for (const id in disk) {
        if (!store[id] || (disk[id] && (disk[id].t || 0) > (store[id].t || 0))) store[id] = disk[id];
      }
      const ids = Object.keys(store);
      if (ids.length > CFG.maxChats) {
        ids.sort((a, b) => (store[a].t || 0) - (store[b].t || 0))
          .slice(0, ids.length - CFG.maxChats)
          .forEach((id) => delete store[id]);
      }
      localStorage.setItem(CFG.storageKey, JSON.stringify(store));
    } catch (e) { /* storage full or blocked, fail silently */ }
  }

  function persistSoon() {
    dirty = true;
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = 0;
      if (window.requestIdleCallback) requestIdleCallback(writeNow, { timeout: 2000 });
      else writeNow();
    }, CFG.persistDelayMs);
  }

  function persistNow() {
    if (persistTimer) { clearTimeout(persistTimer); persistTimer = 0; }
    writeNow();
  }

  /* ============================ helpers ============================ */
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const maxTop = (el) => Math.max(0, el.scrollHeight - el.clientHeight);

  function chatIdFromURL() {
    const m = window.location.hash.match(/[#&]chat=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function getScroller() {
    const el = document.querySelector(SEL.scroller);
    if (el) return el;
    // Fallback if TypingMind ever renames the id: nearest scrollable
    // ancestor of a message block.
    let n = document.querySelector(SEL.block);
    while (n && n !== document.documentElement) {
      const oy = getComputedStyle(n).overflowY;
      if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && n.scrollHeight > n.clientHeight) return n;
      n = n.parentElement;
    }
    return null;
  }

  // Y position of a node inside the scroll pane's content (scrollTop units).
  function yOf(el, node, bottom) {
    const r = node.getBoundingClientRect();
    return el.scrollTop + (bottom ? r.bottom : r.top) - el.getBoundingClientRect().top;
  }

  // Rendered message wrappers, top to bottom. Off-screen messages in
  // 100+ message chats are placeholders and simply aren't in this list.
  function messages(el) {
    const l = el.querySelectorAll(SEL.msg);
    return l.length ? l : el.querySelectorAll(SEL.block);
  }

  function msgKey(m) {
    const c = typeof m.className === 'string' && m.className.match(/(?:^|\s)message-id-(\S+)/);
    if (c) return c[1];
    const a = m.querySelector('[data-message-uuid]');
    return a ? a.getAttribute('data-message-uuid') : null;
  }

  function findMsg(el, key) {
    if (!key) return null;
    try {
      const m = el.querySelector('.message-id-' + CSS.escape(key));
      if (m) return m;
      const a = el.querySelector('[data-message-uuid="' + CSS.escape(key) + '"]');
      return a ? (a.closest(SEL.block) || a) : null;
    } catch (e) { return null; }
  }

  // The last message only counts if it really is the last one
  // (not the last *rendered* one above a lazy placeholder).
  function trustedLastKey(el, list) {
    const m = list[list.length - 1];
    if (!m) return null;
    const box = el.querySelector(SEL.list);
    if (box && box.lastElementChild && !box.lastElementChild.contains(m)) return null;
    return msgKey(m);
  }

  // Markdown blocks of an answer (p, h2, ul, pre, table...). Null for user messages.
  function parts(m) {
    const ai = m.matches(SEL.ai) ? m : m.querySelector(SEL.ai);
    return ai ? ai.children : null;
  }

  // Binary search: first node whose bottom edge is below y. Works because
  // messages and an answer's direct children are stacked top to bottom.
  function firstBelow(list, y) {
    let lo = 0, hi = list.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].getBoundingClientRect().bottom > y + 1) { ans = mid; hi = mid - 1; }
      else lo = mid + 1;
    }
    return ans;
  }

  // Short text fingerprint, reads at most ~80 chars (no full textContent).
  function fp(n) {
    const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
    let s = '';
    while (s.length < 80 && w.nextNode()) s += w.currentNode.nodeValue;
    return s.replace(/\s+/g, ' ').trim().slice(0, 60);
  }

  function isPreamble(n) {
    const id = n.getAttribute('data-element-id');
    if (id) return PREAMBLE_ID.test(id);
    if (n.tagName === 'DETAILS') {
      const s = n.querySelector('summary');
      return !!s && PREAMBLE_LABEL.test(s.textContent || '');
    }
    return false;
  }

  function isSkippable(n) {
    const id = n.getAttribute('data-element-id');
    return (!!id && SKIP_ID.test(id)) || !n.getClientRects().length;
  }

  /* ====================== where to land / anchor ====================== */

  // Start of the latest answer: first block after the last thinking /
  // search / tool block. No preamble → start of the answer.
  function landingTop(el) {
    const ais = el.querySelectorAll(SEL.ai);
    const ai = ais[ais.length - 1];
    if (!ai) {
      const blocks = el.querySelectorAll(SEL.block);
      const b = blocks[blocks.length - 1];
      return b ? yOf(el, b) : null;
    }
    const kids = ai.children;
    let lastPre = -1;
    for (let k = 0; k < kids.length; k++) if (isPreamble(kids[k])) lastPre = k;
    for (let k = lastPre + 1; k < kids.length; k++) {
      const n = kids[k];
      if (isPreamble(n) || isSkippable(n)) continue;
      return yOf(el, n) - CFG.landingGapPx;
    }
    if (lastPre >= 0) return yOf(el, kids[lastPre], true);
    return yOf(el, ai.closest(SEL.block) || ai) - CFG.landingGapPx;
  }

  // Record the reading position as: message uuid + which markdown block
  // of that answer is at the top + pixel offset into it (+ text check).
  function capture(el) {
    const list = messages(el);
    const paneTop = el.getBoundingClientRect().top;
    const mt = maxTop(el);
    const rec = {
      t: Date.now(),
      top: Math.round(el.scrollTop),
      atBottom: mt - el.scrollTop <= CFG.bottomSlopPx,
    };
    if (!list.length) return rec;

    const last = trustedLastKey(el, list);
    if (last) rec.last = last;

    let i = firstBelow(list, paneTop);
    if (i < 0) i = list.length - 1;
    const m = list[i];
    const a = { u: msgKey(m), off: Math.round(paneTop - m.getBoundingClientRect().top) };
    const p = parts(m);
    if (p && p.length) {
      const c = firstBelow(p, paneTop);
      if (c >= 0 && p[c].getBoundingClientRect().top < paneTop + el.clientHeight) {
        a.c = c;
        a.co = Math.round(paneTop - p[c].getBoundingClientRect().top);
        a.f = fp(p[c]);
      }
    }
    rec.a = a;
    return rec;
  }

  function anchorTop(s, el, a) {
    if (!a) return null;
    let m = null;
    if (a.u) m = findMsg(el, a.u);
    else if (a.i != null) m = el.querySelectorAll(SEL.block)[a.i]; // v1 record
    if (!m) return null;

    const p = a.c != null ? parts(m) : null;
    if (p) {
      let n = s.part && s.part.isConnected && m.contains(s.part) ? s.part : p[a.c];
      if (n && a.f && n !== s.part && fp(n) !== a.f) {
        n = null; // content shifted: find the block by its text instead
        for (const q of p) if (fp(q) === a.f) { n = q; break; }
      }
      if (n) { s.part = n; return yOf(el, n) + (a.co || 0); }
    }
    return yOf(el, m) + (a.off || 0);
  }

  function desiredTop(s, el) {
    const list = messages(el);
    if (!list.length) return null; // chat not rendered yet
    // Still showing the chat we just left? Wait for the new one.
    if (s.stale && performance.now() - s.born < 600 && msgKey(list[0]) === s.stale) return null;
    const lk = trustedLastKey(el, list);
    if (lk) s.lastKey = lk;

    const rec = s.rec;
    const mt = maxTop(el);
    const newer = !!(rec && rec.last && s.lastKey && s.lastKey !== rec.last);
    let t = null;
    if (!rec || newer) t = landingTop(el);
    else if (rec.atBottom) t = mt;
    else {
      t = anchorTop(s, el, rec.a);
      if (t == null) t = rec.top; // anchor message not rendered: raw offset
    }
    if (t == null) t = mt;
    return clamp(Math.round(t), 0, mt);
  }

  /* ============================ saving ============================ */
  let currentId;           // undefined = not started, null = "new chat" screen
  let scroller = null;
  let saveTimer = 0;
  let lastCompose = 0;     // last touch of the input box / send button
  let hold = null;         // active restore session
  let shownFirstKey = null; // first message of the chat on screen at last click

  function saveNow(id, s) {
    if (disabled || !id || chatIdFromURL() !== id) return;
    const el = scroller;
    if (!el || !el.isConnected || el.clientHeight === 0) return;
    const prev = store[id];
    const rec = capture(el);
    if (!rec.last) {
      const keep = (s && s.lastKey) || (prev && prev.last);
      if (keep) rec.last = keep;
    }
    store[id] = rec;
    persistSoon();
  }

  function flushPendingSave() {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = 0;
    saveNow(currentId);
  }

  // One capturing listener handles every scroll of the chat pane, no
  // matter how often React re-renders it.
  document.addEventListener('scroll', (e) => {
    if (disabled) return;
    const t = e.target;
    if (hold) {
      if (t === hold.el) apply(hold); // TM jumped: undo it before paint
      return;
    }
    if (t !== scroller) {
      if (!(t instanceof Element) || !t.matches(SEL.scroller)) return;
      scroller = t;
    }
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = 0; saveNow(currentId); }, CFG.saveDebounceMs);
  }, { capture: true, passive: true });

  // Before any click / key can switch chats, lock in the spot while the
  // DOM still shows the chat we're leaving.
  const onInput = (e) => {
    flushPendingSave();
    const t = e.target;
    if (t instanceof Element && t.closest(SEL.compose)) lastCompose = Date.now();
    if (e.type === 'pointerdown' && scroller && scroller.isConnected) {
      const m = scroller.querySelector(SEL.msg);
      shownFirstKey = m ? msgKey(m) : null;
    }
  };
  window.addEventListener('pointerdown', onInput, { capture: true, passive: true });
  window.addEventListener('keydown', onInput, { capture: true, passive: true });

  /* =========================== restoring =========================== */
  function onUserTakeover(e) {
    if (!hold) return;
    if (e.type === 'keydown' && !NAV_KEYS.has(e.key)) return;
    hold.cancelled = true;
    endHold();
  }
  const CANCEL_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'];

  function apply(s) {
    const el = s.el;
    if (!el || !el.isConnected) return;
    const want = desiredTop(s, el);
    if (want == null) return;
    if (Math.abs(el.scrollTop - want) > 1) {
      el.scrollTop = want; // instant, before paint
      s.moved = performance.now();
    }
  }

  function endHold() {
    const s = hold;
    if (!s) return;
    hold = null;
    if (s.raf) cancelAnimationFrame(s.raf);
    if (s.tick) clearInterval(s.tick);
    if (s.ro) s.ro.disconnect();
    if (s.mo) s.mo.disconnect();
    CANCEL_EVENTS.forEach((ev) => window.removeEventListener(ev, onUserTakeover, true));
    // Stamp where we landed (only if we're still on that chat).
    if (currentId === s.id && s.el && s.el.isConnected) saveNow(s.id, s);
  }

  function attach(s, el) {
    s.el = el;
    scroller = el;
    s.t0 = s.moved = performance.now();
    apply(s);

    if (window.ResizeObserver) {
      // Content growing (messages rendering, images, code highlighting)
      // → re-pin in the same frame, before paint.
      s.ro = new ResizeObserver(() => {
        if (hold !== s) return;
        s.moved = performance.now();
        apply(s);
      });
      s.ro.observe(el);
      for (const c of el.children) s.ro.observe(c);
      s.mo = new MutationObserver(() => { for (const c of el.children) s.ro.observe(c); });
      s.mo.observe(el, { childList: true }); // direct children only, not the subtree
    }

    s.tick = setInterval(() => {
      if (hold !== s) return;
      if (s.cancelled || currentId !== s.id || !el.isConnected) return endHold();
      apply(s);
      const now = performance.now();
      if (now - s.t0 > CFG.maxHoldMs ||
          (now - s.t0 > CFG.minHoldMs && now - s.moved > CFG.quietMs)) endHold();
    }, CFG.tickMs);
  }

  function restore(id, stale) {
    endHold();
    let rec = store[id];
    // v1 stamped never-scrolled chats as "top". Treat those as unvisited
    // so they get the new landing spot instead.
    if (rec && !rec.a?.u && !rec.atBottom && (rec.top || 0) <= 5) rec = undefined;

    const now = performance.now();
    const s = { id, rec, born: now, t0: now, moved: 0, el: null, lastKey: null, stale,
                part: null, cancelled: false, raf: 0, tick: 0, ro: null, mo: null };
    hold = s;
    CANCEL_EVENTS.forEach((ev) => window.addEventListener(ev, onUserTakeover, { capture: true, passive: true }));

    // Wait (one cheap query per frame) until the chat is on screen.
    const wait = () => {
      s.raf = 0;
      if (hold !== s) return;
      if (currentId !== id) return endHold();
      const el = getScroller();
      if (el && el.querySelector(SEL.block)) return attach(s, el);
      if (performance.now() - s.t0 > CFG.waitMs) return endHold();
      s.raf = requestAnimationFrame(wait);
    };
    // First look right before the next paint, after React has committed.
    s.raf = requestAnimationFrame(wait);
  }

  /* ====================== chat switch detection ====================== */
  function syncChat() {
    if (disabled) return;
    const id = chatIdFromURL();
    if (id === currentId) return;

    const prev = currentId;
    // The DOM may already show the new chat, so never save here.
    // (The spot was locked in on pointerdown/keydown or by the last scroll.)
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = 0; }
    currentId = id;
    endHold();

    if (!id) return; // "new chat" screen

    // Deep link to a message (#chat=..&messageId=..): TM handles it.
    if (/[#&]messageId=/.test(window.location.hash)) return;

    // Brand-new chat that just got its id from your first message.
    if (prev === null && Date.now() - lastCompose < 5000) return;

    restore(id, prev ? shownFirstKey : null);
  }

  // TM switches chats with history.replaceState (no hashchange event).
  // Microtask = react before the browser paints the new chat.
  ['pushState', 'replaceState'].forEach((fn) => {
    const orig = history[fn];
    history[fn] = function (...args) {
      const r = orig.apply(this, args);
      queueMicrotask(syncChat);
      return r;
    };
  });
  window.addEventListener('hashchange', syncChat);
  window.addEventListener('popstate', syncChat);

  // Fallback: catches anything the hooks miss, plus the chat pane being
  // re-created without a URL change. Skipped while the app is hidden.
  setInterval(() => {
    if (disabled || document.hidden) return;
    syncChat();
    if (hold || !currentId || (scroller && scroller.isConnected)) return;
    const el = getScroller();
    if (!el) return;
    const remounted = !!scroller;
    scroller = el;
    if (remounted) restore(currentId);
  }, CFG.pollMs);

  // Make sure the latest spot survives closing the app (the phone PWA can
  // be killed at any time once it's in the background).
  const flush = () => {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = 0; }
    if (!hold) saveNow(currentId);
    persistNow();
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

  /* ============================ console API ============================ */
  window.TMScrollMemory = {
    version: 2,
    dump() { return JSON.parse(JSON.stringify(store)); },
    forget(id) {
      id = id || currentId;
      delete store[id];
      try {
        const d = JSON.parse(localStorage.getItem(CFG.storageKey) || '{}') || {};
        delete d[id];
        localStorage.setItem(CFG.storageKey, JSON.stringify(d));
      } catch (e) { /* ignore */ }
    },
    clear() { store = {}; dirty = true; try { localStorage.removeItem(CFG.storageKey); } catch (e) { /* ignore */ } },
    off() { disabled = true; endHold(); if (saveTimer) clearTimeout(saveTimer); console.log('[TM Scroll Memory] off until reload'); },
  };

  /* ============================== boot ============================== */
  syncChat();
})();
