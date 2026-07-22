(() => {
  'use strict';

  const EXT_ID = 'typingmind-remember-scroll-v4';
  const STORE_PREFIX = `${EXT_ID}:`;
  const SAVE_DELAY = 80;
  const RESTORE_MIN_MS = 1000;
  const RESTORE_MAX_MS = 3500;
  const SCAN_EVERY_MS = 300;

  // Do not run twice if TypingMind injects the extension more than once.
  if (window.__TM_REMEMBER_SCROLL_V4__) return;

  const S = {
    key: null,
    scroller: null,
    saveTimer: null,
    scanTimer: null,
    restoreToken: 0,
    restoring: false,
    userInterrupted: false,
  };

  /*
   * Small debugging API.
   *
   * In a desktop browser console you can run:
   *
   * window.__TM_REMEMBER_SCROLL_V4__.status()
   *
   * To erase ONLY this extension's saved positions:
   *
   * window.__TM_REMEMBER_SCROLL_V4__.clear()
   */
  window.__TM_REMEMBER_SCROLL_V4__ = {
    version: '4.0.0',

    status: () => ({
      chatKey: S.key,
      hasScroller: !!S.scroller,
      scrollTop: S.scroller ? getTop(S.scroller) : null,
      restoring: S.restoring,
    }),

    clear: () => {
      const keys = [];

      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);

        if (k && k.startsWith(STORE_PREFIX)) {
          keys.push(k);
        }
      }

      keys.forEach((k) => localStorage.removeItem(k));

      console.log(
        `[${EXT_ID}] cleared ${keys.length} saved positions`
      );
    },
  };

  /* ─────────────────────────────────────────────
     Helpers
  ───────────────────────────────────────────── */

  function text(v) {
    return String(v || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function hash(str) {
    let h1 = 0xdeadbeef ^ str.length;
    let h2 = 0x41c6ce57 ^ str.length;

    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);

      h1 = Math.imul(
        h1 ^ c,
        2654435761
      );

      h2 = Math.imul(
        h2 ^ c,
        1597334677
      );
    }

    h1 =
      Math.imul(
        h1 ^ (h1 >>> 16),
        2246822507
      ) ^
      Math.imul(
        h2 ^ (h2 >>> 13),
        3266489909
      );

    h2 =
      Math.imul(
        h2 ^ (h2 >>> 16),
        2246822507
      ) ^
      Math.imul(
        h1 ^ (h1 >>> 13),
        3266489909
      );

    return (
      4294967296 *
        (2097151 & h2) +
      (h1 >>> 0)
    ).toString(36);
  }

  /* ─────────────────────────────────────────────
     Find TypingMind user messages
  ───────────────────────────────────────────── */

  function userMessages() {
    return [
      ...document.querySelectorAll(
        '[data-element-id="user-message"]'
      ),
    ].filter((el) => {
      return (
        el instanceof HTMLElement &&
        el.isConnected &&
        text(el.innerText).length
      );
    });
  }

  /* ─────────────────────────────────────────────
     Try to identify the current chat
  ───────────────────────────────────────────── */

  function looksLikeId(v) {
    v = text(v);

    if (
      v.length < 10 ||
      v.length > 220
    ) {
      return false;
    }

    if (
      /^(user-message|assistant-message)$/i.test(v)
    ) {
      return false;
    }

    return (
      /^[a-f0-9]{8}-[a-f0-9-]{20,}$/i.test(v) ||
      /^[0-9A-HJKMNP-TV-Z]{20,}$/i.test(v) ||
      /^[a-z0-9_-]{16,}$/i.test(v) ||
      /(?:chat|conversation|message)[=/:-][a-z0-9_-]{8,}/i.test(
        v
      )
    );
  }

  function nativeIdFromUrl() {
    try {
      const u = new URL(location.href);

      const names = new Set([
        'chat',
        'chatid',
        'chat_id',
        'conversation',
        'conversationid',
        'conversation_id',
      ]);

      for (
        const [k, v]
        of u.searchParams
      ) {
        if (
          names.has(k.toLowerCase()) &&
          looksLikeId(v)
        ) {
          return v;
        }
      }

      const rawHash =
        u.hash.replace(/^#/, '');

      if (looksLikeId(rawHash)) {
        return rawHash;
      }

      const m = rawHash.match(
        /(?:chat|conversation)(?:id)?[=/:_-]+([a-z0-9_-]{10,})/i
      );

      if (
        m &&
        looksLikeId(m[1])
      ) {
        return m[1];
      }
    } catch (_) {
      // Ignore transient or unusual URLs.
    }

    return null;
  }

  function nativeIdFromFirstMessage(msg) {
    const attrs = [
      'data-message-id',
      'data-chat-message-id',
      'data-id',
      'data-key',
      'id',
    ];

    let el = msg;

    for (
      let depth = 0;
      el &&
      el !== document.body &&
      depth < 7;
      depth++,
      el = el.parentElement
    ) {
      for (const a of attrs) {
        const v =
          el.getAttribute?.(a);

        if (
          v &&
          looksLikeId(v)
        ) {
          return v;
        }
      }
    }

    return null;
  }

  function chatKey(msgs) {
    if (!msgs.length) {
      return null;
    }

    /*
     * Best case:
     * use a real stable ID exposed by TypingMind.
     */
    const native =
      nativeIdFromUrl() ||
      nativeIdFromFirstMessage(
        msgs[0]
      );

    if (native) {
      return `native:${hash(native)}`;
    }

    /*
     * Fallback:
     *
     * Use ONLY the first user message.
     *
     * We intentionally do not include
     * later messages because the chat key
     * must not change as the chat grows.
     */
    const first = text(
      msgs[0].innerText ||
      msgs[0].textContent
    ).slice(0, 5000);

    return first
      ? `first:${hash(first)}`
      : null;
  }

  /* ─────────────────────────────────────────────
     Find the REAL chat scroll container
  ───────────────────────────────────────────── */

  function isDocScroller(el) {
    return (
      el === document.scrollingElement ||
      el === document.documentElement ||
      el === document.body
    );
  }

  function findScroller(msgs) {
    if (!msgs.length) {
      return null;
    }

    /*
     * Walk upward from an actual message.
     *
     * This is much safer than blindly selecting
     * the first .overflow-y-auto element because
     * TypingMind also has scrollable sidebars
     * and other panels.
     */
    let el =
      msgs[0].parentElement;

    while (
      el &&
      el !== document.body &&
      el !== document.documentElement
    ) {
      if (
        el instanceof HTMLElement
      ) {
        const cs =
          getComputedStyle(el);

        if (
          el.clientHeight >= 120 &&
          el.scrollHeight -
            el.clientHeight >
            20 &&
          /auto|scroll|overlay/i.test(
            cs.overflowY
          )
        ) {
          return el;
        }
      }

      el = el.parentElement;
    }

    /*
     * TypingMind/Tailwind fallback.
     */
    const candidates = [
      ...document.querySelectorAll(
        '.overflow-y-auto, [class*="overflow-y-auto"]'
      ),
    ].filter((x) => {
      return (
        x instanceof HTMLElement &&
        x.contains(msgs[0]) &&
        x.clientHeight >= 120 &&
        x.scrollHeight -
          x.clientHeight >
          20
      );
    });

    if (candidates.length) {
      return candidates[0];
    }

    /*
     * Last fallback:
     * browser/document scrolling.
     */
    const d =
      document.scrollingElement ||
      document.documentElement;

    return (
      d &&
      d.scrollHeight -
        d.clientHeight >
        20
    )
      ? d
      : null;
  }

  /* ─────────────────────────────────────────────
     Generic scroll measurements
  ───────────────────────────────────────────── */

  function getTop(scroller) {
    return isDocScroller(scroller)
      ? (
          window.scrollY ||
          document.documentElement
            .scrollTop ||
          0
        )
      : scroller.scrollTop;
  }

  function clientH(scroller) {
    return isDocScroller(scroller)
      ? window.innerHeight
      : scroller.clientHeight;
  }

  function scrollH(scroller) {
    return isDocScroller(scroller)
      ? Math.max(
          document.body
            ?.scrollHeight || 0,
          document.documentElement
            .scrollHeight || 0
        )
      : scroller.scrollHeight;
  }

  function maxTop(scroller) {
    return Math.max(
      0,
      scrollH(scroller) -
        clientH(scroller)
    );
  }

  function viewportTop(scroller) {
    return isDocScroller(scroller)
      ? 0
      : scroller
          .getBoundingClientRect()
          .top;
  }

  /* ─────────────────────────────────────────────
     Instant/non-animated scrolling
  ───────────────────────────────────────────── */

  function setTop(
    scroller,
    value
  ) {
    if (!scroller) {
      return;
    }

    const target = Math.max(
      0,
      Math.min(
        Number(value) || 0,
        maxTop(scroller)
      )
    );

    /*
     * Page/document scrolling.
     */
    if (
      isDocScroller(scroller)
    ) {
      const root =
        document.documentElement;

      const body =
        document.body;

      const oldRoot =
        root.style.scrollBehavior;

      const oldBody =
        body?.style
          .scrollBehavior || '';

      /*
       * Temporarily defeat any CSS
       * smooth scrolling.
       *
       * Restoring should APPEAR at
       * the old position, not visibly
       * animate from the bottom.
       */
      root.style.setProperty(
        'scroll-behavior',
        'auto',
        'important'
      );

      if (body) {
        body.style.setProperty(
          'scroll-behavior',
          'auto',
          'important'
        );
      }

      window.scrollTo(
        0,
        target
      );

      requestAnimationFrame(() => {
        root.style.scrollBehavior =
          oldRoot;

        if (body) {
          body.style.scrollBehavior =
            oldBody;
        }
      });

      return;
    }

    /*
     * Nested TypingMind
     * conversation container.
     */
    const old =
      scroller.style
        .scrollBehavior;

    scroller.style.setProperty(
      'scroll-behavior',
      'auto',
      'important'
    );

    scroller.scrollTop =
      target;

    requestAnimationFrame(() => {
      scroller.style.scrollBehavior =
        old;
    });
  }

  /* ─────────────────────────────────────────────
     Local storage
  ───────────────────────────────────────────── */

  function recordKey(k) {
    return `${STORE_PREFIX}${k}`;
  }

  function read(k) {
    try {
      const x = JSON.parse(
        localStorage.getItem(
          recordKey(k)
        ) || 'null'
      );

      return (
        x &&
        typeof x.scrollTop ===
          'number'
      )
        ? x
        : null;
    } catch (_) {
      return null;
    }
  }

  function write(
    k,
    value
  ) {
    try {
      localStorage.setItem(
        recordKey(k),
        JSON.stringify(value)
      );
    } catch (_) {
      /*
       * Never allow storage failure
       * to interfere with TypingMind.
       */
    }
  }

  /* ─────────────────────────────────────────────
     Message anchor system
  ───────────────────────────────────────────── */

  function msgHash(el) {
    return hash(
      text(
        el?.innerText ||
        el?.textContent
      ).slice(0, 1800)
    );
  }

  function bestAnchor(
    msgs,
    scroller
  ) {
    const top =
      viewportTop(scroller);

    let best = null;
    let bestDistance =
      Infinity;

    /*
     * Find the user message closest
     * to the top of the viewport.
     *
     * We save:
     * - which message it was
     * - its text fingerprint
     * - its exact visual offset
     *
     * This is much more reliable than
     * raw scrollTop alone.
     */
    for (
      let i = 0;
      i < msgs.length;
      i++
    ) {
      const r =
        msgs[i]
          .getBoundingClientRect();

      const d =
        Math.abs(
          r.top - top
        );

      if (
        d <
        bestDistance
      ) {
        bestDistance =
          d;

        best = {
          index: i,
          hash:
            msgHash(msgs[i]),
          offset:
            r.top - top,
        };
      }
    }

    return best;
  }

  /* ─────────────────────────────────────────────
     Save current position
  ───────────────────────────────────────────── */

  function saveNow() {
    clearTimeout(
      S.saveTimer
    );

    S.saveTimer =
      null;

    if (
      !S.key ||
      !S.scroller ||
      !S.scroller.isConnected
    ) {
      return;
    }

    const msgs =
      userMessages();

    if (!msgs.length) {
      return;
    }

    const top =
      getTop(S.scroller);

    const max =
      maxTop(S.scroller);

    write(
      S.key,
      {
        scrollTop: top,

        scrollHeight:
          scrollH(
            S.scroller
          ),

        clientHeight:
          clientH(
            S.scroller
          ),

        ratio:
          max > 0
            ? top / max
            : 0,

        distanceFromBottom:
          Math.max(
            0,
            max - top
          ),

        anchor:
          bestAnchor(
            msgs,
            S.scroller
          ),

        savedAt:
          Date.now(),
      }
    );
  }

  function queueSave() {
    clearTimeout(
      S.saveTimer
    );

    S.saveTimer =
      setTimeout(
        saveNow,
        SAVE_DELAY
      );
  }

  /* ─────────────────────────────────────────────
     Locate saved anchor again
  ───────────────────────────────────────────── */

  function anchorElement(
    rec,
    msgs
  ) {
    const a =
      rec?.anchor;

    if (!a) {
      return null;
    }

    /*
     * Fast path:
     * same message index.
     */
    if (
      Number.isInteger(
        a.index
      ) &&
      msgs[a.index] &&
      msgHash(
        msgs[a.index]
      ) === a.hash
    ) {
      return msgs[
        a.index
      ];
    }

    /*
     * Fallback:
     * find by message fingerprint.
     */
    return (
      msgs.find(
        (m) =>
          msgHash(m) ===
          a.hash
      ) ||
      null
    );
  }

  /* ─────────────────────────────────────────────
     Apply a saved position
  ───────────────────────────────────────────── */

  function applyRecord(
    rec,
    scroller,
    msgs
  ) {
    const anchor =
      anchorElement(
        rec,
        msgs
      );

    /*
     * BEST METHOD:
     *
     * Restore based on a known message
     * plus its exact visual offset.
     *
     * This survives changes in total
     * conversation height much better.
     */
    if (
      anchor &&
      rec.anchor
    ) {
      const currentOffset =
        anchor
          .getBoundingClientRect()
          .top -
        viewportTop(
          scroller
        );

      const delta =
        currentOffset -
        (
          Number(
            rec.anchor.offset
          ) || 0
        );

      setTop(
        scroller,
        getTop(scroller) +
          delta
      );

      return;
    }

    /*
     * Fallback methods.
     */
    const currentHeight =
      scrollH(scroller);

    const currentMax =
      maxTop(scroller);

    /*
     * If height hasn't really changed,
     * exact pixels are best.
     */
    if (
      Math.abs(
        currentHeight -
          (
            Number(
              rec.scrollHeight
            ) || 0
          )
      ) < 120
    ) {
      setTop(
        scroller,
        rec.scrollTop
      );

      return;
    }

    /*
     * If they were near the bottom,
     * preserve the exact distance
     * from the bottom.
     */
    if (
      Number(
        rec.distanceFromBottom
      ) <= 500
    ) {
      setTop(
        scroller,
        currentMax -
          Number(
            rec.distanceFromBottom
          )
      );

      return;
    }

    /*
     * Last general fallback:
     * relative percentage.
     */
    if (
      Number.isFinite(
        rec.ratio
      )
    ) {
      setTop(
        scroller,
        currentMax *
          rec.ratio
      );

      return;
    }

    /*
     * Absolute last fallback.
     */
    setTop(
      scroller,
      rec.scrollTop
    );
  }

  /* ─────────────────────────────────────────────
     Restore current chat
  ───────────────────────────────────────────── */

  async function restore(
    k,
    scroller
  ) {
    const rec =
      read(k);

    /*
     * No saved position yet.
     *
     * This is normal the first time
     * you open/use a chat after
     * installing the extension.
     */
    if (!rec) {
      return;
    }

    const token =
      ++S.restoreToken;

    S.restoring = true;
    S.userInterrupted =
      false;

    const started =
      performance.now();

    let lastHeight = -1;
    let stableFrames = 0;

    try {
      while (
        token ===
          S.restoreToken &&
        !S.userInterrupted &&
        S.key === k &&
        scroller.isConnected &&
        performance.now() -
          started <
          RESTORE_MAX_MS
      ) {
        const msgs =
          userMessages();

        if (msgs.length) {
          /*
           * Keep re-applying while
           * TypingMind finishes loading.
           *
           * This is intentional:
           * TypingMind may itself jump
           * back to the bottom while
           * React/markdown/images/fonts
           * are still settling.
           */
          applyRecord(
            rec,
            scroller,
            msgs
          );
        }

        const h =
          scrollH(
            scroller
          );

        if (
          h === lastHeight
        ) {
          stableFrames++;
        } else {
          lastHeight = h;
          stableFrames = 0;
        }

        /*
         * Do not declare victory too early.
         *
         * We keep defending the restored
         * position for at least one second.
         *
         * User touch/wheel input immediately
         * cancels this process.
         */
        if (
          performance.now() -
            started >=
            RESTORE_MIN_MS &&
          stableFrames >= 7
        ) {
          const finalMsgs =
            userMessages();

          if (
            finalMsgs.length
          ) {
            applyRecord(
              rec,
              scroller,
              finalMsgs
            );
          }

          break;
        }

        await new Promise(
          requestAnimationFrame
        );
      }
    } finally {
      if (
        token ===
        S.restoreToken
      ) {
        S.restoring =
          false;
      }
    }
  }

  /* ─────────────────────────────────────────────
     Set active chat context
  ───────────────────────────────────────────── */

  function setContext(
    k,
    scroller
  ) {
    if (
      k === S.key &&
      scroller ===
        S.scroller
    ) {
      return;
    }

    /*
     * Save old conversation first.
     */
    saveNow();

    /*
     * Cancel any previous restore.
     */
    S.restoreToken++;

    S.restoring = false;
    S.userInterrupted =
      false;

    S.key = k;
    S.scroller =
      scroller;

    /*
     * Restore new conversation.
     */
    restore(
      k,
      scroller
    );
  }

  /* ─────────────────────────────────────────────
     Scan current TypingMind UI
  ───────────────────────────────────────────── */

  function scan() {
    const msgs =
      userMessages();

    if (!msgs.length) {
      return;
    }

    const k =
      chatKey(msgs);

    const scroller =
      findScroller(msgs);

    if (
      k &&
      scroller
    ) {
      setContext(
        k,
        scroller
      );
    }
  }

  function queueScan(
    delay = 30
  ) {
    clearTimeout(
      S.scanTimer
    );

    S.scanTimer =
      setTimeout(
        scan,
        delay
      );
  }

  /* ─────────────────────────────────────────────
     Stop auto-restoration when USER intervenes
  ───────────────────────────────────────────── */

  function interrupt(
    event
  ) {
    if (
      !S.restoring ||
      !S.scroller
    ) {
      return;
    }

    const t =
      event.target;

    if (
      isDocScroller(
        S.scroller
      ) ||
      t === S.scroller ||
      (
        t instanceof Node &&
        S.scroller.contains(t)
      )
    ) {
      S.userInterrupted =
        true;

      S.restoreToken++;

      S.restoring =
        false;
    }
  }

  /* ─────────────────────────────────────────────
     Save BEFORE sidebar taps/clicks
  ───────────────────────────────────────────── */

  document.addEventListener(
    'pointerdown',
    (e) => {
      /*
       * Critical on mobile:
       *
       * Save the current conversation
       * BEFORE TypingMind handles the tap
       * and replaces the chat DOM.
       */
      saveNow();

      interrupt(e);
    },
    true
  );

  document.addEventListener(
    'touchstart',
    interrupt,
    {
      capture: true,
      passive: true,
    }
  );

  document.addEventListener(
    'wheel',
    interrupt,
    {
      capture: true,
      passive: true,
    }
  );

  /* ─────────────────────────────────────────────
     Track scrolling
  ───────────────────────────────────────────── */

  /*
   * Scroll events do not reliably bubble,
   * so capture at document level.
   */
  document.addEventListener(
    'scroll',
    (e) => {
      if (!S.scroller) {
        return;
      }

      if (
        e.target ===
          S.scroller ||
        (
          isDocScroller(
            S.scroller
          ) &&
          e.target ===
            document
        )
      ) {
        queueSave();
      }
    },
    true
  );

  window.addEventListener(
    'scroll',
    () => {
      if (
        S.scroller &&
        isDocScroller(
          S.scroller
        )
      ) {
        queueSave();
      }
    },
    {
      passive: true,
    }
  );

  /* ─────────────────────────────────────────────
     App/browser lifecycle
  ───────────────────────────────────────────── */

  window.addEventListener(
    'pagehide',
    saveNow
  );

  window.addEventListener(
    'beforeunload',
    saveNow
  );

  document.addEventListener(
    'visibilitychange',
    () => {
      if (
        document.visibilityState ===
        'hidden'
      ) {
        /*
         * Important on mobile/PWA:
         * app switching can suspend
         * JavaScript very quickly.
         */
        saveNow();
      } else {
        queueScan(20);
      }
    }
  );

  /* ─────────────────────────────────────────────
     Detect SPA navigation
  ───────────────────────────────────────────── */

  const oldPush =
    history.pushState.bind(
      history
    );

  history.pushState =
    (...args) => {
      saveNow();

      const out =
        oldPush(...args);

      queueScan(0);

      return out;
    };

  const oldReplace =
    history.replaceState.bind(
      history
    );

  history.replaceState =
    (...args) => {
      saveNow();

      const out =
        oldReplace(...args);

      queueScan(0);

      return out;
    };

  window.addEventListener(
    'popstate',
    () => {
      saveNow();
      queueScan(0);
    }
  );

  /* ─────────────────────────────────────────────
     Watch React/TypingMind DOM changes
  ───────────────────────────────────────────── */

  const observer =
    new MutationObserver(
      () => {
        queueScan(35);
      }
    );

  observer.observe(
    document.documentElement,
    {
      childList: true,
      subtree: true,
    }
  );

  /*
   * Fallback for state changes
   * that don't produce a useful
   * URL or DOM event.
   *
   * 300ms is light enough for mobile
   * while still reacting quickly.
   */
  setInterval(
    scan,
    SCAN_EVERY_MS
  );

  /* ─────────────────────────────────────────────
     Disable native browser scroll restoration
     so it doesn't fight our per-chat restoration
  ───────────────────────────────────────────── */

  try {
    if (
      'scrollRestoration'
      in history
    ) {
      history.scrollRestoration =
        'manual';
    }
  } catch (_) {
    // Ignore restricted PWA/browser environments.
  }

  /* ─────────────────────────────────────────────
     Startup scans
  ───────────────────────────────────────────── */

  scan();

  setTimeout(
    scan,
    150
  );

  setTimeout(
    scan,
    600
  );

  setTimeout(
    scan,
    1400
  );

  console.log(
    `[${EXT_ID}] loaded`
  );
})();
