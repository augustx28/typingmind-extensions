/* == TypingMind | Dark Navigation Bar ==========================================
 * Darkens the strip behind Android's navigation bar in the installed app.
 *
 * Chrome 153+ fills that strip with a colour from TypingMind's manifest, which
 * is baked into the installed app. The theme-color meta tag doesn't reach it,
 * and the page can't rewrite the manifest. What the page can do is draw
 * edge-to-edge (viewport-fit=cover) so its own colour shows there instead:
 * - adds viewport-fit=cover to the viewport meta tag
 * - once Chrome reports a safe-area inset, shrinks <body> to sit clear of the
 *   system bars and paints the uncovered strip with the colour at the bottom
 *   of the app
 * - caps any full-screen container that would now run under the bar
 * If Chrome ignores viewport-fit in the installed app, every inset stays 0 and
 * the script leaves the layout alone.
 * ============================================================================ */

(() => {
  'use strict';

  if (window.__tmxNavBarInstalled) return;
  window.__tmxNavBarInstalled = true;

  const FALLBACK_COLOR = '#161616';
  const STYLE_ID = 'tmx-navbar-style';
  const PROBE_ID = 'tmx-navbar-probe';
  const ON = 'tmx-navbar-on';
  const FIT = 'data-tmx-navbar-fit';
  const MAX_DEPTH = 10;
  const DEBOUNCE_MS = 250;

  const css = `
    #${PROBE_ID} {
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      width: 0 !important;
      height: 0 !important;
      visibility: hidden !important;
      pointer-events: none !important;
      padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px)
        env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px) !important;
    }

    /* The strip outside <body> shows the root background. */
    html.${ON} {
      background-color: var(--tmx-navbar-color, ${FALLBACK_COLOR}) !important;
    }

    /* The transform makes <body> the containing block for fixed elements, so
       drawers and modals pinned to bottom: 0 stop at the bar too. */
    html.${ON} body {
      position: fixed !important;
      top: env(safe-area-inset-top, 0px) !important;
      right: env(safe-area-inset-right, 0px) !important;
      bottom: env(safe-area-inset-bottom, 0px) !important;
      left: env(safe-area-inset-left, 0px) !important;
      width: auto !important;
      height: auto !important;
      margin: 0 !important;
      overflow: hidden !important;
      transform: translateZ(0) !important;
    }
  `;

  const root = document.documentElement;
  let timer = 0;

  const injectStyle = () => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    (document.head || root).appendChild(style);
  };

  const ensureCover = () => {
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return;
    const content = meta.getAttribute('content') || '';
    if (/viewport-fit\s*=\s*cover/i.test(content)) return;
    const parts = content
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p && !/^viewport-fit\s*=/i.test(p));
    parts.push('viewport-fit=cover');
    meta.setAttribute('content', parts.join(', '));
  };

  const readInsets = () => {
    let probe = document.getElementById(PROBE_ID);
    if (!probe) {
      probe = document.createElement('div');
      probe.id = PROBE_ID;
      probe.setAttribute('aria-hidden', 'true');
      document.body.appendChild(probe);
    }
    const cs = getComputedStyle(probe);
    return [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(
      (v) => parseFloat(v) || 0
    );
  };

  const scrolls = (el) => /(auto|scroll)/.test(getComputedStyle(el).overflowY);

  const unfit = () => {
    for (const el of document.querySelectorAll(`[${FIT}]`)) {
      el.style.removeProperty('max-height');
      el.style.removeProperty('min-height');
      el.removeAttribute(FIT);
    }
  };

  // App-shell elements sized to the old full-screen height (100vh, 100dvh,
  // window.innerHeight) now hang below <body>. Scroll containers are skipped:
  // their content is meant to overflow.
  const findTooTall = (limit) => {
    const found = [];
    const walk = (el, depth) => {
      for (const child of el.children) {
        if (child.id === PROBE_ID) continue;
        const r = child.getBoundingClientRect();
        if (
          !child.hasAttribute(FIT) &&
          r.top < limit &&
          r.bottom > limit + 1 &&
          r.height > limit / 2
        ) {
          found.push([child, limit - r.top]);
          continue;
        }
        if (depth < MAX_DEPTH && !scrolls(child)) walk(child, depth + 1);
      }
    };
    walk(document.body, 0);
    return found;
  };

  // A capped container can hold another full-screen child, so repeat a few
  // times. Each pass measures everything before writing anything.
  const fit = () => {
    unfit();
    const limit = document.body.getBoundingClientRect().bottom;
    for (let pass = 0; pass < 3; pass++) {
      const found = findTooTall(limit);
      if (!found.length) break;
      for (const [el, height] of found) {
        el.setAttribute(FIT, '');
        el.style.setProperty('max-height', `${height}px`, 'important');
        if (parseFloat(getComputedStyle(el).minHeight) > height) {
          el.style.setProperty('min-height', `${height}px`, 'important');
        }
      }
    }
  };

  const alpha = (color) => {
    if (!color || color === 'transparent') return 0;
    const slash = color.match(/\/\s*([\d.]+)(%?)\s*\)$/);
    if (slash) return slash[2] ? slash[1] / 100 : +slash[1];
    const rgba = color.match(/^rgba\(.*,\s*([\d.]+)\s*\)$/);
    return rgba ? +rgba[1] : 1;
  };

  // Match whatever sits at the bottom of the app: the chat footer, or the
  // sidebar's bottom bar when the sidebar is open.
  const paint = () => {
    const r = document.body.getBoundingClientRect();
    let el = document.elementFromPoint(r.left + r.width / 2, r.bottom - 2);
    let color = FALLBACK_COLOR;
    while (el && el !== root) {
      const bg = getComputedStyle(el).backgroundColor;
      if (alpha(bg) >= 0.95) {
        color = bg;
        break;
      }
      el = el.parentElement;
    }
    root.style.setProperty('--tmx-navbar-color', color);
  };

  const update = () => {
    timer = 0;
    ensureCover();
    const on = readInsets().some((v) => v > 0);
    root.classList.toggle(ON, on);
    if (on) {
      fit();
      paint();
    } else {
      unfit();
    }
  };

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(update, DEBOUNCE_MS);
  };

  const init = () => {
    injectStyle();
    ensureCover();
    update();

    // Next.js can re-render <head> and drop the edited viewport tag.
    new MutationObserver(ensureCover).observe(document.head, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['content'],
    });

    // Only childList and class changes, so the script's own style writes
    // never retrigger it.
    new MutationObserver(schedule).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });

    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    document.addEventListener('transitionend', schedule, true);
    document.addEventListener('animationend', schedule, true);

    // Chrome applies a new viewport-fit a moment after the tag changes.
    for (const ms of [500, 1500, 3000]) setTimeout(schedule, ms);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
