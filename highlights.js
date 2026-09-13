/* =====================================================================
   TypingMind Persistent Highlighter
   Version 3.4.0

   Changes from 3.3.4 (only the two requested fixes):

   1. Chat names now resolve on every device, including phones where the
      sidebar item is not in the DOM. Titles are cached per chat id and
      old highlights saved with a blank title get backfilled.

   2. Optional cross-device sync through a secret GitHub Gist. Turn it on
      in Settings, paste a GitHub token with gist access, and use the same
      Gist ID on each device. Merge is per highlight and uses the existing
      updatedAt / tombstone logic, so nothing is overwritten.

   Everything else is unchanged.
   ===================================================================== */

(() => {
  "use strict";

  const VERSION = "3.4.0";
  const FLAG = "TM_HIGHLIGHTER_V3";

  const rank = (value) =>
    String(value || "0")
      .split(".")
      .reduce((total, part) => total * 1000 + (Number(part) || 0), 0);

  const prior = window[FLAG];

  if (prior && prior.loaded) {
    if (rank(prior.version) < rank(VERSION)) {
      console.warn(
        `[TM Highlighter] v${prior.version} is already running. Reload TypingMind to start v${VERSION}.`
      );
    }
    return;
  }

  window[FLAG] = { loading: true, version: VERSION };

  /* ------------------------------------------------------------------
     Constants
     ---------------------------------------------------------------- */

  const LS_DATA = "tm-highlights-v3";
  const LS_SETTINGS = "tm-highlights-v3-settings";
  const LS_TITLES = "tm-highlights-v3-titles";
  const LS_TOKEN = "tm-highlights-v3-gist-token";
  const LEGACY_KEY = "typingmind-persistent-highlights-v2";
  const CHANNEL_NAME = "tm-highlights-v3-bus";
  const TOMBSTONE_TTL_MS = 45 * 24 * 60 * 60 * 1000;
  const MOBILE_BREAKPOINT = 820;
  const SIDEBAR_BREAKPOINT = 768;

  const GITHUB_API = "https://api.github.com";
  const GIST_FILENAME = "tm-highlights-v3.json";
  const SYNC_PUSH_DELAY_MS = 6000;
  const SYNC_POLL_MS = 3 * 60 * 1000;
  const TITLE_CACHE_LIMIT = 800;
  const UNTITLED = "Untitled chat";
  const WEAK_TITLE = /^(typingmind|new chat|untitled|untitled chat|chat|)$/i;

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

  const CHAT_TITLE_SELECTORS = [
    '[data-element-id="selected-chat-item"]',
    '[data-element-id="chat-title"]',
    '[data-element-id="current-chat-title"]',
    '[data-element-id="chat-space-beginning-part"] h1',
    '[data-element-id="chat-space-beginning-part"] h2'
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
    toolbar: { pinned: false, xPct: 0.5, yPct: 0.35 },
    sync: { enabled: false, gistId: "", lastSyncAt: 0, pushedAt: 0 }
  };

  /* ------------------------------------------------------------------
     Utilities
     ---------------------------------------------------------------- */

  const now = () => Date.now();

  function makeId() {
    if (window.crypto && typeof crypto.randomUUID === "function") {
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
      timer = window.setTimeout(() => fn(...args), wait);
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

    const difference = Math.max(0, now() - stamp);
    const minute = 60000;
    const hour = 60 * minute;
    const day = 24 * hour;

    if (difference < minute) return "just now";
    if (difference < hour) return `${Math.floor(difference / minute)}m ago`;
    if (difference < day) return `${Math.floor(difference / hour)}h ago`;
    if (difference < 7 * day) return `${Math.floor(difference / day)}d ago`;

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

  function isOnVisibleChatPage() {
    const hasChat = CHAT_SIGNAL_SELECTORS.some((selector) =>
      Boolean(document.querySelector(selector))
    );

    if (!hasChat) return false;

    if (window.innerWidth <= SIDEBAR_BREAKPOINT) {
      for (const selector of MOBILE_SIDEBAR_SELECTORS) {
        const sidebar = document.querySelector(selector);

        if (!sidebar) continue;

        const style = window.getComputedStyle(sidebar);
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
      try {
        const area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("data-tmhl-ui", "true");
        area.style.position = "fixed";
        area.style.opacity = "0";

        document.body.appendChild(area);
        area.select();

        const success = document.execCommand("copy");
        area.remove();

        return success;
      } catch {
        return false;
      }
    }
  }

  function downloadFile(name, text, mime) {
    const blob = new Blob([text], { type: mime || "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = name;

    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
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
          node.innerHTML = value;
        } else if (key.startsWith("on") && typeof value === "function") {
          node.addEventListener(key.slice(2).toLowerCase(), value);
        } else {
          node.setAttribute(key, value);
        }
      });
    }

    (children || []).forEach((child) => {
      if (child) node.appendChild(child);
    });

    return node;
  }

  /* ------------------------------------------------------------------
     Settings
     ---------------------------------------------------------------- */

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
        },
        sync: {
          ...DEFAULT_SETTINGS.sync,
          ...(parsed.sync || {})
        }
      };

      if (!parsed.settingsVersion) {
        merged.launcherMode = parsed.showLauncher === false ? "off" : "full";
        delete merged.showLauncher;
      } else if (merged.launcherMode === "mini") {
        merged.launcherMode = "off";
      }

      if (merged.launcherMode !== "off") {
        merged.launcherMode = "full";
      }

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

      const syncSettings = merged.sync || {};

      merged.sync = {
        enabled: Boolean(syncSettings.enabled),
        gistId:
          typeof syncSettings.gistId === "string"
            ? syncSettings.gistId.trim()
            : "",
        lastSyncAt: Number.isFinite(syncSettings.lastSyncAt)
          ? syncSettings.lastSyncAt
          : 0,
        pushedAt: Number.isFinite(syncSettings.pushedAt)
          ? syncSettings.pushedAt
          : 0
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
     Store
     ---------------------------------------------------------------- */

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
      chatTitle: record.chatTitle || "",
      color: COLORS.includes(record.color) ? record.color : "yellow",
      exact: record.exact,
      note: typeof record.note === "string" ? record.note : "",
      prefix: record.prefix || "",
      suffix: record.suffix || "",
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
    return store.items.filter((item) => !item.deleted);
  }

  function itemsForChat(chatId) {
    if (!chatId) return [];
    return liveItems().filter((item) => item.chatId === chatId);
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
        store.items.some((item) => !item.deleted && item.chatId === chatId)
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
    return store.items.find((item) => item.id === id) || null;
  }

  function pruneTombstones() {
    const cutoff = now() - TOMBSTONE_TTL_MS;
    const before = store.items.length;

    store.items = store.items.filter(
      (item) => !item.deleted || item.updatedAt > cutoff
    );

    return store.items.length !== before;
  }

  function persist(options) {
    const preferences = options || {};
    store.updatedAt = now();
    chatHighlightCache.store = null;

    try {
      localStorage.setItem(LS_DATA, JSON.stringify(store));
    } catch (error) {
      console.error("[TM Highlighter] Save failed.", error);
      toast("Storage is full. Export and clear old highlights.");
      return false;
    }

    if (bus && !preferences.silentBus) {
      try {
        bus.postMessage({ type: "changed", at: store.updatedAt });
      } catch {
        /* Ignore channel errors. */
      }
    }

    renderPanel();
    updateLauncher();

    if (!preferences.skipPush) scheduleSyncPush();

    return true;
  }

  function mergeDocs(local, remote) {
    const byId = new Map();
    local.items.forEach((item) => byId.set(item.id, item));
    let changed = false;

    (remote.items || []).filter(validRecord).forEach((raw) => {
      const incoming = normalizeRecord(raw);
      const current = byId.get(incoming.id);

      if (!current || incoming.updatedAt > current.updatedAt) {
        byId.set(incoming.id, incoming);
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

  /* ------------------------------------------------------------------
     Chat context
     ---------------------------------------------------------------- */

  let chatTitles = loadTitles();

  function loadTitles() {
    try {
      const raw = localStorage.getItem(LS_TITLES);
      if (!raw) return {};

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return {};

      const cleaned = {};

      Object.entries(parsed).forEach(([key, value]) => {
        if (typeof value === "string" && value) cleaned[key] = value;
      });

      return cleaned;
    } catch {
      return {};
    }
  }

  function saveTitles() {
    try {
      const keys = Object.keys(chatTitles);

      if (keys.length > TITLE_CACHE_LIMIT) {
        keys
          .slice(0, keys.length - TITLE_CACHE_LIMIT)
          .forEach((key) => delete chatTitles[key]);
      }

      localStorage.setItem(LS_TITLES, JSON.stringify(chatTitles));
    } catch (error) {
      console.warn("[TM Highlighter] Chat titles not cached.", error);
    }
  }

  function cleanTitle(text) {
    if (!text) return "";
    return String(text).replace(/\s+/g, " ").trim().slice(0, 120);
  }

  function strongTitle(text) {
    const cleaned = cleanTitle(text);
    if (!cleaned) return "";
    if (WEAK_TITLE.test(cleaned)) return "";
    return cleaned;
  }

  function rememberChatTitle(chatId, title) {
    const strong = strongTitle(title);

    if (!chatId || !strong) return false;
    if (chatTitles[chatId] === strong) return false;

    chatTitles[chatId] = strong;
    saveTitles();
    return true;
  }

  function currentChatId() {
    const match = window.location.href.match(/(?:#|[?&])chat=([^&?#]+)/);

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

  function titleFromDocument() {
    const raw = (document.title || "").replace(
      /\s*[|·•\-–]\s*TypingMind.*$/i,
      ""
    );

    return cleanTitle(raw);
  }

  function titleFromSidebarLink(chatId) {
    if (!chatId) return "";

    let encoded = chatId;

    try {
      encoded = encodeURIComponent(chatId);
    } catch {
      encoded = chatId;
    }

    const selectors = [
      `a[href$="#chat=${encoded}"]`,
      `a[href*="#chat=${encoded}"]`,
      `a[href*="#chat=${chatId}"]`,
      `[data-chat-id="${chatId}"]`
    ];

    for (const selector of selectors) {
      let node = null;

      try {
        node = document.querySelector(selector);
      } catch {
        node = null;
      }

      if (!node) continue;
      if (node.closest("[data-tmhl-ui]")) continue;

      const text = cleanTitle(node.textContent);
      if (text) return text;
    }

    return "";
  }

  function titleFromHeader() {
    for (const selector of CHAT_TITLE_SELECTORS) {
      let node = null;

      try {
        node = document.querySelector(selector);
      } catch {
        node = null;
      }

      if (!node) continue;
      if (node.closest("[data-tmhl-ui]")) continue;

      const text = cleanTitle(node.textContent);
      if (text) return text;
    }

    return "";
  }

  function resolveChatTitle(chatId) {
    const id = chatId || currentChatId();
    const isCurrent = Boolean(id) && id === currentChatId();
    let weak = "";

    const consider = (candidate) => {
      const cleaned = cleanTitle(candidate);
      if (!cleaned) return "";

      if (WEAK_TITLE.test(cleaned)) {
        if (!weak) weak = cleaned;
        return "";
      }

      return cleaned;
    };

    /* 1. The sidebar entry for this exact chat, if it is in the DOM. */
    const fromLink = consider(titleFromSidebarLink(id));

    if (fromLink) {
      rememberChatTitle(id, fromLink);
      return fromLink;
    }

    /* 2. Header or selected item, only trusted for the open chat. */
    if (isCurrent) {
      const fromHeader = consider(titleFromHeader());

      if (fromHeader) {
        rememberChatTitle(id, fromHeader);
        return fromHeader;
      }

      /* 3. The browser tab title. This is the one that works on phones. */
      const fromDocument = consider(titleFromDocument());

      if (fromDocument) {
        rememberChatTitle(id, fromDocument);
        return fromDocument;
      }
    }

    /* 4. Anything this or another device already saw for this chat. */
    if (id && chatTitles[id]) return chatTitles[id];

    return weak || UNTITLED;
  }

  function currentChatTitle() {
    return resolveChatTitle(currentChatId());
  }

  function titleForRecord(record) {
    const stored = cleanTitle(record.chatTitle);

    if (stored && !WEAK_TITLE.test(stored)) return stored;
    if (record.chatId && chatTitles[record.chatId]) {
      return chatTitles[record.chatId];
    }

    return stored;
  }

  function backfillChatTitles(chatId) {
    if (!chatId) return false;

    const title = strongTitle(resolveChatTitle(chatId));
    if (!title) return false;

    let changed = false;

    store.items.forEach((item) => {
      if (item.chatId !== chatId) return;

      const current = cleanTitle(item.chatTitle);
      if (current && !WEAK_TITLE.test(current)) return;
      if (current === title) return;

      item.chatTitle = title;
      item.updatedAt = now();
      changed = true;
    });

    return changed;
  }

  let titleTimer = 0;

  function scheduleTitleCapture(delay) {
    window.clearTimeout(titleTimer);

    titleTimer = window.setTimeout(() => {
      titleTimer = 0;

      const chatId = currentChatId();
      if (!chatId) return;

      resolveChatTitle(chatId);

      if (backfillChatTitles(chatId)) persist();
    }, Number.isFinite(delay) ? delay : 500);
  }

  /* ------------------------------------------------------------------
     Text mapping
     ---------------------------------------------------------------- */

  let textCacheGen = 0;
  const textCache = new WeakMap();

  function bumpTextCache() {
    textCacheGen += 1;
  }

  function getResponseRoots() {
    const container =
      document.querySelector(".dynamic-chat-content-container") || document;

    for (const selector of ROOT_SELECTORS) {
      const found = Array.from(container.querySelectorAll(selector)).filter(
        (node) =>
          node.isConnected &&
          !(node.parentElement && node.parentElement.closest(selector))
      );

      if (found.length) return found;
    }

    return [];
  }

  function rootFromNode(node) {
    if (!node) return null;

    const element =
      node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;

    if (!element) return null;

    for (const selector of ROOT_SELECTORS) {
      const found = element.closest(selector);
      if (found) return found;
    }

    return null;
  }

  function getTextNodes(root) {
    const cached = textCache.get(root);

    if (cached && cached.gen === textCacheGen) return cached.nodes;

    const nodes = [];

    if (root) {
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
    }

    textCache.set(root, { gen: textCacheGen, nodes });
    return nodes;
  }

  function rootText(root) {
    return getTextNodes(root)
      .map((node) => node.data)
      .join("");
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

    const start = offsetOfPoint(root, range.startContainer, range.startOffset);
    const end = offsetOfPoint(root, range.endContainer, range.endOffset);

    if (start === null || end === null || end <= start) return null;
    return { start, end };
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
          offset: clamp(target - total, 0, length)
        };
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

    const rects = Array.from(range.getClientRects()).filter(
      (rect) => rect.width > 0 || rect.height > 0
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
    const exact = findAll(info.text, record.exact).map((start) => ({
      start,
      end: start + record.exact.length,
      penalty: 0
    }));

    if (exact.length) return exact;

    const target = normalizeWithMap(record.exact).out.trim();
    if (target.length < 4) return [];

    const source = normalizeWithMap(info.text);

    return findAll(source.out, target, 40).map((normalizedStart) => ({
      start: source.map[normalizedStart],
      end:
        source.map[
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

        score -= Math.min(Math.abs(candidate.start - record.start), 10000) / 100;

        if (!best || score > best.score) {
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
     Rendering marks
     ---------------------------------------------------------------- */

  let rendered = [];
  let applying = false;
  let observer = null;
  let restoreTimer = 0;
  let pendingJump = null;
  let pendingJumpTries = 0;
  let suppressCardClickUntil = 0;

  function marksById(id) {
    return Array.from(document.querySelectorAll(MARK_SELECTOR)).filter(
      (mark) => mark.dataset.tmhlId === id
    );
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

  function clearMarks(predicate) {
    const marks = Array.from(document.querySelectorAll(MARK_SELECTOR));
    if (!marks.length) return;

    withObserverPaused(() => {
      marks.forEach((mark) => {
        if (!predicate || predicate(mark)) unwrapMark(mark);
      });
    });

    bumpTextCache();
  }

  function withObserverPaused(fn) {
    applying = true;
    if (observer) observer.disconnect();

    try {
      fn();
    } finally {
      applying = false;

      if (observer) {
        window.setTimeout(() => {
          observer.takeRecords();
          observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
          });
        }, 0);
      }
    }
  }

  function segmentAttr(index, count) {
    if (count <= 1) return "solo";
    if (index === 0) return "first";
    if (index === count - 1) return "last";
    return "mid";
  }

  function wrapRange(root, start, end, record) {
    const nodes = getTextNodes(root);
    const segments = [];
    let total = 0;

    for (const node of nodes) {
      const nodeStart = total;
      const nodeEnd = total + node.data.length;
      const localStart = Math.max(0, start - nodeStart);
      const localEnd = Math.min(node.data.length, end - nodeStart);

      if (localStart < localEnd && nodeEnd > start && nodeStart < end) {
        if (node.parentElement && node.parentElement.closest(MARK_SELECTOR)) {
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

    resolveChatTitle(chatId);

    const records = itemsForChat(chatId);

    if (records.length && backfillChatTitles(chatId)) persist();

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
      .map((record) => resolveRecord(record, rootInfo))
      .filter(Boolean);

    rendered = locations;

    const wanted = new Set(locations.map((item) => item.record.id));

    clearMarks(
      (mark) =>
        mark.dataset.tmhlChat !== chatId || !wanted.has(mark.dataset.tmhlId)
    );

    for (const location of locations) {
      const existing = marksById(location.record.id);

      if (existing.length) {
        existing.forEach((mark, index) => {
          mark.dataset.color = location.record.color;
          mark.dataset.seg = segmentAttr(index, existing.length);

          if (location.record.note) {
            mark.dataset.note = "1";
          } else {
            delete mark.dataset.note;
          }

          mark.title = location.record.note || "";
        });
        continue;
      }

      wrapRange(location.root, location.start, location.end, location.record);
    }

    updateLauncher();
    tryPendingJump();
  }

  function scheduleRestore(delay) {
    window.clearTimeout(restoreTimer);
    restoreTimer = window.setTimeout(restoreHighlights, delay || 180);
  }

  function flashMark(id) {
    const marks = marksById(id);
    if (!marks.length) return false;

    marks.forEach((mark) => {
      mark.classList.remove("tmhl-flash");
      void mark.offsetWidth;
      mark.classList.add("tmhl-flash");

      window.setTimeout(() => mark.classList.remove("tmhl-flash"), 1600);
    });

    marks[0].scrollIntoView({ behavior: "smooth", block: "center" });
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

    window.setTimeout(() => scheduleRestore(60), 450);
  }

  function jumpTo(record) {
    if (!record || record.deleted || !record.chatId) return;

    if (record.chatId !== currentChatId()) {
      pendingJump = record.id;
      pendingJumpTries = 0;
      window.location.hash = `#chat=${encodeURIComponent(record.chatId)}`;
      scheduleRestore(500);

      if (isNarrow()) closePanel();
      return;
    }

    if (!flashMark(record.id)) {
      pendingJump = record.id;
      pendingJumpTries = 0;
      scheduleRestore(60);
    }

    if (isNarrow()) closePanel();
  }

  /* ------------------------------------------------------------------
     Message observer
     ---------------------------------------------------------------- */

  function startObserver() {
    observer = new MutationObserver((records) => {
      if (applying) return;

      const relevant = records.some((record) => {
        const target = record.target;
        const node =
          target && target.nodeType === Node.ELEMENT_NODE
            ? target
            : target && target.parentElement;

        return !(node && node.closest("[data-tmhl-ui]"));
      });

      if (!relevant) return;

      bumpTextCache();

      const chatId = currentChatId();
      if (!currentChatHasHighlights(chatId)) return;

      scheduleRestore(260);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  /* ------------------------------------------------------------------
     Theme
     ---------------------------------------------------------------- */

  function applyTheme() {
    const dark =
      document.documentElement.classList.contains("dark") ||
      document.body.classList.contains("dark") ||
      window.matchMedia("(prefers-color-scheme: dark)").matches;

    document.documentElement.setAttribute(
      "data-tmhl-theme",
      dark ? "dark" : "light"
    );
  }

  /* ------------------------------------------------------------------
     Styles
     ---------------------------------------------------------------- */

  function injectStyles() {
    const existing = document.getElementById("tmhl-styles");
    if (existing) existing.remove();

    const style = document.createElement("style");
    style.id = "tmhl-styles";
    style.textContent = `
:root[data-tmhl-theme="light"] {
  --tmhl-yellow: rgba(250, 204, 21, .40);
  --tmhl-yellow-2: rgba(202, 138, 4, .55);
  --tmhl-green: rgba(34, 197, 94, .30);
  --tmhl-green-2: rgba(21, 128, 61, .50);
  --tmhl-blue: rgba(59, 130, 246, .28);
  --tmhl-blue-2: rgba(29, 78, 216, .48);
  --tmhl-pink: rgba(236, 72, 153, .26);
  --tmhl-pink-2: rgba(190, 24, 93, .48);
  --tmhl-purple: rgba(168, 85, 247, .26);
  --tmhl-purple-2: rgba(126, 34, 206, .48);
  --tmhl-surface: rgba(255, 255, 255, .94);
  --tmhl-surface-solid: #ffffff;
  --tmhl-raised: rgba(0, 0, 0, .035);
  --tmhl-raised-2: rgba(0, 0, 0, .07);
  --tmhl-border: rgba(9, 9, 11, .12);
  --tmhl-border-soft: rgba(9, 9, 11, .07);
  --tmhl-text: #18181b;
  --tmhl-muted: #71717a;
  --tmhl-glint: rgba(255, 255, 255, .88);
  --tmhl-shadow: 0 24px 60px rgba(9, 9, 11, .16), 0 2px 8px rgba(9, 9, 11, .07);
  --tmhl-toolbar-shadow: 0 14px 34px rgba(24, 24, 27, .14), 0 3px 9px rgba(24, 24, 27, .08);
  --tmhl-menu-shadow: 0 20px 44px rgba(24, 24, 27, .18), 0 3px 10px rgba(24, 24, 27, .08);
}

:root[data-tmhl-theme="dark"] {
  --tmhl-yellow: rgba(250, 204, 21, .26);
  --tmhl-yellow-2: rgba(250, 204, 21, .48);
  --tmhl-green: rgba(74, 222, 128, .22);
  --tmhl-green-2: rgba(74, 222, 128, .42);
  --tmhl-blue: rgba(96, 165, 250, .26);
  --tmhl-blue-2: rgba(96, 165, 250, .46);
  --tmhl-pink: rgba(244, 114, 182, .24);
  --tmhl-pink-2: rgba(244, 114, 182, .44);
  --tmhl-purple: rgba(192, 132, 252, .24);
  --tmhl-purple-2: rgba(192, 132, 252, .44);
  --tmhl-surface: rgba(24, 24, 27, .94);
  --tmhl-surface-solid: #18181b;
  --tmhl-raised: rgba(255, 255, 255, .05);
  --tmhl-raised-2: rgba(255, 255, 255, .1);
  --tmhl-border: rgba(255, 255, 255, .13);
  --tmhl-border-soft: rgba(255, 255, 255, .08);
  --tmhl-text: #f4f4f5;
  --tmhl-muted: #a1a1aa;
  --tmhl-glint: rgba(255, 255, 255, .075);
  --tmhl-shadow: 0 24px 60px rgba(0, 0, 0, .5), 0 2px 8px rgba(0, 0, 0, .35);
  --tmhl-toolbar-shadow: 0 16px 38px rgba(0, 0, 0, .52), 0 3px 10px rgba(0, 0, 0, .34);
  --tmhl-menu-shadow: 0 22px 52px rgba(0, 0, 0, .62), 0 3px 12px rgba(0, 0, 0, .4);
}

/* Highlighted text */
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
mark.tmhl-mark:hover { background-color: var(--c2) !important; }
mark.tmhl-mark.tmhl-flash { animation: tmhl-flash 1.5s ease; }

@keyframes tmhl-flash {
  0%, 100% { box-shadow: 0 0 0 .1em var(--c); }
  15%, 55% { box-shadow: 0 0 0 .22em var(--c2); }
}

/* Shared UI */
#tmhl-toolbar,
#tmhl-panel,
#tmhl-launcher,
#tmhl-toast {
  font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  color: var(--tmhl-text);
  box-sizing: border-box;
}

#tmhl-panel *, #tmhl-toolbar * { box-sizing: border-box; }
#tmhl-panel button,
#tmhl-panel input,
#tmhl-panel textarea,
#tmhl-toolbar button { font-family: inherit; }

/* Vertical floating toolbar */
#tmhl-toolbar {
  position: fixed;
  z-index: 2147483646;
  width: 40px;
  max-height: calc(100vh - 16px);
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border: 1px solid var(--tmhl-border);
  border-radius: 13px;
  background: linear-gradient(180deg, var(--tmhl-glint), transparent 56%), var(--tmhl-surface);
  backdrop-filter: blur(20px) saturate(165%);
  -webkit-backdrop-filter: blur(20px) saturate(165%);
  box-shadow: var(--tmhl-toolbar-shadow);
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
  isolation: isolate;
  overflow: visible;
  animation: tmhl-enter .16s ease-out;
}

#tmhl-toolbar[hidden] { display: none !important; }

@keyframes tmhl-enter {
  from { opacity: 0; filter: blur(2px); }
  to { opacity: 1; filter: none; }
}

.tmhl-color-rail {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  width: 100%;
}

.tmhl-toolbar-grip,
.tmhl-toolbar-more {
  flex: 0 0 auto;
  width: 30px;
  height: 27px;
  min-width: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--tmhl-muted);
  cursor: pointer;
  transition: color .14s ease, background-color .14s ease, transform .14s ease;
}

.tmhl-toolbar-grip { cursor: grab; touch-action: none; }
.tmhl-toolbar-grip:hover,
.tmhl-toolbar-more:hover { color: var(--tmhl-text); background: var(--tmhl-raised-2); }
.tmhl-toolbar-grip:active { cursor: grabbing; }
.tmhl-toolbar-grip svg { width: 9px; height: 14px; }
.tmhl-toolbar-more svg { width: 16px; height: 16px; }
.tmhl-toolbar-more[aria-expanded="true"] { color: var(--tmhl-text); background: var(--tmhl-raised-2); }

#tmhl-toolbar.tmhl-dragging {
  cursor: grabbing;
  animation: none;
  box-shadow: 0 20px 48px rgba(0, 0, 0, .24), 0 4px 12px rgba(0, 0, 0, .16);
}

.tmhl-swatch {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  padding: 0;
}

.tmhl-swatch::before {
  content: "";
  width: 17px;
  height: 17px;
  border-radius: 5px;
  background: var(--sw);
  box-shadow: inset 0 0 0 1px var(--tmhl-border), 0 0 0 2px transparent;
  transition: transform .12s ease, box-shadow .12s ease;
}

.tmhl-swatch:hover::before { transform: translateY(-1px); }
.tmhl-swatch[aria-pressed="true"]::before {
  box-shadow: inset 0 0 0 1px var(--tmhl-border), 0 0 0 2px var(--tmhl-text);
}

.tmhl-color-rail > .tmhl-swatch {
  width: 30px;
  height: 27px;
  min-width: 30px;
  border-radius: 6px;
  background: transparent !important;
}

.tmhl-color-rail > .tmhl-swatch::before {
  width: 18px;
  height: 10px;
  border-radius: 4px 2px 3px 2px;
  transform: rotate(-8deg);
  box-shadow: inset 0 0 0 1px var(--tmhl-border), 0 1px 2px rgba(0, 0, 0, .1);
  transition: transform .14s ease, box-shadow .14s ease;
}

.tmhl-color-rail > .tmhl-swatch:hover { background: transparent !important; }
.tmhl-color-rail > .tmhl-swatch:hover::before { transform: rotate(-8deg) translateX(2px); }
.tmhl-color-rail > .tmhl-swatch[aria-pressed="true"] { background: transparent !important; }
.tmhl-color-rail > .tmhl-swatch[aria-pressed="true"]::before {
  transform: rotate(-8deg);
  box-shadow: inset 0 0 0 1px var(--tmhl-border), 0 0 0 2px var(--tmhl-surface-solid), 0 0 0 3px var(--tmhl-text);
}

.tmhl-tool {
  height: 30px;
  min-width: 30px;
  padding: 0 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--tmhl-text);
  cursor: pointer;
  font-size: 12px;
  font-weight: 550;
  line-height: 1;
}

.tmhl-tool:hover { background: var(--tmhl-raised-2); }
.tmhl-tool.tmhl-danger { color: #f87171; }
.tmhl-tool svg { width: 15px; height: 15px; }

.tmhl-toolbar-menu {
  position: absolute;
  top: 0;
  left: calc(100% + 8px);
  right: auto;
  width: max-content;
  min-width: 178px;
  max-width: min(220px, calc(100vw - 16px));
  display: grid;
  gap: 2px;
  padding: 6px;
  border: 1px solid var(--tmhl-border);
  border-radius: 15px;
  background: linear-gradient(180deg, var(--tmhl-glint), transparent 42%), var(--tmhl-surface);
  box-shadow: var(--tmhl-menu-shadow);
  backdrop-filter: blur(22px) saturate(165%);
  -webkit-backdrop-filter: blur(22px) saturate(165%);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transform: translateX(-5px) scale(.975);
  transform-origin: top left;
  transition: opacity .14s ease, transform .14s cubic-bezier(.2, .8, .25, 1), visibility 0s linear .15s;
}

.tmhl-toolbar-menu.tmhl-open {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  transform: none;
  transition-delay: 0s;
}

.tmhl-toolbar-menu.tmhl-menu-left {
  left: auto;
  right: calc(100% + 8px);
  transform-origin: top right;
}

.tmhl-toolbar-menu > .tmhl-tool {
  width: 100%;
  min-width: 0;
  height: 36px;
  display: flex;
  justify-content: flex-start;
  gap: 9px;
  padding: 0 10px;
  border-radius: 9px;
  color: var(--tmhl-text);
  font-size: 12.5px;
  font-weight: 590;
  white-space: nowrap;
  text-align: left;
}

.tmhl-toolbar-menu > .tmhl-tool:hover { background: var(--tmhl-raised-2); }
.tmhl-toolbar-menu > .tmhl-tool svg {
  width: 15px;
  height: 15px;
  flex: 0 0 15px;
  color: var(--tmhl-muted);
}
.tmhl-toolbar-menu > .tmhl-tool::after {
  content: attr(data-tmhl-label);
  overflow: hidden;
  text-overflow: ellipsis;
}
.tmhl-toolbar-menu > .tmhl-tool.tmhl-danger,
.tmhl-toolbar-menu > .tmhl-tool.tmhl-danger svg { color: #f87171; }

/* Focus */
.tmhl-toolbar-grip:focus-visible,
.tmhl-toolbar-more:focus-visible,
.tmhl-swatch:focus-visible,
.tmhl-tool:focus-visible,
.tmhl-act:focus-visible,
.tmhl-btn:focus-visible,
.tmhl-chip:focus-visible,
.tmhl-switch:focus-visible,
.tmhl-search:focus-visible,
.tmhl-noteedit:focus-visible {
  outline: 2px solid var(--tmhl-text);
  outline-offset: 2px;
}

/* Launcher */
#tmhl-launcher {
  position: fixed;
  left: 0;
  top: 0;
  z-index: 2147483640;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 34px;
  padding: 0 11px;
  border: 1px solid var(--tmhl-border);
  border-radius: 10px;
  background: var(--tmhl-surface);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow: var(--tmhl-shadow);
  color: var(--tmhl-text);
  font-size: 12px;
  font-weight: 600;
  cursor: grab;
  opacity: .5;
  touch-action: none;
  visibility: visible;
  transform: none;
  transition: opacity .2s ease, transform .2s ease, box-shadow .18s ease, visibility 0s linear 0s;
}

#tmhl-launcher:hover { opacity: .82; transform: none; }
#tmhl-launcher[hidden] { display: none !important; }
#tmhl-launcher.tmhl-mini {
  width: 27px;
  height: 27px;
  padding: 0;
  gap: 0;
  border-radius: 8px;
  opacity: .34;
}
#tmhl-launcher.tmhl-mini .tmhl-label-count { display: none; }
#tmhl-launcher.tmhl-mini .tmhl-dot { width: 8px; height: 8px; border-radius: 2px; }
#tmhl-launcher.tmhl-mini:hover { opacity: .72; transform: none; }
#tmhl-launcher.tmhl-dragging {
  cursor: grabbing;
  opacity: 1;
  transform: none;
  box-shadow: 0 12px 28px rgba(0, 0, 0, .34);
  transition: none;
}
#tmhl-launcher .tmhl-dot {
  width: 9px;
  height: 9px;
  border-radius: 2px;
  background: var(--tmhl-yellow-2);
}
#tmhl-launcher.tmhl-bump { animation: tmhl-bump .4s ease; }
#tmhl-launcher.tmhl-panel-open,
#tmhl-launcher.tmhl-native-sidebar-open {
  opacity: 0 !important;
  visibility: hidden !important;
  pointer-events: none !important;
  transform: translateY(-6px) scale(.9) !important;
  transition: opacity .25s ease, transform .25s ease, visibility 0s linear .25s;
}

@keyframes tmhl-bump {
  0% { transform: none; }
  40% { opacity: 1; }
  100% { transform: none; }
}

/* Panel */
#tmhl-scrim {
  position: fixed;
  inset: 0;
  z-index: 2147483643;
  background: rgba(0, 0, 0, .34);
  backdrop-filter: blur(2px);
  opacity: 0;
  pointer-events: none;
  transition: opacity .22s ease;
}

#tmhl-scrim.tmhl-open { opacity: 1; pointer-events: auto; }

#tmhl-panel {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(400px, 100vw);
  z-index: 2147483644;
  display: flex;
  flex-direction: column;
  background: var(--tmhl-surface-solid);
  border-left: 1px solid var(--tmhl-border);
  box-shadow: var(--tmhl-shadow);
  transform: translateX(102%);
  transition: transform .26s cubic-bezier(.32, .72, 0, 1);
}

#tmhl-panel.tmhl-open { transform: none; }

.tmhl-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 14px 10px;
  border-bottom: 1px solid var(--tmhl-border-soft);
}

.tmhl-title {
  font-size: 14px;
  font-weight: 680;
  letter-spacing: -.01em;
  margin-right: auto;
}

.tmhl-count {
  font-size: 11px;
  font-weight: 600;
  color: var(--tmhl-muted);
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--tmhl-raised);
}

.tmhl-controls { padding: 10px 14px; display: grid; gap: 9px; }
.tmhl-search {
  width: 100%;
  height: 34px;
  padding: 0 11px;
  border: 1px solid var(--tmhl-border);
  border-radius: 10px;
  background: var(--tmhl-raised);
  color: var(--tmhl-text);
  font-size: 13px;
  outline: none;
}
.tmhl-search:focus { border-color: var(--tmhl-muted); }
.tmhl-search::placeholder { color: var(--tmhl-muted); }
.tmhl-filters { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

.tmhl-chip {
  height: 26px;
  padding: 0 9px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--tmhl-border-soft);
  border-radius: 999px;
  background: transparent;
  color: var(--tmhl-muted);
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
}

.tmhl-chip:hover { background: var(--tmhl-raised); }
.tmhl-chip[aria-pressed="true"] {
  color: var(--tmhl-text);
  background: var(--tmhl-raised-2);
  border-color: var(--tmhl-border);
}
.tmhl-chip i {
  width: 9px;
  height: 9px;
  border-radius: 3px;
  background: var(--sw);
  display: block;
}

.tmhl-list {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 4px 12px 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  -webkit-overflow-scrolling: touch;
}

.tmhl-card {
  position: relative;
  padding: 11px 12px 10px 14px;
  border: 1px solid var(--tmhl-border-soft);
  border-radius: 12px;
  background: var(--tmhl-raised);
  cursor: pointer;
  transition: background .14s ease, border-color .14s ease, transform .14s ease;
}

.tmhl-card:hover { background: var(--tmhl-raised-2); border-color: var(--tmhl-border); }
.tmhl-card:active { transform: scale(.995); }
.tmhl-card::before {
  content: "";
  position: absolute;
  left: 0;
  top: 10px;
  bottom: 10px;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--rail);
}

.tmhl-quote {
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 400;
  line-height: 1.5;
  letter-spacing: 0;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.tmhl-card[data-expanded="1"] .tmhl-quote { -webkit-line-clamp: unset; }
.tmhl-note {
  margin-top: 7px;
  padding: 6px 8px;
  border-left: 2px solid var(--rail);
  border-radius: 0 6px 6px 0;
  background: var(--tmhl-raised-2);
  font-size: 12px;
  line-height: 1.45;
  color: var(--tmhl-text);
  white-space: pre-wrap;
}

.tmhl-meta {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
  color: var(--tmhl-muted);
}
.tmhl-meta .tmhl-time,
.tmhl-meta .tmhl-sep { flex: 0 0 auto; }
.tmhl-meta .tmhl-chat {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1 1 auto;
  min-width: 0;
}
.tmhl-actions { margin-left: auto; display: flex; gap: 2px; flex: 0 0 auto; }
.tmhl-act {
  width: 26px;
  height: 26px;
  padding: 0;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--tmhl-muted);
  cursor: pointer;
}
.tmhl-act:hover { background: var(--tmhl-raised-2); color: var(--tmhl-text); }
.tmhl-act.tmhl-danger:hover { color: #f87171; }
.tmhl-act svg { width: 14px; height: 14px; }

.tmhl-noteedit {
  margin-top: 8px;
  width: 100%;
  min-height: 62px;
  resize: vertical;
  padding: 8px 9px;
  border: 1px solid var(--tmhl-border);
  border-radius: 9px;
  background: var(--tmhl-surface-solid);
  color: var(--tmhl-text);
  font-size: 12.5px;
  line-height: 1.45;
  font-family: inherit;
  outline: none;
}

.tmhl-empty {
  margin: 34px 10px;
  text-align: center;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--tmhl-muted);
}
.tmhl-empty b {
  display: block;
  color: var(--tmhl-text);
  font-size: 13.5px;
  margin-bottom: 5px;
}

.tmhl-foot {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 10px 12px calc(10px + env(safe-area-inset-bottom, 0px));
  border-top: 1px solid var(--tmhl-border-soft);
  background: var(--tmhl-surface-solid);
}
.tmhl-foot .tmhl-status { margin-left: auto; font-size: 11px; color: var(--tmhl-muted); }
.tmhl-btn {
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--tmhl-border-soft);
  border-radius: 8px;
  background: transparent;
  color: var(--tmhl-text);
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
}
.tmhl-btn:hover { background: var(--tmhl-raised-2); }
.tmhl-btn.tmhl-danger { color: #f87171; }

.tmhl-settings { padding: 4px 14px 18px; overflow-y: auto; flex: 1; }
.tmhl-field { margin-bottom: 13px; }
.tmhl-label {
  display: block;
  margin-bottom: 5px;
  font-size: 11.5px;
  font-weight: 650;
  color: var(--tmhl-text);
}
.tmhl-help { margin-top: 5px; font-size: 11px; line-height: 1.5; color: var(--tmhl-muted); }
.tmhl-sync-status {
  margin-top: 6px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--tmhl-muted);
  word-break: break-word;
}
.tmhl-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.tmhl-switch {
  position: relative;
  width: 40px;
  height: 23px;
  flex: 0 0 40px;
  border: 0;
  border-radius: 999px;
  background: var(--tmhl-raised-2);
  cursor: pointer;
  transition: background .16s ease;
}
.tmhl-switch::after {
  content: "";
  position: absolute;
  top: 3px;
  left: 3px;
  width: 17px;
  height: 17px;
  border-radius: 50%;
  background: var(--tmhl-text);
  opacity: .55;
  transition: transform .16s ease, opacity .16s ease;
}
.tmhl-switch[aria-checked="true"] { background: var(--tmhl-green-2); }
.tmhl-switch[aria-checked="true"]::after { transform: translateX(17px); opacity: 1; }

/* Toast */
#tmhl-toast {
  position: fixed;
  left: 50%;
  bottom: max(26px, env(safe-area-inset-bottom, 0px));
  z-index: 2147483647;
  transform: translateX(-50%);
  max-width: calc(100vw - 28px);
  padding: 9px 14px;
  border: 1px solid var(--tmhl-border);
  border-radius: 11px;
  background: var(--tmhl-surface);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow: var(--tmhl-shadow);
  font-size: 12.5px;
  line-height: 1.35;
  text-align: center;
  pointer-events: none;
  animation: tmhl-enter .16s ease;
}
#tmhl-toast[hidden] { display: none !important; }

@media (pointer: coarse) {
  #tmhl-toolbar { width: 46px; padding: 5px; border-radius: 15px; }
  .tmhl-color-rail > .tmhl-swatch { width: 36px; height: 36px; min-width: 36px; }
  .tmhl-color-rail > .tmhl-swatch::before { width: 20px; height: 12px; }
  .tmhl-toolbar-grip,
  .tmhl-toolbar-more { width: 36px; height: 34px; min-width: 36px; }
  .tmhl-toolbar-menu { min-width: 190px; padding: 7px; }
  .tmhl-toolbar-menu > .tmhl-tool { min-height: 42px; height: 42px; padding: 0 11px; font-size: 13px; }
  .tmhl-swatch { width: 38px; height: 38px; border-radius: 10px; }
  .tmhl-swatch::before { width: 20px; height: 20px; }
  .tmhl-tool { height: 38px; min-width: 38px; border-radius: 10px; }
  .tmhl-tool svg { width: 17px; height: 17px; }
}

@media (max-width: 820px) {
  #tmhl-panel {
    top: auto;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    height: min(80vh, 680px);
    border-left: 0;
    border-top: 1px solid var(--tmhl-border);
    border-radius: 18px 18px 0 0;
    transform: translateY(102%);
  }
  #tmhl-panel.tmhl-open { transform: none; }
  #tmhl-panel::before {
    content: "";
    position: absolute;
    top: 7px;
    left: 50%;
    width: 36px;
    height: 4px;
    margin-left: -18px;
    border-radius: 999px;
    background: var(--tmhl-border);
  }
  .tmhl-head { padding-top: 18px; }
  .tmhl-meta { flex-wrap: wrap; row-gap: 4px; }
  .tmhl-meta .tmhl-chat { flex: 1 1 90px; max-width: 100%; }
  #tmhl-launcher { height: 38px; padding: 0 13px; opacity: .62; }
  #tmhl-launcher.tmhl-mini {
    width: 32px;
    height: 32px;
    padding: 0;
    opacity: .38;
    border-radius: 9px;
  }
  #tmhl-toast { bottom: calc(96px + env(safe-area-inset-bottom, 0px)); }
}

@media (prefers-reduced-motion: reduce) {
  #tmhl-panel,
  #tmhl-scrim,
  #tmhl-toolbar,
  #tmhl-launcher,
  .tmhl-toolbar-menu,
  mark.tmhl-mark {
    transition: none !important;
    animation: none !important;
  }
}
`;

    document.head.appendChild(style);
  }

  /* ------------------------------------------------------------------
     Icons
     ---------------------------------------------------------------- */

  const ICON = {
    note:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    copy:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    trash:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
    close:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    list:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
    gear:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.4-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1A1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.4l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.6 1H23a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>',
    jump:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg>',
    grip:
      '<svg viewBox="0 0 12 18" fill="currentColor"><circle cx="3" cy="3" r="1.15"/><circle cx="9" cy="3" r="1.15"/><circle cx="3" cy="9" r="1.15"/><circle cx="9" cy="9" r="1.15"/><circle cx="3" cy="15" r="1.15"/><circle cx="9" cy="15" r="1.15"/></svg>',
    more:
      '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>',
    target:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>'
  };

  /* ------------------------------------------------------------------
     Toast
     ---------------------------------------------------------------- */

  let toastNode = null;
  let toastTimer = 0;

  function toast(message) {
    if (!toastNode) return;

    window.clearTimeout(toastTimer);
    toastNode.textContent = message;
    toastNode.hidden = false;

    toastTimer = window.setTimeout(() => {
      toastNode.hidden = true;
    }, 2000);
  }

  /* ------------------------------------------------------------------
     Toolbar
     ---------------------------------------------------------------- */

  let toolbar = null;
  let captured = null;
  let activeId = null;
  let toolbarMenu = null;
  let toolbarMoreButton = null;
  let toolbarAnchorRect = null;
  let toolbarDragging = false;

  function bindPress(node, action) {
    let last = 0;

    const run = (event) => {
      if (
        event.type === "pointerdown" &&
        event.button !== undefined &&
        event.button !== 0
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const stamp = now();
      if (stamp - last < 220) return;

      last = stamp;
      action(event);
    };

    node.addEventListener("pointerdown", run);
    node.addEventListener("click", run);
  }

  function swatchButton(color, active, action) {
    const button = el("button", {
      type: "button",
      class: "tmhl-swatch",
      "aria-label": `${COLOR_LABEL[color]} highlight`,
      "aria-pressed": active ? "true" : "false",
      title: COLOR_LABEL[color],
      style: `--sw: var(--tmhl-${color}-2)`
    });

    bindPress(button, () => action(color));
    return button;
  }

  function toolButton(icon, label, action, extraClass) {
    const button = el("button", {
      type: "button",
      class: `tmhl-tool ${extraClass || ""}`.trim(),
      title: label,
      "aria-label": label,
      "data-tmhl-label": label,
      html: icon
    });

    bindPress(button, action);
    return button;
  }

  function closeToolbarMenu() {
    if (!toolbarMenu || !toolbarMoreButton) return;

    toolbarMenu.classList.remove("tmhl-open", "tmhl-menu-left");
    toolbarMoreButton.setAttribute("aria-expanded", "false");
  }

  function positionToolbarMenu() {
    if (
      !toolbar ||
      !toolbarMenu ||
      !toolbarMenu.classList.contains("tmhl-open")
    ) {
      return;
    }

    toolbarMenu.classList.remove("tmhl-menu-left");
    toolbarMenu.style.top = "0";
    toolbarMenu.style.bottom = "auto";
    toolbarMenu.style.left = "calc(100% + 8px)";
    toolbarMenu.style.right = "auto";

    window.requestAnimationFrame(() => {
      if (!toolbarMenu || !toolbarMenu.classList.contains("tmhl-open")) return;

      const bounds = viewportBounds();
      const toolbarRect = toolbar.getBoundingClientRect();
      const menuWidth = toolbarMenu.offsetWidth;
      const menuHeight = toolbarMenu.offsetHeight;
      const gap = 8;
      const roomRight = toolbarRect.right + gap + menuWidth <= bounds.right - 8;
      const roomLeft = toolbarRect.left - gap - menuWidth >= bounds.left + 8;

      if (!roomRight && roomLeft) {
        toolbarMenu.classList.add("tmhl-menu-left");
      }

      const desiredTop = clamp(
        toolbarRect.top,
        bounds.top + 8,
        Math.max(bounds.top + 8, bounds.bottom - menuHeight - 8)
      );

      toolbarMenu.style.top = `${Math.round(desiredTop - toolbarRect.top)}px`;
    });
  }

  function toggleToolbarMenu() {
    if (!toolbarMenu || !toolbarMoreButton) return;

    const opening = !toolbarMenu.classList.contains("tmhl-open");

    if (!opening) {
      closeToolbarMenu();
      return;
    }

    toolbarMenu.classList.add("tmhl-open");
    toolbarMoreButton.setAttribute("aria-expanded", "true");
    positionToolbarMenu();
  }

  function setToolbarCoordinates(left, top) {
    if (!toolbar || toolbar.hidden) return;

    const bounds = viewportBounds();
    const width = toolbar.offsetWidth || 46;
    const height = toolbar.offsetHeight || 230;
    const margin = 8;
    const safeLeft = clamp(
      left,
      bounds.left + margin,
      Math.max(bounds.left + margin, bounds.right - width - margin)
    );
    const safeTop = clamp(
      top,
      bounds.top + margin,
      Math.max(bounds.top + margin, bounds.bottom - height - margin)
    );

    toolbar.style.left = `${Math.round(safeLeft)}px`;
    toolbar.style.top = `${Math.round(safeTop)}px`;
    toolbar.style.transform = "none";
    toolbar.style.visibility = "visible";
  }

  function saveToolbarPosition() {
    if (!toolbar || toolbar.hidden) return;

    const bounds = viewportBounds();
    const rect = toolbar.getBoundingClientRect();

    settings.toolbar = {
      pinned: true,
      xPct: clamp(
        (rect.left + rect.width / 2 - bounds.left) / bounds.width,
        0,
        1
      ),
      yPct: clamp(
        (rect.top + rect.height / 2 - bounds.top) / bounds.height,
        0,
        1
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
    closeToolbarMenu();

    if (toolbar && !toolbar.hidden && toolbarAnchorRect) {
      positionToolbar(toolbarAnchorRect);
    }
  }

  function positionToolbar(rect) {
    if (!toolbar) return;
    if (rect) toolbarAnchorRect = rect;

    toolbar.style.visibility = "hidden";
    toolbar.hidden = false;

    window.requestAnimationFrame(() => {
      if (toolbar.hidden || toolbarDragging) return;

      const bounds = viewportBounds();
      const width = toolbar.offsetWidth;
      const height = toolbar.offsetHeight;

      if (settings.toolbar && settings.toolbar.pinned) {
        setToolbarCoordinates(
          bounds.left + settings.toolbar.xPct * bounds.width - width / 2,
          bounds.top + settings.toolbar.yPct * bounds.height - height / 2
        );
        return;
      }

      const anchor = rect || toolbarAnchorRect;

      if (!anchor) {
        setToolbarCoordinates(
          bounds.right - width - 12,
          bounds.top + bounds.height / 2 - height / 2
        );
        return;
      }

      const gap = isTouch() || isNarrow() ? 11 : 10;
      const right = anchor.right + gap;
      const left = anchor.left - width - gap;
      const selectedLeft = right + width <= bounds.right - 8 ? right : left;
      const centeredTop = anchor.top + anchor.height / 2 - height / 2;

      setToolbarCoordinates(selectedLeft, centeredTop);
    });
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

    grip.addEventListener("pointerdown", (event) => {
      if (event.button !== undefined && event.button !== 0) return;

      event.preventDefault();
      event.stopPropagation();
      closeToolbarMenu();

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
        /* Pointer capture is optional. */
      }
    });

    grip.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;

      const deltaX = event.clientX - drag.startX;
      const deltaY = event.clientY - drag.startY;
      const threshold = isTouch() ? 8 : 4;

      if (!drag.moved && Math.hypot(deltaX, deltaY) < threshold) return;

      drag.moved = true;
      toolbar.classList.add("tmhl-dragging");
      setToolbarCoordinates(drag.startLeft + deltaX, drag.startTop + deltaY);
    });

    const finish = (event) => {
      if (
        !drag ||
        (event.pointerId !== undefined && event.pointerId !== drag.pointerId)
      ) {
        return;
      }

      const moved = drag.moved;
      const pointerId = drag.pointerId;
      drag = null;
      toolbarDragging = false;
      toolbar.classList.remove("tmhl-dragging");

      try {
        grip.releasePointerCapture(pointerId);
      } catch {
        /* Ignore released capture. */
      }

      if (moved) saveToolbarPosition();
    };

    grip.addEventListener("pointerup", finish);
    grip.addEventListener("pointercancel", finish);
    grip.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    grip.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      resetToolbarPosition();
    });
    grip.addEventListener("keydown", (event) => {
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

  function buildToolbarLayout(swatches, actions) {
    toolbar.replaceChildren();

    const rail = el("div", { class: "tmhl-color-rail" });
    swatches.forEach((swatch) => rail.appendChild(swatch));

    toolbarMoreButton = el("button", {
      type: "button",
      class: "tmhl-toolbar-more",
      "aria-label": "More highlight actions",
      "aria-haspopup": "true",
      "aria-expanded": "false",
      "aria-controls": "tmhl-toolbar-menu",
      title: "More actions",
      html: ICON.more
    });
    bindPress(toolbarMoreButton, toggleToolbarMenu);

    toolbarMenu = el("div", {
      id: "tmhl-toolbar-menu",
      class: "tmhl-toolbar-menu",
      role: "group",
      "aria-label": "More highlight actions"
    });

    actions.forEach((button) => toolbarMenu.appendChild(button));
    toolbarMenu.appendChild(
      toolButton(ICON.target, "Follow selection", resetToolbarPosition)
    );

    toolbar.append(buildToolbarGrip(), rail, toolbarMoreButton, toolbarMenu);
  }

  function hideToolbar(reset) {
    if (toolbar) {
      closeToolbarMenu();
      toolbar.hidden = true;
      toolbar.style.visibility = "";
      toolbar.classList.remove("tmhl-dragging");
    }

    toolbarDragging = false;

    if (reset !== false) {
      captured = null;
      activeId = null;
    }
  }

  function showCreateToolbar(rect) {
    if (!toolbar) return;

    activeId = null;

    const swatches = COLORS.map((color) =>
      swatchButton(color, color === settings.defaultColor, (picked) =>
        commitHighlight(picked)
      )
    );

    const actions = [
      toolButton(ICON.copy, "Copy text", async () => {
        if (!captured) return;

        const success = await copyText(captured.exact);
        hideToolbar();
        toast(success ? "Copied." : "Copy blocked by the browser.");
      }),
      toolButton(ICON.list, "Open highlights", () => {
        hideToolbar();
        openPanel();
      }),
      toolButton(ICON.close, "Close", () => hideToolbar())
    ];

    buildToolbarLayout(swatches, actions);
    positionToolbar(rect);
  }

  function showEditToolbar(id, rect) {
    const record = findRecord(id);

    if (!toolbar || !record || record.deleted) return;

    captured = null;
    activeId = id;

    const swatches = COLORS.map((color) =>
      swatchButton(color, color === record.color, (picked) =>
        recolorHighlight(id, picked)
      )
    );

    const actions = [
      toolButton(ICON.note, record.note ? "Edit note" : "Add note", () => {
        hideToolbar();
        openPanel();
        startNoteEdit(id);
      }),
      toolButton(ICON.copy, "Copy text", async () => {
        const success = await copyText(record.exact);
        hideToolbar();
        toast(success ? "Copied." : "Copy blocked by the browser.");
      }),
      toolButton(ICON.list, "Open highlights", () => {
        hideToolbar();
        openPanel();
      }),
      toolButton(
        ICON.trash,
        "Delete highlight",
        () => deleteHighlight(id),
        "tmhl-danger"
      ),
      toolButton(ICON.close, "Close", () => hideToolbar())
    ];

    buildToolbarLayout(swatches, actions);
    positionToolbar(rect);
  }

  /* ------------------------------------------------------------------
     Selection capture
     ---------------------------------------------------------------- */

  let selectionTimer = 0;

  function overlapsRendered(root, start, end) {
    return rendered.filter(
      (item) => item.root === root && start < item.end && end > item.start
    );
  }

  function selectionCanBeCaptured() {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return false;
    }

    const node = selection.anchorNode;
    const element =
      node && node.nodeType === Node.ELEMENT_NODE ? node : node && node.parentElement;

    if (
      element &&
      element.closest(
        '[data-tmhl-ui], input, textarea, select, [contenteditable="true"]'
      )
    ) {
      return false;
    }

    return true;
  }

  function captureSelection() {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return;
    }

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
      showEditToolbar(overlaps[0].record.id, rect);
      return;
    }

    let start = offsets.start;
    let end = offsets.end;

    overlaps.forEach((item) => {
      start = Math.min(start, item.start);
      end = Math.max(end, item.end);
    });

    captured = {
      chatId,
      root,
      start,
      end,
      exact: text.slice(start, end),
      absorb: overlaps.map((item) => item.record.id),
      rect
    };

    showCreateToolbar(rect);
  }

  function scheduleCapture(delay) {
    window.clearTimeout(selectionTimer);

    if (!selectionCanBeCaptured()) {
      selectionTimer = 0;
      return;
    }

    selectionTimer = window.setTimeout(captureSelection, delay || 240);
  }

  /* ------------------------------------------------------------------
     Store mutations
     ---------------------------------------------------------------- */

  function commitHighlight(color) {
    const snapshot = captured;

    if (!snapshot || !COLORS.includes(color)) {
      hideToolbar();
      return;
    }

    const chatId = currentChatId();

    if (!chatId || chatId !== snapshot.chatId || !snapshot.root.isConnected) {
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

    const roots = getResponseRoots();
    const messageIndex = roots.indexOf(snapshot.root);

    (snapshot.absorb || []).forEach((id) => {
      const record = findRecord(id);

      if (record) {
        record.deleted = true;
        record.updatedAt = now();
      }
    });

    const stamp = new Date().toISOString();

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
      createdAt: stamp,
      updatedAt: now(),
      deleted: false
    });

    settings.defaultColor = color;
    saveSettings();
    if (!persist()) return;

    const selection = window.getSelection();
    if (selection) selection.removeAllRanges();

    hideToolbar();
    clearMarks((mark) => (snapshot.absorb || []).includes(mark.dataset.tmhlId));
    restoreHighlights();
    bumpLauncher();
  }

  function recolorHighlight(id, color) {
    const record = findRecord(id);

    if (!record || !COLORS.includes(color)) return;

    record.color = color;
    record.updatedAt = now();
    settings.defaultColor = color;
    saveSettings();
    if (!persist()) return;

    hideToolbar();
    marksById(id).forEach((mark) => {
      mark.dataset.color = color;
    });
  }

  function setNote(id, note) {
    const record = findRecord(id);
    if (!record) return;

    record.note = note;
    record.updatedAt = now();
    if (!persist()) return;

    marksById(id).forEach((mark) => {
      if (note) {
        mark.dataset.note = "1";
      } else {
        delete mark.dataset.note;
      }
      mark.title = note || "";
    });
  }

  function deleteHighlight(id) {
    const record = findRecord(id);

    if (!record || record.deleted) {
      hideToolbar();
      return;
    }

    record.deleted = true;
    record.updatedAt = now();
    suppressCardClickUntil = now() + 450;

    if (!persist()) return;

    clearMarks((mark) => mark.dataset.tmhlId === id);
    rendered = rendered.filter((item) => item.record.id !== id);
    hideToolbar();
    toast("Highlight deleted.");
  }

  function clearChatHighlights() {
    const chatId = currentChatId();
    if (!chatId) return;

    const targets = itemsForChat(chatId);
    if (!targets.length) return;

    if (!window.confirm(`Delete ${targets.length} highlights in this chat?`)) {
      return;
    }

    targets.forEach((record) => {
      record.deleted = true;
      record.updatedAt = now();
    });

    persist();
    clearMarks((mark) => mark.dataset.tmhlChat === chatId);
    rendered = [];
    toast("Chat highlights cleared.");
  }

  function clearAllHighlights() {
    const count = liveItems().length;
    if (!count) return;

    if (!window.confirm(`Delete all ${count} highlights on every chat?`)) {
      return;
    }

    liveItems().forEach((record) => {
      record.deleted = true;
      record.updatedAt = now();
    });

    persist();
    clearMarks();
    rendered = [];
    toast("All highlights cleared.");
  }

  /* ------------------------------------------------------------------
     Export and import
     ---------------------------------------------------------------- */

  function exportJson() {
    return JSON.stringify(
      {
        version: 3,
        updatedAt: store.updatedAt,
        items: store.items
      },
      null,
      2
    );
  }

  function exportMarkdown(scopeChatId) {
    const items = liveItems()
      .filter((item) => !scopeChatId || item.chatId === scopeChatId)
      .sort((first, second) => first.createdAt.localeCompare(second.createdAt));
    const groups = new Map();

    items.forEach((item) => {
      const key = titleForRecord(item) || item.chatTitle || item.chatId;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });

    const lines = ["# Highlights", ""];

    groups.forEach((records, title) => {
      lines.push(`## ${title}`, "");

      records.forEach((record) => {
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

      const merged = mergeDocs(store, { updatedAt: now(), items });
      store = merged.doc;
      persist();
      scheduleRestore(60);
      toast(`Imported ${items.length} highlights.`);
      return true;
    } catch (error) {
      toast(`Import failed: ${error.message}`);
      return false;
    }
  }

  function pickImportFile() {
    const input = el("input", {
      type: "file",
      accept: "application/json"
    });
    input.style.display = "none";

    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => importJson(String(reader.result || ""));
      reader.readAsText(file);
      input.remove();
    });

    document.body.appendChild(input);
    input.click();
  }

  /* ------------------------------------------------------------------
     Cross-device sync through a secret GitHub Gist
     ---------------------------------------------------------------- */

  let syncBusy = false;
  let syncPushTimer = 0;
  let syncPollTimer = 0;
  let lastSyncError = "";
  let syncStatusNode = null;

  function syncToken() {
    try {
      return localStorage.getItem(LS_TOKEN) || "";
    } catch {
      return "";
    }
  }

  function setSyncToken(token) {
    try {
      if (token) localStorage.setItem(LS_TOKEN, token);
      else localStorage.removeItem(LS_TOKEN);
    } catch (error) {
      console.warn("[TM Highlighter] Token not saved.", error);
    }
  }

  function syncReady() {
    return Boolean(settings.sync && settings.sync.enabled && syncToken());
  }

  async function githubFetch(path, options) {
    const config = options || {};
    const headers = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${syncToken()}`,
      "X-GitHub-Api-Version": "2022-11-28"
    };

    if (config.body) headers["Content-Type"] = "application/json";

    const response = await fetch(`${GITHUB_API}${path}`, {
      method: config.method || "GET",
      headers,
      body: config.body ? JSON.stringify(config.body) : undefined
    });

    if (!response.ok) {
      let detail = "";

      try {
        const data = await response.json();
        detail = data && data.message ? data.message : "";
      } catch {
        detail = "";
      }

      const error = new Error(
        detail || `GitHub responded with ${response.status}.`
      );
      error.status = response.status;
      throw error;
    }

    return response.json();
  }

  async function readGist(gistId) {
    const data = await githubFetch(`/gists/${encodeURIComponent(gistId)}`);
    const files = data.files || {};
    const file =
      files[GIST_FILENAME] ||
      Object.values(files).find(
        (item) => item && /\.json$/i.test(item.filename || "")
      );

    if (!file) return emptyStore();

    let content = file.content || "";

    if (file.truncated && file.raw_url) {
      const raw = await fetch(file.raw_url);
      content = await raw.text();
    }

    if (!content.trim()) return emptyStore();

    const parsed = JSON.parse(content);
    const items = Array.isArray(parsed)
      ? parsed
      : (parsed && parsed.items) || [];

    return {
      version: 3,
      updatedAt: Number(parsed && parsed.updatedAt) || 0,
      items
    };
  }

  async function writeGist(gistId, payload) {
    const files = {};
    files[GIST_FILENAME] = { content: payload };

    const body = {
      description: "TypingMind highlights (TM Highlighter sync)",
      files
    };

    if (gistId) {
      return githubFetch(`/gists/${encodeURIComponent(gistId)}`, {
        method: "PATCH",
        body
      });
    }

    return githubFetch("/gists", {
      method: "POST",
      body: { ...body, public: false }
    });
  }

  async function syncNow(options) {
    const preferences = options || {};

    if (!settings.sync.enabled) {
      if (!preferences.silent) toast("Turn sync on first.");
      return false;
    }

    if (!syncToken()) {
      if (!preferences.silent) toast("Add a GitHub token first.");
      return false;
    }

    if (syncBusy) return false;

    syncBusy = true;
    window.clearTimeout(syncPushTimer);
    syncPushTimer = 0;
    renderSyncStatus("Syncing now...");

    try {
      let pulled = false;

      if (settings.sync.gistId) {
        const remote = await readGist(settings.sync.gistId);
        const merged = mergeDocs(store, remote);

        if (merged.changed) {
          store = merged.doc;
          pulled = true;
          persist({ skipPush: true });
          scheduleRestore(60);
        }
      }

      const shouldPush =
        preferences.force ||
        !settings.sync.gistId ||
        store.updatedAt > (settings.sync.pushedAt || 0);

      if (shouldPush) {
        const result = await writeGist(settings.sync.gistId, exportJson());

        if (result && result.id) settings.sync.gistId = result.id;
        settings.sync.pushedAt = store.updatedAt;
      }

      settings.sync.lastSyncAt = now();
      saveSettings();
      lastSyncError = "";
      renderSyncStatus();

      if (!preferences.silent) {
        toast(pulled ? "Synced. Pulled changes from your other device." : "Synced.");
      }

      return true;
    } catch (error) {
      lastSyncError = error.message || "Sync failed.";
      renderSyncStatus();

      if (!preferences.silent) {
        toast(`Sync failed: ${lastSyncError}`);
      } else {
        console.warn("[TM Highlighter] Sync failed.", error);
      }

      return false;
    } finally {
      syncBusy = false;
    }
  }

  function scheduleSyncPush(delay) {
    if (!syncReady()) return;

    window.clearTimeout(syncPushTimer);
    syncPushTimer = window.setTimeout(() => {
      syncPushTimer = 0;
      syncNow({ silent: true });
    }, Number.isFinite(delay) ? delay : SYNC_PUSH_DELAY_MS);
  }

  function startSyncLoop() {
    window.clearInterval(syncPollTimer);

    if (!syncReady()) return;

    syncPollTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") syncNow({ silent: true });
    }, SYNC_POLL_MS);
  }

  function renderSyncStatus(message) {
    if (!syncStatusNode || !syncStatusNode.isConnected) return;

    if (message) {
      syncStatusNode.textContent = message;
      return;
    }

    if (!settings.sync.enabled) {
      syncStatusNode.textContent = "Sync is off on this device.";
      return;
    }

    if (!syncToken()) {
      syncStatusNode.textContent = "Add a GitHub token to finish setup.";
      return;
    }

    if (lastSyncError) {
      syncStatusNode.textContent = `Last sync failed: ${lastSyncError}`;
      return;
    }

    const gistPart = settings.sync.gistId
      ? `Gist ${settings.sync.gistId}`
      : "No gist yet";
    const timePart = settings.sync.lastSyncAt
      ? relativeTime(new Date(settings.sync.lastSyncAt).toISOString())
      : "never";

    syncStatusNode.textContent = `${gistPart} · last sync ${timePart}`;
  }

  async function connectSync() {
    const token = window.prompt(
      "Paste a GitHub token that has gist access. It stays in this browser only.",
      ""
    );

    if (token === null) return;

    const trimmed = token.trim();

    if (!trimmed) {
      toast("No token saved.");
      return;
    }

    setSyncToken(trimmed);
    settings.sync.enabled = true;
    saveSettings();

    const gistId = window.prompt(
      "Gist ID to share with your other devices. Leave blank to create a new one.",
      settings.sync.gistId || ""
    );

    if (gistId !== null) {
      const cleaned = gistId.trim();

      if (cleaned !== settings.sync.gistId) {
        settings.sync.gistId = cleaned;
        settings.sync.pushedAt = 0;
      }
    }

    saveSettings();
    renderSettings();
    startSyncLoop();
    await syncNow({ force: true });
    renderSettings();

    if (settings.sync.gistId) {
      console.info(
        `[TM Highlighter] Sync gist id: ${settings.sync.gistId}`
      );
    }
  }

  function disconnectSync() {
    setSyncToken("");
    settings.sync.enabled = false;
    saveSettings();
    window.clearInterval(syncPollTimer);
    window.clearTimeout(syncPushTimer);
    syncPushTimer = 0;
    renderSettings();
    toast("Sync turned off on this device.");
  }

  async function editGistId() {
    const gistId = window.prompt(
      "Gist ID used for sync. Leave blank to create a new gist on the next sync.",
      settings.sync.gistId || ""
    );

    if (gistId === null) return;

    settings.sync.gistId = gistId.trim();
    settings.sync.pushedAt = 0;
    saveSettings();
    renderSettings();

    if (syncReady()) await syncNow({ force: true });
    renderSettings();
  }

  /* ------------------------------------------------------------------
     Panel
     ---------------------------------------------------------------- */

  let panel = null;
  let scrim = null;
  let launcher = null;
  let listNode = null;
  let countNode = null;
  let settingsNode = null;
  let statusNode = null;

  const view = {
    open: false,
    tab: "list",
    scope: "chat",
    color: "all",
    query: "",
    editingNote: null,
    openedAt: 0
  };

  function buildPanel() {
    scrim = el("div", {
      id: "tmhl-scrim",
      "data-tmhl-ui": "true"
    });

    scrim.addEventListener("click", () => {
      if (now() - (view.openedAt || 0) < 400) return;
      closePanel();
    });

    panel = el("aside", {
      id: "tmhl-panel",
      "data-tmhl-ui": "true",
      role: "complementary",
      "aria-label": "Highlights"
    });

    const head = el("div", { class: "tmhl-head" });
    head.appendChild(el("span", { class: "tmhl-title", text: "Highlights" }));

    countNode = el("span", { class: "tmhl-count", text: "0" });
    head.appendChild(countNode);
    head.append(
      toolButton(ICON.list, "Highlights", () => setTab("list")),
      toolButton(ICON.gear, "Settings", () => setTab("settings")),
      toolButton(ICON.close, "Close", closePanel)
    );
    panel.appendChild(head);

    const controls = el("div", { class: "tmhl-controls" });
    const search = el("input", {
      class: "tmhl-search",
      type: "search",
      placeholder: "Search highlights and notes",
      "aria-label": "Search highlights and notes"
    });

    search.addEventListener("input", () => {
      view.query = search.value.trim().toLowerCase();
      renderList();
    });
    controls.appendChild(search);

    const filters = el("div", { class: "tmhl-filters" });
    const scopeChip = el("button", {
      type: "button",
      class: "tmhl-chip",
      "aria-pressed": "true",
      text: "This chat"
    });

    scopeChip.addEventListener("click", () => {
      view.scope = view.scope === "chat" ? "all" : "chat";
      scopeChip.textContent = view.scope === "chat" ? "This chat" : "All chats";
      renderList();
    });
    filters.appendChild(scopeChip);

    const allChip = el("button", {
      type: "button",
      class: "tmhl-chip",
      "aria-pressed": "true",
      text: "All colors"
    });
    allChip.addEventListener("click", () => setColorFilter("all"));
    filters.appendChild(allChip);

    COLORS.forEach((color) => {
      const chip = el("button", {
        type: "button",
        class: "tmhl-chip",
        "aria-pressed": "false",
        title: COLOR_LABEL[color],
        "aria-label": `${COLOR_LABEL[color]} highlights`,
        "data-color": color,
        style: `--sw: var(--tmhl-${color}-2)`
      });

      chip.appendChild(el("i", {}));
      chip.addEventListener("click", () => setColorFilter(color));
      filters.appendChild(chip);
    });

    controls.appendChild(filters);
    panel.appendChild(controls);

    listNode = el("div", { class: "tmhl-list" });
    panel.appendChild(listNode);

    settingsNode = el("div", { class: "tmhl-settings" });
    settingsNode.hidden = true;
    panel.appendChild(settingsNode);

    const foot = el("div", { class: "tmhl-foot" });
    const exportMarkdownButton = el("button", {
      type: "button",
      class: "tmhl-btn",
      text: "Export .md"
    });
    exportMarkdownButton.addEventListener("click", () => {
      downloadFile(
        "highlights.md",
        exportMarkdown(view.scope === "chat" ? currentChatId() : null),
        "text/markdown"
      );
    });

    const exportJsonButton = el("button", {
      type: "button",
      class: "tmhl-btn",
      text: "Backup .json"
    });
    exportJsonButton.addEventListener("click", () => {
      downloadFile("highlights.json", exportJson(), "application/json");
    });

    const importButton = el("button", {
      type: "button",
      class: "tmhl-btn",
      text: "Import"
    });
    importButton.addEventListener("click", pickImportFile);

    statusNode = el("span", { class: "tmhl-status", text: "" });
    foot.append(exportMarkdownButton, exportJsonButton, importButton, statusNode);
    panel.appendChild(foot);

    document.body.append(scrim, panel);
    panel._controls = controls;
    panel._filters = filters;
    setColorFilter("all");
  }

  function setColorFilter(color) {
    view.color = color;
    const filters = panel && panel._filters;
    if (!filters) return;

    Array.from(filters.children).forEach((chip) => {
      const chipColor = chip.getAttribute("data-color");

      if (chip.textContent === "All colors") {
        chip.setAttribute("aria-pressed", color === "all" ? "true" : "false");
      } else if (chipColor) {
        chip.setAttribute("aria-pressed", chipColor === color ? "true" : "false");
      }
    });

    renderList();
  }

  function setTab(tab) {
    view.tab = tab;
    const showList = tab === "list";

    listNode.hidden = !showList;
    panel._controls.hidden = !showList;
    settingsNode.hidden = showList;

    if (showList) {
      renderList();
    } else {
      renderSettings();
    }
  }

  function openPanel() {
    if (!panel) return;

    view.open = true;
    view.openedAt = now();
    panel.classList.add("tmhl-open");
    if (isNarrow()) scrim.classList.add("tmhl-open");

    syncLauncherVisibility();
    renderPanel();

    if (syncReady()) syncNow({ silent: true });
  }

  function closePanel() {
    if (!panel) return;

    view.open = false;
    view.editingNote = null;
    panel.classList.remove("tmhl-open");
    scrim.classList.remove("tmhl-open");
    syncLauncherVisibility();
  }

  function togglePanel() {
    if (view.open) closePanel();
    else openPanel();
  }

  function visibleRecords() {
    const chatId = currentChatId();
    let items = liveItems();

    if (view.scope === "chat") {
      items = items.filter((item) => item.chatId === chatId);
    }

    if (view.color !== "all") {
      items = items.filter((item) => item.color === view.color);
    }

    if (view.query) {
      items = items.filter(
        (item) =>
          item.exact.toLowerCase().includes(view.query) ||
          (item.note || "").toLowerCase().includes(view.query) ||
          (titleForRecord(item) || "").toLowerCase().includes(view.query)
      );
    }

    return items.sort((first, second) => {
      if (first.chatId === second.chatId) {
        return first.createdAt.localeCompare(second.createdAt);
      }
      return second.updatedAt - first.updatedAt;
    });
  }

  function buildCard(record) {
    const card = el("div", {
      class: "tmhl-card",
      style: `--rail: var(--tmhl-${record.color}-2)`,
      "data-id": record.id
    });

    card.appendChild(el("div", { class: "tmhl-quote", text: record.exact }));

    if (record.note && view.editingNote !== record.id) {
      card.appendChild(el("div", { class: "tmhl-note", text: record.note }));
    }

    if (view.editingNote === record.id) {
      const area = el("textarea", {
        class: "tmhl-noteedit",
        placeholder: "Write a note. Enter saves, Shift+Enter adds a line.",
        "aria-label": "Highlight note"
      });
      area.value = record.note || "";

      area.addEventListener("click", (event) => event.stopPropagation());
      area.addEventListener("keydown", (event) => {
        event.stopPropagation();

        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          view.editingNote = null;
          setNote(record.id, area.value.trim());
        }

        if (event.key === "Escape") {
          event.preventDefault();
          view.editingNote = null;
          renderList();
        }
     
