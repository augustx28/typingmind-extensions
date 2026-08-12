/* ============================================================================
 * TypingMind - Plugin Sorter  (V8)
 * ----------------------------------------------------------------------------
 * Drag to reorder plugins in the plugin menu. Built touch-first.
 *
 * FIXED vs V7
 *  1. Menu closing mid-drag on phone
 *     - Every drag event is handled in the CAPTURE phase and stopped there, so
 *       HeadlessUI never sees the pointer sliding across its menu items.
 *     - The synthetic "click" that fires when you lift your finger is
 *       swallowed, so letting go on top of another row can't select it.
 *     - Focus is restored after the drop instead of dropping to <body>
 *       (focus loss is what closes a HeadlessUI popover).
 *     - Removed body{overflow:hidden}; it caused iOS scroll jumps. Page scroll
 *       is now blocked with a passive:false touchmove during the drag only.
 *  2. Order not sticking
 *     - Saved per group instead of one shared global array.
 *     - Saving MERGES into the stored list, so rows hidden by search keep
 *       their slots instead of getting shoved to the end.
 *     - Initial DOM sweep + 2s watchdog catch lists that were already on
 *       screen or that React re-rendered behind the observer's back.
 *     - Order is re-applied whenever TypingMind rebuilds a list.
 *     - Your existing V5/V7 order is migrated on first run.
 *  3. Smoothness
 *     - GPU transform instead of top/left writes.
 *     - Sorting + autoscroll run once per frame, not per pointermove.
 *     - 5px threshold so a tap on the handle isn't a micro-drag.
 *     - 44px touch target, haptic tick, reduced-motion aware.
 *
 * Console helpers: tmSorter.dump() / tmSorter.apply() / tmSorter.reset()
 * ========================================================================== */
(() => {
    'use strict';

    if (window.__tmSorterV8) return;
    window.__tmSorterV8 = true;

    const CFG = {
        keyOrder:  'tm_plugin_sort_v8',
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
        clickShield: 450,   // how long to swallow the post-drop click
        maxSpeed:    14     // autoscroll px/frame at the edge
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
                const legacy = Store.read(CFG.keyLegacy, null);
                data = { groups: {}, legacy: (legacy && legacy.order) || [] };
                Store.write(CFG.keyOrder, data);
            }
            data.groups = data.groups || {};
            data.legacy = data.legacy || [];
            this.data = data;
        }

        get(key) {
            // always read fresh so a second tab can't clobber us
            const d = Store.read(CFG.keyOrder, this.data) || this.data;
            d.groups = d.groups || {};
            d.legacy = d.legacy || [];
            this.data = d;
            const own = d.groups[key];
            return (own && own.length) ? own : d.legacy;
        }

        set(key, names) {
            const d = Store.read(CFG.keyOrder, this.data) || this.data;
            d.groups = d.groups || {};
            d.legacy = d.legacy || [];
            d.groups[key] = names;
            this.data = d;
            Store.write(CFG.keyOrder, d);
        }

        wipe() {
            this.data = { groups: {}, legacy: [] };
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
            if (n.closest('.tm-handle')) continue;
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

    // Reorder only the names that are currently visible; leave the rest parked
    // in their existing slots. This is what stops search-filtered lists from
    // scrambling the saved order.
    function mergeOrder(saved, visibleInNewOrder) {
        const visible = new Set(visibleInNewOrder);
        const out = [];
        let i = 0;
        for (const name of saved) {
            if (visible.has(name)) {
                if (i < visibleInNewOrder.length) out.push(visibleInNewOrder[i++]);
            } else {
                out.push(name);
            }
        }
        while (i < visibleInNewOrder.length) out.push(visibleInNewOrder[i++]);
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
            this.applying = new WeakSet();
            this.timers = new WeakMap();
            this.throttle = new WeakMap();

            this.injectCSS();
            this.scan();
            this.watchDOM();
            setInterval(() => this.scan(), CFG.sweepMs);

            // Re-check after tab wake / orientation change, both of which
            // routinely leave the panel re-rendered and unsorted.
            window.addEventListener('focus', () => this.scan());
            window.addEventListener('orientationchange', () => setTimeout(() => this.scan(), 250));
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden) this.scan();
            });
        }

        /* --- styles --- */
        injectCSS() {
            if (document.getElementById('tm-sorter-v8-css')) return;
            const s = document.createElement('style');
            s.id = 'tm-sorter-v8-css';
            s.textContent = `
/* keep the plugin label hard-left so the handle has room */
[role="menuitem"] .flex.items-center.justify-center.gap-2.truncate{
  justify-content:flex-start !important;
  margin-right:auto !important;
  flex-grow:0 !important;
  width:auto !important;
}

.tm-handle{
  cursor:grab;
  display:flex;
  align-items:center;
  justify-content:center;
  flex:0 0 auto;
  align-self:stretch;
  min-width:26px;
  padding:6px 6px 6px 0;
  margin-right:2px;
  color:#94a3b8;
  opacity:.65;
  touch-action:none;
  -webkit-user-select:none;
  user-select:none;
  -webkit-touch-callout:none;
  -webkit-tap-highlight-color:transparent;
  transition:opacity .12s ease,color .12s ease;
}
.tm-handle:hover{opacity:1;}
.tm-handle:active{color:#3b82f6;opacity:1;cursor:grabbing;}
@media (pointer:coarse){
  .tm-handle{min-width:40px;min-height:44px;padding:8px 8px 8px 2px;opacity:.85;}
}

.tm-ph{
  background:rgba(59,130,246,.07);
  border:1px dashed rgba(59,130,246,.45);
  border-radius:8px;
  margin:2px 0;
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
  .tm-handle{transition:none;}
  .tm-dragging{box-shadow:0 4px 10px -4px rgba(0,0,0,.5);}
}
`;
            document.head.appendChild(s);
        }

        /* --- discovery --- */

        scan() {
            const rows = document.querySelectorAll(CFG.sel.row);
            const lists = new Set();
            rows.forEach(r => {
                if (r.querySelector(CFG.sel.switch) && r.parentElement) lists.add(r.parentElement);
            });
            lists.forEach(l => {
                if (l.dataset.tmSort === '8') {
                    this.addHandles(l);
                    this.queueApply(l);
                } else {
                    this.initList(l);
                }
            });
        }

        watchDOM() {
            new MutationObserver((muts) => {
                if (this.drag) return;
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
            }).observe(document.body, { childList: true, subtree: true });
        }

        initList(list) {
            list.dataset.tmSort = '8';
            this.addHandles(list);
            this.applyOrder(list);

            new MutationObserver(() => {
                if (this.drag) return;
                if (this.applying.has(list)) return;
                this.addHandles(list);
                this.queueApply(list);
            }).observe(list, { childList: true });
        }

        queueApply(list) {
            if (this.drag) return;
            clearTimeout(this.timers.get(list));
            this.timers.set(list, setTimeout(() => this.applyOrder(list), CFG.settleMs));
        }

        addHandles(list) {
            rowsOf(list).forEach(row => {
                if (row.querySelector(':scope > * > .tm-handle') || row.querySelector('.tm-handle')) return;
                const wrap = row.firstElementChild;
                if (!wrap) return;
                const h = document.createElement('div');
                h.className = 'tm-handle';
                h.setAttribute('aria-hidden', 'true');
                h.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M8 6h.01M8 12h.01M8 18h.01M16 6h.01M16 12h.01M16 18h.01"/></svg>';
                h.addEventListener('pointerdown', (e) => this.press(e, row));
                wrap.prepend(h);
            });
        }

        /* --- persistence --- */

        applyOrder(list) {
            if (this.drag || !list.isConnected) return;

            // runaway guard: if React keeps fighting us, back off briefly
            const t = this.throttle.get(list) || { n: 0, at: 0 };
            const now = Date.now();
            if (now - t.at > 3000) { t.n = 0; t.at = now; }
            if (++t.n > 8) { this.throttle.set(list, { n: 0, at: now + 4000 }); return; }
            this.throttle.set(list, t);

            const rows = rowsOf(list);
            if (rows.length < 2) return;

            const saved = this.book.get(listKey(list));
            if (!saved.length) return;

            const idx = new Map(saved.map((n, i) => [n, i]));
            const known = [], fresh = [];
            rows.forEach(r => {
                const n = rowName(r);
                (n && idx.has(n) ? known : fresh).push(r);
            });
            known.sort((a, b) => idx.get(rowName(a)) - idx.get(rowName(b)));
            const want = known.concat(fresh);

            let same = true;
            for (let i = 0; i < rows.length; i++) if (rows[i] !== want[i]) { same = false; break; }
            if (same) return;

            const tail = rows[rows.length - 1].nextSibling;  // keep trailing UI in place
            this.applying.add(list);
            want.forEach(el => list.insertBefore(el, tail));
            queueMicrotask(() => this.applying.delete(list));
        }

        saveOrder(list) {
            const names = rowsOf(list).map(rowName).filter(Boolean);
            if (!names.length) return;
            const key = listKey(list);
            this.book.set(key, mergeOrder(this.book.get(key), names));
        }

        /* --- drag: press --- */

        press(e, row) {
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
        }

        /* --- drag: start --- */

        begin() {
            const { row } = this.pending;
            const list = row.parentElement;
            const rect = row.getBoundingClientRect();

            const ph = document.createElement('div');
            ph.className = 'tm-ph';
            ph.style.height = rect.height + 'px';
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
                if (!active || active === document.body) {
                    try { (row.focus ? row : p && p.wasFocused)?.focus({ preventScroll: true }); } catch (_) {}
                }
            });

            shieldClicks();
            if (!aborted && list.isConnected) this.saveOrder(list);
        }
    }

    /* ------------------------------------------------- folder open/closed */

    class StateKeeper {
        constructor() {
            this.busy = false;
            this.sweep();
            new MutationObserver(() => this.sweep())
                .observe(document.body, { childList: true, subtree: true });
        }

        sweep() {
            if (window.__tmSorter && window.__tmSorter.drag) return;
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
        reset: () => { sorter.book.wipe(); location.reload(); }
    };

    console.log('[tm-sorter] v8 ready');
})();
