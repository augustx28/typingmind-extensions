/* ============================================================================
 * TypingMind – Mobile-Ready Plugin Sorter (V6: Smooth Mobile Scroll)
 * ========================================================================== */
(() => {
    const CONFIG = {
        key_order: 'tm_plugin_sort_v5_order',
        key_state: 'tm_plugin_sort_v5_toggles',
        selectors: {
            header: 'button[id^="headlessui-disclosure-button"]',
            row: '[role="menuitem"]',
            name: '.truncate',
            requiredElement: '[role="switch"]'
        }
    };

    /* --- STORAGE HELPER --- */
    class Store {
        constructor(key) { this.key = key; }
        get() { try { return JSON.parse(localStorage.getItem(this.key)) || {}; } catch(e){ return {}; } }
        save(data) { localStorage.setItem(this.key, JSON.stringify(data)); }
    }

    /* --- MODULE 1: FOLDER STATE KEEPER --- */
    class StateKeeper {
        constructor() {
            this.store = new Store(CONFIG.key_state);
            this.observe();
        }

        observe() {
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((m) => {
                    m.addedNodes.forEach((n) => {
                        if (n.nodeType === 1) {
                            const headers = n.querySelectorAll ? n.querySelectorAll(CONFIG.selectors.header) : [];
                            headers.forEach(h => this.initHeader(h));
                        }
                    });
                });
            });
            observer.observe(document.body, { childList: true, subtree: true });
        }

        initHeader(header) {
            if (header.dataset.tmStateInit) return;
            header.dataset.tmStateInit = 'true';

            const title = header.textContent.trim();
            if (!title) return;

            const savedState = this.store.get()[title];
            const isOpen = header.getAttribute('aria-expanded') === 'true';

            if (savedState !== undefined && savedState !== isOpen) {
                header.click();
            }

            header.addEventListener('click', () => {
                setTimeout(() => {
                    const newState = header.getAttribute('aria-expanded') === 'true';
                    const allStates = this.store.get();
                    allStates[title] = newState;
                    this.store.save(allStates);
                }, 50);
            });
        }
    }

    /* --- MODULE 2: DRAG & DROP SORTER --- */
    class PluginSorter {
        constructor() {
            this.orderStore = new Store(CONFIG.key_order);
            this.drag = null;
            this._scrollRAF = null;
            this._scrollSpeed = 0;
            this.injectStyles();
            this.startObserver();
        }

        injectStyles() {
            if (document.getElementById('tm-v6-css')) return;
            const style = document.createElement('style');
            style.id = 'tm-v6-css';
            style.textContent = `
                /* ALIGNMENT FIX */
                [role="menuitem"] .flex.items-center.justify-center.gap-2.truncate {
                    justify-content: flex-start !important;
                    margin-right: auto !important;
                    flex-grow: 0 !important;
                    width: auto !important;
                }
                /* HANDLE */
                .tm-handle {
                    cursor: grab;
                    padding: 4px 8px 4px 0px;
                    touch-action: none;
                    display: flex;
                    align-items: center;
                    color: #94a3b8;
                    flex-shrink: 0;
                    height: 100%;
                    -webkit-user-select: none;
                    user-select: none;
                }
                .tm-handle:active { color: #3b82f6; cursor: grabbing; }

                /* DRAGGING VISUALS */
                .tm-placeholder {
                    background: rgba(59, 130, 246, 0.05);
                    border: 1px dashed rgba(59, 130, 246, 0.4);
                    border-radius: 8px;
                    margin: 4px 0;
                    flex-shrink: 0;
                }
                .tm-dragging {
                    position: fixed !important;
                    z-index: 9999 !important;
                    opacity: 0.95;
                    transform: scale(1.02);
                    box-shadow: 0 10px 20px -5px rgba(0, 0, 0, 0.4);
                    width: var(--drag-width) !important;
                    background: var(--drag-bg, #1e293b);
                    pointer-events: none;
                    border-radius: 8px;
                    border: 1px solid rgba(255,255,255,0.1);
                    will-change: top, left;
                }
                /* Kill body scroll while dragging on mobile */
                body.tm-drag-active {
                    overflow: hidden !important;
                    touch-action: none !important;
                }
            `;
            document.head.appendChild(style);
        }

        startObserver() {
            new MutationObserver((mutations) => {
                mutations.forEach(m => {
                    m.addedNodes.forEach(n => {
                        if (n.nodeType !== 1) return;

                        const items = n.querySelectorAll ? n.querySelectorAll(CONFIG.selectors.row) : [];
                        if (items.length === 0) return;

                        const lists = new Set();
                        items.forEach(item => {
                            if (item.querySelector(CONFIG.selectors.requiredElement)) {
                                if (item.parentElement) lists.add(item.parentElement);
                            }
                        });

                        lists.forEach(list => this.initList(list));
                    });
                });
            }).observe(document.body, { childList: true, subtree: true });
        }

        initList(list) {
            if (list.dataset.tmSortInit) return;
            list.dataset.tmSortInit = 'true';

            this.refreshHandles(list);
            this.applySavedOrder(list);

            new MutationObserver(() => this.refreshHandles(list)).observe(list, { childList: true });
        }

        refreshHandles(list) {
            const rows = list.querySelectorAll(`:scope > ${CONFIG.selectors.row}`);
            rows.forEach(row => {
                if (!row.querySelector(CONFIG.selectors.requiredElement)) return;
                this.addHandle(row);
            });
        }

        addHandle(row) {
            if (row.querySelector('.tm-handle')) return;
            const wrapper = row.firstElementChild;
            if (!wrapper) return;

            const handle = document.createElement('div');
            handle.className = 'tm-handle';
            handle.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h.01M8 12h.01M8 18h.01M16 6h.01M16 12h.01M16 18h.01" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
            handle.onpointerdown = (e) => this.dragStart(e, row);
            wrapper.prepend(handle);
        }

        /* --- DRAG LOGIC --- */
        dragStart(e, row) {
            e.preventDefault();
            const list = row.parentElement;
            if (e.target.setPointerCapture) e.target.setPointerCapture(e.pointerId);

            // Lock body scroll on mobile
            document.body.classList.add('tm-drag-active');

            const rect = row.getBoundingClientRect();

            const placeholder = document.createElement('div');
            placeholder.className = 'tm-placeholder';
            placeholder.style.height = `${rect.height}px`;
            row.before(placeholder);

            const bg = window.getComputedStyle(row).backgroundColor;
            row.style.setProperty('--drag-bg', bg === 'rgba(0, 0, 0, 0)' ? '#1f2937' : bg);
            row.style.setProperty('--drag-width', `${rect.width}px`);
            row.classList.add('tm-dragging');

            // Find the scrollable ancestor once
            const scrollParent = list.closest('.overflow-y-auto, [style*="overflow"]') || list;

            this.drag = {
                row, list, placeholder, scrollParent,
                offsetY: e.clientY - rect.top,
                startX: rect.left
            };

            this.updatePosition(e.clientY);

            this._scrollSpeed = 0;
            this._startScrollLoop();

            this.drag.moveFn = (ev) => this.dragMove(ev);
            this.drag.upFn = (ev) => this.dragEnd(ev);

            document.addEventListener('pointermove', this.drag.moveFn, { passive: false });
            document.addEventListener('pointerup', this.drag.upFn);
            document.addEventListener('pointercancel', this.drag.upFn);
        }

        dragMove(e) {
            if (!this.drag) return;
            e.preventDefault();
            this.updatePosition(e.clientY);
            this.checkSort(e.clientY);
            this._computeScrollSpeed(e.clientY);
        }

        updatePosition(y) {
            const { row, offsetY, startX } = this.drag;
            row.style.top = `${y - offsetY}px`;
            row.style.left = `${startX}px`;
        }

        /* --- RAF AUTO-SCROLL (decoupled from pointermove) --- */

        _computeScrollSpeed(y) {
            // Calculates desired scroll speed based on pointer distance from edge.
            // Stored as a value; the RAF loop applies it at a steady rate.
            const { scrollParent } = this.drag;
            if (!scrollParent) { this._scrollSpeed = 0; return; }

            const r = scrollParent.getBoundingClientRect();
            const edgeZone = 70;    // px from edge where scrolling activates
            const maxSpeed = 6;     // max px per frame (~360px/sec at 60fps)

            if (y < r.top + edgeZone) {
                // Scrolling up: closer to edge = faster (negative)
                const ratio = 1 - Math.max(0, y - r.top) / edgeZone;
                this._scrollSpeed = -maxSpeed * this._ease(ratio);
            } else if (y > r.bottom - edgeZone) {
                // Scrolling down: closer to edge = faster (positive)
                const ratio = 1 - Math.max(0, r.bottom - y) / edgeZone;
                this._scrollSpeed = maxSpeed * this._ease(ratio);
            } else {
                this._scrollSpeed = 0;
            }
        }

        _ease(t) {
            // Quadratic ease-in: slow start, accelerates toward edge
            return t * t;
        }

        _startScrollLoop() {
            if (this._scrollRAF) return;

            const tick = () => {
                if (!this.drag) {
                    this._scrollRAF = null;
                    return;
                }

                if (this._scrollSpeed !== 0) {
                    this.drag.scrollParent.scrollTop += this._scrollSpeed;
                }

                this._scrollRAF = requestAnimationFrame(tick);
            };

            this._scrollRAF = requestAnimationFrame(tick);
        }

        _stopScrollLoop() {
            if (this._scrollRAF) {
                cancelAnimationFrame(this._scrollRAF);
                this._scrollRAF = null;
            }
            this._scrollSpeed = 0;
        }

        /* --- SORT CHECK --- */
        checkSort(y) {
            const { list, placeholder } = this.drag;
            const siblings = [...list.querySelectorAll(`:scope > ${CONFIG.selectors.row}:not(.tm-dragging)`)];

            const nextSibling = siblings.find(sibling => {
                const box = sibling.getBoundingClientRect();
                return y < box.top + (box.height / 2);
            });

            if (nextSibling) nextSibling.before(placeholder);
            else list.appendChild(placeholder);
        }

        /* --- DRAG END --- */
        dragEnd(e) {
            if (!this.drag) return;
            const { row, placeholder, list, moveFn, upFn } = this.drag;

            document.removeEventListener('pointermove', moveFn);
            document.removeEventListener('pointerup', upFn);
            document.removeEventListener('pointercancel', upFn);

            // Unlock body scroll
            document.body.classList.remove('tm-drag-active');

            this._stopScrollLoop();

            placeholder.replaceWith(row);
            row.classList.remove('tm-dragging');
            row.style.removeProperty('top');
            row.style.removeProperty('left');
            row.style.removeProperty('width');

            this.saveOrder(list);
            this.drag = null;
        }

        saveOrder(list) {
            let globalOrder = this.orderStore.get().order || [];

            const currentNames = [...list.querySelectorAll(CONFIG.selectors.row)]
                .map(r => r.querySelector(CONFIG.selectors.name)?.textContent?.trim())
                .filter(Boolean);

            globalOrder = globalOrder.filter(n => !currentNames.includes(n));
            globalOrder.push(...currentNames);

            this.orderStore.save({ order: globalOrder });
        }

        applySavedOrder(list) {
            const savedData = this.orderStore.get();
            const globalOrder = savedData.order || [];
            if (!globalOrder.length) return;

            const items = [...list.querySelectorAll(`:scope > ${CONFIG.selectors.row}`)];
            const map = new Map(items.map(i => [i.querySelector(CONFIG.selectors.name)?.textContent?.trim(), i]));

            globalOrder.forEach(name => {
                const el = map.get(name);
                if (el) list.appendChild(el);
            });
        }
    }

    new StateKeeper();
    new PluginSorter();
})();
