/* =====================================================================
 * TypingMind Persistent Highlighter
 * Version 3.4.0
 *
 * UI update:
 *  - Full, wrapping highlight text. No line clamping.
 *  - Reading cards never navigates accidentally.
 *  - Native mobile reading dialog with keyboard-aware sizing.
 *  - Compact mobile toolbar with an on-demand color palette.
 *  - Top-positioned action menus.
 *  - Smaller, edge-docked mobile launcher.
 *  - Labeled card actions and inline delete confirmation.
 *  - Stable note editing during background sync.
 *  - Public GitHub repositories supported with explicit permission.
 *
 * Compatibility:
 *  - Existing localStorage keys and version-3 records are retained.
 *  - Existing highlight anchoring and merge behavior are retained.
 *  - GitHub sync file and sync document format are unchanged.
 *  - Tokens remain local and are never included in exports.
 *
 * Replace the old script, then reload TypingMind.
 * Do not run both versions together.
 * ===================================================================== */

(() => {
  "use strict";

  const VERSION = "3.4.0";
  const FLAG = "__TM_HIGHLIGHTER_V3__";

  const rank = value =>
    String(value || "0")
      .split(".")
      .reduce((total, part) => total * 1000 + (Number(part) || 0), 0);

  const prior = window[FLAG] || window["**TM_HIGHLIGHTER_V3**"];

  if (prior && (prior.loaded || prior.loading)) {
    if (rank(prior.version) < rank(VERSION)) {
      console.warn(
        `[TM Highlighter] v${prior.version} is already running. ` +
        `Replace the old script and reload TypingMind to start v${VERSION}.`
      );
    }
    return;
  }

  window[FLAG] = { loading: true, version: VERSION };

  /* ------------------------------------------------------------------
   * Constants
   * ---------------------------------------------------------------- */

  const LS_DATA = "tm-highlights-v3";
  const LS_SETTINGS = "tm-highlights-v3-settings";
  const LEGACY_KEY = "typingmind-persistent-highlights-v2";
  const CHANNEL_NAME = "tm-highlights-v3-bus";
  const LS_SYNC = "tm-highlights-v3-github";
  const SYNC_FILE = "typingmind-highlights.json";

  const MOBILE_BREAKPOINT = 820;
  const SIDEBAR_BREAKPOINT = 768;

  const COLORS = ["yellow", "green", "blue", "pink", "purple"];

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

  const CHAT_SIGNAL_SELECTORS = [
    '[data-element-id="chat-space-middle-part"]',
    '[data-element-id="chat-space"]',
    '[data-element-id="chat-input-textbox"]',
    '[data-element-id="user-message"]',
    '[data-element-id="ai-response"]',
    'textarea[placeholder*="message" i]'
  ];

  const MOBILE_SIDEBAR_SELECTORS = [
    '[data-element-id="side-bar"]',
    '[data-element-id="sidebar"]',
    '[data-element-id="side-bar-background"]',
    '[data-element-id="sidebar-background"]'
  ];

  const MOBILE_SIDEBAR_SELECTOR = MOBILE_SIDEBAR_SELECTORS.join(", ");
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

  const DEFAULT_SETTINGS = {
    settingsVersion: 5,
    defaultColor: "yellow",
    launcherMode: "full",
    autoHideMobileLauncher: true,
    seenIntro: false,
    launcher: { xPct: 0.93, yPct: 0.6 },
    toolbar: { pinned: false, xPct: 0.5, yPct: 0.35 }
  };

  /* ------------------------------------------------------------------
   * Utilities
   * ---------------------------------------------------------------- */

  const now = () => Date.now();
  const clamp = (value, min, max) =>
    Math.max(min, Math.min(value, max));

  function makeId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return [
      now().toString(36),
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
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  function structuredCopy(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function relativeTime(iso) {
    const stamp = Date.parse(iso);
    if (!Number.isFinite(stamp)) return "";

    const difference = Math.max(0, now() - stamp);
    const minute = 60000;
    const hour = 60 * minute;
    const day = 24 * hour;

    if (difference < minute) return "just now";
    if (difference < hour) return `${Math.floor(difference / minute)}m ago`;
    if (difference < day) return `${Math.floor(difference / hour)}h ago`;
    if (difference < 7 * day) {
      return `${Math.floor(difference / day)}d ago`;
    }

    return new Date(stamp).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric"
    });
  }

  function viewportBounds() {
    const viewport = window.visualViewport;
    const left = viewport ? viewport.offsetLeft : 0;
    const top = viewport ? viewport.offsetTop : 0;
    const width = viewport ? viewport.width : window.innerWidth;
    const height = viewport ? viewport.height : window.innerHeight;

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
    return window.matchMedia("(pointer: coarse)").matches;
  }

  function isNarrow() {
    return viewportBounds().width <= MOBILE_BREAKPOINT;
  }

  function compactToolbar() {
    return isTouch() || isNarrow();
  }

  function isTypingTarget(target) {
    return Boolean(
      target instanceof Element &&
      (
        target.matches("input, textarea, select") ||
        target.isContentEditable
      )
    );
  }

  function safeFocus(node) {
    if (!node || !node.isConnected || typeof node.focus !== "function") {
      return;
    }
    try {
      node.focus({ preventScroll: true });
    } catch {
      node.focus();
    }
  }

  function isOnVisibleChatPage() {
    const hasChat = CHAT_SIGNAL_SELECTORS.some(selector =>
      Boolean(document.querySelector(selector))
    );

    if (!hasChat) return false;

    if (window.innerWidth <= SIDEBAR_BREAKPOINT) {
      for (const selector of MOBILE_SIDEBAR_SELECTORS) {
        const sidebar = document.querySelector(selector);
        if (!sidebar) continue;

        const style = getComputedStyle(sidebar);
        const rect = sidebar.getBoundingClientRect();

        if (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity || 1) !== 0 &&
          rect.width > 100 &&
          rect.right > 0 &&
          rect.left < window.innerWidth
        ) {
          return false;
        }
      }
    }

    return true;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const previousFocus = document.activeElement;
      let area = null;

      try {
        area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("data-tmhl-ui", "true");
        area.setAttribute("aria-label", "Copy text");
        area.style.cssText =
          "position:fixed;left:0;top:0;width:1px;height:1px;" +
          "opacity:0;font-size:16px;";

        const host = panel && panel.open ? panel : document.body;
        host.appendChild(area);
        area.focus();
        area.select();

        return document.execCommand("copy");
      } catch {
        return false;
      } finally {
        if (area) area.remove();
        safeFocus(previousFocus);
      }
    }
  }

  function downloadFile(name, text, mime) {
    const blob = new Blob([text], { type: mime || "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = name;
    link.setAttribute("data-tmhl-ui", "true");

    const host = panel && panel.open ? panel : document.body;
    host.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function el(tag, props, children) {
    const node = document.createElement(tag);

    if (props) {
      Object.entries(props).forEach(([key, value]) => {
        if (value === undefined || value === null) return;

        if (key === "class") {
          node.className = value;
        } else if (key === "text") {
          node.textContent = value;
        } else if (key === "html") {
          // Only fixed, internal SVG strings are passed here.
          node.innerHTML = value;
        } else if (key.startsWith("on") && typeof value === "function") {
          node.addEventListener(key.slice(2).toLowerCase(), value);
        } else {
          node.setAttribute(key, value);
        }
      });
    }

    (children || []).forEach(child => {
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
      if (!raw) return structuredCopy(DEFAULT_SETTINGS);

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
        merged.launcherMode = parsed.showLauncher === false ? "off" : "full";
        delete merged.showLauncher;
      } else if (merged.launcherMode === "mini") {
        merged.launcherMode = "off";
      }

      if (merged.launcherMode !== "off") merged.launcherMode = "full";

      merged.defaultColor = COLORS.includes(merged.defaultColor)
        ? merged.defaultColor
        : "yellow";

      merged.autoHideMobileLauncher =
        parsed.autoHideMobileLauncher !== false;

      const launcherPosition = merged.launcher || {};

      if (
        !Number.isFinite(launcherPosition.xPct) ||
        !Number.isFinite(launcherPosition.yPct)
      ) {
        merged.launcher = {
          xPct: launcherPosition.side === "left" ? 0.07 : 0.93,
          yPct: Number.isFinite(launcherPosition.topPct)
            ? launcherPosition.topPct
            : 0.6
        };
      }

      const toolbarPosition = merged.toolbar || {};
      merged.toolbar = {
        pinned: Boolean(toolbarPosition.pinned),
        xPct: Number.isFinite(toolbarPosition.xPct)
          ? clamp(toolbarPosition.xPct, 0, 1)
          : 0.5,
        yPct: Number.isFinite(toolbarPosition.yPct)
          ? clamp(toolbarPosition.yPct, 0, 1)
          : 0.35
      };

      merged.settingsVersion = 5;
      return merged;
    } catch {
      return structuredCopy(DEFAULT_SETTINGS);
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(LS_SETTINGS, JSON.stringify(settings));
    } catch (error) {
      console.warn("[TM Highlighter] Settings not saved.", error);
    }
  }

  /* ------------------------------------------------------------------
   * Store
   * ---------------------------------------------------------------- */

  let store = loadStore();
  let bus = null;
  let chatHighlightCache = {
    store: null,
    updatedAt: -1,
    chatId: null,
    hasHighlights: false
  };

  function emptyStore() {
    return { version: 3, updatedAt: 0, items: [] };
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
      chatTitle: typeof record.chatTitle === "string" ? record.chatTitle : "",
      color: COLORS.includes(record.color) ? record.color : "yellow",
      exact: record.exact,
      note: typeof record.note === "string" ? record.note : "",
      prefix: typeof record.prefix === "string" ? record.prefix : "",
      suffix: typeof record.suffix === "string" ? record.suffix : "",
      start: record.start,
      end: record.end,
      messageIndex: Number.isFinite(record.messageIndex)
        ? record.messageIndex
        : -1,
      messageHash: record.messageHash || "",
      createdAt: record.createdAt || new Date().toISOString(),
      updatedAt: Number.isFinite(record.updatedAt)
        ? record.updatedAt
        : Date.parse(record.createdAt || "") || now(),
      deleted: Boolean(record.deleted)
    };
  }

  function loadStore() {
    let documentStore = emptyStore();

    try {
      const raw = localStorage.getItem(LS_DATA);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.items)) {
          documentStore = {
            version: 3,
            updatedAt: Number(parsed.updatedAt) || 0,
            items: parsed.items.filter(validRecord).map(normalizeRecord)
          };
        }
      }
    } catch (error) {
      console.warn("[TM Highlighter] Could not read storage.", error);
    }

    if (!documentStore.items.length) {
      const migrated = migrateLegacy();
      if (migrated.length) {
        documentStore.items = migrated;
        documentStore.updatedAt = now();
      }
    }

    return documentStore;
  }

  function migrateLegacy() {
    try {
      const raw = localStorage.getItem(LEGACY_KEY);
      if (!raw) return [];

      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed) ? parsed : parsed && parsed.items;
      if (!Array.isArray(items)) return [];

      const mapped = items.filter(validRecord).map(normalizeRecord);
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
    return store.items.filter(item => !item.deleted);
  }

  function itemsForChat(chatId) {
    if (!chatId) return [];
    return liveItems().filter(item => item.chatId === chatId);
  }

  function currentChatHasHighlights(chatId) {
    if (
      chatHighlightCache.store === store &&
      chatHighlightCache.updatedAt === store.updatedAt &&
      chatHighlightCache.chatId === chatId
    ) {
      return chatHighlightCache.hasHighlights;
    }

    const hasHighlights = Boolean(
      chatId &&
      store.items.some(item => !item.deleted && item.chatId === chatId)
    );

    chatHighlightCache = {
      store,
      updatedAt: store.updatedAt,
      chatId,
      hasHighlights
    };

    return hasHighlights;
  }

  function findRecord(id) {
    return store.items.find(item => item.id === id) || null;
  }

  function persist(options) {
    const preferences = options || {};

    store = mergeDocs(store, loadStore()).doc;
    store.updatedAt = now();
    chatHighlightCache.store = null;

    try {
      localStorage.setItem(LS_DATA, JSON.stringify(store));
    } catch (error) {
      console.error("[TM Highlighter] Save failed.", error);
      toast("Storage is full. Export a JSON backup before clearing old highlights.");
      return false;
    }

    if (bus && !preferences.silentBus) {
      try {
        bus.postMessage({ type: "changed", at: store.updatedAt });
      } catch {
        // Ignore channel errors.
      }
    }

    renderPanel();
    updateLauncher();

    if (!preferences.skipCloud) {
      if (syncConfig && !cloudPaused) {
        syncStatus("Sync pending", "Saved on this device. Waiting to sync.");
      }
      scheduleCloudSync(1800);
    }

    return true;
  }

  function mergeDocs(local, remote) {
    const byId = new Map();
    local.items.forEach(item => byId.set(item.id, item));
    let changed = false;

    (remote.items || []).filter(validRecord).forEach(raw => {
      const incoming = normalizeRecord(raw);
      const current = byId.get(incoming.id);
      const winner = current ? mergeRecord(current, incoming) : incoming;

      if (!current || JSON.stringify(winner) !== JSON.stringify(current)) {
        byId.set(incoming.id, winner);
        changed = true;
      }
    });

    return {
      changed,
      doc: {
        version: 3,
        updatedAt: Math.max(local.updatedAt || 0, remote.updatedAt || 0),
        items: Array.from(byId.values())
      }
    };
  }

  function mergeRecord(first, second) {
    // Deletion wins for an ID. Deletion records are not pruned.
    let winner;

    if (first.deleted !== second.deleted) {
      winner = first.deleted ? first : second;
    } else if (first.updatedAt !== second.updatedAt) {
      winner = first.updatedAt > second.updatedAt ? first : second;
    } else {
      const key = item => JSON.stringify([
        item.color, item.note, item.exact, item.prefix, item.suffix,
        item.start, item.end, item.messageIndex, item.messageHash,
        item.chatTitle
      ]);
      winner = key(first) >= key(second) ? first : second;
    }

    const other = winner === first ? second : first;

    return {
      ...winner,
      chatTitle:
        cleanChatTitle(winner.chatTitle) ||
        cleanChatTitle(other.chatTitle) ||
        winner.chatTitle ||
        ""
    };
  }

  /* ------------------------------------------------------------------
   * Chat context and titles
   * ---------------------------------------------------------------- */

  function currentChatId() {
    const match = location.href.match(/(?:#|[?&])chat=([^&?#]+)/);

    if (match && match[1]) {
      try {
        return decodeURIComponent(match[1]);
      } catch {
        return match[1];
      }
    }

    const selected = document.querySelector(
      '[data-element-id="selected-chat-item"]'
    );

    if (selected) {
      const direct =
        selected.getAttribute("data-chat-id") || selected.dataset.chatId;

      if (direct) return String(direct);

      const link = selected.matches("a")
        ? selected
        : selected.closest("a") || selected.querySelector("a");

      const href = link && link.getAttribute("href");
      const hrefMatch = href && href.match(/#chat=([^&?#]+)/);

      if (hrefMatch && hrefMatch[1]) {
        try {
          return decodeURIComponent(hrefMatch[1]);
        } catch {
          return hrefMatch[1];
        }
      }
    }

    return null;
  }

  const chatTitleCache = new Map();
  let titleRefreshAt = 0;
  let titleRefreshBusy = false;
  let titleRefreshTimer = 0;

  function cleanChatTitle(value) {
    if (typeof value !== "string") return "";

    const title = value
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\s*[|·-]\s*Typing\s?Mind.*$/i, "")
      .slice(0, 120);

    return (
      !title ||
      /^(?:typing\s?mind\b.*|untitled(?: chat)?|new chat)$/i.test(title)
    ) ? "" : title;
  }

  function titleFromChatData(value, chatId) {
    try {
      const chat = typeof value === "string" ? JSON.parse(value) : value;
      if (!chat || typeof chat !== "object" || chat.deletedAt) return "";

      const id = chat.chatID || chat.chatId || chat.id;
      if (id && String(id) !== chatId) return "";

      return cleanChatTitle(chat.chatTitle) || cleanChatTitle(chat.title);
    } catch {
      return "";
    }
  }

  function storedChatTitle(chatId) {
    if (!chatId) return "";
    try {
      return titleFromChatData(localStorage.getItem(`CHAT_${chatId}`), chatId);
    } catch {
      return "";
    }
  }

  function domChatTitle() {
    const selected = document.querySelector(
      '[data-element-id="selected-chat-item"]'
    );

    if (selected) {
      const selectedId = selected.getAttribute("data-chat-id");
      if (!selectedId || selectedId === currentChatId()) {
        const textNode = selected.querySelector(
          '[data-element-id="chat-item-title"], .truncate'
        );
        const title = cleanChatTitle((textNode || selected).textContent);
        if (title) return title;
      }
    }

    return cleanChatTitle(document.title);
  }

  function currentChatTitle() {
    const chatId = currentChatId();
    const saved = store.items.find(
      item => item.chatId === chatId && cleanChatTitle(item.chatTitle)
    );

    return (
      chatTitleCache.get(chatId) ||
      storedChatTitle(chatId) ||
      (saved && cleanChatTitle(saved.chatTitle)) ||
      domChatTitle() ||
      "Untitled chat"
    );
  }

  // Read-only access to TypingMind's CHAT_ records.
  async function readIndexedChatTitles(chatIds) {
    const found = new Map();
    if (!window.indexedDB || !chatIds.length) return found;

    let names = ["keyval-store"];

    if (typeof indexedDB.databases === "function") {
      try {
        names = (await indexedDB.databases())
          .map(db => db.name)
          .filter(name => name && /^(?:keyval-store|typingmind.*)$/i.test(name));
      } catch {
        // Older browsers use the default idb-keyval database.
      }
    }

    for (const name of names) {
      await new Promise(resolve => {
        let db = null;
        let finished = false;

        const finish = () => {
          if (finished) return;
          finished = true;
          clearTimeout(timeout);
          if (db) db.close();
          resolve();
        };

        const timeout = setTimeout(finish, 2500);
        let request;

        try {
          request = indexedDB.open(name);
        } catch {
          finish();
          return;
        }

        request.onupgradeneeded = () => {
          request.transaction.abort();
        };
        request.onerror = finish;
        request.onblocked = finish;

        request.onsuccess = () => {
          db = request.result;

          if (finished) {
            db.close();
            return;
          }

          const stores = Array.from(db.objectStoreNames)
            .filter(value => /^(?:keyval|chats?|store)$/i.test(value));

          if (!stores.length) {
            finish();
            return;
          }

          try {
            const tx = db.transaction(stores, "readonly");
            tx.oncomplete = finish;
            tx.onerror = finish;
            tx.onabort = finish;

            for (const storeName of stores) {
              const objectStore = tx.objectStore(storeName);

              for (const id of chatIds) {
                const get = objectStore.get(`CHAT_${id}`);
                get.onsuccess = () => {
                  const title = titleFromChatData(get.result, id);
                  if (title) found.set(id, title);
                };
              }
            }
          } catch {
            finish();
          }
        };
      });
    }

    return found;
  }

  async function refreshChatTitles(force) {
    if (titleRefreshBusy || (!force && now() - titleRefreshAt < 5000)) {
      return;
    }

    titleRefreshBusy = true;
    titleRefreshAt = now();

    try {
      const chatId = currentChatId();
      const ids = Array.from(new Set(
        [chatId, ...liveItems().map(item => item.chatId)].filter(Boolean)
      ));

      const titles = await readIndexedChatTitles(ids);

      for (const id of ids) {
        const title = titles.get(id) || storedChatTitle(id);
        if (title) chatTitleCache.set(id, title);
      }

      let changed = false;

      for (const record of store.items) {
        const title = chatTitleCache.get(record.chatId);
        if (title && !cleanChatTitle(record.chatTitle)) {
          record.chatTitle = title;
          changed = true;
        }
      }

      if (changed) persist();
    } finally {
      titleRefreshBusy = false;
    }
  }

  function scheduleTitleRefresh(force) {
    clearTimeout(titleRefreshTimer);
    titleRefreshTimer = setTimeout(() => {
      refreshChatTitles(Boolean(force)).catch(() => {});
    }, 350);
  }

  /* ------------------------------------------------------------------
   * Optional GitHub sync
   *
   * Public sync requires allowPublic === true.
   * Upgrading an existing configuration never silently enables it.
   *
   * The sync file is plaintext JSON, not encrypted.
   * Deletion records retain their original text for compatibility.
   * ---------------------------------------------------------------- */

  let syncConfig = loadSyncConfig();
  let cloudTimer = 0;
  let cloudPromise = null;
  let cloudAgain = false;
  let cloudGeneration = 0;
  let cloudController = null;
  let cloudPaused = false;
  let cloudRetryAt = 0;
  let cloudFailures = 0;
  let cloudLabel = syncConfig ? "Sync pending" : "";
  let cloudDetail = syncConfig ? "Waiting to sync." : "Sync is off.";

  function normalizeRepo(value) {
    return String(value || "")
      .trim()
      .replace(/^https:\/\/github\.com\//i, "")
      .replace(/\/+$/, "")
      .replace(/\.git$/i, "");
  }

  function loadSyncConfig() {
    try {
      const value = JSON.parse(localStorage.getItem(LS_SYNC) || "null");

      if (
        !value ||
        !/^[\w.-]+\/[\w.-]+$/.test(value.repo) ||
        typeof value.token !== "string" ||
        !value.token.trim()
      ) {
        return null;
      }

      return {
        repo: value.repo,
        token: value.token.trim(),
        allowPublic: value.allowPublic === true
      };
    } catch {
      return null;
    }
  }

  function syncStatus(label, detail) {
    cloudLabel = label;
    cloudDetail = detail || label;
    renderStatus();

    if (settingsNode) {
      const node = settingsNode.querySelector("[data-tmhl-sync-status]");
      if (node) node.textContent = cloudDetail;
    }
  }

  function scheduleCloudSync(delay) {
    if (!syncConfig || cloudPaused) return;

    if (cloudPromise) {
      cloudAgain = true;
      return;
    }

    clearTimeout(cloudTimer);
    cloudTimer = setTimeout(
      () => syncCloud(false),
      Math.max(delay || 0, cloudRetryAt - now())
    );
  }

  function cloudError(message, status) {
    const error = new Error(message);
    error.status = status || 0;
    return error;
  }

  async function githubRequest(config, path, options) {
    const controller = new AbortController();
    cloudController = controller;
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
      const response = await fetch(`https://api.github.com${path}`, {
        method: (options && options.method) || "GET",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${config.token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          ...(options && options.body
            ? { "Content-Type": "application/json" }
            : {})
        },
        ...(options && options.body
          ? { body: JSON.stringify(options.body) }
          : {}),
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: controller.signal
      });

      if (!response.ok) {
        const code = response.status;
        let message = `GitHub returned ${code}.`;

        if (code === 401) {
          message = "GitHub token is invalid or expired. Replace it in Settings.";
        }
        if (code === 403) {
          message =
            "GitHub refused access. Check Contents: Read and write permission " +
            "and repository rules.";
        }
        if (code === 404) {
          message =
            "Repository or file not found. Check the repository name and token access.";
        }
        if (code === 409 || code === 422) {
          message =
            "Sync conflict or branch rule. Retrying with the latest file.";
        }

        const error = cloudError(message, code);
        const retryHeader = response.headers.get("Retry-After");

        if (
          code === 429 ||
          (
            code === 403 &&
            (
              response.headers.get("X-RateLimit-Remaining") === "0" ||
              retryHeader
            )
          )
        ) {
          const seconds = Number(retryHeader);
          const retryAt = retryHeader
            ? (
              Number.isFinite(seconds)
                ? now() + seconds * 1000
                : Date.parse(retryHeader)
            )
            : 0;

          const reset = Number(
            response.headers.get("X-RateLimit-Reset")
          ) * 1000;

          error.retryAt = Math.max(
            now() + 60000,
            Number.isFinite(retryAt) ? retryAt : 0,
            Number.isFinite(reset) ? reset : 0
          );

          error.message =
            "GitHub rate limit reached. Sync will retry automatically.";
        }

        throw error;
      }

      return await response.json();
    } finally {
      clearTimeout(timeout);
      if (cloudController === controller) cloudController = null;
    }
  }

  function base64Encode(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = "";

    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }

    return btoa(binary);
  }

  function base64Decode(value) {
    const binary = atob(value.replace(/\s/g, ""));
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(binary, character => character.charCodeAt(0))
    );
  }

  function cloudDocument(doc) {
    return {
      application: "typingmind-highlighter",
      syncVersion: 1,
      version: 3,
      updatedAt: doc.updatedAt,
      items: doc.items
        .map(normalizeRecord)
        .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    };
  }

  function sameCloudItems(first, second) {
    return JSON.stringify(cloudDocument(first).items) ===
      JSON.stringify(cloudDocument(second).items);
  }

  function parseCloudDocument(text) {
    let value;

    try {
      value = JSON.parse(text);
    } catch {
      throw cloudError(
        "The sync file is not valid JSON. It was left untouched.",
        400
      );
    }

    if (
      !value ||
      value.application !== "typingmind-highlighter" ||
      value.syncVersion !== 1 ||
      value.version !== 3 ||
      !Array.isArray(value.items) ||
      !value.items.every(validRecord) ||
      new Set(value.items.map(item => item.id)).size !== value.items.length
    ) {
      throw cloudError(
        "The sync file has an unsupported format. It was left untouched.",
        400
      );
    }

    return {
      version: 3,
      updatedAt: Number(value.updatedAt) || 0,
      items: value.items.map(normalizeRecord)
    };
  }

  async function runCloudSync(config, generation) {
    const check = () => {
      if (generation !== cloudGeneration || !syncConfig) {
        throw cloudError("Sync stopped.", 499);
      }
    };

    check();

    const base =
      `/repos/${config.repo.split("/").map(encodeURIComponent).join("/")}`;

    const repo = await githubRequest(config, base);
    check();

    if (repo.private !== true && config.allowPublic !== true) {
      throw cloudError(
        "This repository is public. Nothing was uploaded. In Settings, " +
        "enable Allow public repository sync, then choose Save and sync.",
        400
      );
    }

    if (repo.archived) {
      throw cloudError(
        "This repository is archived. Choose an active repository.",
        400
      );
    }

    const branch = repo.default_branch;
    if (!branch) {
      throw cloudError(
        "Initialize the repository with a README first.",
        400
      );
    }

    const path = `${base}/contents/${SYNC_FILE}`;
    const readPath = `${path}?ref=${encodeURIComponent(branch)}`;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      let remote = emptyStore();
      let sha = "";

      try {
        const file = await githubRequest(config, readPath);
        check();

        if (file.type !== "file" || !file.sha) {
          throw cloudError("The sync path is not a regular file.", 400);
        }

        sha = file.sha;
        let content = file;

        if (file.encoding !== "base64") {
          content = await githubRequest(
            config,
            `${base}/git/blobs/${encodeURIComponent(sha)}`
          );
          check();
        }

        if (
          content.encoding !== "base64" ||
          typeof content.content !== "string"
        ) {
          throw cloudError(
            "GitHub did not return the complete sync file. It was left untouched.",
            400
          );
        }

        remote = parseCloudDocument(base64Decode(content.content));
      } catch (error) {
        if (error.status !== 404 || sha) throw error;

        try {
          await githubRequest(
            config,
            `${base}/branches/${encodeURIComponent(branch)}`
          );
        } catch (branchError) {
          if ([404, 409].includes(branchError.status)) {
            throw cloudError(
              "Add a README to initialize the repository's default branch first.",
              400
            );
          }
          throw branchError;
        }

        check();
      }

      check();
      store = mergeDocs(store, loadStore()).doc;

      const merged = mergeDocs(store, remote);

      if (merged.changed) {
        store = merged.doc;

        if (!persist({ skipCloud: true })) {
          throw cloudError(
            "Local storage is full. Sync paused; export a backup.",
            400
          );
        }

        scheduleRestore(60);
        scheduleTitleRefresh(true);
      }

      const snapshot = structuredCopy(store);

      if (sha && sameCloudItems(snapshot, remote)) return;

      const body = {
        message: "Sync TypingMind highlights",
        branch,
        content: base64Encode(JSON.stringify(cloudDocument(snapshot))),
        ...(sha ? { sha } : {})
      };

      check();

      try {
        await githubRequest(config, path, { method: "PUT", body });
        check();

        if (!sameCloudItems(store, snapshot)) cloudAgain = true;
        return;
      } catch (error) {
        if (
          (error.status === 409 || error.status === 422) &&
          attempt < 3
        ) {
          continue;
        }
        throw error;
      }
    }
  }

  function syncCloud(manual) {
    if (!syncConfig) return Promise.resolve(false);

    if (cloudPromise) {
      cloudAgain = true;
      return cloudPromise;
    }

    if (navigator.onLine === false) {
      syncStatus(
        "Offline",
        "Saved on this device. Sync resumes when you are online."
      );
      if (manual) toast("You're offline. Your highlights are saved on this device.");
      return Promise.resolve(false);
    }

    if (
      (!manual && (document.hidden || cloudPaused)) ||
      cloudRetryAt > now()
    ) {
      if (manual && cloudRetryAt > now()) {
        toast("Sync is waiting before retrying. Check the status in Settings.");
      }
      return Promise.resolve(false);
    }

    clearTimeout(cloudTimer);
    cloudPaused = false;

    const config = { ...syncConfig };
    const generation = cloudGeneration;

    syncStatus("Syncing...", "Syncing highlights with GitHub...");

    cloudPromise = (async () => {
      try {
        const run = () => runCloudSync(config, generation);

        if (navigator.locks && typeof navigator.locks.request === "function") {
          await navigator.locks.request(
            `tmhl-github:${config.repo.toLowerCase()}`,
            run
          );
        } else {
          await run();
        }

        if (generation !== cloudGeneration) return false;

        cloudFailures = 0;
        cloudRetryAt = 0;

        syncStatus(
          "Synced",
          `Synced at ${new Date().toLocaleTimeString()}. ` +
          "Changes sync while TypingMind is open."
        );

        if (manual) toast("Highlights synced.");
        return true;
      } catch (error) {
        if (generation !== cloudGeneration) return false;

        cloudFailures += 1;
        cloudPaused =
          [400, 401, 403, 404].includes(error.status) && !error.retryAt;

        cloudRetryAt = error.retryAt || (
          now() + Math.min(
            300000,
            10000 * 2 ** Math.min(cloudFailures - 1, 5)
          )
        );

        const detail = error.name === "AbortError"
          ? "Sync timed out. Your local highlights are saved; retrying automatically."
          : error.status
            ? error.message
            : "Could not reach GitHub. Your local highlights are saved; retrying automatically.";

        syncStatus("Sync issue", detail);
        if (manual) toast(detail);

        return false;
      } finally {
        cloudPromise = null;

        if (
          generation === cloudGeneration &&
          syncConfig &&
          !cloudPaused
        ) {
          const again = cloudAgain;
          cloudAgain = false;
          scheduleCloudSync(again ? 1800 : 60000);
        } else if (syncConfig && generation !== cloudGeneration) {
          scheduleCloudSync(0);
        }
      }
    })();

    return cloudPromise;
  }

  function connectCloud(repoInput, tokenInput, allowPublic) {
    const repo = normalizeRepo(repoInput);
    const token = String(tokenInput || "").trim();

    if (
      !/^[\w.-]+\/[\w.-]+$/.test(repo) ||
      repo.split("/").some(part => part === "." || part === "..") ||
      !token ||
      /\s/.test(token)
    ) {
      toast("Enter owner/repository and a valid GitHub token.");
      return false;
    }

    const next = {
      repo,
      token,
      allowPublic: allowPublic === true
    };

    try {
      localStorage.setItem(LS_SYNC, JSON.stringify(next));
    } catch {
      toast("Could not save sync settings on this device.");
      return false;
    }

    cloudGeneration += 1;
    if (cloudController) cloudController.abort();

    syncConfig = next;
    cloudPaused = false;
    cloudRetryAt = 0;
    cloudFailures = 0;
    cloudAgain = false;

    renderSettings();
    syncCloud(true);
    return true;
  }

  function disconnectCloud() {
    try {
      localStorage.removeItem(LS_SYNC);
    } catch {
      toast("Could not remove sync settings. Try again.");
      return;
    }

    cloudGeneration += 1;
    if (cloudController) cloudController.abort();

    clearTimeout(cloudTimer);
    syncConfig = null;
    cloudPaused = false;
    cloudAgain = false;
    cloudRetryAt = 0;

    syncStatus("", "Sync is off. Your highlights remain saved.");
    renderSettings();
  }

  function appendSyncSettings() {
    const field = el("section", { class: "tmhl-field" });

    field.appendChild(el("h3", {
      class: "tmhl-section-title",
      text: "Sync across devices"
    }));

    field.appendChild(el("label", {
      class: "tmhl-label",
      for: "tmhl-sync-repo",
      text: "GitHub repository"
    }));

    const repo = el("input", {
      id: "tmhl-sync-repo",
      class: "tmhl-search",
      type: "text",
      placeholder: "owner/repository",
      autocomplete: "off",
      autocapitalize: "none",
      spellcheck: "false"
    });
    repo.value = syncConfig ? syncConfig.repo : "";

    field.appendChild(repo);

    field.appendChild(el("label", {
      class: "tmhl-label tmhl-label-spaced",
      for: "tmhl-sync-token",
      text: "Personal access token"
    }));

    const token = el("input", {
      id: "tmhl-sync-token",
      class: "tmhl-search",
      type: "password",
      placeholder: syncConfig
        ? "Saved. Leave blank to keep this token."
        : "GitHub personal access token",
      autocomplete: "new-password",
      autocapitalize: "none",
      spellcheck: "false"
    });

    // Never put a saved token back into the DOM.
    field.appendChild(token);

    field.appendChild(el("p", {
      class: "tmhl-help",
      text:
        "Use a repository with a README. Give a fine-grained token access " +
        "to this repository with Contents: Read and write. Public repositories " +
        "also need a token to upload changes."
    }));

    const publicLabel = el("label", { class: "tmhl-check-row" });
    const publicCheck = el("input", {
      type: "checkbox",
      "aria-describedby": "tmhl-public-warning"
    });
    publicCheck.checked = Boolean(syncConfig && syncConfig.allowPublic);

    publicLabel.append(
      publicCheck,
      el("span", { text: "Allow public repository sync" })
    );
    field.appendChild(publicLabel);

    field.appendChild(el("p", {
      id: "tmhl-public-warning",
      class: "tmhl-help tmhl-warning",
      text:
        "Public means anyone can read the highlights, notes, chat titles, " +
        "chat IDs and surrounding text. The file is not encrypted. Deleted " +
        "text is retained in deletion records and may remain in Git history."
    }));

    repo.addEventListener("input", () => {
      const savedRepo = syncConfig ? syncConfig.repo.toLowerCase() : "";
      if (normalizeRepo(repo.value).toLowerCase() !== savedRepo) {
        publicCheck.checked = false;
      }
    });

    field.appendChild(el("p", {
      class: "tmhl-help",
      text: "Choose Save and sync below to apply repository, token or privacy changes."
    }));

    const row = el("div", { class: "tmhl-button-row" });

    row.appendChild(uiButton(
      ICON.sync,
      syncConfig ? "Save and sync" : "Connect and sync",
      () => {
        const sameRepo = Boolean(
          syncConfig &&
          normalizeRepo(repo.value).toLowerCase() ===
            syncConfig.repo.toLowerCase()
        );

        const savedToken = sameRepo ? syncConfig.token : "";

        if (connectCloud(
          repo.value,
          token.value || savedToken,
          publicCheck.checked
        )) {
          token.value = "";
        }
      },
      "tmhl-btn tmhl-primary-btn"
    ));

    if (syncConfig) {
      row.append(
        uiButton(
          ICON.sync,
          "Sync now",
          () => syncCloud(true),
          "tmhl-btn"
        ),
        uiButton(
          ICON.close,
          "Disconnect",
          disconnectCloud,
          "tmhl-btn"
        )
      );
    }

    field.appendChild(row);

    field.appendChild(el("p", {
      class: "tmhl-help tmhl-sync-detail",
      "data-tmhl-sync-status": "true",
      role: "status",
      text: cloudDetail
    }));

    const details = el("details", { class: "tmhl-details" });
    details.appendChild(el("summary", {
      text: "Privacy and device setup"
    }));

    details.appendChild(el("p", {
      class: "tmhl-help",
      text:
        "A repository hosting this JavaScript does not have to be the repository " +
        "used for highlight data. Keeping the data repository private is safer."
    }));

    details.appendChild(el("p", {
      class: "tmhl-help",
      text:
        "The token is stored in this browser. Scripts running on this TypingMind " +
        "page can read it. Never paste a token into publicly hosted JavaScript. " +
        "Tokens are not included in highlighter backups."
    }));

    details.appendChild(el("p", {
      class: "tmhl-help",
      text:
        "Use the same data repository on each device. Highlights, notes and " +
        "deletions sync while the app is open. Conversations must also exist on " +
        "the other device with matching chat IDs. Use TypingMind's own sync " +
        "for the conversations."
    }));

    field.appendChild(details);
    settingsNode.appendChild(field);
  }

  function startCloudSync() {
    window.addEventListener("online", () => scheduleCloudSync(300));

    window.addEventListener("focus", () => {
      scheduleCloudSync(300);
      scheduleTitleRefresh(true);
    });

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        scheduleCloudSync(300);
        scheduleTitleRefresh(true);
      }
    });

    scheduleCloudSync(1200);
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
      document.querySelector(".dynamic-chat-content-container") || document;

    for (const selector of ROOT_SELECTORS) {
      const found = Array.from(container.querySelectorAll(selector))
        .filter(node =>
          node.isConnected &&
          !(node.parentElement && node.parentElement.closest(selector))
        );

      if (found.length) return found;
    }

    return [];
  }

  function rootFromNode(node) {
    if (!node) return null;

    const element = node.nodeType === Node.ELEMENT_NODE
      ? node
      : node.parentElement;

    if (!element) return null;

    for (const selector of ROOT_SELECTORS) {
      const found = element.closest(selector);
      if (found) return found;
    }

    return null;
  }

  function getTextNodes(root) {
    if (!root) return [];

    const cached = textCache.get(root);
    if (cached && cached.gen === textCacheGen) return cached.nodes;

    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;

        if (!parent || parent.closest(SKIP_TEXT_SELECTOR)) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let node = walker.nextNode();
    while (node) {
      nodes.push(node);
      node = walker.nextNode();
    }

    textCache.set(root, { gen: textCacheGen, nodes });
    return nodes;
  }

  function rootText(root) {
    return getTextNodes(root).map(node => node.data).join("");
  }

  function offsetOfPoint(root, container, offset) {
    if (!root || !container || !root.contains(container)) return null;

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
        return total + clamp(offset, 0, node.data.length);
      }

      let comparison = 1;
      try {
        comparison = probe.comparePoint(node, node.data.length);
      } catch {
        comparison = 1;
      }

      if (comparison <= 0) total += node.data.length;
      else break;
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

    const start = offsetOfPoint(root, range.startContainer, range.startOffset);
    const end = offsetOfPoint(root, range.endContainer, range.endOffset);

    if (start === null || end === null || end <= start) return null;
    return { start, end };
  }

  function locatePoint(root, target) {
    let total = 0;
    let last = null;

    for (const node of getTextNodes(root)) {
      last = node;
      const length = node.data.length;

      if (target <= total + length) {
        return { node, offset: clamp(target - total, 0, length) };
      }

      total += length;
    }

    return last ? { node: last, offset: last.data.length } : null;
  }

  function rangeFromOffsets(root, start, end) {
    if (!root || start < 0 || end <= start) return null;

    const first = locatePoint(root, start);
    const last = locatePoint(root, end);
    if (!first || !last) return null;

    try {
      const range = document.createRange();
      range.setStart(first.node, first.offset);
      range.setEnd(last.node, last.offset);
      return range;
    } catch {
      return null;
    }
  }

  function rangeRect(range) {
    if (!range) return null;

    const rects = Array.from(range.getClientRects())
      .filter(rect => rect.width > 0 || rect.height > 0);

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

    for (let index = 0; index < text.length; index += 1) {
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
    return { out: output, map };
  }

  function findAll(haystack, needle, cap) {
    const positions = [];
    if (!needle) return positions;

    let index = haystack.indexOf(needle);

    while (index !== -1 && positions.length < (cap || 200)) {
      positions.push(index);
      index = haystack.indexOf(needle, index + 1);
    }

    return positions;
  }

  function candidatesFor(record, info) {
    const exact = findAll(info.text, record.exact).map(start => ({
      start,
      end: start + record.exact.length,
      penalty: 0
    }));

    if (exact.length) return exact;

    const target = normalizeWithMap(record.exact).out.trim();
    if (target.length < 4) return [];

    const source = normalizeWithMap(info.text);

    return findAll(source.out, target, 40).map(normalizedStart => ({
      start: source.map[normalizedStart],
      end: source.map[
        Math.min(normalizedStart + target.length, source.map.length - 1)
      ],
      penalty: 900
    }));
  }

  function resolveRecord(record, rootInfo) {
    let best = null;

    for (const info of rootInfo) {
      for (const candidate of candidatesFor(record, info)) {
        let score = -candidate.penalty;

        if (info.hash && info.hash === record.messageHash) score += 10000;
        if (info.index === record.messageIndex) score += 800;
        if (candidate.start === record.start) score += 500;

        if (record.prefix) {
          const before = info.text.slice(
            Math.max(0, candidate.start - record.prefix.length),
            candidate.start
          );
          if (before.endsWith(record.prefix)) score += 2500;
        }

        if (record.suffix) {
          const after = info.text.slice(
            candidate.end,
            candidate.end + record.suffix.length
          );
          if (after.startsWith(record.suffix)) score += 2500;
        }

        score -= Math.min(
          Math.abs(candidate.start - record.start),
          10000
        ) / 100;

        if (!best || score > best.score) {
          best = {
            root: info.root,
            start: candidate.start,
            end: candidate.end,
            score
          };
        }
      }
    }

    return best
      ? { record, root: best.root, start: best.start, end: best.end }
      : null;
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

  const OBSERVER_OPTIONS = {
    childList: true,
    subtree: true,
    characterData: true
  };

  function marksById(id) {
    return Array.from(document.querySelectorAll(MARK_SELECTOR))
      .filter(mark => mark.dataset.tmhlId === id);
  }

  function unwrapMark(mark) {
    const parent = mark.parentNode;
    if (!parent) return;

    try {
      while (mark.firstChild) {
        parent.insertBefore(mark.firstChild, mark);
      }
      parent.removeChild(mark);
    } catch (error) {
      console.warn("[TM Highlighter] Could not remove a mark.", error);
    }
  }

  function withObserverPaused(fn) {
    const nested = applying;
    applying = true;

    if (observer && !nested) observer.disconnect();

    try {
      return fn();
    } finally {
      applying = nested;
      if (observer && !nested && document.body) {
        observer.observe(document.body, OBSERVER_OPTIONS);
      }
    }
  }

  function clearMarks(predicate) {
    const marks = Array.from(document.querySelectorAll(MARK_SELECTOR));
    if (!marks.length) return;

    withObserverPaused(() => {
      marks.forEach(mark => {
        if (!predicate || predicate(mark)) unwrapMark(mark);
      });
    });

    bumpTextCache();
  }

  function segmentAttr(index, count) {
    if (count <= 1) return "solo";
    if (index === 0) return "first";
    if (index === count - 1) return "last";
    return "mid";
  }

  function wrapRange(root, start, end, record) {
    const segments = [];
    let total = 0;

    for (const node of getTextNodes(root)) {
      const nodeStart = total;
      const nodeEnd = total + node.data.length;
      const localStart = Math.max(0, start - nodeStart);
      const localEnd = Math.min(node.data.length, end - nodeStart);

      if (
        localStart < localEnd &&
        nodeEnd > start &&
        nodeStart < end
      ) {
        if (
          node.parentElement &&
          node.parentElement.closest(MARK_SELECTOR)
        ) {
          return false;
        }

        segments.push({ node, start: localStart, end: localEnd });
      }

      total = nodeEnd;
    }

    if (!segments.length) return false;

    withObserverPaused(() => {
      for (let index = segments.length - 1; index >= 0; index -= 1) {
        const segment = segments[index];
        let target = segment.node;

        if (segment.end < target.data.length) target.splitText(segment.end);
        if (segment.start > 0) target = target.splitText(segment.start);

        const mark = document.createElement("mark");
        mark.className = "tmhl-mark";
        mark.dataset.tmhlId = record.id;
        mark.dataset.tmhlChat = record.chatId;
        mark.dataset.color = record.color;
        mark.dataset.seg = segmentAttr(index, segments.length);

        if (record.note) mark.dataset.note = "1";
        mark.title = record.note || "";

        target.parentNode.insertBefore(mark, target);
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

    const records = itemsForChat(chatId);

    if (!records.length) {
      clearMarks();
      updateLauncher();
      return;
    }

    const roots = getResponseRoots();
    if (!roots.length) return;

    const rootInfo = roots.map((root, index) => {
      const text = rootText(root);
      return { root, index, text, hash: hashText(text) };
    });

    const locations = records
      .map(record => resolveRecord(record, rootInfo))
      .filter(Boolean);

    rendered = locations;

    const wanted = new Set(locations.map(item => item.record.id));

    clearMarks(mark =>
      mark.dataset.tmhlChat !== chatId ||
      !wanted.has(mark.dataset.tmhlId)
    );

    for (const location of locations) {
      const existing = marksById(location.record.id);

      if (existing.length) {
        existing.forEach((mark, index) => {
          mark.dataset.color = location.record.color;
          mark.dataset.seg = segmentAttr(index, existing.length);

          if (location.record.note) mark.dataset.note = "1";
          else delete mark.dataset.note;

          mark.title = location.record.note || "";
        });
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
    clearTimeout(restoreTimer);
    restoreTimer = setTimeout(restoreHighlights, delay || 180);
  }

  function flashMark(id) {
    const marks = marksById(id);
    if (!marks.length) return false;

    marks.forEach(mark => {
      mark.classList.remove("tmhl-flash");
      void mark.offsetWidth;
      mark.classList.add("tmhl-flash");
      setTimeout(() => mark.classList.remove("tmhl-flash"), 1600);
    });

    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

    marks[0].scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
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
      toast("Could not find that highlight in the page.");
      return;
    }

    setTimeout(() => scheduleRestore(60), 450);
  }

  function jumpTo(record) {
    if (!record || record.deleted || !record.chatId) return;

    if (!finishNoteEdit(true)) return;

    // Close and unlock the mobile dialog before scrolling the conversation.
    if (isNarrow() && view.open && !closePanel()) return;

    if (record.chatId !== currentChatId()) {
      pendingJump = record.id;
      pendingJumpTries = 0;
      location.hash = `#chat=${encodeURIComponent(record.chatId)}`;
      scheduleRestore(500);
      return;
    }

    if (!flashMark(record.id)) {
      pendingJump = record.id;
      pendingJumpTries = 0;
      scheduleRestore(60);
    }

    if (view.open) renderList();
  }

  /* ------------------------------------------------------------------
   * Message observer
   * ---------------------------------------------------------------- */

  function ownUiNode(node) {
    const element = node && (
      node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
    );
    return Boolean(element && element.closest("[data-tmhl-ui]"));
  }

  function mutationBelongsToHighlighter(mutation) {
    if (ownUiNode(mutation.target)) return true;

    if (mutation.type === "childList") {
      const changed = [...mutation.addedNodes, ...mutation.removedNodes];
      return changed.length > 0 && changed.every(ownUiNode);
    }

    return false;
  }

  function startObserver() {
    observer = new MutationObserver(records => {
      if (applying) return;
      if (!records.some(record => !mutationBelongsToHighlighter(record))) {
        return;
      }

      bumpTextCache();
      scheduleTitleRefresh(false);

      if (currentChatHasHighlights(currentChatId())) {
        scheduleRestore(260);
      }
    });

    observer.observe(document.body, OBSERVER_OPTIONS);
  }

  /* ------------------------------------------------------------------
   * Theme
   * ---------------------------------------------------------------- */

  function applyTheme() {
    const root = document.documentElement;
    const body = document.body;

    const explicit =
      root.getAttribute("data-theme") ||
      body.getAttribute("data-theme") ||
      "";

    const dark =
      explicit === "dark" ||
      root.classList.contains("dark") ||
      body.classList.contains("dark") ||
      (
        explicit !== "light" &&
        !root.classList.contains("light") &&
        !body.classList.contains("light") &&
        matchMedia("(prefers-color-scheme: dark)").matches
      );

    root.setAttribute("data-tmhl-theme", dark ? "dark" : "light");
  }

  /* ------------------------------------------------------------------
   * Styles
   * ---------------------------------------------------------------- */

  function injectStyles() {
    document.getElementById("tmhl-styles")?.remove();

    const style = document.createElement("style");
    style.id = "tmhl-styles";
    style.textContent = `
:root {
  --tmhl-swatch-yellow: #eab308;
  --tmhl-swatch-green: #22c55e;
  --tmhl-swatch-blue: #3b82f6;
  --tmhl-swatch-pink: #ec4899;
  --tmhl-swatch-purple: #a855f7;
}

:root[data-tmhl-theme="light"] {
  --tmhl-yellow: rgba(250,204,21,.40);
  --tmhl-yellow-2: rgba(202,138,4,.55);
  --tmhl-green: rgba(34,197,94,.30);
  --tmhl-green-2: rgba(21,128,61,.50);
  --tmhl-blue: rgba(59,130,246,.28);
  --tmhl-blue-2: rgba(29,78,216,.48);
  --tmhl-pink: rgba(236,72,153,.26);
  --tmhl-pink-2: rgba(190,24,93,.48);
  --tmhl-purple: rgba(168,85,247,.26);
  --tmhl-purple-2: rgba(126,34,206,.48);
  --tmhl-surface: rgba(255,255,255,.97);
  --tmhl-surface-solid: #ffffff;
  --tmhl-raised: #f8f8fa;
  --tmhl-raised-2: #eeeef1;
  --tmhl-border: rgba(24,24,27,.14);
  --tmhl-border-soft: rgba(24,24,27,.08);
  --tmhl-text: #18181b;
  --tmhl-muted: #62626d;
  --tmhl-danger: #b42332;
  --tmhl-danger-bg: #fff0f1;
  --tmhl-warning: #865500;
  --tmhl-shadow: 0 18px 48px rgba(24,24,27,.16), 0 2px 8px rgba(24,24,27,.07);
  --tmhl-float-shadow: 0 8px 24px rgba(24,24,27,.14), 0 1px 4px rgba(24,24,27,.08);
}

:root[data-tmhl-theme="dark"] {
  --tmhl-yellow: rgba(250,204,21,.26);
  --tmhl-yellow-2: rgba(250,204,21,.48);
  --tmhl-green: rgba(74,222,128,.22);
  --tmhl-green-2: rgba(74,222,128,.42);
  --tmhl-blue: rgba(96,165,250,.26);
  --tmhl-blue-2: rgba(96,165,250,.46);
  --tmhl-pink: rgba(244,114,182,.24);
  --tmhl-pink-2: rgba(244,114,182,.44);
  --tmhl-purple: rgba(192,132,252,.24);
  --tmhl-purple-2: rgba(192,132,252,.44);
  --tmhl-surface: rgba(28,28,32,.97);
  --tmhl-surface-solid: #18181b;
  --tmhl-raised: #222226;
  --tmhl-raised-2: #303036;
  --tmhl-border: rgba(255,255,255,.15);
  --tmhl-border-soft: rgba(255,255,255,.09);
  --tmhl-text: #f4f4f5;
  --tmhl-muted: #a6a6b0;
  --tmhl-danger: #ff929b;
  --tmhl-danger-bg: #3d242b;
  --tmhl-warning: #e5bb6d;
  --tmhl-shadow: 0 20px 52px rgba(0,0,0,.48), 0 2px 8px rgba(0,0,0,.25);
  --tmhl-float-shadow: 0 10px 28px rgba(0,0,0,.38), 0 2px 6px rgba(0,0,0,.22);
}

/* Existing highlighted-text treatment */
mark.tmhl-mark {
  --c: var(--tmhl-yellow);
  --c2: var(--tmhl-yellow-2);
  background-color: var(--c) !important;
  color: inherit !important;
  padding: 0 !important;
  margin: 0 !important;
  border-radius: .18em;
  box-shadow: 0 0 0 .1em var(--c);
  line-height: inherit !important;
  cursor: pointer;
  transition: background-color .14s ease, box-shadow .14s ease;
  -webkit-box-decoration-break: slice;
  box-decoration-break: slice;
}
mark.tmhl-mark[data-color="green"] { --c: var(--tmhl-green); --c2: var(--tmhl-green-2); }
mark.tmhl-mark[data-color="blue"] { --c: var(--tmhl-blue); --c2: var(--tmhl-blue-2); }
mark.tmhl-mark[data-color="pink"] { --c: var(--tmhl-pink); --c2: var(--tmhl-pink-2); }
mark.tmhl-mark[data-color="purple"] { --c: var(--tmhl-purple); --c2: var(--tmhl-purple-2); }
mark.tmhl-mark[data-seg="first"] { border-radius: .18em 0 0 .18em; }
mark.tmhl-mark[data-seg="mid"] { border-radius: 0; }
mark.tmhl-mark[data-seg="last"] { border-radius: 0 .18em .18em 0; }
mark.tmhl-mark[data-note="1"] { box-shadow: 0 0 0 .1em var(--c); }
mark.tmhl-mark.tmhl-flash { animation: tmhl-flash 1.5s ease; }

@media (hover: hover) {
  mark.tmhl-mark:hover { background-color: var(--c2) !important; }
}

@keyframes tmhl-flash {
  0%,100% { box-shadow: 0 0 0 .1em var(--c); }
  15%,55% { box-shadow: 0 0 0 .22em var(--c2); }
}
@keyframes tmhl-enter {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* Shared UI */
#tmhl-toolbar,
#tmhl-toolbar-menu,
#tmhl-color-popover,
#tmhl-panel,
#tmhl-launcher,
#tmhl-toast {
  box-sizing: border-box;
  color: var(--tmhl-text);
  font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  font-size: 13px;
  line-height: 1.4;
  -webkit-text-size-adjust: 100%;
}

#tmhl-panel *,
#tmhl-toolbar *,
#tmhl-toolbar-menu *,
#tmhl-color-popover *,
#tmhl-launcher * {
  box-sizing: border-box;
}

#tmhl-panel button,
#tmhl-panel input,
#tmhl-panel textarea,
#tmhl-panel select,
#tmhl-toolbar button,
#tmhl-toolbar-menu button,
#tmhl-color-popover button {
  font-family: inherit;
}

#tmhl-panel:not([open]),
#tmhl-panel [hidden],
#tmhl-toolbar[hidden],
#tmhl-toolbar-menu[hidden],
#tmhl-color-popover[hidden],
#tmhl-launcher[hidden],
#tmhl-toast[hidden] {
  display: none !important;
}

.tmhl-tool,
.tmhl-btn,
.tmhl-act,
.tmhl-toolbar-more,
.tmhl-toolbar-grip,
.tmhl-toolbar-primary,
.tmhl-toolbar-quick,
.tmhl-swatch,
.tmhl-scope-button {
  -webkit-appearance: none;
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  margin: 0;
  color: var(--tmhl-text);
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}

.tmhl-tool svg,
.tmhl-btn svg,
.tmhl-act svg,
.tmhl-toolbar-more svg,
.tmhl-toolbar-quick svg,
#tmhl-launcher svg {
  display: block;
  width: 18px;
  height: 18px;
  flex: 0 0 18px;
  pointer-events: none;
}

#tmhl-panel :is(button,input,textarea,select,summary):focus-visible,
#tmhl-toolbar button:focus-visible,
#tmhl-toolbar-menu button:focus-visible,
#tmhl-color-popover button:focus-visible,
#tmhl-launcher:focus-visible {
  outline: 2px solid var(--tmhl-text);
  outline-offset: 2px;
}

.tmhl-button-label { pointer-events: none; }
.tmhl-sr-only {
  position: absolute !important;
  width: 1px !important;
  height: 1px !important;
  padding: 0 !important;
  margin: -1px !important;
  overflow: hidden !important;
  clip: rect(0,0,0,0) !important;
  white-space: nowrap !important;
  border: 0 !important;
}

/* Desktop toolbar: actions at the top, grip at the bottom */
#tmhl-toolbar {
  position: fixed;
  z-index: 2147483645;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  width: 40px;
  gap: 2px;
  padding: 4px;
  border: 1px solid var(--tmhl-border);
  border-radius: 12px;
  background: var(--tmhl-surface);
  box-shadow: var(--tmhl-float-shadow);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  user-select: none;
  -webkit-user-select: none;
  animation: tmhl-enter .12s ease;
}

.tmhl-toolbar-more,
.tmhl-toolbar-grip,
.tmhl-toolbar-quick {
  flex: 0 0 auto;
  width: 30px;
  height: 30px;
  min-width: 0;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--tmhl-muted);
}

.tmhl-toolbar-grip {
  height: 21px;
  cursor: grab;
  touch-action: none;
}
.tmhl-toolbar-grip svg { width: 12px; height: 15px; pointer-events: none; }
.tmhl-toolbar-grip:active { cursor: grabbing; }

.tmhl-color-rail {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.tmhl-swatch {
  position: relative;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  padding: 0;
  border: 0;
  border-radius: 9px;
  background: transparent;
}
.tmhl-swatch::before {
  content: "";
  width: 21px;
  height: 13px;
  border-radius: 4px 2px 4px 2px;
  transform: rotate(-8deg);
  background: var(--sw);
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.12);
}
.tmhl-swatch[aria-pressed="true"]::before {
  box-shadow:
    inset 0 0 0 1px rgba(0,0,0,.12),
    0 0 0 2px var(--tmhl-surface-solid),
    0 0 0 3px var(--tmhl-text);
}
.tmhl-color-rail .tmhl-swatch { width: 30px; height: 28px; }
.tmhl-color-rail .tmhl-swatch::before { width: 18px; height: 10px; }

/* Phone toolbar: one small row, extra colors only when requested */
#tmhl-toolbar[data-compact="true"] {
  width: max-content;
  flex-direction: row;
  gap: 2px;
  padding: 3px;
  border-radius: 14px;
}
#tmhl-toolbar[data-compact="true"] .tmhl-toolbar-grip {
  width: 24px;
  height: 44px;
}
#tmhl-toolbar[data-compact="true"] .tmhl-toolbar-more,
#tmhl-toolbar[data-compact="true"] .tmhl-toolbar-quick {
  width: 44px;
  height: 44px;
}
.tmhl-toolbar-primary {
  height: 44px;
  padding: 0 9px;
  border: 0;
  border-radius: 9px;
  background: var(--tmhl-raised);
  font-size: 12px;
  font-weight: 650;
  white-space: nowrap;
}
.tmhl-color-sample {
  width: 15px;
  height: 11px;
  display: block;
  border-radius: 3px 2px 3px 2px;
  background: var(--sw);
  transform: rotate(-8deg);
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.12);
}
#tmhl-toolbar.tmhl-dragging {
  animation: none;
  cursor: grabbing;
}

/* Separate fixed popovers avoid transformed-ancestor positioning bugs */
#tmhl-toolbar-menu,
#tmhl-color-popover {
  position: fixed;
  z-index: 2147483646;
  padding: 6px;
  border: 1px solid var(--tmhl-border);
  border-radius: 14px;
  background: var(--tmhl-surface);
  box-shadow: var(--tmhl-shadow);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  overflow: auto;
  overscroll-behavior: contain;
  animation: tmhl-enter .12s ease;
}

#tmhl-toolbar-menu {
  width: 226px;
  display: grid;
  gap: 2px;
}
#tmhl-color-popover {
  width: max-content;
  display: flex;
  flex-wrap: wrap;
  gap: 0;
}
#tmhl-color-popover .tmhl-swatch { width: 44px; height: 44px; }

.tmhl-tool {
  min-width: 36px;
  min-height: 36px;
  padding: 8px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  font-size: 12px;
  font-weight: 550;
}
.tmhl-menu .tmhl-tool,
#tmhl-toolbar-menu .tmhl-tool {
  width: 100%;
  min-height: 40px;
  justify-content: flex-start;
  padding: 9px 10px;
  text-align: left;
}
.tmhl-menu .tmhl-tool svg,
#tmhl-toolbar-menu .tmhl-tool svg {
  color: var(--tmhl-muted);
}

/* Minimal launcher, with a larger invisible touch target on phones */
#tmhl-launcher {
  position: fixed;
  z-index: 2147483640;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 34px;
  min-width: 48px;
  padding: 0 9px;
  border: 1px solid var(--tmhl-border);
  border-radius: 11px;
  background: var(--tmhl-surface);
  box-shadow: var(--tmhl-float-shadow);
  color: var(--tmhl-text);
  opacity: .66;
  font-size: 11px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  touch-action: none;
  cursor: grab;
  -webkit-tap-highlight-color: transparent;
  transition: opacity .16s ease;
}
#tmhl-launcher svg { width: 17px; height: 17px; flex-basis: 17px; }
#tmhl-launcher.tmhl-dragging { opacity: 1; cursor: grabbing; transition: none; }
#tmhl-launcher.tmhl-ui-hidden {
  opacity: 0 !important;
  visibility: hidden !important;
  pointer-events: none !important;
}
#tmhl-launcher.tmhl-bump { opacity: 1; }

/* Native reading dialog */
#tmhl-panel {
  position: fixed;
  inset: auto;
  margin: 0;
  padding: 0;
  width: 420px;
  max-width: none;
  max-height: none;
  border: 0;
  border-left: 1px solid var(--tmhl-border);
  border-radius: 0;
  background: var(--tmhl-surface-solid);
  box-shadow: var(--tmhl-shadow);
  z-index: 2147483644;
  overflow: hidden;
  overscroll-behavior: contain;
}
#tmhl-panel[open] {
  display: flex;
  flex-direction: column;
  animation: tmhl-enter .15s ease;
}
#tmhl-panel::backdrop {
  background: rgba(0,0,0,.38);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}
#tmhl-panel.tmhl-mobile {
  border-left: 0;
  border-top: 1px solid var(--tmhl-border);
  border-radius: 20px 20px 0 0;
}
html.tmhl-modal-lock,
html.tmhl-modal-lock body {
  overflow: hidden !important;
  overscroll-behavior: none !important;
}

.tmhl-sheet-handle {
  display: none;
  flex: 0 0 23px;
  align-self: center;
  align-items: center;
  justify-content: center;
  width: 84px;
  height: 23px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: grab;
  touch-action: none;
}
.tmhl-sheet-handle::before {
  content: "";
  display: block;
  width: 34px;
  height: 4px;
  border-radius: 99px;
  background: var(--tmhl-border);
}
#tmhl-panel.tmhl-mobile .tmhl-sheet-handle { display: flex; }

.tmhl-head {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 4px;
  padding: 13px 12px 11px 16px;
  border-bottom: 1px solid var(--tmhl-border-soft);
}
#tmhl-panel.tmhl-mobile .tmhl-head { padding-top: 0; }
.tmhl-heading { flex: 1 1 auto; min-width: 0; }
.tmhl-heading-line { display: flex; align-items: center; gap: 7px; }
.tmhl-title {
  margin: 0;
  padding: 0;
  font-size: 16px;
  font-weight: 680;
  line-height: 1.4;
  letter-spacing: -.025em;
}
.tmhl-count {
  display: inline-block;
  border-radius: 6px;
  padding: 1px 6px;
  background: var(--tmhl-raised-2);
  color: var(--tmhl-muted);
  font-size: 10px;
  line-height: 1.6;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.tmhl-status {
  display: block;
  margin-top: 2px;
  color: var(--tmhl-muted);
  font-size: 10.5px;
  line-height: 1.4;
}

.tmhl-controls {
  display: grid;
  flex: 0 0 auto;
  gap: 9px;
  padding: 12px 14px 13px;
  border-bottom: 1px solid var(--tmhl-border-soft);
}
.tmhl-search {
  display: block;
  width: 100%;
  height: 38px;
  padding: 0 11px;
  margin: 0;
  border: 1px solid var(--tmhl-border);
  border-radius: 10px;
  outline: none;
  background: var(--tmhl-raised);
  color: var(--tmhl-text);
  font-size: 13px;
}
.tmhl-search::placeholder { color: var(--tmhl-muted); opacity: 1; }
.tmhl-search:focus { border-color: var(--tmhl-muted); }

.tmhl-filter-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.tmhl-scope {
  display: flex;
  gap: 2px;
  padding: 3px;
  flex: 1 1 auto;
  border-radius: 10px;
  background: var(--tmhl-raised);
}
.tmhl-scope-button {
  flex: 1 1 auto;
  min-height: 31px;
  padding: 0 9px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--tmhl-muted);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}
.tmhl-scope-button[aria-pressed="true"] {
  background: var(--tmhl-surface-solid);
  color: var(--tmhl-text);
  box-shadow: 0 1px 4px rgba(0,0,0,.09);
}
.tmhl-select {
  flex: 0 1 auto;
  min-height: 37px;
  max-width: 100%;
  padding: 0 7px;
  border: 1px solid var(--tmhl-border);
  border-radius: 10px;
  background: var(--tmhl-surface-solid);
  color: var(--tmhl-text);
  font-size: 12px;
  cursor: pointer;
}

.tmhl-list,
.tmhl-settings {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: thin;
  touch-action: pan-y pinch-zoom;
}

.tmhl-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 13px 12px max(20px, env(safe-area-inset-bottom, 0px));
}

/* Full-length, non-navigating reading cards */
.tmhl-card {
  position: relative;
  flex: 0 0 auto;
  min-width: 0;
  width: 100%;
  padding: 13px 13px 7px 15px;
  border: 1px solid var(--tmhl-border-soft);
  border-radius: 13px;
  background: var(--tmhl-raised);
  cursor: default;
}
.tmhl-card::before {
  content: "";
  position: absolute;
  top: 14px;
  bottom: 14px;
  left: 0;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--rail);
}
.tmhl-chat {
  display: block;
  margin: 0 0 3px;
  color: var(--tmhl-muted);
  font-size: 11.5px;
  line-height: 1.5;
  font-weight: 600;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.tmhl-meta {
  margin-bottom: 10px;
  color: var(--tmhl-muted);
  font-size: 10.5px;
  line-height: 1.4;
}
.tmhl-quote {
  display: block;
  min-width: 0;
  width: 100%;
  max-height: none;
  height: auto;
  margin: 0;
  padding: 0;
  overflow: visible;
  color: var(--tmhl-text);
  font-size: 14px;
  font-weight: 400;
  line-height: 1.65;
  letter-spacing: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  -webkit-line-clamp: unset;
  -webkit-box-orient: initial;
  user-select: text;
  -webkit-user-select: text;
}
.tmhl-note {
  margin-top: 11px;
  padding: 9px 10px;
  border-left: 2px solid var(--rail);
  border-radius: 0 8px 8px 0;
  background: var(--tmhl-raised-2);
  color: var(--tmhl-text);
  font-size: 12.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  user-select: text;
  -webkit-user-select: text;
}
.tmhl-note-heading {
  display: block;
  margin-bottom: 3px;
  font-size: 10px;
  font-weight: 650;
  color: var(--tmhl-muted);
}
.tmhl-actions {
  display: grid;
  grid-template-columns: repeat(4, minmax(0,1fr));
  gap: 3px;
  margin-top: 12px;
  padding-top: 5px;
  border-top: 1px solid var(--tmhl-border-soft);
}
.tmhl-act {
  min-width: 0;
  min-height: 47px;
  flex-direction: column;
  gap: 3px;
  padding: 5px 1px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--tmhl-muted);
  font-size: 10.5px;
  font-weight: 550;
  line-height: 1.2;
}
.tmhl-act svg { width: 17px; height: 17px; flex-basis: 17px; }
.tmhl-act .tmhl-button-label { white-space: nowrap; }

.tmhl-editor { margin-top: 12px; }
.tmhl-noteedit {
  display: block;
  width: 100%;
  min-height: 100px;
  max-height: 260px;
  resize: vertical;
  padding: 10px 11px;
  border: 1px solid var(--tmhl-border);
  border-radius: 10px;
  background: var(--tmhl-surface-solid);
  color: var(--tmhl-text);
  font-size: 13px;
  line-height: 1.55;
  outline: none;
}

.tmhl-empty {
  margin: 28px 12px;
  text-align: center;
  color: var(--tmhl-muted);
  font-size: 13px;
  line-height: 1.65;
}
.tmhl-empty b {
  display: block;
  margin-bottom: 6px;
  color: var(--tmhl-text);
  font-size: 15px;
  font-weight: 600;
}

/* Top panel menu */
.tmhl-menu {
  position: absolute;
  right: 12px;
  top: 60px;
  z-index: 8;
  display: grid;
  gap: 2px;
  width: 232px;
  max-width: calc(100% - 24px);
  padding: 6px;
  border: 1px solid var(--tmhl-border);
  border-radius: 13px;
  background: var(--tmhl-surface-solid);
  box-shadow: var(--tmhl-shadow);
  overflow: auto;
  overscroll-behavior: contain;
}
.tmhl-menu-divider {
  height: 1px;
  margin: 4px 5px;
  background: var(--tmhl-border-soft);
}

/* Settings and ordinary buttons */
.tmhl-settings {
  padding: 16px 16px max(20px, env(safe-area-inset-bottom, 0px));
}
.tmhl-field {
  margin: 0 0 21px;
  padding: 0 0 18px;
  border-bottom: 1px solid var(--tmhl-border-soft);
}
.tmhl-section-title {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.5;
  font-weight: 650;
}
.tmhl-label {
  display: block;
  margin: 0 0 6px;
  color: var(--tmhl-text);
  font-size: 12px;
  line-height: 1.5;
  font-weight: 600;
}
.tmhl-label-spaced { margin-top: 12px; }
.tmhl-help {
  margin: 7px 0 0;
  color: var(--tmhl-muted);
  font-size: 11.5px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.tmhl-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.tmhl-row .tmhl-label { margin: 0; }
.tmhl-button-row,
.tmhl-filters {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 10px;
}
.tmhl-btn {
  min-height: 34px;
  padding: 7px 10px;
  border: 1px solid var(--tmhl-border);
  border-radius: 9px;
  background: transparent;
  font-size: 12px;
  font-weight: 600;
}
.tmhl-btn svg { width: 15px; height: 15px; flex-basis: 15px; }
.tmhl-primary-btn {
  background: var(--tmhl-text);
  color: var(--tmhl-surface-solid);
  border-color: transparent;
}
.tmhl-switch {
  position: relative;
  width: 48px;
  height: 40px;
  flex: 0 0 48px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  touch-action: manipulation;
}
.tmhl-switch::before {
  content: "";
  position: absolute;
  top: 8px;
  left: 2px;
  width: 44px;
  height: 24px;
  border-radius: 99px;
  background: var(--tmhl-raised-2);
  transition: background .15s ease;
}
.tmhl-switch::after {
  content: "";
  position: absolute;
  top: 11px;
  left: 5px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--tmhl-muted);
  transition: transform .15s ease;
}
.tmhl-switch[aria-checked="true"]::before { background: var(--tmhl-green-2); }
.tmhl-switch[aria-checked="true"]::after {
  transform: translateX(20px);
  background: var(--tmhl-text);
}
.tmhl-check-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  margin-top: 10px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.tmhl-check-row input {
  width: 19px;
  height: 19px;
  flex: 0 0 19px;
  margin: 0;
  accent-color: var(--tmhl-text);
}
.tmhl-warning { color: var(--tmhl-warning); }
.tmhl-sync-detail {
  padding: 10px;
  border-radius: 9px;
  background: var(--tmhl-raised);
}
.tmhl-details { margin-top: 12px; }
.tmhl-details summary {
  color: var(--tmhl-muted);
  font-size: 11.5px;
  cursor: pointer;
  padding: 5px 0;
}
.tmhl-danger { color: var(--tmhl-danger); }
.tmhl-armed {
  color: var(--tmhl-danger) !important;
  background: var(--tmhl-danger-bg) !important;
}
.tmhl-tool:disabled,
.tmhl-btn:disabled { opacity: .4; cursor: default; }

/* Toast stays in the active dialog's top layer when needed */
#tmhl-toast {
  position: fixed;
  z-index: 2147483647;
  transform: translate(-50%, -100%);
  width: max-content;
  padding: 10px 14px;
  border: 1px solid var(--tmhl-border);
  border-radius: 11px;
  background: var(--tmhl-surface);
  box-shadow: var(--tmhl-float-shadow);
  font-size: 12px;
  line-height: 1.5;
  text-align: center;
  overflow-wrap: anywhere;
  pointer-events: none;
  animation: tmhl-enter .12s ease;
}

@media (hover: hover) {
  .tmhl-tool:not(:disabled):hover,
  .tmhl-act:hover,
  .tmhl-toolbar-more:hover,
  .tmhl-toolbar-quick:hover,
  .tmhl-toolbar-grip:hover,
  .tmhl-toolbar-primary:hover,
  .tmhl-btn:not(.tmhl-primary-btn):not(:disabled):hover {
    background: var(--tmhl-raised-2);
    color: var(--tmhl-text);
  }
  .tmhl-primary-btn:hover { opacity: .86; }
  #tmhl-launcher:hover { opacity: 1; }
  .tmhl-swatch:hover::before { filter: brightness(1.1); }
  .tmhl-danger:hover { color: var(--tmhl-danger); }
}

@media (pointer: coarse) {
  .tmhl-head .tmhl-tool { min-width: 44px; min-height: 44px; }
  .tmhl-menu .tmhl-tool,
  #tmhl-toolbar-menu .tmhl-tool { min-height: 44px; font-size: 13px; }
  .tmhl-btn { min-height: 42px; }
  .tmhl-swatch { width: 44px; height: 44px; }
  .tmhl-scope-button { min-height: 37px; }
  .tmhl-select { min-height: 43px; }
  .tmhl-act { min-height: 50px; font-size: 11px; }
}

#tmhl-panel.tmhl-mobile .tmhl-search,
#tmhl-panel.tmhl-mobile .tmhl-noteedit {
  font-size: 16px;
}
#tmhl-panel.tmhl-mobile .tmhl-search { height: 42px; }
#tmhl-panel.tmhl-mobile .tmhl-quote { font-size: 15px; }
#tmhl-panel.tmhl-mobile .tmhl-note { font-size: 13px; }

@media (max-width: 820px) {
  #tmhl-launcher {
    width: 44px;
    min-width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    opacity: .76;
    isolation: isolate;
  }
  #tmhl-launcher::before {
    content: "";
    position: absolute;
    inset: 5px;
    z-index: -1;
    border: 1px solid var(--tmhl-border);
    border-radius: 11px;
    background: var(--tmhl-surface);
    box-shadow: var(--tmhl-float-shadow);
  }
  #tmhl-launcher svg { width: 18px; height: 18px; flex-basis: 18px; }
  #tmhl-launcher .tmhl-label-count {
    position: absolute;
    top: 1px;
    right: 0;
    min-width: 15px;
    padding: 1px 3px;
    border: 1px solid var(--tmhl-border-soft);
    border-radius: 6px;
    background: var(--tmhl-surface-solid);
    color: var(--tmhl-muted);
    font-size: 9px;
    line-height: 1.25;
  }
  #tmhl-launcher[data-empty="true"] .tmhl-label-count { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  #tmhl-panel,
  #tmhl-toolbar,
  #tmhl-toolbar-menu,
  #tmhl-color-popover,
  #tmhl-launcher,
  #tmhl-toast,
  .tmhl-switch::before,
  .tmhl-switch::after,
  mark.tmhl-mark {
    animation: none !important;
    transition: none !important;
  }
}
`;

    document.head.appendChild(style);
  }

  /* ------------------------------------------------------------------
   * Icons and buttons
   * ---------------------------------------------------------------- */

  function svg(content) {
    return (
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true" focusable="false">' + content + "</svg>"
    );
  }

  const ICON = {
    note: svg(
      '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>' +
      '<path d="m16 3 5 5M10 14l-1 4 4-1 9-9a2.1 2.1 0 0 0-5-5z"/>'
    ),
    copy: svg(
      '<rect x="9" y="9" width="12" height="12" rx="2"/>' +
      '<path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>'
    ),
    trash: svg(
      '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>'
    ),
    close: svg('<path d="m6 6 12 12M18 6 6 18"/>'),
    list: svg(
      '<path d="M8 5h13M8 12h13M8 19h13"/>' +
      '<path d="M3 5h.01M3 12h.01M3 19h.01"/>'
    ),
    book: svg(
      '<path d="M5 3h12a2 2 0 0 1 2 2v16H6a3 3 0 0 1-3-3V5a2 2 0 0 1 2-2Z"/>' +
      '<path d="M3 17h16M8 7h7M8 11h5"/>'
    ),
    gear: svg(
      '<path d="m9.5 3-.6 2a7 7 0 0 0-1.5.9l-2-.5-2.5 4.2 1.5 1.5a8 8 0 0 0 0 1.8L3 14.4l2.4 4.2 2-.5a7 7 0 0 0 1.5.9l.6 2h5l.6-2a7 7 0 0 0 1.5-.9l2 .5 2.4-4.2-1.5-1.5a8 8 0 0 0 0-1.8L21 9.6l-2.4-4.2-2 .5a7 7 0 0 0-1.5-.9l-.6-2z"/>' +
      '<circle cx="12" cy="12" r="3"/>'
    ),
    jump: svg(
      '<path d="M14 3h7v7M21 3 10 14"/>' +
      '<path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>'
    ),
    grip: svg(
      '<circle cx="9" cy="5" r=".8"/><circle cx="15" cy="5" r=".8"/>' +
      '<circle cx="9" cy="12" r=".8"/><circle cx="15" cy="12" r=".8"/>' +
      '<circle cx="9" cy="19" r=".8"/><circle cx="15" cy="19" r=".8"/>'
    ),
    more: svg(
      '<circle cx="5" cy="12" r="1" fill="currentColor"/>' +
      '<circle cx="12" cy="12" r="1" fill="currentColor"/>' +
      '<circle cx="19" cy="12" r="1" fill="currentColor"/>'
    ),
    target: svg(
      '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/>' +
      '<path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'
    ),
    palette: svg(
      '<path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1.5-3.3 1.3 1.3 0 0 1 1-2.2H17A4 4 0 0 0 21 11c0-4.4-4-8-9-8Z"/>' +
      '<circle cx="7.5" cy="10" r=".8"/><circle cx="10" cy="6.5" r=".8"/>' +
      '<circle cx="14.5" cy="7" r=".8"/><circle cx="17" cy="10.5" r=".8"/>'
    ),
    back: svg('<path d="m14 6-6 6 6 6"/>'),
    download: svg(
      '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>'
    ),
    upload: svg(
      '<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>'
    ),
    file: svg(
      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h6"/>'
    ),
    sync: svg(
      '<path d="M20 7a8 8 0 0 0-13-3L3 8m0-5v5h5M4 17a8 8 0 0 0 13 3l4-4m-5 0h5v5"/>'
    ),
    check: svg('<path d="m5 12 4 4L19 6"/>')
  };

  function bindPress(node, action) {
    // Preserve the captured page selection without acting on pointerdown.
    // Actions run once, on click/release, preventing tap-through behavior.
    node.addEventListener("pointerdown", event => {
      if (event.button !== undefined && event.button !== 0) return;

      if (node.closest(
        "#tmhl-toolbar, #tmhl-toolbar-menu, #tmhl-color-popover"
      )) {
        event.preventDefault();
        event.stopPropagation();
      }
    });

    node.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      action(event);
    });
  }

  function uiButton(icon, label, action, className, iconOnly) {
    const button = el("button", {
      type: "button",
      class: className || "tmhl-tool",
      title: label,
      "aria-label": label
    });

    if (icon) button.appendChild(el("span", { html: icon }));

    if (!iconOnly) {
      button.appendChild(el("span", {
        class: "tmhl-button-label",
        text: label
      }));
    }

    bindPress(button, action);
    return button;
  }

  function toolButton(icon, label, action, extraClass) {
    return uiButton(
      icon,
      label,
      action,
      `tmhl-tool ${extraClass || ""}`.trim()
    );
  }

  function swatchButton(color, active, action) {
    const button = el("button", {
      type: "button",
      class: "tmhl-swatch",
      "aria-label": `${COLOR_LABEL[color]} highlight`,
      "aria-pressed": active ? "true" : "false",
      title: COLOR_LABEL[color],
      style: `--sw: var(--tmhl-swatch-${color})`
    });

    bindPress(button, () => action(color));
    return button;
  }

  function confirmDeleteAction(id) {
    let armed = false;
    let timer = 0;
    let button = null;
    let originalLabel = "";
    let originalAria = "";

    const reset = () => {
      clearTimeout(timer);
      armed = false;

      if (!button) return;

      button.classList.remove("tmhl-armed");
      const label = button.querySelector(".tmhl-button-label");
      if (label) label.textContent = originalLabel;
      button.setAttribute("aria-label", originalAria);
      button.title = originalAria;
    };

    return event => {
      if (armed) {
        reset();
        if (!finishNoteEdit(true)) return;
        deleteHighlight(id);
        return;
      }

      button = event.currentTarget;
      const label = button.querySelector(".tmhl-button-label");
      originalLabel = label ? label.textContent : "Delete";
      originalAria = button.getAttribute("aria-label") || "Delete highlight";

      armed = true;
      button.classList.add("tmhl-armed");
      if (label) label.textContent = "Delete?";
      button.setAttribute("aria-label", "Confirm delete highlight");
      button.title = "Tap again to delete this highlight and its note";

      button.addEventListener("blur", reset, { once: true });
      timer = setTimeout(reset, 4500);
    };
  }

  /* ------------------------------------------------------------------
   * Toast
   * ---------------------------------------------------------------- */

  let toastNode = null;
  let toastTimer = 0;

  function layoutToast() {
    if (!toastNode || toastNode.hidden) return;

    const bounds = viewportBounds();
    toastNode.style.left = `${bounds.left + bounds.width / 2}px`;
    toastNode.style.top = `${bounds.bottom - (view.open ? 18 : isNarrow() ? 76 : 26)}px`;
    toastNode.style.maxWidth = `${Math.max(80, Math.min(440, bounds.width - 28))}px`;
  }

  function toast(message) {
    if (!toastNode) return;

    clearTimeout(toastTimer);

    const host = panel && panel.open ? panel : document.body;
    if (toastNode.parentNode !== host) host.appendChild(toastNode);

    toastNode.textContent = message;
    toastNode.hidden = false;
    layoutToast();

    toastTimer = setTimeout(() => {
      toastNode.hidden = true;
    }, Math.min(6000, Math.max(2200, message.length * 35)));
  }

  /* ------------------------------------------------------------------
   * Floating toolbar
   * ---------------------------------------------------------------- */

  let toolbar = null;
  let captured = null;
  let activeId = null;
  let toolbarMenu = null;
  let toolbarPalette = null;
  let toolbarMoreButton = null;
  let toolbarPaletteButton = null;
  let toolbarAnchorRect = null;
  let toolbarDragging = false;
  let suppressCaptureUntil = 0;

  function isToolbarUI(target) {
    return Boolean(
      target &&
      (
        (toolbar && toolbar.contains(target)) ||
        (toolbarMenu && toolbarMenu.contains(target)) ||
        (toolbarPalette && toolbarPalette.contains(target))
      )
    );
  }

  function closeToolbarMenu(returnFocus) {
    if (toolbarMenu) toolbarMenu.hidden = true;
    if (toolbarMoreButton) {
      toolbarMoreButton.setAttribute("aria-expanded", "false");
      if (returnFocus) safeFocus(toolbarMoreButton);
    }
  }

  function closeToolbarPalette(returnFocus) {
    if (toolbarPalette) toolbarPalette.hidden = true;
    if (toolbarPaletteButton) {
      toolbarPaletteButton.setAttribute("aria-expanded", "false");
      if (returnFocus) safeFocus(toolbarPaletteButton);
    }
  }

  function closeToolbarPopovers() {
    closeToolbarMenu();
    closeToolbarPalette();
  }

  function positionPopover(node, anchor, beside) {
    if (!node || node.hidden || !anchor) return;

    const bounds = viewportBounds();
    const margin = 8;
    const gap = 8;
    const rect = anchor.getBoundingClientRect();

    node.style.maxWidth = `${Math.max(80, bounds.width - margin * 2)}px`;
    node.style.maxHeight = `${Math.max(44, bounds.height - margin * 2)}px`;

    const width = node.offsetWidth;
    const height = node.offsetHeight;

    let left;
    let top;

    if (beside) {
      left = rect.right + gap;
      if (left + width > bounds.right - margin) {
        left = rect.left - width - gap;
      }
      top = rect.top;
    } else {
      left = rect.right - width;
      top = rect.bottom + gap;

      if (top + height > bounds.bottom - margin) {
        top = rect.top - height - gap;
      }
    }

    left = clamp(
      left,
      bounds.left + margin,
      Math.max(bounds.left + margin, bounds.right - width - margin)
    );

    top = clamp(
      top,
      bounds.top + margin,
      Math.max(bounds.top + margin, bounds.bottom - height - margin)
    );

    node.style.left = `${Math.round(left)}px`;
    node.style.top = `${Math.round(top)}px`;
  }

  function positionToolbarPopovers() {
    positionPopover(
      toolbarMenu,
      toolbarMoreButton,
      !compactToolbar()
    );
    positionPopover(toolbarPalette, toolbar, false);
  }

  function toggleToolbarMenu(event) {
    if (!toolbarMenu || !toolbarMoreButton) return;

    const opening = toolbarMenu.hidden;
    closeToolbarPopovers();

    if (!opening) return;

    toolbarMenu.hidden = false;
    toolbarMoreButton.setAttribute("aria-expanded", "true");
    positionToolbarPopovers();

    if (event && event.detail === 0) {
      safeFocus(toolbarMenu.querySelector("button"));
    }
  }

  function toggleToolbarPalette(event) {
    if (!toolbarPalette) return;

    const opening = toolbarPalette.hidden;
    closeToolbarPopovers();

    if (!opening) return;

    toolbarPalette.hidden = false;
    if (toolbarPaletteButton) {
      toolbarPaletteButton.setAttribute("aria-expanded", "true");
    }

    positionToolbarPopovers();

    if (event && event.detail === 0) {
      safeFocus(
        toolbarPalette.querySelector('[aria-pressed="true"]') ||
        toolbarPalette.querySelector("button")
      );
    }
  }

  function setToolbarCoordinates(left, top) {
    if (!toolbar || toolbar.hidden) return;

    const bounds = viewportBounds();
    const width = toolbar.offsetWidth;
    const height = toolbar.offsetHeight;
    const margin = 8;

    toolbar.style.left = `${Math.round(clamp(
      left,
      bounds.left + margin,
      Math.max(bounds.left + margin, bounds.right - width - margin)
    ))}px`;

    toolbar.style.top = `${Math.round(clamp(
      top,
      bounds.top + margin,
      Math.max(bounds.top + margin, bounds.bottom - height - margin)
    ))}px`;

    toolbar.style.visibility = "visible";
    positionToolbarPopovers();
  }

  function saveToolbarPosition() {
    if (!toolbar || toolbar.hidden) return;

    const bounds = viewportBounds();
    const rect = toolbar.getBoundingClientRect();

    settings.toolbar = {
      pinned: true,
      xPct: clamp(
        (rect.left + rect.width / 2 - bounds.left) / bounds.width,
        0, 1
      ),
      yPct: clamp(
        (rect.top + rect.height / 2 - bounds.top) / bounds.height,
        0, 1
      )
    };

    saveSettings();
  }

  function resetToolbarPosition() {
    settings.toolbar = {
      ...DEFAULT_SETTINGS.toolbar,
      pinned: false
    };

    saveSettings();
    closeToolbarPopovers();

    if (toolbar && !toolbar.hidden) {
      positionToolbar(toolbarAnchorRect);
    }
  }

  function positionToolbar(rect) {
    if (!toolbar) return;
    if (rect) toolbarAnchorRect = rect;

    toolbar.hidden = false;
    toolbar.style.visibility = "hidden";

    const bounds = viewportBounds();
    const width = toolbar.offsetWidth;
    const height = toolbar.offsetHeight;
    const anchor = rect || toolbarAnchorRect;

    if (settings.toolbar && settings.toolbar.pinned) {
      setToolbarCoordinates(
        bounds.left + settings.toolbar.xPct * bounds.width - width / 2,
        bounds.top + settings.toolbar.yPct * bounds.height - height / 2
      );
    } else if (!anchor) {
      setToolbarCoordinates(
        bounds.right - width - 10,
        bounds.top + bounds.height / 2 - height / 2
      );
    } else if (compactToolbar()) {
      const left = anchor.left + anchor.width / 2 - width / 2;
      let top = anchor.bottom + 16;

      if (top + height > bounds.bottom - 8) {
        top = anchor.top - height - 16;
      }

      setToolbarCoordinates(left, top);
    } else {
      const right = anchor.right + 10;
      const left = right + width <= bounds.right - 8
        ? right
        : anchor.left - width - 10;

      setToolbarCoordinates(
        left,
        anchor.top + anchor.height / 2 - height / 2
      );
    }

    syncLauncherVisibility();
  }

  function buildToolbarGrip() {
    const grip = el("button", {
      type: "button",
      class: "tmhl-toolbar-grip",
      "aria-label": "Move highlight controls",
      title: "Drag to move. Double-click to follow selection.",
      html: ICON.grip
    });

    let drag = null;

    grip.addEventListener("pointerdown", event => {
      if (event.button !== undefined && event.button !== 0) return;

      event.preventDefault();
      event.stopPropagation();
      closeToolbarPopovers();

      const rect = toolbar.getBoundingClientRect();
      drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startLeft: rect.left,
        startTop: rect.top,
        moved: false
      };
      toolbarDragging = true;

      try {
        grip.setPointerCapture(event.pointerId);
      } catch {
        // Optional.
      }
    });

    grip.addEventListener("pointermove", event => {
      if (!drag || event.pointerId !== drag.pointerId) return;

      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < (isTouch() ? 8 : 4)) return;

      drag.moved = true;
      toolbar.classList.add("tmhl-dragging");
      setToolbarCoordinates(drag.startLeft + dx, drag.startTop + dy);
    });

    const finish = event => {
      if (!drag || event.pointerId !== drag.pointerId) return;

      const moved = drag.moved;
      const cancelled = event.type === "pointercancel";
      const pointerId = drag.pointerId;

      drag = null;
      toolbarDragging = false;
      toolbar.classList.remove("tmhl-dragging");

      try {
        grip.releasePointerCapture(pointerId);
      } catch {
        // Optional.
      }

      if (moved && !cancelled) saveToolbarPosition();
      else if (cancelled) positionToolbar(toolbarAnchorRect);
    };

    grip.addEventListener("pointerup", finish);
    grip.addEventListener("pointercancel", finish);

    grip.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
    });

    grip.addEventListener("dblclick", event => {
      event.preventDefault();
      event.stopPropagation();
      resetToolbarPosition();
    });

    grip.addEventListener("keydown", event => {
      const direction = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1]
      }[event.key];

      if (!direction) return;

      event.preventDefault();
      event.stopPropagation();

      const rect = toolbar.getBoundingClientRect();
      const step = event.shiftKey ? 18 : 8;

      setToolbarCoordinates(
        rect.left + direction[0] * step,
        rect.top + direction[1] * step
      );
      saveToolbarPosition();
    });

    return grip;
  }

  function buildToolbarLayout(swatches, actions, record) {
    closeToolbarPopovers();

    toolbar.replaceChildren();
    if (toolbarMenu) toolbarMenu.remove();
    if (toolbarPalette) toolbarPalette.remove();

    toolbarPalette = null;
    toolbarPaletteButton = null;

    const compact = compactToolbar();
    toolbar.dataset.compact = String(compact);

    toolbarMoreButton = uiButton(
      ICON.more,
      "More highlight actions",
      toggleToolbarMenu,
      "tmhl-toolbar-more",
      true
    );
    toolbarMoreButton.setAttribute("aria-expanded", "false");
    toolbarMoreButton.setAttribute("aria-controls", "tmhl-toolbar-menu");

    toolbarMenu = el("div", {
      id: "tmhl-toolbar-menu",
      "data-tmhl-ui": "true",
      role: "group",
      "aria-label": "Highlight actions"
    });
    toolbarMenu.hidden = true;

    actions.forEach(button => toolbarMenu.appendChild(button));

    toolbarMenu.append(
      toolButton(ICON.target, "Follow selection", resetToolbarPosition),
      toolButton(ICON.close, "Close controls", () => hideToolbar())
    );

    document.body.appendChild(toolbarMenu);

    if (compact) {
      toolbarPalette = el("div", {
        id: "tmhl-color-popover",
        "data-tmhl-ui": "true",
        role: "group",
        "aria-label": "Choose highlight color"
      });
      toolbarPalette.hidden = true;
      swatches.forEach(swatch => toolbarPalette.appendChild(swatch));
      document.body.appendChild(toolbarPalette);

      const primary = el("button", {
        type: "button",
        class: "tmhl-toolbar-primary",
        "aria-label": record
          ? "Change highlight color"
          : `Highlight in ${COLOR_LABEL[settings.defaultColor].toLowerCase()}`
      });

      primary.append(
        el("span", {
          class: "tmhl-color-sample",
          style: `--sw: var(--tmhl-swatch-${record ? record.color : settings.defaultColor})`,
          "aria-hidden": "true"
        }),
        el("span", {
          class: "tmhl-button-label",
          text: record ? "Color" : "Highlight"
        })
      );

      let quick;

      if (record) {
        bindPress(primary, toggleToolbarPalette);
        toolbarPaletteButton = primary;

        quick = uiButton(
          ICON.note,
          record.note ? "Edit note" : "Add note",
          () => {
            hideToolbar();
            startNoteEdit(record.id);
          },
          "tmhl-toolbar-quick",
          true
        );
      } else {
        bindPress(primary, () => commitHighlight(settings.defaultColor));

        quick = uiButton(
          ICON.palette,
          "Choose another highlight color",
          toggleToolbarPalette,
          "tmhl-toolbar-quick",
          true
        );
        toolbarPaletteButton = quick;
      }

      toolbarPaletteButton.setAttribute("aria-expanded", "false");
      toolbarPaletteButton.setAttribute("aria-controls", "tmhl-color-popover");

      toolbar.append(
        buildToolbarGrip(),
        primary,
        quick,
        toolbarMoreButton
      );
    } else {
      const rail = el("div", {
        class: "tmhl-color-rail",
        role: "group",
        "aria-label": "Highlight colors"
      });
      swatches.forEach(swatch => rail.appendChild(swatch));

      toolbar.append(
        toolbarMoreButton,
        rail,
        buildToolbarGrip()
      );
    }
  }

  function hideToolbar(reset) {
    closeToolbarPopovers();

    if (toolbar) {
      toolbar.hidden = true;
      toolbar.style.visibility = "";
      toolbar.classList.remove("tmhl-dragging");
    }

    toolbarDragging = false;
    suppressCaptureUntil = now() + 250;
    clearTimeout(selectionTimer);

    if (reset !== false) {
      captured = null;
      activeId = null;
    }

    syncLauncherVisibility();
  }

  function showCreateToolbar(rect) {
    if (!toolbar) return;
    activeId = null;

    const swatches = COLORS.map(color =>
      swatchButton(
        color,
        color === settings.defaultColor,
        commitHighlight
      )
    );

    const actions = [
      toolButton(ICON.list, "Open highlights", () => openPanel()),
      toolButton(ICON.copy, "Copy selected text", async () => {
        if (!captured) return;
        const text = captured.exact;
        const success = await copyText(text);
        hideToolbar();
        toast(success ? "Copied." : "Copy blocked by the browser.");
      })
    ];

    buildToolbarLayout(swatches, actions, null);
    positionToolbar(rect);
  }

  function showEditToolbar(id, rect) {
    const record = findRecord(id);
    if (!toolbar || !record || record.deleted) return;

    captured = null;
    activeId = id;

    const swatches = COLORS.map(color =>
      swatchButton(
        color,
        color === record.color,
        picked => recolorHighlight(id, picked)
      )
    );

    const actions = [
      toolButton(ICON.list, "Open highlights", () => openPanel()),
      toolButton(
        ICON.note,
        record.note ? "Edit note" : "Add note",
        () => {
          hideToolbar();
          startNoteEdit(id);
        }
      ),
      toolButton(ICON.copy, "Copy text", async () => {
        const success = await copyText(record.exact);
        hideToolbar();
        toast(success ? "Copied." : "Copy blocked by the browser.");
      }),
      toolButton(
        ICON.trash,
        "Delete highlight",
        confirmDeleteAction(id),
        "tmhl-danger"
      )
    ];

    buildToolbarLayout(swatches, actions, record);
    positionToolbar(rect);
  }

  /* ------------------------------------------------------------------
   * Selection capture
   * ---------------------------------------------------------------- */

  let selectionTimer = 0;

  function overlapsRendered(root, start, end) {
    return rendered.filter(item =>
      item.root === root && start < item.end && end > item.start
    );
  }

  function selectionCanBeCaptured() {
    if (
      now() < suppressCaptureUntil ||
      toolbarDragging ||
      (view.open && isNarrow()) ||
      (toolbarMenu && !toolbarMenu.hidden) ||
      (toolbarPalette && !toolbarPalette.hidden)
    ) {
      return false;
    }

    const selection = getSelection();

    if (!selection || !selection.rangeCount || selection.isCollapsed) {
      return false;
    }

    const node = selection.anchorNode;
    const element = node && (
      node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
    );

    return !(
      element &&
      element.closest(
        '[data-tmhl-ui], input, textarea, select, [contenteditable="true"]'
      )
    );
  }

  function captureSelection() {
    if (!selectionCanBeCaptured()) return;

    const selection = getSelection();
    const range = selection.getRangeAt(0).cloneRange();
    const root = rootFromNode(range.startContainer);

    if (!root || !root.contains(range.endContainer)) return;
    if (root.closest("[data-tmhl-ui]")) return;

    const chatId = currentChatId();

    if (!chatId) {
      hideToolbar();
      toast("Open a saved chat before highlighting.");
      return;
    }

    bumpTextCache();

    const offsets = rangeToOffsets(root, range);
    if (!offsets) return;

    const text = rootText(root);
    const exact = text.slice(offsets.start, offsets.end);
    if (!exact.trim()) return;

    const rect = rangeRect(range);
    if (!rect) return;

    const overlaps = overlapsRendered(root, offsets.start, offsets.end);
    const containedInOne =
      overlaps.length === 1 &&
      overlaps[0].start <= offsets.start &&
      overlaps[0].end >= offsets.end;

    if (containedInOne) {
      if (
        toolbar &&
        !toolbar.hidden &&
        activeId === overlaps[0].record.id
      ) {
        return;
      }

      showEditToolbar(overlaps[0].record.id, rect);
      return;
    }

    let start = offsets.start;
    let end = offsets.end;

    overlaps.forEach(item => {
      start = Math.min(start, item.start);
      end = Math.max(end, item.end);
    });

    if (
      captured &&
      toolbar &&
      !toolbar.hidden &&
      captured.root === root &&
      captured.start === start &&
      captured.end === end &&
      captured.exact === text.slice(start, end)
    ) {
      return;
    }

    captured = {
      chatId,
      root,
      start,
      end,
      exact: text.slice(start, end),
      absorb: overlaps.map(item => item.record.id),
      rect
    };

    showCreateToolbar(rect);
  }

  function scheduleCapture(delay) {
    clearTimeout(selectionTimer);
    if (!selectionCanBeCaptured()) return;

    selectionTimer = setTimeout(
      captureSelection,
      Number.isFinite(delay) ? delay : 260
    );
  }

  /* ------------------------------------------------------------------
   * Store mutations
   * ---------------------------------------------------------------- */

  function commitHighlight(color) {
    const snapshot = captured;

    if (!snapshot || !COLORS.includes(color)) {
      hideToolbar();
      return;
    }

    const chatId = currentChatId();

    if (
      !chatId ||
      chatId !== snapshot.chatId ||
      !snapshot.root.isConnected
    ) {
      hideToolbar();
      toast("The chat moved. Select the text again.");
      return;
    }

    bumpTextCache();
    const text = rootText(snapshot.root);

    if (text.slice(snapshot.start, snapshot.end) !== snapshot.exact) {
      hideToolbar();
      toast("The response changed. Select the text again.");
      return;
    }

    const messageIndex = getResponseRoots().indexOf(snapshot.root);

    (snapshot.absorb || []).forEach(id => {
      const record = findRecord(id);
      if (record) {
        record.deleted = true;
        record.updatedAt = Math.max(now(), (record.updatedAt || 0) + 1);
      }
    });

    store.items.push({
      id: makeId(),
      chatId,
      chatTitle: currentChatTitle(),
      color,
      exact: snapshot.exact,
      note: "",
      prefix: text.slice(Math.max(0, snapshot.start - 72), snapshot.start),
      suffix: text.slice(snapshot.end, snapshot.end + 72),
      start: snapshot.start,
      end: snapshot.end,
      messageIndex,
      messageHash: hashText(text),
      createdAt: new Date().toISOString(),
      updatedAt: now(),
      deleted: false
    });

    settings.defaultColor = color;
    saveSettings();

    if (!persist()) return;

    scheduleTitleRefresh(true);

    const selection = getSelection();
    if (selection) selection.removeAllRanges();

    hideToolbar();

    clearMarks(mark =>
      (snapshot.absorb || []).includes(mark.dataset.tmhlId)
    );

    restoreHighlights();
    bumpLauncher();
  }

  function recolorHighlight(id, color) {
    const record = findRecord(id);
    if (!record || record.deleted || !COLORS.includes(color)) return;

    record.color = color;
    record.updatedAt = Math.max(now(), (record.updatedAt || 0) + 1);
    settings.defaultColor = color;

    saveSettings();
    if (!persist()) return;

    hideToolbar();
    marksById(id).forEach(mark => {
      mark.dataset.color = color;
    });
  }

  function setNote(id, note) {
    const record = findRecord(id);
    if (!record || record.deleted) return false;

    if (record.note === note) return true;

    record.note = note;
    record.updatedAt = Math.max(now(), (record.updatedAt || 0) + 1);

    if (!persist()) return false;

    marksById(id).forEach(mark => {
      if (note) mark.dataset.note = "1";
      else delete mark.dataset.note;
      mark.title = note || "";
    });

    return true;
  }

  function deleteHighlight(id) {
    const record = findRecord(id);

    if (!record || record.deleted) {
      hideToolbar();
      return;
    }

    record.deleted = true;
    record.updatedAt = Math.max(now(), (record.updatedAt || 0) + 1);

    if (!persist()) return;

    clearMarks(mark => mark.dataset.tmhlId === id);
    rendered = rendered.filter(item => item.record.id !== id);
    hideToolbar();

    toast("Highlight deleted.");
  }

  function clearChatHighlights() {
    const chatId = currentChatId();
    if (!chatId) return;

    const targets = itemsForChat(chatId);
    if (!targets.length) return;

    if (!confirm(`Delete ${targets.length} highlights in this chat?`)) {
      return;
    }

    if (targets.some(item => item.id === view.editingNote)) {
      view.editingNote = null;
      view.noteDraft = "";
    }

    targets.forEach(record => {
      record.deleted = true;
      record.updatedAt = Math.max(now(), (record.updatedAt || 0) + 1);
    });

    if (!persist()) return;

    clearMarks(mark => mark.dataset.tmhlChat === chatId);
    rendered = [];
    toast("Chat highlights cleared.");
  }

  function clearAllHighlights() {
    const count = liveItems().length;
    if (!count) return;

    if (!confirm(`Delete all ${count} highlights on every chat?`)) return;

    view.editingNote = null;
    view.noteDraft = "";

    liveItems().forEach(record => {
      record.deleted = true;
      record.updatedAt = Math.max(now(), (record.updatedAt || 0) + 1);
    });

    if (!persist()) return;

    clearMarks();
    rendered = [];
    toast("All highlights cleared.");
  }

  /* ------------------------------------------------------------------
   * Export and import
   * ---------------------------------------------------------------- */

  function exportJson() {
    return JSON.stringify({
      version: 3,
      updatedAt: store.updatedAt,
      items: store.items
    }, null, 2);
  }

  function exportMarkdown(scopeChatId) {
    const items = liveItems()
      .filter(item => !scopeChatId || item.chatId === scopeChatId)
      .sort((first, second) =>
        first.createdAt.localeCompare(second.createdAt)
      );

    const groups = new Map();

    items.forEach(item => {
      const key = item.chatTitle || item.chatId;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });

    const lines = ["# Highlights", ""];

    groups.forEach((records, title) => {
      lines.push(`## ${title}`, "");

      records.forEach(record => {
        lines.push(`> ${record.exact.replace(/\n+/g, "\n> ")}`);
        if (record.note) lines.push("", `Note: ${record.note}`);
        lines.push("");
      });
    });

    return lines.join("\n");
  }

  function importJson(input) {
    try {
      const parsed = typeof input === "string" ? JSON.parse(input) : input;
      const items = Array.isArray(parsed) ? parsed : parsed && parsed.items;

      if (!Array.isArray(items)) throw new Error("No items array found.");

      const valid = items.filter(validRecord);
      store = mergeDocs(store, { updatedAt: now(), items: valid }).doc;

      if (!persist()) return false;

      scheduleRestore(60);
      scheduleTitleRefresh(true);

      toast(
        `Imported ${valid.length} records.` +
        (valid.length < items.length
          ? ` Skipped ${items.length - valid.length} invalid records.`
          : "")
      );

      return true;
    } catch (error) {
      toast(`Import failed: ${error.message}`);
      return false;
    }
  }

  function pickImportFile() {
    const input = el("input", {
      type: "file",
      accept: "application/json,.json",
      "data-tmhl-ui": "true"
    });
    input.style.display = "none";

    const cleanup = () => input.remove();

    input.addEventListener("change", () => {
      const file = input.files && input.files[0];

      if (!file) {
        cleanup();
        return;
      }

      const reader = new FileReader();
      reader.onload = () => importJson(String(reader.result || ""));
      reader.onerror = () => toast("Could not read that file.");
      reader.readAsText(file);
      cleanup();
    });

    input.addEventListener("cancel", cleanup, { once: true });

    const host = panel && panel.open ? panel : document.body;
    host.appendChild(input);
    input.click();
  }

  /* ------------------------------------------------------------------
   * Highlights panel
   * ---------------------------------------------------------------- */

  let panel = null;
  let launcher = null;
  let listNode = null;
  let countNode = null;
  let settingsNode = null;
  let statusNode = null;
  let titleNode = null;
  let searchNode = null;
  let colorSelect = null;
  let scopeButtons = [];
  let panelMenu = null;
  let panelMoreButton = null;
  let panelBackButton = null;
  let panelSettingsButton = null;
  let panelReturnFocus = null;
  let panelModal = false;
  let listSignature = "";

  const view = {
    open: false,
    tab: "list",
    scope: "chat",
    color: "all",
    query: "",
    editingNote: null,
    noteDraft: "",
    openedAt: 0
  };

  function closePanelMenu(returnFocus) {
    if (panelMenu) panelMenu.hidden = true;

    if (panelMoreButton) {
      panelMoreButton.setAttribute("aria-expanded", "false");
      if (returnFocus) safeFocus(panelMoreButton);
    }
  }

  function positionPanelMenu() {
    if (!panelMenu || panelMenu.hidden || !panel || !panel.open) return;

    const box = panel.getBoundingClientRect();
    const button = panelMoreButton.getBoundingClientRect();
    const top = button.bottom - box.top + 7;

    panelMenu.style.top = `${top}px`;
    panelMenu.style.maxHeight = `${Math.max(44, box.height - top - 12)}px`;
  }

  function buildPanelMenu() {
    panelMenu.replaceChildren();

    const action = fn => () => {
      if (!finishNoteEdit(true)) return;
      closePanelMenu();
      fn();
      if (view.tab === "list") renderList();
    };

    panelMenu.append(
      toolButton(
        ICON.gear,
        "Settings",
        action(() => setTab("settings"))
      ),
      el("div", { class: "tmhl-menu-divider" }),
      toolButton(
        ICON.file,
        "Export Markdown",
        action(() => {
          downloadFile(
            "highlights.md",
            exportMarkdown(view.scope === "chat" ? currentChatId() : null),
            "text/markdown"
          );
        })
      ),
      toolButton(
        ICON.download,
        "Backup JSON",
        action(() => downloadFile(
          "highlights.json",
          exportJson(),
          "application/json"
        ))
      ),
      toolButton(
        ICON.upload,
        "Import JSON",
        action(pickImportFile)
      )
    );

    if (syncConfig) {
      panelMenu.append(
        el("div", { class: "tmhl-menu-divider" }),
        toolButton(
          ICON.sync,
          "Sync now",
          action(() => syncCloud(true))
        )
      );
    }
  }

  function togglePanelMenu(event) {
    const opening = panelMenu.hidden;
    closePanelMenu();
    if (!opening) return;

    buildPanelMenu();
    panelMenu.hidden = false;
    panelMoreButton.setAttribute("aria-expanded", "true");
    positionPanelMenu();

    if (event && event.detail === 0) {
      safeFocus(panelMenu.querySelector("button"));
    }
  }

  function buildPanel() {
    panel = el("dialog", {
      id: "tmhl-panel",
      "data-tmhl-ui": "true",
      "aria-labelledby": "tmhl-panel-title"
    });

    const handle = el("button", {
      type: "button",
      class: "tmhl-sheet-handle",
      "aria-label": "Close highlights. Tap or drag down.",
      title: "Tap or drag down to close"
    });
    panel.appendChild(handle);

    const head = el("header", { class: "tmhl-head" });

    panelBackButton = uiButton(
      ICON.back,
      "Back to highlights",
      () => setTab("list"),
      "tmhl-tool",
      true
    );
    panelBackButton.hidden = true;

    const heading = el("div", { class: "tmhl-heading" });
    const headingLine = el("div", { class: "tmhl-heading-line" });

    titleNode = el("h2", {
      id: "tmhl-panel-title",
      class: "tmhl-title",
      tabindex: "-1",
      text: "Highlights"
    });

    countNode = el("span", { class: "tmhl-count", text: "0" });
    statusNode = el("span", { class: "tmhl-status", text: "" });

    headingLine.append(titleNode, countNode);
    heading.append(headingLine, statusNode);

    panelSettingsButton = uiButton(
      ICON.gear,
      "Settings",
      () => setTab("settings"),
      "tmhl-tool",
      true
    );

    panelMoreButton = uiButton(
      ICON.more,
      "Export, backup and more",
      togglePanelMenu,
      "tmhl-tool",
      true
    );
    panelMoreButton.setAttribute("aria-expanded", "false");
    panelMoreButton.setAttribute("aria-controls", "tmhl-panel-menu");

    const close = uiButton(
      ICON.close,
      "Close highlights",
      closePanel,
      "tmhl-tool",
      true
    );

    head.append(
      panelBackButton,
      heading,
      panelSettingsButton,
      panelMoreButton,
      close
    );
    panel.appendChild(head);

    const controls = el("div", { class: "tmhl-controls" });

    controls.appendChild(el("label", {
      for: "tmhl-search",
      class: "tmhl-sr-only",
      text: "Search highlights, notes and chat titles"
    }));

    searchNode = el("input", {
      id: "tmhl-search",
      class: "tmhl-search",
      type: "search",
      placeholder: "Search highlights and notes",
      autocomplete: "off",
      spellcheck: "false"
    });

    searchNode.addEventListener("input", () => {
      if (!finishNoteEdit(true)) return;
      view.query = searchNode.value.trim().toLowerCase();
      renderList();
    });

    controls.appendChild(searchNode);

    const filterRow = el("div", { class: "tmhl-filter-row" });
    const scope = el("div", {
      class: "tmhl-scope",
      role: "group",
      "aria-label": "Highlight scope"
    });

    scopeButtons = ["chat", "all"].map(value => {
      const button = uiButton(
        "",
        value === "chat" ? "This chat" : "All chats",
        () => {
          if (!finishNoteEdit(true)) return;
          view.scope = value;
          syncFilterControls();
          renderList();
        },
        "tmhl-scope-button"
      );

      button.dataset.scope = value;
      button.setAttribute("aria-pressed", value === view.scope ? "true" : "false");
      scope.appendChild(button);
      return button;
    });

    colorSelect = el("select", {
      class: "tmhl-select",
      "aria-label": "Filter by highlight color"
    });

    colorSelect.appendChild(el("option", {
      value: "all",
      text: "All colors"
    }));

    COLORS.forEach(color => {
      colorSelect.appendChild(el("option", {
        value: color,
        text: COLOR_LABEL[color]
      }));
    });

    colorSelect.addEventListener("change", () => {
      setColorFilter(colorSelect.value);
    });

    filterRow.append(scope, colorSelect);
    controls.appendChild(filterRow);
    panel.appendChild(controls);
    panel._controls = controls;

    listNode = el("div", {
      class: "tmhl-list",
      "aria-label": "Saved highlights"
    });

    settingsNode = el("div", { class: "tmhl-settings" });
    settingsNode.hidden = true;

    panelMenu = el("div", {
      id: "tmhl-panel-menu",
      class: "tmhl-menu",
      role: "group",
      "aria-label": "Highlights panel actions"
    });
    panelMenu.hidden = true;

    panel.append(listNode, settingsNode, panelMenu);
    document.body.appendChild(panel);

    panel.addEventListener("cancel", event => {
      event.preventDefault();
      closePanel();
    });

    panel.addEventListener("close", () => {
      // Ignore the queued close event when changing modal/nonmodal mode.
      if (view.open && !panel.open) closePanel();
    });

    let backdropPress = false;

    const outside = event => {
      const rect = panel.getBoundingClientRect();
      return (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      );
    };

    panel.addEventListener("pointerdown", event => {
      backdropPress = event.target === panel && outside(event);

      if (
        panelMenu &&
        !panelMenu.hidden &&
        !panelMenu.contains(event.target) &&
        !panelMoreButton.contains(event.target)
      ) {
        closePanelMenu();
      }
    });

    panel.addEventListener("pointercancel", () => {
      backdropPress = false;
    });

    panel.addEventListener("click", event => {
      if (
        backdropPress &&
        event.target === panel &&
        outside(event) &&
        now() - view.openedAt > 300
      ) {
        closePanel();
      }
      backdropPress = false;
    });

    panel.addEventListener("touchmove", event => {
      if (panelModal && event.target === panel && event.cancelable) {
        event.preventDefault();
      }
    }, { passive: false });

    enableSheetDrag(handle);
    syncFilterControls();
  }

  function syncFilterControls() {
    scopeButtons.forEach(button => {
      button.setAttribute(
        "aria-pressed",
        button.dataset.scope === view.scope ? "true" : "false"
      );
    });

    if (colorSelect) colorSelect.value = view.color;
    updatePanelCount();
  }

  function setColorFilter(color) {
    if (!finishNoteEdit(true)) {
      if (colorSelect) colorSelect.value = view.color;
      return;
    }

    view.color = COLORS.includes(color) ? color : "all";
    syncFilterControls();
    renderList();
  }

  function setTab(tab) {
    if (!panel || !finishNoteEdit(true)) return false;

    closePanelMenu();

    view.tab = tab === "settings" ? "settings" : "list";
    const showList = view.tab === "list";

    listNode.hidden = !showList;
    panel._controls.hidden = !showList;
    settingsNode.hidden = showList;
    panelBackButton.hidden = showList;
    panelSettingsButton.hidden = !showList;
    countNode.hidden = !showList;
    titleNode.textContent = showList ? "Highlights" : "Settings";

    if (showList) renderList();
    else renderSettings();

    renderStatus();
    if (view.open) safeFocus(titleNode);

    return true;
  }

  function updatePanelViewport() {
    if (!panel || !view.open) return;

    const bounds = viewportBounds();
    const mobile = isNarrow();
    const focused = panel.contains(document.activeElement)
      ? document.activeElement
      : null;

    const keyboard = mobile && bounds.height < window.innerHeight * 0.75;
    const topGap = mobile
      ? keyboard
        ? 6
        : Math.min(28, bounds.height * 0.04)
      : 0;

    const width = mobile ? bounds.width : Math.min(420, bounds.width);
    const height = Math.max(100, bounds.height - topGap);

    panel.classList.toggle("tmhl-mobile", mobile);
    panel.style.left = `${mobile ? bounds.left : bounds.right - width}px`;
    panel.style.top = `${bounds.top + topGap}px`;
    panel.style.width = `${width}px`;
    panel.style.height = `${height}px`;

    if (panel.open && panelModal !== mobile) panel.close();

    const wasOpen = panel.open;
    panelModal = mobile;

    if (!panel.open) {
      if (mobile) panel.showModal();
      else panel.show();
    }

    document.documentElement.classList.toggle("tmhl-modal-lock", mobile);

    if (!wasOpen) safeFocus(focused || titleNode);

    positionPanelMenu();
    ensureNoteVisible();
  }

  function openPanel() {
    if (!panel) return false;

    if (view.open) {
      hideToolbar();
      return setTab("list");
    }

    panelReturnFocus = document.activeElement;
    hideToolbar();
    clearTimeout(selectionTimer);

    view.open = true;
    view.openedAt = now();

    // Opening Highlights always opens the reading list, not a stale settings tab.
    setTab("list");

    const selection = getSelection();
    if (selection && !selection.isCollapsed) selection.removeAllRanges();

    updatePanelViewport();
    safeFocus(titleNode);
    syncLauncherVisibility();
    renderPanel();

    scheduleTitleRefresh(true);
    scheduleCloudSync(0);
    return true;
  }

  function closePanel() {
    if (!panel) return false;
    if (!view.open && !panel.open) return true;
    if (!finishNoteEdit(true)) return false;

    view.open = false;
    closePanelMenu();

    if (toastNode && toastNode.parentNode === panel) {
      document.body.appendChild(toastNode);
    }

    if (panel.open) panel.close();
    panel.style.transform = "";

    document.documentElement.classList.remove("tmhl-modal-lock");
    syncLauncherVisibility();

    let target = panelReturnFocus;

    if (
      !target ||
      !target.isConnected ||
      target === document.body ||
      isToolbarUI(target) ||
      (isNarrow() && isTypingTarget(target))
    ) {
      target = launcher && !launcher.hidden && !launcher.inert
        ? launcher
        : null;
    }

    safeFocus(target);
    panelReturnFocus = null;
    layoutToast();
    return true;
  }

  function togglePanel() {
    return view.open ? closePanel() : openPanel();
  }

  function visibleRecords() {
    const chatId = currentChatId();
    let items = liveItems();

    if (view.scope === "chat") {
      items = items.filter(item => item.chatId === chatId);
    }

    if (view.color !== "all") {
      items = items.filter(item => item.color === view.color);
    }

    if (view.query) {
      items = items.filter(item =>
        item.exact.toLowerCase().includes(view.query) ||
        (item.note || "").toLowerCase().includes(view.query) ||
        (item.chatTitle || "").toLowerCase().includes(view.query)
      );
    }

    return items.sort((first, second) => {
      if (first.chatId === second.chatId) {
        return first.createdAt.localeCompare(second.createdAt);
      }
      return second.updatedAt - first.updatedAt;
    });
  }

  function updatePanelCount(records) {
    if (!countNode) return;

    const list = records || visibleRecords();
    countNode.textContent = String(list.length);
    countNode.title = `${list.length} matching highlights`;
  }

  function cardAction(icon, label, id, action, danger) {
    const button = uiButton(
      icon,
      label,
      action,
      `tmhl-act${danger ? " tmhl-danger" : ""}`
    );
    button.dataset.focusKey = `${id}:${label}`;
    return button;
  }

  function buildCard(record) {
    const card = el("article", {
      class: "tmhl-card",
      style: `--rail: var(--tmhl-${record.color}-2)`,
      "data-id": record.id
    });

    const title =
      cleanChatTitle(record.chatTitle) ||
      chatTitleCache.get(record.chatId) ||
      "Untitled chat";

    card.append(
      el("div", { class: "tmhl-chat", text: title }),
      el("div", {
        class: "tmhl-meta",
        text: `${COLOR_LABEL[record.color]} · ${relativeTime(record.createdAt)}`
      }),
      el("div", { class: "tmhl-quote", text: record.exact })
    );

    if (view.editingNote === record.id) {
      const editor = el("div", { class: "tmhl-editor" });

      const area = el("textarea", {
        class: "tmhl-noteedit",
        placeholder: "Write a note...",
        "aria-label": "Highlight note",
        "data-note-id": record.id
      });
      area.value = view.noteDraft;

      area.addEventListener("input", () => {
        if (view.editingNote === record.id) view.noteDraft = area.value;
      });

      area.addEventListener("keydown", event => {
        const saveWithEnter =
          event.key === "Enter" &&
          !event.isComposing &&
          (
            event.ctrlKey ||
            event.metaKey ||
            (!isTouch() && !isNarrow() && !event.shiftKey)
          );

        if (saveWithEnter) {
          event.preventDefault();
          event.stopPropagation();
          saveEditedNote();
        }
      });

      const row = el("div", { class: "tmhl-button-row" });

      row.append(
        uiButton(
          ICON.check,
          "Save note",
          saveEditedNote,
          "tmhl-btn tmhl-primary-btn"
        ),
        uiButton(
          ICON.close,
          "Cancel",
          cancelNoteEdit,
          "tmhl-btn"
        )
      );

      editor.append(
        area,
        row,
        el("p", {
          class: "tmhl-help",
          text: isTouch() || isNarrow()
            ? "Enter adds a line. Your note also saves when you close Highlights."
            : "Enter saves. Shift+Enter adds a line. Closing Highlights also saves."
        })
      );

      card.appendChild(editor);
    } else if (record.note) {
      const note = el("div", { class: "tmhl-note" });
      note.append(
        el("span", { class: "tmhl-note-heading", text: "Note" }),
        document.createTextNode(record.note)
      );
      card.appendChild(note);
    }

    const actions = el("div", { class: "tmhl-actions" });

    actions.append(
      cardAction(
        ICON.note,
        "Note",
        record.id,
        () => {
          if (view.editingNote === record.id) saveEditedNote();
          else startNoteEdit(record.id);
        }
      ),
      cardAction(
        ICON.copy,
        "Copy",
        record.id,
        async () => {
          if (!finishNoteEdit(true)) return;

          const current = findRecord(record.id);
          if (!current || current.deleted) return;

          const success = await copyText(
            current.note
              ? `${current.exact}\n\n${current.note}`
              : current.exact
          );

          renderList();
          toast(success ? "Copied." : "Copy blocked by the browser.");
        }
      ),
      cardAction(
        ICON.jump,
        "Open chat",
        record.id,
        () => jumpTo(findRecord(record.id))
      ),
      cardAction(
        ICON.trash,
        "Delete",
        record.id,
        confirmDeleteAction(record.id),
        true
      )
    );

    card.appendChild(actions);

    // Deliberately no card click or double-click navigation.
    // The quote remains fully selectable and readable.
    return card;
  }

  function renderList(force) {
    if (!listNode) return;

    const records = visibleRecords();
    updatePanelCount(records);

    if (
      !force &&
      view.editingNote &&
      listNode.querySelector(".tmhl-noteedit")
    ) {
      return;
    }

    const signature = JSON.stringify([
      view.scope,
      view.color,
      view.query,
      view.editingNote,
      records
    ]);

    if (!force && signature === listSignature) return;
    listSignature = signature;

    const scrollTop = listNode.scrollTop;
    const active = document.activeElement;
    const focusKey = active && active.dataset
      ? active.dataset.focusKey
      : "";

    const box = listNode.getBoundingClientRect();

    const anchor = Array.from(listNode.children).find(node => {
      if (!node.dataset.id) return false;
      const rect = node.getBoundingClientRect();
      return rect.bottom > box.top && rect.top < box.bottom;
    });

    const anchorId = anchor && anchor.dataset.id;
    const anchorOffset = anchor
      ? anchor.getBoundingClientRect().top - box.top
      : 0;

    const fragment = document.createDocumentFragment();

    if (!records.length) {
      const filtered = Boolean(view.query || view.color !== "all");
      const empty = el("div", { class: "tmhl-empty" });

      empty.append(
        el("b", {
          text: filtered
            ? "No matching highlights."
            : view.scope === "chat"
              ? "No highlights in this chat."
              : "No highlights yet."
        }),
        el("span", {
          text: filtered
            ? "Try another color, a shorter search, or All chats."
            : "Select text in a message, then choose a highlight color."
        })
      );

      fragment.appendChild(empty);
    } else {
      records.forEach(record => fragment.appendChild(buildCard(record)));
    }

    listNode.replaceChildren(fragment);
    listNode.scrollTop = scrollTop;

    if (anchorId && !force) {
      const nextAnchor = Array.from(listNode.children)
        .find(node => node.dataset.id === anchorId);

      if (nextAnchor) {
        listNode.scrollTop +=
          nextAnchor.getBoundingClientRect().top -
          listNode.getBoundingClientRect().top -
          anchorOffset;
      }
    }

    if (focusKey && active && !active.isConnected) {
      const nextFocus = Array.from(
        listNode.querySelectorAll("[data-focus-key]")
      ).find(node => node.dataset.focusKey === focusKey);
      safeFocus(nextFocus);
    }
  }

  function finishNoteEdit(save) {
    const id = view.editingNote;
    if (!id) return true;

    const record = findRecord(id);

    if (
      save &&
      record &&
      !record.deleted &&
      !setNote(id, view.noteDraft.trim())
    ) {
      return false;
    }

    view.editingNote = null;
    view.noteDraft = "";
    return true;
  }

  function focusCardNoteButton(id) {
    const button = Array.from(
      listNode.querySelectorAll("[data-focus-key]")
    ).find(node => node.dataset.focusKey === `${id}:Note`);

    safeFocus(button || titleNode);
  }

  function saveEditedNote() {
    const id = view.editingNote;
    if (!id || !finishNoteEdit(true)) return;

    renderList(true);
    focusCardNoteButton(id);
    toast("Note saved.");
  }

  function cancelNoteEdit() {
    const id = view.editingNote;
    if (!id) return;

    finishNoteEdit(false);
    renderList(true);
    focusCardNoteButton(id);
  }

  function ensureNoteVisible() {
    if (
      !view.open ||
      !view.editingNote ||
      !listNode ||
      listNode.hidden
    ) {
      return;
    }

    const area = listNode.querySelector(".tmhl-noteedit");
    if (!area || document.activeElement !== area) return;

    const rect = area.getBoundingClientRect();
    const listRect = listNode.getBoundingClientRect();

    if (rect.bottom > listRect.bottom - 12) {
      listNode.scrollTop += rect.bottom - listRect.bottom + 12;
    } else if (rect.top < listRect.top + 8) {
      listNode.scrollTop -= listRect.top + 8 - rect.top;
    }
  }

  function startNoteEdit(id) {
    const record = findRecord(id);
    if (!record || record.deleted) return;

    if (!view.open && !openPanel()) return;
    if (!finishNoteEdit(true)) return;
    if (view.tab !== "list" && !setTab("list")) return;

    hideToolbar();

    if (record.chatId !== currentChatId()) view.scope = "all";
    view.color = "all";
    view.query = "";
    searchNode.value = "";

    view.editingNote = id;
    view.noteDraft = record.note || "";

    syncFilterControls();
    renderList(true);

    const area = listNode.querySelector(".tmhl-noteedit");
    safeFocus(area);
    ensureNoteVisible();
  }

  function settingsSwitch(label, help, checked, onChange) {
    const field = el("section", { class: "tmhl-field" });
    const row = el("div", { class: "tmhl-row" });

    row.appendChild(el("span", {
      class: "tmhl-label",
      text: label
    }));

    const button = el("button", {
      type: "button",
      class: "tmhl-switch",
      role: "switch",
      "aria-checked": checked ? "true" : "false",
      "aria-label": label
    });

    button.addEventListener("click", () => {
      const next = button.getAttribute("aria-checked") !== "true";
      onChange(next);
      button.setAttribute("aria-checked", next ? "true" : "false");
    });

    row.appendChild(button);
    field.append(row, el("p", { class: "tmhl-help", text: help }));
    return field;
  }

  function renderSettings() {
    if (!settingsNode) return;

    const scrollTop = settingsNode.scrollTop;
    settingsNode.replaceChildren();

    settingsNode.append(
      settingsSwitch(
        "Floating Highlights button",
        "Compact on phones and docked to the nearest edge. Off hides it " +
        "completely. You can still open Highlights from selected text or Alt+L.",
        settings.launcherMode === "full",
        enabled => {
          settings.launcherMode = enabled ? "full" : "off";
          saveSettings();
          updateLauncher();
          refreshSidebarVisibilityWatcher();
        }
      ),
      settingsSwitch(
        "Hide behind the chat menu",
        "Hides the floating button while TypingMind's mobile sidebar is open.",
        settings.autoHideMobileLauncher,
        enabled => {
          settings.autoHideMobileLauncher = enabled;
          saveSettings();
          refreshSidebarVisibilityWatcher();
          scheduleLauncherVisibilityCheck(0);
        }
      )
    );

    const positionField = el("section", { class: "tmhl-field" });
    positionField.appendChild(el("div", {
      class: "tmhl-label",
      text: "Floating controls"
    }));

    const positionRow = el("div", { class: "tmhl-button-row" });

    positionRow.append(
      uiButton(
        ICON.target,
        "Reset button",
        () => {
          settings.launcher = { ...DEFAULT_SETTINGS.launcher };
          settings.launcherMode = "full";
          saveSettings();
          updateLauncher();
          refreshSidebarVisibilityWatcher();

          const switchNode = settingsNode.querySelector(
            '[aria-label="Floating Highlights button"]'
          );
          if (switchNode) switchNode.setAttribute("aria-checked", "true");

          toast("Floating button reset.");
        },
        "tmhl-btn"
      ),
      uiButton(
        ICON.palette,
        "Reset color controls",
        () => {
          resetToolbarPosition();
          toast("Color controls follow selections again.");
        },
        "tmhl-btn"
      )
    );

    positionField.append(
      positionRow,
      el("p", {
        class: "tmhl-help",
        text:
          "Drag the dotted grip to move the color controls. On phones, " +
          "Highlight uses the current color; the palette button opens all five colors."
      })
    );

    settingsNode.appendChild(positionField);

    const colorField = el("section", { class: "tmhl-field" });
    colorField.appendChild(el("div", {
      class: "tmhl-label",
      text: "Default highlight color"
    }));

    const colorRow = el("div", {
      class: "tmhl-filters",
      role: "group",
      "aria-label": "Default highlight color"
    });

    COLORS.forEach(color => {
      const button = swatchButton(
        color,
        color === settings.defaultColor,
        picked => {
          settings.defaultColor = picked;
          saveSettings();

          Array.from(colorRow.children).forEach(node => {
            node.setAttribute(
              "aria-pressed",
              node.dataset.color === picked ? "true" : "false"
            );
          });
        }
      );
      button.dataset.color = color;
      colorRow.appendChild(button);
    });

    colorField.append(
      colorRow,
      el("p", {
        class: "tmhl-help",
        text: "Used by Alt+H and the phone toolbar's Highlight button."
      })
    );
    settingsNode.appendChild(colorField);

    appendSyncSettings();

    const danger = el("section", { class: "tmhl-field" });
    danger.appendChild(el("div", {
      class: "tmhl-label",
      text: "Delete highlights"
    }));

    const dangerRow = el("div", { class: "tmhl-button-row" });
    dangerRow.append(
      uiButton(
        ICON.trash,
        "Clear this chat",
        clearChatHighlights,
        "tmhl-btn tmhl-danger"
      ),
      uiButton(
        ICON.trash,
        "Clear everything",
        clearAllHighlights,
        "tmhl-btn tmhl-danger"
      )
    );

    danger.append(
      dangerRow,
      el("p", {
        class: "tmhl-help",
        text:
          "Deletions also sync to connected devices. Use the top three-dot " +
          "menu to save a JSON backup first."
      })
    );

    settingsNode.append(
      danger,
      el("p", {
        class: "tmhl-help",
        text: `Highlighter v${VERSION} · Alt+H highlight · Alt+L open`
      })
    );

    settingsNode.scrollTop = scrollTop;
  }

  function renderStatus() {
    if (!statusNode) return;

    const total = liveItems().length;
    statusNode.textContent = syncConfig
      ? cloudLabel || "Sync pending"
      : `${total} saved on this device`;

    statusNode.title = syncConfig
      ? cloudDetail
      : "Saved in this browser's local storage.";
  }

  function renderPanel() {
    if (!panel) return;

    if (view.editingNote) {
      const record = findRecord(view.editingNote);
      if (!record || record.deleted) {
        view.editingNote = null;
        view.noteDraft = "";
      }
    }

    updatePanelCount();

    if (view.open && view.tab === "list") renderList();

    // Never rebuild settings while a token or repository is being entered.
    renderStatus();
  }

  function enableSheetDrag(handle) {
    let drag = null;
    let blockClickUntil = 0;

    handle.addEventListener("pointerdown", event => {
      if (!view.open || !isNarrow()) return;
      if (event.button !== undefined && event.button !== 0) return;

      event.preventDefault();
      event.stopPropagation();
      closePanelMenu();

      drag = {
        pointerId: event.pointerId,
        startY: event.clientY,
        delta: 0,
        moved: false
      };

      try {
        handle.setPointerCapture(event.pointerId);
      } catch {
        // Optional.
      }
    });

    handle.addEventListener("pointermove", event => {
      if (!drag || drag.pointerId !== event.pointerId) return;

      drag.delta = Math.max(0, event.clientY - drag.startY);

      if (!drag.moved && drag.delta < 8) return;

      drag.moved = true;
      panel.style.transform = `translateY(${drag.delta}px)`;
    });

    const finish = event => {
      if (!drag || drag.pointerId !== event.pointerId) return;

      const current = drag;
      drag = null;
      panel.style.transform = "";

      try {
        handle.releasePointerCapture(current.pointerId);
      } catch {
        // Optional.
      }

      if (current.moved) blockClickUntil = now() + 450;

      if (
        event.type !== "pointercancel" &&
        current.delta > Math.min(100, panel.offsetHeight * 0.24)
      ) {
        closePanel();
      }
    };

    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);

    handle.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      if (now() >= blockClickUntil) closePanel();
    });
  }

  /* ------------------------------------------------------------------
   * Launcher
   * ---------------------------------------------------------------- */

  function launcherEnabled() {
    return settings.launcherMode === "full";
  }

  function buildLauncher() {
    launcher = el("button", {
      id: "tmhl-launcher",
      type: "button",
      "data-tmhl-ui": "true",
      "aria-label": "Open highlights",
      "aria-controls": "tmhl-panel"
    });

    launcher.append(
      el("span", { html: ICON.book }),
      el("span", { class: "tmhl-label-count", text: "0" })
    );

    document.body.appendChild(launcher);
    enableLauncherDrag();
    layoutLauncher();
  }

  function layoutLauncher() {
    if (!launcher || launcher.hidden) return;
    if (launcher.classList.contains("tmhl-dragging")) return;

    const viewport = viewportBounds();
    const width = launcher.offsetWidth || 44;
    const height = launcher.offsetHeight || 44;
    const position = settings.launcher || DEFAULT_SETTINGS.launcher;

    const xPct = Number.isFinite(position.xPct) ? position.xPct : 0.93;
    const yPct = Number.isFinite(position.yPct) ? position.yPct : 0.6;
    const margin = isNarrow() ? 2 : 8;

    const desiredLeft = isNarrow()
      ? xPct < 0.5
        ? viewport.left + margin
        : viewport.right - width - margin
      : viewport.left + xPct * viewport.width - width / 2;

    const left = clamp(
      desiredLeft,
      viewport.left + margin,
      Math.max(viewport.left + margin, viewport.right - width - margin)
    );

    const top = clamp(
      viewport.top + yPct * viewport.height - height / 2,
      viewport.top + 8,
      Math.max(viewport.top + 8, viewport.bottom - height - 8)
    );

    launcher.style.left = `${Math.round(left)}px`;
    launcher.style.top = `${Math.round(top)}px`;
  }

  function enableLauncherDrag() {
    let drag = null;
    let ignoreClickUntil = 0;

    launcher.addEventListener("pointerdown", event => {
      if (event.button !== undefined && event.button !== 0) return;

      const box = launcher.getBoundingClientRect();
      drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        grabX: event.clientX - box.left,
        grabY: event.clientY - box.top,
        moved: false
      };

      try {
        launcher.setPointerCapture(event.pointerId);
      } catch {
        // Optional.
      }
    });

    launcher.addEventListener("pointermove", event => {
      if (!drag || event.pointerId !== drag.pointerId) return;

      const travel = Math.hypot(
        event.clientX - drag.startX,
        event.clientY - drag.startY
      );

      if (!drag.moved && travel < (isTouch() ? 10 : 6)) return;

      drag.moved = true;
      launcher.classList.add("tmhl-dragging");

      const viewport = viewportBounds();
      const width = launcher.offsetWidth;
      const height = launcher.offsetHeight;

      const left = clamp(
        event.clientX - drag.grabX,
        viewport.left + 2,
        Math.max(viewport.left + 2, viewport.right - width - 2)
      );

      const top = clamp(
        event.clientY - drag.grabY,
        viewport.top + 8,
        Math.max(viewport.top + 8, viewport.bottom - height - 8)
      );

      launcher.style.left = `${Math.round(left)}px`;
      launcher.style.top = `${Math.round(top)}px`;
    });

    const finish = event => {
      if (!drag || event.pointerId !== drag.pointerId) return;

      const moved = drag.moved;
      const cancelled = event.type === "pointercancel";
      const pointerId = drag.pointerId;
      drag = null;

      try {
        launcher.releasePointerCapture(pointerId);
      } catch {
        // Optional.
      }

      launcher.classList.remove("tmhl-dragging");

      if (moved || cancelled) ignoreClickUntil = now() + 500;

      if (moved && !cancelled) {
        const viewport = viewportBounds();
        const rect = launcher.getBoundingClientRect();

        settings.launcher = {
          xPct: clamp(
            (rect.left + rect.width / 2 - viewport.left) / viewport.width,
            0, 1
          ),
          yPct: clamp(
            (rect.top + rect.height / 2 - viewport.top) / viewport.height,
            0, 1
          )
        };

        saveSettings();
      }

      layoutLauncher();
    };

    launcher.addEventListener("pointerup", finish);
    launcher.addEventListener("pointercancel", finish);

    launcher.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();

      if (now() < ignoreClickUntil) return;
      togglePanel();
    });

    launcher.addEventListener("keydown", event => {
      const direction = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1]
      }[event.key];

      if (!direction) return;

      event.preventDefault();
      event.stopPropagation();

      settings.launcher.xPct = clamp(
        settings.launcher.xPct + direction[0] * 0.05,
        0, 1
      );
      settings.launcher.yPct = clamp(
        settings.launcher.yPct + direction[1] * 0.03,
        0, 1
      );

      saveSettings();
      layoutLauncher();
    });
  }

  function updateLauncher() {
    if (!launcher) return;

    const chatId = currentChatId();
    const count = chatId ? itemsForChat(chatId).length : liveItems().length;

    const label = launcher.querySelector(".tmhl-label-count");
    if (label) label.textContent = count > 99 ? "99+" : String(count);

    launcher.dataset.empty = String(count === 0);
    launcher.title = `Open highlights (${count}). Drag to move.`;
    launcher.setAttribute("aria-label", `Open highlights. ${count} saved.`);
    launcher.setAttribute("aria-expanded", String(view.open));
    launcher.hidden = !launcherEnabled();

    if (!launcher.hidden) layoutLauncher();
    syncLauncherVisibility();
  }

  function bumpLauncher() {
    if (!launcher || launcher.hidden) return;
    launcher.classList.add("tmhl-bump");
    setTimeout(() => launcher.classList.remove("tmhl-bump"), 500);
  }

  /* ------------------------------------------------------------------
   * Mobile sidebar visibility
   * ---------------------------------------------------------------- */

  let visibilityTimer = 0;
  let visibilityObserver = null;
  let visibilityObserverActive = false;
  let visibilityWatcherStarted = false;

  function shouldWatchSidebarVisibility() {
    return Boolean(
      launcherEnabled() &&
      settings.autoHideMobileLauncher &&
      window.innerWidth <= SIDEBAR_BREAKPOINT
    );
  }

  function setLauncherInert(hidden) {
    if (!launcher) return;

    if (hidden) {
      launcher.setAttribute("tabindex", "-1");
      launcher.setAttribute("aria-hidden", "true");
    } else {
      launcher.removeAttribute("tabindex");
      launcher.removeAttribute("aria-hidden");
    }

    if ("inert" in launcher) launcher.inert = hidden;
  }

  function syncLauncherVisibility() {
    if (!launcher) return;

    if (!launcherEnabled()) {
      launcher.hidden = true;
      setLauncherInert(true);
      return;
    }

    launcher.hidden = false;

    const hideForSidebar =
      shouldWatchSidebarVisibility() && !isOnVisibleChatPage();

    const hideForTyping =
      isNarrow() &&
      isTypingTarget(document.activeElement) &&
      !(panel && panel.contains(document.activeElement));

    const hideForToolbar =
      compactToolbar() && toolbar && !toolbar.hidden;

    const hidden = Boolean(
      view.open || hideForSidebar || hideForTyping || hideForToolbar
    );

    launcher.classList.toggle("tmhl-ui-hidden", hidden);
    launcher.setAttribute("aria-expanded", String(view.open));
    setLauncherInert(hidden);
  }

  function scheduleLauncherVisibilityCheck(delay) {
    clearTimeout(visibilityTimer);

    if (!shouldWatchSidebarVisibility()) {
      syncLauncherVisibility();
      return;
    }

    visibilityTimer = setTimeout(() => {
      syncLauncherVisibility();
    }, Number.isFinite(delay) ? delay : 180);
  }

  function elementTouchesSidebar(element) {
    if (!(element instanceof Element)) return false;

    if (
      element === document.body ||
      element === document.documentElement ||
      element.matches(MOBILE_SIDEBAR_SELECTOR) ||
      element.closest(MOBILE_SIDEBAR_SELECTOR)
    ) {
      return true;
    }

    return Boolean(element.querySelector(MOBILE_SIDEBAR_SELECTOR));
  }

  function mutationCouldAffectSidebar(mutation) {
    const target = mutation.target;
    const element = target.nodeType === Node.ELEMENT_NODE
      ? target
      : target.parentElement;

    if (elementTouchesSidebar(element)) return true;
    if (mutation.type !== "childList") return false;

    return [...mutation.addedNodes, ...mutation.removedNodes].some(node =>
      elementTouchesSidebar(
        node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
      )
    );
  }

  function createSidebarVisibilityObserver() {
    if (visibilityObserver) return;

    visibilityObserver = new MutationObserver(mutations => {
      if (!shouldWatchSidebarVisibility()) return;

      const relevant = mutations.some(mutation =>
        !mutationBelongsToHighlighter(mutation) &&
        mutationCouldAffectSidebar(mutation)
      );

      if (relevant) scheduleLauncherVisibilityCheck(120);
    });
  }

  function refreshSidebarVisibilityWatcher() {
    createSidebarVisibilityObserver();

    const shouldObserve =
      Boolean(document.body) && shouldWatchSidebarVisibility();

    if (shouldObserve && !visibilityObserverActive) {
      visibilityObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          "class",
          "style",
          "aria-hidden",
          "aria-expanded",
          "data-state"
        ]
      });
      visibilityObserverActive = true;
    } else if (!shouldObserve && visibilityObserverActive) {
      visibilityObserver.disconnect();
      visibilityObserverActive = false;
    }

    syncLauncherVisibility();
  }

  function startSidebarVisibilityWatcher() {
    if (visibilityWatcherStarted) return;
    visibilityWatcherStarted = true;

    createSidebarVisibilityObserver();

    document.addEventListener("click", () => {
      if (!shouldWatchSidebarVisibility()) return;
      scheduleLauncherVisibilityCheck(100);
      setTimeout(syncLauncherVisibility, 300);
    }, true);

    document.addEventListener("pointerup", () => {
      if (shouldWatchSidebarVisibility()) {
        scheduleLauncherVisibilityCheck(100);
      }
    }, true);

    refreshSidebarVisibilityWatcher();
  }

  /* ------------------------------------------------------------------
   * Global events
   * ---------------------------------------------------------------- */

  function markFromEvent(event) {
    if (!(event.target instanceof Element)) return null;

    const mark = event.target.closest(MARK_SELECTOR);
    return mark && mark.dataset.tmhlId ? mark : null;
  }

  function onDocumentClick(event) {
    if (isToolbarUI(event.target)) return;
    if (panel && panel.contains(event.target)) return;
    if (view.open && isNarrow()) return;

    const selection = getSelection();
    if (selection && !selection.isCollapsed) return;

    const mark = markFromEvent(event);
    if (!mark) return;

    event.preventDefault();
    event.stopPropagation();

    const location = rendered.find(
      item => item.record.id === mark.dataset.tmhlId
    );

    let rect = location
      ? rangeRect(rangeFromOffsets(
          location.root,
          location.start,
          location.end
        ))
      : null;

    if (!rect) {
      const box = mark.getBoundingClientRect();
      rect = {
        top: box.top,
        bottom: box.bottom,
        left: box.left,
        right: box.right,
        width: box.width,
        height: box.height
      };
    }

    showEditToolbar(mark.dataset.tmhlId, rect);
  }

  function onPointerDown(event) {
    if (isToolbarUI(event.target)) return;
    if (panel && panel.contains(event.target)) return;
    if (markFromEvent(event)) return;

    if (toolbar && !toolbar.hidden) hideToolbar();
  }

  function onKeyDown(event) {
    const target = event.target;
    const typing = isTypingTarget(target);

    if (event.key === "Escape") {
      if (panelMenu && !panelMenu.hidden) {
        event.preventDefault();
        event.stopPropagation();
        closePanelMenu(true);
      } else if (toolbarMenu && !toolbarMenu.hidden) {
        event.preventDefault();
        event.stopPropagation();
        closeToolbarMenu(true);
      } else if (toolbarPalette && !toolbarPalette.hidden) {
        event.preventDefault();
        event.stopPropagation();
        closeToolbarPalette(true);
      } else if (view.open && view.editingNote) {
        event.preventDefault();
        event.stopPropagation();
        cancelNoteEdit();
      } else if (toolbar && !toolbar.hidden) {
        event.preventDefault();
        hideToolbar();
      } else if (view.open) {
        event.preventDefault();
        event.stopPropagation();
        closePanel();
      }
      return;
    }

    if (event.altKey && !event.ctrlKey && !event.metaKey) {
      const key = event.key.toLowerCase();

      if (key === "h") {
        if (typing) return;
        event.preventDefault();
        suppressCaptureUntil = 0;
        captureSelection();
        if (captured) commitHighlight(settings.defaultColor);
        return;
      }

      if (key === "l") {
        event.preventDefault();
        togglePanel();
        return;
      }
    }

    if (!typing && toolbar && !toolbar.hidden) {
      const index = Number(event.key) - 1;

      if (index >= 0 && index < COLORS.length) {
        event.preventDefault();
        const color = COLORS[index];

        if (activeId) recolorHighlight(activeId, color);
        else if (captured) commitHighlight(color);

        return;
      }
    }

    if (
      !typing &&
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Shift"]
        .includes(event.key)
    ) {
      scheduleCapture(90);
    }
  }

  function onNavigation() {
    hideToolbar();
    finishNoteEdit(true);
    scheduleTitleRefresh(true);

    if (isNarrow() && view.open) closePanel();

    rendered = [];
    pendingJumpTries = 0;
    bumpTextCache();
    scheduleRestore(320);
    renderPanel();
    refreshSidebarVisibilityWatcher();
    scheduleLauncherVisibilityCheck(80);
    setTimeout(syncLauncherVisibility, 300);
  }

  function onStorage(event) {
    if (event.key === LS_SYNC) {
      cloudGeneration += 1;
      if (cloudController) cloudController.abort();

      syncConfig = loadSyncConfig();
      cloudPaused = false;
      cloudRetryAt = 0;
      cloudAgain = false;

      syncStatus(
        syncConfig ? "Sync pending" : "",
        syncConfig ? "Waiting to sync." : "Sync is off."
      );

      scheduleCloudSync(300);
    }

    if (
      event.key &&
      (
        event.key.startsWith("CHAT_") ||
        event.key === "TM_crossTabLastSynced"
      )
    ) {
      scheduleTitleRefresh(true);
    }

    if (event.key === LS_DATA) {
      store = mergeDocs(store, loadStore()).doc;
      scheduleCloudSync(1800);
      scheduleRestore(40);
      renderPanel();
      updateLauncher();
    }

    if (event.key === LS_SETTINGS) {
      settings = loadSettings();
      updateLauncher();
      refreshSidebarVisibilityWatcher();
      scheduleLauncherVisibilityCheck(0);
    }
  }

  function startBus() {
    if (typeof BroadcastChannel === "undefined") return;

    try {
      bus = new BroadcastChannel(CHANNEL_NAME);

      bus.onmessage = event => {
        if (!event.data || event.data.type !== "changed") return;

        store = mergeDocs(store, loadStore()).doc;
        scheduleCloudSync(1800);
        scheduleRestore(40);
        renderPanel();
        updateLauncher();
      };
    } catch {
      bus = null;
    }
  }

  let viewportFrame = 0;

  function scheduleViewportLayout() {
    if (viewportFrame) return;

    viewportFrame = requestAnimationFrame(() => {
      viewportFrame = 0;

      updatePanelViewport();

      if (toolbar && !toolbar.hidden && !toolbarDragging) {
        const layoutChanged =
          toolbar.dataset.compact !== String(compactToolbar());

        if (layoutChanged) {
          if (activeId) showEditToolbar(activeId, toolbarAnchorRect);
          else if (captured) showCreateToolbar(toolbarAnchorRect);
          else hideToolbar();
        } else {
          positionToolbar(toolbarAnchorRect);
        }
      }

      layoutLauncher();
      layoutToast();
      syncLauncherVisibility();
    });
  }

  /* ------------------------------------------------------------------
   * Initialize
   * ---------------------------------------------------------------- */

  function initialize() {
    if (typeof HTMLDialogElement === "undefined") {
      window[FLAG] = { loaded: false, version: VERSION };
      console.error(
        "[TM Highlighter] This version needs a browser with native dialog support."
      );
      return;
    }

    applyTheme();
    saveSettings();
    injectStyles();

    toolbar = el("div", {
      id: "tmhl-toolbar",
      "data-tmhl-ui": "true",
      role: "toolbar",
      "aria-label": "Highlight controls"
    });
    toolbar.hidden = true;

    toastNode = el("div", {
      id: "tmhl-toast",
      "data-tmhl-ui": "true",
      role: "status",
      "aria-live": "polite",
      "aria-atomic": "true"
    });
    toastNode.hidden = true;

    document.body.append(toolbar, toastNode);

    buildPanel();
    buildLauncher();
    updateLauncher();
    renderPanel();

    document.addEventListener(
      "selectionchange",
      () => scheduleCapture(isTouch() ? 340 : 240),
      true
    );

    document.addEventListener("pointerup", event => {
      if (ownUiNode(event.target)) return;
      scheduleCapture(event.pointerType === "touch" ? 300 : 80);
    }, true);

    document.addEventListener("touchend", event => {
      if (ownUiNode(event.target)) return;
      scheduleCapture(360);
    }, { capture: true, passive: true });

    document.addEventListener("click", onDocumentClick, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);

    document.addEventListener("focusin", () => {
      syncLauncherVisibility();
      scheduleViewportLayout();
    });

    document.addEventListener("focusout", () => {
      setTimeout(() => {
        syncLauncherVisibility();
        scheduleViewportLayout();
      }, 0);
    });

    document.addEventListener("scroll", event => {
      if (ownUiNode(event.target)) return;
      if (
        toolbar &&
        !toolbar.hidden &&
        !toolbarDragging &&
        !settings.toolbar.pinned
      ) {
        hideToolbar();
      }
    }, { capture: true, passive: true });

    window.addEventListener("hashchange", onNavigation);
    window.addEventListener("popstate", onNavigation);
    window.addEventListener("storage", onStorage);

    window.addEventListener("resize", scheduleViewportLayout, { passive: true });
    window.addEventListener("resize", debounce(() => {
      refreshSidebarVisibilityWatcher();
      scheduleLauncherVisibilityCheck(80);
    }, 120));

    if (window.visualViewport) {
      window.visualViewport.addEventListener(
        "resize",
        scheduleViewportLayout,
        { passive: true }
      );
      window.visualViewport.addEventListener(
        "scroll",
        scheduleViewportLayout,
        { passive: true }
      );
    }

    const themeObserver = new MutationObserver(applyTheme);

    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"]
    });

    themeObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ["class", "data-theme"]
    });

    const colorScheme = matchMedia("(prefers-color-scheme: dark)");
    if (typeof colorScheme.addEventListener === "function") {
      colorScheme.addEventListener("change", applyTheme);
    }

    startObserver();
    startBus();
    startSidebarVisibilityWatcher();
    startCloudSync();
    scheduleTitleRefresh(true);
    scheduleRestore(400);

    if (!settings.seenIntro) {
      setTimeout(() => {
        toast("Select text in a reply, then choose Highlight or a color.");
        settings.seenIntro = true;
        saveSettings();
      }, 1600);
    }

    window.TMHighlighter = {
      version: VERSION,

      sync() {
        return syncCloud(true);
      },

      restore() {
        restoreHighlights();
      },

      open() {
        return openPanel();
      },

      close() {
        return closePanel();
      },

      toggle() {
        return togglePanel();
      },

      all() {
        return structuredCopy(liveItems());
      },

      export() {
        return exportJson();
      },

      exportMarkdown(chatId) {
        return exportMarkdown(chatId || null);
      },

      import(input) {
        return importJson(input);
      },

      showButton() {
        settings.launcherMode = "full";
        settings.launcher = { ...DEFAULT_SETTINGS.launcher };
        saveSettings();
        updateLauncher();
        refreshSidebarVisibilityWatcher();
        renderPanel();
        scheduleLauncherVisibilityCheck(0);
        return true;
      },

      resetToolbar() {
        resetToolbarPosition();
        return true;
      },

      autoHideMobileLauncher(enabled) {
        if (typeof enabled === "boolean") {
          settings.autoHideMobileLauncher = enabled;
          saveSettings();
          refreshSidebarVisibilityWatcher();
          scheduleLauncherVisibilityCheck(0);
        }
        return settings.autoHideMobileLauncher;
      },

      clearChat() {
        clearChatHighlights();
      },

      clearAll() {
        clearAllHighlights();
      },

      delete(id) {
        deleteHighlight(id);
      }
    };

    window[FLAG] = { loaded: true, version: VERSION };

    console.info(
      `[TM Highlighter] v${VERSION} ready. Alt+H highlight, Alt+L panel.`
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
