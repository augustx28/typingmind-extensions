/* =============================================================================
 * TypingMind Extension — YouTube Chat Auto-Titler
 * v1.1
 * -----------------------------------------------------------------------------
 * WHAT CHANGED FROM v1.0
 *   - ENFORCE MODE: any chat whose opening messages contain a YouTube link is
 *     kept named after the video, permanently. Previously the extension only
 *     touched titles matching a junk list, so TypingMind's own title generator
 *     (and the Regenerate button) could overwrite the good title and win.
 *   - LOCK PREFIX: start a title with '*' and the extension never touches that
 *     chat again. Your escape hatch for manual naming.
 *   - INTERCEPTOR (opt-in): answers TypingMind's title-generation API call
 *     locally with the real video title, so the wrong title is never written in
 *     the first place. No flicker, no tokens spent.
 *   - Persistent cache so it isn't re-hitting oEmbed on every poll.
 *   - Falls back to reading the title out of your transcript plugin's output if
 *     oEmbed fails (unlisted / age-restricted videos).
 *
 * Console API:
 *   __ytTitler.inspect()   -> storage schema + sample chat
 *   __ytTitler.dryRun()    -> what WOULD change, changes nothing
 *   __ytTitler.run()       -> apply now
 *   __ytTitler.forget(key) -> stop managing one chat
 *   __ytTitler.config      -> live config, edit freely
 * ========================================================================== */

(function () {
  'use strict';

  const VERSION = '1.1.0';

  const CONFIG = {
    debug: true,

    // Keep YouTube chats named after the video no matter what overwrites them.
    // This is the fix for the Regenerate problem. Set false for v1.0 behaviour.
    enforce: true,

    // A title beginning with this string is user-locked and never modified.
    lockPrefix: '*',

    // Answer TypingMind's title-generation request ourselves instead of racing
    // it. Eliminates the flicker and costs zero tokens. Turn this on only once
    // enforce mode is confirmed working, so you can tell which one is acting.
    suppressNativeTitleGen: false,

    // Raise this if the app feels sluggish — each pass scans your chat store.
    pollMs: 3000,
    startupDelayMs: 3000,

    // Output format. Tokens: {title} {channel} {id}
    titleFormat: '{title}',
    maxTitleLength: 90,

    // Only consulted when enforce is false.
    junkTitles: [
      /^$/, /^video$/i, /^video link$/i, /^youtube$/i, /^youtube video$/i,
      /^youtube link$/i, /^link$/i, /^volume$/i, /^summary$/i,
      /^summary notes$/i, /^video summary$/i, /^new chat$/i, /^untitled/i,
      /^https?:\/\//i, /^youtu\.be\//i,
    ],

    scanFirstNMessages: 4,
    maxAttempts: 3,
    bumpUpdatedAt: false,
  };

  const log = (...a) => CONFIG.debug && console.log('%c[YT-Titler]', 'color:#4ea1ff;font-weight:bold', ...a);
  const warn = (...a) => console.warn('[YT-Titler]', ...a);

  /* ---------------------------------------------------------------------------
   * Persistent state — survives reloads
   * ------------------------------------------------------------------------ */

  const STATE_KEY = '__ytTitler_state_v1';

  function loadState() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY)) || { chats: {}, videos: {} }; }
    catch (_) { return { chats: {}, videos: {} }; }
  }
  function saveState(s) {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch (_) {}
  }

  const state = loadState();
  if (!state.chats) state.chats = {};   // chatKey -> { videoId, title, locked }
  if (!state.videos) state.videos = {}; // videoId -> { title, channel }

  /* ---------------------------------------------------------------------------
   * YouTube link detection
   * ------------------------------------------------------------------------ */

  const YT_RE = /(?:youtube\.com\/(?:watch\?(?:[^\s]*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

  const extractVideoId = (text) => {
    if (typeof text !== 'string') return null;
    const m = text.match(YT_RE);
    return m ? m[1] : null;
  };

  function contentToText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map((p) => (typeof p === 'string' ? p : (p && (p.text || p.content)) || '')).join(' ');
    }
    if (content && typeof content === 'object') return content.text || '';
    return '';
  }

  /* ---------------------------------------------------------------------------
   * Title lookup: oEmbed -> JSONP -> transcript plugin output
   * ------------------------------------------------------------------------ */

  function jsonp(url, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const cb = '__ytTitlerCB' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      let timer;
      const cleanup = () => { delete window[cb]; script.remove(); clearTimeout(timer); };
      timer = setTimeout(() => { cleanup(); reject(new Error('JSONP timeout')); }, timeoutMs);
      window[cb] = (d) => { cleanup(); resolve(d); };
      script.onerror = () => { cleanup(); reject(new Error('JSONP load error')); };
      script.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + cb;
      document.head.appendChild(script);
    });
  }

  function decodeEntities(str) {
    const el = document.createElement('textarea');
    el.innerHTML = String(str);
    return el.value;
  }

  async function fetchVideoInfo(videoId) {
    if (state.videos[videoId]) return state.videos[videoId];

    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    let data = null;

    try {
      const res = await nativeFetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`
      );
      if (res.ok) data = await res.json();
    } catch (e) {
      log('Direct oEmbed unavailable, trying JSONP:', e.message);
    }

    if (!data || !data.title) {
      try { data = await jsonp(`https://noembed.com/embed?url=${encodeURIComponent(watchUrl)}`); }
      catch (e) { warn('Lookup failed for', videoId, '-', e.message); return null; }
    }

    if (!data || !data.title) return null;

    const info = { title: decodeEntities(data.title), channel: decodeEntities(data.author_name || '') };
    state.videos[videoId] = info;
    saveState(state);
    return info;
  }

  // Last resort: your transcript plugin usually returns the title in its output.
  function titleFromPluginOutput(chat, messagesField) {
    const msgs = chat[messagesField] || [];
    for (const m of msgs.slice(0, 8)) {
      const text = contentToText(m && m.content);
      if (!text) continue;
      const match =
        text.match(/"(?:video_?)?title"\s*:\s*"([^"]{3,140})"/i) ||
        text.match(/^\s*(?:video\s*)?title\s*[:\-—]\s*(.{3,140})$/im);
      if (match) return { title: decodeEntities(match[1].trim()), channel: '' };
    }
    return null;
  }

  function buildTitle(info, videoId) {
    let out = CONFIG.titleFormat
      .replace('{title}', info.title)
      .replace('{channel}', info.channel)
      .replace('{id}', videoId)
      .replace(/\s+/g, ' ')
      .trim();
    if (out.length > CONFIG.maxTitleLength) out = out.slice(0, CONFIG.maxTitleLength - 1).trimEnd() + '…';
    return out;
  }

  /* ---------------------------------------------------------------------------
   * IndexedDB
   * ------------------------------------------------------------------------ */

  const idbOpen = (name) => new Promise((res, rej) => {
    const r = indexedDB.open(name);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('open blocked'));
  });

  const idbScan = (db, store, onRecord) => new Promise((res, rej) => {
    const hits = [];
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).openCursor();
    req.onsuccess = (e) => {
      const c = e.target.result;
      if (!c) return;
      try { const h = onRecord(c.key, c.value); if (h) hits.push(h); } catch (_) {}
      c.continue();
    };
    tx.oncomplete = () => res(hits);
    tx.onerror = () => rej(tx.error);
  });

  const idbGet = (db, store, key) => new Promise((res, rej) => {
    const r = db.transaction(store, 'readonly').objectStore(store).get(key);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });

  const idbPut = (db, store, key, value) => new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    const s = tx.objectStore(store);
    if (s.keyPath === null || s.keyPath === undefined) s.put(value, key);
    else s.put(value);
    tx.oncomplete = () => res(true);
    tx.onerror = () => rej(tx.error);
  });

  /* ---------------------------------------------------------------------------
   * Schema discovery
   * ------------------------------------------------------------------------ */

  const TITLE_FIELDS = ['chatTitle', 'title', 'name', 'chatName'];
  const MSG_FIELDS = ['messages', 'chatMessages', 'msgs'];

  function looksLikeChat(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const messagesField = MSG_FIELDS.find((f) => Array.isArray(v[f]));
    if (!messagesField) return null;
    const titleField =
      TITLE_FIELDS.find((f) => typeof v[f] === 'string') ||
      TITLE_FIELDS.find((f) => f in v) || 'chatTitle';
    return { titleField, messagesField };
  }

  let schemaCache = null;

  async function detectSchema() {
    if (schemaCache) return schemaCache;

    let names = ['keyval-store'];
    if (indexedDB.databases) {
      try { names = (await indexedDB.databases()).map((d) => d.name).filter(Boolean); } catch (_) {}
    }

    for (const dbName of names) {
      let db;
      try { db = await idbOpen(dbName); } catch (_) { continue; }
      for (const storeName of Array.from(db.objectStoreNames)) {
        let found = null, sampled = 0;
        try {
          await idbScan(db, storeName, (key, value) => {
            if (found || sampled++ > 200) return null;
            const shape = looksLikeChat(value);
            if (shape) found = { dbName, storeName, ...shape, sampleKey: key };
            return null;
          });
        } catch (_) { continue; }
        if (found) { db.close(); schemaCache = found; log('Chat storage:', found); return schemaCache; }
      }
      db.close();
    }
    warn('Chat store not found. Run __ytTitler.inspect() and send the output.');
    return null;
  }

  /* ---------------------------------------------------------------------------
   * The pass
   * ------------------------------------------------------------------------ */

  const attempts = new Map();
  let busy = false;

  const isJunkTitle = (t) => CONFIG.junkTitles.some((re) => re.test((t || '').trim()));

  function findVideoId(chat, messagesField) {
    for (const m of (chat[messagesField] || []).slice(0, CONFIG.scanFirstNMessages)) {
      if (!m) continue;
      const id = extractVideoId(contentToText(m.content));
      if (id) return id;
    }
    return null;
  }

  async function pass({ dry = false } = {}) {
    if (busy) return [];
    busy = true;
    const results = [];

    try {
      const schema = await detectSchema();
      if (!schema) return results;

      const db = await idbOpen(schema.dbName);

      const candidates = await idbScan(db, schema.storeName, (key, value) => {
        const shape = looksLikeChat(value);
        if (!shape) return null;

        const k = String(key);
        const current = (value[schema.titleField] || '').trim();

        // User-locked, leave alone forever.
        if (CONFIG.lockPrefix && current.startsWith(CONFIG.lockPrefix)) {
          if (state.chats[k]) { state.chats[k].locked = true; }
          return null;
        }
        if (state.chats[k] && state.chats[k].locked) return null;
        if ((attempts.get(k) || 0) >= CONFIG.maxAttempts) return null;

        // Cheap path: we already know this chat's video, just compare titles.
        const known = state.chats[k];
        if (known && known.videoId) {
          return current === known.title ? null : { key, videoId: known.videoId, oldTitle: current };
        }

        if (!CONFIG.enforce && !isJunkTitle(current)) return null;

        const videoId = findVideoId(value, schema.messagesField);
        if (!videoId) return null;
        return { key, videoId, oldTitle: current, needsPluginFallback: true };
      });

      for (const c of candidates) {
        let info = await fetchVideoInfo(c.videoId);

        if (!info && c.needsPluginFallback) {
          const fresh = await idbGet(db, schema.storeName, c.key);
          if (fresh) info = titleFromPluginOutput(fresh, schema.messagesField);
        }
        if (!info) {
          attempts.set(String(c.key), (attempts.get(String(c.key)) || 0) + 1);
          continue;
        }

        const newTitle = buildTitle(info, c.videoId);
        if (newTitle === c.oldTitle) continue;

        results.push({ oldTitle: c.oldTitle, newTitle, videoId: c.videoId });

        if (dry) { log('[dry run]', c.oldTitle || '(blank)', '→', newTitle); continue; }

        const fresh = await idbGet(db, schema.storeName, c.key);
        if (!fresh) continue;
        fresh[schema.titleField] = newTitle;
        if (CONFIG.bumpUpdatedAt) fresh.updatedAt = new Date().toISOString();
        await idbPut(db, schema.storeName, c.key, fresh);

        state.chats[String(c.key)] = { videoId: c.videoId, title: newTitle, locked: false };
        saveState(state);
        patchSidebar(c.oldTitle, newTitle);
        log('Set:', c.oldTitle || '(blank)', '→', newTitle);
      }

      db.close();
    } catch (e) {
      warn('Pass failed:', e);
    } finally {
      busy = false;
    }

    return results;
  }

  function patchSidebar(oldTitle, newTitle) {
    if (!oldTitle) return;
    try {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        if (n.nodeValue && n.nodeValue.trim() === oldTitle) {
          n.nodeValue = n.nodeValue.replace(oldTitle, newTitle);
        }
      }
    } catch (_) {}
  }

  /* ---------------------------------------------------------------------------
   * Optional: answer TypingMind's title request ourselves
   * ------------------------------------------------------------------------ */

  const nativeFetch = window.fetch.bind(window);

  function collectBodyText(body) {
    const parts = [];
    if (typeof body.system === 'string') parts.push(body.system);
    for (const m of body.messages || []) parts.push(contentToText(m && m.content));
    return parts.join('\n');
  }

  // Title requests are short, carry no tool definitions, and mention a title.
  function isTitleRequest(body, text) {
    if (!body || !Array.isArray(body.messages)) return false;
    if (body.tools || body.functions) return false;
    if (text.length > 2000) return false;
    if (!YT_RE.test(text)) return false;
    const smallBudget = typeof body.max_tokens === 'number' && body.max_tokens <= 200;
    return smallBudget || /\btitles?\b/i.test(text);
  }

  function jsonResponse(title, isAnthropic) {
    const payload = isAnthropic
      ? { id: 'msg_ytt', type: 'message', role: 'assistant', model: 'yt-titler',
          content: [{ type: 'text', text: title }], stop_reason: 'end_turn',
          usage: { input_tokens: 0, output_tokens: 0 } }
      : { id: 'chatcmpl-ytt', object: 'chat.completion', created: Math.floor(Date.now() / 1000),
          model: 'yt-titler',
          choices: [{ index: 0, message: { role: 'assistant', content: title }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } };
    return new Response(JSON.stringify(payload), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  function sseResponse(title) {
    const chunk = (delta, finish) => 'data: ' + JSON.stringify({
      id: 'chatcmpl-ytt', object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000), model: 'yt-titler',
      choices: [{ index: 0, delta, finish_reason: finish || null }],
    }) + '\n\n';

    const body = chunk({ role: 'assistant', content: title }) + chunk({}, 'stop') + 'data: [DONE]\n\n';
    return new Response(body, {
      status: 200, headers: { 'Content-Type': 'text/event-stream' },
    });
  }

  function installInterceptor() {
    if (window.__ytTitlerPatched) return;
    window.fetch = async function (input, init) {
      try {
        if (CONFIG.suppressNativeTitleGen) {
          const url = typeof input === 'string' ? input : (input && input.url) || '';
          const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
          const raw = init && init.body;

          if (method === 'POST' && /\/(chat\/completions|messages)(\?|$)/.test(url)
              && typeof raw === 'string' && raw.length < 12000) {
            const body = JSON.parse(raw);
            const text = collectBodyText(body);
            if (isTitleRequest(body, text)) {
              const vid = extractVideoId(text);
              const info = vid ? await fetchVideoInfo(vid) : null;
              if (info) {
                const title = buildTitle(info, vid);
                log('Intercepted title request →', title);
                const isAnthropic = /\/messages(\?|$)/.test(url);
                if (body.stream && !isAnthropic) return sseResponse(title);
                if (!body.stream) return jsonResponse(title, isAnthropic);
                // Anthropic streaming: let it through, enforce mode catches it.
              }
            }
          }
        }
      } catch (_) { /* never break a real request */ }
      return nativeFetch(input, init);
    };
    window.__ytTitlerPatched = true;
  }

  /* ---------------------------------------------------------------------------
   * Diagnostics + boot
   * ------------------------------------------------------------------------ */

  async function inspect() {
    const out = { version: VERSION, databases: [], schema: null, sampleChat: null,
                  managedChats: Object.keys(state.chats).length };
    if (indexedDB.databases) {
      try {
        for (const { name } of await indexedDB.databases()) {
          if (!name) continue;
          try { const db = await idbOpen(name); out.databases.push({ name, stores: Array.from(db.objectStoreNames) }); db.close(); }
          catch (_) { out.databases.push({ name, stores: '(could not open)' }); }
        }
      } catch (e) { out.databases = '(failed: ' + e.message + ')'; }
    }
    const schema = await detectSchema();
    out.schema = schema;
    if (schema) {
      const db = await idbOpen(schema.dbName);
      const s = await idbGet(db, schema.storeName, schema.sampleKey);
      db.close();
      if (s) out.sampleChat = {
        key: String(schema.sampleKey),
        topLevelFields: Object.keys(s),
        titleValue: s[schema.titleField],
        messageCount: (s[schema.messagesField] || []).length,
        firstMessageShape: (s[schema.messagesField] || [])[0] ? Object.keys(s[schema.messagesField][0]) : null,
      };
    }
    console.log('%c[YT-Titler] inspect()', 'color:#4ea1ff;font-weight:bold', out);
    return out;
  }

  window.__ytTitler = {
    version: VERSION,
    config: CONFIG,
    state,
    run: () => pass({ dry: false }),
    dryRun: () => pass({ dry: true }),
    inspect,
    forget: (key) => { delete state.chats[String(key)]; saveState(state); log('Forgot', key); },
    reset: () => { localStorage.removeItem(STATE_KEY); state.chats = {}; state.videos = {}; schemaCache = null; attempts.clear(); log('Reset.'); },
  };

  installInterceptor();

  setTimeout(() => {
    log(`v${VERSION} loaded. enforce=${CONFIG.enforce}, interceptor=${CONFIG.suppressNativeTitleGen}`);
    pass({ dry: false });
    setInterval(() => pass({ dry: false }), CONFIG.pollMs);
    window.addEventListener('focus', () => pass({ dry: false }));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pass({ dry: false }); });
  }, CONFIG.startupDelayMs);
})();
