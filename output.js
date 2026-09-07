/* ==========================================================================
 * TypingMind Output Lock  v1.0
 * --------------------------------------------------------------------------
 * Remembers your chat-area Output Settings (language, tone, writing style,
 * format) and re-applies them automatically when you start a new chat or
 * switch chats. Whatever you set last becomes the new default.
 *
 * How it works
 *   1. Finds the Output Settings button in the chat input area.
 *   2. Whenever you change something in that panel, it snapshots your
 *      choices to localStorage.
 *   3. On every chat change it silently opens the panel, clicks your saved
 *      choices back in, and closes it. Because it drives the real UI
 *      controls, TypingMind saves the values itself. No DB writes.
 *
 * No MutationObserver on <body> (polling only), so it cannot cause the
 * touch-freeze feedback loops that observer-based scripts hit on mobile.
 *
 * Console API (window.tmOutput):
 *   tmOutput.status()   current state + saved snapshot
 *   tmOutput.save()     force a snapshot of the current chat's settings
 *   tmOutput.apply()    force a re-apply right now
 *   tmOutput.learn()    teach it the button (click it after running this)
 *   tmOutput.dump()     log every field/control it can see in the panel
 *   tmOutput.clear()    wipe the saved snapshot
 *   tmOutput.off()      kill switch for this session
 *   tmOutput.on()       re-enable
 * ========================================================================== */

(function () {
  'use strict';

  if (window.__TM_OUTPUT_LOCK__) return;
  window.__TM_OUTPUT_LOCK__ = true;

  /* ---------------------------------------------------------------- CONFIG */
  const CONFIG = {
    STORE_KEY: 'TM_OUTPUT_LOCK_V1',
    SILENT: true,          // hide the panel while it is being driven
    TOASTS: true,          // brief bottom-center confirmations
    APPLY_DELAY: 500,      // ms to wait after a chat change before applying
    POLL_MS: 700,          // chat-change poll interval
    ONLY_EMPTY_CHATS: false, // true = only apply to chats with no messages yet
    DEBUG: false,          // verbose console logging

    // Text hints used to auto-find the Output Settings button.
    TRIGGER_HINTS: ['output setting', 'output settings', 'output'],

    // Rows worth locking. Leave as-is unless your panel uses other labels.
    FIELD_HINTS: ['language', 'tone', 'writing style', 'style', 'format',
                  'output language', 'response format']
  };

  /* ----------------------------------------------------------------- STATE */
  const S = {
    enabled: true,
    busy: false,
    dirty: false,
    lastChatKey: '',
    applyTimer: null,
    captureTimer: null,
    pollTimer: null,
    failures: 0
  };

  const log = (...a) => { if (CONFIG.DEBUG) console.log('[output-lock]', ...a); };
  const warn = (...a) => console.warn('[output-lock]', ...a);

  /* ----------------------------------------------------------------- UTILS */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function norm(s) {
    return String(s || '')
      .replace(/\s+/g, ' ')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .trim();
  }

  function key(s) {
    return norm(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function visible(el) {
    if (!el || !el.isConnected) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
  }

  function fire(el, type) {
    el.dispatchEvent(new Event(type, { bubbles: true }));
  }

  function realClick(el) {
    const o = { bubbles: true, cancelable: true, view: window };
    try { el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ pointerId: 1, isPrimary: true }, o))); } catch (e) {}
    el.dispatchEvent(new MouseEvent('mousedown', o));
    try { el.dispatchEvent(new PointerEvent('pointerup', Object.assign({ pointerId: 1, isPrimary: true }, o))); } catch (e) {}
    el.dispatchEvent(new MouseEvent('mouseup', o));
    el.dispatchEvent(new MouseEvent('click', o));
  }

  async function waitFor(fn, timeout = 2500, step = 60) {
    const end = Date.now() + timeout;
    for (;;) {
      let v;
      try { v = fn(); } catch (e) { v = null; }
      if (v) return v;
      if (Date.now() > end) return null;
      await sleep(step);
    }
  }

  function cssPath(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 8) {
      if (node.dataset && node.dataset.elementId) {
        parts.unshift(`[data-element-id="${node.dataset.elementId}"]`);
        break;
      }
      const parent = node.parentElement;
      if (!parent) { parts.unshift(node.tagName.toLowerCase()); break; }
      const same = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
      const idx = same.indexOf(node) + 1;
      parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${idx})`);
      node = parent;
    }
    return parts.join(' > ');
  }

  /* ----------------------------------------------------------------- STORE */
  function load() {
    try {
      const raw = localStorage.getItem(CONFIG.STORE_KEY);
      if (!raw) return { version: 1, trigger: null, fields: {}, updatedAt: null };
      const data = JSON.parse(raw);
      if (!data.fields) data.fields = {};
      return data;
    } catch (e) {
      return { version: 1, trigger: null, fields: {}, updatedAt: null };
    }
  }

  function save(data) {
    data.updatedAt = new Date().toISOString();
    try { localStorage.setItem(CONFIG.STORE_KEY, JSON.stringify(data)); } catch (e) { warn('save failed', e); }
    return data;
  }

  let DB = load();

  /* ----------------------------------------------------------------- TOAST */
  let toastEl = null;
  function toast(msg) {
    if (!CONFIG.TOASTS) return;
    if (!toastEl) {
      toastEl = document.createElement('div');
      Object.assign(toastEl.style, {
        position: 'fixed',
        left: '50%',
        bottom: '84px',
        transform: 'translateX(-50%)',
        zIndex: '2147483000',
        maxWidth: '78vw',
        padding: '7px 12px',
        borderRadius: '8px',
        background: 'rgba(24,24,27,0.94)',
        color: 'rgba(244,244,245,0.95)',
        border: '1px solid rgba(255,255,255,0.10)',
        font: '13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        pointerEvents: 'none',
        opacity: '0',
        transition: 'opacity .16s ease'
      });
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) toastEl.style.transition = 'none';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.style.opacity = '1';
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => { toastEl.style.opacity = '0'; }, 1900);
  }

  /* ------------------------------------------------------------ SILENT CSS */
  const SILENT_CSS = `
  html.tmol-silent [role="dialog"],
  html.tmol-silent [role="menu"],
  html.tmol-silent [role="listbox"],
  html.tmol-silent [data-headlessui-portal],
  html.tmol-silent [id^="headlessui-dialog"],
  html.tmol-silent [id^="headlessui-popover"],
  html.tmol-silent [id^="headlessui-menu"],
  html.tmol-silent [id^="headlessui-listbox"] {
    opacity: 0 !important;
    pointer-events: none !important;
  }`;

  (function injectStyle() {
    const st = document.createElement('style');
    st.id = 'tmol-style';
    st.textContent = SILENT_CSS;
    document.head.appendChild(st);
  })();

  let silentTimer = null;
  function silentOn() {
    if (!CONFIG.SILENT) return;
    document.documentElement.classList.add('tmol-silent');
    clearTimeout(silentTimer);
    silentTimer = setTimeout(silentOff, 6000); // hard safety release
  }
  function silentOff() {
    clearTimeout(silentTimer);
    document.documentElement.classList.remove('tmol-silent');
  }

  /* --------------------------------------------------------------- TRIGGER */
  function fingerprint(el) {
    return {
      elementId: (el.dataset && el.dataset.elementId) || null,
      aria: el.getAttribute('aria-label') || null,
      title: el.getAttribute('title') || null,
      text: norm(el.textContent).slice(0, 40) || null,
      path: cssPath(el)
    };
  }

  function matchesHint(el) {
    const bag = key([
      el.getAttribute('aria-label') || '',
      el.getAttribute('title') || '',
      (el.dataset && el.dataset.elementId) || '',
      norm(el.textContent).slice(0, 40)
    ].join(' '));
    return CONFIG.TRIGGER_HINTS.some((h) => bag.includes(key(h)));
  }

  function chatInputScope() {
    return (
      document.querySelector('[data-element-id="chat-input-actions"]') ||
      document.querySelector('[data-element-id="chat-input-textbox"]')?.closest('div[class]')?.parentElement ||
      document.querySelector('[data-element-id="chat-space-middle-part"]') ||
      document.body
    );
  }

  function resolveTrigger() {
    const fp = DB.trigger;

    if (fp) {
      if (fp.elementId) {
        const el = document.querySelector(`[data-element-id="${fp.elementId}"]`);
        if (visible(el)) return el;
      }
      if (fp.aria) {
        const el = document.querySelector(`[aria-label="${CSS.escape(fp.aria).replace(/\\/g, '')}"]`);
        if (visible(el)) return el;
      }
      if (fp.path) {
        try {
          const el = document.querySelector(fp.path);
          if (visible(el)) return el;
        } catch (e) {}
      }
      if (fp.text) {
        const el = Array.from(document.querySelectorAll('button, [role="button"]'))
          .find((b) => visible(b) && norm(b.textContent).slice(0, 40) === fp.text);
        if (el) return el;
      }
    }

    // Auto-discovery inside the chat input area, then app-wide.
    const scopes = [chatInputScope(), document.body];
    for (const scope of scopes) {
      if (!scope) continue;
      const el = Array.from(scope.querySelectorAll('button, [role="button"], a[role="button"]'))
        .find((b) => visible(b) && matchesHint(b));
      if (el) return el;
    }
    return null;
  }

  /* ----------------------------------------------------------------- PANEL */
  const PANEL_SELECTOR = [
    '[role="dialog"]',
    '[role="menu"]',
    '[data-headlessui-portal] > *',
    '[id^="headlessui-dialog-panel"]',
    '[id^="headlessui-popover-panel"]',
    '[id^="headlessui-menu-items"]',
    'div[class*="fixed"]',
    'div[class*="absolute"]'
  ].join(',');

  const CONTROL_SELECTOR = [
    'select',
    'textarea',
    'input:not([type="hidden"])',
    'button[aria-haspopup]',
    '[role="combobox"]',
    '[role="switch"]',
    'button[aria-pressed]'
  ].join(',');

  function panelScore(el) {
    const bag = key(el.textContent);
    let hits = 0;
    for (const h of CONFIG.FIELD_HINTS) if (bag.includes(key(h))) hits++;
    return hits;
  }

  function findPanel() {
    const nodes = Array.from(document.querySelectorAll(PANEL_SELECTOR))
      .filter((el) => el.isConnected && el.getBoundingClientRect().height > 40)
      .filter((el) => panelScore(el) >= 2)
      .filter((el) => el.querySelector(CONTROL_SELECTOR));

    if (!nodes.length) return null;

    // Prefer the deepest / smallest matching container.
    nodes.sort((a, b) => {
      const da = a.querySelectorAll('*').length;
      const db = b.querySelectorAll('*').length;
      return da - db;
    });
    return nodes[0];
  }

  async function openPanel() {
    let panel = findPanel();
    if (panel) return panel;

    const trigger = resolveTrigger();
    if (!trigger) return null;

    silentOn();
    realClick(trigger);
    panel = await waitFor(findPanel, 2200);
    if (!panel) silentOff();
    return panel;
  }

  async function closePanel(panel) {
    const esc = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true };
    document.dispatchEvent(new KeyboardEvent('keydown', esc));
    document.dispatchEvent(new KeyboardEvent('keyup', esc));

    const gone = await waitFor(() => !findPanel(), 700, 60);
    if (!gone) {
      // Fallback: click the page background, then the trigger again.
      realClick(document.body);
      await sleep(120);
      if (findPanel()) {
        const t = resolveTrigger();
        if (t) realClick(t);
        await sleep(150);
      }
    }
    silentOff();
  }

  /* ---------------------------------------------------------------- FIELDS */
  function labelFor(el) {
    const aria = el.getAttribute('aria-label');
    if (aria) return key(aria);

    if (el.id) {
      try {
        const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (l) return key(l.textContent);
      } catch (e) {}
    }

    const wrap = el.closest('label');
    if (wrap) {
      const own = norm(el.textContent);
      return key(norm(wrap.textContent).replace(own, ''));
    }

    let node = el.parentElement;
    let depth = 0;
    while (node && depth < 4) {
      // Direct text nodes on this container.
      const direct = Array.from(node.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => norm(n.textContent))
        .filter((t) => t.length > 1 && t.length < 40)[0];
      if (direct) return key(direct);

      // A short sibling block that does not contain the control.
      const sib = Array.from(node.children)
        .filter((c) => c !== el && !c.contains(el))
        .map((c) => norm(c.textContent))
        .filter((t) => t.length > 1 && t.length < 40)[0];
      if (sib) return key(sib);

      node = node.parentElement;
      depth++;
    }

    const name = el.getAttribute('name');
    return name ? key(name) : '';
  }

  function controlType(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'select') return 'select';
    if (tag === 'textarea') return 'text';
    if (tag === 'input') {
      const t = (el.type || 'text').toLowerCase();
      if (t === 'checkbox' || t === 'radio') return 'check';
      return 'text';
    }
    if (el.getAttribute('role') === 'switch') return 'check';
    if (el.hasAttribute('aria-pressed')) return 'check';
    return 'listbox';
  }

  function readControl(el) {
    const type = controlType(el);
    if (type === 'select') {
      const opt = el.options[el.selectedIndex];
      return { type, value: el.value, text: opt ? norm(opt.textContent) : '' };
    }
    if (type === 'text') return { type, value: el.value || '' };
    if (type === 'check') {
      const on = el.tagName.toLowerCase() === 'input'
        ? !!el.checked
        : (el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-pressed') === 'true');
      return { type, value: on };
    }
    return { type, value: norm(el.textContent).replace(/[\u25BC\u25BE\u2304\u2228]/g, '').trim() };
  }

  function scanFields(panel) {
    const out = [];
    const seen = new Set();
    const controls = Array.from(panel.querySelectorAll(CONTROL_SELECTOR)).filter(visible);

    controls.forEach((el, i) => {
      // Skip search boxes and action buttons.
      const ph = key(el.getAttribute('placeholder') || '');
      if (ph.includes('search')) return;
      const txt = key(el.textContent);
      if (['close', 'save', 'cancel', 'reset', 'done', 'apply'].includes(txt)) return;

      let k = labelFor(el);
      if (!k) k = `field ${i}`;
      if (seen.has(k)) k = `${k} ${i}`;
      seen.add(k);

      out.push(Object.assign({ key: k, el }, readControl(el)));
    });

    return out;
  }

  function isWanted(k) {
    if (!CONFIG.FIELD_HINTS.length) return true;
    return CONFIG.FIELD_HINTS.some((h) => k.includes(key(h)) || key(h).includes(k));
  }

  /* ----------------------------------------------------------------- APPLY */
  async function setListbox(el, wanted) {
    realClick(el);
    const list = await waitFor(() => {
      const opts = Array.from(document.querySelectorAll('[role="option"], [role="menuitem"], li[id^="headlessui-listbox-option"]'))
        .filter(visible);
      return opts.length ? opts : null;
    }, 1200);

    if (!list) return false;

    const target =
      list.find((o) => key(o.textContent) === key(wanted)) ||
      list.find((o) => key(o.textContent).includes(key(wanted))) ||
      list.find((o) => key(wanted).includes(key(o.textContent)) && key(o.textContent).length > 2);

    if (!target) {
      // Close the open dropdown so we do not leave the UI stuck.
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return false;
    }

    realClick(target);
    await sleep(180);
    return true;
  }

  async function applyField(field, saved) {
    const el = field.el;

    if (field.type === 'select') {
      if (field.value === saved.value) return false;
      let val = saved.value;
      const byText = Array.from(el.options).find((o) => key(o.textContent) === key(saved.text || ''));
      if (!Array.from(el.options).some((o) => o.value === val) && byText) val = byText.value;
      if (!Array.from(el.options).some((o) => o.value === val)) return false;
      setNativeValue(el, val);
      fire(el, 'input');
      fire(el, 'change');
      await sleep(120);
      return true;
    }

    if (field.type === 'text') {
      if (norm(field.value) === norm(saved.value)) return false;
      el.focus();
      setNativeValue(el, saved.value);
      fire(el, 'input');
      fire(el, 'change');
      el.blur();
      await sleep(100);
      return true;
    }

    if (field.type === 'check') {
      if (!!field.value === !!saved.value) return false;
      realClick(el);
      await sleep(120);
      return true;
    }

    if (key(field.value) === key(saved.value)) return false;
    return await setListbox(el, saved.value);
  }

  function chatIsEmpty() {
    const msgs = document.querySelectorAll('[data-element-id="user-message"], [data-element-id="ai-response"], [data-element-id="response-block"]');
    return msgs.length === 0;
  }

  async function applySaved(reason) {
    if (!S.enabled || S.busy) return false;
    const savedFields = DB.fields || {};
    if (!Object.keys(savedFields).length) return false;
    if (CONFIG.ONLY_EMPTY_CHATS && !chatIsEmpty()) return false;

    S.busy = true;
    let changed = 0;

    try {
      const panel = await openPanel();
      if (!panel) {
        S.failures++;
        if (S.failures === 3) warn('cannot find the Output Settings button. Run tmOutput.learn() and click it once.');
        return false;
      }
      S.failures = 0;

      // Two passes: applying one field can re-render the panel.
      for (let pass = 0; pass < 2; pass++) {
        const fields = scanFields(panel).filter((f) => isWanted(f.key));
        let passChanges = 0;

        for (const f of fields) {
          const saved = savedFields[f.key] ||
            Object.entries(savedFields).find(([k]) => k.includes(f.key) || f.key.includes(k))?.[1];
          if (!saved) continue;
          if (saved.type !== f.type) continue;

          let did = false;
          try { did = await applyField(f, saved); } catch (e) { log('field failed', f.key, e); }
          if (did) { passChanges++; changed++; }
          if (!panel.isConnected) break;
        }

        if (!passChanges || !panel.isConnected) break;
      }

      const open = findPanel();
      if (open) await closePanel(open);
      else silentOff();

      if (changed) {
        log(`applied ${changed} field(s) [${reason}]`);
        toast('Output settings restored');
      }
      return changed > 0;
    } finally {
      silentOff();
      S.busy = false;
    }
  }

  /* --------------------------------------------------------------- CAPTURE */
  function snapshotFrom(panel) {
    const fields = scanFields(panel).filter((f) => isWanted(f.key));
    if (!fields.length) return 0;

    const next = {};
    for (const f of fields) {
      next[f.key] = f.type === 'select'
        ? { type: f.type, value: f.value, text: f.text }
        : { type: f.type, value: f.value };
    }

    DB.fields = next;
    save(DB);
    log('snapshot', next);
    return fields.length;
  }

  async function captureNow(quiet) {
    if (!S.enabled || S.busy) return 0;
    S.busy = true;
    try {
      const panel = await openPanel();
      if (!panel) return 0;
      const n = snapshotFrom(panel);
      const open = findPanel();
      if (open) await closePanel(open);
      if (n && !quiet) toast(`Saved ${n} output setting${n === 1 ? '' : 's'}`);
      return n;
    } finally {
      silentOff();
      S.busy = false;
    }
  }

  // Any interaction inside an open panel marks it dirty and re-snapshots.
  function onPanelInteraction(ev) {
    if (!S.enabled || S.busy) return;
    const panel = findPanel();
    if (!panel || !panel.contains(ev.target)) return;

    S.dirty = true;
    clearTimeout(S.captureTimer);
    S.captureTimer = setTimeout(async () => {
      const live = findPanel();
      if (live) {
        snapshotFrom(live);
        S.dirty = false;
      } else if (S.dirty) {
        // Panel closed on the last click. Reopen silently, read, close.
        await captureNow(true);
        S.dirty = false;
      }
    }, 320);
  }

  document.addEventListener('click', onPanelInteraction, true);
  document.addEventListener('change', onPanelInteraction, true);

  /* -------------------------------------------------- CHAT CHANGE DETECTION */
  function chatKey() {
    const sel = document.querySelector('[data-element-id="selected-chat-item"]');
    const selKey = sel ? norm(sel.textContent).slice(0, 60) : '';
    return `${location.href}|${selKey}`;
  }

  function schedule(reason) {
    clearTimeout(S.applyTimer);
    S.applyTimer = setTimeout(() => { applySaved(reason); }, CONFIG.APPLY_DELAY);
  }

  function pollChat() {
    if (!S.enabled) return;
    const k = chatKey();
    if (k !== S.lastChatKey) {
      S.lastChatKey = k;
      if (!S.busy) schedule('chat change');
    }
  }

  (function patchHistory() {
    const push = history.pushState;
    const replace = history.replaceState;
    history.pushState = function () { const r = push.apply(this, arguments); pollChat(); return r; };
    history.replaceState = function () { const r = replace.apply(this, arguments); pollChat(); return r; };
    addEventListener('popstate', pollChat);
    addEventListener('hashchange', pollChat);
  })();

  document.addEventListener('click', (ev) => {
    if (!S.enabled) return;
    const el = ev.target.closest?.('[data-element-id]');
    const id = el && el.dataset ? el.dataset.elementId : '';
    if (/new-chat|chat-item|workspace/i.test(id || '')) schedule('nav click');
  }, true);

  S.pollTimer = setInterval(pollChat, CONFIG.POLL_MS);

  /* ------------------------------------------------------------------- API */
  const api = {
    async learn() {
      toast('Now click your Output Settings button');
      const once = (ev) => {
        const el = ev.target.closest('button, [role="button"], a[role="button"]') || ev.target;
        DB.trigger = fingerprint(el);
        save(DB);
        log('trigger learned', DB.trigger);
        toast('Button learned. Set your options now.');
        setTimeout(async () => {
          const panel = await waitFor(findPanel, 4000);
          if (panel) {
            const n = snapshotFrom(panel);
            toast(n ? `Locked ${n} setting${n === 1 ? '' : 's'}` : 'Panel found, no fields matched');
          } else {
            warn('panel not detected after the click. Open it and run tmOutput.dump()');
          }
        }, 400);
      };
      document.addEventListener('click', once, { capture: true, once: true });
      return 'Click the Output Settings button in the chat area.';
    },

    save() { return captureNow(false); },
    apply() { return applySaved('manual'); },

    clear() {
      DB = save({ version: 1, trigger: DB.trigger, fields: {}, updatedAt: null });
      toast('Saved output settings cleared');
      return DB;
    },

    async dump() {
      const panel = findPanel() || (await openPanel());
      if (!panel) { console.log('[output-lock] no panel found'); return null; }
      const fields = scanFields(panel).map((f) => ({
        key: f.key, type: f.type, value: f.value, text: f.text, wanted: isWanted(f.key)
      }));
      console.log('[output-lock] panel:', panel);
      console.table(fields);
      return fields;
    },

    status() {
      const st = {
        enabled: S.enabled,
        busy: S.busy,
        triggerFound: !!resolveTrigger(),
        panelOpen: !!findPanel(),
        savedFields: DB.fields,
        savedAt: DB.updatedAt,
        trigger: DB.trigger,
        config: CONFIG
      };
      console.log('[output-lock] status', st);
      return st;
    },

    off() {
      S.enabled = false;
      clearInterval(S.pollTimer);
      clearTimeout(S.applyTimer);
      clearTimeout(S.captureTimer);
      silentOff();
      toast('Output Lock off for this session');
      return 'off';
    },

    on() {
      if (S.enabled) return 'already on';
      S.enabled = true;
      S.pollTimer = setInterval(pollChat, CONFIG.POLL_MS);
      schedule('re-enabled');
      toast('Output Lock on');
      return 'on';
    },

    config: CONFIG
  };

  window.tmOutput = api;
  window.tmOutputLock = api;

  /* ------------------------------------------------------------------ BOOT */
  (async function boot() {
    await waitFor(() => document.querySelector('[data-element-id="chat-input-textbox"]') || document.body.children.length > 3, 15000, 300);
    S.lastChatKey = chatKey();

    if (!Object.keys(DB.fields).length) {
      // First run: try to snapshot whatever is set right now.
      const n = await captureNow(true);
      if (!n) log('nothing captured yet. Set your output settings once, or run tmOutput.learn()');
    } else {
      schedule('boot');
    }
  })();
})();
