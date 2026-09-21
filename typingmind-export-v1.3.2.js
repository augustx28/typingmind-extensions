/* ==========================================================================
 * TypingMind Chat Export (.md)  v1.3.2
 * --------------------------------------------------------------------------
 * Exports the chat you have open to one Markdown file with only:
 *   the chat title, then every question and answer in order, links exactly
 *   as the model wrote them. Each question folds into a grey "You" box; each answer
 *   starts with one line like "#### 🧠 PromptForge - GPT-5.1".
 * One chat at a time, only when you ask for it.
 * The look is set in CONFIG under "Export look" (heading level, emoji,
 * separator, box style, folding).
 *
 * v1.3.2: all inputs start collapsed under "You", without a heading.
 * v1.3.1: omit agent welcome messages before the first user input.
 * v1.3: answer label "#### 🧠 Agent - Model" on one line; questions in an
 *       Obsidian callout box (short ones on one line, long ones fold up).
 * v1.2: "Export .md" lives in the chat's More actions menu (chevron, top
 *       right), with a pin that puts an Export icon in the chat header.
 *       Answers labeled with ### agent / ### model lines.
 * v1.1: stripped to the essentials. No metadata block, dates, chat link,
 *       tags, Sources lists or question headings. File name = chat title.
 *
 * Why not the built-in Share > .md download?
 *   It glues every message onto a single "Role: text" line (so any answer
 *   that starts with a heading or a list loses its formatting), dumps raw
 *   tool output into the transcript, and drops the links behind web-search
 *   citation chips, because TypingMind stores those apart from the text.
 *
 * How it works
 *   1. Reads the open chat straight from TypingMind's own storage
 *      (IndexedDB "keyval-store" > "CHAT_<id>"), not from the screen, so a
 *      long chat exports in full and the text is the raw markdown the model
 *      sent. Links are never re-typed or re-rendered.
 *   2. Web-search citation chips (OpenAI, Anthropic, Gemini, Perplexity
 *      style) become inline links where the chip sat.
 *   3. Answer headings move down one level so the chat title stays the
 *      only top-level heading.
 *   4. Read-only. It never writes to TypingMind's data.
 *   5. If storage can't be read, it falls back to what is on screen.
 *
 * Use
 *   Open a chat, tap the chevron at the top right (More actions) and pick
 *   "Export .md". Tap its pin to keep an Export icon in the chat header.
 *   Ctrl/Cmd + Shift + E downloads the open chat instantly.
 *   The Export menu has Download, Copy, Share (phone) and three toggles:
 *   tool calls, thinking, system prompt (all off by default).
 *
 * Install: TypingMind > Settings > Advanced Settings > Extensions >
 * paste the URL of this file > Install > restart the app.
 *
 * No MutationObserver on <body> (polling only), so it can't cause the
 * touch-freeze feedback loops that observer-based scripts hit on mobile.
 *
 * Console API (window.tmExport):
 *   tmExport.download()  download the open chat as .md
 *   tmExport.copy()      copy the markdown to the clipboard
 *   tmExport.preview()   print the markdown to the console
 *   tmExport.status()    what it sees right now
 *   tmExport.off()       kill switch for this session
 *   tmExport.on()        re-enable
 * ========================================================================== */

(function () {
  'use strict';

  const NS = '__tmMdExport';
  try {
    if (window[NS] && typeof window[NS].destroy === 'function') window[NS].destroy();
  } catch (e) {
    /* an older copy failed to clean up; carry on */
  }

  /* ---------------------------------------------------------------- CONFIG */
  const CONFIG = {
    VERSION: '1.3.2',
    STORE_KEY: 'TM_MD_EXPORT_V1',   // menu toggles, saved per device
    POLL_MS: 1000,                  // how often the Export tab is checked
    FAB_AFTER_MS: 12000,            // corner button only if the workspace bar never shows up
    HEADING_SHIFT: true,            // answer "#" becomes "##" so the chat title stays on top
    CALLOUTS: true,                 // Obsidian callouts for the optional extras (thinking, tools)
    INLINE_CITATIONS: true,         // web-search citation chips become inline links
    MATH_FOR_OBSIDIAN: true,        // \( \) and \[ \] become $ and $$, like TypingMind shows them
    FILENAME_DATE: false,           // true = "2026-09-20 Chat title.md"
    TOOL_RESULT_MAX_CHARS: 4000,    // tool output is cut after this when tool calls are on
    WORKSPACE_TAB: false,           // true = also show an Export tab in the left/bottom workspace bar
    MENU_LABEL: 'Export .md',       // name of the item in the chat's "More actions" menu
    DEFAULTS: { tools: false, thinking: false, system: false, pinned: false },

    /* ---- Export look. Change a value, re-upload the file, restart TypingMind. ---- */
    // Line above each answer, e.g. "#### 🧠 PromptForge - GPT-5.1"
    LABEL_HEADING: '####',          // '###' = H3, '####' = H4, '#####' = H5
    LABEL_EMOJI: '🧠',              // shown before the names ('' for none)
    LABEL_SEPARATOR: ' - ',         // between the agent name and the model name
    // Your question, in an Obsidian callout box
    QUESTION_LABEL: 'You',          // box title starts with this
    QUESTION_BOX: 'quote',          // box style: 'quote' grey, 'note' blue, 'tip' teal, 'example' purple
    QUESTION_FOLD: 'all',           // 'all'  = every question folds under "You" (tap to open)
                                    // 'long' = only long questions fold, with a preview
                                    // 'none' = never fold, full question always showing
    QUESTION_TITLE_CHARS: 90        // title/preview limit when QUESTION_FOLD is 'long'
  };

  const IDS = {
    btn: 'tm-mdx-btn',
    headerBtn: 'tm-mdx-header-btn',
    menu: 'tm-mdx-menu',
    toast: 'tm-mdx-toast',
    style: 'tm-mdx-style',
    fab: 'tm-mdx-fab'
  };
  const MENU_ITEM_ID = 'md-export-button';   // data-element-id of our row in "More actions"

  const SEL = {
    bar: '[data-element-id="workspace-bar"]',
    settingsTab: 'button[data-element-id="workspace-tab-settings"]',
    anyTab: 'button[data-element-id^="workspace-tab-"]',
    chatSpace: '[data-element-id="chat-space-middle-part"]',
    block: '[data-element-id="response-block"]',
    userMsg: '[data-element-id="user-message"]',
    aiMsg: '[data-element-id="ai-response"]',
    selectedChat: '[data-element-id="selected-chat-item"]',
    chatItemTitle: '[data-element-id="chat-item-title"]',
    // The chevron at the top right of an open chat that opens "More actions".
    moreBtn: '[data-element-id="current-chat-title"] button[aria-haspopup="menu"]:not([data-element-id="md-export-header-button"])'
  };

  // Fallback look for our header icon if no native pinned icon is there to copy.
  const HEADER_BTN_CLASS = 'w-9 justify-center dark:hover:bg-white/20 dark:active:bg-white/25 ' +
    'hover:bg-slate-900/20 active:bg-slate-900/25 focus-visible:outline-offset-2 focus-visible:outline-slate-500 ' +
    'text-slate-900 dark:text-white inline-flex items-center rounded-lg h-9 transition-all group font-semibold text-xs';

  // Message types that are not a question even when role is "user".
  const NON_QUESTION_TYPES = new Set(['attachment', 'clear-context', 'tm_context_summary', 'tm_multi_responses']);
  // Stored in the chat but never shown by TypingMind (agent few-shot examples).
  const HIDDEN_TYPES = new Set(['training-message']);

  const ICON_EXPORT =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>' +
    '<path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M12 18v-6"/><path d="m9 15 3 3 3-3"/></svg>';
  // Only used if TypingMind's own pin glyph can't be borrowed.
  const ICON_PIN_OFF =
    '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M6.4 11.6 3 15"/><path d="M10.3 2.7l5 5-2 .8-2.7 2.7.2 2.6-1.5 1.5-6.6-6.6 1.5-1.5 2.6.2 2.7-2.7Z"/></svg>';
  const ICON_PIN_ON =
    '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M6.4 11.6 3 15"/><path fill="currentColor" d="M10.3 2.7l5 5-2 .8-2.7 2.7.2 2.6-1.5 1.5-6.6-6.6 1.5-1.5 2.6.2 2.7-2.7Z"/></svg>';
  const ICON_CHECK =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

  /* ----------------------------------------------------------------- STATE */
  const S = {
    enabled: true,
    pollTimer: null,
    toastTimer: null,
    startedAt: Date.now(),
    entrySeen: false,   // a way into the exporter (header menu or tab) has shown up
    cache: null,        // { key, at, result } prepared when the menu opens
    prefs: loadPrefs(),
    menuAnchor: null,
    injectRun: 0,
    menuWatch: null,
    cleanups: []
  };

  function loadPrefs() {
    try {
      const saved = JSON.parse(localStorage.getItem(CONFIG.STORE_KEY) || '{}');
      return Object.assign({}, CONFIG.DEFAULTS, saved && typeof saved === 'object' ? saved : {});
    } catch (e) {
      return Object.assign({}, CONFIG.DEFAULTS);
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(CONFIG.STORE_KEY, JSON.stringify(S.prefs));
    } catch (e) {
      /* storage full or blocked; toggles just won't persist */
    }
  }

  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    S.cleanups.push(() => target.removeEventListener(type, fn, opts));
  }

  /* ============================================================ CHAT SOURCE */

  function currentChatId() {
    const m = location.href.match(/[#&?]chat=([^&?#]+)/);
    if (m && m[1]) return safeDecode(m[1]);

    const sel = document.querySelector(SEL.selectedChat);
    if (sel) {
      const direct = sel.getAttribute('data-chat-id') || (sel.dataset && sel.dataset.chatId);
      if (direct) return String(direct);
      const link = sel.matches('a') ? sel : sel.closest('a') || sel.querySelector('a');
      const hm = link && (link.getAttribute('href') || '').match(/#chat=([^&?#]+)/);
      if (hm && hm[1]) return safeDecode(hm[1]);
    }
    return null;
  }

  function safeDecode(v) {
    try {
      return decodeURIComponent(v);
    } catch (e) {
      return v;
    }
  }

  // Read one key from an existing IndexedDB database. Never creates a DB.
  function idbGet(dbName, key, storeFilter) {
    return new Promise((resolve) => {
      let finished = false;
      let db = null;
      const finish = (value) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        try {
          if (db) db.close();
        } catch (e) {
          /* already closed */
        }
        resolve(value);
      };
      const timer = setTimeout(() => finish(undefined), 4000);

      let req;
      try {
        req = indexedDB.open(dbName);
      } catch (e) {
        finish(undefined);
        return;
      }
      req.onupgradeneeded = () => {
        try {
          req.transaction.abort();
        } catch (e) {
          /* nothing to abort */
        }
      };
      req.onerror = () => finish(undefined);
      req.onblocked = () => finish(undefined);
      req.onsuccess = () => {
        db = req.result;
        const stores = Array.from(db.objectStoreNames).filter(storeFilter);
        if (!stores.length) {
          finish(undefined);
          return;
        }
        let found;
        try {
          const tx = db.transaction(stores, 'readonly');
          stores.forEach((name) => {
            const get = tx.objectStore(name).get(key);
            get.onsuccess = () => {
              if (found === undefined && get.result !== undefined) found = get.result;
            };
          });
          tx.oncomplete = () => finish(found);
          tx.onerror = () => finish(found);
          tx.onabort = () => finish(found);
        } catch (e) {
          finish(undefined);
        }
      };
    });
  }

  function asChat(value) {
    let v = value;
    if (typeof v === 'string') {
      try {
        v = JSON.parse(v);
      } catch (e) {
        return null;
      }
    }
    return v && typeof v === 'object' && Array.isArray(v.messages) ? v : null;
  }

  async function readChatFromStorage(chatId) {
    if (!chatId || !window.indexedDB) return null;
    const key = 'CHAT_' + chatId;

    let chat = asChat(await idbGet('keyval-store', key, (n) => n === 'keyval'));
    if (chat) return chat;

    // TypingMind has only ever used idb-keyval's default DB, but look around
    // before giving up in case a future version renames it.
    if (typeof indexedDB.databases === 'function') {
      let names = [];
      try {
        names = (await indexedDB.databases()).map((d) => d && d.name).filter(Boolean);
      } catch (e) {
        names = [];
      }
      for (const name of names) {
        if (name === 'keyval-store' || !/keyval|typingmind/i.test(name)) continue;
        chat = asChat(await idbGet(name, key, (n) => /^(?:keyval|chats?|store)$/i.test(n)));
        if (chat) return chat;
      }
    }

    try {
      chat = asChat(localStorage.getItem(key));
    } catch (e) {
      chat = null;
    }
    return chat;
  }

  function lsJson(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || 'null');
    } catch (e) {
      return null;
    }
  }

  function modelLabel(id, chat) {
    if (!id) return '';
    const sid = String(id);
    const custom = lsJson('TM_useCustomModels');
    if (Array.isArray(custom)) {
      const m = custom.find((x) => x && (x.id === sid || x.modelID === sid));
      if (m && (m.title || m.name)) return String(m.title || m.name);
    }
    if (chat && chat.modelInfo && chat.modelInfo.title && chat.model === sid) return String(chat.modelInfo.title);
    return sid;
  }

  /* ============================================================ SMALL UTILS */

  const pad = (n) => String(n).padStart(2, '0');

  function toDate(v) {
    if (!v) return null;
    const d = v instanceof Date ? v : new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  function ymd(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function safeJson(value) {
    try {
      return JSON.stringify(
        value,
        (k, v) => (typeof v === 'string' && v.length > 500 && /^data:[^;]+;base64,/.test(v) ? '[base64 data]' : v),
        2
      );
    } catch (e) {
      return String(value);
    }
  }

  // For text that goes inside **bold** labels or *[file: name]* markers.
  function cleanLabel(s) {
    return String(s || '').replace(/[*[\]`]/g, '').replace(/\s+/g, ' ').trim();
  }

  function isDark() {
    const root = document.documentElement;
    return root.classList.contains('dark') || (document.body && document.body.classList.contains('dark'));
  }

  function isTouch() {
    try {
      return window.matchMedia('(pointer: coarse)').matches;
    } catch (e) {
      return false;
    }
  }

  function isMac() {
    return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
  }

  /* ========================================================= MARKDOWN CORE */

  // Calls fn(line) for every line that is not inside a fenced code block.
  // fn may return a replacement string. Also reports a fence left open.
  function mapLinesOutsideFences(md, fn) {
    const lines = String(md).split('\n');
    let fence = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const f = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (fence) {
        if (f && f[1][0] === fence.ch && f[1].length >= fence.len && !f[2].trim()) fence = null;
        continue;
      }
      if (f && !(f[1][0] === '`' && f[2].includes('`'))) {
        fence = { ch: f[1][0], len: f[1].length };
        continue;
      }
      const out = fn(line, i);
      if (typeof out === 'string') lines[i] = out;
    }
    return { text: lines.join('\n'), openFence: fence };
  }

  function shiftHeadings(md) {
    if (!CONFIG.HEADING_SHIFT) return md;
    return mapLinesOutsideFences(md, (line) => {
      const h = /^( {0,3})(#{1,5})(?=[ \t]|$)/.exec(line);
      return h ? h[1] + '#' + line.slice(h[1].length) : undefined;
    }).text;
  }

  // Headings inside callouts (questions, thinking) would clutter the outline.
  function escapeHeadings(md) {
    return mapLinesOutsideFences(md, (line) => {
      const h = /^( {0,3})(#{1,6})(?=[ \t]|$)/.exec(line);
      return h ? h[1] + '\\' + line.slice(h[1].length) : undefined;
    }).text;
  }

  // TypingMind shows your questions as plain text. Stop Obsidian from
  // swallowing tags like <div> that you typed or pasted.
  function escapeTags(md) {
    return replaceOutsideCode(md, /<(?=[A-Za-z!/?])/g, '&lt;');
  }

  function closeFences(md) {
    const r = mapLinesOutsideFences(md, () => undefined);
    return r.openFence ? md + '\n' + r.openFence.ch.repeat(r.openFence.len) : md;
  }

  function finalize(md) {
    return closeFences(shiftHeadings(String(md).replace(/\s+$/, '')));
  }

  // Replace a pattern everywhere except fenced blocks and inline code spans.
  function replaceOutsideCode(md, pattern, fn) {
    return mapLinesOutsideFences(md, (line) => {
      const code = /(`+)[\s\S]*?\1/g;
      let out = '';
      let last = 0;
      let m;
      while ((m = code.exec(line))) {
        out += line.slice(last, m.index).replace(pattern, fn) + m[0];
        last = m.index + m[0].length;
      }
      return out + line.slice(last).replace(pattern, fn);
    }).text;
  }

  function fence(text, lang) {
    const body = String(text).replace(/\n+$/, '');
    const runs = body.match(/`{3,}/g) || [];
    const size = Math.max(3, ...runs.map((r) => r.length + 1));
    const f = '`'.repeat(size);
    return f + (lang || '') + '\n' + body + '\n' + f;
  }

  function callout(type, title, body, collapsed) {
    const head = CONFIG.CALLOUTS
      ? '> [!' + type + ']' + (collapsed ? '-' : '') + ' ' + title
      : '> **' + title + '**';
    const lines = String(body).split('\n').map((l) => (l ? '> ' + l : '>'));
    return head + '\n' + lines.join('\n');
  }

  function linkText(t) {
    return String(t || '').replace(/\s+/g, ' ').trim().replace(/([\\[\]])/g, '\\$1');
  }

  function linkUrl(u) {
    const s = String(u || '').trim().replace(/ /g, '%20').replace(/</g, '%3C').replace(/>/g, '%3E');
    let depth = 0;
    for (const ch of s) {
      if (ch === '(') depth++;
      else if (ch === ')' && --depth < 0) break;
    }
    return depth === 0 ? s : '<' + s + '>';
  }

  function mdLink(text, url) {
    return '[' + linkText(text) + '](' + linkUrl(url) + ')';
  }

  function domainOf(u) {
    try {
      return new URL(u).hostname.replace(/^www\./, '');
    } catch (e) {
      return '';
    }
  }

  // TypingMind's renderer wraps pure JSON replies in a json code block.
  function fenceIfJson(text) {
    const s = String(text).trim();
    if (!/^[[{]/.test(s)) return text;
    try {
      const v = JSON.parse(s);
      return v && typeof v === 'object' ? fence(s, 'json') : text;
    } catch (e) {
      return text;
    }
  }

  // TypingMind renders \( \) and \[ \] as math when a reply has no code.
  // Obsidian only understands $ and $$, so convert the same way.
  function mathForObsidian(text) {
    if (!CONFIG.MATH_FOR_OBSIDIAN || String(text).includes('`')) return text;
    return String(text)
      .replace(/\\\[(\s*[\s\S]*?)\\\]/g, (m, t) => '$$' + t + '$$')
      .replace(/\\\((\s*[\s\S]*?)\\\)/g, (m, t) => '$' + t.trim() + '$');
  }

  /* ============================================================= CITATIONS */

  function normCitation(c) {
    if (typeof c === 'string') return { url: c, title: '' };
    if (!c || typeof c !== 'object') return null;
    const inner = c.url_citation || c.web || {};
    return {
      url: String(c.url || c.uri || c.link || c.href || inner.url || inner.uri || ''),
      title: String(c.title || c.name || inner.title || '')
    };
  }

  // Text blocks carry textAnnotations (tm_web_search_source) with character
  // offsets. TypingMind turns them into little chips at render time; here
  // they become real links at the same spots. Nothing is added at the end.
  function applyAnnotations(text, annotations) {
    if (!CONFIG.INLINE_CITATIONS || !Array.isArray(annotations) || !annotations.length) return text;
    const groups = new Map();
    annotations
      .filter((a) => a && a.type === 'tm_web_search_source' && typeof a.endIndex === 'number' &&
        a.endIndex >= 0 && a.endIndex <= text.length)
      .forEach((a) => {
        const srcs = (Array.isArray(a.sources) ? a.sources : [])
          .map(normCitation)
          .filter((s) => s && /^https?:\/\//i.test(s.url));
        if (!srcs.length) return;
        if (!groups.has(a.endIndex)) groups.set(a.endIndex, []);
        const g = groups.get(a.endIndex);
        srcs.forEach((s) => {
          if (!g.some((x) => x.url === s.url)) g.push(s);
        });
      });

    let out = text;
    [...groups.keys()].sort((a, b) => b - a).forEach((end) => {
      // OpenAI often writes the link into the text itself; don't repeat it.
      const fresh = groups.get(end).filter((s) => !text.includes(s.url));
      if (!fresh.length) return;
      const links = fresh.map((s) => mdLink(domainOf(s.url) || s.title || 'source', s.url)).join(', ');
      const before = out.slice(Math.max(0, end - 3), end);
      const sep = before.endsWith('```') ? '\n' : end === 0 || /\s$/.test(before) ? '' : ' ';
      out = out.slice(0, end) + sep + '(' + links + ')' + out.slice(end);
    });
    return out;
  }

  // Perplexity-style replies put [1] [2] in the text and the URLs in
  // message.citations. Link each marker to its URL.
  function linkNumberedCitations(text, cites) {
    if (!CONFIG.INLINE_CITATIONS || !cites.length) return text;
    // No regex lookbehind here: older Safari refuses to parse the whole file.
    return replaceOutsideCode(text, /\[(\d{1,3})\](?![(:])/g, (m, n, offset, str) => {
      const prev = offset > 0 ? str[offset - 1] : '';
      if (prev === '\\' || prev === '!') return m;
      const c = cites[Number(n) - 1];
      return c ? '[\\[' + n + '\\]](' + linkUrl(c.url) + ')' : m;
    });
  }

  /* ======================================================= MESSAGE PARTS */

  function plainText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .filter((b) => b && b.type === 'text')
        .map((b) => String(b.text || ''))
        .join('\n\n');
    }
    return '';
  }

  function imageLine(b) {
    const name = cleanLabel(b.metadata && b.metadata.name);
    if (b.type === 'image_url') {
      const u = typeof b.image_url === 'string' ? b.image_url : (b.image_url && b.image_url.url) || '';
      return /^https?:/i.test(u) ? '![image](' + linkUrl(u) + ')' : '*[image]*';
    }
    if (b.type === 'image') {
      const u = (b.source && b.source.type === 'url' && b.source.url) || b.url || '';
      return /^https?:/i.test(u) ? '![image](' + linkUrl(u) + ')' : '*[image]*';
    }
    if (b.type === 'tm_image_file') return '*[image' + (name ? ': ' + name : '') + ']*';
    return '';
  }

  function attachmentLine(b) {
    if (!b || typeof b !== 'object') return '';
    const img = imageLine(b);
    if (img) return img;
    const meta = b.metadata || {};
    const name = cleanLabel(meta.name || meta.fileName || b.name || b.filename || (b.file && b.file.filename));
    if (['tm_text_file', 'tm_blob_file', 'tm_unsynced_attachment', 'file', 'document', 'input_file'].includes(b.type)) {
      return '*[file' + (name ? ': ' + name : '') + ']*';
    }
    return '';
  }

  function thinkingOf(m) {
    const out = [];
    if (typeof m.reasoning_content === 'string' && m.reasoning_content.trim()) out.push(m.reasoning_content.trim());
    else if (typeof m.reasoning === 'string' && m.reasoning.trim()) out.push(m.reasoning.trim());
    if (Array.isArray(m.content)) {
      m.content.forEach((b) => {
        if (!b) return;
        if (b.type === 'thinking' && typeof b.thinking === 'string' && b.thinking.trim()) out.push(b.thinking.trim());
        else if (b.type === 'redacted_thinking') out.push('*[redacted thinking]*');
        else if (b.type === 'reasoning') {
          const s = Array.isArray(b.summary) ? b.summary.map((x) => (x && x.text) || '').join('\n\n') : String(b.text || '');
          if (s.trim()) out.push(s.trim());
        }
      });
    }
    return out.join('\n\n');
  }

  function toolCallsOf(m) {
    const out = [];
    if (m.function_call) out.push({ id: '', name: m.function_call.name || 'tool', args: m.function_call.arguments });
    if (Array.isArray(m.tool_calls)) {
      m.tool_calls.forEach((c) => {
        if (!c) return;
        out.push({
          id: c.id || '',
          name: (c.function && c.function.name) || c.name || 'tool',
          args: c.function ? c.function.arguments : c.arguments
        });
      });
    }
    let serverCalls = 0;
    if (Array.isArray(m.content)) {
      m.content.forEach((b) => {
        if (!b) return;
        if (b.type === 'tool_use' || b.type === 'server_tool_use' || b.type === 'tm_provider_tool_call') {
          if (b.type !== 'tool_use') serverCalls++;
          out.push({ id: b.id || '', name: b.name || b.toolName || 'tool', args: b.input !== undefined ? b.input : b.input_json_string || '' });
        }
      });
    }
    if (!serverCalls && m.webSearch && Array.isArray(m.webSearch.calls)) {
      m.webSearch.calls.forEach((c) => {
        if (c) out.push({ id: c.id || '', name: c.toolName || 'web_search', args: c.description || '' });
      });
    }
    return out;
  }

  function toolResultBlocksOf(m) {
    if (!Array.isArray(m.content)) return [];
    return m.content
      .filter((b) => b && /(?:^|_)tool_result$|^tm_provider_tool_call_result$|_tool_result$/.test(String(b.type)))
      .map((b) => ({ name: b.name || String(b.type).replace(/_tool_result$|_result$/, '') || 'tool', content: b.content !== undefined ? b.content : b.output }));
  }

  function prettyArgs(args) {
    if (args == null || args === '') return '{}';
    if (typeof args === 'string') {
      try {
        return JSON.stringify(JSON.parse(args), null, 2);
      } catch (e) {
        return args;
      }
    }
    return safeJson(args);
  }

  function clip(text) {
    const s = String(text == null ? '' : text);
    const max = CONFIG.TOOL_RESULT_MAX_CHARS;
    return s.length > max ? s.slice(0, max) + '\n... (cut, ' + s.length.toLocaleString() + ' characters total)' : s;
  }

  function toolResultText(m) {
    if (typeof m.content === 'string') return m.content;
    if (m.content != null) return safeJson(m.content);
    const pr = m.pluginResponse;
    if (pr && pr.data != null) return typeof pr.data === 'string' ? pr.data : safeJson(pr.data);
    return '';
  }

  // Plugin output TypingMind shows to you directly (rendered markdown/html),
  // as opposed to results only the model sees.
  function isShownOutput(m) {
    const t = m.pluginResponse && m.pluginResponse.type;
    return m.role === 'tool' && (m.format === 'markdown' || m.format === 'html' ||
      t === 'markdown' || t === 'html' || t === 'render_markdown' || t === 'render_html');
  }

  function shownOutputMd(m, opts) {
    const t = m.pluginResponse && m.pluginResponse.type;
    const html = m.format === 'html' || t === 'html' || t === 'render_html';
    let body = typeof m.content === 'string' && m.content.trim() ? m.content : '';
    if (!body && m.pluginResponse) {
      const d = m.pluginResponse.data;
      body = typeof d === 'string' ? d : d && typeof d.source === 'string' ? d.source : '';
    }
    if (!body) return '';
    if (!html) return finalize(body);
    return opts.tools ? fence(body, 'html') : '*[HTML output from ' + cleanLabel(m.name || 'plugin') + ']*';
  }

  function assistantBody(m) {
    const parts = [];
    if (typeof m.content === 'string') {
      parts.push(m._fromScreen ? m.content : mathForObsidian(fenceIfJson(m.content)));
    } else if (Array.isArray(m.content)) {
      m.content.forEach((b) => {
        if (typeof b === 'string') {
          parts.push(b);
          return;
        }
        if (!b || typeof b !== 'object') return;
        if (b.type === 'text' || b.type === 'output_text') {
          const withLinks = applyAnnotations(String(b.text || ''), b.textAnnotations);
          parts.push(mathForObsidian(fenceIfJson(withLinks)));
          return;
        }
        const img = imageLine(b);
        if (img) parts.push(img);
      });
    }
    let text = parts.filter((p) => p && String(p).trim()).join('\n\n');

    if (Array.isArray(m.citations) && m.citations.length) {
      const cites = m.citations.map(normCitation).filter((c) => c && /^https?:\/\//i.test(c.url));
      text = linkNumberedCitations(text, cites);
    }
    return text.trim() ? finalize(text) : '';
  }

  /* ========================================================= DOCUMENT BUILD */

  function groupTurns(messages) {
    const turns = [];
    let cur = null;
    let pendingFiles = [];
    let seenInput = false;
    const blank = () => ({ user: null, files: [], items: [] });

    messages.forEach((m) => {
      if (!m || typeof m !== 'object' || HIDDEN_TYPES.has(m.type)) return;
      if (m.role === 'user' && m.type === 'attachment') {
        seenInput = true;
        pendingFiles.push(m);
        return;
      }
      if (m.role === 'user' && !NON_QUESTION_TYPES.has(m.type)) {
        seenInput = true;
        if (cur) turns.push(cur);
        cur = blank();
        cur.user = m;
        cur.files = pendingFiles;
        pendingFiles = [];
        return;
      }
      // Agent greetings precede user input. Keep every reply after input,
      // including replies to an attachment-only message.
      if (!seenInput && m.role === 'assistant') return;
      if (!cur) cur = blank();
      cur.items.push(m);
    });
    if (pendingFiles.length) {
      if (!cur) cur = blank();
      cur.files.push(...pendingFiles);
    }
    if (cur) turns.push(cur);
    return turns;
  }

  function questionParts(turn) {
    const m = turn.user;
    let text = '';
    const files = [];
    if (m) {
      if (typeof m.content === 'string') {
        text = m.content;
      } else if (Array.isArray(m.content)) {
        // TypingMind shows the first text block of a user message.
        const t = m.content.find((b) => b && b.type === 'text');
        text = t ? String(t.text || '') : '';
        m.content.forEach((b) => {
          if (b && b.type !== 'text') {
            const line = attachmentLine(b);
            if (line) files.push(line);
          }
        });
      }
    }
    turn.files.forEach((a) => {
      const name = cleanLabel(a.metadata && a.metadata.name);
      files.push('*[file' + (name ? ': ' + name : '') + ']*');
    });
    return { text: text.replace(/^\n+/, '').replace(/\s+$/, ''), files };
  }

  // One heading line above each answer: "#### 🧠 Agent - Model".
  // No agent: "#### 🧠 Model". Neither known: "#### 🧠 Assistant".
  function labelFor(modelId, ctx) {
    const model = cleanLabel(modelLabel(modelId, ctx.chat));
    const names = [ctx.agent, model].filter(Boolean).join(CONFIG.LABEL_SEPARATOR) || 'Assistant';
    return CONFIG.LABEL_HEADING + ' ' + (CONFIG.LABEL_EMOJI ? CONFIG.LABEL_EMOJI + ' ' : '') + names;
  }

  // First line of a question, cleaned up for the box title.
  function previewOf(text, files) {
    const first = String(text || '')
      .split('\n')
      .map((s) => s.trim())
      .find((s) => s && !/^(```|~~~)/.test(s)) || '';
    let t = first
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/^(?:[#>]+\s*|[-+*]\s+|\d+[.)]\s+)+/, '')
      .replace(/[`*_~|[\]^\\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!t && files.length) t = files.map((f) => f.replace(/[*[\]!]|\(.*?\)/g, '')).join(', ');
    const max = CONFIG.QUESTION_TITLE_CHARS;
    if (t.length > max) {
      t = t.slice(0, max);
      const cut = t.lastIndexOf(' ');
      if (cut > max * 0.6) t = t.slice(0, cut);
      t = t.replace(/[\s.,;:!?-]+$/, '') + '…';
    }
    return t || 'Question';
  }

  // Your question in a callout box, collapsed under "You" by default.
  // Tap to show the full input. Optional 'long' mode keeps short questions
  // on the title line and folds longer questions under a preview.
  function questionBlock(text, files) {
    const body = closeFences([escapeHeadings(escapeTags(text)), ...files].filter(Boolean).join('\n\n') || '*[empty message]*');
    const quoted = body.split('\n').map((l) => (l ? '> ' + l : '>')).join('\n');
    const label = CONFIG.QUESTION_LABEL;
    if (!CONFIG.CALLOUTS) return '> **' + label + '**\n>\n' + quoted;

    const head = '> [!' + CONFIG.QUESTION_BOX + ']';
    const fold = CONFIG.QUESTION_FOLD;
    const fitsTitle = !body.includes('\n') && body.length <= CONFIG.QUESTION_TITLE_CHARS;
    if (fold === 'none') return head + ' ' + label + '\n' + quoted;
    if (fold === 'all') return head + '- ' + label + '\n' + quoted;
    if (fitsTitle) return head + ' ' + label + ': ' + body;
    return head + '- ' + label + ': ' + previewOf(text, files) + '\n' + quoted;
  }

  function renderItems(items, ctx, forcedLabel) {
    const chunks = [];
    let lastLabel = null;

    items.forEach((m) => {
      if (!m || typeof m !== 'object' || m.type === 'clear-context') return;

      if (m.type === 'tm_context_summary') {
        const cs = m.contextSummary && m.contextSummary.content;
        const text = typeof cs === 'string' ? cs : plainText(cs);
        if (ctx.opts.system && text.trim()) chunks.push(callout('info', 'Context summary', escapeHeadings(closeFences(text)), true));
        return;
      }

      if (m.type === 'tm_multi_responses' && Array.isArray(m.responses)) {
        m.responses.forEach((r) => {
          if (!r) return;
          const sub = renderItems(Array.isArray(r.messages) ? r.messages : [], ctx, labelFor(r.model, ctx));
          if (sub.trim()) chunks.push(sub);
        });
        lastLabel = null;
        return;
      }

      if (m.role === 'system') {
        const text = plainText(m.content);
        if (ctx.opts.system && text.trim() && text.trim() !== ctx.systemText) {
          chunks.push(callout('info', 'System', escapeHeadings(closeFences(text)), true));
        }
        return;
      }

      if (m.role === 'assistant') {
        const think = ctx.opts.thinking ? thinkingOf(m) : '';
        const body = assistantBody(m);
        const calls = ctx.opts.tools ? toolCallsOf(m) : [];
        const results = ctx.opts.tools ? toolResultBlocksOf(m) : [];
        calls.forEach((c) => {
          if (c.id) ctx.toolNames.set(c.id, c.name);
        });
        if (!think && !body && !calls.length && !results.length) return;

        const label = forcedLabel || labelFor(m.model || ctx.chat.model, ctx);
        if (label !== lastLabel) {
          chunks.push(label);
          lastLabel = label;
        }
        if (think) chunks.push(callout('abstract', 'Thinking', escapeHeadings(closeFences(think)), true));
        if (body) chunks.push(body);
        calls.forEach((c) => chunks.push(callout('example', 'Tool call: ' + cleanLabel(c.name), fence(prettyArgs(c.args), 'json'), true)));
        results.forEach((r) => {
          const text = typeof r.content === 'string' ? r.content : safeJson(r.content);
          chunks.push(callout('example', 'Tool result: ' + cleanLabel(r.name), fence(clip(text), ''), true));
        });
        return;
      }

      if (m.role === 'tool' || m.role === 'function') {
        if (isShownOutput(m)) {
          const out = shownOutputMd(m, ctx.opts);
          if (!out) return;
          const label = forcedLabel || labelFor(ctx.chat.model, ctx);
          if (label !== lastLabel) {
            chunks.push(label);
            lastLabel = label;
          }
          chunks.push(out);
          return;
        }
        if (ctx.opts.tools) {
          const name = m.name || ctx.toolNames.get(m.tool_call_id) || 'tool';
          chunks.push(callout('example', 'Tool result: ' + cleanLabel(name), fence(clip(toolResultText(m)), ''), true));
        }
        return;
      }

      // Anything else that carries visible text keeps its role as a label.
      const text = plainText(m.content);
      if (text.trim()) {
        const role = String(m.role || 'message');
        chunks.push(CONFIG.LABEL_HEADING + ' ' + cleanLabel(role.charAt(0).toUpperCase() + role.slice(1)), finalize(text));
        lastLabel = null;
      }
    });

    return chunks.join('\n\n');
  }

  function fileNameFor(title, date) {
    let t = String(title || '')
      .replace(/[\\/:*?"<>|#^[\]\u0000-\u001F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/, '');
    if (t.length > 90) t = t.slice(0, 90).replace(/\s+\S*$/, '').trim() || t.slice(0, 90);
    if (!t) t = 'TypingMind chat';
    return (CONFIG.FILENAME_DATE && date ? ymd(date) + ' ' : '') + t + '.md';
  }

  // The whole file: the title, then each question and its labeled answer.
  function buildMarkdown(chat, opts) {
    const messages = Array.isArray(chat.messages) ? chat.messages : [];
    const ctx = {
      chat,
      opts,
      agent: cleanLabel(chat.character && chat.character.title),
      toolNames: new Map()
    };
    // The system prompt usually sits in a hidden system message at the top.
    const firstSystem = messages.find((m) => m && m.role === 'system');
    const paramsPrompt = chat.chatParams && typeof chat.chatParams.systemMessage === 'string' ? chat.chatParams.systemMessage : '';
    ctx.systemText = (plainText(firstSystem && firstSystem.content) || paramsPrompt).trim();

    const turns = [];
    let questions = 0;
    groupTurns(messages).forEach((turn) => {
      const parts = [];
      const q = questionParts(turn);
      if (turn.user) {
        questions++;
        parts.push(questionBlock(q.text, q.files));
      } else if (q.files.length) {
        parts.push(q.files.join('\n\n'));
      }
      const answer = renderItems(turn.items, ctx, null);
      if (answer.trim()) parts.push(answer);
      if (parts.length) turns.push(parts.join('\n\n'));
    });

    const title = String(chat.chatTitle || chat.title || 'Untitled chat').replace(/\s+/g, ' ').trim();
    const head = ['# ' + title.replace(/\s+#+$/, '')];
    if (opts.system && ctx.systemText) {
      head.push(callout('info', 'System prompt', escapeHeadings(closeFences(ctx.systemText)), true));
    }

    const md = head.join('\n\n') + '\n\n---\n\n' +
      (turns.join('\n\n---\n\n') || '*This chat has no messages yet.*') + '\n';
    const created = toDate(chat.createdAt) || (messages[0] ? toDate(messages[0].createdAt) : null);
    return { md, questions, title, filename: fileNameFor(title, created || new Date()) };
  }

  /* ================================================ SCREEN FALLBACK (DOM) */

  function screenTitle() {
    const sel = document.querySelector(SEL.selectedChat);
    const node = sel && (sel.querySelector(SEL.chatItemTitle) || sel.querySelector('.truncate') || sel);
    const t = node ? node.textContent.replace(/\s+/g, ' ').trim() : '';
    return t || String(document.title || '').replace(/\s*[|·-]\s*Typing\s?Mind.*$/i, '').trim() || 'Untitled chat';
  }

  function chatFromScreen() {
    const blocks = document.querySelectorAll(SEL.block);
    if (!blocks.length) return null;
    const messages = [];
    blocks.forEach((b) => {
      const u = b.querySelector(SEL.userMsg);
      const a = b.querySelector(SEL.aiMsg);
      if (u) {
        const text = (u.textContent || '').trim();
        const imgs = Array.from(b.querySelectorAll('img')).filter(
          (img) => !u.contains(img) && !img.closest('[data-element-id="chat-avatar-container"]')
        );
        const content = imgs.length
          ? [{ type: 'text', text }].concat(imgs.map(() => ({ type: 'image_url', image_url: { url: '' } })))
          : text;
        if (text || imgs.length) messages.push({ role: 'user', content });
      } else if (a) {
        const md = htmlToMd(cleanAiNode(a));
        // Keep the assistant role so groupTurns also skips opening greetings here.
        if (md.trim()) messages.push({ role: 'assistant', content: md, _fromScreen: true });
      }
    });
    return messages.length ? { chatTitle: screenTitle(), messages, _fromScreen: true } : null;
  }

  function cleanAiNode(el) {
    const c = el.cloneNode(true);
    c.querySelectorAll([
      '[data-element-id="thinking-block"]',
      '[data-element-id="citations-block"]',
      '[data-element-id="additional-actions-of-response-container"]',
      '[data-element-id*="message-action"]',
      '[data-source-indices]',            // citation chips (URLs are not in the page)
      'img[src*="/s2/favicons"]',
      'button', 'svg', 'style', 'script', 'noscript', 'textarea', 'details',
      '[aria-hidden="true"]'
    ].join(',')).forEach((n) => n.remove());

    // Drop code-block chrome sitting around a <pre>. Chrome inside the <pre>
    // (TypingMind nests the language label and a second <pre> in there) is
    // handled when the block is converted, so the language survives.
    c.querySelectorAll('pre').forEach((pre) => {
      if (pre.parentElement && pre.parentElement.closest('pre')) return;
      let box = pre;
      let up = pre.parentElement;
      while (up && up !== c &&
        Array.from(up.querySelectorAll('pre')).every((p) => p === pre || pre.contains(p)) &&
        up.textContent.length - pre.textContent.length < 60) {
        box = up;
        up = up.parentElement;
      }
      if (box === pre) return;
      Array.from(box.querySelectorAll('*')).forEach((n) => {
        if (!n.contains(pre) && !pre.contains(n)) n.remove();
      });
    });
    return c;
  }

  const BLOCK_TAGS = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'UL', 'OL', 'LI', 'PRE', 'BLOCKQUOTE',
    'TABLE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'FIGURE', 'HEADER', 'FOOTER']);

  function htmlToMd(root) {
    return tidy(childrenMd(root));
  }

  function tidy(s) {
    return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function childrenMd(el) {
    let s = '';
    el.childNodes.forEach((n) => {
      s += nodeMd(n);
    });
    return s;
  }

  function wrapInline(mark, inner) {
    const t = inner.trim();
    return t ? mark + t + mark : '';
  }

  function nodeMd(n) {
    if (n.nodeType === 3) return n.nodeValue.replace(/\s+/g, ' ');
    if (n.nodeType !== 1) return '';
    const tag = n.tagName;

    if (n.classList && n.classList.contains('katex')) {
      const tex = n.querySelector('annotation[encoding="application/x-tex"]');
      if (tex) {
        const t = tex.textContent.trim();
        return n.closest('.katex-display') ? '\n\n$$' + t + '$$\n\n' : '$' + t + '$';
      }
    }

    switch (tag) {
      case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6':
        return '\n\n' + '#'.repeat(Number(tag[1])) + ' ' + childrenMd(n).replace(/\s*\n\s*/g, ' ').trim() + '\n\n';
      case 'P':
        return '\n\n' + childrenMd(n).trim() + '\n\n';
      case 'BR':
        return '\n';
      case 'STRONG': case 'B':
        return wrapInline('**', childrenMd(n));
      case 'EM': case 'I':
        return wrapInline('*', childrenMd(n));
      case 'DEL': case 'S':
        return wrapInline('~~', childrenMd(n));
      case 'CODE': {
        const t = n.textContent;
        const longest = Math.max(0, ...(t.match(/`+/g) || []).map((r) => r.length));
        const f = '`'.repeat(longest + 1);
        return f + (/^`|`$/.test(t) ? ' ' + t + ' ' : t) + f;
      }
      case 'PRE': {
        const code = n.querySelector('code') || n;
        let lang = ((code.className || '').match(/language-([\w+#.-]+)/) || [])[1] || '';
        if (!lang) {
          // TypingMind puts the language in a small header inside <pre>.
          const label = Array.from(n.querySelectorAll('span')).find(
            (s) => !code.contains(s) && /^[\w+#.-]{1,20}$/.test(s.textContent.trim())
          );
          if (label) lang = label.textContent.trim();
        }
        return '\n\n' + fence(code.textContent.replace(/\n$/, ''), lang) + '\n\n';
      }
      case 'A': {
        const href = n.getAttribute('href') || '';
        const t = childrenMd(n).trim();
        if (!href || /^(#tm-|javascript:)/i.test(href)) return t;
        if (!t || t === href) return href;   // autolinked bare URL stays bare
        return '[' + t.replace(/([[\]])/g, '\\$1') + '](' + linkUrl(href) + ')';
      }
      case 'IMG': {
        const src = n.getAttribute('src') || '';
        return /^https?:/i.test(src) ? '![' + (n.getAttribute('alt') || '') + '](' + linkUrl(src) + ')' : '*[image]*';
      }
      case 'UL': case 'OL':
        return '\n\n' + listMd(n) + '\n\n';
      case 'BLOCKQUOTE':
        return '\n\n' + htmlToMd(n).split('\n').map((l) => (l ? '> ' + l : '>')).join('\n') + '\n\n';
      case 'HR':
        return '\n\n---\n\n';
      case 'TABLE':
        return '\n\n' + tableMd(n) + '\n\n';
      case 'INPUT':
        return n.type === 'checkbox' ? (n.checked ? '[x] ' : '[ ] ') : '';
      default: {
        const inner = childrenMd(n);
        return BLOCK_TAGS.has(tag) ? '\n' + inner + '\n' : inner;
      }
    }
  }

  function listMd(el) {
    const ordered = el.tagName === 'OL';
    let i = parseInt(el.getAttribute('start') || '1', 10) || 1;
    const out = [];
    Array.from(el.children).forEach((li) => {
      if (li.tagName !== 'LI') return;
      const marker = ordered ? i++ + '. ' : '- ';
      const lines = tidy(childrenMd(li)).split('\n');
      const rest = lines.slice(1).map((l) => (l ? ' '.repeat(marker.length) + l : '')).join('\n');
      out.push(marker + (lines[0] || '') + (lines.length > 1 ? '\n' + rest : ''));
    });
    return out.join('\n');
  }

  function tableMd(el) {
    const rows = Array.from(el.querySelectorAll('tr')).map((tr) =>
      Array.from(tr.children).map((td) => tidy(childrenMd(td)).replace(/\n+/g, ' ').replace(/\|/g, '\\|'))
    );
    if (!rows.length) return '';
    const width = Math.max(...rows.map((r) => r.length));
    rows.forEach((r) => {
      while (r.length < width) r.push('');
    });
    const line = (r) => '| ' + r.join(' | ') + ' |';
    return [line(rows[0]), line(rows[0].map(() => '---')), ...rows.slice(1).map(line)].join('\n');
  }

  /* ================================================================ EXPORT */

  function prefsKey(chatId) {
    return [chatId || '', S.prefs.tools ? 1 : 0, S.prefs.thinking ? 1 : 0, S.prefs.system ? 1 : 0].join('|');
  }

  async function prepare(force) {
    const chatId = currentChatId();
    const key = prefsKey(chatId);
    if (!force && S.cache && S.cache.key === key && Date.now() - S.cache.at < 15000) return S.cache.result;

    let chat = chatId ? await readChatFromStorage(chatId) : null;
    if (!chat || !chat.messages.length) {
      const fromScreen = chatFromScreen();
      if (fromScreen && (!chat || fromScreen.messages.length > chat.messages.length)) chat = fromScreen;
    }
    if (!chat) throw new Error('Open a chat first.');

    const result = buildMarkdown(chat, {
      tools: !!S.prefs.tools,
      thinking: !!S.prefs.thinking,
      system: !!S.prefs.system,
      chatId
    });
    result.fromScreen = !!chat._fromScreen;
    S.cache = { key, at: Date.now(), result };
    return result;
  }

  function saveFile(name, text) {
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function countLabel(r) {
    const q = r.questions + (r.questions === 1 ? ' question' : ' questions');
    return r.fromScreen ? q + ' (from screen)' : q;
  }

  async function download() {
    try {
      const r = await prepare(false);
      saveFile(r.filename, r.md);
      toast('Saved ' + countLabel(r) + ' to .md');
      return r;
    } catch (e) {
      fail(e);
      return null;
    }
  }

  async function copy() {
    try {
      const r = await prepare(false);
      let ok = false;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(r.md);
          ok = true;
        }
      } catch (e) {
        ok = false;
      }
      if (!ok) ok = legacyCopy(r.md);
      toast(ok ? 'Copied ' + countLabel(r) : 'Copy was blocked. Use Download instead.');
      return ok;
    } catch (e) {
      fail(e);
      return false;
    }
  }

  function legacyCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (e) {
      ok = false;
    }
    ta.remove();
    return ok;
  }

  function canShareFiles() {
    try {
      const f = new File(['x'], 'x.md', { type: 'text/plain' });
      return !!(navigator.canShare && navigator.share && navigator.canShare({ files: [f] }));
    } catch (e) {
      return false;
    }
  }

  async function share() {
    try {
      const r = await prepare(false);
      const file = new File([r.md], r.filename, { type: 'text/plain' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: r.title });
      } else {
        saveFile(r.filename, r.md);
        toast('Saved ' + countLabel(r) + ' to .md');
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      fail(e);
    }
  }

  async function preview() {
    const r = await prepare(true);
    console.log(r.md);
    return r.md;
  }

  function fail(e) {
    console.error('[Chat Export]', e);
    toast(e && e.message ? e.message : 'Export failed. See the console for details.');
  }

  /* ==================================================================== UI */

  function injectStyles() {
    if (document.getElementById(IDS.style)) return;
    const st = document.createElement('style');
    st.id = IDS.style;
    st.textContent = `
#${IDS.menu}{position:fixed;z-index:2147483000;width:252px;max-width:calc(100vw - 16px);box-sizing:border-box;padding:4px;border-radius:12px;
  background:#fff;color:#0f172a;border:1px solid rgba(15,23,42,.10);box-shadow:0 12px 32px rgba(0,0,0,.16);
  font-family:inherit;font-size:14px;line-height:1.3;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
#${IDS.menu}[data-theme="dark"]{background:#27272a;color:#f4f4f5;border-color:rgba(255,255,255,.10);box-shadow:0 12px 32px rgba(0,0,0,.5)}
#${IDS.menu} .tmx-head{padding:8px 10px 6px;font-size:12px;opacity:.6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#${IDS.menu} .tmx-item{display:flex;align-items:center;justify-content:space-between;gap:14px;width:100%;box-sizing:border-box;
  padding:9px 10px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
#${IDS.menu} .tmx-item:hover,#${IDS.menu} .tmx-item:focus-visible{background:rgba(15,23,42,.07);outline:none}
#${IDS.menu}[data-theme="dark"] .tmx-item:hover,#${IDS.menu}[data-theme="dark"] .tmx-item:focus-visible{background:rgba(255,255,255,.08)}
#${IDS.menu} .tmx-hint{font-size:12px;opacity:.5;white-space:nowrap}
#${IDS.menu} .tmx-sep{height:1px;margin:4px 8px;background:rgba(15,23,42,.08)}
#${IDS.menu}[data-theme="dark"] .tmx-sep{background:rgba(255,255,255,.08)}
#${IDS.menu} .tmx-box{flex:none;width:16px;height:16px;box-sizing:border-box;border-radius:4px;border:1.5px solid currentColor;opacity:.4;
  display:inline-flex;align-items:center;justify-content:center}
#${IDS.menu} .tmx-box svg{width:11px;height:11px;display:none}
#${IDS.menu} .tmx-item[aria-checked="true"] .tmx-box{opacity:.85}
#${IDS.menu} .tmx-item[aria-checked="true"] .tmx-box svg{display:block}
#${IDS.toast}{position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom,0px));z-index:2147483001;
  transform:translate(-50%,8px);padding:8px 14px;border-radius:999px;background:rgba(24,24,27,.94);color:#fafafa;
  font-family:inherit;font-size:13px;line-height:1.3;max-width:calc(100vw - 32px);box-shadow:0 6px 20px rgba(0,0,0,.25);
  opacity:0;pointer-events:none;transition:opacity .18s ease,transform .18s ease}
#${IDS.toast}.tmx-show{opacity:1;transform:translate(-50%,0)}
#${IDS.fab}{position:fixed;right:12px;bottom:calc(96px + env(safe-area-inset-bottom,0px));z-index:2147482999;width:34px;height:34px;
  border-radius:999px;border:1px solid rgba(15,23,42,.12);background:rgba(255,255,255,.9);color:#334155;display:flex;
  align-items:center;justify-content:center;opacity:.35;cursor:pointer;padding:0}
#${IDS.fab}:hover,#${IDS.fab}:focus-visible{opacity:1}
#${IDS.fab} svg{width:16px;height:16px}
`;
    (document.head || document.documentElement).appendChild(st);
  }

  // Map TypingMind's "active tab" classes to the idle ones, so the Export
  // tab never looks selected because it copied a selected reference tab.
  const IDLE_CLASS = {
    'text-white': 'text-white/70',
    'bg-white/20': 'sm:hover:bg-white/20',
    'text-slate-900': 'text-slate-900/70',
    'bg-slate-900/20': 'sm:hover:bg-slate-900/20',
    'dark:text-white': 'dark:text-white/70',
    'dark:bg-white/20': 'sm:dark:hover:bg-white/20',
    'font-semibold': 'font-normal'
  };

  function idleClasses(className) {
    return String(className || '')
      .split(/\s+/)
      .filter((c) => c && c !== 'hidden')
      .map((c) => IDLE_CLASS[c] || c)
      .filter((c, i, arr) => arr.indexOf(c) === i)
      .join(' ');
  }

  function syncButton() {
    const bar = document.querySelector(SEL.bar);
    if (!bar) return false;
    const ref = bar.querySelector(SEL.settingsTab) || bar.querySelector(SEL.anyTab);
    if (!ref || !ref.parentNode) return false;

    let btn = document.getElementById(IDS.btn);
    if (!btn || btn.parentNode !== ref.parentNode) {
      if (btn) btn.remove();
      btn = document.createElement('button');
      btn.id = IDS.btn;
      btn.type = 'button';
      btn.setAttribute('data-element-id', 'workspace-tab-md-export');
      btn.setAttribute('aria-label', 'Export chat to Markdown');
      btn.setAttribute('aria-haspopup', 'menu');
      btn.innerHTML = ICON_EXPORT + '<span>Export</span>';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleMenu(btn);
      });
      const settings = bar.querySelector(SEL.settingsTab);
      if (settings && settings.parentNode === ref.parentNode) ref.parentNode.insertBefore(btn, settings);
      else ref.parentNode.insertBefore(btn, ref.nextSibling);
    }

    const cls = idleClasses(ref.className);
    if (btn.className !== cls) btn.className = cls;

    const refSvg = ref.querySelector('svg');
    const mySvg = btn.querySelector('svg');
    const svgClass = (refSvg && refSvg.getAttribute('class')) || 'w-4 h-4 flex-shrink-0';
    if (mySvg && mySvg.getAttribute('class') !== svgClass) mySvg.setAttribute('class', svgClass);

    const refSpan = ref.querySelector('span');
    const mySpan = btn.querySelector('span');
    if (mySpan) {
      if (refSpan) {
        const spanClass = idleClasses(refSpan.getAttribute('class') || '');
        if (mySpan.getAttribute('class') !== spanClass) mySpan.setAttribute('class', spanClass);
        const style = refSpan.getAttribute('style') || '';
        if (mySpan.getAttribute('style') !== style) mySpan.setAttribute('style', style);
        mySpan.hidden = false;
      } else {
        mySpan.hidden = true;
      }
    }

    // Tooltips only when the bar is collapsed, same as TypingMind's own tabs.
    if (ref.hasAttribute('data-tooltip-content')) {
      btn.setAttribute('data-tooltip-id', ref.getAttribute('data-tooltip-id') || 'global');
      btn.setAttribute('data-tooltip-place', ref.getAttribute('data-tooltip-place') || 'right');
      btn.setAttribute('data-tooltip-content', 'Export chat (.md)');
    } else {
      btn.removeAttribute('data-tooltip-content');
    }
    return true;
  }

  function ensureFab() {
    if (document.getElementById(IDS.fab)) return;
    const fab = document.createElement('button');
    fab.id = IDS.fab;
    fab.type = 'button';
    fab.setAttribute('aria-label', 'Export chat to Markdown');
    fab.innerHTML = ICON_EXPORT;
    fab.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleMenu(fab);
    });
    document.body.appendChild(fab);
  }

  function removeFab() {
    const fab = document.getElementById(IDS.fab);
    if (fab) fab.remove();
  }

  /* ---------------------------------------- chat header: "More actions" menu */

  function svgFrom(markup, cls) {
    const t = document.createElement('template');
    t.innerHTML = markup.trim();
    const svg = t.content.firstElementChild;
    if (cls) svg.setAttribute('class', cls);
    return svg;
  }

  // The chevron button, its wrapper, and the row of pinned header icons.
  function headerParts() {
    const btn = document.querySelector(SEL.moreBtn);
    const wrap = btn && btn.parentElement;
    const row = wrap && wrap.parentElement;
    return row ? { btn, wrap, row } : null;
  }

  // TypingMind's dropdown, if it is open right now.
  function openActionMenu() {
    const btn = document.querySelector(SEL.moreBtn);
    if (!btn) return null;
    const ctl = btn.getAttribute('aria-controls');
    let menu = ctl ? document.getElementById(ctl) : null;
    if (!menu && btn.id) {
      try {
        menu = document.querySelector('[role="menu"][aria-labelledby="' + CSS.escape(btn.id) + '"]');
      } catch (e) {
        menu = null;
      }
    }
    return menu && menu.isConnected && menu.getAttribute('role') === 'menu' ? menu : null;
  }

  // Borrow TypingMind's own pin glyph for the state we need. A native row is
  // pinned when its icon also sits in the header (works in any UI language).
  function nativePinIcon(menu, wantPinned) {
    const h = headerParts();
    if (!h) return null;
    const rows = Array.from(menu.querySelectorAll('[role="menuitem"][data-element-id]'));
    for (const it of rows) {
      const id = it.getAttribute('data-element-id');
      if (id === MENU_ITEM_ID || id === 'chat-info-button') continue;
      let pinned;
      try {
        pinned = !!h.row.querySelector(':scope > button[data-element-id="' + CSS.escape(id) + '"]');
      } catch (e) {
        continue;
      }
      if (pinned !== wantPinned) continue;
      const svg = it.querySelector('button svg');
      if (svg) return svg.cloneNode(true);
    }
    return null;
  }

  function paintPin(pin, menu) {
    const pinned = !!S.prefs.pinned;
    pin.setAttribute('aria-label', pinned ? 'Unpin button' : 'Pin button');
    pin.setAttribute('aria-pressed', pinned ? 'true' : 'false');
    const old = pin.querySelector('svg');
    const cls = (old && old.getAttribute('class')) || 'w-[18px] h-[18px] shrink-0';
    const svg = nativePinIcon(menu, pinned) || svgFrom(pinned ? ICON_PIN_ON : ICON_PIN_OFF);
    svg.setAttribute('class', cls);
    pin.replaceChildren(svg);
  }

  // Close TypingMind's menu, then resolve once it is really gone, so our own
  // menu never opens on top of it.
  function closeNativeMenu(menu) {
    return new Promise((resolve) => {
      const btn = document.querySelector(SEL.moreBtn);
      const isOpen = () => !!(menu && menu.isConnected && menu.hasAttribute('data-open')) ||
        !!(btn && btn.isConnected && btn.getAttribute('aria-expanded') === 'true');
      if (!isOpen()) {
        resolve();
        return;
      }
      // Pressing the chevron again is how TypingMind's menu closes itself.
      if (btn) btn.click();
      const started = Date.now();
      let escaped = false;
      const check = () => {
        if (!isOpen()) {
          resolve();
          return;
        }
        const waited = Date.now() - started;
        if (!escaped && waited > 150 && menu && menu.isConnected) {
          escaped = true;
          menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
        }
        if (waited > 500) resolve();
        else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
  }

  // Add our "Export .md" row, cloned from TypingMind's Share row so it looks
  // and spaces exactly like the native ones, pin button included.
  function injectMenuItem(menu) {
    if (!menu || menu.querySelector('[data-element-id="' + MENU_ITEM_ID + '"]')) return;
    const natives = Array.from(menu.querySelectorAll('[role="menuitem"]'));
    if (!natives.length) return;
    const template = menu.querySelector('[role="menuitem"][data-element-id="share-button"]') || natives[0];

    const item = template.cloneNode(true);
    ['id', 'data-headlessui-state', 'data-focus', 'data-active', 'data-disabled', 'aria-disabled'].forEach((a) => item.removeAttribute(a));
    item.setAttribute('data-element-id', MENU_ITEM_ID);
    item.setAttribute('tabindex', '-1');

    const left = item.firstElementChild;
    const right = item.children.length > 1 ? item.lastElementChild : null;
    if (left) {
      const oldIcon = left.querySelector('svg');
      const icon = svgFrom(ICON_EXPORT, (oldIcon && oldIcon.getAttribute('class')) || 'w-[18px] h-[18px] shrink-0');
      if (oldIcon) oldIcon.replaceWith(icon);
      else left.prepend(icon);
      const spans = Array.from(left.querySelectorAll(':scope > span'));
      if (spans[0]) spans[0].textContent = CONFIG.MENU_LABEL;
      spans.slice(1).forEach((s) => s.remove());   // drop Share's keyboard hint
    }

    let pin = null;
    if (right) {
      Array.from(right.children).forEach((c) => {
        if (c.tagName !== 'BUTTON') c.remove();       // drop the (i) note icon, keep the pin
      });
      pin = right.querySelector('button');
    }
    if (pin) {
      pin.type = 'button';
      paintPin(pin, menu);
      pin.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        S.prefs.pinned = !S.prefs.pinned;
        savePrefs();
        paintPin(pin, menu);
        syncHeaderButton();
      });
    }

    item.addEventListener('click', (e) => {
      if (pin && pin.contains(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      closeNativeMenu(menu).then(() => {
        openMenu(document.getElementById(IDS.headerBtn) || document.querySelector(SEL.moreBtn));
      });
    });
    item.addEventListener('pointerenter', () => item.setAttribute('data-focus', ''));
    item.addEventListener('pointerleave', () => item.removeAttribute('data-focus'));

    const share = menu.querySelector('[role="menuitem"][data-element-id="share-button"]');
    if (share && share.parentNode) share.after(item);
    else template.parentNode.appendChild(item);
  }

  // The menu opens a frame or two after the tap; add our row as soon as it exists.
  function scheduleInject() {
    const run = ++S.injectRun;
    let frames = 0;
    const step = () => {
      if (run !== S.injectRun || !S.enabled) return;
      const menu = openActionMenu();
      if (menu) {
        injectMenuItem(menu);
        watchMenu(menu);
        return;
      }
      if (++frames < 45) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // Put the row back if TypingMind re-renders the menu while it is open.
  function watchMenu(menu) {
    clearInterval(S.menuWatch);
    S.menuWatch = setInterval(() => {
      if (!menu.isConnected || !S.enabled) {
        clearInterval(S.menuWatch);
        return;
      }
      injectMenuItem(menu);
    }, 250);
  }

  function onMaybeMenuOpen(e) {
    const t = e.target;
    if (!S.enabled || !(t instanceof Element)) return;
    if (e.type === 'keydown' && !['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
    if (t.closest(SEL.moreBtn)) scheduleInject();
  }

  // When pinned, an Export icon sits in the header next to TypingMind's
  // pinned icons, styled like them.
  function syncHeaderButton() {
    const h = headerParts();
    let hb = document.getElementById(IDS.headerBtn);
    if (!h) return false;
    if (!S.prefs.pinned) {
      if (hb) hb.remove();
      return true;
    }
    const natives = Array.from(h.row.querySelectorAll(':scope > button[data-element-id]')).filter((b) => b.id !== IDS.headerBtn);
    if (!hb || hb.parentNode !== h.row) {
      if (hb) hb.remove();
      hb = document.createElement('button');
      hb.id = IDS.headerBtn;
      hb.type = 'button';
      hb.setAttribute('data-element-id', 'md-export-header-button');
      hb.setAttribute('aria-label', CONFIG.MENU_LABEL);
      hb.setAttribute('data-tooltip-id', 'global');
      hb.setAttribute('data-tooltip-content', CONFIG.MENU_LABEL);
      hb.innerHTML = ICON_EXPORT;
      hb.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleMenu(hb);
      });
      const last = natives[natives.length - 1];
      if (last) last.after(hb);
      else h.row.insertBefore(hb, h.wrap);
    }
    const ref = natives[0];
    const cls = ref ? ref.className : HEADER_BTN_CLASS;
    if (hb.className !== cls) hb.className = cls;
    const refSvg = ref && ref.querySelector('svg');
    const svgCls = (refSvg && refSvg.getAttribute('class')) || 'w-[18px] h-[18px]';
    const mine = hb.querySelector('svg');
    if (mine && mine.getAttribute('class') !== svgCls) mine.setAttribute('class', svgCls);
    return true;
  }

  function tick() {
    if (!S.enabled) return;
    try {
      const headerOk = syncHeaderButton();
      const menu = openActionMenu();
      if (menu) injectMenuItem(menu);
      let barOk = false;
      if (CONFIG.WORKSPACE_TAB) barOk = syncButton();
      else {
        const tab = document.getElementById(IDS.btn);
        if (tab) tab.remove();
      }
      if (headerOk || barOk) {
        S.entrySeen = true;
        removeFab();
      } else if (!S.entrySeen && Date.now() - S.startedAt > CONFIG.FAB_AFTER_MS && document.querySelector(SEL.block)) {
        ensureFab();   // TypingMind changed its header; keep a way in
      }
    } catch (e) {
      console.debug('[Chat Export] tick', e);
    }
  }

  /* ------------------------------------------------------------------ menu */

  function menuItem(label, hint, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tmx-item';
    b.setAttribute('role', 'menuitem');
    const l = document.createElement('span');
    l.textContent = label;
    b.appendChild(l);
    if (hint) {
      const h = document.createElement('span');
      h.className = 'tmx-hint';
      h.textContent = hint;
      b.appendChild(h);
    }
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  function toggleItem(label, prefKey) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tmx-item';
    b.setAttribute('role', 'menuitemcheckbox');
    b.setAttribute('aria-checked', S.prefs[prefKey] ? 'true' : 'false');
    const l = document.createElement('span');
    l.textContent = label;
    const box = document.createElement('span');
    box.className = 'tmx-box';
    box.innerHTML = ICON_CHECK;
    b.append(l, box);
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      S.prefs[prefKey] = !S.prefs[prefKey];
      savePrefs();
      S.cache = null;
      b.setAttribute('aria-checked', S.prefs[prefKey] ? 'true' : 'false');
    });
    return b;
  }

  function sep() {
    const d = document.createElement('div');
    d.className = 'tmx-sep';
    return d;
  }

  function toggleMenu(anchor) {
    if (document.getElementById(IDS.menu)) {
      closeMenu();
      return;
    }
    openMenu(anchor);
  }

  function openMenu(anchor) {
    injectStyles();
    closeMenu();
    const menu = document.createElement('div');
    menu.id = IDS.menu;
    menu.setAttribute('role', 'menu');
    menu.dataset.theme = isDark() ? 'dark' : 'light';

    const head = document.createElement('div');
    head.className = 'tmx-head';
    head.textContent = 'Reading chat…';
    menu.appendChild(head);

    const keyHint = isTouch() ? '' : isMac() ? '⌘⇧E' : 'Ctrl+Shift+E';
    menu.appendChild(menuItem('Download .md', keyHint, () => {
      closeMenu();
      download();
    }));
    menu.appendChild(menuItem('Copy markdown', '', () => {
      closeMenu();
      copy();
    }));
    if (isTouch() && canShareFiles()) {
      menu.appendChild(menuItem('Share…', '', () => {
        closeMenu();
        share();
      }));
    }
    menu.appendChild(sep());
    menu.appendChild(toggleItem('Tool calls', 'tools'));
    menu.appendChild(toggleItem('Thinking', 'thinking'));
    menu.appendChild(toggleItem('System prompt', 'system'));

    document.body.appendChild(menu);
    S.menuAnchor = anchor || null;
    positionMenu(menu, anchor);

    // Read the chat now so Copy/Share run inside the tap's user activation.
    prepare(true)
      .then((r) => {
        if (!menu.isConnected) return;
        head.textContent = r.title + ' · ' + countLabel(r);
        head.title = head.textContent;
        positionMenu(menu, S.menuAnchor);
      })
      .catch((e) => {
        if (menu.isConnected) head.textContent = e && e.message ? e.message : 'No chat open';
      });

    setTimeout(() => {
      document.addEventListener('pointerdown', onOutside, true);
      document.addEventListener('keydown', onMenuKey, true);
      window.addEventListener('resize', closeMenu);
    }, 0);
  }

  function positionMenu(menu, anchor) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    let left;
    let top;
    if (anchor && anchor.getBoundingClientRect) {
      const r = anchor.getBoundingClientRect();
      const bar = anchor.closest ? anchor.closest(SEL.bar) : null;
      const br = bar ? bar.getBoundingClientRect() : null;
      // Desktop: tall bar on the left, open to the side. Phone: bottom bar, open above.
      const horizontal = br ? br.width > br.height : r.top > vh * 0.6;
      const lowerHalf = r.top + r.height / 2 > vh / 2;
      if (!horizontal && r.right + 8 + mw <= vw) {
        left = r.right + 8;
        top = lowerHalf ? r.bottom - mh : r.top;
      } else {
        left = r.left + r.width / 2 - mw / 2;
        top = lowerHalf ? r.top - mh - 8 : r.bottom + 8;
      }
    } else {
      left = (vw - mw) / 2;
      top = vh - mh - 96;
    }
    menu.style.left = Math.round(Math.min(Math.max(8, left), vw - mw - 8)) + 'px';
    menu.style.top = Math.round(Math.min(Math.max(8, top), vh - mh - 8)) + 'px';
  }

  function onOutside(e) {
    const menu = document.getElementById(IDS.menu);
    if (!menu) return;
    if (menu.contains(e.target)) return;
    if (S.menuAnchor && S.menuAnchor.contains(e.target)) return;
    closeMenu();
  }

  function onMenuKey(e) {
    if (e.key === 'Escape' && e.isTrusted) {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
    }
  }

  function closeMenu() {
    const menu = document.getElementById(IDS.menu);
    if (menu) menu.remove();
    S.menuAnchor = null;
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onMenuKey, true);
    window.removeEventListener('resize', closeMenu);
  }

  /* ----------------------------------------------------------------- toast */

  function toast(msg) {
    injectStyles();
    let t = document.getElementById(IDS.toast);
    if (!t) {
      t = document.createElement('div');
      t.id = IDS.toast;
      t.setAttribute('role', 'status');
      document.body.appendChild(t);
    }
    t.textContent = msg;
    requestAnimationFrame(() => t.classList.add('tmx-show'));
    clearTimeout(S.toastTimer);
    S.toastTimer = setTimeout(() => t.classList.remove('tmx-show'), 2400);
  }

  /* -------------------------------------------------------------- shortcut */

  function onShortcut(e) {
    if (!S.enabled || e.repeat) return;
    const isE = e.code === 'KeyE' || String(e.key).toLowerCase() === 'e';
    if (isE && e.shiftKey && (e.ctrlKey || e.metaKey) && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      download();
    }
  }

  /* ============================================================ LIFECYCLE */

  function start() {
    S.enabled = true;
    injectStyles();
    tick();
    if (!S.pollTimer) S.pollTimer = setInterval(tick, CONFIG.POLL_MS);
  }

  function stop() {
    S.enabled = false;
    clearInterval(S.pollTimer);
    clearInterval(S.menuWatch);
    S.pollTimer = null;
    closeMenu();
    removeFab();
    [IDS.btn, IDS.headerBtn].forEach((id) => {
      const n = document.getElementById(id);
      if (n) n.remove();
    });
    document.querySelectorAll('[data-element-id="' + MENU_ITEM_ID + '"]').forEach((n) => n.remove());
  }

  function destroy() {
    stop();
    S.cleanups.splice(0).forEach((fn) => {
      try {
        fn();
      } catch (e) {
        /* listener already gone */
      }
    });
    [IDS.toast, IDS.style].forEach((id) => {
      const n = document.getElementById(id);
      if (n) n.remove();
    });
    if (window.tmExport === api) delete window.tmExport;
    if (window[NS] === api) delete window[NS];
  }

  on(window, 'keydown', onShortcut, true);
  on(document, 'pointerdown', onMaybeMenuOpen, true);
  on(document, 'click', onMaybeMenuOpen, true);
  on(document, 'keydown', onMaybeMenuOpen, true);
  on(window, 'hashchange', () => {
    S.cache = null;
    closeMenu();
  });
  on(document, 'visibilitychange', () => {
    if (!document.hidden) tick();
  });

  const api = {
    version: CONFIG.VERSION,
    download,
    copy,
    share,
    preview,
    off: stop,
    on: start,
    destroy,
    status() {
      const info = {
        version: CONFIG.VERSION,
        enabled: S.enabled,
        chatId: currentChatId(),
        moreActionsButton: !!document.querySelector(SEL.moreBtn),
        headerIcon: !!document.getElementById(IDS.headerBtn),
        workspaceTab: !!document.getElementById(IDS.btn),
        prefs: Object.assign({}, S.prefs)
      };
      console.table(info);
      return info;
    },
    // exposed for testing and power use
    _buildMarkdown: buildMarkdown,
    _readChat: readChatFromStorage
  };

  window[NS] = api;
  window.tmExport = api;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
