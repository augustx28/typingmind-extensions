/* =====================================================================
 * TypingMind - Android dark bars  v6
 * ---------------------------------------------------------------------
 * For TypingMind installed as an app from Chrome on Android, with the
 * Chrome flag "web-app-short-edges-cutout-mode" turned on. That flag
 * lets the app draw behind the status bar and the navigation bar, which
 * is what makes the dark bottom bar possible.
 *
 *   - The area behind both system bars is dark (#161616).
 *   - The app starts just under the status bar.
 *   - Chats run all the way down: the message box (or the Space Saver
 *     chevron) sits right above the navigation bar.
 *   - Pages with the bottom menu (Settings, Agents...) end exactly where
 *     the menu starts.
 *   - When the keyboard opens, the app shrinks to fit above it: the
 *     header stays at the top and the whole message box, tool row
 *     included, sits right on the keyboard.
 *
 * v6: keyboard fix. With the flag on, Chrome no longer shrank the app for
 * the keyboard. It slid the whole screen up instead, which could leave
 * the tool row under the keyboard and push chats under the status bar.
 *
 * v5: v4 took the bottom menu's height off every page, chats included,
 * and added another 90px of padding on the other pages. That was the big
 * empty band at the bottom.
 *
 * Only runs on Android, in the installed app. Browser tabs and computers
 * are left alone. Keep only one version of this file installed.
 * ===================================================================== */

(function () {
  'use strict';

  if (!/Android/i.test(navigator.userAgent)) return;
  if (!window.matchMedia('(display-mode: standalone)').matches) return;
  if (window.__tmDarkBarsV6) return;
  window.__tmDarkBarsV6 = true;

  const DARK = '#161616';

  // How far the app starts from the top: the status bar's height, minus
  // 6px so the header sits snug under it. Same as v4.
  const GAP = 'max(0px, calc(env(safe-area-inset-top, 0px) - 6px))';

  // Height of the app once it starts below the status bar. 100dvh follows
  // the keyboard, so this shrinks when the keyboard opens.
  const APP = 'calc(100dvh - ' + GAP + ')';

  // Height TypingMind gives its bottom menu on phones: 58px plus the
  // navigation bar. TypingMind sets this variable itself.
  const MENU = 'var(--workspace-height, 0px)';

  // Class put on <html> while the keyboard is open.
  const KB = 'tm-bars-keyboard';

  const CSS = `
/* ---------- Dark behind the status bar and the navigation bar ---------- */

html,
body {
  background-color: ${DARK} !important;
}

/* ---------- The app box: just under the status bar, down to the bottom edge ----------
   The transform keeps TypingMind's own pinned layers (sidebar drawer,
   bottom menu) inside this box instead of under the status bar. */

#__next {
  position: fixed !important;
  top: ${GAP} !important;
  left: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  transform: translateZ(0) !important;
}

/* ---------- Chats: fill the box ----------
   TypingMind sizes this to the whole screen. The box is shorter by the
   status bar, so match the box. TypingMind already pads the message box
   by the navigation bar's height, so it lands right above the bar. */

[data-element-id="main-content-area"] > main {
  height: ${APP} !important;
  max-height: ${APP} !important;
}

/* ---------- Pages with the bottom menu: stop where the menu starts ----------
   The same rule TypingMind uses on phones, minus the status bar. The
   selectors are different ways of spotting a non-chat page, in case
   TypingMind renames one of them in an update. */

@media (max-width: 639.98px) {
  [data-element-id="main-content-area"] > main[class*="h-[calc(100svh-var(--workspace-height))]"],
  [data-element-id="main-content-area"][class*="pb-[--workspace-height]"] > main,
  [data-element-id="main-content-area"]:not(:has([data-element-id="chat-space-middle-part"])) > main,
  [data-element-id="main-content-area"] main [class*="h-[calc(100svh-var(--workspace-height))]"] {
    height: calc(${APP} - ${MENU}) !important;
    max-height: calc(${APP} - ${MENU}) !important;
  }
}

/* ---------- Chat list, drawer and menu: never taller than the box ----------
   TypingMind sizes these to the whole screen too. Capped to the box,
   the last chats in the list are no longer hidden behind the menu. */

[data-element-id="side-bar-background"],
[data-element-id="nav-container"],
[data-element-id="workspace-bar"] {
  max-height: ${APP} !important;
}

/* ---------- Keyboard open ----------
   The navigation bar is behind the keyboard now, but Chrome still
   reports its height as safe space, which would leave a gap that tall
   between the message box and the keyboard. Drop that space while the
   keyboard is up. */

html.${KB} [data-element-id="chat-space-end-part"],
html.${KB} [data-element-id="workspace-bar"] {
  padding-bottom: 0 !important;
}

html.${KB} #nav-handler[class*="--workspace-height:calc(58px+env(safe-area-inset-bottom))"] {
  --workspace-height: 58px !important;
}

/* ---------- Popups open outside the box: keep their top below the status bar ---------- */

#headlessui-portal-root [role="dialog"] {
  padding-top: ${GAP} !important;
}
`;

  // Earlier versions used other style ids. If one is still installed,
  // take its rules out so they cannot fight.
  ['tm-android-safe-top-v4', 'tm-android-dark-bars-v5'].forEach((id) => {
    const old = document.getElementById(id);
    if (old) old.remove();
  });

  const style = document.createElement('style');
  style.id = 'tm-android-dark-bars-v6';
  style.textContent = CSS;

  function keepStyle() {
    if (!style.isConnected) document.head.appendChild(style);
  }

  // Chrome takes the status bar's icon color from theme-color. TypingMind
  // sets it to white or swaps it per light/dark mode, which would leave
  // dark icons on the dark bar. Pin it to the dark color.
  function keepDarkThemeColor() {
    const metas = document.querySelectorAll('meta[name="theme-color"]');
    if (!metas.length) {
      const m = document.createElement('meta');
      m.name = 'theme-color';
      m.content = DARK;
      document.head.appendChild(m);
      return;
    }
    metas.forEach((m) => {
      if (m.hasAttribute('media')) m.removeAttribute('media');
      if (m.content !== DARK) m.content = DARK;
    });
  }

  // Tell Chrome to shrink the app above the keyboard instead of sliding
  // the whole screen up. Everything else in TypingMind's viewport setting
  // stays as it is.
  function keepKeyboardResize() {
    const vp = document.querySelector('meta[name="viewport"]');
    if (!vp) return;
    const content = vp.getAttribute('content') || '';
    if (/interactive-widget\s*=\s*resizes-content/i.test(content)) return;
    const parts = content
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && !/^interactive-widget\s*=/i.test(s));
    parts.push('interactive-widget=resizes-content');
    vp.setAttribute('content', parts.join(', '));
  }

  // ---------- Keyboard detection ----------
  // The keyboard counts as open when something you can type in has focus
  // and the app got noticeably shorter. Turning the phone resets the
  // reference height.

  const root = document.documentElement;
  let baseW = 0;
  let baseH = 0;
  let frame = 0;

  function typingTarget(el) {
    if (!el || el === document.body) return false;
    if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
    return (
      el.tagName === 'INPUT' &&
      !/^(button|checkbox|color|file|hidden|image|radio|range|reset|submit)$/i.test(el.type || '')
    );
  }

  function checkKeyboard() {
    frame = 0;
    const w = root.clientWidth;
    const h = root.clientHeight;
    if (Math.abs(w - baseW) > 2) {
      baseW = w;
      baseH = h;
    } else if (h > baseH) {
      baseH = h;
    }
    const open = baseH - h > 120 && typingTarget(document.activeElement);
    if (root.classList.contains(KB) !== open) root.classList.toggle(KB, open);
  }

  function queueCheck() {
    if (!frame) frame = requestAnimationFrame(checkKeyboard);
  }

  keepStyle();
  keepDarkThemeColor();
  keepKeyboardResize();
  queueCheck();

  window.addEventListener('resize', queueCheck, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', queueCheck, { passive: true });
  }
  document.addEventListener('focusin', queueCheck, true);
  document.addEventListener('focusout', queueCheck, true);

  // Each function only writes when something is off, so this can't loop.
  new MutationObserver(() => {
    keepStyle();
    keepDarkThemeColor();
    keepKeyboardResize();
  }).observe(document.head, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['content', 'media', 'name'],
  });
})();
