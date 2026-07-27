/* =============================================================================
 * TypingMind Extension — YouTube Chat Auto-Titler
 * -----------------------------------------------------------------------------
 * Finds chats whose title is a generic placeholder ("Video Link", "YouTube
 * Video", etc.) and whose opening message contains a YouTube link, looks up the
 * real video title via oEmbed, and rewrites the chat title in place.
 *
 * No LLM call. No tokens. No waiting on the summarizer to finish.
 *
 * Console API (open devtools and type these):
 *   __ytTitler.inspect()   -> show detected storage schema + a sample chat
 *   __ytTitler.dryRun()    -> list what WOULD be renamed, change nothing
 *   __ytTitler.run()       -> rename now
 *   __ytTitler.config      -> live config object, edit freely
 *
 * BACK UP FIRST: Settings -> Export/Backup. This writes to your chat database.
 * ========================================================================== */

(function () {
  'use strict';

  const VERSION = '1.0.0';

  const CONFIG = {
    // Console chatter. Set false once you trust it.
    debug: true,

    // How often to scan for newly-created chats, in milliseconds.
    pollMs: 4000,

    // Wait this long after page load before the first scan.
    startupDelayMs: 3000,

    // Titles safe to overwrite. Anything NOT matching is left alone, so a title
    // you wrote by hand will never be clobbered. Add your own patterns here.
    junkTitles: [
      /^$/,
      /^video$/i,
      /^video link$/i,
      /^youtube$/i,
      /^youtube video$/i,
      /^youtube link$/i,
      /^link$/i,
      /^volume$/i,
      /^summary$/i,
      /^summary notes$/i,
      /^video summary$/i,
      /^new chat$/i,
      /^untitled/i,
      /^https?:\/\//i,
      /^youtu\.be\//i,
    ],

    // Output format. Tokens: {title} {channel} {id}
    // Examples: '{title}'  |  '{title} — {channel}'  |  '▶ {title}'
    titleFormat: '{title}',

    // Truncate long video titles to keep the sidebar readable.
    maxTitleLength: 90,

    // Touching updatedAt can reorder your chat list and may confuse cloud sync.
    // Leave false unless renames aren't syncing across devices.
    bumpUpdatedAt: false,

    // How many messages deep to look for the link.
    scanFirstNMessages: 3,

    // Give up on a chat after this many failed attempts.
    maxAttempts: 3,
  };

  const log = (...a) => CONFIG.debug && console.log('%c[YT-Titler]', 'color:#4ea1ff;font-weight:bold', ...a);
  const warn = (...a) => console.warn('[YT-Titler]', ...a);

  /* ---------------------------------------------------------------------------
   * 1. YouTube link detection
   * ------------------------------------------------------------------------ */

  const YT_RE = /(?:youtube\.com\/(?:watch\?(?:[^\s]*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

  function extractVideoId(text) {
    if (typeof text !== 'string') return null;
    const m = text.match(YT_RE);
    return m ? m[1] : null;
  }

  // Message content may be a plain string or an array of content parts.
  function contentToText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((p) => (typeof p === 'string' ? p : (p && (p.text || p.content)) || ''))
        .join(' ');
    }
    if (content && typeof content === 'object') return content.text || '';
    return '';
  }

  /* ---------------------------------------------------------------------------
   * 2. Title lookup — oEmbed direct, JSONP fallback if CORS blocks it
   * ------------------------------------------------------------------------ */

  const titleCache = new Map();

  function jsonp(url, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const cb = '__ytTitlerCB' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      let timer;
      const cleanup = () => {
        delete window[cb];
        script.remove();
        clearTimeout(timer);
      };
      timer = setTimeout(() => { cleanup(); reject(new Error('JSONP timeout')); }, timeoutMs);
      window[cb] = (data) => { cleanup(); resolve(data); };
      script.onerror = () => { cleanup(); reject(new Error('JSONP load error')); };
      script.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + cb;
      document.head.appendChild(script);
    });
  }

  async function fetchVideoInfo(videoId) {
    if (titleCache.has(videoId)) return titleCache.get(videoId);

    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    let data = null;

    // Attempt 1: YouTube's own oEmbed endpoint.
    try {
      const res = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`
      );
      if (res.ok) data = await res.json();
    } catch (e) {
      log('Direct oEmbed blocked, falling back to JSONP:', e.message);
    }

    // Attempt 2: noembed via JSONP — sidesteps CORS entirely.
    if (!data || !data.title) {
      try {
        data = await jsonp(`https://noembed.com/embed?url=${encodeURIComponent(watchUrl)}`);
      } catch (e) {
        warn('Title lookup failed for', videoId, '-', e.message);
        return null;
      }
    }

    if (!data || !data.title) return null;

    const info = { title: decodeEntities(data.title), channel: decodeEntities(data.author_name || '') };
    titleCache.set(videoId, info);
    return info;
  }

  function decodeEntities(str) {
    const el = document.createElement('textarea');
    el.innerHTML = str;
    return el.value;
  }

  function buildTitle(info, videoId) {
    let out = CONFIG.titleFormat
      .replace('{title}', info.title)
      .replace('{channel}', info.channel)
      .replace('{id}', videoId)
      .replace(/\s+/g, ' ')
      .trim();
    if (out.length > CONFIG.maxTitleLength) {
      out = out.slice(0, CONFIG.maxTitleLength - 1).trimEnd() + '…';
    }
    return out;
  }

  /* ---------------------------------------------------------------------------
   * 3. IndexedDB plumbing
   * ------------------------------------------------------------------------ */

  function idbOpen(dbName) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB open blocked'));
    });
  }

  function idbScan(db, storeName, onRecord) {
    return new Promise((resolve, reject) => {
      const hits = [];
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).openCursor();
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor) return;
        try {
          const hit = onRecord(cursor.key, cursor.value);
          if (hit) hits.push(hit);
        } catch (_) { /* skip malformed records */ }
        cursor.continue();
      };
      tx.oncomplete = () => resolve(hits);
      tx.onerror = () => reject(tx.error);
    });
  }

  function idbGet(db, storeName, key) {
    return new Promise((resolve, reject) => {
      const req = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function idbPut(db, storeName, key, value) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      // Out-of-line keys (keyPath null) need the key passed separately.
      if (store.keyPath === null || store.keyPath === undefined) store.put(value, key);
      else store.put(value);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  /* ---------------------------------------------------------------------------
   * 4. Schema discovery — find where this build keeps its chats
   * ------------------------------------------------------------------------ */

  const TITLE_FIELDS = ['chatTitle', 'title', 'name', 'chatName'];
  const MSG_FIELDS = ['messages', 'chatMessages', 'msgs'];

  function looksLikeChat(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const messagesField = MSG_FIELDS.find((f) => Array.isArray(value[f]));
    if (!messagesField) return null;
    const titleField =
      TITLE_FIELDS.find((f) => typeof value[f] === 'string') ||
      TITLE_FIELDS.find((f) => f in value) ||
      'chatTitle';
    return { titleField, messagesField };
  }

  let schemaCache = null;

  async function detectSchema() {
    if (schemaCache) return schemaCache;

    let dbNames = ['keyval-store'];
    if (indexedDB.databases) {
      try {
        const list = await indexedDB.databases();
        dbNames = list.map((d) => d.name).filter(Boolean);
      } catch (_) { /* keep the default guess */ }
    }

    for (const dbName of dbNames) {
      let db;
      try { db = await idbOpen(dbName); } catch (_) { continue; }

      for (const storeName of Array.from(db.objectStoreNames)) {
        let found = null;
        let sampled = 0;
        try {
          await idbScan(db, storeName, (key, value) => {
            if (found || sampled++ > 200) return null;
            const shape = looksLikeChat(value);
            if (shape) found = { dbName, storeName, ...shape, sampleKey: key };
            return null;
          });
        } catch (_) { continue; }

        if (found) {
          db.close();
          schemaCache = found;
          log('Detected chat storage:', found);
          return schemaCache;
        }
      }
      db.close();
    }

    warn('Could not locate the chat store. Run __ytTitler.inspect() and send me the output.');
    return null;
  }

  /* ---------------------------------------------------------------------------
   * 5. The main pass
   * ------------------------------------------------------------------------ */

  const attempts = new Map(); // chat key -> failure count
  let busy = false;

  function isJunkTitle(title) {
    const t = (title || '').trim();
    return CONFIG.junkTitles.some((re) => re.test(t));
  }

  function findVideoId(chat, messagesField) {
    const msgs = chat[messagesField] || [];
    for (const m of msgs.slice(0, CONFIG.scanFirstNMessages)) {
      if (!m) continue;
      const id = extractVideoId(contentToText(m.content));
      if (id) return id;
    }
    // Some plugin flows stash the URL on the chat itself.
    return extractVideoId(chat.title || '') || extractVideoId(chat.chatTitle || '');
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
        if (!isJunkTitle(value[schema.titleField])) return null;
        if ((attempts.get(String(key)) || 0) >= CONFIG.maxAttempts) return null;
        const videoId = findVideoId(value, schema.messagesField);
        if (!videoId) return null;
        return { key, videoId, oldTitle: (value[schema.titleField] || '').trim() };
      });

      for (const c of candidates) {
        const info = await fetchVideoInfo(c.videoId);
        if (!info) {
          attempts.set(String(c.key), (attempts.get(String(c.key)) || 0) + 1);
          continue;
        }

        const newTitle = buildTitle(info, c.videoId);
        results.push({ oldTitle: c.oldTitle, newTitle, videoId: c.videoId });

        if (dry) {
          log('[dry run]', c.oldTitle || '(blank)', '→', newTitle);
          continue;
        }

        const fresh = await idbGet(db, schema.storeName, c.key);
        if (!fresh) continue;
        fresh[schema.titleField] = newTitle;
        if (CONFIG.bumpUpdatedAt) fresh.updatedAt = new Date().toISOString();

        await idbPut(db, schema.storeName, c.key, fresh);
        patchSidebar(c.oldTitle, newTitle);
        log('Renamed:', c.oldTitle || '(blank)', '→', newTitle);
      }

      db.close();
    } catch (e) {
      warn('Pass failed:', e);
    } finally {
      busy = false;
    }

    return results;
  }

  // Swap the visible text immediately so you don't have to refresh to see it.
  function patchSidebar(oldTitle, newTitle) {
    if (!oldTitle) return;
    try {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.nodeValue && node.nodeValue.trim() === oldTitle) {
          node.nodeValue = node.nodeValue.replace(oldTitle, newTitle);
        }
      }
    } catch (_) { /* cosmetic only — the DB write is what matters */ }
  }

  /* ---------------------------------------------------------------------------
   * 6. Diagnostics
   * ------------------------------------------------------------------------ */

  async function inspect() {
    const out = { version: VERSION, databases: [], schema: null, sampleChat: null };

    if (indexedDB.databases) {
      try {
        const list = await indexedDB.databases();
        for (const { name } of list) {
          if (!name) continue;
          try {
            const db = await idbOpen(name);
            out.databases.push({ name, stores: Array.from(db.objectStoreNames) });
            db.close();
          } catch (_) { out.databases.push({ name, stores: '(could not open)' }); }
        }
      } catch (e) { out.databases = '(indexedDB.databases() failed: ' + e.message + ')'; }
    }

    const schema = await detectSchema();
    out.schema = schema;

    if (schema) {
      const db = await idbOpen(schema.dbName);
      const sample = await idbGet(db, schema.storeName, schema.sampleKey);
      db.close();
      if (sample) {
        out.sampleChat = {
          key: String(schema.sampleKey),
          topLevelFields: Object.keys(sample),
          titleValue: sample[schema.titleField],
          messageCount: (sample[schema.messagesField] || []).length,
          firstMessageShape: sample[schema.messagesField] && sample[schema.messagesField][0]
            ? Object.keys(sample[schema.messagesField][0])
            : null,
        };
      }
    }

    console.log('%c[YT-Titler] inspect()', 'color:#4ea1ff;font-weight:bold', out);
    return out;
  }

  /* ---------------------------------------------------------------------------
   * 7. Boot
   * ------------------------------------------------------------------------ */

  window.__ytTitler = {
    version: VERSION,
    config: CONFIG,
    run: () => pass({ dry: false }),
    dryRun: () => pass({ dry: true }),
    inspect,
    clearCache: () => { titleCache.clear(); attempts.clear(); schemaCache = null; log('Caches cleared.'); },
  };

  setTimeout(() => {
    log(`v${VERSION} loaded. Try __ytTitler.dryRun() first.`);
    pass({ dry: false });
    setInterval(() => pass({ dry: false }), CONFIG.pollMs);
  }, CONFIG.startupDelayMs);
})();
