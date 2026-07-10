(() => {
  "use strict";

  const EXTENSION_FLAG = "__TM_PERSISTENT_HIGHLIGHTER_V2__";
  const STORAGE_KEY = "typingmind-persistent-highlights-v2";
  const VERSION = "2.0.0";

  if (window[EXTENSION_FLAG]) return;
  window[EXTENSION_FLAG] = { loading: true, version: VERSION };

  const COLORS = {
    yellow: "rgba(250, 204, 21, 0.60)",
    green: "rgba(74, 222, 128, 0.50)",
    blue: "rgba(96, 165, 250, 0.50)",
    pink: "rgba(244, 114, 182, 0.50)"
  };

  const HIGHLIGHT_NAMES = {
    yellow: "tmph-yellow",
    green: "tmph-green",
    blue: "tmph-blue",
    pink: "tmph-pink"
  };

  const RESPONSE_BLOCK_SELECTOR =
    '[data-element-id="response-block"]';

  const AI_RESPONSE_SELECTOR =
    '[data-element-id="ai-response"]';

  const FALLBACK_MARK_SELECTOR =
    "mark.tmph-fallback-mark";

  const supportsCustomHighlights =
    typeof window.Highlight === "function" &&
    window.CSS &&
    CSS.highlights &&
    typeof CSS.highlights.set === "function";

  let state = readState();
  let toolbar = null;
  let toastElement = null;
  let toastTimer = null;
  let selectionTimer = null;
  let restoreTimer = null;
  let observer = null;
  let capturedSelection = null;
  let activeHighlightId = null;
  let renderedHighlights = [];
  let applyingHighlights = false;

  function emptyState() {
    return {
      version: 2,
      items: []
    };
  }

  function readState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);

      if (!raw) return emptyState();

      const parsed = JSON.parse(raw);

      if (!parsed || !Array.isArray(parsed.items)) {
        return emptyState();
      }

      return {
        version: 2,
        items: parsed.items.filter(isValidRecord)
      };
    } catch (error) {
      console.warn("[TypingMind Highlighter] Could not read storage.", error);
      return emptyState();
    }
  }

  function isValidRecord(record) {
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

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (error) {
      console.error(
        "[TypingMind Highlighter] Could not save highlights.",
        error
      );

      showToast("Could not save the highlight.");
      return false;
    }
  }

  function makeId() {
    if (
      window.crypto &&
      typeof window.crypto.randomUUID === "function"
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

    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }

    return `${(hash >>> 0).toString(36)}:${text.length}`;
  }

  function currentChatId() {
    const match = window.location.href.match(
      /(?:#|[?&])chat=([^&?#]+)/
    );

    if (match && match[1]) {
      try {
        return decodeURIComponent(match[1]);
      } catch {
        return match[1];
      }
    }

    const selectedChat = document.querySelector(
      '[data-element-id="selected-chat-item"]'
    );

    if (selectedChat) {
      const directId =
        selectedChat.getAttribute("data-chat-id") ||
        selectedChat.dataset.chatId;

      if (directId) return String(directId);

      const link =
        selectedChat.matches("a") ?
          selectedChat :
          selectedChat.closest("a") ||
          selectedChat.querySelector("a");

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

  function getResponseRoots() {
    const container =
      document.querySelector(".dynamic-chat-content-container") ||
      document;

    let selector = RESPONSE_BLOCK_SELECTOR;
    let roots = Array.from(container.querySelectorAll(selector));

    if (!roots.length) {
      selector = AI_RESPONSE_SELECTOR;
      roots = Array.from(container.querySelectorAll(selector));
    }

    return roots.filter((element) => {
      if (!element.isConnected) return false;

      const parentMatch =
        element.parentElement &&
        element.parentElement.closest(selector);

      return !parentMatch;
    });
  }

  function responseRootFromNode(node) {
    if (!node) return null;

    const element =
      node.nodeType === Node.ELEMENT_NODE ?
        node :
        node.parentElement;

    if (!element) return null;

    return (
      element.closest(RESPONSE_BLOCK_SELECTOR) ||
      element.closest(AI_RESPONSE_SELECTOR)
    );
  }

  function getTextNodes(root) {
    const nodes = [];

    if (!root) return nodes;

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parent = node.parentElement;

          if (!parent) {
            return NodeFilter.FILTER_REJECT;
          }

          if (
            parent.closest(
              'script, style, noscript, [data-tmph-ui="true"]'
            )
          ) {
            return NodeFilter.FILTER_REJECT;
          }

          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let currentNode = walker.nextNode();

    while (currentNode) {
      nodes.push(currentNode);
      currentNode = walker.nextNode();
    }

    return nodes;
  }

  function rootText(root) {
    return getTextNodes(root)
      .map((node) => node.data)
      .join("");
  }

  function pointOffset(root, container, offset) {
    if (!root || !container || !root.contains(container)) {
      return null;
    }

    try {
      const range = document.createRange();
      range.selectNodeContents(root);
      range.setEnd(container, offset);

      const value = range.toString().length;
      range.detach?.();

      return value;
    } catch {
      return null;
    }
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

    const start = pointOffset(
      root,
      range.startContainer,
      range.startOffset
    );

    const end = pointOffset(
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

    return { start, end };
  }

  function locateTextPoint(root, targetOffset) {
    const nodes = getTextNodes(root);
    let total = 0;
    let lastNode = null;

    for (const node of nodes) {
      const length = node.data.length;
      lastNode = node;

      if (targetOffset <= total + length) {
        return {
          node,
          offset: Math.max(
            0,
            Math.min(length, targetOffset - total)
          )
        };
      }

      total += length;
    }

    if (lastNode) {
      return {
        node: lastNode,
        offset: lastNode.data.length
      };
    }

    return null;
  }

  function rangeFromOffsets(root, start, end) {
    if (!root || start < 0 || end <= start) {
      return null;
    }

    const startPoint = locateTextPoint(root, start);
    const endPoint = locateTextPoint(root, end);

    if (!startPoint || !endPoint) {
      return null;
    }

    try {
      const range = document.createRange();

      range.setStart(startPoint.node, startPoint.offset);
      range.setEnd(endPoint.node, endPoint.offset);

      return range;
    } catch {
      return null;
    }
  }

  function getRangeRect(range) {
    if (!range) return null;

    const rects = Array.from(range.getClientRects()).filter(
      (rect) => rect.width > 0 || rect.height > 0
    );

    const rect =
      rects.length ?
        rects[rects.length - 1] :
        range.getBoundingClientRect();

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

  function findOccurrences(text, searchText, maximum = 250) {
    const positions = [];

    if (!searchText) return positions;

    let index = text.indexOf(searchText);

    while (index !== -1 && positions.length < maximum) {
      positions.push(index);
      index = text.indexOf(searchText, index + 1);
    }

    return positions;
  }

  function resolveRecord(record, roots) {
    if (!record || !record.exact || !roots.length) {
      return null;
    }

    const rootInfo = roots.map((root, index) => {
      const text = rootText(root);

      return {
        root,
        index,
        text,
        hash: hashText(text)
      };
    });

    let bestMatch = null;

    for (const info of rootInfo) {
      const positions = findOccurrences(
        info.text,
        record.exact
      );

      for (const start of positions) {
        const end = start + record.exact.length;
        let score = 0;

        if (info.hash === record.messageHash) {
          score += 10000;
        }

        if (info.index === record.messageIndex) {
          score += 800;
        }

        if (start === record.start) {
          score += 500;
        }

        if (record.prefix) {
          const before = info.text.slice(
            Math.max(0, start - record.prefix.length),
            start
          );

          if (before.endsWith(record.prefix)) {
            score += 2500;
          }
        }

        if (record.suffix) {
          const after = info.text.slice(
            end,
            end + record.suffix.length
          );

          if (after.startsWith(record.suffix)) {
            score += 2500;
          }
        }

        score -= Math.min(
          Math.abs(start - record.start),
          10000
        ) / 100;

        if (!bestMatch || score > bestMatch.score) {
          bestMatch = {
            root: info.root,
            rootIndex: info.index,
            start,
            end,
            score
          };
        }
      }
    }

    if (!bestMatch) return null;

    const range = rangeFromOffsets(
      bestMatch.root,
      bestMatch.start,
      bestMatch.end
    );

    if (!range) return null;

    return {
      record,
      root: bestMatch.root,
      rootIndex: bestMatch.rootIndex,
      start: bestMatch.start,
      end: bestMatch.end,
      range
    };
  }

  function clearCustomHighlights() {
    if (!supportsCustomHighlights) return;

    Object.values(HIGHLIGHT_NAMES).forEach((name) => {
      CSS.highlights.delete(name);
    });
  }

  function unwrapFallbackMark(mark) {
    if (!mark || !mark.parentNode) return;

    const parent = mark.parentNode;

    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }

    parent.removeChild(mark);
    parent.normalize();
  }

  function clearFallbackMarks(predicate = null) {
    const marks = Array.from(
      document.querySelectorAll(FALLBACK_MARK_SELECTOR)
    );

    applyingHighlights = true;

    try {
      marks.forEach((mark) => {
        if (!predicate || predicate(mark)) {
          unwrapFallbackMark(mark);
        }
      });
    } finally {
      applyingHighlights = false;
    }
  }

  function fallbackMarkExists(id) {
    return Array.from(
      document.querySelectorAll(FALLBACK_MARK_SELECTOR)
    ).some((mark) => mark.dataset.tmphId === id);
  }

  function wrapFallbackRange(
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
      const nodeEnd = total + node.data.length;

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
            FALLBACK_MARK_SELECTOR
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

    applyingHighlights = true;

    try {
      for (
        let index = segments.length - 1;
        index >= 0;
        index -= 1
      ) {
        const segment = segments[index];
        let selectedNode = segment.node;

        if (segment.end < selectedNode.data.length) {
          selectedNode.splitText(segment.end);
        }

        if (segment.start > 0) {
          selectedNode = selectedNode.splitText(
            segment.start
          );
        }

        const mark = document.createElement("mark");

        mark.className = "tmph-fallback-mark";
        mark.dataset.tmphId = record.id;
        mark.dataset.tmphChat = record.chatId;
        mark.dataset.tmphColor = record.color;
        mark.style.backgroundColor =
          COLORS[record.color] || COLORS.yellow;
        mark.style.color = "inherit";
        mark.style.borderRadius = "0.18em";
        mark.style.cursor = "pointer";

        selectedNode.parentNode.insertBefore(
          mark,
          selectedNode
        );

        mark.appendChild(selectedNode);
      }

      return true;
    } finally {
      applyingHighlights = false;
    }
  }

  function renderWithCustomHighlights(locations) {
    clearCustomHighlights();

    const rangesByColor = {
      yellow: [],
      green: [],
      blue: [],
      pink: []
    };

    for (const location of locations) {
      const color =
        COLORS[location.record.color] ?
          location.record.color :
          "yellow";

      rangesByColor[color].push(location.range);
    }

    Object.entries(rangesByColor).forEach(
      ([color, ranges]) => {
        if (!ranges.length) return;

        const highlight = new Highlight(...ranges);

        CSS.highlights.set(
          HIGHLIGHT_NAMES[color],
          highlight
        );
      }
    );
  }

  function renderWithFallbackMarks(
    locations,
    chatId
  ) {
    clearFallbackMarks(
      (mark) => mark.dataset.tmphChat !== chatId
    );

    for (const location of locations) {
      if (fallbackMarkExists(location.record.id)) {
        continue;
      }

      wrapFallbackRange(
        location.root,
        location.start,
        location.end,
        location.record
      );
    }
  }

  function restoreHighlights() {
    if (applyingHighlights) return;

    const chatId = currentChatId();

    renderedHighlights = [];

    if (!chatId) {
      clearCustomHighlights();
      clearFallbackMarks();
      return;
    }

    const records = state.items.filter(
      (item) => item.chatId === chatId
    );

    if (!records.length) {
      clearCustomHighlights();
      clearFallbackMarks();
      return;
    }

    const roots = getResponseRoots();

    if (!roots.length) return;

    const locations = records
      .map((record) => resolveRecord(record, roots))
      .filter(Boolean);

    renderedHighlights = locations;

    if (supportsCustomHighlights) {
      clearFallbackMarks();
      renderWithCustomHighlights(locations);
    } else {
      clearCustomHighlights();
      renderWithFallbackMarks(locations, chatId);
    }
  }

  function scheduleRestore(delay = 180) {
    window.clearTimeout(restoreTimer);

    restoreTimer = window.setTimeout(
      restoreHighlights,
      delay
    );
  }

  function injectStyles() {
    if (
      document.getElementById(
        "tmph-persistent-highlighter-styles"
      )
    ) {
      return;
    }

    const style = document.createElement("style");

    style.id = "tmph-persistent-highlighter-styles";
    style.textContent = `
      ::highlight(tmph-yellow) {
        background-color: ${COLORS.yellow};
        color: inherit;
      }

      ::highlight(tmph-green) {
        background-color: ${COLORS.green};
        color: inherit;
      }

      ::highlight(tmph-blue) {
        background-color: ${COLORS.blue};
        color: inherit;
      }

      ::highlight(tmph-pink) {
        background-color: ${COLORS.pink};
        color: inherit;
      }

      #tmph-toolbar {
        position: fixed;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        gap: 6px;
        max-width: calc(100vw - 16px);
        min-height: 44px;
        padding: 5px 7px;
        border: 1px solid rgba(127, 127, 127, 0.35);
        border-radius: 12px;
        background: rgba(24, 24, 27, 0.97);
        color: #ffffff;
        box-shadow:
          0 12px 30px rgba(0, 0, 0, 0.25),
          0 2px 8px rgba(0, 0, 0, 0.22);
        font-family:
          -apple-system,
          BlinkMacSystemFont,
          "Segoe UI",
          sans-serif;
        font-size: 13px;
        line-height: 1;
        user-select: none;
        -webkit-user-select: none;
        touch-action: manipulation;
      }

      #tmph-toolbar[hidden] {
        display: none !important;
      }

      .tmph-toolbar-label {
        padding: 0 3px;
        font-weight: 600;
        white-space: nowrap;
      }

      .tmph-color-button,
      .tmph-icon-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 34px;
        height: 34px;
        flex: 0 0 34px;
        padding: 0;
        border: 1px solid rgba(255, 255, 255, 0.25);
        border-radius: 9px;
        background: transparent;
        color: #ffffff;
        cursor: pointer;
        font-size: 17px;
        line-height: 1;
        touch-action: manipulation;
      }

      .tmph-color-button::before {
        content: "";
        width: 19px;
        height: 19px;
        border-radius: 6px;
        background: var(--tmph-color);
        box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
      }

      .tmph-color-button:hover,
      .tmph-icon-button:hover,
      .tmph-color-button:focus-visible,
      .tmph-icon-button:focus-visible {
        background: rgba(255, 255, 255, 0.13);
        outline: none;
      }

      .tmph-delete-button {
        color: #fca5a5;
      }

      #tmph-toast {
        position: fixed;
        left: 50%;
        bottom: max(24px, env(safe-area-inset-bottom));
        z-index: 2147483647;
        transform: translateX(-50%);
        max-width: calc(100vw - 28px);
        padding: 10px 14px;
        border-radius: 10px;
        background: rgba(24, 24, 27, 0.96);
        color: #ffffff;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.24);
        font-family:
          -apple-system,
          BlinkMacSystemFont,
          "Segoe UI",
          sans-serif;
        font-size: 13px;
        line-height: 1.35;
        text-align: center;
        pointer-events: none;
      }

      #tmph-toast[hidden] {
        display: none !important;
      }

      mark.tmph-fallback-mark {
        box-decoration-break: clone;
        -webkit-box-decoration-break: clone;
      }

      @media (max-width: 600px) {
        #tmph-toolbar {
          gap: 5px;
          min-height: 48px;
          padding: 6px;
          border-radius: 13px;
        }

        .tmph-toolbar-label {
          display: none;
        }

        .tmph-color-button,
        .tmph-icon-button {
          width: 38px;
          height: 38px;
          flex-basis: 38px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function createInterface() {
    toolbar = document.createElement("div");
    toolbar.id = "tmph-toolbar";
    toolbar.dataset.tmphUi = "true";
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute(
      "aria-label",
      "Persistent highlight controls"
    );
    toolbar.hidden = true;

    toastElement = document.createElement("div");
    toastElement.id = "tmph-toast";
    toastElement.dataset.tmphUi = "true";
    toastElement.setAttribute("role", "status");
    toastElement.hidden = true;

    document.body.appendChild(toolbar);
    document.body.appendChild(toastElement);
  }

  function showToast(message) {
    if (!toastElement) return;

    window.clearTimeout(toastTimer);

    toastElement.textContent = message;
    toastElement.hidden = false;

    toastTimer = window.setTimeout(() => {
      toastElement.hidden = true;
    }, 1900);
  }

  function bindButton(button, action) {
    let previousActivation = 0;

    const activate = (event) => {
      event.preventDefault();
      event.stopPropagation();

      const now = Date.now();

      if (now - previousActivation < 250) return;
      previousActivation = now;

      action();
    };

    button.addEventListener("pointerdown", activate);
    button.addEventListener("click", activate);
  }

  function makeColorButton(color, action) {
    const button = document.createElement("button");

    button.type = "button";
    button.className = "tmph-color-button";
    button.style.setProperty(
      "--tmph-color",
      COLORS[color]
    );
    button.setAttribute(
      "aria-label",
      `Use ${color} highlight`
    );
    button.title = `${color[0].toUpperCase()}${color.slice(1)}`;

    bindButton(button, action);

    return button;
  }

  function makeIconButton(
    text,
    title,
    action,
    className = ""
  ) {
    const button = document.createElement("button");

    button.type = "button";
    button.className =
      `tmph-icon-button ${className}`.trim();
    button.textContent = text;
    button.title = title;
    button.setAttribute("aria-label", title);

    bindButton(button, action);

    return button;
  }

  function positionToolbar(rect) {
    if (!toolbar || !rect) return;

    toolbar.style.visibility = "hidden";
    toolbar.hidden = false;

    requestAnimationFrame(() => {
      if (toolbar.hidden) return;

      const viewportWidth =
        window.visualViewport?.width ||
        window.innerWidth;

      const viewportHeight =
        window.visualViewport?.height ||
        window.innerHeight;

      const toolbarWidth = toolbar.offsetWidth;
      const toolbarHeight = toolbar.offsetHeight;

      let left =
        rect.left +
        rect.width / 2 -
        toolbarWidth / 2;

      left = Math.max(
        8,
        Math.min(
          left,
          viewportWidth - toolbarWidth - 8
        )
      );

      let top = rect.top - toolbarHeight - 10;

      if (top < 8) {
        top = rect.bottom + 10;
      }

      if (top + toolbarHeight > viewportHeight - 8) {
        top = Math.max(
          8,
          viewportHeight - toolbarHeight - 8
        );
      }

      toolbar.style.left = `${Math.round(left)}px`;
      toolbar.style.top = `${Math.round(top)}px`;
      toolbar.style.visibility = "visible";
    });
  }

  function hideToolbar(clearState = true) {
    if (toolbar) {
      toolbar.hidden = true;
      toolbar.style.visibility = "";
    }

    if (clearState) {
      activeHighlightId = null;
      capturedSelection = null;
    }
  }

  function showSelectionToolbar(rect) {
    if (!toolbar) return;

    activeHighlightId = null;
    toolbar.replaceChildren();

    const label = document.createElement("span");
    label.className = "tmph-toolbar-label";
    label.textContent = "Highlight";

    toolbar.appendChild(label);

    Object.keys(COLORS).forEach((color) => {
      toolbar.appendChild(
        makeColorButton(color, () => {
          createHighlight(color);
        })
      );
    });

    toolbar.appendChild(
      makeIconButton("×", "Close", () => {
        hideToolbar();
      })
    );

    positionToolbar(rect);
  }

  function showEditToolbar(id, rect) {
    if (!toolbar || !id) return;

    const record = state.items.find(
      (item) => item.id === id
    );

    if (!record) return;

    capturedSelection = null;
    activeHighlightId = id;
    toolbar.replaceChildren();

    const label = document.createElement("span");
    label.className = "tmph-toolbar-label";
    label.textContent = "Highlight";

    toolbar.appendChild(label);

    Object.keys(COLORS).forEach((color) => {
      toolbar.appendChild(
        makeColorButton(color, () => {
          recolorHighlight(id, color);
        })
      );
    });

    toolbar.appendChild(
      makeIconButton(
        "🗑",
        "Delete highlight",
        () => {
          deleteHighlight(id);
        },
        "tmph-delete-button"
      )
    );

    toolbar.appendChild(
      makeIconButton("×", "Close", () => {
        hideToolbar();
      })
    );

    positionToolbar(rect);
  }

  function selectionOverlapsRendered(
    root,
    start,
    end
  ) {
    return renderedHighlights.find((location) => {
      return (
        location.root === root &&
        start < location.end &&
        end > location.start
      );
    });
  }

  function captureCurrentSelection() {
    const selection = window.getSelection();

    if (
      !selection ||
      selection.rangeCount === 0 ||
      selection.isCollapsed
    ) {
      return;
    }

    const range = selection.getRangeAt(0).cloneRange();
    const root = responseRootFromNode(
      range.startContainer
    );

    if (
      !root ||
      !root.contains(range.endContainer)
    ) {
      return;
    }

    const chatId = currentChatId();

    if (!chatId) {
      hideToolbar();
      showToast(
        "Open a saved chat before highlighting."
      );
      return;
    }

    const offsets = rangeToOffsets(root, range);

    if (!offsets) return;

    const text = rootText(root);
    const exact = text.slice(
      offsets.start,
      offsets.end
    );

    if (!exact.trim()) return;

    const rect = getRangeRect(range);

    if (!rect) return;

    const existing = selectionOverlapsRendered(
      root,
      offsets.start,
      offsets.end
    );

    if (existing) {
      showEditToolbar(existing.record.id, rect);
      return;
    }

    capturedSelection = {
      chatId,
      root,
      start: offsets.start,
      end: offsets.end,
      exact,
      rect
    };

    showSelectionToolbar(rect);
  }

  function scheduleSelectionCapture(delay = 260) {
    window.clearTimeout(selectionTimer);

    selectionTimer = window.setTimeout(
      captureCurrentSelection,
      delay
    );
  }

  function createHighlight(color) {
    const captured = capturedSelection;

    if (!captured || !COLORS[color]) {
      hideToolbar();
      return;
    }

    const chatId = currentChatId();

    if (!chatId || chatId !== captured.chatId) {
      hideToolbar();
      showToast("The chat changed. Select the text again.");
      return;
    }

    if (!captured.root.isConnected) {
      hideToolbar();
      showToast("Select the text again.");
      return;
    }

    const currentText = rootText(captured.root);
    const currentExact = currentText.slice(
      captured.start,
      captured.end
    );

    if (currentExact !== captured.exact) {
      hideToolbar();
      showToast("The response changed. Select the text again.");
      return;
    }

    const roots = getResponseRoots();
    const messageIndex = roots.indexOf(
      captured.root
    );

    if (messageIndex < 0) {
      hideToolbar();
      showToast("Could not identify this response.");
      return;
    }

    const record = {
      id: makeId(),
      chatId,
      color,
      exact: captured.exact,
      prefix: currentText.slice(
        Math.max(0, captured.start - 64),
        captured.start
      ),
      suffix: currentText.slice(
        captured.end,
        captured.end + 64
      ),
      start: captured.start,
      end: captured.end,
      messageIndex,
      messageHash: hashText(currentText),
      createdAt: new Date().toISOString()
    };

    state.items.push(record);

    if (!saveState()) {
      state.items = state.items.filter(
        (item) => item.id !== record.id
      );
      hideToolbar();
      return;
    }

    const selection = window.getSelection();
    selection?.removeAllRanges();

    hideToolbar();
    restoreHighlights();
    showToast("Highlight saved.");
  }

  function recolorHighlight(id, color) {
    if (!id || !COLORS[color]) return;

    const record = state.items.find(
      (item) => item.id === id
    );

    if (!record) {
      hideToolbar();
      return;
    }

    record.color = color;

    if (!saveState()) return;

    hideToolbar();
    restoreHighlights();
    showToast("Highlight color updated.");
  }

  function deleteHighlight(id) {
    if (!id) return;

    const previousLength = state.items.length;

    state.items = state.items.filter(
      (item) => item.id !== id
    );

    if (state.items.length === previousLength) {
      hideToolbar();
      return;
    }

    if (!saveState()) return;

    clearFallbackMarks(
      (mark) => mark.dataset.tmphId === id
    );

    hideToolbar();
    restoreHighlights();
    showToast("Highlight deleted.");
  }

  function caretPointFromEvent(event) {
    if (
      typeof document.caretPositionFromPoint ===
      "function"
    ) {
      const position = document.caretPositionFromPoint(
        event.clientX,
        event.clientY
      );

      if (position) {
        return {
          node: position.offsetNode,
          offset: position.offset
        };
      }
    }

    if (
      typeof document.caretRangeFromPoint ===
      "function"
    ) {
      const range = document.caretRangeFromPoint(
        event.clientX,
        event.clientY
      );

      if (range) {
        return {
          node: range.startContainer,
          offset: range.startOffset
        };
      }
    }

    return null;
  }

  function findHighlightAtEvent(event) {
    const fallbackMark =
      event.target instanceof Element ?
        event.target.closest(FALLBACK_MARK_SELECTOR) :
        null;

    if (fallbackMark?.dataset.tmphId) {
      const location = renderedHighlights.find(
        (item) =>
          item.record.id ===
          fallbackMark.dataset.tmphId
      );

      return (
        location || {
          record: state.items.find(
            (item) =>
              item.id === fallbackMark.dataset.tmphId
          ),
          range: null
        }
      );
    }

    if (!supportsCustomHighlights) return null;

    const point = caretPointFromEvent(event);

    if (!point) return null;

    const root = responseRootFromNode(point.node);

    if (!root || !root.contains(point.node)) {
      return null;
    }

    const offset = pointOffset(
      root,
      point.node,
      point.offset
    );

    if (offset === null) return null;

    return (
      [...renderedHighlights]
        .reverse()
        .find((location) => {
          return (
            location.root === root &&
            offset >= location.start &&
            offset <= location.end
          );
        }) || null
    );
  }

  function onDocumentClick(event) {
    if (
      toolbar &&
      toolbar.contains(event.target)
    ) {
      return;
    }

    const selection = window.getSelection();

    if (selection && !selection.isCollapsed) {
      return;
    }

    const location = findHighlightAtEvent(event);

    if (!location || !location.record) return;

    event.preventDefault();
    event.stopPropagation();

    const rect =
      location.range ?
        getRangeRect(location.range) :
        event.target.getBoundingClientRect();

    showEditToolbar(location.record.id, rect);
  }

  function onDocumentPointerDown(event) {
    if (
      toolbar &&
      toolbar.contains(event.target)
    ) {
      return;
    }

    const fallbackMark =
      event.target instanceof Element &&
      event.target.closest(FALLBACK_MARK_SELECTOR);

    if (fallbackMark) return;

    if (!toolbar?.hidden) {
      hideToolbar();
    }
  }

  function onKeyDown(event) {
    if (event.key === "Escape") {
      hideToolbar();
    }

    if (
      event.key === "ArrowLeft" ||
      event.key === "ArrowRight" ||
      event.key === "ArrowUp" ||
      event.key === "ArrowDown" ||
      event.key === "Shift"
    ) {
      scheduleSelectionCapture(80);
    }
  }

  function clearCurrentChat() {
    const chatId = currentChatId();

    if (!chatId) return false;

    state.items = state.items.filter(
      (item) => item.chatId !== chatId
    );

    if (!saveState()) return false;

    clearFallbackMarks(
      (mark) => mark.dataset.tmphChat === chatId
    );

    restoreHighlights();
    showToast("Chat highlights cleared.");

    return true;
  }

  function clearAllHighlights() {
    state = emptyState();

    if (!saveState()) return false;

    clearCustomHighlights();
    clearFallbackMarks();
    renderedHighlights = [];
    hideToolbar();
    showToast("All highlights cleared.");

    return true;
  }

  function exportHighlights() {
    return JSON.stringify(state, null, 2);
  }

  function importHighlights(input) {
    try {
      const parsed =
        typeof input === "string" ?
          JSON.parse(input) :
          input;

      const items = Array.isArray(parsed) ?
        parsed :
        parsed?.items;

      if (!Array.isArray(items)) {
        throw new Error("Invalid highlight file.");
      }

      const validItems = items.filter(isValidRecord);
      const existingIds = new Set(
        state.items.map((item) => item.id)
      );

      for (const item of validItems) {
        if (!existingIds.has(item.id)) {
          state.items.push(item);
          existingIds.add(item.id);
        }
      }

      if (!saveState()) return false;

      restoreHighlights();
      showToast(
        `${validItems.length} highlights imported.`
      );

      return true;
    } catch (error) {
      console.error(
        "[TypingMind Highlighter] Import failed.",
        error
      );

      showToast("Highlight import failed.");
      return false;
    }
  }

  function onStorageEvent(event) {
    if (event.key !== STORAGE_KEY) return;

    state = readState();
    scheduleRestore(20);
  }

  function onNavigation() {
    hideToolbar();
    renderedHighlights = [];
    clearCustomHighlights();
    scheduleRestore(300);
  }

  function initializeObserver() {
    observer = new MutationObserver(() => {
      if (applyingHighlights) return;

      const chatId = currentChatId();

      if (
        !chatId ||
        !state.items.some(
          (item) => item.chatId === chatId
        )
      ) {
        return;
      }

      scheduleRestore(220);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  function initialize() {
    injectStyles();
    createInterface();

    document.addEventListener(
      "selectionchange",
      () => scheduleSelectionCapture(320),
      true
    );

    document.addEventListener(
      "pointerup",
      () => scheduleSelectionCapture(60),
      true
    );

    document.addEventListener(
      "mouseup",
      () => scheduleSelectionCapture(60),
      true
    );

    document.addEventListener(
      "touchend",
      () => scheduleSelectionCapture(450),
      {
        capture: true,
        passive: true
      }
    );

    document.addEventListener(
      "click",
      onDocumentClick,
      true
    );

    document.addEventListener(
      "pointerdown",
      onDocumentPointerDown,
      true
    );

    document.addEventListener(
      "keydown",
      onKeyDown,
      true
    );

    window.addEventListener(
      "hashchange",
      onNavigation
    );

    window.addEventListener(
      "popstate",
      onNavigation
    );

    window.addEventListener(
      "storage",
      onStorageEvent
    );

    window.addEventListener(
      "resize",
      () => {
        if (!toolbar?.hidden) hideToolbar();
      }
    );

    window.visualViewport?.addEventListener(
      "resize",
      () => {
        if (!toolbar?.hidden) hideToolbar();
      }
    );

    initializeObserver();

    window.TypingMindHighlighter = {
      version: VERSION,

      restore() {
        restoreHighlights();
      },

      getAll() {
        return JSON.parse(JSON.stringify(state.items));
      },

      export() {
        return exportHighlights();
      },

      import(input) {
        return importHighlights(input);
      },

      clearCurrentChat() {
        return clearCurrentChat();
      },

      clearAll() {
        return clearAllHighlights();
      },

      delete(id) {
        deleteHighlight(id);
      }
    };

    window[EXTENSION_FLAG] = {
      loaded: true,
      version: VERSION
    };

    scheduleRestore(400);

    console.info(
      `[TypingMind Highlighter] Version ${VERSION} loaded. ` +
      `Rendering mode: ${
        supportsCustomHighlights ?
          "CSS Custom Highlight API" :
          "DOM fallback"
      }.`
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initialize,
      { once: true }
    );
  } else {
    initialize();
  }
})();
