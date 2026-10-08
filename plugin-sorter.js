/* ============================================================================
 * TypingMind - Plugin Sorter  (V14)
 * ----------------------------------------------------------------------------
 * Drag to reorder plugins in the plugin menu. Built touch-first.
 *
 * WHAT V14 CHANGES
 *  1. No more auto-ranking. TypingMind now lists switched-on plugins and
 *     skills in a section of its own, so switching one on or off no longer
 *     moves it. Your drag order is the only order, and a plugin you drag
 *     while it's switched on stays where you drop it.
 *  2. Fixed: two drops less than half a second apart stranded a click blocker
 *     on the page, and nothing could be clicked until a reload.
 *  3. If an older copy (V13) is still installed, V14 stops it instead of
 *     fighting it over the same lists.
 *  4. Section memory never touches the plugin menu's own button. If the new
 *     Enabled section has no collapsible header, V13 could mistake that
 *     button for a section header and open or shut the menu by itself.
 *  Your saved drag order carries over. Drag, touch and the rest of the
 *  section memory are unchanged from V13.
 *
 * SECTION OPEN/CLOSED MEMORY (from V13, unchanged)
 *  V12 corrected sections too late and you saw them flash open first:
 *    120ms debounce -> 60ms stagger per section -> HeadlessUI collapse
 *    animation. Half a second of visible wrongness.
 *
 *  V13 kills all three:
 *   1. A section is now corrected in the SAME task the DOM adds it, straight
 *      out of the MutationObserver callback with no timer. That callback runs
 *      before the browser paints, and a click is a discrete React event, so
 *      the collapse is flushed in the same frame. Nothing renders open.
 *   2. Transitions and animations are suppressed on that section while the
 *      correction lands, so there is no collapse animation to watch.
 *   3. The panel is hidden outright for the two frames the correction takes,
 *      as insurance if a paint sneaks in. Cleared automatically after 350ms
 *      and swept every heartbeat, so nothing can stay hidden.
 *  The old debounced sweep and 1.5s heartbeat stay as the slow backstop for
 *  late React re-renders.
 *
 *  IF IT STILL FLASHES, turn the whole thing off and get native behaviour:
 *      tmSorter.sections(false)     // persists, takes effect immediately
 *      tmSorter.sections(true)      // back on
 *  Or set CFG.rememberSections to false below. Sorting keeps working either
 *  way.
 *
 * THE SORTING BEHAVIOUR
 *  No injected UI beyond the drag handles. One saved order per section, and
 *  only your drags edit it. Every plugin gets a slot the first time it's
 *  seen, next to the row it rendered beside, so a plugin that leaves a list
 *  and comes back lands in its own slot instead of at the bottom.
 *
 * WHY V9 IS DEAD (kept as a warning)
 *  V9 watched attribute mutations on the list, and its pill wrote an attribute
 *  on every repaint. Observer -> repaint -> attribute write -> observer, an
 *  infinite microtask loop that froze the whole page, touch included. V10+
 *  observe childList only and carry rate guards that back off instead of
 *  spinning.
 *
 * Console: tmSorter.dump() / .apply() / .sections(bool) / .headers()
 *          .states() / .debug() / .off() / .reset()
 * ========================================================================== */
(() => {
    'use strict';

    if (window.__tmSorterV14) return;
    window.__tmSorterV14 = true;
    window.__tmSorterV13 = true;   // a V13 copy that loads after this one bails out

    const CFG = {
        keyOrder:    'tm_plugin_sort_v9',           // your order lives here
        keyV8:       'tm_plugin_sort_v8',
        keyLegacy:   'tm_plugin_sort_v5_order',
        keyState:    'tm_plugin_sort_v5_toggles',   // section open/closed states
        keySections: 'tm_plugin_sections_on',       // section memory on/off
        sel: {
            header: 'button[id^="headlessui-disclosure-button"]',
            row:    '[role="menuitem"]',
            name:   '.truncate',
            switch: '[role="switch"]'
        },
        threshold:   5,     // px before a press becomes a drag
        sweepMs:     2000,  // sorter watchdog re-scan
        stateMs:     1500,  // section-state heartbeat
        settleMs:    90,    // debounce after TypingMind mutates a list
        dropMs:      170,   // re-check the order this long after a drop
        clickShield: 450,   // how long to swallow the post-drop click
        maxSpeed:    14,    // autoscroll px/frame at the edge
        burstMax:    120,   // observer callbacks per second before backing off
        fastMax:     30,    // pre-paint restores per second before backing off
        hideMs:      350,   // hard ceiling on the anti-flash hide
        rememberSections: true
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

    const sectionsOn = () =>
        CFG.rememberSections && Store.read(CFG.keySections, true) !== false;

    class OrderBook {
        constructor() {
            let data = Store.read(CFG.keyOrder, null);
            if (!data) {
                const v8 = Store.read(CFG.keyV8, null);
                const v5 = Store.read(CFG.keyLegacy, null);
                data = {
                    groups: (v8 && v8.groups) || {},
                    legacy: (v8 && v8.legacy) || (v5 && v5.order) || []
                };
                Store.write(CFG.keyOrder, data);
            }
            this.data = data;
        }

        // always re-read so a second tab can't clobber us
        fresh() {
            const d = Store.read(CFG.keyOrder, this.data) || this.data;
            d.groups = d.groups || {};
            d.legacy = d.legacy || [];
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

        wipe() {
            this.data = { groups: {}, legacy: [] };
            Store.write(CFG.keyOrder, this.data);
        }
    }

    /* ---------------------------------------------------------------- utils */

    const normTitle = (t) => (t || '')
        .replace(/\s+/g, ' ')
        .replace(/\(\s*\d+\s*\)/g, '')   // strip "(12)" style counters
        .replace(/\s\d+\s*$/, '')        // strip a trailing bare count
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

    /* ------------------------------------------------- section header finding */

    function isExpander(el) {
        if (!el || el.nodeType !== 1 || !el.isConnected) return false;
        if (!el.hasAttribute('aria-expanded')) return false;
        const role = el.getAttribute('role');
        if (role === 'switch' || role === 'combobox' || role === 'textbox') return false;
        if (el.closest(CFG.sel.row)) return false;
        return true;
    }

    // A button that opens a popup, like the plugin menu's own button, is never
    // a section. It can sit right above a list that has no header of its own
    // (TypingMind's Enabled section, if it has none), and remembering it like
    // a section makes the menu open or shut by itself. Section memory skips
    // these. Group keys still use isExpander, so no saved order moves.
    function isSection(el) {
        return isExpander(el) && !el.hasAttribute('aria-haspopup') &&
            !/^headlessui-(menu|popover|listbox|combobox)-button/.test(el.id || '');
    }

    function expanderFor(list) {
        if (list.__tmHeader && list.__tmHeader.isConnected) return list.__tmHeader;
        let node = list;
        for (let i = 0; node && node !== document.body && i < 8; i++) {
            const prev = node.previousElementSibling;
            if (prev) {
                if (isExpander(prev)) { list.__tmHeader = prev; return prev; }
                const inner = prev.querySelector('[aria-expanded]');
                if (isExpander(inner)) { list.__tmHeader = inner; return inner; }
            }
            node = node.parentElement;
        }
        return null;
    }

    // The other sections beside this one. Their lists are not in the DOM while
    // collapsed, so they can't be found any other way.
    function siblingExpanders(header) {
        const out = [];
        const section = (header.parentElement && header.parentElement !== document.body)
            ? header.parentElement : null;
        const wrap = section && section.parentElement;
        if (!wrap) return out;
        for (const c of wrap.children) {
            if (isExpander(c)) { out.push(c); continue; }
            const b = c.querySelector && c.querySelector('[aria-expanded]');
            if (isExpander(b)) out.push(b);
        }
        return out;
    }

    function panelHeaders() {
        const found = new Set();

        document.querySelectorAll(CFG.sel.header).forEach(b => {
            if (isExpander(b)) found.add(b);
        });

        const lists = new Set();
        document.querySelectorAll(CFG.sel.row).forEach(r => {
            if (r.querySelector(CFG.sel.switch) && r.parentElement) lists.add(r.parentElement);
        });
        lists.forEach(l => {
            const h = expanderFor(l);
            if (!isSection(h)) return;
            found.add(h);
            siblingExpanders(h).forEach(s => found.add(s));
        });

        return Array.from(found).filter(isSection);
    }

    // Stable-ish name for a section. Falls back through aria-label, title, then
    // wrapper text with plugin rows stripped, so a chevron-only header still
    // gets a key instead of being dropped.
    function headerKey(h) {
        let t = normTitle(h.textContent);
        if (!t) t = normTitle(h.getAttribute('aria-label') || '');
        if (!t) t = normTitle(h.getAttribute('title') || '');
        if (!t && h.parentElement) {
            try {
                const clone = h.parentElement.cloneNode(true);
                clone.querySelectorAll(CFG.sel.row).forEach(n => n.remove());
                t = normTitle(clone.textContent).slice(0, 60);
            } catch (_) {}
        }
        return t;
    }

    // The collapsible body belonging to a header, when we can name it with
    // confidence. Used only for the anti-flash hide.
    function panelFor(h) {
        const next = h.nextElementSibling;
        if (!next || next.nodeType !== 1) return null;
        if ((next.id || '').indexOf('headlessui-disclosure-panel') === 0) return next;
        if (next.querySelector && next.querySelector(CFG.sel.row)) return next;
        if (next.matches && next.matches(CFG.sel.row)) return next;
        return null;
    }

    // Group key = the disclosure header this list sits under, else "root".
    function listKey(list) {
        const h = expanderFor(list);
        if (h) {
            const t = headerKey(h);
            if (t) return 'g:' + t;
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
    // its slot. That way a plugin hidden by search, or moved out of the list by
    // TypingMind, still has its place when it comes back.
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

    // One shared listener. Adding the same function twice is a no-op, so a
    // second drop inside the window can't strand a copy that eats every click
    // (V13 made a fresh one per drop and lost track of the first).
    const eatClick = (e) => { e.stopPropagation(); e.preventDefault(); };
    const SHIELDED = ['click', 'auxclick', 'contextmenu'];
    let shieldTimer = null;
    function shieldClicks() {
        SHIELDED.forEach(t => document.addEventListener(t, eatClick, true));
        clearTimeout(shieldTimer);
        shieldTimer = setTimeout(() => {
            SHIELDED.forEach(t => document.removeEventListener(t, eatClick, true));
        }, CFG.clickShield);
    }

    /* --------------------------------------------------------------- sorter */

    class Sorter {
        constructor() {
            this.book = new OrderBook();
            this.pending = null;
            this.drag = null;
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
            if (document.getElementById('tm-sorter-v14-css')) return;
            const s = document.createElement('style');
            s.id = 'tm-sorter-v14-css';
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

/* anti-flash, both cleared within ~350ms of a section being corrected */
.tm-nofx,.tm-nofx *{
  transition:none !important;
  animation:none !important;
}
.tm-prehide{display:none !important;}

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
  .tm-handle{transition:none;}
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
                document.querySelectorAll('.tm-pinbar').forEach(el => el.remove()); // V10 leftovers
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
                if (l.dataset.tmSort === '14') {
                    this.addHandles(l);
                    this.queueApply(l);
                } else {
                    this.initList(l);
                }
            });
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

        // Backs off instead of spinning. Nothing here can lock the main thread
        // even if TypingMind goes mutation-crazy.
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
            list.dataset.tmSort = '14';
            this.addHandles(list);
            this.seedOrder(list);     // give every row a slot before anything moves
            this.applyOrder(list);

            // childList only. Identical to V8. No attributes, no subtree.
            const ob = new MutationObserver(() => {
                if (this.drag || this.dead) return;
                if (this.applying.has(list)) return;
                if (!this.budgetOk(list)) return;
                this.addHandles(list);
                this.queueApply(list);
            });
            ob.observe(list, { childList: true });
            this.observers.push(ob);
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

        /* --- slots in the saved order ------------------------------------- */

        // Every visible row must own a slot in the saved order, otherwise a
        // plugin that leaves the list and comes back has nowhere to land. New
        // names are slotted next to the row they rendered beside, never dumped
        // at the end.
        seedOrder(list) {
            const key   = listKey(list);
            const saved = this.book.get(key).slice();
            const have  = new Set(saved);

            const names = rowsOf(list).map(rowName).filter(Boolean);
            if (!names.length) return false;
            if (!names.some(n => !have.has(n))) return false;

            names.forEach((name, i) => {
                if (have.has(name)) return;

                let at = -1;
                for (let j = i + 1; j < names.length; j++) {           // nearest known row below
                    if (have.has(names[j])) { at = saved.indexOf(names[j]); break; }
                }
                if (at < 0) {
                    for (let j = i - 1; j >= 0; j--) {                 // else nearest known row above
                        if (have.has(names[j])) { at = saved.indexOf(names[j]) + 1; break; }
                    }
                }
                if (at < 0) at = saved.length;

                saved.splice(at, 0, name);
                have.add(name);
            });

            this.book.set(key, saved);
            return true;
        }

        /* --- persistence --- */

        applyOrder(list) {
            if (this.drag || this.dead || !list.isConnected) return;

            // runaway guard: if React keeps re-rendering and fighting us, pause
            const now = Date.now();
            const t = this.throttle.get(list) || { n: 0, at: now, until: 0 };
            if (now < t.until) return;
            if (now - t.at > 3000) { t.n = 0; t.at = now; }

            const rows = rowsOf(list);
            if (rows.length < 2) return;

            this.seedOrder(list);

            const saved = this.book.get(listKey(list));
            if (!saved.length) return;

            const idx = new Map(saved.map((n, i) => [n, i]));
            const FAR = 1e6;

            const meta = rows.map((r, i) => {
                const name = rowName(r);
                return { r, b: (name && idx.has(name)) ? idx.get(name) : FAR + i };
            });

            const want = meta.slice().sort((a, b) => a.b - b.b).map(m => m.r);   // your drag order

            let same = true;
            for (let i = 0; i < rows.length; i++) if (rows[i] !== want[i]) { same = false; break; }
            if (same) return;

            t.n++;
            if (t.n > 10) { t.until = now + 5000; t.n = 0; t.at = now; }
            this.throttle.set(list, t);
            if (t.until > now) return;

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

        // The visible rows, in the order you just left them. Anything not on
        // screen keeps its slot.
        saveOrder(list) {
            const names = rowsOf(list).map(rowName).filter(Boolean);
            if (!names.length) return;

            const key = listKey(list);
            this.book.set(key, mergeOrder(this.book.get(key), names));
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
                this.saveOrder(list);
                this.queueApply(list, CFG.dropMs);
            }
        }

        /* --- live kill switch --- */

        kill() {
            this.dead = true;
            this.finish(true);
            this.observers.forEach(o => { try { o.disconnect(); } catch (_) {} });
            this.intervals.forEach(i => clearInterval(i));
            document.querySelectorAll('.tm-handle, .tm-ph, .tm-pinbar').forEach(el => el.remove());
            document.querySelectorAll('.tm-prehide').forEach(el => el.classList.remove('tm-prehide'));
            document.querySelectorAll('.tm-nofx').forEach(el => el.classList.remove('tm-nofx'));
            const css = document.getElementById('tm-sorter-v14-css');
            if (css) css.remove();
            console.warn('[tm-sorter] stopped. Reload to start it again.');
            return 'stopped';
        }
    }

    /* --------------------------------------- section open/closed memory (V13) */

    class StateKeeper {
        constructor(sorter) {
            this.sorter = sorter;
            this.timer = null;
            this.rate = { n: 0, at: 0 };

            this.sweep();

            const ob = new MutationObserver((muts) => {
                const s = this.sorter;
                if (s.dead || s.drag || !sectionsOn()) return;

                let hit = false;
                for (const m of muts) {
                    for (const n of m.addedNodes) {
                        if (n.nodeType !== 1) continue;
                        if ((n.matches && n.matches('[aria-expanded]')) ||
                            (n.querySelector && n.querySelector('[aria-expanded]'))) { hit = true; break; }
                    }
                    if (hit) break;
                }

                // Same task the section was added, before the browser paints.
                // This is the whole anti-flash trick.
                if (hit && this.rateOk()) this.fast();

                clearTimeout(this.timer);
                this.timer = setTimeout(() => this.sweep(), 120);
            });
            ob.observe(document.body, { childList: true, subtree: true });
            sorter.observers.push(ob);

            // heartbeat: a busy DOM keeps resetting the debounce above
            sorter.intervals.push(setInterval(() => this.sweep(), CFG.stateMs));

            window.addEventListener('focus', () => this.sweep());
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden) this.sweep();
            });
        }

        map()      { return Store.read(CFG.keyState, {}) || {}; }
        save(k, v) { const m = this.map(); m[k] = v; Store.write(CFG.keyState, m); }

        rateOk() {
            const now = Date.now();
            if (now - this.rate.at > 1000) this.rate = { n: 0, at: now };
            this.rate.n++;
            return this.rate.n <= CFG.fastMax;
        }

        // Cheap, key-driven, runs pre-paint. Only touches headers whose name is
        // already in the saved map, which means a header we bound and you
        // collapsed yourself at some point.
        fast() {
            const map = this.map();
            document.querySelectorAll('[aria-expanded]').forEach(h => {
                if (!isSection(h)) return;
                const key = h.__tmKey || headerKey(h);
                if (!key || !(key in map)) return;
                h.__tmKey = key;
                if (this.needs(h)) this.restore(h);
            });
        }

        // Full pass: discovery, binding, and a backstop restore.
        sweep() {
            const s = this.sorter;
            if (s.dead || s.drag) return;

            // never let an anti-flash hide outlive its welcome
            const now = Date.now();
            document.querySelectorAll('.tm-prehide').forEach(el => {
                if (now - Number(el.dataset.tmHideAt || 0) > CFG.hideMs) this.reveal(el);
            });

            if (!sectionsOn()) return;

            panelHeaders().forEach(h => {
                const key = headerKey(h);
                if (!key) return;
                h.__tmKey = key;
                this.bind(h);
                if (this.needs(h)) this.restore(h);
            });
        }

        bind(h) {
            if (h.__tmBound) return;
            h.__tmBound = true;

            // capture phase, so a stopPropagation upstream can't hide the tap
            h.addEventListener('click', () => {
                if (h.__tmProg) return;      // that was us, not you
                h.__tmUser = Date.now();
                h.__tmTries = 0;
                const grab = () => {
                    if (!h.isConnected || !h.__tmKey) return;
                    this.save(h.__tmKey, h.getAttribute('aria-expanded') === 'true');
                };
                setTimeout(grab, 90);        // fast path
                setTimeout(grab, 400);       // and again, in case the render lagged
            }, true);
        }

        needs(h) {
            const want = this.map()[h.__tmKey];
            if (want === undefined) return false;
            if (h.__tmProg) return false;
            if (h.__tmUser && Date.now() - h.__tmUser < 1200) return false;  // hands off
            if ((h.__tmTries || 0) >= 3) return false;
            return (h.getAttribute('aria-expanded') === 'true') !== want;
        }

        reveal(el) {
            el.classList.remove('tm-prehide');
            delete el.dataset.tmHideAt;
        }

        restore(h) {
            if (!h.isConnected || !this.needs(h)) return;
            h.__tmTries = (h.__tmTries || 0) + 1;
            h.__tmProg = true;

            const box = h.parentElement || h;
            box.classList.add('tm-nofx');           // no collapse animation to watch

            // if it should be closed, hide the body outright for the couple of
            // frames the correction takes
            let panel = null;
            if (this.map()[h.__tmKey] === false) {
                panel = panelFor(h);
                if (panel) {
                    panel.classList.add('tm-prehide');
                    panel.dataset.tmHideAt = String(Date.now());
                }
            }

            try { h.click(); } catch (_) {}

            const done = () => {
                h.__tmProg = false;
                box.classList.remove('tm-nofx');
                if (panel && panel.classList.contains('tm-prehide')) this.reveal(panel);
            };
            requestAnimationFrame(() => requestAnimationFrame(done));
            setTimeout(done, CFG.hideMs);           // hard ceiling, always fires
        }
    }

    /* ------------------------------------------------------------- boot */

    // An older copy that is still running would fight this one over the same
    // lists, re-ranking plugins this one just put back. Stop it first.
    const older = window.__tmSorter;
    if (older && typeof older.kill === 'function' && !older.dead) {
        try { older.kill(); } catch (_) {}
        console.warn('[tm-sorter] stopped an older copy. Remove it from your extensions.');
    }

    const sorter = new Sorter();
    window.__tmSorter = sorter;
    const keeper = new StateKeeper(sorter);

    window.tmSorter = {
        dump:  () => Store.read(CFG.keyOrder, null),
        apply: () => { sorter.scan(); keeper.sweep(); },
        off:   () => sorter.kill(),
        sections: (v) => {
            if (v === undefined) return sectionsOn();
            Store.write(CFG.keySections, !!v);
            if (v) keeper.sweep();
            else document.querySelectorAll('.tm-prehide, .tm-nofx').forEach(el =>
                el.classList.remove('tm-prehide', 'tm-nofx'));
            return !!v;
        },
        states: () => Store.read(CFG.keyState, {}),
        headers: () => panelHeaders().map(h => ({
            key:   headerKey(h),
            live:  h.getAttribute('aria-expanded') === 'true' ? 'open' : 'closed',
            saved: (() => {
                const v = (Store.read(CFG.keyState, {}) || {})[headerKey(h)];
                return v === undefined ? 'nothing saved' : (v ? 'open' : 'closed');
            })(),
            tries: h.__tmTries || 0,
            el:    h
        })),
        debug: () => Array.from(document.querySelectorAll('[data-tm-sort="14"]')).map(l => ({
            group:    listKey(l),
            saved:    sorter.book.get(listKey(l)),
            onScreen: rowsOf(l).map(rowName)
        })),
        reset: () => { sorter.book.wipe(); location.reload(); }
    };

    console.log('[tm-sorter] v14 ready');
})();
