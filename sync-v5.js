/*!
 * TypingMind Drive Sync
 * v1.3.3
 *
 * A focused Google Drive sync for TypingMind. Designed to run safely alongside
 * TypingMind's own Cloud Sync and alongside other extensions.
 *
 * Design notes
 * ------------
 * 1. Content-addressed storage. Every item is stored in Drive as `blob_<hash>`
 *    where <hash> is a SHA-256 of the item's plaintext. Unchanged items are
 *    never re-uploaded, identical items across keys are stored once, and a
 *    snapshot is just a copy of the manifest (instant, no data duplication).
 *
 * 2. Flat folder + one index call. The whole sync folder is listed once per
 *    cycle to build a name -> fileId map. Every read/write after that is a
 *    single API call. No per-file path resolution.
 *
 * 3. Deletions require a quorum. An item must be absent from the local
 *    database across two separate scans, at least 90s apart, on a scan that
 *    passed a consistency check, before a tombstone is created. A ratio guard
 *    aborts the whole thing if a large share of items vanish at once. This is
 *    what makes it safe to leave TypingMind's native sync switched on.
 *
 * 4. Real key derivation. PBKDF2-SHA256 (310k iterations) over a random salt,
 *    AES-256-GCM payloads, deflate-raw compression. A verifier blob detects a
 *    wrong passphrase before anything is written.
 *
 * 5. Plays nice with other extensions. Injects no global styles, uses its own
 *    element id (workspace-tab-drivesync), and never rewrites another
 *    extension's DOM.
 *
 * What changed in 1.2.0 (the half-written-reply bug)
 * --------------------------------------------------
 * a. Change detection now measures the item's real content. The old quick
 *    check looked at updatedAt, the message count and the last message's id.
 *    None of those move while a reply is streaming in, so a chat captured
 *    half-written stayed "unchanged" forever and the finished answer never
 *    reached the other devices.
 *
 * b. Items still being written are held back. Anything whose content moves
 *    during a short settle window is skipped and retried a few seconds later,
 *    so a half-finished reply is never published in the first place.
 *
 * c. Pull and push are decided by one function, so an item can never be pulled
 *    and pushed in the same cycle. When both sides carry the same timestamp,
 *    the larger payload wins, which is always the complete version rather than
 *    the truncated one.
 *
 * d. The manifest is rebuilt from what this device actually holds after the
 *    pulls, not from the pre-pull scan. The old code republished its own stale
 *    copy of anything it had just pulled, which is what dragged the truncated
 *    version back onto the device that had the good one.
 *
 * f. Long-lived Google access. Google's browser token flow only ever grants
 *    an hour at a time and its own docs say a new token "must be obtained by
 *    calling requestAccessToken() from a user-driven event", which is why it
 *    kept asking you to sign in. Add your OAuth client secret and the
 *    extension switches to the authorization-code flow, keeps a refresh token
 *    on the device, and renews its own access silently and indefinitely. Leave
 *    the secret empty and nothing changes.
 *
 * e. A refresh reminder when new data lands. TypingMind only reads your chats
 *    into memory at page load, so a refresh is still needed to see what
 *    arrived from another device. Nothing here ever refreshes the page on its
 *    own: a small pill appears at the bottom so you know a refresh is worth
 *    it, and you tap it when you are ready. Switch the reminder off in
 *    Behaviour if you would rather not see it at all.
 *
 * Setup: paste this URL into TypingMind > Settings > Extensions, then open the
 * "Sync" tab in the sidebar and fill in a Google Client ID and a passphrase.
 */

(function () {
  "use strict";

  if (window.__tmDriveSync) {
    console.warn("[TMDS] Already loaded; ignoring duplicate injection.");
    return;
  }
  window.__tmDriveSync = true;

  /**
   * This same page is used as the OAuth redirect target, so a copy of the app
   * loads inside the sign-in popup for a moment. When that happens, hand the
   * authorization code back to the window that opened us and close, before
   * anything else in this file runs.
   */
  try {
    const q = new URLSearchParams(window.location.search);
    const st = q.get("state") || "";
    if (window.opener && st.indexOf("tmds-oauth-") === 0) {
      window.opener.postMessage(
        {
          __tmdsOauth: true,
          state: st,
          code: q.get("code") || "",
          error: q.get("error") || "",
        },
        window.location.origin
      );
      window.close();
      return;
    }
  } catch {
    /* not a popup, or no access to the opener: carry on as normal */
  }

  /* ===================================================================== */
  /* Constants                                                              */
  /* ===================================================================== */

  const VERSION = "1.3.3";
  const TAG = "[TMDS]";

  const DB_NAME = "keyval-store";
  const DB_STORE = "keyval";

  const FOLDER_NAME = "TypingMind Drive Sync";
  const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
  const GIS_SRC = "https://accounts.google.com/gsi/client";

  const API = "https://www.googleapis.com/drive/v3";
  const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
  const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
  const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
  const OAUTH_STATE_PREFIX = "tmds-oauth-";

  const MANIFEST = "manifest.json";
  const KEYINFO = "keyinfo.json";
  const BLOB_PREFIX = "blob_";
  const SNAP_PREFIX = "snap_";

  const PBKDF2_ITERATIONS = 310000;
  const VERIFIER_TEXT = "tmds-verifier-v1";

  // Bumped whenever the change-detection fingerprint format changes. A mismatch
  // forces one full re-check so stale hashes recorded by an older build cannot
  // survive the upgrade.
  const SIGNATURE_SCHEME = 2;

  // Local storage keys. All of these are excluded from sync.
  const K = {
    clientId: "tmds_client_id",
    clientSecret: "tmds_client_secret",
    refresh: "tmds_refresh",
    redirectUri: "tmds_redirect_uri",
    passphrase: "tmds_passphrase",
    interval: "tmds_interval",
    enabled: "tmds_enabled",
    exclusions: "tmds_exclusions",
    token: "tmds_token",
    state: "tmds_state",
    folderId: "tmds_folder_id",
    debug: "tmds_debug",
    autoSnapshot: "tmds_auto_snapshot",
    refreshNotice: "tmds_refresh_notice",
  };

  // Deletion safety.
  const DELETE_MIN_AGE_MS = 90 * 1000; // must be missing this long
  const DELETE_MIN_SIGHTINGS = 2; // across at least this many scans
  const DELETE_RATIO_LIMIT = 0.5; // more than half missing at once is suspect
  const DELETE_ABSOLUTE_FLOOR = 5; // ...once at least this many are missing
  const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

  const GC_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
  const GC_GRACE_MS = 24 * 60 * 60 * 1000; // don't reap very new blobs
  const DEEP_SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000;
  const AUTO_SNAPSHOT_INTERVAL_MS = 24 * 60 * 60 * 1000;
  const AUTO_SNAPSHOT_KEEP = 7;

  // Access-token upkeep. Renewing well before expiry means a sync never has to
  // stop and ask for anything.
  const TOKEN_EARLY_RENEW_MS = 5 * 60 * 1000;
  const TOKEN_WATCH_MS = 60 * 1000;
  const AUTH_RETRY_MS = 5 * 60 * 1000;
  const SIGNIN_TIMEOUT_MS = 3 * 60 * 1000;

  const IDB_PAGE_SIZE = 100;
  const UPLOAD_CONCURRENCY = 4;
  const DOWNLOAD_CONCURRENCY = 6;

  // Publishing safety. Nothing that is still being written gets uploaded.
  const SETTLE_DELAY_MS = 1200; // pause before re-reading a changed item
  const SETTLE_MAX_SKIPS = 8; // never stall an item forever
  const FAST_FOLLOWUP_MS = 8000; // re-check soon after something was held back
  const MAX_FAST_FOLLOWUPS = 24;

  /* ===================================================================== */
  /* Small utilities                                                        */
  /* ===================================================================== */

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const nowMs = () => Date.now();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const log = {
    _on: localStorage.getItem(K.debug) === "true",
    set enabled(v) {
      this._on = !!v;
      localStorage.setItem(K.debug, v ? "true" : "false");
    },
    get enabled() {
      return this._on;
    },
    info(...a) {
      if (this._on) console.log(TAG, ...a);
    },
    warn(...a) {
      console.warn(TAG, ...a);
    },
    error(...a) {
      console.error(TAG, ...a);
    },
  };

  function readCfg(key, fallback) {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  }

  function writeCfg(key, value) {
    if (value === null || value === undefined || value === "") {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, String(value));
    }
  }

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      log.error("Could not save local state:", e.message);
      return false;
    }
  }

  function bytesToB64(bytes) {
    let s = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(s);
  }

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function toHex(buf) {
    const b = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
    return s;
  }

  /** SHA-256, truncated to 128 bits. Plenty for content addressing. */
  async function hashBytes(bytes) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return toHex(digest).slice(0, 32);
  }

  function formatBytes(n) {
    if (!n) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
    return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
  }

  function formatWhen(ts) {
    if (!ts) return "never";
    const d = new Date(ts);
    const diff = nowMs() - ts;
    if (diff < 60000) return "just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} h ago`;
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) +
      " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }

  /** Bounded-concurrency map. Never rejects; returns settled results. */
  async function pool(items, limit, fn) {
    const results = new Array(items.length);
    let cursor = 0;
    const width = Math.max(1, Math.min(limit, items.length));
    await Promise.all(
      Array.from({ length: width }, async () => {
        while (cursor < items.length) {
          const i = cursor++;
          try {
            results[i] = { ok: true, value: await fn(items[i], i) };
          } catch (e) {
            results[i] = { ok: false, error: e };
          }
        }
      })
    );
    return results;
  }

  async function retry(fn, { attempts = 4, base = 800, retryable = () => true } = {}) {
    let last;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (e) {
        last = e;
        if (i === attempts - 1 || !retryable(e)) throw e;
        const wait = Math.min(base * Math.pow(2, i) + Math.random() * 400, 20000);
        log.info(`Retry ${i + 1}/${attempts - 1} in ${Math.round(wait)}ms:`, e.message);
        await sleep(wait);
      }
    }
    throw last;
  }

  /* ===================================================================== */
  /* Fast content fingerprint                                               */
  /* ===================================================================== */

  /**
   * Two-lane FNV-1a. Not cryptographic and never stored in Drive: its only job
   * is to answer "did this item's content change since the last scan?" without
   * paying for JSON.stringify plus SHA-256 on every item, every cycle. Two
   * independent lanes make an accidental collision (which would mean a missed
   * edit) about as likely as a hardware fault.
   */
  function fnvNew() {
    return { a: 0x811c9dc5, b: 0x9e3779b1 };
  }

  function fnvStr(st, s) {
    let a = st.a;
    let b = st.b;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      a = Math.imul(a ^ c, 16777619) >>> 0;
      b = Math.imul(b ^ c, 2246822519) >>> 0;
    }
    st.a = a;
    st.b = b;
  }

  function fnvOut(st) {
    return st.a.toString(36) + "." + st.b.toString(36);
  }

  /**
   * Walks a JSON-ish value into a fingerprint, touching every character of
   * every string. That is the whole point: a reply that grew by one character
   * changes the fingerprint, which is exactly the case the previous quick
   * check was blind to.
   *
   * Returns null for anything it cannot fully account for (binary values,
   * cycles, absurd nesting). null means "no shortcut available", so the caller
   * hashes the item properly. Correctness beats speed here.
   */
  function fingerprint(value) {
    const st = fnvNew();
    const seen = new Set();
    let ok = true;

    const walk = (v, depth) => {
      if (!ok) return;
      if (depth > 14) {
        ok = false;
        return;
      }
      if (v === null) {
        fnvStr(st, "\u0000n");
        return;
      }
      const t = typeof v;
      if (t === "string") {
        fnvStr(st, "s");
        fnvStr(st, v);
        fnvStr(st, "\u0000");
        return;
      }
      if (t === "number" || t === "boolean" || t === "bigint") {
        fnvStr(st, "p" + v + "\u0000");
        return;
      }
      if (t === "undefined") {
        fnvStr(st, "\u0000u");
        return;
      }
      if (t === "function" || t === "symbol") {
        ok = false;
        return;
      }
      if (v instanceof Date) {
        fnvStr(st, "d" + v.getTime());
        return;
      }
      if (v instanceof Blob || v instanceof ArrayBuffer || ArrayBuffer.isView(v)) {
        ok = false;
        return;
      }
      if (seen.has(v)) {
        ok = false; // a cycle: let the real hash deal with it
        return;
      }
      seen.add(v);
      if (Array.isArray(v)) {
        fnvStr(st, "[" + v.length + "\u0000");
        for (let i = 0; i < v.length; i++) walk(v[i], depth + 1);
        fnvStr(st, "]");
      } else {
        const keys = Object.keys(v).sort();
        fnvStr(st, "{" + keys.length + "\u0000");
        for (let i = 0; i < keys.length; i++) {
          fnvStr(st, keys[i]);
          fnvStr(st, ":");
          walk(v[keys[i]], depth + 1);
        }
        fnvStr(st, "}");
      }
      seen.delete(v);
    };

    walk(value, 0);
    return ok ? fnvOut(st) : null;
  }

  /* ===================================================================== */
  /* Exclusions                                                             */
  /* ===================================================================== */

  /**
   * Keys that must never leave this device. The TM_* / INSTANCE_* patterns are
   * TypingMind's native cloud-sync bookkeeping and per-device identity. Copying
   * those between devices corrupts native sync state, so they stay local
   * whether native sync is on or off.
   */
  const HARD_EXCLUDE = [
    /^tmds_/,
    /^tcs_/, // the other cloud-sync extension, if also installed
    /^gsi_/,
    /eruda/i,
    /^INSTANCE_/i,
    /^TM_useLastVerifiedToken$/,
    /^TM_useStateUpdateHistory$/,
    /^TM_.*sync/i,
    /^referrer$/,
    /^__tmds/,
  ];

  const Exclusions = {
    _user: [],
    reload() {
      const raw = readCfg(K.exclusions, "");
      this._user = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    },
    test(key) {
      if (typeof key !== "string" || !key) return true;
      for (const re of HARD_EXCLUDE) if (re.test(key)) return true;
      for (const u of this._user) if (key === u) return true;
      return false;
    },
  };
  Exclusions.reload();

  /* ===================================================================== */
  /* Local database access (IndexedDB + localStorage)                       */
  /* ===================================================================== */

  const Local = {
    _db: null,

    async db() {
      if (this._db) return this._db;
      this._db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(new Error("Could not open TypingMind's database."));
        req.onblocked = () => reject(new Error("Database open blocked by another tab."));
      });
      return this._db;
    },

    async hasStore() {
      const db = await this.db();
      return db.objectStoreNames.contains(DB_STORE);
    },

    /**
     * Page through the keyval store. Each page is handed to `onPage` and the
     * transaction is closed between pages, so memory stays bounded and we never
     * hold a long-lived transaction open while TypingMind is writing.
     */
    async iterate(onPage, pageSize = IDB_PAGE_SIZE) {
      if (!(await this.hasStore())) return;
      const db = await this.db();
      let after;
      for (;;) {
        const page = await new Promise((resolve, reject) => {
          const tx = db.transaction([DB_STORE], "readonly");
          const store = tx.objectStore(DB_STORE);
          const range = after === undefined ? undefined : IDBKeyRange.lowerBound(after, true);
          const out = [];
          const req = store.openCursor(range);
          req.onsuccess = (ev) => {
            const cur = ev.target.result;
            if (!cur || out.length >= pageSize) return resolve(out);
            if (typeof cur.key === "string") {
              out.push({ key: cur.key, value: cur.value });
            }
            cur.continue();
          };
          req.onerror = () => reject(new Error("Failed reading the local database."));
        });
        if (!page.length) return;
        after = page[page.length - 1].key;
        await onPage(page);
        if (page.length < pageSize) return;
      }
    },

    /** Full set of syncable keys across both stores. Throws on partial reads. */
    async keys() {
      const set = new Set();
      if (await this.hasStore()) {
        const db = await this.db();
        await new Promise((resolve, reject) => {
          const tx = db.transaction([DB_STORE], "readonly");
          const req = tx.objectStore(DB_STORE).openKeyCursor();
          req.onsuccess = (ev) => {
            const cur = ev.target.result;
            if (!cur) return resolve();
            if (typeof cur.key === "string" && !Exclusions.test(cur.key)) set.add(cur.key);
            cur.continue();
          };
          // A silent partial read here would look exactly like a mass deletion.
          req.onerror = () =>
            reject(new Error("Incomplete database read; aborting to avoid false deletions."));
        });
      }
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && !Exclusions.test(key)) set.add(key);
      }
      return set;
    },

    async getIdb(key) {
      if (!(await this.hasStore())) return undefined;
      const db = await this.db();
      return new Promise((resolve) => {
        const tx = db.transaction([DB_STORE], "readonly");
        const req = tx.objectStore(DB_STORE).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(undefined);
      });
    },

    async putIdb(key, value) {
      if (!(await this.hasStore())) {
        // Happens on a fresh profile where TypingMind hasn't set up its
        // database yet. Creating the store ourselves risks clashing with
        // TypingMind's own schema, so ask for a reload instead.
        throw new Error(
          "TypingMind's database isn't ready yet. Open a chat or reload the page, then sync again."
        );
      }
      const db = await this.db();
      return new Promise((resolve, reject) => {
        const tx = db.transaction([DB_STORE], "readwrite");
        const req = tx.objectStore(DB_STORE).put(value, key);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(new Error(`Failed writing "${key}".`));
      });
    },

    async delIdb(key) {
      if (!(await this.hasStore())) return;
      const db = await this.db();
      return new Promise((resolve) => {
        const tx = db.transaction([DB_STORE], "readwrite");
        const req = tx.objectStore(DB_STORE).delete(key);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      });
    },
  };

  /* ===================================================================== */
  /* Crypto                                                                 */
  /* ===================================================================== */

  const Crypto = {
    _key: null,
    _keyFor: null, // `${passphrase}|${salt}` the cached key belongs to

    async derive(passphrase, saltB64, iterations) {
      const fingerprintKey = `${passphrase}|${saltB64}|${iterations}`;
      if (this._key && this._keyFor === fingerprintKey) return this._key;
      const base = await crypto.subtle.importKey(
        "raw",
        enc.encode(passphrase),
        "PBKDF2",
        false,
        ["deriveKey"]
      );
      const key = await crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: b64ToBytes(saltB64), iterations, hash: "SHA-256" },
        base,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
      );
      this._key = key;
      this._keyFor = fingerprintKey;
      return key;
    },

    forget() {
      this._key = null;
      this._keyFor = null;
    },

    async _deflate(bytes) {
      if (typeof CompressionStream === "undefined") return null;
      try {
        const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
        return new Uint8Array(await new Response(stream).arrayBuffer());
      } catch {
        return null;
      }
    },

    async _inflate(bytes) {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    },

    /** Layout: [0]=format version, [1]=flags, [2..13]=IV, [14..]=ciphertext */
    async seal(key, plainBytes) {
      let payload = plainBytes;
      let flags = 0;
      const squeezed = await this._deflate(plainBytes);
      if (squeezed && squeezed.length < plainBytes.length) {
        payload = squeezed;
        flags |= 1;
      }
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(
        await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, payload)
      );
      const out = new Uint8Array(14 + ct.length);
      out[0] = 1;
      out[1] = flags;
      out.set(iv, 2);
      out.set(ct, 14);
      return out;
    },

    async open(key, sealed) {
      if (!sealed || sealed.length < 15 || sealed[0] !== 1) {
        throw new Error("Unrecognised file format in Drive.");
      }
      const flags = sealed[1];
      const iv = sealed.subarray(2, 14);
      const ct = sealed.subarray(14);
      let plain;
      try {
        plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct));
      } catch {
        throw new Error("Decryption failed. The passphrase does not match this folder.");
      }
      return flags & 1 ? this._inflate(plain) : plain;
    },
  };

  /* ===================================================================== */
  /* Google Drive client                                                    */
  /* ===================================================================== */

  const Drive = {
    tokenClient: null,
    token: null, // { access_token, expires_at }
    folderId: null,
    index: new Map(), // name -> { id, size, createdTime }
    authNeeded: false,

    /* --- script + token client ------------------------------------------ */

    async loadGis() {
      if (window.google?.accounts?.oauth2) return;
      if (!document.getElementById("tmds-gis")) {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.id = "tmds-gis";
          s.src = GIS_SRC;
          s.async = true;
          s.defer = true;
          s.onload = resolve;
          s.onerror = () => reject(new Error("Could not load Google sign-in."));
          document.head.appendChild(s);
        });
      }
      for (let i = 0; i < 100 && !window.google?.accounts?.oauth2; i++) await sleep(50);
      if (!window.google?.accounts?.oauth2) throw new Error("Google sign-in did not initialise.");
    },

    async initClient() {
      const clientId = readCfg(K.clientId, "").trim();
      if (!clientId) throw new Error("Add a Google Client ID first.");
      await this.loadGis();
      if (this.tokenClient && this.tokenClient.__clientId === clientId) return;
      this.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: DRIVE_SCOPE,
        callback: () => {},
      });
      this.tokenClient.__clientId = clientId;
    },

    loadStoredToken() {
      const t = readJson(K.token, null);
      if (t && t.access_token && t.expires_at > nowMs() + 120000) {
        this.token = t;
        return true;
      }
      return false;
    },

    storeToken(resp) {
      const lifetime = (Number(resp.expires_in) || 3600) * 1000;
      this.token = { access_token: resp.access_token, expires_at: nowMs() + lifetime };
      writeJson(K.token, this.token);
      // Google only returns a refresh token on the consent that created it.
      // Never overwrite a good one with nothing.
      if (resp.refresh_token) writeCfg(K.refresh, resp.refresh_token);
      this.authNeeded = false;
    },

    signedIn() {
      return !!(this.token && this.token.expires_at > nowMs() + 60000);
    },

    /* --- which of the two flows are we on? ------------------------------- */

    /**
     * Google's browser token flow hands out one hour at a time and, in their
     * own words, a replacement "must be obtained by calling
     * requestAccessToken() from a user-driven event". There is no silent
     * renewal and no refresh token, which is why it kept asking you to sign in
     * whenever the tab had been idle or closed for a while.
     *
     * With a client secret filled in we use the authorization-code flow
     * instead: one consent, one refresh token kept on this device, and access
     * renewed quietly forever after. Without one, everything behaves exactly
     * as it did before.
     */
    offlineMode() {
      return !!readCfg(K.clientSecret, "").trim();
    },

    refreshToken() {
      return readCfg(K.refresh, "").trim();
    },

    /**
     * The address Google sends the browser back to. It has to match a line in
     * Authorised redirect URIs character for character, which is stricter than
     * it looks: version 1.3.0 built this as origin + pathname, producing
     * "https://host/" with a trailing slash, while the Cloud Console stores
     * "https://host" exactly as typed. That one character is a
     * redirect_uri_mismatch. Drop a lone trailing slash so the default matches
     * what the console shows for a bare domain, and let it be overridden for
     * anything unusual.
     */
    defaultRedirectUri() {
      const path = window.location.pathname || "/";
      return window.location.origin + (path === "/" ? "" : path);
    },

    redirectUri() {
      return readCfg(K.redirectUri, "").trim() || this.defaultRedirectUri();
    },

    /* --- token endpoint --------------------------------------------------- */

    async exchange(fields) {
      let res;
      try {
        res = await fetch(TOKEN_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(fields).toString(),
        });
      } catch (e) {
        const err = new Error(
          "The browser blocked the call to Google's token service. Clear the client secret to go back to sign-in popups."
        );
        err.__blocked = true;
        throw err;
      }
      const text = await res.text();
      let data = {};
      try {
        data = JSON.parse(text);
      } catch {
        /* fall through to the error below */
      }
      if (!res.ok) {
        const why = data.error_description || data.error || text.slice(0, 160);
        const err = new Error(`Google refused the request: ${why}`);
        err.__oauth = data.error || "";
        throw err;
      }
      return data;
    },

    /**
     * Swap the saved refresh token for a fresh access token. No popup, no user
     * gesture, no dependence on a live Google session in the browser, so it
     * works after the tab has been closed for days.
     */
    async renewFromRefresh() {
      if (this._renewing) return this._renewing;
      const token = this.refreshToken();
      if (!token) throw new Error("No saved Google permission yet.");
      const clientId = readCfg(K.clientId, "").trim();
      const secret = readCfg(K.clientSecret, "").trim();

      this._renewing = (async () => {
        try {
          const data = await this.exchange({
            client_id: clientId,
            client_secret: secret,
            refresh_token: token,
            grant_type: "refresh_token",
          });
          this.storeToken(data);
          log.info("Renewed Google access without a prompt.");
        } catch (e) {
          // invalid_grant means the permission itself is gone: revoked by hand,
          // password changed, or the consent screen is still in Testing mode
          // (those refresh tokens expire after seven days). Nothing but a new
          // sign-in fixes that, so stop trying with a token that can't work.
          if (e.__oauth === "invalid_grant") {
            writeCfg(K.refresh, "");
            this.authNeeded = true;
            throw new Error(
              "Google revoked the saved permission. Open Sync and press Sign in to Google once. " +
                "If this keeps happening, publish your OAuth consent screen: while it is in Testing, Google expires the permission every 7 days."
            );
          }
          throw e;
        } finally {
          this._renewing = null;
        }
      })();
      return this._renewing;
    },

    /**
     * The one interactive step, and it only ever happens once per device.
     * Builds the consent URL by hand because access_type=offline and
     * prompt=consent are what guarantee a refresh token comes back, and the
     * Google library does not expose either.
     */
    async connectOffline() {
      const clientId = readCfg(K.clientId, "").trim();
      const secret = readCfg(K.clientSecret, "").trim();
      if (!clientId) throw new Error("Add a Google Client ID first.");
      if (!secret) throw new Error("Add a client secret first.");

      const redirect = this.redirectUri();
      const state = OAUTH_STATE_PREFIX + Math.random().toString(36).slice(2, 12);
      const url =
        `${AUTH_ENDPOINT}?client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(redirect)}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent(DRIVE_SCOPE)}` +
        `&access_type=offline&prompt=consent&include_granted_scopes=true` +
        `&state=${encodeURIComponent(state)}`;

      const popup = window.open(url, "tmds-google-signin", "width=520,height=640");
      if (!popup) {
        throw new Error("Your browser blocked the sign-in window. Allow pop-ups for this site and try again.");
      }

      const code = await new Promise((resolve, reject) => {
        let done = false;
        const finish = (fn, arg) => {
          if (done) return;
          done = true;
          clearInterval(poll);
          clearTimeout(bail);
          window.removeEventListener("message", onMessage);
          try {
            popup.close();
          } catch {
            /* already gone */
          }
          fn(arg);
        };

        // The popup posts the code to us as soon as this same script boots
        // inside it. Fast path.
        const onMessage = (ev) => {
          if (ev.origin !== window.location.origin) return;
          const d = ev.data;
          if (!d || !d.__tmdsOauth || d.state !== state) return;
          if (d.error) return finish(reject, new Error(`Google returned: ${d.error}`));
          finish(resolve, d.code);
        };
        window.addEventListener("message", onMessage);

        // Fallback: read it straight off the popup's address bar once Google
        // has sent it back to our own origin.
        const poll = setInterval(() => {
          if (popup.closed) {
            return finish(
              reject,
              new Error(
                "The sign-in window closed before Google sent anything back. If it showed " +
                  `"Error 400: redirect_uri_mismatch", add this exact line to Authorised ` +
                  `redirect URIs on the OAuth client you are using: ${redirect}`
              )
            );
          }
          let href = "";
          try {
            href = popup.location.href || "";
          } catch {
            return; // still on accounts.google.com, which we cannot read
          }
          if (href.indexOf(redirect) !== 0) return;
          const q = new URLSearchParams(popup.location.search);
          if (q.get("state") !== state) return;
          if (q.get("error")) return finish(reject, new Error(`Google returned: ${q.get("error")}`));
          if (q.get("code")) finish(resolve, q.get("code"));
        }, 250);

        const bail = setTimeout(
          () =>
            finish(
              reject,
              new Error(
                "Sign-in timed out. If Google showed an error instead of a consent screen, the " +
                  `most likely cause is that this exact line is missing from Authorised redirect ` +
                  `URIs: ${redirect}`
              )
            ),
          SIGNIN_TIMEOUT_MS
        );
      });

      const data = await this.exchange({
        client_id: clientId,
        client_secret: secret,
        code,
        redirect_uri: redirect,
        grant_type: "authorization_code",
      });

      if (!data.refresh_token && !this.refreshToken()) {
        throw new Error(
          "Google did not return a long-lived permission. Remove this app at myaccount.google.com/permissions, then sign in again."
        );
      }
      this.storeToken(data);
      log.info("Connected with a long-lived permission.");
    },

    /* --- the old popup token flow, unchanged ----------------------------- */

    async authViaPopup(interactive) {
      await this.initClient();
      const resp = await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (fn, arg) => {
          if (settled) return;
          settled = true;
          fn(arg);
        };
        this.tokenClient.callback = (r) => {
          if (r.error) return finish(reject, new Error(r.error_description || r.error));
          finish(resolve, r);
        };
        this.tokenClient.error_callback = (e) =>
          finish(reject, new Error(e?.message || "Sign-in was cancelled."));
        if (!interactive) {
          setTimeout(() => finish(reject, new Error("Silent sign-in timed out.")), 20000);
        }
        try {
          this.tokenClient.requestAccessToken({ prompt: interactive ? "consent" : "" });
        } catch (e) {
          finish(reject, e);
        }
      }).catch((e) => {
        if (!interactive) this.authNeeded = true;
        throw e;
      });
      this.storeToken(resp);
    },

    async auth({ interactive = false } = {}) {
      if (this.signedIn()) return;
      if (!this.token && this.loadStoredToken()) return;

      if (this.offlineMode()) {
        if (this.refreshToken()) {
          await this.renewFromRefresh();
          return;
        }
        if (!interactive) {
          this.authNeeded = true;
          throw new Error("Google Drive is not connected yet. Open Sync and press Sign in to Google.");
        }
        await this.connectOffline();
        return;
      }

      await this.authViaPopup(interactive);
    },

    /** Called on a timer so a sync never has to stop and wait for a token. */
    async keepFresh() {
      if (!this.offlineMode() || !this.refreshToken()) return;
      if (!this.token) this.loadStoredToken();
      if (this.token && this.token.expires_at - nowMs() > TOKEN_EARLY_RENEW_MS) return;
      try {
        await this.renewFromRefresh();
      } catch (e) {
        log.warn("Background token renewal failed:", e.message);
      }
    },

    invalidateToken() {
      this.token = null;
      localStorage.removeItem(K.token);
      // With a refresh token on hand this recovers by itself, so don't park
      // the whole extension waiting for a click.
      if (!(this.offlineMode() && this.refreshToken())) this.authNeeded = true;
    },

    /* --- request plumbing ----------------------------------------------- */

    async request(url, init = {}, { raw = false, retryAuth = true } = {}) {
      return retry(
        async () => {
          if (!this.signedIn()) await this.auth({ interactive: false });
          else if (
            this.offlineMode() &&
            this.refreshToken() &&
            this.token.expires_at - nowMs() < TOKEN_EARLY_RENEW_MS
          ) {
            // Renew before it lapses rather than after a 401, so a long sync
            // can't die halfway through.
            await this.renewFromRefresh().catch((e) => log.warn("Early renewal failed:", e.message));
          }
          const headers = Object.assign({}, init.headers, {
            Authorization: `Bearer ${this.token.access_token}`,
          });
          const res = await fetch(url, Object.assign({}, init, { headers }));

          if (res.status === 401) {
            this.invalidateToken();
            if (retryAuth) {
              await this.auth({ interactive: false });
              const err = new Error("Access token expired.");
              err.__retry = true;
              throw err;
            }
            throw new Error("Google sign-in expired. Open Sync and sign in again.");
          }
          if (res.status === 403 || res.status === 429) {
            const body = await res.text();
            const err = new Error(`Google rate limit: ${body.slice(0, 160)}`);
            err.__retry = /rate|quota|userRateLimitExceeded/i.test(body) || res.status === 429;
            if (!err.__retry) err.message = `Drive refused the request: ${body.slice(0, 200)}`;
            throw err;
          }
          if (res.status >= 500) {
            const err = new Error(`Drive is unavailable (${res.status}).`);
            err.__retry = true;
            throw err;
          }
          if (res.status === 404) {
            const err = new Error("Not found in Drive.");
            err.__notFound = true;
            throw err;
          }
          if (!res.ok) {
            throw new Error(`Drive error ${res.status}: ${(await res.text()).slice(0, 200)}`);
          }
          if (raw) return new Uint8Array(await res.arrayBuffer());
          if (res.status === 204) return null;
          const text = await res.text();
          return text ? JSON.parse(text) : null;
        },
        { retryable: (e) => !!e.__retry }
      );
    },

    /* --- folder + index -------------------------------------------------- */

    async ensureFolder() {
      const stored = readCfg(K.folderId, "");
      if (stored) {
        try {
          const meta = await this.request(
            `${API}/files/${stored}?fields=id,trashed`,
            {},
            { retryAuth: false }
          );
          if (meta && !meta.trashed) {
            this.folderId = meta.id;
            return this.folderId;
          }
        } catch (e) {
          if (!e.__notFound) throw e;
        }
      }

      const q = encodeURIComponent(
        `mimeType='application/vnd.google-apps.folder' and name='${FOLDER_NAME}' and trashed=false`
      );
      const found = await this.request(`${API}/files?q=${q}&fields=files(id)&spaces=drive`);
      if (found?.files?.length) {
        this.folderId = found.files[0].id;
      } else {
        const created = await this.request(`${API}/files?fields=id`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: FOLDER_NAME,
            mimeType: "application/vnd.google-apps.folder",
          }),
        });
        this.folderId = created.id;
        log.info("Created Drive folder", this.folderId);
      }
      writeCfg(K.folderId, this.folderId);
      return this.folderId;
    },

    /** One paginated list call gives us every filename -> id in the folder. */
    async buildIndex() {
      await this.ensureFolder();
      const map = new Map();
      let pageToken = null;
      do {
        const q = encodeURIComponent(`'${this.folderId}' in parents and trashed=false`);
        const url =
          `${API}/files?q=${q}&pageSize=1000&spaces=drive` +
          `&fields=nextPageToken,files(id,name,size,createdTime)` +
          (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
        const page = await this.request(url);
        for (const f of page.files || []) {
          map.set(f.name, { id: f.id, size: Number(f.size) || 0, createdTime: f.createdTime });
        }
        pageToken = page.nextPageToken || null;
      } while (pageToken);
      this.index = map;
      log.info(`Indexed ${map.size} files in Drive.`);
      return map;
    },

    has(name) {
      return this.index.has(name);
    },

    /* --- file operations -------------------------------------------------- */

    async put(name, bytes, mime = "application/octet-stream") {
      const existing = this.index.get(name);
      if (existing) {
        await this.request(`${UPLOAD}/files/${existing.id}?uploadType=media&fields=id`, {
          method: "PATCH",
          headers: { "Content-Type": mime },
          body: bytes,
        });
        this.index.set(name, { ...existing, size: bytes.length });
        return existing.id;
      }

      // multipart/related, hand-assembled: one round trip for create + content.
      const boundary = `tmds${Math.random().toString(36).slice(2)}${nowMs().toString(36)}`;
      const meta = { name, parents: [this.folderId] };
      const head = enc.encode(
        `--${boundary}\r\n` +
          `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
          `${JSON.stringify(meta)}\r\n` +
          `--${boundary}\r\n` +
          `Content-Type: ${mime}\r\n\r\n`
      );
      const tail = enc.encode(`\r\n--${boundary}--\r\n`);
      const body = new Blob([head, bytes, tail]);

      const created = await this.request(
        `${UPLOAD}/files?uploadType=multipart&fields=id,name,size,createdTime`,
        {
          method: "POST",
          headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
          body,
        }
      );
      this.index.set(name, {
        id: created.id,
        size: Number(created.size) || bytes.length,
        createdTime: created.createdTime,
      });
      return created.id;
    },

    async get(name) {
      const entry = this.index.get(name);
      if (!entry) {
        const err = new Error(`"${name}" is missing from Drive.`);
        err.__notFound = true;
        throw err;
      }
      return this.request(`${API}/files/${entry.id}?alt=media`, {}, { raw: true });
    },

    async remove(name) {
      const entry = this.index.get(name);
      if (!entry) return;
      try {
        await this.request(`${API}/files/${entry.id}`, { method: "DELETE" });
      } catch (e) {
        if (!e.__notFound) throw e;
      }
      this.index.delete(name);
    },
  };

  /* ===================================================================== */
  /* Local state                                                            */
  /* ===================================================================== */

  /**
   * items:      key -> { h, k, m, s, sig }   hash / kind / modified / size / fingerprint
   * deleted:    key -> { t }                 tombstone timestamp
   * pendingDel: key -> { first, seen }       deletion quorum tracking
   */
  function freshState() {
    return {
      v: 1,
      sigScheme: SIGNATURE_SCHEME,
      device: `d${Math.random().toString(36).slice(2, 10)}`,
      items: {},
      deleted: {},
      pendingDel: {},
      lastSync: 0,
      lastDeepScan: 0,
      lastGc: 0,
      lastSnapshot: 0,
      remoteUpdated: 0,
    };
  }

  // 1.3.2 briefly forced the refresh reminder off and left a marker behind.
  // Undo that once so the setting goes back to being yours to choose.
  if (readCfg("tmds_notice_default", "") === "off") {
    localStorage.removeItem("tmds_refresh_notice");
    localStorage.removeItem("tmds_notice_default");
  }

  let state = readJson(K.state, null) || freshState();
  if (!state.items) state = freshState();
  if (!state.pendingDel) state.pendingDel = {};
  if (!state.deleted) state.deleted = {};

  // Hashes recorded by an older build were produced by a change check that
  // could miss a growing reply, so they cannot be trusted. One forced full
  // re-check on first run repairs anything that was left half-written.
  let forceDeepOnce = state.sigScheme !== SIGNATURE_SCHEME;

  const saveState = () => writeJson(K.state, state);

  // Consecutive cycles an item was held back for still being written.
  const deferCounts = new Map();

  /* ===================================================================== */
  /* Item serialisation                                                     */
  /* ===================================================================== */

  /**
   * The change signal for an item.
   *
   * Version 1 of this extension compared updatedAt, the message count and the
   * last message's id. None of those move while a reply streams in, so a chat
   * captured half-written looked "unchanged" from then on and the finished
   * answer was never uploaded. This version fingerprints the actual content,
   * so one extra character is enough to trigger a re-hash.
   *
   * Blobs keep the size/type shortcut: TypingMind writes uploaded files once
   * and never edits them in place, and re-reading every attachment each cycle
   * would be pointlessly expensive.
   */
  function contentSignature(key, value, kind) {
    if (kind === "blob") return `b|${value.size}|${value.type}`;
    if (kind === "ls") {
      const st = fnvNew();
      fnvStr(st, value);
      return `l|${value.length}|${fnvOut(st)}`;
    }
    const fp = fingerprint(value);
    return fp === null ? null : `o|${fp}`;
  }

  function classify(key, value) {
    if (value instanceof Blob) return "blob";
    return "idb";
  }

  /** Item -> raw plaintext bytes, ready to hash and seal. */
  async function serialise(kind, value) {
    if (kind === "ls") return enc.encode(value);
    if (kind === "blob") return new Uint8Array(await value.arrayBuffer());
    return enc.encode(JSON.stringify(value));
  }

  /** Raw plaintext bytes -> value written back into the local database. */
  async function materialise(key, kind, bytes, meta) {
    if (kind === "ls") {
      localStorage.setItem(key, dec.decode(bytes));
      return;
    }
    if (kind === "blob") {
      const blob = new Blob([bytes], { type: meta?.mime || "application/octet-stream" });
      await Local.putIdb(key, blob);
      return;
    }
    await Local.putIdb(key, JSON.parse(dec.decode(bytes)));
  }

  function modifiedTime(key, value, kind) {
    if (kind === "idb" && value && typeof value === "object") {
      const raw = value.updatedAt ?? value.updated_at ?? value.lastUpdated ?? value.modifiedAt;
      if (typeof raw === "number") return raw;
      if (raw) {
        const t = new Date(raw).getTime();
        if (!Number.isNaN(t)) return t;
      }
    }
    return null;
  }

  /**
   * The single conflict rule, used by both the pull loop and the push loop so
   * they are exact complements. An item can never be pulled and pushed in the
   * same cycle, and every device reaches the same verdict.
   *
   * `base` is what this device recorded the last time it agreed with Drive
   * about this item: the common ancestor of the two copies. It settles almost
   * everything on its own. If Drive still holds exactly the copy we last saw,
   * then whatever is different here happened afterwards and is the newer edit,
   * even when it is smaller.
   *
   * That last part matters. Deleting two answers out of a four-model response
   * makes the chat smaller without necessarily moving its updatedAt, so the
   * timestamp check below tied and the size check handed the win to the bigger
   * stale copy in Drive. The deleted answers came straight back on the next
   * sync. The ancestor check stops that: only this device moved, so this
   * device wins.
   *
   * Only when both sides moved since that common ancestor is it a genuine
   * conflict. Then newest wins; on an exact timestamp tie the larger payload
   * wins, because a chat captured while a reply was still arriving is always
   * smaller than the finished one; and a size tie falls back to the hash so
   * both devices land on the same answer instead of trading pushes forever.
   */
  function preferRemote(mine, r, base) {
    if (base && base.h) {
      const localMoved = (mine.h || "") !== base.h;
      const remoteMoved = (r.h || "") !== base.h;
      if (localMoved && !remoteMoved) return false; // only this device edited it
      if (remoteMoved && !localMoved) return true; // only the other one did
    }
    const lm = mine.m || 0;
    const rm = r.m || 0;
    if (rm > lm) return true;
    if (lm > rm) return false;
    const ls = mine.s || 0;
    const rs = r.s || 0;
    if (rs !== ls) return rs > ls;
    return (r.h || "") > (mine.h || ""); // last resort, but deterministic
  }

  /* ===================================================================== */
  /* Scanning                                                               */
  /* ===================================================================== */

  /**
   * Walk everything once and produce the current local picture. `deep` forces
   * a full re-hash instead of trusting cached fingerprints.
   *
   * The consistency check compares the key set before and after the walk. If
   * something else (TypingMind's own sync, another tab) changed the database
   * mid-scan, we still sync content but refuse to reason about deletions.
   */
  async function scanLocal({ deep = false } = {}) {
    const before = await Local.keys();
    const items = new Map(); // key -> { h, k, m, s, sig, mime }
    const changed = []; // keys whose bytes we had to read

    const record = async (key, value, kind) => {
      const sig = contentSignature(key, value, kind);
      const known = state.items[key];

      if (!deep && sig !== null && known && known.sig === sig && known.h) {
        items.set(key, { h: known.h, k: kind, m: known.m, s: known.s, sig, mime: known.mime });
        return;
      }

      const bytes = await serialise(kind, value);
      const h = await hashBytes(bytes);
      const entry = {
        h,
        k: kind,
        m: modifiedTime(key, value, kind) ?? (known && known.h === h ? known.m : nowMs()),
        s: bytes.length,
        sig,
      };
      if (kind === "blob") entry.mime = value.type || "application/octet-stream";
      items.set(key, entry);
      if (!known || known.h !== h) changed.push(key);
    };

    await Local.iterate(async (page) => {
      for (const { key, value } of page) {
        if (Exclusions.test(key) || value === undefined) continue;
        await record(key, value, classify(key, value));
      }
    });

    const lsKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && !Exclusions.test(key)) lsKeys.push(key);
    }
    for (const key of lsKeys) {
      const value = localStorage.getItem(key);
      if (value === null) continue;
      await record(key, value, "ls");
    }

    const after = await Local.keys();
    let consistent = before.size === after.size;
    if (consistent) {
      for (const k of before) {
        if (!after.has(k)) {
          consistent = false;
          break;
        }
      }
    }
    if (!consistent) {
      log.warn("Database changed during the scan; deletions will be re-checked next cycle.");
    }

    return { items, changed, consistent, presentKeys: after };
  }

  /* ===================================================================== */
  /* Manifest                                                              */
  /* ===================================================================== */

  function manifestFromMap(itemsMap, deleted) {
    const items = {};
    for (const [key, v] of itemsMap) {
      items[key] = { h: v.h, k: v.k, m: v.m, s: v.s };
      if (v.mime) items[key].mime = v.mime;
    }
    return { v: 1, updated: nowMs(), device: state.device, items, deleted: deleted || {} };
  }

  function pruneTombstones(deleted) {
    const cutoff = nowMs() - TOMBSTONE_TTL_MS;
    let removed = 0;
    for (const key of Object.keys(deleted)) {
      if ((deleted[key]?.t || 0) < cutoff) {
        delete deleted[key];
        removed++;
      }
    }
    return removed;
  }

  /** Cheap comparison so an unchanged manifest is never rewritten. */
  function manifestDiffers(a, b) {
    const ak = Object.keys(a.items);
    const bk = Object.keys(b.items || {});
    if (ak.length !== bk.length) return true;
    for (const k of ak) {
      const x = a.items[k];
      const y = b.items[k];
      if (!y || y.h !== x.h || (y.m || 0) !== (x.m || 0)) return true;
    }
    const ad = Object.keys(a.deleted);
    const bd = Object.keys(b.deleted || {});
    if (ad.length !== bd.length) return true;
    for (const k of ad) if (!b.deleted || !b.deleted[k]) return true;
    return false;
  }

  /* ===================================================================== */
  /* The sync engine                                                        */
  /* ===================================================================== */

  const Engine = {
    running: false,
    status: "idle", // idle | syncing | ok | warn | error | auth
    message: "",
    listeners: new Set(),
    lastError: "",
    followUp: false, // something was held back; check again soon
    stats: { local: 0, remote: 0, pulled: 0, pushed: 0, removed: 0 },

    on(fn) {
      this.listeners.add(fn);
      return () => this.listeners.delete(fn);
    },

    emit(status, message) {
      if (status) this.status = status;
      this.message = message ?? this.message;
      for (const fn of this.listeners) {
        try {
          fn(this.status, this.message);
        } catch {
          /* a broken listener must not break sync */
        }
      }
    },

    configured() {
      return !!(readCfg(K.clientId, "").trim() && readCfg(K.passphrase, "").trim());
    },

    /** Names the missing piece, rather than just saying something is wrong. */
    describeMissing() {
      const id = readCfg(K.clientId, "").trim();
      const pass = readCfg(K.passphrase, "").trim();
      if (!id && !pass) return "Add a Google Client ID and a passphrase, then tap Save settings.";
      if (!id) return "Add a Google Client ID, then tap Save settings.";
      return "Add a passphrase, then tap Save settings.";
    },

    /** Sign in and refresh the folder index. Every public operation needs this. */
    async ready() {
      await Drive.auth({ interactive: false });
      await Drive.buildIndex();
    },

    /* --- key material ---------------------------------------------------- */

    async ensureKey() {
      const pass = readCfg(K.passphrase, "").trim();
      if (!pass) throw new Error("Set a passphrase before syncing.");

      let info = null;
      if (Drive.has(KEYINFO)) {
        const bytes = await Drive.get(KEYINFO);
        info = JSON.parse(dec.decode(bytes));
      }

      if (!info) {
        const salt = bytesToB64(crypto.getRandomValues(new Uint8Array(16)));
        const key = await Crypto.derive(pass, salt, PBKDF2_ITERATIONS);
        const verifier = bytesToB64(await Crypto.seal(key, enc.encode(VERIFIER_TEXT)));
        info = { v: 1, salt, iterations: PBKDF2_ITERATIONS, verifier };
        await Drive.put(KEYINFO, enc.encode(JSON.stringify(info)), "application/json");
        log.info("Initialised a new encrypted folder.");
        return key;
      }

      const key = await Crypto.derive(pass, info.salt, info.iterations || PBKDF2_ITERATIONS);
      const opened = await Crypto.open(key, b64ToBytes(info.verifier));
      if (dec.decode(opened) !== VERIFIER_TEXT) {
        throw new Error("The passphrase does not match this Drive folder.");
      }
      return key;
    },

    /* --- remote manifest -------------------------------------------------- */

    async readManifest(key) {
      if (!Drive.has(MANIFEST)) return { v: 1, updated: 0, items: {}, deleted: {} };
      try {
        const sealed = await Drive.get(MANIFEST);
        const plain = await Crypto.open(key, sealed);
        const m = JSON.parse(dec.decode(plain));
        m.items = m.items || {};
        m.deleted = m.deleted || {};
        return m;
      } catch (e) {
        if (e.__notFound) return { v: 1, updated: 0, items: {}, deleted: {} };
        throw e;
      }
    },

    async writeManifest(key, manifest) {
      const sealed = await Crypto.seal(key, enc.encode(JSON.stringify(manifest)));
      await Drive.put(MANIFEST, sealed);
      state.remoteUpdated = manifest.updated;
    },

    /* --- the cycle -------------------------------------------------------- */

    async sync({ deep = false, reason = "auto" } = {}) {
      if (this.running) {
        log.info("Sync already running; skipping.");
        return;
      }
      if (!this.configured()) {
        this.emit("idle", this.describeMissing());
        return;
      }
      this.running = true;
      this.lastError = "";
      this.followUp = false;
      this.emit("syncing", "Syncing...");

      const deepNow = deep || forceDeepOnce;

      try {
        await this.ready();
        const key = await this.ensureKey();

        const remote = await this.readManifest(key);
        const scan = await scanLocal({ deep: deepNow });
        const local = scan.items;

        this.stats.local = local.size;
        this.stats.remote = Object.keys(remote.items).length;

        pruneTombstones(state.deleted);
        const deleted = Object.assign({}, remote.deleted, state.deleted);
        pruneTombstones(deleted);

        /* ---- 0. what disappeared, and can we trust it? ------------------ */

        // Items we know we had, that the local database no longer reports.
        // This is either a real deletion or a damaged/partial read, and the
        // two look identical from here. The share that vanished tells us which
        // is more likely.
        const missing = new Set();
        for (const lkey of Object.keys(state.items)) {
          if (Exclusions.test(lkey)) continue;
          if (local.has(lkey) || deleted[lkey]) continue;
          missing.add(lkey);
        }
        const knownCount = Object.keys(state.items).length;
        // Everything vanishing at once is almost never a real user action:
        // TypingMind always keeps some settings behind, so that alone counts
        // as damage no matter how small the library is. Below that, a majority
        // disappearing is only suspicious once there are a few of them.
        const massDisappearance =
          knownCount > 0 &&
          (missing.size === knownCount ||
            (missing.size >= DELETE_ABSOLUTE_FLOOR &&
              missing.size / knownCount > DELETE_RATIO_LIMIT));

        if (massDisappearance) {
          // Treat the local database as damaged rather than deliberately
          // emptied: restore from the cloud instead of propagating deletions.
          log.warn(
            `${missing.size} of ${knownCount} items are missing locally. ` +
              `Treating this as a damaged local database and restoring from Drive ` +
              `rather than deleting anything. If you really did delete them, ` +
              `use "Push local over cloud".`
          );
        }
        const trustDeletions = scan.consistent && !massDisappearance;

        /* ---- 1. work out what to pull ---------------------------------- */

        const toPull = [];
        const pullSet = new Set();
        for (const [rkey, r] of Object.entries(remote.items)) {
          if (Exclusions.test(rkey)) continue;
          const mine = local.get(rkey);
          const tomb = deleted[rkey];

          // A tombstone newer than the remote copy means it was deleted after
          // that version was written. Don't resurrect it.
          if (tomb && tomb.t > (r.m || 0)) continue;

          if (!mine) {
            const known = state.items[rkey];
            // We had this exact version and now it's gone. That's a pending
            // deletion, not a missing download: re-fetching it here would
            // resurrect it before the quorum ever got to run. Unless the whole
            // database looks damaged, in which case healing wins.
            if (known && known.h === r.h && !massDisappearance) continue;
            toPull.push([rkey, r]);
            pullSet.add(rkey);
            continue;
          }
          if (mine.h === r.h) continue;
          if (!preferRemote(mine, r, state.items[rkey])) continue;
          toPull.push([rkey, r]);
          pullSet.add(rkey);
        }

        /* ---- 2. remote deletions we should apply ------------------------ */

        const deleteSet = new Set();
        for (const [dkey, d] of Object.entries(remote.deleted || {})) {
          if (Exclusions.test(dkey)) continue;
          if (pullSet.has(dkey)) continue; // a newer copy exists; don't delete it
          const mine = local.get(dkey);
          if (!mine) continue;
          if ((mine.m || 0) > (d.t || 0)) continue; // edited after the delete: keep it
          deleteSet.add(dkey);
        }

        /* ---- 3. apply pulls --------------------------------------------- */

        let pulled = 0;
        const pulledKeys = new Set();
        if (toPull.length) {
          this.emit("syncing", `Downloading ${toPull.length} item${toPull.length > 1 ? "s" : ""}...`);
          const results = await pool(toPull, DOWNLOAD_CONCURRENCY, async ([rkey, r]) => {
            const sealed = await Drive.get(BLOB_PREFIX + r.h);
            const plain = await Crypto.open(key, sealed);
            await materialise(rkey, r.k, plain, r);
            state.items[rkey] = { h: r.h, k: r.k, m: r.m, s: r.s, sig: null, mime: r.mime };
            delete state.deleted[rkey];
            delete state.pendingDel[rkey];
            return rkey;
          });
          for (const res of results) {
            if (res.ok) {
              pulled++;
              pulledKeys.add(res.value);
            } else {
              log.warn("Download failed:", res.error.message);
            }
          }
        }

        let removedLocally = 0;
        for (const dkey of deleteSet) {
          const kind = local.get(dkey).k;
          try {
            if (kind === "ls") localStorage.removeItem(dkey);
            else await Local.delIdb(dkey);
            delete state.items[dkey];
            state.deleted[dkey] = { t: remote.deleted[dkey].t };
            removedLocally++;
          } catch (e) {
            log.warn(`Could not delete "${dkey}":`, e.message);
          }
        }

        /* ---- 4. work out what to push ----------------------------------- */

        const toPush = [];
        for (const [lkey, l] of local) {
          if (deleteSet.has(lkey)) continue;
          if (pullSet.has(lkey)) continue; // remote won; never push over it
          const r = remote.items[lkey];
          const tomb = deleted[lkey];
          if (tomb && (l.m || 0) <= tomb.t) continue; // it's genuinely deleted
          if (r) {
            if (r.h === l.h) continue;
            if (preferRemote(l, r, state.items[lkey])) continue; // exact complement
          }
          toPush.push(lkey);
        }

        /* ---- 5. local deletions, behind the quorum ----------------------- */

        const newTombstones = [];
        for (const lkey of Object.keys(state.pendingDel)) {
          if (local.has(lkey)) delete state.pendingDel[lkey];
        }

        if (massDisappearance) {
          state.pendingDel = {};
          this.emit("warn", `Restoring ${missing.size} items that vanished locally.`);
        } else if (trustDeletions) {
          // An item has to be gone across two separate scans, at least
          // DELETE_MIN_AGE_MS apart, before we tell other devices about it.
          const t = nowMs();
          for (const ckey of missing) {
            const p = state.pendingDel[ckey] || { first: t, seen: 0 };
            p.seen++;
            state.pendingDel[ckey] = p;
            if (p.seen >= DELETE_MIN_SIGHTINGS && t - p.first >= DELETE_MIN_AGE_MS) {
              deleted[ckey] = { t };
              state.deleted[ckey] = { t };
              delete state.items[ckey];
              delete state.pendingDel[ckey];
              newTombstones.push(ckey);
            }
          }
        }

        /* ---- 6. apply pushes -------------------------------------------- */

        let pushed = 0;
        let deferred = 0;
        const pushedKeys = new Set();
        if (toPush.length) {
          this.emit("syncing", `Uploading ${toPush.length} item${toPush.length > 1 ? "s" : ""}...`);

          // A reply that is still streaming changes every few hundred
          // milliseconds. Pause, then read each candidate again: anything that
          // moved in the meantime is still being written, so it is held back
          // and re-checked in a few seconds rather than published half done.
          await sleep(SETTLE_DELAY_MS);

          const results = await pool(toPush, UPLOAD_CONCURRENCY, async (lkey) => {
            const l = local.get(lkey);
            const value = l.k === "ls" ? localStorage.getItem(lkey) : await Local.getIdb(lkey);
            if (value === null || value === undefined) return null;

            const bytes = await serialise(l.k, value);
            const h = await hashBytes(bytes);
            const stable = h === l.h;

            if (!stable) {
              const skips = (deferCounts.get(lkey) || 0) + 1;
              if (skips <= SETTLE_MAX_SKIPS) {
                deferCounts.set(lkey, skips);
                deferred++;
                return null;
              }
              // Something writes to this key constantly. Publish what we have
              // so it can't block the rest of the library forever.
              log.info(`"${lkey}" keeps changing; publishing the current version.`);
            }
            deferCounts.delete(lkey);

            const name = BLOB_PREFIX + h;
            // Content addressing: if that exact content is already up there,
            // the upload is a no-op and we only record the mapping.
            if (!Drive.has(name)) {
              await Drive.put(name, await Crypto.seal(key, bytes));
            }

            const entry = {
              h,
              k: l.k,
              m: stable ? l.m : modifiedTime(lkey, value, l.k) ?? nowMs(),
              s: bytes.length,
              sig: stable ? l.sig : null,
            };
            if (l.k === "blob") entry.mime = value.type || "application/octet-stream";
            else if (l.mime) entry.mime = l.mime;
            state.items[lkey] = entry;
            return lkey;
          });

          for (const res of results) {
            if (res.ok && res.value) {
              pushed++;
              pushedKeys.add(res.value);
            } else if (!res.ok) {
              log.warn("Upload failed:", res.error.message);
            }
          }
        }

        if (deferred) {
          this.followUp = true;
          log.info(`${deferred} item(s) still being written; re-checking shortly.`);
        }

        /* ---- 7. write the manifest -------------------------------------- */

        // Re-read first: another device may have written while we worked.
        const fresh = await this.readManifest(key);
        const merged = { v: 1, updated: nowMs(), device: state.device, items: {}, deleted: {} };

        Object.assign(merged.items, fresh.items);
        Object.assign(merged.deleted, fresh.deleted, deleted);
        pruneTombstones(merged.deleted);

        // Publish from what this device actually holds now, not from the
        // pre-pull scan. Version 1 looped over the scan here, which quietly
        // wrote its own stale copy of every item it had just pulled back over
        // the newer entry, and that is what dragged truncated chats around
        // between devices.
        for (const lkey of Object.keys(state.items)) {
          if (Exclusions.test(lkey)) continue;
          const s = state.items[lkey];
          if (!s || !s.h) continue;
          const isNew = !(lkey in merged.items);
          // Only claim an item we just uploaded, or one the manifest lost
          // while we still hold it. Everything else keeps the remote entry.
          if (!pushedKeys.has(lkey) && !(isNew && local.has(lkey))) continue;
          // Never point the manifest at content that isn't actually in Drive.
          if (!Drive.has(BLOB_PREFIX + s.h)) continue;
          const entry = { h: s.h, k: s.k, m: s.m, s: s.s };
          if (s.mime) entry.mime = s.mime;
          merged.items[lkey] = entry;
        }
        for (const dkey of Object.keys(merged.deleted)) delete merged.items[dkey];

        if (manifestDiffers(merged, fresh)) await this.writeManifest(key, merged);

        /* ---- 8. housekeeping -------------------------------------------- */

        state.lastSync = nowMs();
        if (deepNow) {
          state.lastDeepScan = state.lastSync;
          state.sigScheme = SIGNATURE_SCHEME;
          forceDeepOnce = false;
        }
        this.stats = {
          local: local.size,
          remote: Object.keys(merged.items).length,
          pulled,
          pushed,
          removed: removedLocally,
        };
        saveState();

        await this.maybeAutoSnapshot(key, merged);
        await this.maybeGc(key);

        if (pulled > 0 || removedLocally > 0) {
          // Never let a UI problem mark a successful sync as failed.
          try {
            RefreshNotice.request(pulled + removedLocally);
          } catch (e) {
            log.warn("Refresh notice failed:", e.message);
          }
        }

        const bits = [];
        if (pulled) bits.push(`${pulled} in`);
        if (pushed) bits.push(`${pushed} out`);
        if (removedLocally) bits.push(`${removedLocally} removed`);
        if (newTombstones.length) bits.push(`${newTombstones.length} deleted`);
        if (deferred) bits.push(`${deferred} still being written`);
        this.emit(
          scan.consistent ? "ok" : "warn",
          bits.length ? `Synced: ${bits.join(", ")}.` : "Up to date."
        );
        log.info(`Sync done (${reason}):`, this.stats);
      } catch (e) {
        this.lastError = e.message;
        if (Drive.authNeeded || /sign-in|token|passphrase/i.test(e.message)) {
          this.emit("auth", e.message);
        } else {
          this.emit("error", e.message);
        }
        log.error("Sync failed:", e);
      } finally {
        this.running = false;
      }
    },

    /* --- snapshots -------------------------------------------------------- */

    /** A snapshot is just the manifest. Content addressing makes it free. */
    async createSnapshot(label) {
      await this.ready();
      const key = await this.ensureKey();
      const manifest = await this.readManifest(key);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const safe = (label || "manual").replace(/[^a-zA-Z0-9 _-]/g, "").trim().slice(0, 40) || "manual";
      const name = `${SNAP_PREFIX}${stamp}__${safe}.json`;
      const body = {
        v: 1,
        label: safe,
        created: nowMs(),
        itemCount: Object.keys(manifest.items).length,
        manifest,
      };
      await Drive.put(name, await Crypto.seal(key, enc.encode(JSON.stringify(body))));
      state.lastSnapshot = nowMs();
      saveState();
      return name;
    },

    listSnapshots() {
      const out = [];
      for (const [name, meta] of Drive.index) {
        if (!name.startsWith(SNAP_PREFIX)) continue;
        const m = name.slice(SNAP_PREFIX.length).replace(/\.json$/, "").split("__");
        out.push({ name, stamp: m[0] || "", label: m[1] || "snapshot", size: meta.size });
      }
      return out.sort((a, b) => (a.stamp < b.stamp ? 1 : -1));
    },

    async readSnapshot(key, name) {
      const sealed = await Drive.get(name);
      return JSON.parse(dec.decode(await Crypto.open(key, sealed)));
    },

    async maybeAutoSnapshot(key, manifest) {
      if (readCfg(K.autoSnapshot, "true") !== "true") return;
      if (nowMs() - (state.lastSnapshot || 0) < AUTO_SNAPSHOT_INTERVAL_MS) return;
      try {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const name = `${SNAP_PREFIX}${stamp}__daily.json`;
        const body = {
          v: 1,
          label: "daily",
          created: nowMs(),
          itemCount: Object.keys(manifest.items).length,
          manifest,
        };
        await Drive.put(name, await Crypto.seal(key, enc.encode(JSON.stringify(body))));
        state.lastSnapshot = nowMs();

        const dailies = this.listSnapshots().filter((s) => s.label === "daily");
        for (const old of dailies.slice(AUTO_SNAPSHOT_KEEP)) await Drive.remove(old.name);
        saveState();
        log.info("Daily snapshot saved.");
      } catch (e) {
        log.warn("Daily snapshot failed:", e.message);
      }
    },

    /**
     * Restore rolls the *cloud* back to a snapshot, then pulls. Local items
     * that the snapshot doesn't know about are removed so both sides match.
     */
    async restoreSnapshot(name) {
      await this.ready();
      const key = await this.ensureKey();
      const snap = await this.readSnapshot(key, name);
      const target = snap.manifest;
      if (!target || !target.items || !Object.keys(target.items).length) {
        throw new Error("That snapshot is empty; nothing to restore.");
      }

      this.emit("syncing", "Restoring...");
      const scan = await scanLocal({ deep: false });

      // Remove local items the snapshot doesn't contain.
      let removed = 0;
      for (const [lkey, l] of scan.items) {
        if (target.items[lkey]) continue;
        if (l.k === "ls") localStorage.removeItem(lkey);
        else await Local.delIdb(lkey);
        delete state.items[lkey];
        removed++;
      }

      // Pull everything the snapshot points at that we don't already have.
      const wanted = Object.entries(target.items).filter(([tkey, t]) => {
        const mine = scan.items.get(tkey);
        return !mine || mine.h !== t.h;
      });

      let restored = 0;
      const results = await pool(wanted, DOWNLOAD_CONCURRENCY, async ([tkey, t]) => {
        const sealed = await Drive.get(BLOB_PREFIX + t.h);
        const plain = await Crypto.open(key, sealed);
        await materialise(tkey, t.k, plain, t);
        state.items[tkey] = { h: t.h, k: t.k, m: t.m, s: t.s, sig: null, mime: t.mime };
        return tkey;
      });
      for (const r of results) {
        if (r.ok) restored++;
        else log.warn("Restore item failed:", r.error.message);
      }

      state.deleted = {};
      state.pendingDel = {};
      deferCounts.clear();
      await this.writeManifest(key, {
        v: 1,
        updated: nowMs(),
        device: state.device,
        items: target.items,
        deleted: {},
      });
      saveState();
      this.emit("ok", `Restored ${restored} items, removed ${removed}.`);
      return { restored, removed };
    },

    /* --- forced directions ------------------------------------------------ */

    async forcePush() {
      await this.ready();
      const key = await this.ensureKey();
      this.emit("syncing", "Pushing everything...");
      const scan = await scanLocal({ deep: true });
      let pushed = 0;
      const ok = new Set();
      const keys = [...scan.items.keys()];
      const results = await pool(keys, UPLOAD_CONCURRENCY, async (lkey) => {
        const l = scan.items.get(lkey);
        const name = BLOB_PREFIX + l.h;
        if (!Drive.has(name)) {
          const value = l.k === "ls" ? localStorage.getItem(lkey) : await Local.getIdb(lkey);
          if (value === null || value === undefined) return null;
          await Drive.put(name, await Crypto.seal(key, await serialise(l.k, value)));
        }
        state.items[lkey] = { h: l.h, k: l.k, m: l.m, s: l.s, sig: l.sig, mime: l.mime };
        return lkey;
      });
      for (const r of results) {
        if (r.ok && r.value) {
          pushed++;
          ok.add(r.value);
        } else if (!r.ok) {
          log.warn("Force push item failed:", r.error.message);
        }
      }

      // Only publish what actually reached Drive.
      const published = new Map();
      for (const [lkey, l] of scan.items) if (ok.has(lkey)) published.set(lkey, l);

      state.deleted = {};
      state.pendingDel = {};
      deferCounts.clear();
      await this.writeManifest(key, manifestFromMap(published, {}));
      state.lastSync = nowMs();
      state.lastDeepScan = state.lastSync;
      state.sigScheme = SIGNATURE_SCHEME;
      forceDeepOnce = false;
      saveState();
      this.emit("ok", `Pushed ${pushed} items. Cloud now matches this browser.`);
      return pushed;
    },

    async forcePull() {
      await this.ready();
      const key = await this.ensureKey();
      const remote = await this.readManifest(key);
      if (!Object.keys(remote.items).length) {
        throw new Error("The cloud folder is empty; pull cancelled.");
      }
      this.emit("syncing", "Pulling everything...");
      const scan = await scanLocal({ deep: false });

      let removed = 0;
      for (const [lkey, l] of scan.items) {
        if (remote.items[lkey]) continue;
        if (l.k === "ls") localStorage.removeItem(lkey);
        else await Local.delIdb(lkey);
        delete state.items[lkey];
        removed++;
      }

      const wanted = Object.entries(remote.items).filter(([rkey, r]) => {
        const mine = scan.items.get(rkey);
        return !mine || mine.h !== r.h;
      });
      let pulled = 0;
      const results = await pool(wanted, DOWNLOAD_CONCURRENCY, async ([rkey, r]) => {
        const sealed = await Drive.get(BLOB_PREFIX + r.h);
        await materialise(rkey, r.k, await Crypto.open(key, sealed), r);
        state.items[rkey] = { h: r.h, k: r.k, m: r.m, s: r.s, sig: null, mime: r.mime };
        return rkey;
      });
      for (const r of results) {
        if (r.ok) pulled++;
        else log.warn("Force pull item failed:", r.error.message);
      }

      state.deleted = {};
      state.pendingDel = {};
      deferCounts.clear();
      state.lastSync = nowMs();
      saveState();
      this.emit("ok", `Pulled ${pulled} items, removed ${removed}. Reload to see them.`);
      return { pulled, removed };
    },

    /* --- garbage collection ------------------------------------------------ */

    /**
     * Delete content blobs that neither the manifest nor any snapshot points
     * at. Only blobs older than the grace window are eligible, so an upload
     * in flight from another device is never reaped.
     */
    async gc(key) {
      const referenced = new Set();
      const manifest = await this.readManifest(key);
      for (const v of Object.values(manifest.items)) referenced.add(BLOB_PREFIX + v.h);

      for (const snap of this.listSnapshots()) {
        try {
          const body = await this.readSnapshot(key, snap.name);
          for (const v of Object.values(body.manifest?.items || {})) {
            referenced.add(BLOB_PREFIX + v.h);
          }
        } catch {
          // An unreadable snapshot must not authorise deleting live data.
          log.warn(`Skipping GC: snapshot "${snap.name}" could not be read.`);
          return 0;
        }
      }

      const cutoff = nowMs() - GC_GRACE_MS;
      const orphans = [];
      for (const [name, meta] of Drive.index) {
        if (!name.startsWith(BLOB_PREFIX)) continue;
        if (referenced.has(name)) continue;
        const created = meta.createdTime ? new Date(meta.createdTime).getTime() : 0;
        if (created && created > cutoff) continue;
        orphans.push(name);
      }

      const results = await pool(orphans, UPLOAD_CONCURRENCY, (name) => Drive.remove(name));
      const freed = results.filter((r) => r.ok).length;
      state.lastGc = nowMs();
      saveState();
      if (freed) log.info(`Cleaned up ${freed} unused files.`);
      return freed;
    },

    async maybeGc(key) {
      if (nowMs() - (state.lastGc || 0) < GC_INTERVAL_MS) return;
      try {
        await this.gc(key);
      } catch (e) {
        log.warn("Cleanup skipped:", e.message);
      }
    },
  };

  /* ===================================================================== */
  /* Refresh notice                                                         */
  /* ===================================================================== */

  /**
   * TypingMind reads the chat list and the open conversation into memory once,
   * at page load. Data written into IndexedDB behind its back is invisible
   * until the page reads again, and the app exposes no hook to ask it to
   * re-read, so seeing a chat that arrived from another device still needs a
   * refresh.
   *
   * This never refreshes the page on its own, and nothing in this file calls
   * location.reload() without you clicking something. All it does is put a
   * small pill at the bottom of the screen saying new data landed, so you know
   * a refresh would actually show you something rather than guessing. Tap
   * Refresh when you are ready, or dismiss it. Switch it off entirely in
   * Behaviour and the sync goes back to being completely silent.
   */
  const RefreshNotice = {
    pending: 0,

    enabled() {
      return readCfg(K.refreshNotice, "true") === "true";
    },

    request(count) {
      if (!this.enabled()) return;
      this.pending += count;
      this.show();
    },

    /** Only ever reached from the Refresh button in the pill. */
    refreshNow() {
      saveState();
      log.info("Refreshing at your request.");
      location.reload();
    },

    show() {
      if (!this.pending) return;
      let pill = document.getElementById("tmds-pill");
      if (!pill) {
        UI.injectStyles();
        pill = document.createElement("div");
        pill.id = "tmds-pill";
        pill.innerHTML =
          `<span id="tmds-pill-text"></span>` +
          `<button type="button" id="tmds-pill-go">Refresh</button>` +
          `<button type="button" class="tmds-pill-x" id="tmds-pill-x" aria-label="Dismiss">&times;</button>`;
        document.body.appendChild(pill);
        const goBtn = pill.querySelector("#tmds-pill-go");
        const xBtn = pill.querySelector("#tmds-pill-x");
        if (goBtn) goBtn.onclick = () => this.refreshNow();
        if (xBtn) xBtn.onclick = () => this.dismiss();
      }
      const text = pill.querySelector ? pill.querySelector("#tmds-pill-text") : null;
      if (text) {
        text.textContent =
          this.pending === 1
            ? "1 new item synced"
            : `${this.pending} new items synced`;
      }
    },

    dismiss() {
      this.pending = 0;
      document.getElementById("tmds-pill")?.remove();
    },
  };

  /* ===================================================================== */
  /* Scheduler + leader election                                            */
  /* ===================================================================== */

  const Scheduler = {
    started: false,
    timer: null,
    soonTimer: null,
    fastCount: 0,
    lastAuthTry: 0,
    channel: null,
    tabId: `t${nowMs().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    isLeader: false,
    peerSeen: 0,

    start() {
      if (this.started) return;
      this.started = true;
      try {
        this.channel = new BroadcastChannel("tmds-tabs");
        this.channel.onmessage = (ev) => {
          const m = ev.data;
          if (!m || m.id === this.tabId) return;
          if (m.type === "claim" && m.id < this.tabId) {
            this.isLeader = false;
            this.peerSeen = nowMs();
          }
          if (m.type === "bye") this.claim();
        };
      } catch {
        this.channel = null;
      }
      this.claim();
      setInterval(() => {
        // If the leader went away without saying goodbye, take over.
        if (!this.isLeader && nowMs() - this.peerSeen > 25000) this.claim();
        else if (this.isLeader) this.channel?.postMessage({ type: "claim", id: this.tabId });
      }, 10000);

      window.addEventListener("beforeunload", () => {
        if (this.isLeader) this.channel?.postMessage({ type: "bye", id: this.tabId });
      });

      // Coming back to the app is exactly when you want the other device's
      // latest chats, so any tab syncs on focus, leader or not.
      const onFront = () => {
        if (document.visibilityState !== "visible") return;
        if (nowMs() - (state.lastSync || 0) < 4000) return;
        this.tick(true);
      };
      document.addEventListener("visibilitychange", onFront);
      window.addEventListener("focus", onFront);
    },

    claim() {
      this.isLeader = true;
      this.channel?.postMessage({ type: "claim", id: this.tabId });
      this.reschedule();
    },

    intervalMs() {
      const secs = Math.max(30, parseInt(readCfg(K.interval, "60"), 10) || 60);
      return secs * 1000;
    },

    reschedule() {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      if (readCfg(K.enabled, "true") !== "true") {
        Engine.emit("idle", "Auto sync is off.");
        return;
      }
      if (!Engine.configured()) return;
      this.timer = setInterval(() => this.tick(), this.intervalMs());
    },

    /** A quick extra pass, used after something was held back for settling. */
    scheduleSoon(ms) {
      if (this.soonTimer) clearTimeout(this.soonTimer);
      this.soonTimer = setTimeout(() => {
        this.soonTimer = null;
        if (this.isLeader || document.visibilityState === "visible") this.tick(true);
      }, ms);
    },

    async tick(force = false) {
      if (!this.isLeader && !force) return;
      if (readCfg(K.enabled, "true") !== "true") return;
      if (!Engine.configured()) return;
      if (Drive.authNeeded) {
        // Don't spin, but don't park until the next manual click either. With
        // a refresh token this recovers on its own; without one, the Google
        // session may simply have come back.
        if (nowMs() - this.lastAuthTry < AUTH_RETRY_MS) return;
        this.lastAuthTry = nowMs();
        try {
          await Drive.auth({ interactive: false });
        } catch {
          return;
        }
      }
      const deep = nowMs() - (state.lastDeepScan || 0) > DEEP_SCAN_INTERVAL_MS;
      await Engine.sync({ deep, reason: force ? "focus" : "timer" });

      if (Engine.followUp && this.fastCount < MAX_FAST_FOLLOWUPS) {
        this.fastCount++;
        this.scheduleSoon(FAST_FOLLOWUP_MS);
      } else {
        this.fastCount = 0;
      }
    },
  };

  /* ===================================================================== */
  /* UI                                                                     */
  /* ===================================================================== */

  const UI = {
    button: null,
    dot: null,
    overlay: null,
    mirrorObserver: null,

    /* --- sidebar button --------------------------------------------------- */

    templateButton() {
      return (
        document.querySelector('button[data-element-id="workspace-tab-settings"]') ||
        document.querySelector('button[data-element-id="workspace-tab-chat"]')
      );
    },

    injectStyles() {
      if (document.getElementById("tmds-styles")) return;
      const s = document.createElement("style");
      s.id = "tmds-styles";
      // Everything here is scoped to our own ids/classes. No global selectors,
      // so other extensions' workspace tabs are left completely alone.
      s.textContent = `
#tmds-dot{position:absolute;top:-2px;right:-4px;width:7px;height:7px;border-radius:50%;
  background:#71717a;z-index:5;box-shadow:0 0 0 2px rgba(0,0,0,.45);pointer-events:none}
#tmds-dot.tmds-spin{animation:tmds-pulse 1.1s ease-in-out infinite}
@keyframes tmds-pulse{0%,100%{opacity:1}50%{opacity:.25}}
@media (prefers-reduced-motion:reduce){#tmds-dot.tmds-spin{animation:none}}

#tmds-overlay{position:fixed;inset:0;background:rgba(0,0,0,.62);backdrop-filter:blur(3px);
  z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;
  overflow-y:auto;-webkit-overflow-scrolling:touch}
#tmds-panel{width:100%;max-width:520px;max-height:92dvh;display:flex;flex-direction:column;
  background:#1c1c20;color:#e8e8ea;border:1px solid #38383e;border-radius:14px;
  box-shadow:0 24px 60px rgba(0,0,0,.6);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  font-size:14px;line-height:1.45}
#tmds-panel *{box-sizing:border-box}
.tmds-head{padding:16px 18px 12px;border-bottom:1px solid #2e2e34;display:flex;
  align-items:center;justify-content:space-between;gap:12px;flex-shrink:0}
.tmds-head h2{margin:0;font-size:16px;font-weight:600;letter-spacing:-.01em}
.tmds-ver{font-size:11px;color:#71717a}
.tmds-body{padding:14px 18px;overflow-y:auto;flex:1;min-height:0}
.tmds-foot{padding:12px 18px 16px;border-top:1px solid #2e2e34;display:flex;gap:8px;
  justify-content:flex-end;flex-shrink:0;flex-wrap:wrap}

.tmds-card{background:#232329;border:1px solid #34343b;border-radius:10px;padding:13px 14px;margin-bottom:12px}
.tmds-card h3{margin:0 0 10px;font-size:12px;font-weight:600;text-transform:uppercase;
  letter-spacing:.07em;color:#9b9ba3}
.tmds-note{margin:0 0 10px;font-size:12px;color:#8f8f98;line-height:1.5}
.tmds-note b{color:#c9c9d0;font-weight:600}

.tmds-field{margin-bottom:10px}
.tmds-field:last-child{margin-bottom:0}
.tmds-field label{display:block;margin-bottom:5px;font-size:12px;color:#b6b6bd}
.tmds-field input[type=text],.tmds-field input[type=password],.tmds-field input[type=number],
.tmds-field select{width:100%;padding:8px 10px;border-radius:7px;border:1px solid #45454e;
  background:#2b2b32;color:#f0f0f2;font-size:13px;font-family:inherit}
.tmds-field input:focus,.tmds-field select:focus{outline:2px solid #4c8dff;outline-offset:1px;border-color:#4c8dff}
.tmds-field small{display:block;margin-top:5px;font-size:11px;color:#7d7d86;line-height:1.45}
.tmds-row{display:flex;gap:10px;flex-wrap:wrap}
.tmds-row>*{flex:1 1 140px;min-width:0}

.tmds-toggle{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.tmds-toggle:last-child{margin-bottom:0}
.tmds-toggle input{width:16px;height:16px;accent-color:#4c8dff;flex-shrink:0;cursor:pointer;margin:0}
.tmds-toggle label{font-size:13px;color:#d5d5da;cursor:pointer}

.tmds-btn{padding:8px 14px;border-radius:7px;border:1px solid transparent;font-size:13px;
  font-weight:500;cursor:pointer;font-family:inherit;transition:background .15s ease}
.tmds-btn:disabled{opacity:.45;cursor:not-allowed}
.tmds-btn-primary{background:#3b7dea;color:#fff}
.tmds-btn-primary:hover:not(:disabled){background:#2f6ed6}
.tmds-btn-ghost{background:#33333b;color:#e0e0e5}
.tmds-btn-ghost:hover:not(:disabled){background:#3d3d47}
.tmds-btn-danger{background:#33333b;color:#ff8f8f;border-color:#5a3a3a}
.tmds-btn-danger:hover:not(:disabled){background:#4a2f2f}
.tmds-btn-sm{padding:5px 10px;font-size:12px}
.tmds-btnrow{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}

.tmds-status{display:flex;align-items:center;gap:9px;padding:9px 11px;border-radius:8px;
  background:#2b2b32;font-size:12.5px;margin-bottom:10px;line-height:1.4}
.tmds-led{width:9px;height:9px;border-radius:50%;background:#71717a;flex-shrink:0}
.tmds-led[data-s=ok]{background:#3ecf7a}.tmds-led[data-s=syncing]{background:#4c8dff}
.tmds-led[data-s=error]{background:#f2545b}.tmds-led[data-s=warn]{background:#e8b53a}
.tmds-led[data-s=auth]{background:#e8b53a}

.tmds-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(88px,1fr));gap:8px}
.tmds-stat{background:#2b2b32;border-radius:7px;padding:8px 10px}
.tmds-stat b{display:block;font-size:16px;font-weight:600;color:#f2f2f4}
.tmds-stat span{font-size:10.5px;color:#83838c;text-transform:uppercase;letter-spacing:.05em}

.tmds-list{max-height:170px;overflow-y:auto;border:1px solid #34343b;border-radius:8px}
.tmds-item{display:flex;align-items:center;gap:10px;padding:8px 10px;border-bottom:1px solid #2c2c33}
.tmds-item:last-child{border-bottom:none}
.tmds-item div{flex:1;min-width:0}
.tmds-item b{display:block;font-size:12.5px;font-weight:500;color:#e4e4e8;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tmds-item span{font-size:11px;color:#7d7d86}
.tmds-empty{padding:14px;text-align:center;font-size:12px;color:#7d7d86}

.tmds-guide{margin-top:8px;padding:11px 12px;background:#17171b;border:1px solid #313138;
  border-radius:8px;font-size:11.5px;color:#a8a8b0;line-height:1.6}
.tmds-guide ol{margin:0;padding-left:18px}
.tmds-guide li{margin-bottom:5px}
.tmds-guide code{background:#2f2f37;border-radius:4px;padding:1px 5px;font-size:11px;
  word-break:break-all;color:#d4d4da}
.tmds-guide a{color:#6fa8ff}
.tmds-link{background:none;border:none;color:#6fa8ff;font-size:11.5px;cursor:pointer;
  padding:0;font-family:inherit;text-decoration:underline}
.tmds-hidden{display:none!important}

#tmds-pill{position:fixed;left:50%;transform:translateX(-50%);bottom:92px;z-index:2147482000;
  display:flex;align-items:center;gap:9px;padding:8px 10px 8px 14px;border-radius:999px;
  background:#1c1c20;color:#e8e8ea;border:1px solid #3d3d45;
  box-shadow:0 10px 30px rgba(0,0,0,.45);max-width:calc(100vw - 24px);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:13px}
#tmds-pill span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#tmds-pill button{border:none;border-radius:999px;font-family:inherit;font-size:12.5px;
  padding:5px 12px;cursor:pointer;background:#3b7dea;color:#fff;flex-shrink:0}
#tmds-pill button:hover{background:#2f6ed6}
#tmds-pill button.tmds-pill-x{background:transparent;color:#9b9ba3;padding:4px 6px;
  font-size:16px;line-height:1}
#tmds-pill button.tmds-pill-x:hover{color:#e8e8ea;background:transparent}

@media (max-width:480px){
  #tmds-overlay{padding:8px;align-items:flex-end}
  #tmds-panel{max-height:94dvh}
  .tmds-foot .tmds-btn{flex:1 1 auto}
  #tmds-pill{bottom:104px}
}`;
      document.head.appendChild(s);
    },

    /**
     * Mirrors whichever native tab we can find, so the button lines up on
     * phone and desktop. Deliberately does NOT copy from other extensions'
     * buttons, and never touches them.
     */
    renderButton() {
      const tpl = this.templateButton();
      if (!tpl || !this.button) return;

      if (tpl.classList.length) {
        const cls = Array.from(tpl.classList)
          .filter((c) => c !== "active" && c !== "selected")
          .join(" ");
        // TypingMind marks the active tab with a Tailwind background utility.
        // Strip it so our tab never renders as though it were selected.
        const inactive = cls
          .replace(/(^|\s)bg-white\/20(?=\s|$)/g, " sm:hover:bg-white/20")
          .replace(/(^|\s)text-white(?=\s|$)/g, " text-white/70");
        if (inactive.trim() && this.button.className !== inactive) {
          this.button.className = inactive.trim();
        }
      }

      const refSvg = tpl.querySelector("svg");
      // The label is the span that holds text; skip the one wrapping the icon.
      const refSpan = Array.from(tpl.querySelectorAll("span")).find(
        (s) => !s.querySelector("svg") && s.textContent && s.textContent.trim()
      );
      // Reuse TypingMind's own icon wrapper classes rather than guessing at
      // them, so the icon sits on the same baseline as every other tab.
      const refWrap =
        refSvg && refSvg.parentElement && refSvg.parentElement !== tpl ? refSvg.parentElement : null;
      const wrapClass = (refWrap?.getAttribute("class") || "relative flex flex-shrink-0").replace(/"/g, "");
      const svgClass = (refSvg?.getAttribute("class") || "w-4 h-4 flex-shrink-0").replace(/"/g, "");
      const spanClass = (refSpan?.getAttribute("class") || "").replace(/"/g, "");

      const html =
        `<span class="${wrapClass}" style="position:relative">` +
        `<svg class="${svgClass}" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
        `<g stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">` +
        `<path d="M10 4.5a5.5 5.5 0 0 1 5.24 3.83"/>` +
        `<path d="M10 15.5a5.5 5.5 0 0 1-5.24-3.83"/>` +
        `<polyline points="12.6,4.2 15.5,4.6 15.1,7.5"/>` +
        `<polyline points="7.4,15.8 4.5,15.4 4.9,12.5"/>` +
        `</g></svg>` +
        `<span id="tmds-dot"></span></span>` +
        (refSpan ? `<span class="${spanClass}">Sync</span>` : "");

      if (this.button.__html !== html) {
        this.button.innerHTML = html;
        this.button.__html = html;
        this.dot = this.button.querySelector("#tmds-dot");
        this.paint(Engine.status, Engine.message);
      }

      if (refSpan) this.button.removeAttribute("data-tooltip-content");
      else this.button.setAttribute("data-tooltip-content", "Sync");

      this.applyTweaksCompat();
    },

    /**
     * Retired compatibility shim for the TypingMind Tweaks extension.
     *
     * Older versions of Tweaks hand-assembled their tab and copied the icon
     * wrapper's classes onto the text label, so this pinned a snapshot of the
     * native label's computed styles onto it. That snapshot never recomputed
     * on rotation or a breakpoint change, and its `overflow-wrap:anywhere`
     * removed the Tweaks tab's min-content floor: on a narrow bar it then
     * shrank past every other tab and collided with Settings.
     *
     * Tweaks now clones TypingMind's own tab markup, so the label already
     * carries the correct classes. Nothing to do but clear the stylesheet an
     * earlier version of this script may have left behind.
     */
    applyTweaksCompat() {
      const stale = document.getElementById("tmds-compat");
      if (stale) stale.remove();
    },

    mount() {
      if (document.querySelector('[data-element-id="workspace-tab-drivesync"]')) return true;
      const chat = document.querySelector('button[data-element-id="workspace-tab-chat"]');
      const settings = document.querySelector('button[data-element-id="workspace-tab-settings"]');
      const anchor = settings || chat;
      if (!anchor?.parentNode) return false;

      this.injectStyles();

      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("data-element-id", "workspace-tab-drivesync");
      btn.setAttribute("data-tooltip-id", "global");
      btn.setAttribute("data-tooltip-place", "right");
      btn.setAttribute("aria-label", "Open Drive Sync");
      btn.style.cursor = "pointer";
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.open();
      });
      this.button = btn;
      this.renderButton();

      // Sit just before Settings when we can, so we join the tab group rather
      // than wedging between Chat and whatever another extension added. When
      // the Tweaks tab is already there, anchor off it instead: both scripts
      // converge on the same order whichever one loads first:
      //   ... | Drive Sync | Tweaks | Settings
      const tweaksTab =
        document.getElementById("workspace-tab-uitweaks") ||
        document.getElementById("workspace-tab-tweaks");
      if (tweaksTab && tweaksTab.parentNode) tweaksTab.parentNode.insertBefore(btn, tweaksTab);
      else if (settings) settings.parentNode.insertBefore(btn, settings);
      else anchor.parentNode.insertBefore(btn, anchor.nextSibling);

      this.watchTemplate();
      this.applyTweaksCompat();
      return true;
    },

    watchTemplate() {
      if (this.mirrorObserver) this.mirrorObserver.disconnect();
      const tpl = this.templateButton();
      if (!tpl) return;
      this.mirrorObserver = new MutationObserver(() => this.renderButton());
      this.mirrorObserver.observe(tpl, {
        attributes: true,
        attributeFilter: ["class"],
        childList: true,
        subtree: true,
      });
    },

    paint(status, message) {
      if (!this.dot) this.dot = document.getElementById("tmds-dot");
      if (this.dot) {
        const colors = {
          ok: "#3ecf7a",
          syncing: "#4c8dff",
          error: "#f2545b",
          warn: "#e8b53a",
          auth: "#e8b53a",
          idle: "#71717a",
        };
        this.dot.style.background = colors[status] || "#71717a";
        this.dot.classList.toggle("tmds-spin", status === "syncing");
      }
      if (this.button) {
        this.button.title = message ? `Sync: ${message}` : "Sync";
      }
      this.refreshPanel();
    },

    /* --- modal ------------------------------------------------------------ */

    open() {
      if (document.getElementById("tmds-overlay")) return;
      this.injectStyles();

      const overlay = document.createElement("div");
      overlay.id = "tmds-overlay";
      overlay.innerHTML = this.panelHtml();
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) this.close();
      });
      document.body.appendChild(overlay);
      this.overlay = overlay;
      this.wire(overlay);
      this.paintAuthMode();
      this.refreshPanel();

      this._esc = (e) => {
        if (e.key === "Escape") this.close();
      };
      document.addEventListener("keydown", this._esc);
    },

    close() {
      document.removeEventListener("keydown", this._esc || (() => {}));
      this.overlay?.remove();
      this.overlay = null;
    },

    panelHtml() {
      const clientId = readCfg(K.clientId, "");
      const clientSecret = readCfg(K.clientSecret, "");
      const redirect = Drive.redirectUri();
      const pass = readCfg(K.passphrase, "");
      const interval = readCfg(K.interval, "60");
      const exclusions = readCfg(K.exclusions, "");
      const enabled = readCfg(K.enabled, "true") === "true";
      const autoSnap = readCfg(K.autoSnapshot, "true") === "true";
      const refreshNotice = readCfg(K.refreshNotice, "true") === "true";

      return `
<div id="tmds-panel" role="dialog" aria-modal="true" aria-label="Drive Sync">
  <div class="tmds-head">
    <h2>Drive Sync</h2>
    <span class="tmds-ver">v${VERSION}</span>
  </div>
  <div class="tmds-body">

    <div class="tmds-status">
      <span class="tmds-led" id="tmds-led" data-s="idle"></span>
      <span id="tmds-msg">Loading...</span>
    </div>

    <div class="tmds-card">
      <h3>Activity</h3>
      <div class="tmds-stats">
        <div class="tmds-stat"><b id="tmds-n-local">-</b><span>On device</span></div>
        <div class="tmds-stat"><b id="tmds-n-remote">-</b><span>In Drive</span></div>
        <div class="tmds-stat"><b id="tmds-n-last">-</b><span>Last sync</span></div>
      </div>
      <div class="tmds-btnrow">
        <button class="tmds-btn tmds-btn-primary tmds-btn-sm" id="tmds-now">Sync now</button>
        <button class="tmds-btn tmds-btn-ghost tmds-btn-sm" id="tmds-signin">Sign in to Google</button>
        <button class="tmds-btn tmds-btn-ghost tmds-btn-sm" id="tmds-recheck">Recheck everything</button>
      </div>
      <p class="tmds-note" style="margin:10px 0 0">
        <b>Sync now</b> only looks at what changed since last time, so it is fast.
        <b>Recheck everything</b> re-reads every chat and setting on this device from scratch and
        compares it against Drive. Slower, but it catches anything the quick check missed.
        Run it once on the device that has the chats you trust.
      </p>
    </div>

    <div class="tmds-card">
      <h3>Google account</h3>
      <div class="tmds-field">
        <label for="tmds-clientid">Google Client ID</label>
        <input type="text" id="tmds-clientid" value="${escapeAttr(clientId)}"
               placeholder="000000-abc.apps.googleusercontent.com" autocomplete="off" spellcheck="false">
        <button type="button" class="tmds-link" id="tmds-guide-toggle">How do I get one?</button>
      </div>
      <div class="tmds-field">
        <label for="tmds-secret">Client secret (stops the repeated sign-ins)</label>
        <input type="password" id="tmds-secret" value="${escapeAttr(clientSecret)}"
               placeholder="GOCSPX-..." autocomplete="off" spellcheck="false">
        <small id="tmds-authmode"></small>
      </div>
      <div class="tmds-field">
        <label for="tmds-redirect">Redirect URI</label>
        <input type="text" id="tmds-redirect" value="${escapeAttr(redirect)}"
               autocomplete="off" spellcheck="false">
        <small>This exact text has to appear in <strong>Authorised redirect URIs</strong> on the same
        OAuth client, character for character. A single extra slash is enough to get
        "Error 400: redirect_uri_mismatch". Copy it from here into the Cloud Console, or paste
        what the console already has into here. Leave it as it is if you are unsure.</small>
      </div>
      <div class="tmds-guide tmds-hidden" id="tmds-guide">
        <ol>
          <li>Open the <a href="https://console.cloud.google.com/" target="_blank" rel="noopener">Google Cloud Console</a> and create a project.</li>
          <li>Enable the <strong>Google Drive API</strong> for it.</li>
          <li>Under <strong>OAuth consent screen</strong>, pick External, fill in the app name and your email, then <strong>publish the app</strong>. Leaving it in Testing makes Google expire the permission every 7 days.</li>
          <li>Under <strong>Credentials</strong>, create an <strong>OAuth client ID</strong> of type <strong>Web application</strong>.</li>
          <li>Add this exact address to <strong>Authorized JavaScript origins</strong>: <code>${escapeAttr(location.origin)}</code></li>
          <li>Add this exact address to <strong>Authorized redirect URIs</strong>: <code>${escapeAttr(redirect)}</code>. It must match the Redirect URI box above exactly.</li>
          <li>Copy the client ID and the client secret into the boxes above, save, then sign in once.</li>
        </ol>
      </div>
    </div>

    <div class="tmds-card">
      <h3>Encryption</h3>
      <p class="tmds-note">Everything is encrypted in this browser before it reaches Drive. Use the same passphrase on every device. If you lose it, the data cannot be recovered.</p>
      <div class="tmds-field">
        <label for="tmds-pass">Passphrase</label>
        <input type="password" id="tmds-pass" value="${escapeAttr(pass)}" autocomplete="new-password" spellcheck="false">
      </div>
    </div>

    <div class="tmds-card">
      <h3>Behaviour</h3>
      <div class="tmds-toggle">
        <input type="checkbox" id="tmds-enabled" ${enabled ? "checked" : ""}>
        <label for="tmds-enabled">Sync automatically in the background</label>
      </div>
      <div class="tmds-toggle">
        <input type="checkbox" id="tmds-refreshnotice" ${refreshNotice ? "checked" : ""}>
        <label for="tmds-refreshnotice">Show a reminder when new chats arrive</label>
      </div>
      <div class="tmds-toggle">
        <input type="checkbox" id="tmds-autosnap" ${autoSnap ? "checked" : ""}>
        <label for="tmds-autosnap">Keep a daily snapshot (7 most recent)</label>
      </div>
      <div class="tmds-toggle">
        <input type="checkbox" id="tmds-debug" ${log.enabled ? "checked" : ""}>
        <label for="tmds-debug">Write detailed logs to the console</label>
      </div>
      <p class="tmds-note" style="margin:10px 0 0">
        TypingMind reads your chats into memory when the page loads, so chats downloaded from
        another device only show up after a refresh. This extension never refreshes the page by
        itself. With the reminder on, a small pill appears at the bottom when new data lands so
        you know a refresh is worth it; tap Refresh when you are ready, or dismiss it. Turn the
        reminder off and the sync runs completely silently.
      </p>
      <div class="tmds-row" style="margin-top:10px">
        <div class="tmds-field">
          <label for="tmds-interval">Check every (seconds)</label>
          <input type="number" id="tmds-interval" min="30" step="10" value="${escapeAttr(interval)}">
        </div>
      </div>
      <div class="tmds-field">
        <label for="tmds-exclusions">Never sync these keys</label>
        <input type="text" id="tmds-exclusions" value="${escapeAttr(exclusions)}"
               placeholder="comma,separated,keys" autocomplete="off" spellcheck="false">
        <small>TypingMind's own sync bookkeeping and device identity keys are always excluded, so this is safe to leave running with native sync on.</small>
      </div>
    </div>

    <div class="tmds-card">
      <h3>Snapshots</h3>
      <p class="tmds-note">A snapshot records the state of your library at a moment in time. They cost almost nothing because unchanged data is stored once.</p>
      <div class="tmds-list" id="tmds-snaps"><div class="tmds-empty">Sign in to load snapshots.</div></div>
      <div class="tmds-btnrow">
        <button class="tmds-btn tmds-btn-ghost tmds-btn-sm" id="tmds-snap-new">Take a snapshot</button>
        <button class="tmds-btn tmds-btn-ghost tmds-btn-sm" id="tmds-snap-refresh">Refresh</button>
      </div>
    </div>

    <div class="tmds-card">
      <h3>Repair</h3>
      <p class="tmds-note">Use these when the two sides have drifted apart. Both overwrite one side completely.</p>
      <div class="tmds-btnrow">
        <button class="tmds-btn tmds-btn-danger tmds-btn-sm" id="tmds-push">Push local over cloud</button>
        <button class="tmds-btn tmds-btn-danger tmds-btn-sm" id="tmds-pull">Pull cloud over local</button>
        <button class="tmds-btn tmds-btn-ghost tmds-btn-sm" id="tmds-gc">Free unused space</button>
      </div>
    </div>

  </div>
  <div class="tmds-foot">
    <button class="tmds-btn tmds-btn-ghost" id="tmds-close">Close</button>
    <button class="tmds-btn tmds-btn-primary" id="tmds-save">Save settings</button>
  </div>
</div>`;
    },

    wire(root) {
      const $ = (id) => root.querySelector("#" + id);
      const busy = async (btn, label, fn) => {
        const original = btn.textContent;
        btn.disabled = true;
        btn.textContent = label;
        try {
          await fn();
        } catch (e) {
          Engine.emit("error", e.message);
          alert(e.message);
        } finally {
          btn.disabled = false;
          btn.textContent = original;
        }
      };

      /**
       * Writes whatever is currently in the form. Returns an error string if
       * something is invalid, otherwise null. Every action button commits the
       * form first: on a phone it is far too easy to type a passphrase, tap
       * "Sync now", and be told nothing is configured.
       */
      const commit = () => {
        const clientId = $("tmds-clientid").value.trim();
        const clientSecret = $("tmds-secret").value.trim();
        const redirect = $("tmds-redirect").value.trim();
        const pass = $("tmds-pass").value;
        const interval = Math.max(30, parseInt($("tmds-interval").value, 10) || 60);

        if (pass && pass.length < 8) return "Use a passphrase of at least 8 characters.";

        const passChanged = pass !== readCfg(K.passphrase, "");
        const secretChanged = clientSecret !== readCfg(K.clientSecret, "");
        writeCfg(K.clientId, clientId);
        writeCfg(K.clientSecret, clientSecret);
        // Only store an override when it differs from what we would build anyway.
        writeCfg(K.redirectUri, redirect === Drive.defaultRedirectUri() ? "" : redirect);
        writeCfg(K.passphrase, pass);
        // A different client means the saved permission belongs to someone else.
        if (secretChanged && !clientSecret) writeCfg(K.refresh, "");
        writeCfg(K.interval, interval);
        writeCfg(K.exclusions, $("tmds-exclusions").value.trim());
        writeCfg(K.enabled, $("tmds-enabled").checked ? "true" : "false");
        writeCfg(K.autoSnapshot, $("tmds-autosnap").checked ? "true" : "false");
        writeCfg(K.refreshNotice, $("tmds-refreshnotice").checked ? "true" : "false");
        if (!$("tmds-refreshnotice").checked) RefreshNotice.dismiss();
        log.enabled = $("tmds-debug").checked;

        $("tmds-interval").value = interval;
        Exclusions.reload();
        if (passChanged) Crypto.forget();
        this.paintAuthMode();
        Scheduler.reschedule();
        return null;
      };

      /** Commit the form, then run an action, but only if it can succeed. */
      const act = (btn, label, fn, { needsSetup = true } = {}) =>
        busy(btn, label, async () => {
          const problem = commit();
          if (problem) {
            alert(problem);
            return;
          }
          if (needsSetup && !Engine.configured()) {
            const why = Engine.describeMissing();
            Engine.emit("idle", why);
            alert(why);
            return;
          }
          await fn();
        });

      $("tmds-close").onclick = () => this.close();
      $("tmds-guide-toggle").onclick = () => $("tmds-guide").classList.toggle("tmds-hidden");

      $("tmds-save").onclick = (e) => {
        const wasReady = Engine.configured();
        const problem = commit();
        if (problem) {
          alert(problem);
          return;
        }
        e.target.textContent = "Saved";
        setTimeout(() => (e.target.textContent = "Save settings"), 1400);

        if (!Engine.configured()) {
          Engine.emit("idle", Engine.describeMissing());
        } else if (!wasReady) {
          Engine.emit("idle", "Settings saved. Starting the first sync...");
          Engine.sync({ reason: "first-run" });
        } else {
          Engine.emit("idle", "Settings saved.");
        }
      };

      // Signing in only needs a client ID, so it runs before full setup.
      $("tmds-signin").onclick = (e) =>
        act(
          e.target,
          "Opening Google...",
          async () => {
            if (!readCfg(K.clientId, "").trim()) {
              alert("Add a Google Client ID first.");
              return;
            }
            Drive.tokenClient = null;
            // A fresh consent is the point of pressing this, so in offline
            // mode go straight for a new long-lived permission rather than
            // reusing whatever is already saved.
            if (Drive.offlineMode()) await Drive.connectOffline();
            else await Drive.auth({ interactive: true });
            this.paintAuthMode();
            const how = Drive.offlineMode()
              ? "Connected. Google access now renews by itself; you should not be asked again."
              : "Signed in to Google. Without a client secret this lasts about an hour.";
            Engine.emit("ok", Engine.configured() ? how : how + " " + Engine.describeMissing());
            await this.loadSnapshots();
          },
          { needsSetup: false }
        );

      $("tmds-now").onclick = (e) =>
        act(e.target, "Syncing...", () => Engine.sync({ reason: "manual" }));

      $("tmds-recheck").onclick = (e) =>
        act(e.target, "Rechecking...", () => Engine.sync({ deep: true, reason: "recheck" }));

      $("tmds-snap-refresh").onclick = (e) =>
        act(e.target, "Loading...", async () => {
          await Drive.buildIndex();
          await this.loadSnapshots();
        });

      $("tmds-snap-new").onclick = (e) =>
        act(e.target, "Saving...", async () => {
          const label = prompt("Name this snapshot:", "before-cleanup");
          if (label === null) return;
          await Drive.buildIndex();
          await Engine.createSnapshot(label);
          await this.loadSnapshots();
          Engine.emit("ok", "Snapshot saved.");
        });

      $("tmds-push").onclick = (e) =>
        act(e.target, "Pushing...", async () => {
          if (
            !confirm(
              "This replaces everything in Drive with what is in this browser.\n\n" +
                "Changes made on other devices that have not reached this one will be lost.\n\nContinue?"
            )
          )
            return;
          await Drive.buildIndex();
          await Engine.forcePush();
        });

      $("tmds-pull").onclick = (e) =>
        act(e.target, "Pulling...", async () => {
          if (
            !confirm(
              "This replaces everything in this browser with what is in Drive.\n\n" +
                "Local changes that have not reached Drive will be lost.\n\nContinue?"
            )
          )
            return;
          await Drive.buildIndex();
          await Engine.forcePull();
          if (confirm("Done. Reload now to show the restored data?")) location.reload();
        });

      $("tmds-gc").onclick = (e) =>
        act(e.target, "Cleaning...", async () => {
          await Drive.buildIndex();
          const key = await Engine.ensureKey();
          const freed = await Engine.gc(key);
          Engine.emit("ok", freed ? `Removed ${freed} unused files.` : "Nothing to clean up.");
        });

      if (Drive.signedIn()) this.loadSnapshots();
    },

    /** One line under the secret box telling you which flow is live. */
    paintAuthMode() {
      const el = this.overlay?.querySelector("#tmds-authmode");
      if (!el) return;
      if (!Drive.offlineMode()) {
        el.textContent =
          "Empty: Google grants one hour at a time and has no way to renew quietly, so it will " +
          "ask you to sign in again from time to time. Paste the client secret from the same " +
          "OAuth client to stop that for good.";
      } else if (Drive.refreshToken()) {
        el.textContent =
          "Connected. Access renews by itself in the background, including after the tab has " +
          "been closed for days.";
      } else {
        el.textContent = "Saved. Press Sign in to Google once to grant the long-lived permission.";
      }
    },

    async loadSnapshots() {
      const box = this.overlay?.querySelector("#tmds-snaps");
      if (!box) return;
      const snaps = Engine.listSnapshots();
      if (!snaps.length) {
        box.innerHTML = `<div class="tmds-empty">No snapshots yet.</div>`;
        return;
      }
      box.innerHTML = "";
      for (const s of snaps.slice(0, 20)) {
        const row = document.createElement("div");
        row.className = "tmds-item";
        const when = s.stamp.replace("T", " ").replace(/-(\d{2})-(\d{2})$/, ":$1:$2");
        row.innerHTML =
          `<div><b>${escapeHtml(s.label)}</b><span>${escapeHtml(when)} &middot; ${formatBytes(s.size)}</span></div>`;

        const restore = document.createElement("button");
        restore.className = "tmds-btn tmds-btn-ghost tmds-btn-sm";
        restore.textContent = "Restore";
        restore.onclick = async () => {
          if (
            !confirm(
              `Restore "${s.label}"?\n\nBoth this browser and Drive will be rolled back to that point.`
            )
          )
            return;
          restore.disabled = true;
          restore.textContent = "Restoring...";
          try {
            await Drive.buildIndex();
            await Engine.restoreSnapshot(s.name);
            if (confirm("Restored. Reload now?")) location.reload();
          } catch (err) {
            alert(err.message);
          } finally {
            restore.disabled = false;
            restore.textContent = "Restore";
          }
        };

        const del = document.createElement("button");
        del.className = "tmds-btn tmds-btn-danger tmds-btn-sm";
        del.textContent = "Delete";
        del.onclick = async () => {
          if (!confirm(`Delete the snapshot "${s.label}"?`)) return;
          await Drive.remove(s.name);
          await this.loadSnapshots();
        };

        row.append(restore, del);
        box.appendChild(row);
      }
    },

    refreshPanel() {
      const root = this.overlay;
      if (!root) return;
      const led = root.querySelector("#tmds-led");
      const msg = root.querySelector("#tmds-msg");
      if (led) led.dataset.s = Engine.status;
      if (msg) {
        if (Engine.status === "auth") {
          msg.textContent = `${Engine.message} Tap "Sign in to Google" above.`;
        } else if (!Engine.configured()) {
          msg.textContent = Engine.describeMissing();
        } else {
          msg.textContent = Engine.message || "Ready.";
        }
      }
      const set = (id, v) => {
        const el = root.querySelector("#" + id);
        if (el) el.textContent = v;
      };
      set("tmds-n-local", Engine.stats.local || "-");
      set("tmds-n-remote", Engine.stats.remote || "-");
      set("tmds-n-last", formatWhen(state.lastSync));
    },
  };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[c]);
  }
  const escapeAttr = escapeHtml;

  /* ===================================================================== */
  /* Boot                                                                   */
  /* ===================================================================== */

  function waitForSidebar() {
    if (UI.mount()) return;
    const obs = new MutationObserver(() => {
      if (UI.mount()) obs.disconnect();
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => obs.disconnect(), 30000);
  }

  Engine.on((status, message) => UI.paint(status, message));

  async function boot() {
    console.info(`${TAG} TypingMind Drive Sync ${VERSION} loaded.`);
    waitForSidebar();

    Drive.loadStoredToken();
    // Top the access token up quietly, well before it lapses. Only does
    // anything once a long-lived permission has been saved.
    Drive.keepFresh();
    setInterval(() => Drive.keepFresh(), TOKEN_WATCH_MS);
    // Started unconditionally: reschedule() and tick() are no-ops until
    // there's a client ID and passphrase. Returning early here meant that
    // configuring the extension mid-session never started background sync
    // until the page was reloaded.
    Scheduler.start();

    if (!Engine.configured()) {
      Engine.emit("idle", Engine.describeMissing());
      return;
    }

    if (forceDeepOnce) {
      log.info("Upgraded change detection; the first sync rechecks everything once.");
    }

    // Give TypingMind a moment to finish its own start-up writes before the
    // first scan, so the consistency check isn't tripped by normal boot churn.
    setTimeout(() => Scheduler.tick(true), 6000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  /* Console helpers, handy when diagnosing. */
  window.tmDriveSync = {
    version: VERSION,
    sync: (opts) => Engine.sync(opts || { reason: "console" }),
    recheckEverything: () => Engine.sync({ deep: true, reason: "console" }),
    deepVerify: () => Engine.sync({ deep: true, reason: "console" }), // old name, kept
    state: () => JSON.parse(JSON.stringify(state)),
    stats: () => Engine.stats,
    lastError: () => Engine.lastError,
    status: () => ({ status: Engine.status, message: Engine.message }),
    snapshots: () => Engine.listSnapshots(),
    auth: () => ({
      mode: Drive.offlineMode() ? "refresh token (renews itself)" : "popup (about an hour)",
      connected: !!Drive.refreshToken(),
      expiresIn: Drive.token ? Math.round((Drive.token.expires_at - Date.now()) / 1000) + "s" : "no token",
    }),
    renew: () => Drive.renewFromRefresh(),
    connect: () => Drive.connectOffline(),
    signOut: () => {
      Drive.token = null;
      localStorage.removeItem(K.token);
      return "Access token cleared. It renews on the next sync.";
    },
    forcePush: () => Engine.forcePush(),
    forcePull: () => Engine.forcePull(),
    resetLocalState: () => {
      localStorage.removeItem(K.state);
      state = freshState();
      forceDeepOnce = false;
      deferCounts.clear();
      saveState();
      return "Local sync index cleared. The next sync rebuilds it from Drive.";
    },
    open: () => UI.open(),
  };
})();
