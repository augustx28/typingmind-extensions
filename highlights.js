/* =====================================================================
 * TypingMind Persistent Highlighter
 * Version 3.1.0
 *
 * What's new in 3.1
 *  - Local only. No accounts, no endpoints, nothing leaves the browser.
 *  - On phones the action bar docks just above the composer instead of
 *    chasing the selection and fighting the iOS copy/paste callout.
 *  - The floating button is draggable and snaps to the nearest edge.
 *    Its position is remembered.
 *  - Every action bar has a list button, so the panel is one tap away
 *    even with the floating button switched off.
 *  - Notes on any highlight, search, color filters, jump to highlight.
 *  - Keyboard: Alt+H highlights, Alt+L opens the panel, 1-5 pick a color.
 *
 * Install: TypingMind > Preferences > Advanced Settings > Extensions,
 * paste the raw URL of this file, reload.
 * ===================================================================== */

(() => {
  "use strict";

  const VERSION = "3.1.0";
  const FLAG = "__TM_HIGHLIGHTER_V3__";

  if (window[FLAG] && window[FLAG].loaded) return;
  window[FLAG] = { loading: true, version: VERSION };

  /* ------------------------------------------------------------------
   * Constants
   * ---------------------------------------------------------------- */

  const LS_DATA = "tm-highlights-v3";
  const LS_SETTINGS = "tm-highlights-v3-settings";
  const LEGACY_KEY = "typingmind-persistent-highlights-v2";
  const CHANNEL_NAME = "tm-highlights-v3-bus";
  const TOMBSTONE_TTL_MS = 45 * 24 * 60 * 60 * 1000;

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
    defaultColor: "yellow",
    showLauncher: true,
    launcher: { side: "right", topPct: 0.6 }
  };

  /* ------------------------------------------------------------------
   * Small utilities
   * ---------------------------------------------------------------- */

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
    return new Date(stamp).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric"
    });
  }

  function isTouch() {
    return window.matchMedia("(pointer: coarse)").matches;
  }

  function isNarrow() {
    return window.innerWidth <= 720;
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
        if (key === "class") node.className = value;
        else if (key === "text") node.textContent = value;
        else if (key === "html") node.innerHTML = value;
        else if (key.startsWith("on") && typeof value === "function") {
          node.addEventListener(key.slice(2).toLowerCase(), value);
        } else node.setAttribute(key, value);
      });
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
      if (!raw) return structuredCopy(DEFAULT_SETTINGS);
      const parsed = JSON.parse(raw);
      return {
        ...structuredCopy(DEFAULT_SETTINGS),
        ...parsed,
        launcher: { ...DEFAULT_SETTINGS.launcher, ...(parsed.launcher || {}) }
      };
    } catch {
      return structuredCopy(DEFAULT_SETTINGS);
    }
  }

  function structuredCopy(value) {
    return JSON.parse(JSON.stringify(value));
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
    let doc = emptyStore();
    try {
      const raw = localStorage.getItem(LS_DATA);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.items)) {
          doc = {
            version: 3,
            updatedAt: Number(parsed.updatedAt) || 0,
            items: parsed.items.filter(validRecord).map(normalizeRecord)
          };
        }
      }
    } catch (error) {
      console.warn("[TM Highlighter] Could not read storage.", error);
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
    const opts = options || {};
    store.updatedAt = now();
    try {
      localStorage.setItem(LS_DATA, JSON.stringify(store));
    } catch (error) {
      console.error("[TM Highlighter] Save failed.", error);
      toast("Storage is full. Export and clear old highlights.");
      return false;
    }
    if (bus && !opts.silentBus) {
      try {
        bus.postMessage({ type: "changed", at: store.updatedAt });
      } catch {
        /* ignore */
      }
    }
    renderPanel();
    updateLauncher();
    return true;
  }

  function mergeDocs(local, remote) {
    const byId = new Map();
    local.items.forEach((item) => byId.set(item.id, item));

    let changed = false;
    (remote.items || []).filter(validRecord).forEach((raw) => {
      const incoming = normalizeRecord(raw);
      const current = byId.get(incoming.id);
      if (!current) {
        byId.set(incoming.id, incoming);
        changed = true;
        return;
      }
      if (incoming.updatedAt > current.updatedAt) {
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
   * Chat context
   * ---------------------------------------------------------------- */

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

  function currentChatTitle() {
    const selected = document.querySelector(
      '[data-element-id="selected-chat-item"]'
    );
    const text = selected && selected.textContent.trim();
    if (text) return text.replace(/\s+/g, " ").slice(0, 120);
    const title = (document.title || "").replace(/\s*[|·-]\s*TypingMind.*$/i, "");
    return title.trim().slice(0, 120) || "Untitled chat";
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
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (parent.closest(SKIP_TEXT_SELECTOR)) {
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
      let cmp = 1;
      try {
        cmp = probe.comparePoint(node, node.data.length);
      } catch {
        cmp = 1;
      }
      if (cmp <= 0) total += node.data.length;
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
    const nodes = getTextNodes(root);
    let total = 0;
    let last = null;
    for (const node of nodes) {
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
    const a = locatePoint(root, start);
    const b = locatePoint(root, end);
    if (!a || !b) return null;
    try {
      const range = document.createRange();
      range.setStart(a.node, a.offset);
      range.setEnd(b.node, b.offset);
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
    const rect = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
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
    let out = "";
    const map = [];
    let prevSpace = false;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === " " || ch === "\n" || ch === "\t" || ch === "\r") {
        if (prevSpace) continue;
        out += " ";
        map.push(i);
        prevSpace = true;
      } else {
        out += ch;
        map.push(i);
        prevSpace = false;
      }
    }
    map.push(text.length);
    return { out, map };
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
    return findAll(source.out, target, 40).map((nStart) => ({
      start: source.map[nStart],
      end: source.map[Math.min(nStart + target.length, source.map.length - 1)],
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
    return { record, root: best.root, start: best.start, end: best.end };
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

  function marksById(id) {
    return Array.from(document.querySelectorAll(MARK_SELECTOR)).filter(
      (mark) => mark.dataset.tmhlId === id
    );
  }

  function unwrapMark(mark) {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
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
      for (let i = segments.length - 1; i >= 0; i -= 1) {
        const segment = segments[i];
        let target = segment.node;

        if (segment.end < target.data.length) target.splitText(segment.end);
        if (segment.start > 0) target = target.splitText(segment.start);

        const mark = document.createElement("mark");
        mark.className = "tmhl-mark";
        mark.dataset.tmhlId = record.id;
        mark.dataset.tmhlChat = record.chatId;
        mark.dataset.color = record.color;
        mark.dataset.seg = segmentAttr(i, segments.length);
        if (record.note) mark.dataset.note = "1";
        mark.title = record.note ? record.note : "";

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
          if (location.record.note) mark.dataset.note = "1";
          else delete mark.dataset.note;
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
    if (!record) return;
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
   * Mutations
   * ---------------------------------------------------------------- */

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
      if (!chatId || !itemsForChat(chatId).length) return;
      scheduleRestore(260);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  /* ------------------------------------------------------------------
   * Theme
   * ---------------------------------------------------------------- */

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
   * Styles
   * ---------------------------------------------------------------- */

  function injectStyles() {
    if (document.getElementById("tmhl-styles")) return;
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

  --tmhl-surface: rgba(255, 255, 255, .92);
  --tmhl-surface-solid: #ffffff;
  --tmhl-raised: rgba(0, 0, 0, .035);
  --tmhl-raised-2: rgba(0, 0, 0, .07);
  --tmhl-border: rgba(9, 9, 11, .12);
  --tmhl-border-soft: rgba(9, 9, 11, .07);
  --tmhl-text: #18181b;
  --tmhl-muted: #71717a;
  --tmhl-shadow: 0 24px 60px rgba(9, 9, 11, .16), 0 2px 8px rgba(9, 9, 11, .07);
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

  --tmhl-surface: rgba(24, 24, 27, .92);
  --tmhl-surface-solid: #18181b;
  --tmhl-raised: rgba(255, 255, 255, .05);
  --tmhl-raised-2: rgba(255, 255, 255, .1);
  --tmhl-border: rgba(255, 255, 255, .13);
  --tmhl-border-soft: rgba(255, 255, 255, .08);
  --tmhl-text: #f4f4f5;
  --tmhl-muted: #a1a1aa;
  --tmhl-shadow: 0 24px 60px rgba(0, 0, 0, .5), 0 2px 8px rgba(0, 0, 0, .35);
}

/* ---------- marks ---------- */

mark.tmhl-mark {
  --c: var(--tmhl-yellow);
  --c2: var(--tmhl-yellow-2);
  background-color: var(--c) !important;
  color: inherit !important;
  padding: 0 !important;
  margin: 0 !important;
  border-radius: .18em;
  box-shadow: 0 0 0 .1em var(--c), inset 0 -.085em 0 0 var(--c2);
  line-height: inherit !important;
  cursor: pointer;
  transition: background-color .14s ease, box-shadow .14s ease;
  -webkit-box-decoration-break: slice;
  box-decoration-break: slice;
}
mark.tmhl-mark[data-color="green"]  { --c: var(--tmhl-green);  --c2: var(--tmhl-green-2); }
mark.tmhl-mark[data-color="blue"]   { --c: var(--tmhl-blue);   --c2: var(--tmhl-blue-2); }
mark.tmhl-mark[data-color="pink"]   { --c: var(--tmhl-pink);   --c2: var(--tmhl-pink-2); }
mark.tmhl-mark[data-color="purple"] { --c: var(--tmhl-purple); --c2: var(--tmhl-purple-2); }
mark.tmhl-mark[data-seg="first"] { border-radius: .18em 0 0 .18em; }
mark.tmhl-mark[data-seg="mid"]   { border-radius: 0; }
mark.tmhl-mark[data-seg="last"]  { border-radius: 0 .18em .18em 0; }
mark.tmhl-mark[data-note="1"] { box-shadow: 0 0 0 .1em var(--c), inset 0 -.16em 0 0 var(--c2); }
mark.tmhl-mark:hover { background-color: var(--c2) !important; }
mark.tmhl-mark.tmhl-flash { animation: tmhl-flash 1.5s ease; }

@keyframes tmhl-flash {
  0%, 100% { box-shadow: 0 0 0 .1em var(--c), inset 0 -.085em 0 0 var(--c2); }
  15%, 55% { box-shadow: 0 0 0 .22em var(--c2), inset 0 -.085em 0 0 var(--c2); }
}

/* ---------- shared chrome ---------- */

#tmhl-toolbar, #tmhl-panel, #tmhl-launcher, #tmhl-toast {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif;
  color: var(--tmhl-text);
  box-sizing: border-box;
}
#tmhl-panel *, #tmhl-toolbar * { box-sizing: border-box; }

/* ---------- toolbar ---------- */

#tmhl-toolbar {
  position: fixed;
  z-index: 2147483646;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px;
  border: 1px solid var(--tmhl-border);
  border-radius: 14px;
  background: var(--tmhl-surface);
  backdrop-filter: blur(18px) saturate(160%);
  -webkit-backdrop-filter: blur(18px) saturate(160%);
  box-shadow: var(--tmhl-shadow);
  user-select: none;
  -webkit-user-select: none;
  touch-action: manipulation;
  animation: tmhl-pop .16s cubic-bezier(.2, .9, .3, 1.2);
}
#tmhl-toolbar[hidden] { display: none !important; }

@keyframes tmhl-pop {
  from { opacity: 0; transform: translateY(4px) scale(.96); }
  to   { opacity: 1; transform: none; }
}

.tmhl-swatch {
  width: 30px; height: 30px;
  display: inline-flex; align-items: center; justify-content: center;
  border: 0; border-radius: 9px; background: transparent;
  cursor: pointer; padding: 0;
}
.tmhl-swatch::before {
  content: "";
  width: 17px; height: 17px;
  border-radius: 6px;
  background: var(--sw);
  box-shadow: inset 0 0 0 1px var(--tmhl-border), 0 0 0 2px transparent;
  transition: transform .12s ease, box-shadow .12s ease;
}
.tmhl-swatch:hover::before { transform: scale(1.16); }
.tmhl-swatch[aria-pressed="true"]::before {
  box-shadow: inset 0 0 0 1px var(--tmhl-border), 0 0 0 2px var(--tmhl-text);
}

.tmhl-divider {
  width: 1px; height: 20px; margin: 0 2px;
  background: var(--tmhl-border-soft);
}

.tmhl-tool {
  height: 30px; min-width: 30px; padding: 0 8px;
  display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  border: 0; border-radius: 9px; background: transparent;
  color: var(--tmhl-text); cursor: pointer;
  font-size: 12px; font-weight: 550; line-height: 1;
}
.tmhl-tool:hover { background: var(--tmhl-raised-2); }
.tmhl-tool.tmhl-danger { color: #f87171; }
.tmhl-tool svg { width: 15px; height: 15px; }

@media (pointer: coarse) {
  #tmhl-toolbar { gap: 5px; padding: 6px; border-radius: 16px; }
  .tmhl-swatch { width: 38px; height: 38px; border-radius: 11px; }
  .tmhl-swatch::before { width: 20px; height: 20px; }
  .tmhl-tool { height: 38px; min-width: 38px; border-radius: 11px; }
  .tmhl-tool svg { width: 17px; height: 17px; }
}

/* ---------- docked action bar (phones) ---------- */

#tmhl-toolbar.tmhl-dock {
  left: 50% !important;
  transform: translateX(-50%);
  width: max-content;
  max-width: calc(100vw - 20px);
  border-radius: 16px;
  animation: tmhl-rise .18s cubic-bezier(.2, .9, .3, 1.1);
}

@keyframes tmhl-rise {
  from { opacity: 0; transform: translateX(-50%) translateY(12px); }
  to   { opacity: 1; transform: translateX(-50%); }
}

/* ---------- launcher ---------- */

#tmhl-launcher {
  position: fixed;
  left: 0; top: 0;
  z-index: 2147483640;
  display: inline-flex; align-items: center; gap: 7px;
  height: 34px; padding: 0 11px;
  border: 1px solid var(--tmhl-border);
  border-radius: 999px;
  background: var(--tmhl-surface);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow: var(--tmhl-shadow);
  color: var(--tmhl-text);
  font-size: 12px; font-weight: 600;
  cursor: grab;
  opacity: .5;
  touch-action: none;
  transition: opacity .18s ease, box-shadow .18s ease;
}
#tmhl-launcher:hover { opacity: 1; }
#tmhl-launcher[hidden] { display: none !important; }
#tmhl-launcher.tmhl-dragging {
  cursor: grabbing; opacity: 1;
  box-shadow: 0 12px 28px rgba(0, 0, 0, .34);
  transition: none;
}
#tmhl-launcher .tmhl-dot {
  width: 9px; height: 9px; border-radius: 3px;
  background: var(--tmhl-yellow-2);
}
#tmhl-launcher.tmhl-bump { animation: tmhl-bump .4s ease; }

@keyframes tmhl-bump {
  0% { transform: scale(1); }
  40% { transform: scale(1.12); opacity: 1; }
  100% { transform: scale(1); }
}

/* ---------- panel ---------- */

#tmhl-scrim {
  position: fixed; inset: 0;
  z-index: 2147483643;
  background: rgba(0, 0, 0, .34);
  backdrop-filter: blur(2px);
  opacity: 0; pointer-events: none;
  transition: opacity .22s ease;
}
#tmhl-scrim.tmhl-open { opacity: 1; pointer-events: auto; }

#tmhl-panel {
  position: fixed;
  top: 0; right: 0; bottom: 0;
  width: min(400px, 100vw);
  z-index: 2147483644;
  display: flex; flex-direction: column;
  background: var(--tmhl-surface-solid);
  border-left: 1px solid var(--tmhl-border);
  box-shadow: var(--tmhl-shadow);
  transform: translateX(102%);
  transition: transform .26s cubic-bezier(.32, .72, 0, 1);
}
#tmhl-panel.tmhl-open { transform: none; }

.tmhl-head {
  display: flex; align-items: center; gap: 8px;
  padding: 14px 14px 10px;
  border-bottom: 1px solid var(--tmhl-border-soft);
}
.tmhl-title {
  font-size: 14px; font-weight: 680; letter-spacing: -.01em;
  margin-right: auto;
}
.tmhl-count {
  font-size: 11px; font-weight: 600; color: var(--tmhl-muted);
  padding: 2px 7px; border-radius: 999px; background: var(--tmhl-raised);
}

.tmhl-controls { padding: 10px 14px; display: grid; gap: 9px; }

.tmhl-search {
  width: 100%; height: 34px; padding: 0 11px;
  border: 1px solid var(--tmhl-border);
  border-radius: 10px;
  background: var(--tmhl-raised);
  color: var(--tmhl-text);
  font-size: 13px; outline: none;
}
.tmhl-search:focus { border-color: var(--tmhl-muted); }
.tmhl-search::placeholder { color: var(--tmhl-muted); }

.tmhl-filters { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.tmhl-chip {
  height: 26px; padding: 0 9px;
  display: inline-flex; align-items: center; gap: 5px;
  border: 1px solid var(--tmhl-border-soft);
  border-radius: 999px;
  background: transparent; color: var(--tmhl-muted);
  font-size: 11.5px; font-weight: 600; cursor: pointer;
}
.tmhl-chip:hover { background: var(--tmhl-raised); }
.tmhl-chip[aria-pressed="true"] {
  color: var(--tmhl-text);
  background: var(--tmhl-raised-2);
  border-color: var(--tmhl-border);
}
.tmhl-chip i {
  width: 9px; height: 9px; border-radius: 3px; background: var(--sw); display: block;
}

.tmhl-list {
  flex: 1; overflow-y: auto; overscroll-behavior: contain;
  padding: 4px 12px 20px;
  display: flex; flex-direction: column; gap: 8px;
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
  content: ""; position: absolute; left: 0; top: 10px; bottom: 10px;
  width: 3px; border-radius: 0 3px 3px 0; background: var(--rail);
}

.tmhl-quote {
  font-family: ui-serif, Georgia, "Iowan Old Style", "Times New Roman", serif;
  font-size: 13.5px; line-height: 1.5;
  display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical;
  overflow: hidden;
}
.tmhl-card[data-expanded="1"] .tmhl-quote { -webkit-line-clamp: unset; }

.tmhl-note {
  margin-top: 7px; padding: 6px 8px;
  border-left: 2px solid var(--rail);
  border-radius: 0 6px 6px 0;
  background: var(--tmhl-raised-2);
  font-size: 12px; line-height: 1.45; color: var(--tmhl-text);
  white-space: pre-wrap;
}

.tmhl-meta {
  margin-top: 8px;
  display: flex; align-items: center; gap: 7px;
  font-size: 11px; color: var(--tmhl-muted);
}
.tmhl-meta .tmhl-chat {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 46%;
}
.tmhl-actions { margin-left: auto; display: flex; gap: 2px; }
.tmhl-act {
  width: 26px; height: 26px; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border: 0; border-radius: 7px; background: transparent;
  color: var(--tmhl-muted); cursor: pointer;
}
.tmhl-act:hover { background: var(--tmhl-raised-2); color: var(--tmhl-text); }
.tmhl-act.tmhl-danger:hover { color: #f87171; }
.tmhl-act svg { width: 14px; height: 14px; }

.tmhl-noteedit {
  margin-top: 8px; width: 100%; min-height: 62px; resize: vertical;
  padding: 8px 9px;
  border: 1px solid var(--tmhl-border); border-radius: 9px;
  background: var(--tmhl-surface-solid); color: var(--tmhl-text);
  font-size: 12.5px; line-height: 1.45; font-family: inherit; outline: none;
}

.tmhl-empty {
  margin: 34px 10px; text-align: center;
  font-size: 12.5px; line-height: 1.6; color: var(--tmhl-muted);
}
.tmhl-empty b { display: block; color: var(--tmhl-text); font-size: 13.5px; margin-bottom: 5px; }

.tmhl-foot {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  padding: 10px 12px calc(10px + env(safe-area-inset-bottom, 0px));
  border-top: 1px solid var(--tmhl-border-soft);
  background: var(--tmhl-surface-solid);
}
.tmhl-foot .tmhl-status { margin-left: auto; font-size: 11px; color: var(--tmhl-muted); }
.tmhl-btn {
  height: 28px; padding: 0 10px;
  border: 1px solid var(--tmhl-border-soft); border-radius: 8px;
  background: transparent; color: var(--tmhl-text);
  font-size: 11.5px; font-weight: 600; cursor: pointer;
}
.tmhl-btn:hover { background: var(--tmhl-raised-2); }
.tmhl-btn.tmhl-danger { color: #f87171; }

.tmhl-settings { padding: 4px 14px 18px; overflow-y: auto; flex: 1; }
.tmhl-field { margin-bottom: 13px; }
.tmhl-label {
  display: block; margin-bottom: 5px;
  font-size: 11.5px; font-weight: 650; color: var(--tmhl-text);
}
.tmhl-help { margin-top: 5px; font-size: 11px; line-height: 1.5; color: var(--tmhl-muted); }
.tmhl-input {
  width: 100%; padding: 8px 10px;
  border: 1px solid var(--tmhl-border); border-radius: 9px;
  background: var(--tmhl-raised); color: var(--tmhl-text);
  font-size: 12.5px; font-family: inherit; outline: none;
}
textarea.tmhl-input { min-height: 64px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; }
.tmhl-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }

.tmhl-switch {
  position: relative; width: 40px; height: 23px; flex: 0 0 40px;
  border: 0; border-radius: 999px; background: var(--tmhl-raised-2);
  cursor: pointer; transition: background .16s ease;
}
.tmhl-switch::after {
  content: ""; position: absolute; top: 3px; left: 3px;
  width: 17px; height: 17px; border-radius: 50%;
  background: var(--tmhl-text); opacity: .55;
  transition: transform .16s ease, opacity .16s ease;
}
.tmhl-switch[aria-checked="true"] { background: var(--tmhl-green-2); }
.tmhl-switch[aria-checked="true"]::after { transform: translateX(17px); opacity: 1; }

@media (max-width: 720px) {
  #tmhl-panel {
    top: auto; left: 0; right: 0; bottom: 0;
    width: 100%; height: min(80vh, 680px);
    border-left: 0; border-top: 1px solid var(--tmhl-border);
    border-radius: 18px 18px 0 0;
    transform: translateY(102%);
  }
  #tmhl-panel.tmhl-open { transform: none; }
  #tmhl-panel::before {
    content: ""; position: absolute; top: 7px; left: 50%;
    width: 36px; height: 4px; margin-left: -18px;
    border-radius: 999px; background: var(--tmhl-border);
  }
  .tmhl-head { padding-top: 18px; }
  #tmhl-launcher { height: 38px; padding: 0 13px; opacity: .62; }
  #tmhl-toast { bottom: calc(96px + env(safe-area-inset-bottom, 0px)); }
}

/* ---------- toast ---------- */

#tmhl-toast {
  position: fixed; left: 50%; bottom: max(26px, env(safe-area-inset-bottom, 0px));
  z-index: 2147483647; transform: translateX(-50%);
  max-width: calc(100vw - 28px);
  padding: 9px 14px;
  border: 1px solid var(--tmhl-border);
  border-radius: 11px;
  background: var(--tmhl-surface);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow: var(--tmhl-shadow);
  font-size: 12.5px; line-height: 1.35; text-align: center;
  pointer-events: none;
  animation: tmhl-pop .16s ease;
}
#tmhl-toast[hidden] { display: none !important; }

@media (prefers-reduced-motion: reduce) {
  #tmhl-panel, #tmhl-scrim, #tmhl-toolbar, #tmhl-launcher, mark.tmhl-mark {
    transition: none !important; animation: none !important;
  }
}
`;
    document.head.appendChild(style);
  }

  /* ------------------------------------------------------------------
   * Icons
   * ---------------------------------------------------------------- */

  const ICON = {
    note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.4-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1A1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.4l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.6 1H23a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>',
    jump: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg>'
  };

  /* ------------------------------------------------------------------
   * Toast
   * ---------------------------------------------------------------- */

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
   * Toolbar
   * ---------------------------------------------------------------- */

  let toolbar = null;
  let captured = null;
  let activeId = null;

  function bindPress(node, action) {
    let last = 0;
    const run = (event) => {
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
      html: icon
    });
    bindPress(button, action);
    return button;
  }

  function composerTop() {
    const node = document.querySelector(
      '[data-element-id="chat-space-end-part"], [data-element-id="chat-input-textbox"]'
    );
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    if (rect.height <= 0) return null;
    const vh = window.innerHeight;
    return rect.top > vh * 0.3 && rect.top < vh ? rect.top : null;
  }

  function useDockedBar() {
    return isNarrow() || isTouch();
  }

  function positionToolbar(rect) {
    if (!toolbar) return;
    toolbar.style.visibility = "hidden";
    toolbar.hidden = false;

    requestAnimationFrame(() => {
      if (toolbar.hidden) return;

      const viewport = window.visualViewport;
      const vw = (viewport && viewport.width) || window.innerWidth;
      const vh = (viewport && viewport.height) || window.innerHeight;
      const width = toolbar.offsetWidth;
      const height = toolbar.offsetHeight;

      // Phones: park the bar just above the composer. Predictable, thumb
      // reachable, and it never collides with the native selection popup.
      if (useDockedBar()) {
        toolbar.classList.add("tmhl-dock");
        const floor = composerTop();
        const gap = 14;
        const top = clamp(
          (floor === null ? vh - gap : floor - gap) - height,
          10,
          Math.max(10, vh - height - 10)
        );
        toolbar.style.left = "";
        toolbar.style.top = `${Math.round(top)}px`;
        toolbar.style.visibility = "visible";
        return;
      }

      toolbar.classList.remove("tmhl-dock");

      if (!rect) {
        toolbar.hidden = true;
        return;
      }

      const left = clamp(
        rect.left + rect.width / 2 - width / 2,
        8,
        Math.max(8, vw - width - 8)
      );
      const above = rect.top - height - 12;
      const below = rect.bottom + 12;
      const top = clamp(
        above >= 8 ? above : below,
        8,
        Math.max(8, vh - height - 8)
      );

      toolbar.style.left = `${Math.round(left)}px`;
      toolbar.style.top = `${Math.round(top)}px`;
      toolbar.style.visibility = "visible";
    });
  }

  function hideToolbar(reset) {
    if (toolbar) {
      toolbar.hidden = true;
      toolbar.style.visibility = "";
    }
    if (reset !== false) {
      captured = null;
      activeId = null;
    }
  }

  function showCreateToolbar(rect) {
    if (!toolbar) return;
    activeId = null;
    toolbar.replaceChildren();

    COLORS.forEach((color) => {
      toolbar.appendChild(
        swatchButton(color, color === settings.defaultColor, (picked) =>
          commitHighlight(picked)
        )
      );
    });

    toolbar.appendChild(el("span", { class: "tmhl-divider" }));
    toolbar.appendChild(
      toolButton(ICON.copy, "Copy text", async () => {
        if (!captured) return;
        const ok = await copyText(captured.exact);
        hideToolbar();
        toast(ok ? "Copied." : "Copy blocked by the browser.");
      })
    );
    toolbar.appendChild(
      toolButton(ICON.list, "Open highlights", () => {
        hideToolbar();
        openPanel();
      })
    );
    toolbar.appendChild(toolButton(ICON.close, "Close", () => hideToolbar()));

    positionToolbar(rect);
  }

  function showEditToolbar(id, rect) {
    const record = findRecord(id);
    if (!toolbar || !record || record.deleted) return;

    captured = null;
    activeId = id;
    toolbar.replaceChildren();

    COLORS.forEach((color) => {
      toolbar.appendChild(
        swatchButton(color, color === record.color, (picked) =>
          recolorHighlight(id, picked)
        )
      );
    });

    toolbar.appendChild(el("span", { class: "tmhl-divider" }));
    toolbar.appendChild(
      toolButton(ICON.note, record.note ? "Edit note" : "Add note", () => {
        hideToolbar();
        openPanel();
        startNoteEdit(id);
      })
    );
    toolbar.appendChild(
      toolButton(ICON.copy, "Copy text", async () => {
        const ok = await copyText(record.exact);
        hideToolbar();
        toast(ok ? "Copied." : "Copy blocked by the browser.");
      })
    );
    toolbar.appendChild(
      toolButton(ICON.list, "Open highlights", () => {
        hideToolbar();
        openPanel();
      })
    );
    toolbar.appendChild(
      toolButton(ICON.trash, "Delete highlight", () => deleteHighlight(id), "tmhl-danger")
    );
    toolbar.appendChild(toolButton(ICON.close, "Close", () => hideToolbar()));

    positionToolbar(rect);
  }

  /* ------------------------------------------------------------------
   * Selection capture
   * ---------------------------------------------------------------- */

  let selectionTimer = 0;

  function overlapsRendered(root, start, end) {
    return rendered.filter(
      (item) => item.root === root && start < item.end && end > item.start
    );
  }

  function captureSelection() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;

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
    selectionTimer = window.setTimeout(captureSelection, delay || 240);
  }

  /* ------------------------------------------------------------------
   * Mutations to the store
   * ---------------------------------------------------------------- */

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
      if (note) mark.dataset.note = "1";
      else delete mark.dataset.note;
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
    if (!window.confirm(`Delete ${targets.length} highlights in this chat?`)) return;
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
    if (!window.confirm(`Delete all ${count} highlights on every chat?`)) return;
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
   * Export / import
   * ---------------------------------------------------------------- */

  function exportJson() {
    return JSON.stringify(
      { version: 3, updatedAt: store.updatedAt, items: store.items },
      null,
      2
    );
  }

  function exportMarkdown(scopeChatId) {
    const items = liveItems()
      .filter((item) => !scopeChatId || item.chatId === scopeChatId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    const groups = new Map();
    items.forEach((item) => {
      const key = item.chatTitle || item.chatId;
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
    const input = el("input", { type: "file", accept: "application/json" });
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
   * Panel
   * ---------------------------------------------------------------- */

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
    editingNote: null
  };

  function buildPanel() {
    scrim = el("div", { id: "tmhl-scrim", "data-tmhl-ui": "true" });
    scrim.addEventListener("click", closePanel);

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

    const listTab = toolButton(ICON.list, "Highlights", () => setTab("list"));
    const gearTab = toolButton(ICON.gear, "Settings", () => setTab("settings"));
    const closeBtn = toolButton(ICON.close, "Close", () => closePanel());
    head.append(listTab, gearTab, closeBtn);
    panel.appendChild(head);

    const controls = el("div", { class: "tmhl-controls" });
    const search = el("input", {
      class: "tmhl-search",
      type: "search",
      placeholder: "Search highlights and notes"
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
      scopeChip.setAttribute("aria-pressed", "true");
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
    const exportMd = el("button", { class: "tmhl-btn", text: "Export .md" });
    exportMd.addEventListener("click", () =>
      downloadFile(
        "highlights.md",
        exportMarkdown(view.scope === "chat" ? currentChatId() : null),
        "text/markdown"
      )
    );
    const exportJs = el("button", { class: "tmhl-btn", text: "Backup .json" });
    exportJs.addEventListener("click", () =>
      downloadFile("highlights.json", exportJson(), "application/json")
    );
    const importBtn = el("button", { class: "tmhl-btn", text: "Import" });
    importBtn.addEventListener("click", pickImportFile);
    statusNode = el("span", { class: "tmhl-status", text: "" });
    foot.append(exportMd, exportJs, importBtn, statusNode);
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
    if (!showList) renderSettings();
    else renderList();
  }

  function openPanel() {
    if (!panel) return;
    view.open = true;
    panel.classList.add("tmhl-open");
    if (isNarrow()) scrim.classList.add("tmhl-open");
    renderPanel();
  }

  function closePanel() {
    if (!panel) return;
    view.open = false;
    view.editingNote = null;
    panel.classList.remove("tmhl-open");
    scrim.classList.remove("tmhl-open");
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
          (item.chatTitle || "").toLowerCase().includes(view.query)
      );
    }
    return items.sort((a, b) => {
      if (a.chatId === b.chatId) return a.createdAt.localeCompare(b.createdAt);
      return b.updatedAt - a.updatedAt;
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
        placeholder: "Write a note. Enter saves, Shift+Enter adds a line."
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
      });
      area.addEventListener("blur", () => {
        if (view.editingNote !== record.id) return;
        view.editingNote = null;
        setNote(record.id, area.value.trim());
      });
      card.appendChild(area);
      window.setTimeout(() => area.focus(), 30);
    }

    const meta = el("div", { class: "tmhl-meta" });
    meta.appendChild(el("span", { text: relativeTime(record.createdAt) }));
    if (view.scope === "all" && record.chatTitle) {
      meta.appendChild(el("span", { text: "·" }));
      meta.appendChild(
        el("span", { class: "tmhl-chat", text: record.chatTitle })
      );
    }

    const actions = el("div", { class: "tmhl-actions" });

    const noteBtn = el("button", {
      class: "tmhl-act",
      title: record.note ? "Edit note" : "Add note",
      html: ICON.note
    });
    noteBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      view.editingNote = view.editingNote === record.id ? null : record.id;
      renderList();
    });

    const copyBtn = el("button", {
      class: "tmhl-act",
      title: "Copy text",
      html: ICON.copy
    });
    copyBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      const ok = await copyText(
        record.note ? `${record.exact}\n\n${record.note}` : record.exact
      );
      toast(ok ? "Copied." : "Copy blocked by the browser.");
    });

    const jumpBtn = el("button", {
      class: "tmhl-act",
      title: "Jump to highlight",
      html: ICON.jump
    });
    jumpBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      jumpTo(record);
    });

    const delBtn = el("button", {
      class: "tmhl-act tmhl-danger",
      title: "Delete",
      html: ICON.trash
    });
    delBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteHighlight(record.id);
    });

    actions.append(noteBtn, copyBtn, jumpBtn, delBtn);
    meta.appendChild(actions);
    card.appendChild(meta);

    card.addEventListener("click", () => jumpTo(record));
    card.addEventListener("dblclick", () => {
      card.dataset.expanded = card.dataset.expanded === "1" ? "0" : "1";
    });

    return card;
  }

  function renderList() {
    if (!listNode) return;
    const records = visibleRecords();
    listNode.replaceChildren();

    if (!records.length) {
      const empty = el("div", { class: "tmhl-empty" });
      empty.appendChild(
        el("b", {
          text: view.query ? "Nothing matches that." : "No highlights yet."
        })
      );
      empty.appendChild(
        el("span", {
          text: view.query
            ? "Try a shorter search or switch to All chats."
            : "Select any text in a message, then pick a color. Alt+H uses your last color."
        })
      );
      listNode.appendChild(empty);
      return;
    }

    records.forEach((record) => listNode.appendChild(buildCard(record)));
  }

  function renderSettings() {
    if (!settingsNode) return;
    settingsNode.replaceChildren();

    const launcherField = el("div", { class: "tmhl-field" });
    const launcherRow = el("div", { class: "tmhl-row" });
    launcherRow.appendChild(
      el("span", { class: "tmhl-label", text: "Floating button" })
    );
    const launcherToggle = el("button", {
      class: "tmhl-switch",
      role: "switch",
      "aria-checked": settings.showLauncher ? "true" : "false",
      "aria-label": "Show the floating button"
    });
    launcherToggle.addEventListener("click", () => {
      settings.showLauncher = !settings.showLauncher;
      saveSettings();
      renderSettings();
      updateLauncher();
      if (!settings.showLauncher) {
        toast("Hidden. Select any text and tap the list icon to get back here.");
      }
    });
    launcherRow.appendChild(launcherToggle);
    launcherField.appendChild(launcherRow);
    launcherField.appendChild(
      el("div", {
        class: "tmhl-help",
        text:
          "Drag it anywhere and it snaps to the nearest edge. With it off, select any text and tap the list icon in the action bar to reopen this panel."
      })
    );
    settingsNode.appendChild(launcherField);

    const positionField = el("div", { class: "tmhl-field tmhl-filters" });
    const resetPosition = el("button", {
      class: "tmhl-btn",
      text: "Reset button position"
    });
    resetPosition.addEventListener("click", () => {
      settings.launcher = { ...DEFAULT_SETTINGS.launcher };
      settings.showLauncher = true;
      saveSettings();
      updateLauncher();
      renderSettings();
      toast("Button reset.");
    });
    positionField.appendChild(resetPosition);
    settingsNode.appendChild(positionField);

    const colorField = el("div", { class: "tmhl-field" });
    colorField.appendChild(
      el("label", { class: "tmhl-label", text: "Default color" })
    );
    const colorRow = el("div", { class: "tmhl-filters" });
    COLORS.forEach((color) => {
      colorRow.appendChild(
        swatchButton(color, color === settings.defaultColor, (picked) => {
          settings.defaultColor = picked;
          saveSettings();
          renderSettings();
        })
      );
    });
    colorField.appendChild(colorRow);
    colorField.appendChild(
      el("div", {
        class: "tmhl-help",
        text: "Used by Alt+H, and preselected in the action bar."
      })
    );
    settingsNode.appendChild(colorField);

    const dangerField = el("div", { class: "tmhl-field tmhl-filters" });
    const clearChat = el("button", {
      class: "tmhl-btn tmhl-danger",
      text: "Clear this chat"
    });
    clearChat.addEventListener("click", clearChatHighlights);
    const clearAll = el("button", {
      class: "tmhl-btn tmhl-danger",
      text: "Clear everything"
    });
    clearAll.addEventListener("click", clearAllHighlights);
    dangerField.append(clearChat, clearAll);
    settingsNode.appendChild(dangerField);

    settingsNode.appendChild(
      el("div", { class: "tmhl-help", text: `Highlighter v${VERSION}` })
    );
  }

  function renderStatus() {
    if (!statusNode) return;
    const total = liveItems().length;
    statusNode.textContent = total === 1 ? "1 saved here" : `${total} saved here`;
  }

  function renderPanel() {
    if (!panel) return;
    if (countNode) {
      const chatCount = itemsForChat(currentChatId()).length;
      const total = liveItems().length;
      countNode.textContent =
        view.scope === "chat" ? `${chatCount}` : `${total}`;
    }
    if (view.tab === "list") renderList();
    else renderSettings();
    renderStatus();
  }

  /* ------------------------------------------------------------------
   * Launcher
   * ---------------------------------------------------------------- */

  function buildLauncher() {
    launcher = el("button", {
      id: "tmhl-launcher",
      type: "button",
      "data-tmhl-ui": "true",
      "aria-label": "Open highlights"
    });
    launcher.appendChild(el("span", { class: "tmhl-dot" }));
    launcher.appendChild(el("span", { class: "tmhl-label-count", text: "0" }));
    document.body.appendChild(launcher);
    enableLauncherDrag();
    layoutLauncher();
  }

  function layoutLauncher() {
    if (!launcher || launcher.hidden) return;
    const margin = 12;
    const width = launcher.offsetWidth || 62;
    const height = launcher.offsetHeight || 34;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pos = settings.launcher || DEFAULT_SETTINGS.launcher;

    const left =
      pos.side === "left" ? margin : Math.max(margin, vw - width - margin);
    const top = clamp(
      (Number(pos.topPct) || 0.6) * vh - height / 2,
      margin,
      Math.max(margin, vh - height - margin)
    );

    launcher.style.left = `${Math.round(left)}px`;
    launcher.style.top = `${Math.round(top)}px`;
  }

  function enableLauncherDrag() {
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let grabX = 0;
    let grabY = 0;

    launcher.addEventListener("pointerdown", (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      const box = launcher.getBoundingClientRect();
      dragging = true;
      moved = false;
      startX = event.clientX;
      startY = event.clientY;
      grabX = event.clientX - box.left;
      grabY = event.clientY - box.top;
      try {
        launcher.setPointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
    });

    launcher.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const travel = Math.hypot(event.clientX - startX, event.clientY - startY);
      if (!moved && travel < 6) return;

      moved = true;
      launcher.classList.add("tmhl-dragging");

      const margin = 8;
      const width = launcher.offsetWidth;
      const height = launcher.offsetHeight;
      const left = clamp(
        event.clientX - grabX,
        margin,
        Math.max(margin, window.innerWidth - width - margin)
      );
      const top = clamp(
        event.clientY - grabY,
        margin,
        Math.max(margin, window.innerHeight - height - margin)
      );
      launcher.style.left = `${Math.round(left)}px`;
      launcher.style.top = `${Math.round(top)}px`;
    });

    launcher.addEventListener("pointerup", (event) => {
      if (!dragging) return;
      dragging = false;
      try {
        launcher.releasePointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }

      if (!moved) {
        togglePanel();
        return;
      }

      launcher.classList.remove("tmhl-dragging");
      const box = launcher.getBoundingClientRect();
      settings.launcher = {
        side:
          box.left + box.width / 2 < window.innerWidth / 2 ? "left" : "right",
        topPct: clamp(
          (box.top + box.height / 2) / window.innerHeight,
          0.05,
          0.95
        )
      };
      saveSettings();
      layoutLauncher();
    });

    launcher.addEventListener("pointercancel", () => {
      dragging = false;
      moved = false;
      launcher.classList.remove("tmhl-dragging");
      layoutLauncher();
    });

    launcher.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
  }

  function updateLauncher() {
    if (!launcher) return;
    const chatId = currentChatId();
    const count = chatId ? itemsForChat(chatId).length : liveItems().length;
    const label = launcher.querySelector(".tmhl-label-count");
    if (label) label.textContent = String(count);
    launcher.hidden = !settings.showLauncher;
    if (!launcher.hidden) layoutLauncher();
  }

  function bumpLauncher() {
    if (!launcher) return;
    launcher.classList.remove("tmhl-bump");
    void launcher.offsetWidth;
    launcher.classList.add("tmhl-bump");
    window.setTimeout(() => launcher.classList.remove("tmhl-bump"), 500);
  }

  // Swipe the sheet header down to dismiss on phones.
  function enableSheetDrag() {
    if (!panel) return;
    const head = panel.querySelector(".tmhl-head");
    if (!head) return;

    let active = false;
    let startY = 0;
    let delta = 0;

    head.addEventListener(
      "touchstart",
      (event) => {
        if (!isNarrow() || event.touches.length !== 1) return;
        active = true;
        delta = 0;
        startY = event.touches[0].clientY;
        panel.style.transition = "none";
      },
      { passive: true }
    );

    head.addEventListener(
      "touchmove",
      (event) => {
        if (!active) return;
        delta = Math.max(0, event.touches[0].clientY - startY);
        panel.style.transform = `translateY(${delta}px)`;
      },
      { passive: true }
    );

    const release = () => {
      if (!active) return;
      active = false;
      panel.style.transition = "";
      panel.style.transform = "";
      if (delta > 90) closePanel();
      delta = 0;
    };

    head.addEventListener("touchend", release);
    head.addEventListener("touchcancel", release);
  }

  function startNoteEdit(id) {
    view.editingNote = id;
    view.tab = "list";
    setTab("list");
  }

  /* ------------------------------------------------------------------
   * Global events
   * ---------------------------------------------------------------- */

  function markFromEvent(event) {
    if (!(event.target instanceof Element)) return null;
    const mark = event.target.closest(MARK_SELECTOR);
    if (!mark || !mark.dataset.tmhlId) return null;
    return mark;
  }

  function onDocumentClick(event) {
    if (toolbar && toolbar.contains(event.target)) return;
    if (panel && panel.contains(event.target)) return;

    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;

    const mark = markFromEvent(event);
    if (!mark) return;

    event.preventDefault();
    event.stopPropagation();

    const location = rendered.find(
      (item) => item.record.id === mark.dataset.tmhlId
    );
    let rect = location ? rangeRect(rangeFromOffsets(location.root, location.start, location.end)) : null;
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
    if (toolbar && toolbar.contains(event.target)) return;
    if (panel && panel.contains(event.target)) return;
    if (markFromEvent(event)) return;
    if (toolbar && !toolbar.hidden) hideToolbar();
  }

  function onKeyDown(event) {
    const target = event.target;
    const typing =
      target instanceof Element &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable);

    if (event.key === "Escape") {
      if (typing && panel && panel.contains(target)) return;
      if (toolbar && !toolbar.hidden) hideToolbar();
      else if (view.open) closePanel();
      return;
    }

    if (event.altKey && !event.ctrlKey && !event.metaKey) {
      const key = event.key.toLowerCase();
      if (key === "h") {
        event.preventDefault();
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
      (event.key === "ArrowLeft" ||
        event.key === "ArrowRight" ||
        event.key === "ArrowUp" ||
        event.key === "ArrowDown" ||
        event.key === "Shift")
    ) {
      scheduleCapture(90);
    }
  }

  function onNavigation() {
    hideToolbar();
    rendered = [];
    pendingJumpTries = 0;
    bumpTextCache();
    scheduleRestore(320);
    renderPanel();
  }

  function onStorage(event) {
    if (event.key === LS_DATA) {
      store = loadStore();
      scheduleRestore(40);
      renderPanel();
      updateLauncher();
    }
    if (event.key === LS_SETTINGS) {
      settings = loadSettings();
      updateLauncher();
    }
  }

  function startBus() {
    if (typeof BroadcastChannel === "undefined") return;
    try {
      bus = new BroadcastChannel(CHANNEL_NAME);
      bus.onmessage = (event) => {
        if (!event.data || event.data.type !== "changed") return;
        store = loadStore();
        scheduleRestore(40);
        renderPanel();
        updateLauncher();
      };
    } catch {
      bus = null;
    }
  }

  /* ------------------------------------------------------------------
   * Init
   * ---------------------------------------------------------------- */

  function initialize() {
    applyTheme();
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
      role: "status"
    });
    toastNode.hidden = true;

    document.body.append(toolbar, toastNode);

    buildPanel();
    buildLauncher();
    enableSheetDrag();
    updateLauncher();
    renderPanel();

    document.addEventListener("selectionchange", () => scheduleCapture(300), true);
    document.addEventListener("pointerup", () => scheduleCapture(60), true);
    document.addEventListener("mouseup", () => scheduleCapture(60), true);
    document.addEventListener("touchend", () => scheduleCapture(420), {
      capture: true,
      passive: true
    });
    document.addEventListener("click", onDocumentClick, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);

    window.addEventListener("hashchange", onNavigation);
    window.addEventListener("popstate", onNavigation);
    window.addEventListener("storage", onStorage);
    window.addEventListener(
      "resize",
      debounce(() => {
        if (toolbar && !toolbar.hidden) hideToolbar();
        layoutLauncher();
      }, 120)
    );
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", () => {
        if (toolbar && !toolbar.hidden) hideToolbar();
      });
    }

    const themeObserver = new MutationObserver(applyTheme);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"]
    });
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", applyTheme);

    startObserver();
    startBus();

    if (pruneTombstones()) {
      try {
        localStorage.setItem(LS_DATA, JSON.stringify(store));
      } catch {
        /* ignore */
      }
    }

    scheduleRestore(400);

    window.TMHighlighter = {
      version: VERSION,
      restore: () => restoreHighlights(),
      open: () => openPanel(),
      close: () => closePanel(),
      toggle: () => togglePanel(),
      all: () => structuredCopy(liveItems()),
      export: () => exportJson(),
      exportMarkdown: (chatId) => exportMarkdown(chatId || null),
      import: (input) => importJson(input),
      showButton: () => {
        settings.showLauncher = true;
        settings.launcher = { ...DEFAULT_SETTINGS.launcher };
        saveSettings();
        updateLauncher();
        renderPanel();
        return true;
      },
      clearChat: () => clearChatHighlights(),
      clearAll: () => clearAllHighlights(),
      delete: (id) => deleteHighlight(id)
    };

    window[FLAG] = { loaded: true, version: VERSION };
    console.info(`[TM Highlighter] v${VERSION} ready. Alt+H highlight, Alt+L panel.`);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
