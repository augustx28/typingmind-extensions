/* =====================================================================
 * TypingMind - Android dark bars  v5
 * ---------------------------------------------------------------------
 * For TypingMind installed as an app from Chrome on Android. Chrome now
 * draws the app behind the status bar and the navigation bar, which
 * left a white strip at the bottom and pushed the top under the clock.
 *
 *   - The area behind both system bars is dark (#161616).
 *   - The app starts just under the status bar.
 *   - Chats run all the way down: the message box (or the Space Saver
 *     chevron) sits right above the navigation bar.
 *   - Pages with the bottom menu (Settings, Agents...) end exactly where
 *     the menu starts.
 *
 * What changed from v4: v4 took the bottom menu's height off every page,
 * chats included, and added another 90px of padding on the other pages.
 * That was the big empty band at the bottom. The rest of v4 is unchanged.
 *
 * Only runs on Android, in the installed app. Browser tabs and computers
 * are left alone. Replaces v4: keep only one of the two installed.
 * ===================================================================== */

(function () {
  'use strict';

  if (!/Android/i.test(navigator.userAgent)) return;
  if (!window.matchMedia('(display-mode: standalone)').matches) return;
  if (window.__tmDarkBarsV5) return;
  window.__tmDarkBarsV5 = true;

  const DARK = '#161616';

  // How far the app starts from the top: the status bar's height, minus
  // 6px so the header sits snug under it. Same as v4.
  const GAP = 'max(0px, calc(env(safe-area-inset-top, 0px) - 6px))';

  // Height of the app once it starts below the status bar.
  const APP = 'calc(100dvh - ' + GAP + ')';

  // Height TypingMind gives its bottom menu on phones: 58px plus the
  // navigation bar. TypingMind sets this variable itself.
  const MENU = 'var(--workspace-height, 0px)';

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
   three selectors are three ways of spotting a non-chat page, in case
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

/* ---------- Popups open outside the box: keep their top below the status bar ---------- */

#headlessui-portal-root [role="dialog"] {
  padding-top: ${GAP} !important;
}
`;

  // v4 used a different style id. If it is still installed, take its
  // rules out so the two cannot fight.
  const old = document.getElementById('tm-android-safe-top-v4');
  if (old) old.remove();

  const style = document.createElement('style');
  style.id = 'tm-android-dark-bars-v5';
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

  keepStyle();
  keepDarkThemeColor();

  // Both functions only write when something is off, so this can't loop.
  new MutationObserver(() => {
    keepStyle();
    keepDarkThemeColor();
  }).observe(document.head, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['content', 'media', 'name'],
  });
})();
