/* =====================================================================
 * TypingMind Persistent Highlighter
 * Version 3.3.1
 *
 * Fixes in 3.3.1
 *  - Fixes the launcher being permanently hidden on phones.
 *  - Off-screen sidebar controls no longer count as an open sidebar.
 *  - Launcher hides only while TypingMind's sidebar is actually open.
 *  - Highlights panel consistently uses Inter.
 *  - Compact draggable color toolbar with secondary action menu.
 * ===================================================================== */

(() => {
  "use strict";

  const VERSION = "3.3.1";
  const FLAG = "__TM_HIGHLIGHTER_V3__";

  const rank = (value) =>
    String(value || "0")
      .split(".")
      .reduce((total, part) => total * 1000 + (Number(part) || 0), 0);

  const prior = window[FLAG];

  if (prior && prior.loaded) {
    if (rank(prior.version) < rank(VERSION)) {
      console.warn(
        `[TM Highlighter] v${prior.version} is already running, so v${VERSION} did not start. Reload TypingMind to start the new version.`
      );
    }
    return;
  }

  window[FLAG] = {
    loading: true,
    version: VERSION
  };

  /* ------------------------------------------------------------------
   * Constants
   * ---------------------------------------------------------------- */

  const LS_DATA = "tm-highlights-v3";
  const LS_SETTINGS = "tm-highlights-v3-settings";
  const LEGACY_KEY = "typingmind-persistent-highlights-v2";
  const CHANNEL_NAME = "tm-highlights-v3-bus";
  const TOMBSTONE_TTL_MS = 45 * 24 * 60 * 60 * 1000;
  const MOBILE_BREAKPOINT = 820;

  const COLORS = [
    "yellow",
    "green",
    "blue",
    "pink",
    "purple"
  ];

  const COLOR_LABEL = {
    yellow: "Yellow",
    green: "Green",
    blue: "Blue",
    pink: "Pink",
    purple: "Purple"
  };

  const ROOT_SELECTORS = [
    '[data-element-id="response-block"]',
    '[data-element-id="ai-response"]',
    '[data-element-id="user-message"]'
  ];

  const MARK_SELECTOR = "mark.tmhl-mark";

  const SKIP_TEXT_SELECTOR = [
    "script",
    "style",
    "noscript",
    "button",
    "select",
    "textarea",
    "input",
    '[role="button"]',
    '[aria-hidden="true"]',
    ".katex-mathml",
    "[data-tmhl-ui]"
  ].join(", ");

  const TM_NAV_SELECTOR =
    '[data-element-id="nav-container"]';

  const TM_COMPACT_SIDEBAR_BUTTON =
    'button[data-element-id="workspace-logo-button-compact"]';

  const TM_SIDEBAR_OPEN_SELECTOR = [
    TM_COMPACT_SIDEBAR_BUTTON,
    'button[data-element-id="open-sidebar-button"]',
    'button[data-element-id="sidebar-open-button"]',
    'button[aria-label="Open sidebar"]',
    'button[aria-label*="Open sidebar" i]',
    'button[title="Open sidebar"]',
    'button[title*="Open sidebar" i]'
  ].join(", ");

  const TM_SIDEBAR_CLOSE_SELECTOR = [
    'button[data-element-id="close-sidebar-button"]',
    'button[data-element-id="sidebar-close-button"]',
    'button[aria-label="Close sidebar"]',
    'button[aria-label*="Close sidebar" i]',
    'button[title="Close sidebar"]',
    'button[title*="Close sidebar" i]'
  ].join(", ");

  const DEFAULT_SETTINGS = {
    settingsVersion: 3,
    defaultColor: "yellow",
    launcherMode: "full",
    autoHideMobileLauncher: true,
    seenIntro: false,
    launcher: {
      xPct: 0.93,
      yPct: 0.6
    },
    toolbar: {
      pinned: false,
      xPct: 0.5,
      yPct: 0.35
    }
  };

  /* ------------------------------------------------------------------
   * Utilities
   * ---------------------------------------------------------------- */

  const now = () => Date.now();

  function makeId() {
    if (
      window.crypto &&
      typeof crypto.randomUUID === "function"
    ) {
      return crypto.randomUUID();
    }

    return [
      Date.now().toString(36),
      Math.random().toString(36).slice(2),
      Math.random().toString(36).slice(2)
    ].join("-");
  }

  function hashText(text) {
    let hash = 2166136261;

    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }

    return `${(hash >>> 0).toString(36)}:${text.length}`;
  }

  function debounce(fn, wait) {
    let timer = 0;

    return (...args) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(
        () => fn(...args),
        wait
      );
    };
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(value, max));
  }

  function structuredCopy(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function relativeTime(iso) {
    const stamp = Date.parse(iso);

    if (!Number.isFinite(stamp)) return "";

    const diff = Math.max(0, now() - stamp);
    const minute = 60000;
    const hour = 60 * minute;
    const day = 24 * hour;

    if (diff < minute) return "just now";
    if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
    if (diff < day) return `${Math.floor(diff / hour)}h ago`;
    if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;

    return new Date(stamp).toLocaleDateString(
      undefined,
      {
        month: "short",
        day: "numeric"
      }
    );
  }

  function viewportBounds() {
    const viewport = window.visualViewport;

    const left = viewport
      ? viewport.offsetLeft
      : 0;

    const top = viewport
      ? viewport.offsetTop
      : 0;

    const width = viewport
      ? viewport.width
      : window.innerWidth;

    const height = viewport
      ? viewport.height
      : window.innerHeight;

    return {
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height
    };
  }

  function isTouch() {
    return window
      .matchMedia("(pointer: coarse)")
      .matches;
  }

  function isNarrow() {
    return viewportBounds().width <= MOBILE_BREAKPOINT;
  }

  function isVisibleElement(node) {
    if (
      !(node instanceof Element) ||
      !node.isConnected
    ) {
      return false;
    }

    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);

    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity || 1) !== 0
    );
  }

  function isElementOnScreen(node) {
    if (!isVisibleElement(node)) return false;

    const rect = node.getBoundingClientRect();
    const viewport = viewportBounds();

    return (
      rect.right > viewport.left + 2 &&
      rect.left < viewport.right - 2 &&
      rect.bottom > viewport.top + 2 &&
      rect.top < viewport.bottom - 2
    );
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const area = document.createElement("textarea");

        area.value = text;
        area.setAttribute("data-tmhl-ui", "true");
        area.style.position = "fixed";
        area.style.opacity = "0";

        document.body.appendChild(area);
        area.select();

        const ok = document.execCommand("copy");

        area.remove();

        return ok;
      } catch {
        return false;
      }
    }
  }

  function downloadFile(name, text, mime) {
    const blob = new Blob([text], {
      type: mime || "text/plain"
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = name;

    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(
      () => URL.revokeObjectURL(url),
      4000
    );
  }

  function el(tag, props, children) {
    const node = document.createElement(tag);

    if (props) {
      Object.entries(props).forEach(
        ([key, value]) => {
          if (
            value === undefined ||
            value === null
          ) {
            return;
          }

          if (key === "class") {
            node.className = value;
          } else if (key === "text") {
            node.textContent = value;
          } else if (key === "html") {
            node.innerHTML = value;
          } else if (
            key.startsWith("on") &&
            typeof value === "function"
          ) {
            node.addEventListener(
              key.slice(2).toLowerCase(),
              value
            );
          } else {
            node.setAttribute(key, value);
          }
        }
      );
    }

    (children || []).forEach((child) => {
      if (child) node.appendChild(child);
    });

    return node;
  }

  /* ------------------------------------------------------------------
   * Settings
   * ---------------------------------------------------------------- */

  let settings = loadSettings();

  function loadSettings() {
    try {
      const raw = localStorage.getItem(LS_SETTINGS);

      if (!raw) {
        return structuredCopy(DEFAULT_SETTINGS);
      }

      const parsed = JSON.parse(raw);

      const merged = {
        ...structuredCopy(DEFAULT_SETTINGS),
        ...parsed,
        launcher: {
          ...DEFAULT_SETTINGS.launcher,
          ...(parsed.launcher || {})
        },
        toolbar: {
          ...DEFAULT_SETTINGS.toolbar,
          ...(parsed.toolbar || {})
        }
      };

      if (!parsed.settingsVersion) {
        merged.launcherMode =
          parsed.showLauncher === false
            ? "mini"
            : "full";

        delete merged.showLauncher;
      }

      if (merged.launcherMode !== "mini") {
        merged.launcherMode = "full";
      }

      merged.autoHideMobileLauncher =
        parsed.autoHideMobileLauncher !== false;

      const launcherPosition =
        merged.launcher || {};

      if (
        !Number.isFinite(launcherPosition.xPct) ||
        !Number.isFinite(launcherPosition.yPct)
      ) {
        merged.launcher = {
          xPct:
            launcherPosition.side === "left"
              ? 0.07
              : 0.93,
          yPct: Number.isFinite(
            launcherPosition.topPct
          )
            ? launcherPosition.topPct
            : 0.6
        };
      }

      const toolbarPosition =
        merged.toolbar || {};

      merged.toolbar = {
        pinned: Boolean(toolbarPosition.pinned),
        xPct: Number.isFinite(toolbarPosition.xPct)
          ? clamp(toolbarPosition.xPct, 0, 1)
          : 0.5,
        yPct: Number.isFinite(toolbarPosition.yPct)
          ? clamp(toolbarPosition.yPct, 0, 1)
          : 0.35
      };

      merged.settingsVersion = 3;

      return merged;
    } catch {
      return structuredCopy(DEFAULT_SETTINGS);
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(
        LS_SETTINGS,
        JSON.stringify(settings)
      );
    } catch (error) {
      console.warn(
        "[TM Highlighter] Settings not saved.",
        error
      );
    }
  }

  /* ------------------------------------------------------------------
   * Store
   * ---------------------------------------------------------------- */

  let store = loadStore();
  let bus = null;

  function emptyStore() {
    return {
      version: 3,
      updatedAt: 0,
      items: []
    };
  }

  function validRecord(record) {
    return Boolean(
      record &&
        typeof record.id === "string" &&
        typeof record.chatId === "string" &&
        typeof record.exact === "string" &&
        record.exact.length > 0 &&
        Number.isFinite(record.start) &&
        Number.isFinite(record.end)
    );
  }

  function normalizeRecord(record) {
    return {
      id: record.id,
      chatId: record.chatId,
      chatTitle: record.chatTitle || "",
      color: COLORS.includes(record.color)
        ? record.color
        : "yellow",
      exact: record.exact,
      note:
        typeof record.note === "string"
          ? record.note
          : "",
      prefix: record.prefix || "",
      suffix: record.suffix || "",
      start: record.start,
      end: record.end,
      messageIndex: Number.isFinite(
        record.messageIndex
      )
        ? record.messageIndex
        : -1,
      messageHash: record.messageHash || "",
      createdAt:
        record.createdAt ||
        new Date().toISOString(),
      updatedAt: Number.isFinite(record.updatedAt)
        ? record.updatedAt
        : Date.parse(record.createdAt || "") ||
          now(),
      deleted: Boolean(record.deleted)
    };
  }

  function loadStore() {
    let doc = emptyStore();

    try {
      const raw = localStorage.getItem(LS_DATA);

      if (raw) {
        const parsed = JSON.parse(raw);

        if (
          parsed &&
          Array.isArray(parsed.items)
        ) {
          doc = {
            version: 3,
            updatedAt:
              Number(parsed.updatedAt) || 0,
            items: parsed.items
              .filter(validRecord)
              .map(normalizeRecord)
          };
        }
      }
    } catch (error) {
      console.warn(
        "[TM Highlighter] Could not read storage.",
        error
      );
    }

    if (!doc.items.length) {
      const migrated = migrateLegacy();

      if (migrated.length) {
        doc.items = migrated;
        doc.updatedAt = now();
      }
    }

    return doc;
  }

  function migrateLegacy() {
    try {
      const raw =
        localStorage.getItem(LEGACY_KEY);

      if (!raw) return [];

      const parsed = JSON.parse(raw);

      const items = Array.isArray(parsed)
        ? parsed
        : parsed && parsed.items;

      if (!Array.isArray(items)) return [];

      const mapped = items
        .filter(validRecord)
        .map(normalizeRecord);

      if (mapped.length) {
        console.info(
          `[TM Highlighter] Migrated ${mapped.length} highlights from v2.`
        );
      }

      return mapped;
    } catch {
      return [];
    }
  }

  function liveItems() {
    return store.items.filter(
      (item) => !item.deleted
    );
  }

  function itemsForChat(chatId) {
    if (!chatId) return [];

    return liveItems().filter(
      (item) => item.chatId === chatId
    );
  }

  function findRecord(id) {
    return (
      store.items.find(
        (item) => item.id === id
      ) || null
    );
  }

  function pruneTombstones() {
    const cutoff =
      now() - TOMBSTONE_TTL_MS;

    const before = store.items.length;

    store.items = store.items.filter(
      (item) =>
        !item.deleted ||
        item.updatedAt > cutoff
    );

    return store.items.length !== before;
  }

  function persist(options) {
    const opts = options || {};

    store.updatedAt = now();

    try {
      localStorage.setItem(
        LS_DATA,
        JSON.stringify(store)
      );
    } catch (error) {
      console.error(
        "[TM Highlighter] Save failed.",
        error
      );

      toast(
        "Storage is full. Export and clear old highlights."
      );

      return false;
    }

    if (bus && !opts.silentBus) {
      try {
        bus.postMessage({
          type: "changed",
          at: store.updatedAt
        });
      } catch {
        /* Ignore BroadcastChannel errors. */
      }
    }

    renderPanel();
    updateLauncher();

    return true;
  }

  function mergeDocs(local, remote) {
    const byId = new Map();

    local.items.forEach((item) => {
      byId.set(item.id, item);
    });

    let changed = false;

    (remote.items || [])
      .filter(validRecord)
      .forEach((raw) => {
        const incoming =
          normalizeRecord(raw);

        const current =
          byId.get(incoming.id);

        if (!current) {
          byId.set(incoming.id, incoming);
          changed = true;
          return;
        }

        if (
          incoming.updatedAt >
          current.updatedAt
        ) {
          byId.set(incoming.id, incoming);
          changed = true;
        }
      });

    return {
      changed,
      doc: {
        version: 3,
        updatedAt: Math.max(
          local.updatedAt || 0,
          remote.updatedAt || 0
        ),
        items: Array.from(byId.values())
      }
    };
  }

  /* ------------------------------------------------------------------
   * Chat context
   * ---------------------------------------------------------------- */

  function currentChatId() {
    const match =
      window.location.href.match(
        /(?:#|[?&])chat=([^&?#]+)/
      );

    if (match && match[1]) {
      try {
        return decodeURIComponent(match[1]);
      } catch {
        return match[1];
      }
    }

    const selected =
      document.querySelector(
        '[data-element-id="selected-chat-item"]'
      );

    if (selected) {
      const direct =
        selected.getAttribute("data-chat-id") ||
        selected.dataset.chatId;

      if (direct) return String(direct);

      const link = selected.matches("a")
        ? selected
        : selected.closest("a") ||
          selected.querySelector("a");

      const href =
        link && link.getAttribute("href");

      const hrefMatch =
        href &&
        href.match(/#chat=([^&?#]+)/);

      if (hrefMatch && hrefMatch[1]) {
        try {
          return decodeURIComponent(
            hrefMatch[1]
          );
        } catch {
          return hrefMatch[1];
        }
      }
    }

    return null;
  }

  function currentChatTitle() {
    const selected =
      document.querySelector(
        '[data-element-id="selected-chat-item"]'
      );

    const text =
      selected &&
      selected.textContent.trim();

    if (text) {
      return text
        .replace(/\s+/g, " ")
        .slice(0, 120);
    }

    const title = (
      document.title || ""
    ).replace(
      /\s*[|·-]\s*TypingMind.*$/i,
      ""
    );

    return (
      title.trim().slice(0, 120) ||
      "Untitled chat"
    );
  }

  /* ------------------------------------------------------------------
   * Text mapping
   * ---------------------------------------------------------------- */

  let textCacheGen = 0;
  const textCache = new WeakMap();

  function bumpTextCache() {
    textCacheGen += 1;
  }

  function getResponseRoots() {
    const container =
      document.querySelector(
        ".dynamic-chat-content-container"
      ) || document;

    for (const selector of ROOT_SELECTORS) {
      const found = Array.from(
        container.querySelectorAll(selector)
      ).filter(
        (node) =>
          node.isConnected &&
          !(
            node.parentElement &&
            node.parentElement.closest(selector)
          )
      );

      if (found.length) return found;
    }

    return [];
  }

  function rootFromNode(node) {
    if (!node) return null;

    const element =
      node.nodeType === Node.ELEMENT_NODE
        ? node
        : node.parentElement;

    if (!element) return null;

    for (const selector of ROOT_SELECTORS) {
      const found =
        element.closest(selector);

      if (found) return found;
    }

    return null;
  }

  function getTextNodes(root) {
    const cached = textCache.get(root);

    if (
      cached &&
      cached.gen === textCacheGen
    ) {
      return cached.nodes;
    }

    const nodes = [];

    if (root) {
      const walker =
        document.createTreeWalker(
          root,
          NodeFilter.SHOW_TEXT,
          {
            acceptNode(node) {
              const parent =
                node.parentElement;

              if (!parent) {
                return NodeFilter.FILTER_REJECT;
              }

              if (
                parent.closest(
                  SKIP_TEXT_SELECTOR
                )
              ) {
                return NodeFilter.FILTER_REJECT;
              }

              return NodeFilter.FILTER_ACCEPT;
            }
          }
        );

      let node = walker.nextNode();

      while (node) {
        nodes.push(node);
        node = walker.nextNode();
      }
    }

    textCache.set(root, {
      gen: textCacheGen,
      nodes
    });

    return nodes;
  }

  function rootText(root) {
    return getTextNodes(root)
      .map((node) => node.data)
      .join("");
  }

  function offsetOfPoint(
    root,
    container,
    offset
  ) {
    if (
      !root ||
      !container ||
      !root.contains(container)
    ) {
      return null;
    }

    const probe = document.createRange();

    try {
      probe.setStart(root, 0);
      probe.setEnd(container, offset);
    } catch {
      return null;
    }

    let total = 0;

    for (const node of getTextNodes(root)) {
      if (node === container) {
        return (
          total +
          clamp(
            offset,
            0,
            node.data.length
          )
        );
      }

      let comparison = 1;

      try {
        comparison = probe.comparePoint(
          node,
          node.data.length
        );
      } catch {
        comparison = 1;
      }

      if (comparison <= 0) {
        total += node.data.length;
      } else {
        break;
      }
    }

    return total;
  }

  function rangeToOffsets(root, range) {
    if (
      !root ||
      !range ||
      !root.contains(range.startContainer) ||
      !root.contains(range.endContainer)
    ) {
      return null;
    }

    const start = offsetOfPoint(
      root,
      range.startContainer,
      range.startOffset
    );

    const end = offsetOfPoint(
      root,
      range.endContainer,
      range.endOffset
    );

    if (
      start === null ||
      end === null ||
      end <= start
    ) {
      return null;
    }

    return {
      start,
      end
    };
  }

  function locatePoint(root, target) {
    const nodes = getTextNodes(root);

    let total = 0;
    let last = null;

    for (const node of nodes) {
      last = node;

      const length = node.data.length;

      if (target <= total + length) {
        return {
          node,
          offset: clamp(
            target - total,
            0,
            length
          )
        };
      }

      total += length;
    }

    return last
      ? {
          node: last,
          offset: last.data.length
        }
      : null;
  }

  function rangeFromOffsets(
    root,
    start,
    end
  ) {
    if (
      !root ||
      start < 0 ||
      end <= start
    ) {
      return null;
    }

    const first =
      locatePoint(root, start);

    const last =
      locatePoint(root, end);

    if (!first || !last) return null;

    try {
      const range = document.createRange();

      range.setStart(
        first.node,
        first.offset
      );

      range.setEnd(
        last.node,
        last.offset
      );

      return range;
    } catch {
      return null;
    }
  }

  function rangeRect(range) {
    if (!range) return null;

    const rects = Array.from(
      range.getClientRects()
    ).filter(
      (rect) =>
        rect.width > 0 ||
        rect.height > 0
    );

    const rect = rects.length
      ? rects[rects.length - 1]
      : range.getBoundingClientRect();

    if (!rect) return null;

    return {
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      width: rect.width,
      height: rect.height
    };
  }

  function normalizeWithMap(text) {
    let output = "";
    const map = [];
    let previousSpace = false;

    for (
      let index = 0;
      index < text.length;
      index += 1
    ) {
      const character = text[index];

      if (
        character === " " ||
        character === "\n" ||
        character === "\t" ||
        character === "\r"
      ) {
        if (previousSpace) continue;

        output += " ";
        map.push(index);
        previousSpace = true;
      } else {
        output += character;
        map.push(index);
        previousSpace = false;
      }
    }

    map.push(text.length);

    return {
      out: output,
      map
    };
  }

  function findAll(
    haystack,
    needle,
    cap
  ) {
    const positions = [];

    if (!needle) return positions;

    let index =
      haystack.indexOf(needle);

    while (
      index !== -1 &&
      positions.length < (cap || 200)
    ) {
      positions.push(index);

      index = haystack.indexOf(
        needle,
        index + 1
      );
    }

    return positions;
  }

  function candidatesFor(record, info) {
    const exact = findAll(
      info.text,
      record.exact
    ).map((start) => ({
      start,
      end:
        start + record.exact.length,
      penalty: 0
    }));

    if (exact.length) return exact;

    const target = normalizeWithMap(
      record.exact
    ).out.trim();

    if (target.length < 4) return [];

    const source =
      normalizeWithMap(info.text);

    return findAll(
      source.out,
      target,
      40
    ).map((normalizedStart) => ({
      start:
        source.map[normalizedStart],
      end:
        source.map[
          Math.min(
            normalizedStart +
              target.length,
            source.map.length - 1
          )
        ],
      penalty: 900
    }));
  }

  function resolveRecord(
    record,
    rootInfo
  ) {
    let best = null;

    for (const info of rootInfo) {
      for (
        const candidate of candidatesFor(
          record,
          info
        )
      ) {
        let score = -candidate.penalty;

        if (
          info.hash &&
          info.hash === record.messageHash
        ) {
          score += 10000;
        }

        if (
          info.index ===
          record.messageIndex
        ) {
          score += 800;
        }

        if (
          candidate.start ===
          record.start
        ) {
          score += 500;
        }

        if (record.prefix) {
          const before =
            info.text.slice(
              Math.max(
                0,
                candidate.start -
                  record.prefix.length
              ),
              candidate.start
            );

          if (
            before.endsWith(
              record.prefix
            )
          ) {
            score += 2500;
          }
        }

        if (record.suffix) {
          const after =
            info.text.slice(
              candidate.end,
              candidate.end +
                record.suffix.length
            );

          if (
            after.startsWith(
              record.suffix
            )
          ) {
            score += 2500;
          }
        }

        score -=
          Math.min(
            Math.abs(
              candidate.start -
                record.start
            ),
            10000
          ) / 100;

        if (
          !best ||
          score > best.score
        ) {
          best = {
            root: info.root,
            rootIndex: info.index,
            start: candidate.start,
            end: candidate.end,
            score
          };
        }
      }
    }

    if (!best) return null;

    return {
      record,
      root: best.root,
      start: best.start,
      end: best.end
    };
  }

  /* ------------------------------------------------------------------
   * Rendering marks
   * ---------------------------------------------------------------- */

  let rendered = [];
  let applying = false;
  let observer = null;
  let restoreTimer = 0;
  let pendingJump = null;
  let pendingJumpTries = 0;
  let suppressCardClickUntil = 0;

  function marksById(id) {
    return Array.from(
      document.querySelectorAll(
        MARK_SELECTOR
      )
    ).filter(
      (mark) =>
        mark.dataset.tmhlId === id
    );
  }

  function unwrapMark(mark) {
    const parent = mark.parentNode;

    if (!parent) return;

    try {
      while (mark.firstChild) {
        parent.insertBefore(
          mark.firstChild,
          mark
        );
      }

      parent.removeChild(mark);
    } catch (error) {
      console.warn(
        "[TM Highlighter] Could not remove a mark.",
        error
      );
    }
  }

  function clearMarks(predicate) {
    const marks = Array.from(
      document.querySelectorAll(
        MARK_SELECTOR
      )
    );

    if (!marks.length) return;

    withObserverPaused(() => {
      marks.forEach((mark) => {
        if (
          !predicate ||
          predicate(mark)
        ) {
          unwrapMark(mark);
        }
      });
    });

    bumpTextCache();
  }

  function withObserverPaused(fn) {
    applying = true;

    if (observer) {
      observer.disconnect();
    }

    try {
      fn();
    } finally {
      applying = false;

      if (observer) {
        window.setTimeout(() => {
          observer.takeRecords();

          observer.observe(
            document.body,
            {
              childList: true,
              subtree: true,
              characterData: true
            }
          );
        }, 0);
      }
    }
  }

  function segmentAttr(
    index,
    count
  ) {
    if (count <= 1) return "solo";
    if (index === 0) return "first";
    if (index === count - 1) {
      return "last";
    }

    return "mid";
  }

  function wrapRange(
    root,
    start,
    end,
    record
  ) {
    const nodes = getTextNodes(root);
    const segments = [];

    let total = 0;

    for (const node of nodes) {
      const nodeStart = total;
      const nodeEnd =
        total + node.data.length;

      const localStart = Math.max(
        0,
        start - nodeStart
      );

      const localEnd = Math.min(
        node.data.length,
        end - nodeStart
      );

      if (
        localStart < localEnd &&
        nodeEnd > start &&
        nodeStart < end
      ) {
        if (
          node.parentElement &&
          node.parentElement.closest(
            MARK_SELECTOR
          )
        ) {
          return false;
        }

        segments.push({
          node,
          start: localStart,
          end: localEnd
        });
      }

      total = nodeEnd;
    }

    if (!segments.length) return false;

    withObserverPaused(() => {
      for (
        let index =
          segments.length - 1;
        index >= 0;
        index -= 1
      ) {
        const segment =
          segments[index];

        let target = segment.node;

        if (
          segment.end <
          target.data.length
        ) {
          target.splitText(
            segment.end
          );
        }

        if (segment.start > 0) {
          target = target.splitText(
            segment.start
          );
        }

        const mark =
          document.createElement("mark");

        mark.className = "tmhl-mark";
        mark.dataset.tmhlId = record.id;
        mark.dataset.tmhlChat =
          record.chatId;
        mark.dataset.color =
          record.color;
        mark.dataset.seg =
          segmentAttr(
            index,
            segments.length
          );

        if (record.note) {
          mark.dataset.note = "1";
        }

        mark.title =
          record.note || "";

        target.parentNode.insertBefore(
          mark,
          target
        );

        mark.appendChild(target);
      }
    });

    bumpTextCache();

    return true;
  }

  function restoreHighlights() {
    if (applying) return;

    const chatId = currentChatId();

    bumpTextCache();
    rendered = [];

    if (!chatId) {
      clearMarks();
      return;
    }

    const records =
      itemsForChat(chatId);

    if (!records.length) {
      clearMarks();
      updateLauncher();
      return;
    }

    const roots = getResponseRoots();

    if (!roots.length) return;

    const rootInfo = roots.map(
      (root, index) => {
        const text = rootText(root);

        return {
          root,
          index,
          text,
          hash: hashText(text)
        };
      }
    );

    const locations = records
      .map((record) =>
        resolveRecord(
          record,
          rootInfo
        )
      )
      .filter(Boolean);

    rendered = locations;

    const wanted = new Set(
      locations.map(
        (item) => item.record.id
      )
    );

    clearMarks(
      (mark) =>
        mark.dataset.tmhlChat !==
          chatId ||
        !wanted.has(
          mark.dataset.tmhlId
        )
    );

    for (const location of locations) {
      const existing = marksById(
        location.record.id
      );

      if (existing.length) {
        existing.forEach(
          (mark, index) => {
            mark.dataset.color =
              location.record.color;

            mark.dataset.seg =
              segmentAttr(
                index,
                existing.length
              );

            if (
              location.record.note
            ) {
              mark.dataset.note = "1";
            } else {
              delete mark.dataset.note;
            }

            mark.title =
              location.record.note ||
              "";
          }
        );

        continue;
      }

      wrapRange(
        location.root,
        location.start,
        location.end,
        location.record
      );
    }

    updateLauncher();
    tryPendingJump();
  }

  function scheduleRestore(delay) {
    window.clearTimeout(
      restoreTimer
    );

    restoreTimer = window.setTimeout(
      restoreHighlights,
      delay || 180
    );
  }

  function flashMark(id) {
    const marks = marksById(id);

    if (!marks.length) return false;

    marks.forEach((mark) => {
      mark.classList.remove(
        "tmhl-flash"
      );

      void mark.offsetWidth;

      mark.classList.add(
        "tmhl-flash"
      );

      window.setTimeout(() => {
        mark.classList.remove(
          "tmhl-flash"
        );
      }, 1600);
    });

    marks[0].scrollIntoView({
      behavior: "smooth",
      block: "center"
    });

    return true;
  }

  function tryPendingJump() {
    if (!pendingJump) return;

    if (flashMark(pendingJump)) {
      pendingJump = null;
      pendingJumpTries = 0;
      return;
    }

    pendingJumpTries += 1;

    if (pendingJumpTries > 12) {
      pendingJump = null;
      pendingJumpTries = 0;

      toast(
        "Could not find that highlight in the page."
      );

      return;
    }

    window.setTimeout(
      () => scheduleRestore(60),
      450
    );
  }

  function jumpTo(record) {
    if (
      !record ||
      record.deleted ||
      !record.chatId
    ) {
      return;
    }

    if (
      record.chatId !==
      currentChatId()
    ) {
      pendingJump = record.id;
      pendingJumpTries = 0;

      window.location.hash =
        `#chat=${encodeURIComponent
