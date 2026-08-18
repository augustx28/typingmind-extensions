/* ============================================================================
 * TypingMind - Plugin Sorter  (V10)
 * ----------------------------------------------------------------------------
 * Drag to reorder plugins in the plugin menu. Built touch-first.
 *
 * WHY V10 EXISTS (read this if you tried V9)
 *  V9 froze the page. It watched attribute mutations on the plugin list, and
 *  the pill switch it injected set an attribute (aria-pressed) on every
 *  repaint. Observer -> repaint -> attribute write -> observer, forever. That
 *  infinite microtask loop starves the main thread, so the whole page stops
 *  responding to touch.
 *
 *  V10 removes attribute observation completely. The MutationObserver config
 *  is byte-identical to V8 ({childList: true}, no subtree). The pinning
 *  feature is driven by three cheap, loop-proof triggers instead:
 *    1. a capture-phase tap/keyup listener on the list (the actual user action
 *       that flips a plugin)
 *    2. V8's existing childList observer (TypingMind rebuilt the list)
 *    3. the existing 2s sweep, which re-reads live on/off state as a backstop
 *  Plus a mutation-rate watchdog that backs off instead of spinning, so no
 *  future edit can lock your screen again.
 *
 * THE FEATURE - "Active on top"
 *  A small pill sits at the top of the plugin list. It ships OFF, so V10
 *  behaves exactly like your V8 until you tap it.
 *    ON  -> any plugin you switch on jumps to the top of the list
 *    OFF -> that plugin drops straight back into the slot you dragged it to
 *
 *  Two saved lists per group keep those independent:
 *    order  -> your manual drag order (the resting position)
 *    pins   -> the order of the plugins currently switched on
 *  Dragging a switched-OFF row edits `order`. Dragging a switched-ON row
 *  inside the pinned cluster edits `pins` only, so its resting slot is never
 *  touched. Turn the pill off and the list is your plain drag order again.
 *
 *  CFG.newestOnTop  false = enabled plugins keep your manual relative order
 *                   true  = the plugin you just switched on goes above them
 *  CFG.showSwitch   false = no pill, drive it with tmSorter.float(true)
 *
 * KEPT FROM V8
 *  - Drag events handled in the CAPTURE phase, so HeadlessUI never sees the
 *    pointer crossing menu items and can't close the menu mid-drag.
 *  - Post-drop synthetic click swallowed; focus restored after a drop and
 *    after an auto-reorder (focus loss is what closes the popover).
 *  - Order saved per group and MERGED into the stored list, so rows hidden by
 *    search keep their slots.
 *  - GPU transform drag, one sort + autoscroll pass per frame, 5px threshold,
 *    44px touch target, haptic tick, reduced-motion aware.
 *
 * Console: tmSorter.dump() / .apply() / .float(true|false) / .debug()
 *          .off()  <- kills the script live, no reload needed
 *          .reset()
 * ========================================================================== */
(() => {
    'use strict';

    if (window.__tmSorterV10) return;
    window.__tmSorterV10 = true;

    const CFG = {
        keyOrder:  'tm_plugin_sort_v9',   // same key V9 used, so nothing re-migrates
        keyV8:     'tm_plugin_sort_v8',
        keyLegacy: 'tm_plugin_sort_v5_order',
        keyState:  'tm_plugin_sort_v5_toggles',
        sel: {
            header: 'button[id^="headlessui-disclosure-button"]',
            row:    '[role="menuitem"]',
            name:   '.truncate',
            switch: '[role="switch"]'
        },
        threshold:   5,     // px before a press becomes a drag
        sweepMs:     2000,  // watchdog re-scan
        settleMs:    90,    // debounce after TypingMind mutates a list
        flipMs:      170,   // debounce after a plugin switch is tapped
        clickShield: 450,   // how long to swallow the post-drop click
        maxSpeed:    14,    // autoscroll px/frame at the edge
        burstMax:    120,   // observer callbacks per second before backing off
        newestOnTop: false, // true = last plugin switched on sits above the rest
        showSwitch:  true   // false = no pill, use tmSorter.float(true|false)
    };

    /* ---------------------------------------------------------------- store */

    const Store = {
        read(key, fallback) {
            try {
                const raw = localStorage.getItem(key);
                return raw ? JSON.parse(raw) : fallback;
            } catch (e) { return fallback; }
        },
        write(key, val) {
            try { localStorage.setItem(key, JSON.stringify(val)); return true; }
            catch (e) { console.warn('[tm-sorter] could not save:', e); return false; }
        }
    };

    class OrderBook {
        constructor() {
            let data = Store.read(CFG.keyOrder, null);
            if (!data) {
                const v8 = Store.read(CFG.keyV8, null);
                const v5 = Store.read(CFG.keyLegacy, null);
                data = {
                    groups:  (v8 && v8.groups) || {},
                    legacy:  (v8 && v8.legacy) || (v5 && v5.order) || [],
                    pins:    {},
                    floatOn: false
                };
                Store.write(CFG.keyOrder, data);
            }
            this.data = data;
            this.fresh();
        }

        // always re-read so a second tab can't clobber us
        fresh() {
            const d = Store.read(CFG.keyOrder, this.data) || this.data;
            d.groups = d.groups || {};
            d.legacy = d.legacy || [];
            d.pins   = d.pins   || {};
            if (typeof d.floatOn !== 'boolean') d.floatOn = false;
            this.data = d;
            return d;
        }

        get(key) {
            const d = this.fresh();
            const own = d.groups[key];
            return (own && own.length) ? own : d.legacy;
        }

        set(key, names) {
            const d = this.fresh();
            d.groups[key] = names;
            Store.write(CFG.keyOrder, d);
        }

        pins(key)          { return this.fresh().pins[key] || []; }
        setPins(key, names) {
            const d = this.fresh();
            d.pins[key] = names;
            Store.write(CFG.keyOrder, d);
        }

        float()      { return this.fresh().floatOn; }
        setFloat(on) {
            const d = this.fresh();
            d.floatOn = !!on;
            Store.write(CFG.keyOrder, d);
        }

        wipe() {
            this.data = { groups: {}, legacy: [], pins: {}, floatOn: false };
            Store.write(CFG.keyOrder, this.data);
        }
    }

    /* ---------------------------------------------------------------- utils */

    const normTitle = (t) => (t || '')
        .replace(/\s+/g, ' ')
        .replace(/\(\s*\d+\s*\)/g, '')   // strip "(12)" style counters
        .trim()
        .toLowerCase();

    function rowName(row) {
        const nodes = row.querySelectorAll(CFG.sel.name);
        for (const n of nodes) {
            if (n.closest('.tm-handle') || n.closest('.tm-pinbar')) continue;
            const t = n.textContent.trim();
            if (t) return t;
        }
        const fb = row.textContent.trim();
        return fb ? fb.slice(0, 90) : null;
    }

    function rowsOf(list) {
        return Array.from(list.children).filter(
            el => el.matches && el.matches(CFG.sel.row) && el.querySelector(CFG.sel.switch)
        );
    }

    // Is this plugin switched on? Read-only, called on demand. Never writes.
    function isOn(row) {
        const sw = row.querySelector(CFG.sel.switch);
        if (!sw) return false;

        const ac = sw.getAttribute('aria-checked');
        if (ac === 'true')  return true;
        if (ac === 'false') return false;

        const box = sw.matches('input[type="checkbox"]')
            ? sw : sw.querySelector('input[type="checkbox"]');
        if (box) return !!box.checked;

        const flag = (sw.getAttribute('data-state') ||
                      sw.getAttribute('data-headlessui-state') || '').toLowerCase();
        if (/checked|\bon\b|active|selected/.test(flag)) return true;
        if (/unchecked|\boff\b/.test(flag))              return false;

        // last resort: an accent-coloured track means on
        return /bg-(blue|indigo|sky|violet|green|emerald|teal)/.test(sw.getAttribute('class') || '');
    }

    // Group key = the disclosure header this list sits under, else "root".
    function listKey(list) {
        let node = list;
        for (let i = 0; node && node !== document.body && i < 8; i++) {
            const prev = node.previousElementSibling;
            if (prev && prev.matches && prev.matches(CFG.sel.header)) {
                return 'g:' + normTitle(prev.textContent);
            }
            if (prev) {
                const inner = prev.querySelector && prev.querySelector(CFG.sel.header);
                if (inner) return 'g:' + normTitle(inner.textContent);
            }
            node = node.parentElement;
        }
        return 'root';
    }

    function findScroller(el) {
        let n = el;
        while (n && n !== document.body && n !== document.documentElement) {
            const s = getComputedStyle(n);
            if (/(auto|scroll|overlay)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 4) return n;
            n = n.parentElement;
        }
        return document.scrollingElement || document.documentElement;
    }

    function scrollBox(sc) {
        if (sc === document.scrollingElement || sc === document.documentElement || sc === document.body) {
            return { top: 0, bottom: window.innerHeight, height: window.innerHeight };
        }
        const r = sc.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, height: r.height };
    }

    // Reorder only the names in `subsetInNewOrder`; every other stored name keeps
    // its slot. Used for search-filtered lists, and to update the resting order
    // from the switched-off rows alone without disturbing pinned rows.
    function mergeOrder(saved, subsetInNewOrder) {
        const moving = new Set(subsetInNewOrder);
        const out = [];
        let i = 0;
        for (const name of saved) {
            if (moving.has(name)) {
                if (i < subsetInNewOrder.length) out.push(subsetInNewOrder[i++]);
            } else {
                out.push(name);
            }
        }
        while (i < subsetInNewOrder.length) out.push(subsetInNewOrder[i++]);
        return Array.from(new Set(out));
    }

    /* --------------------------------------------------------- click shield */

    let shieldTimer = null;
    function shieldClicks() {
        const kill = (e) => { e.stopPropagation(); e.preventDefault(); };
        const types = ['click', 'auxclick', 'contextmenu'];
        types.forEach(t => document.addEventListener(t, kill, true));
        clearTimeout(shieldTimer);
        shieldTimer = setTimeout(() => {
            types.forEach(t => document.removeEventListener(t, kill, true));
        }, CFG.clickShield);
    }

    /* --------------------------------------------------------------- sorter */

    class Sorter {
        constructor() {
            this.book = new OrderBook();
            this.pending = null;
            this.drag = null;
            this.lastFocus = null;
            this.dead = false;
            this.applying = new WeakSet();
            this.timers = new WeakMap();
            this.throttle = new WeakMap();
            this.budget = new WeakMap();
            this.observers = [];
            this.intervals = [];

            this.injectCSS();
            this.scan();
            this.watchDOM();
            this.intervals.push(setInterval(() => this.scan(), CFG.sweepMs));

            window.addEventListener('focus', () => this.scan());
            window.addEventListener('orientationchange', () => setTimeout(() => this.scan(), 250));
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden) this.scan();
            });
        }

        /* --- styles --- */
        injectCSS() {
            if (document.getElementById('tm-sorter-v10-css')) return;
            const s = document.createElement('style');
            s.id = 'tm-sorter-v10-css';
            s.textContent = `
/* keep the plugin label hard-left so the handle has room */
[role="menuitem"] .flex.items-center.justify-center.gap-2.truncate{
  justify-content:flex-start !important;
  margin-right:auto !important;
  flex-grow:0 !important;
  width:auto !important;
}

/* Zero vertical padding and no min-height, so the handle can never make a row
   taller than TypingMind already draws it. align-self:stretch means the handle
   is exactly as tall as the row. The tap target is widened with a transparent
   ::after pad, which hit-tests as the handle but costs no layout space. */
.tm-handle{
  position:relative;
  cursor:grab;
  display:flex;
  align-items:center;
  justify-content:center;
  flex:0 0 auto;
  align-self:stretch;
  min-width:0;
  min-height:0;
  padding:0 7px 0 0;
  margin:0;
  color:#94a3b8;
  opacity:.7;
  line-height:0;
  touch-action:none;
  -webkit-user-select:none;
  user-select:none;
  -webkit-touch-callout:none;
  -webkit-tap-highlight-color:transparent;
  transition:opacity .12s ease,color .12s ease;
}
.tm-handle svg{display:block;flex:0 0 auto;}
.tm-handle::after{content:'';position:absolute;inset:-2px -4px -2px -8px;}
.tm-handle:hover{opacity:1;}
.tm-handle:active{color:#3b82f6;opacity:1;cursor:grabbing;}
@media (pointer:coarse){
  .tm-handle{padding:0 9px 0 1px;opacity:.85;}
  .tm-handle::after{inset:-5px -7px -5px -10px;}
}

/* --- "Active on top" pill. touch-action stays default so it can never
       swallow a scroll gesture. --- */
.tm-pinbar{
  display:flex;
  align-items:center;
  padding:3px 6px 5px 6px;
  margin:0;
  flex:0 0 auto;
}
.tm-pin-btn{
  display:inline-flex;
  align-items:center;
  gap:7px;
  padding:3px 9px 3px 5px;
  border-radius:999px;
  background:transparent;
  border:1px solid rgba(148,163,184,.25);
  color:#94a3b8;
  font-size:11px;
  font-weight:500;
  line-height:1.35;
  cursor:pointer;
  touch-action:manipulation;
  -webkit-user-select:none;
  user-select:none;
  -webkit-tap-highlight-color:transparent;
  transition:color .12s ease,border-color .12s ease,background .12s ease;
}
.tm-pin-btn:hover{color:#cbd5e1;border-color:rgba(148,163,184,.45);}
.tm-pin-track{
  position:relative;
  width:24px;height:14px;
  border-radius:999px;
  background:rgba(148,163,184,.35);
  flex:0 0 auto;
  transition:background .15s ease;
}
.tm-pin-knob{
  position:absolute;top:2px;left:2px;
  width:10px;height:10px;
  border-radius:50%;
  background:#f8fafc;
  transition:transform .15s ease;
}
.tm-pin-btn.is-on{
  color:#93c5fd;
  border-color:rgba(59,130,246,.55);
  background:rgba(59,130,246,.10);
}
.tm-pin-btn.is-on .tm-pin-track{background:#3b82f6;}
.tm-pin-btn.is-on .tm-pin-knob{transform:translateX(10px);}
@media (pointer:coarse){
  .tm-pin-btn{padding:5px 11px 5px 7px;font-size:12px;}
}

.tm-ph{
  background:rgba(59,130,246,.07);
  border:1px dashed rgba(59,130,246,.45);
  border-radius:8px;
  margin:0;
  flex:0 0 auto;
  box-sizing:border-box;
  pointer-events:none;
}

.tm-dragging{
  position:fixed !important;
  z-index:2147483000 !important;
  margin:0 !important;
  width:var(--tm-w) !important;
  background:var(--tm-bg,#1f2937) !important;
  border-radius:8px;
  border:1px solid rgba(148,163,184,.25);
  box-shadow:0 12px 28px -8px rgba(0,0,0,.55);
  opacity:.97;
  pointer-events:none !important;
  touch-action:none !important;
  will-change:transform;
  transform:translate3d(0,0,0);
}

html.tm-drag-on,
html.tm-drag-on *{
  -webkit-user-select:none !important;
  user-select:none !important;
}
html.tm-drag-on{cursor:grabbing;}
html.tm-drag-on .tm-handle{cursor:grabbing;}

@media (prefers-reduced-motion:reduce){
  .tm-handle,.tm-pin-btn,.tm-pin-track,.tm-pin-knob{transition:none;}
  .tm-dragging{box-shadow:0 4px 10px -4px rgba(0,0,0,.5);}
}
`;
            document.head.appendChild(s);
        }

        /* --- discovery --- */

        scan() {
            if (this.dead) return;

            // a placeholder orphaned by a killed drag looks exactly like a
            // mystery gap between rows, so sweep any strays
            if (!this.drag) {
                document.querySelectorAll('.tm-ph').forEach(el => el.remove());
                document.querySelectorAll('.tm-dragging').forEach(el => {
                    el.classList.remove('tm-dragging');
                    ['transform','top','left','--tm-bg','--tm-w'].forEach(k => el.style.removeProperty(k));
                });
                document.documentElement.classList.remove('tm-drag-on');
            }

            const rows = document.querySelectorAll(CFG.sel.row);
            const lists = new Set();
            rows.forEach(r => {
                if (r.querySelector(CFG.sel.switch) && r.parentElement) lists.add(r.parentElement);
            });
            lists.forEach(l => {
                if (l.dataset.tmSort === '10') {
                    this.addHandles(l);
                    this.addBar(l);
                    this.queueApply(l);
                } else {
                    this.initList(l);
                }
            });

            this.paintBars();   // safe: nothing observes attributes
        }

        watchDOM() {
            const ob = new MutationObserver((muts) => {
                if (this.drag || this.dead) return;
                let hit = false;
                for (const m of muts) {
                    for (const n of m.addedNodes) {
                        if (n.nodeType !== 1) continue;
                        if ((n.matches && n.matches(CFG.sel.row)) ||
                            (n.querySelector && n.querySelector(CFG.sel.row))) { hit = true; break; }
                    }
                    if (hit) break;
                }
                if (hit) this.scan();
            });
            ob.observe(document.body, { childList: true, subtree: true });
            this.observers.push(ob);
        }

        // Backs off instead of spinning. Nothing in this script can lock the
        // main thread even if TypingMind goes mutation-crazy.
        budgetOk(list) {
            const now = Date.now();
            const b = this.budget.get(list) || { n: 0, at: now, until: 0 };
            if (now < b.until) return false;
            if (now - b.at > 1000) { b.n = 0; b.at = now; }
            b.n++;
            if (b.n > CFG.burstMax) {
                b.until = now + 4000; b.n = 0; b.at = now;
                console.warn('[tm-sorter] mutation storm, pausing this list for 4s');
            }
            this.budget.set(list, b);
            return now >= b.until;
        }

        initList(list) {
            list.dataset.tmSort = '10';
            this.addHandles(list);
            this.addBar(list);
            this.applyOrder(list);

            // childList only. Identical to V8. No attributes, no subtree.
            const ob = new MutationObserver(() => {
                if (this.drag || this.dead) return;
                if (this.applying.has(list)) return;
                if (!this.budgetOk(list)) return;
                this.addHandles(list);
                this.addBar(list);
                this.queueApply(list);
            });
            ob.observe(list, { childList: true });
            this.observers.push(ob);

            // A tap or keypress on a row is what flips a plugin. That is the
            // trigger for re-pinning. Capture phase so we still see it if
            // TypingMind stops propagation.
            const poke = (e) => {
                if (this.drag || this.dead) return;
                if (!this.book.float()) return;
                const t = e.target;
                if (!t || !t.closest || !t.closest(CFG.sel.row)) return;
                if (t.closest('.tm-handle') || t.closest('.tm-pinbar')) return;
                setTimeout(() => {
                    if (this.dead) return;
                    this.syncPins(list);
                    this.applyOrder(list, true);
                }, CFG.flipMs);
            };
            list.addEventListener('click', poke, true);
            list.addEventListener('keyup', (e) => {
                if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') poke(e);
            }, true);
        }

        queueApply(list, delay) {
            if (this.drag || this.dead) return;
            clearTimeout(this.timers.get(list));
            this.timers.set(list, setTimeout(
                () => this.applyOrder(list),
                delay === undefined ? CFG.settleMs : delay
            ));
        }

        addHandles(list) {
            rowsOf(list).forEach(row => {
                if (row.querySelector('.tm-handle')) return;
                const wrap = row.firstElementChild;
                if (!wrap) return;
                const h = document.createElement('div');
                h.className = 'tm-handle';
                h.setAttribute('aria-hidden', 'true');
                h.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M8 6h.01M8 12h.01M8 18h.01M16 6h.01M16 12h.01M16 18h.01"/></svg>';
                h.addEventListener('pointerdown', (e) => this.press(e, row));
                try { wrap.prepend(h); } catch (_) {}
            });
        }

        /* --- the pill --- */

        addBar(list) {
            if (!CFG.showSwitch) return;
            if (!rowsOf(list).length) return;

            let bar = null;
            for (const c of list.children) {
                if (c.classList && c.classList.contains('tm-pinbar')) { bar = c; break; }
            }
            if (bar) {
                // never repaint from here; that was the V9 feedback loop
                if (list.firstElementChild !== bar) {
                    try { list.prepend(bar); } catch (_) {}
                }
                return;
            }

            const on = this.book.float();
            bar = document.createElement('div');
            bar.className = 'tm-pinbar';
            bar.setAttribute('role', 'presentation');
            bar.innerHTML =
                '<button type="button" class="tm-pin-btn' + (on ? ' is-on' : '') + '" ' +
                'tabindex="-1" aria-pressed="' + (on ? 'true' : 'false') + '" ' +
                'title="Keep switched-on plugins at the top of the list">' +
                  '<span class="tm-pin-track"><span class="tm-pin-knob"></span></span>' +
                  '<span class="tm-pin-txt">Active on top</span>' +
                '</button>';

            // remember focus before the tap moves it, so the menu stays open.
            // No preventDefault anywhere: on iOS that can eat the click.
            ['pointerdown', 'mousedown'].forEach(t =>
                bar.addEventListener(t, (e) => {
                    this.lastFocus = document.activeElement;
                    e.stopPropagation();
                }, true)
            );

            bar.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                const back = this.lastFocus;
                this.setFloat(!this.book.float());
                requestAnimationFrame(() => {
                    try {
                        if (back && back.isConnected && back !== document.body) {
                            back.focus({ preventScroll: true });
                        }
                    } catch (_) {}
                });
            }, true);

            try { list.prepend(bar); } catch (_) {}
        }

        // writes only when the value actually changes
        paintBars() {
            const on = this.book.float();
            const want = on ? 'true' : 'false';
            document.querySelectorAll('.tm-pin-btn').forEach(b => {
                if (b.getAttribute('aria-pressed') !== want) b.setAttribute('aria-pressed', want);
                if (b.classList.contains('is-on') !== on) b.classList.toggle('is-on', on);
            });
        }

        setFloat(on) {
            this.book.setFloat(on);
            this.paintBars();
            document.querySelectorAll('[data-tm-sort="10"]').forEach(list => {
                if (on) this.syncPins(list);
                this.applyOrder(list, true);
            });
            if (navigator.vibrate) { try { navigator.vibrate(6); } catch (_) {} }
            return !!on;
        }

        /* --- pinned set bookkeeping --- */

        // Adds names that just switched on, drops names that switched off.
        // Only looks at visible rows, so a plugin hidden by search keeps its
        // pinned slot.
        syncPins(list) {
            const key = listKey(list);
            const rows = rowsOf(list);
            if (!rows.length) return false;

            const seen = rows.map(r => ({ name: rowName(r), on: isOn(r) })).filter(x => x.name);
            const pins = this.book.pins(key).slice();
            let changed = false;

            const offNow = new Set(seen.filter(x => !x.on).map(x => x.name));
            for (let i = pins.length - 1; i >= 0; i--) {
                if (offNow.has(pins[i])) { pins.splice(i, 1); changed = true; }
            }

            const have = new Set(pins);
            const adds = seen.filter(x => x.on && !have.has(x.name)).map(x => x.name);
            if (adds.length) {
                const saved = this.book.get(key);
                const idx = new Map(saved.map((n, i) => [n, i]));
                const at = (n) => idx.has(n) ? idx.get(n) : 1e6;
                adds.sort((a, b) => at(a) - at(b));
                if (CFG.newestOnTop) pins.unshift(...adds); else pins.push(...adds);
                changed = true;
            }

            if (changed) this.book.setPins(key, pins);
            return changed;
        }

        /* --- persistence --- */

        applyOrder(list, user) {
            if (this.drag || this.dead || !list.isConnected) return;

            // runaway guard: if React keeps re-rendering and fighting us, pause.
            // A tap on the pill or a plugin row is intent, so it skips the guard.
            const now = Date.now();
            const t = this.throttle.get(list) || { n: 0, at: now, until: 0 };
            if (!user) {
                if (now < t.until) return;
                if (now - t.at > 3000) { t.n = 0; t.at = now; }
            }

            const rows = rowsOf(list);
            if (rows.length < 2) return;

            const key     = listKey(list);
            const saved   = this.book.get(key);
            const floatOn = this.book.float();
            if (!saved.length && !floatOn) return;

            const idx  = new Map(saved.map((n, i) => [n, i]));
            const pins = floatOn ? this.book.pins(key) : [];
            const pin  = new Map(pins.map((n, i) => [n, i]));
            const FAR  = 1e6;

            const meta = rows.map((r, i) => {
                const name = rowName(r);
                return {
                    r,
                    on: floatOn ? isOn(r) : false,
                    p:  (name && pin.has(name)) ? pin.get(name) : FAR,
                    b:  (name && idx.has(name)) ? idx.get(name) : FAR + i
                };
            });

            const want = meta.slice().sort((a, b) => {
                if (a.on !== b.on) return a.on ? -1 : 1;    // switched-on rows float up
                if (a.on && a.p !== b.p) return a.p - b.p;  // pinned order
                return a.b - b.b;                            // your drag order
            }).map(m => m.r);

            let same = true;
            for (let i = 0; i < rows.length; i++) if (rows[i] !== want[i]) { same = false; break; }
            if (same) return;

            if (!user) {
                t.n++;
                if (t.n > 10) { t.until = now + 5000; t.n = 0; t.at = now; }
                this.throttle.set(list, t);
                if (t.until > now) return;
            }

            const tail = rows[rows.length - 1].nextSibling;  // keep trailing UI in place
            const focused = document.activeElement;
            const keep = (focused && focused !== document.body && list.contains(focused))
                ? focused : null;

            this.applying.add(list);
            try { want.forEach(el => list.insertBefore(el, tail)); } catch (_) {}

            // moving a focused node can blur it, and a blur closes the popover
            if (keep && keep.isConnected && document.activeElement !== keep) {
                try { keep.focus({ preventScroll: true }); } catch (_) {}
            }
            queueMicrotask(() => this.applying.delete(list));
        }

        // draggedName decides whether the drop edits the resting order or just
        // the pinned cluster.
        saveOrder(list, draggedName) {
            const rows  = rowsOf(list);
            const names = rows.map(rowName).filter(Boolean);
            if (!names.length) return;

            const key = listKey(list);

            if (!this.book.float()) {
                this.book.set(key, mergeOrder(this.book.get(key), names));
                return;
            }

            const onSet = new Set();
            rows.forEach(r => {
                if (!isOn(r)) return;
                const n = rowName(r);
                if (n) onSet.add(n);
            });

            if (draggedName && onSet.has(draggedName)) {
                // dragged a pinned row: reorder the pinned cluster only, so its
                // resting slot survives being switched off later
                this.syncPins(list);
                const pinned = names.filter(n => onSet.has(n));
                if (pinned.length) this.book.setPins(key, mergeOrder(this.book.pins(key), pinned));
            } else {
                // dragged a switched-off row: a real resting-order edit. Pinned
                // rows count as hidden here, so they keep their slots.
                const resting = names.filter(n => !onSet.has(n));
                if (resting.length) this.book.set(key, mergeOrder(this.book.get(key), resting));
            }
        }

        /* --- drag: press --- */

        press(e, row) {
            if (this.dead) return;
            if (e.button > 0) return;
            if (this.pending || this.drag) return;

            e.preventDefault();
            e.stopPropagation();

            const handle = e.currentTarget;
            try { handle.setPointerCapture(e.pointerId); } catch (_) {}

            const move   = (ev) => this.move(ev);
            const up     = (ev) => this.release(ev);
            const eat    = (ev) => { if (this.drag) { ev.stopPropagation(); if (ev.cancelable) ev.preventDefault(); } };
            const EATEN  = ['mousemove','mouseover','mouseout','mouseenter','mouseleave',
                            'touchmove','touchstart','dragstart','selectstart','contextmenu'];

            this.pending = {
                row, handle, id: e.pointerId,
                x: e.clientX, y: e.clientY,
                move, up, eat, EATEN,
                wasFocused: document.activeElement
            };

            // capture phase = we see it first and stop it before the menu does
            document.addEventListener('pointermove',   move, { capture: true, passive: false });
            document.addEventListener('pointerup',     up,   { capture: true });
            document.addEventListener('pointercancel', up,   { capture: true });
            EATEN.forEach(t => document.addEventListener(t, eat, { capture: true, passive: false }));

            // hard bail-out: if pointerup never arrives, don't leave the page
            // with document-level listeners eating touch
            this.pending.escape = setTimeout(() => {
                if (this.pending || this.drag) this.finish(true);
            }, 20000);
        }

        /* --- drag: start --- */

        begin() {
            const { row } = this.pending;
            const list = row.parentElement;
            const rect = row.getBoundingClientRect();

            const rowCS = getComputedStyle(row);
            const ph = document.createElement('div');
            ph.className = 'tm-ph';
            ph.style.height = rect.height + 'px';
            ph.style.marginTop = rowCS.marginTop;       // match the row exactly
            ph.style.marginBottom = rowCS.marginBottom; // so nothing shifts
            row.before(ph);

            let bg = getComputedStyle(row).backgroundColor;
            if (!bg || bg === 'transparent' || /,\s*0\)$/.test(bg)) {
                bg = getComputedStyle(list).backgroundColor;
            }
            if (!bg || bg === 'transparent' || /,\s*0\)$/.test(bg)) {
                bg = matchMedia('(prefers-color-scheme: dark)').matches ? '#1f2937' : '#ffffff';
            }

            row.style.setProperty('--tm-bg', bg);
            row.style.setProperty('--tm-w', rect.width + 'px');
            row.style.left = rect.left + 'px';
            row.style.top  = rect.top + 'px';
            row.classList.add('tm-dragging');

            document.documentElement.classList.add('tm-drag-on');
            if (navigator.vibrate) { try { navigator.vibrate(8); } catch (_) {} }

            this.drag = {
                row, list, ph,
                scroller: findScroller(list),
                grab: this.pending.y - rect.top,
                base: rect.top,
                y: this.pending.y,
                raf: 0
            };

            this.loop();
        }

        /* --- drag: move --- */

        move(e) {
            const p = this.pending;
            if (!p || e.pointerId !== p.id) return;

            if (!this.drag) {
                if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < CFG.threshold) return;
                this.begin();
            }

            if (e.cancelable) e.preventDefault();
            e.stopPropagation();
            this.drag.y = e.clientY;
        }

        /* --- drag: per-frame work (position, sort, autoscroll) --- */

        loop() {
            const step = () => {
                const d = this.drag;
                if (!d) return;

                if (!d.row.isConnected || !d.ph.isConnected || !d.list.isConnected) {
                    this.finish(true);
                    return;
                }

                d.row.style.transform = `translate3d(0, ${d.y - d.grab - d.base}px, 0)`;

                const box  = scrollBox(d.scroller);
                const zone = Math.max(36, Math.min(90, box.height * 0.18));
                let speed = 0;
                if (d.y < box.top + zone) {
                    const r = 1 - Math.max(0, d.y - box.top) / zone;
                    speed = -CFG.maxSpeed * r * r;
                } else if (d.y > box.bottom - zone) {
                    const r = 1 - Math.max(0, box.bottom - d.y) / zone;
                    speed = CFG.maxSpeed * r * r;
                }
                if (speed) d.scroller.scrollTop += speed;

                this.sortCheck(d.y);
                d.raf = requestAnimationFrame(step);
            };
            this.drag.raf = requestAnimationFrame(step);
        }

        sortCheck(y) {
            const { list, ph, row } = this.drag;
            const sibs = Array.from(list.children).filter(
                el => el !== row && el !== ph && el.matches && el.matches(CFG.sel.row)
            );

            let target = null;
            for (const s of sibs) {
                const b = s.getBoundingClientRect();
                if (!b.height) continue;
                if (y < b.top + b.height / 2) { target = s; break; }
            }

            if (target) {
                if (ph.nextElementSibling !== target) target.before(ph);
            } else {
                const last = sibs[sibs.length - 1];
                if (last && ph.previousElementSibling !== last) last.after(ph);
            }
        }

        /* --- drag: release --- */

        release(e) {
            const p = this.pending;
            if (!p || (e && e.pointerId !== p.id)) return;
            if (this.drag && e && e.cancelable) e.preventDefault();
            if (this.drag && e) e.stopPropagation();
            this.finish(false);
        }

        finish(aborted) {
            const p = this.pending;
            if (p) {
                clearTimeout(p.escape);
                document.removeEventListener('pointermove',   p.move, true);
                document.removeEventListener('pointerup',     p.up,   true);
                document.removeEventListener('pointercancel', p.up,   true);
                p.EATEN.forEach(t => document.removeEventListener(t, p.eat, true));
                try { p.handle.releasePointerCapture(p.id); } catch (_) {}
            }

            const d = this.drag;
            this.drag = null;
            this.pending = null;

            if (!d) return;   // was only a tap on the handle

            cancelAnimationFrame(d.raf);
            document.documentElement.classList.remove('tm-drag-on');

            const { row, ph, list } = d;
            row.classList.remove('tm-dragging');
            ['transform','top','left','width'].forEach(k => row.style.removeProperty(k));
            row.style.removeProperty('--tm-bg');
            row.style.removeProperty('--tm-w');

            if (ph.isConnected) {
                if (aborted) ph.remove();
                else ph.replaceWith(row);
            }

            // A HeadlessUI popover closes when focus escapes it. Put it back.
            requestAnimationFrame(() => {
                const active = document.activeElement;
                if (active && active !== document.body) return;
                const target = row.isConnected ? row : (p && p.wasFocused);
                try { if (target && target.isConnected) target.focus({ preventScroll: true }); } catch (_) {}
            });

            shieldClicks();

            if (!aborted && list.isConnected) {
                this.saveOrder(list, rowName(row));
                this.queueApply(list, CFG.flipMs);
            }
        }

        /* --- live kill switch --- */

        kill() {
            this.dead = true;
            this.finish(true);
            this.observers.forEach(o => { try { o.disconnect(); } catch (_) {} });
            this.intervals.forEach(i => clearInterval(i));
            document.querySelectorAll('.tm-handle, .tm-pinbar, .tm-ph').forEach(el => el.remove());
            const css = document.getElementById('tm-sorter-v10-css');
            if (css) css.remove();
            console.warn('[tm-sorter] stopped. Reload to start it again.');
            return 'stopped';
        }
    }

    /* ------------------------------------------------- folder open/closed */

    class StateKeeper {
        constructor() {
            this.busy = false;
            this.timer = null;
            this.sweep();
            new MutationObserver(() => {
                clearTimeout(this.timer);
                this.timer = setTimeout(() => this.sweep(), 100);
            }).observe(document.body, { childList: true, subtree: true });
        }

        sweep() {
            if (window.__tmSorter && (window.__tmSorter.drag || window.__tmSorter.dead)) return;
            document.querySelectorAll(CFG.sel.header).forEach(h => this.init(h));
        }

        init(header) {
            if (header.dataset.tmState) return;
            header.dataset.tmState = '1';

            const title = normTitle(header.textContent);
            if (!title) { delete header.dataset.tmState; return; }

            const all   = Store.read(CFG.keyState, {}) || {};
            const saved = all[title];
            const open  = header.getAttribute('aria-expanded') === 'true';

            if (saved !== undefined && saved !== open && !this.busy) {
                this.busy = true;
                header.click();
                setTimeout(() => { this.busy = false; }, 120);
            }

            header.addEventListener('click', () => {
                setTimeout(() => {
                    if (this.busy) return;
                    const next = Store.read(CFG.keyState, {}) || {};
                    next[title] = header.getAttribute('aria-expanded') === 'true';
                    Store.write(CFG.keyState, next);
                }, 60);
            });
        }
    }

    /* ------------------------------------------------------------- boot */

    const sorter = new Sorter();
    window.__tmSorter = sorter;
    new StateKeeper();

    window.tmSorter = {
        dump:  () => Store.read(CFG.keyOrder, null),
        apply: () => sorter.scan(),
        float: (v) => (v === undefined) ? sorter.book.float() : sorter.setFloat(!!v),
        off:   () => sorter.kill(),
        debug: () => Array.from(document.querySelectorAll('[data-tm-sort="10"]')).map(l => ({
            group: listKey(l),
            floatOn: sorter.book.float(),
            pins: sorter.book.pins(listKey(l)),
            resting: sorter.book.get(listKey(l)),
            onScreen: rowsOf(l).map(r => (isOn(r) ? 'ON   ' : 'off  ') + rowName(r))
        })),
        reset: () => { sorter.book.wipe(); location.reload(); }
    };

    console.log('[tm-sorter] v10 ready');
})();
