/* =====================================================================
 * TypingMind Highlighter Compact Floating UI
 * UI Patch Version 1.1.0
 *
 * Paste this after the final })(); in the existing highlighter file.
 * ===================================================================== */

(() => {
  "use strict";

  const VERSION = "1.1.0";
  const FLAG = "__TMHL_COMPACT_FLOATING_UI__";

  if (window[FLAG]) return;
  window[FLAG] = { version: VERSION };

  const STYLE_ID = "tmhl-compact-floating-styles";
  const POSITION_KEY = "tmhl-compact-toolbar-position-v1";
  const AUTO_CLOSE_KEY = "tmhl-auto-close-mobile-sidebar-v1";

  const SMALL_SCREEN_MAX = 820;

  const SELECTOR = {
    toolbar: "#tmhl-toolbar",
    panel: "#tmhl-panel",
    launcher: "#tmhl-launcher",
    scrim: "#tmhl-scrim",
    nav: '[data-element-id="nav-container"]',
    compactSidebarButton:
      'button[data-element-id="workspace-logo-button-compact"]',
    closeSidebar: [
      'button[aria-label="Close sidebar"]',
      'button[aria-label*="Close sidebar" i]',
      'button[title="Close sidebar"]',
      'button[title*="Close sidebar" i]',
      '[data-element-id="close-sidebar-button"]',
      '[data-element-id="sidebar-close-button"]'
    ].join(", ")
  };

  const ICON = {
    grip: `
      <svg viewBox="0 0 12 18" fill="currentColor" aria-hidden="true">
        <circle cx="3" cy="3" r="1.15"/>
        <circle cx="9" cy="3" r="1.15"/>
        <circle cx="3" cy="9" r="1.15"/>
        <circle cx="9" cy="9" r="1.15"/>
        <circle cx="3" cy="15" r="1.15"/>
        <circle cx="9" cy="15" r="1.15"/>
      </svg>
    `,
    more: `
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <circle cx="5" cy="12" r="1.7"/>
        <circle cx="12" cy="12" r="1.7"/>
        <circle cx="19" cy="12" r="1.7"/>
      </svg>
    `,
    target: `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="1.8" stroke-linecap="round"
           stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="7"/>
        <circle cx="12" cy="12" r="2.5"/>
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
      </svg>
    `
  };

  const clamp = (value, min, max) =>
    Math.max(min, Math.min(value, max));

  function isSmallScreen() {
    const viewport = window.visualViewport;
    const width = viewport ? viewport.width : window.innerWidth;
    return width <= SMALL_SCREEN_MAX;
  }

  function isCoarsePointer() {
    return window.matchMedia("(pointer: coarse)").matches;
  }

  function isVisible(node) {
    if (!(node instanceof Element)) return false;

    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);

    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity || 1) !== 0
    );
  }

  function viewportBounds() {
    const viewport = window.visualViewport;

    const left = viewport ? viewport.offsetLeft : 0;
    const top = viewport ? viewport.offsetTop : 0;
    const width = viewport ? viewport.width : window.innerWidth;
    const height = viewport ? viewport.height : window.innerHeight;

    return {
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height
    };
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;

    style.textContent = `
:root[data-tmhl-theme="light"] {
  --tmhl-compact-glint: rgba(255, 255, 255, .94);
  --tmhl-compact-shadow:
    0 14px 34px rgba(24, 24, 27, .14),
    0 3px 9px rgba(24, 24, 27, .08);
  --tmhl-compact-menu-shadow:
    0 20px 44px rgba(24, 24, 27, .18),
    0 3px 10px rgba(24, 24, 27, .08);
}

:root[data-tmhl-theme="dark"] {
  --tmhl-compact-glint: rgba(255, 255, 255, .075);
  --tmhl-compact-shadow:
    0 16px 38px rgba(0, 0, 0, .52),
    0 3px 10px rgba(0, 0, 0, .34);
  --tmhl-compact-menu-shadow:
    0 22px 52px rgba(0, 0, 0, .62),
    0 3px 12px rgba(0, 0, 0, .4);
}

/* Keep the entire highlighter UI on TypingMind's Inter typeface. */
#tmhl-toolbar,
#tmhl-toolbar *,
#tmhl-panel,
#tmhl-panel *,
#tmhl-launcher,
#tmhl-launcher *,
.tmhl-compact-menu,
.tmhl-compact-menu * {
  font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont,
    "Segoe UI", sans-serif !important;
}

/* Compact marker rail */

#tmhl-toolbar.tmhl-compact-ready {
  position: fixed;
  width: max-content;
  max-width: calc(100vw - 16px);
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border: 1px solid var(--tmhl-border);
  border-radius: 999px;
  background:
    linear-gradient(
      180deg,
      var(--tmhl-compact-glint) 0,
      transparent 56%
    ),
    var(--tmhl-surface);
  box-shadow: var(--tmhl-compact-shadow);
  backdrop-filter: blur(20px) saturate(165%);
  -webkit-backdrop-filter: blur(20px) saturate(165%);
  isolation: isolate;
  overflow: visible;
  animation: tmhl-compact-arrive .16s ease-out;
  transition:
    opacity .15s ease,
    transform .15s ease,
    visibility 0s linear 0s;
}

#tmhl-toolbar.tmhl-compact-ready.tmhl-dock {
  width: max-content;
  max-width: calc(100vw - 16px);
}

#tmhl-toolbar.tmhl-compact-ready > .tmhl-divider {
  display: none !important;
}

@keyframes tmhl-compact-arrive {
  from {
    opacity: 0;
    filter: blur(2px);
  }
  to {
    opacity: 1;
    filter: none;
  }
}

/* Marker nib colors */

#tmhl-toolbar.tmhl-compact-ready > .tmhl-swatch {
  position: relative;
  width: 27px;
  height: 27px;
  min-width: 27px;
  padding: 0;
  border-radius: 999px;
  background: transparent;
  transition:
    background-color .14s ease,
    transform .14s ease;
}

#tmhl-toolbar.tmhl-compact-ready > .tmhl-swatch::before {
  width: 16px;
  height: 10px;
  border-radius: 5px 3px 4px 2px;
  background: var(--sw);
  transform: rotate(-8deg);
  box-shadow:
    inset 0 0 0 1px var(--tmhl-border),
    0 1px 2px rgba(0, 0, 0, .1);
  transition:
    transform .15s cubic-bezier(.2, .85, .25, 1.25),
    box-shadow .15s ease;
}

#tmhl-toolbar.tmhl-compact-ready > .tmhl-swatch:hover {
  background: var(--tmhl-raised);
}

#tmhl-toolbar.tmhl-compact-ready > .tmhl-swatch:hover::before {
  transform: rotate(-8deg) translateY(-1px) scale(1.1);
}

#tmhl-toolbar.tmhl-compact-ready
  > .tmhl-swatch[aria-pressed="true"] {
  background: var(--tmhl-raised-2);
}

#tmhl-toolbar.tmhl-compact-ready
  > .tmhl-swatch[aria-pressed="true"]::before {
  transform: rotate(-8deg) scale(1.05);
  box-shadow:
    inset 0 0 0 1px var(--tmhl-border),
    0 0 0 2px var(--tmhl-surface-solid),
    0 0 0 3.5px var(--tmhl-text);
}

/* Drag grip and More button */

.tmhl-compact-grip,
.tmhl-compact-more {
  flex: 0 0 auto;
  width: 24px;
  height: 28px;
  min-width: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--tmhl-muted);
  cursor: pointer;
  transition:
    color .14s ease,
    background-color .14s ease,
    transform .14s ease;
}

.tmhl-compact-grip {
  cursor: grab;
  touch-action: none;
}

.tmhl-compact-grip:hover,
.tmhl-compact-more:hover {
  color: var(--tmhl-text);
  background: var(--tmhl-raised-2);
}

.tmhl-compact-grip:active {
  cursor: grabbing;
}

.tmhl-compact-grip svg {
  width: 9px;
  height: 14px;
}

.tmhl-compact-more svg {
  width: 16px;
  height: 16px;
}

.tmhl-compact-more[aria-expanded="true"] {
  color: var(--tmhl-text);
  background: var(--tmhl-raised-2);
  transform: rotate(90deg);
}

#tmhl-toolbar.tmhl-compact-dragging {
  cursor: grabbing;
  animation: none;
  box-shadow:
    0 20px 48px rgba(0, 0, 0, .24),
    0 4px 12px rgba(0, 0, 0, .16);
}

/* Overflow actions */

.tmhl-compact-menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: max-content;
  min-width: 178px;
  max-width: min(220px, calc(100vw - 16px));
  display: grid;
  gap: 2px;
  padding: 6px;
  border: 1px solid var(--tmhl-border);
  border-radius: 15px;
  background:
    linear-gradient(
      180deg,
      var(--tmhl-compact-glint),
      transparent 42%
    ),
    var(--tmhl-surface);
  box-shadow: var(--tmhl-compact-menu-shadow);
  backdrop-filter: blur(22px) saturate(165%);
  -webkit-backdrop-filter: blur(22px) saturate(165%);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transform: translateY(-5px) scale(.975);
  transform-origin: top right;
  transition:
    opacity .14s ease,
    transform .14s cubic-bezier(.2, .8, .25, 1),
    visibility 0s linear .15s;
}

.tmhl-compact-menu.tmhl-open {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  transform: none;
  transition-delay: 0s;
}

.tmhl-compact-menu.tmhl-menu-up {
  top: auto;
  bottom: calc(100% + 8px);
  transform-origin: bottom right;
}

.tmhl-compact-menu > .tmhl-tool {
  width: 100%;
  min-width: 0;
  height: 36px;
  display: flex;
  justify-content: flex-start;
  gap: 9px;
  padding: 0 10px;
  border-radius: 10px;
  color: var(--tmhl-text);
  font-size: 12.5px;
  font-weight: 590;
  white-space: nowrap;
  text-align: left;
}

.tmhl-compact-menu > .tmhl-tool:hover {
  background: var(--tmhl-raised-2);
}

.tmhl-compact-menu > .tmhl-tool svg {
  width: 15px;
  height: 15px;
  flex: 0 0 15px;
  color: var(--tmhl-muted);
}

.tmhl-compact-menu > .tmhl-tool::after {
  content: attr(data-tmhl-label);
  overflow: hidden;
  text-overflow: ellipsis;
}

.tmhl-compact-menu > .tmhl-tool.tmhl-danger,
.tmhl-compact-menu > .tmhl-tool.tmhl-danger svg {
  color: #f87171;
}

/* Accessible keyboard focus */

.tmhl-compact-grip:focus-visible,
.tmhl-compact-more:focus-visible,
#tmhl-toolbar.tmhl-compact-ready > .tmhl-swatch:focus-visible,
.tmhl-compact-menu > .tmhl-tool:focus-visible {
  outline: 2px solid var(--tmhl-text);
  outline-offset: 2px;
}

/* Launcher is redundant while its panel is open */

#tmhl-launcher {
  transition:
    opacity .18s ease,
    transform .18s ease,
    box-shadow .18s ease,
    visibility 0s linear 0s;
}

#tmhl-launcher.tmhl-panel-open {
  opacity: 0 !important;
  visibility: hidden;
  pointer-events: none !important;
  transform: scale(.84) !important;
  transition:
    opacity .14s ease,
    transform .14s ease,
    visibility 0s linear .14s;
}

/*
 * On phones, hide all highlighter chrome while TypingMind's sidebar is
 * open. It comes back automatically as soon as the sidebar closes.
 */
@media (max-width: 820px) {
  html.tmhl-mobile-sidebar-open #tmhl-launcher,
  html.tmhl-mobile-sidebar-open #tmhl-toolbar,
  html.tmhl-mobile-sidebar-open #tmhl-panel,
  html.tmhl-mobile-sidebar-open #tmhl-scrim {
    opacity: 0 !important;
    visibility: hidden !important;
    pointer-events: none !important;
  }

  html.tmhl-mobile-sidebar-open #tmhl-launcher {
    transform: scale(.84) !important;
  }
}

/* Compact but still comfortable on touch screens */

@media (max-width: 820px), (pointer: coarse) {
  #tmhl-toolbar.tmhl-compact-ready {
    min-height: 44px;
    padding: 4px;
    gap: 2px;
  }

  #tmhl-toolbar.tmhl-compact-ready > .tmhl-swatch {
    width: 36px;
    height: 36px;
    min-width: 36px;
  }

  #tmhl-toolbar.tmhl-compact-ready > .tmhl-swatch::before {
    width: 18px;
    height: 12px;
    border-radius: 6px 3px 5px 2px;
  }

  .tmhl-compact-grip {
    width: 25px;
    height: 36px;
    min-width: 25px;
  }

  .tmhl-compact-more {
    width: 36px;
    height: 36px;
    min-width: 36px;
  }

  .tmhl-compact-menu {
    min-width: 190px;
    padding: 7px;
  }

  .tmhl-compact-menu > .tmhl-tool {
    min-height: 42px;
    height: 42px;
    padding: 0 11px;
    font-size: 13px;
  }
}

@media (prefers-reduced-motion: reduce) {
  #tmhl-toolbar.tmhl-compact-ready,
  .tmhl-compact-menu,
  .tmhl-compact-grip,
  .tmhl-compact-more,
  #tmhl-toolbar.tmhl-compact-ready > .tmhl-swatch,
  #tmhl-launcher {
    animation: none !important;
    transition: none !important;
  }
}
`;

    document.head.appendChild(style);
  }

  /* ------------------------------------------------------------------
   * Saved floating position
   * ---------------------------------------------------------------- */

  function loadSavedPosition() {
    try {
      const parsed = JSON.parse(
        localStorage.getItem(POSITION_KEY) || "null"
      );

      if (
        parsed &&
        Number.isFinite(parsed.xPct) &&
        Number.isFinite(parsed.yPct)
      ) {
        return {
          xPct: clamp(parsed.xPct, 0, 1),
          yPct: clamp(parsed.yPct, 0, 1)
        };
      }
    } catch {
      /* Ignore malformed saved positions. */
    }

    return null;
  }

  let savedPosition = loadSavedPosition();

  function persistPosition() {
    try {
      if (!savedPosition) {
        localStorage.removeItem(POSITION_KEY);
        return;
      }

      localStorage.setItem(
        POSITION_KEY,
        JSON.stringify(savedPosition)
      );
    } catch {
      /* Position persistence is non-critical. */
    }
  }

  function autoCloseEnabled() {
    try {
      return localStorage.getItem(AUTO_CLOSE_KEY) !== "false";
    } catch {
      return true;
    }
  }

  /* ------------------------------------------------------------------
   * Toolbar enhancement
   * ---------------------------------------------------------------- */

  let toolbar = null;
  let toolbarObserver = null;
  let menu = null;
  let moreButton = null;
  let dragState = null;
  let positionFrame = 0;
  let enhanceQueued = false;

  let lastContextRect = null;
  let lastContextRectAt = 0;

  function bindCompactPress(node, action) {
    let lastRun = 0;

    const run = (event) => {
      if (
        event.type === "pointerdown" &&
        event.button !== undefined &&
        event.button !== 0
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const stamp = performance.now();
      if (stamp - lastRun < 180) return;

      lastRun = stamp;
      action(event);
    };

    node.addEventListener("pointerdown", run);
    node.addEventListener("click", run);
  }

  function getSelectionRect() {
    const selection = window.getSelection();

    if (
      !selection ||
      selection.rangeCount === 0 ||
      selection.isCollapsed
    ) {
      return null;
    }

    try {
      const range = selection.getRangeAt(0);
      const rects = Array.from(
        range.getClientRects()
      ).filter(
        (rect) => rect.width > 0 || rect.height > 0
      );

      const rect = rects.length
        ? rects[rects.length - 1]
        : range.getBoundingClientRect();

      if (!rect || (!rect.width && !rect.height)) {
        return null;
      }

      return {
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        width: rect.width,
        height: rect.height
      };
    } catch {
      return null;
    }
  }

  function setToolbarPosition(left, top) {
    if (!toolbar || toolbar.hidden) return null;

    const bounds = viewportBounds();
    const width = toolbar.offsetWidth || 210;
    const height = toolbar.offsetHeight || 40;
    const margin = 8;

    const safeLeft = clamp(
      left,
      bounds.left + margin,
      Math.max(
        bounds.left + margin,
        bounds.right - width - margin
      )
    );

    const safeTop = clamp(
      top,
      bounds.top + margin,
      Math.max(
        bounds.top + margin,
        bounds.bottom - height - margin
      )
    );

    toolbar.classList.remove("tmhl-dock");

    toolbar.style.setProperty(
      "left",
      `${Math.round(safeLeft)}px`,
      "important"
    );

    toolbar.style.setProperty(
      "top",
      `${Math.round(safeTop)}px`,
      "important"
    );

    toolbar.style.setProperty(
      "transform",
      "none",
      "important"
    );

    toolbar.style.visibility = "visible";

    return {
      left: safeLeft,
      top: safeTop
    };
  }

  function saveCurrentToolbarPosition() {
    if (!toolbar || toolbar.hidden) return;

    const bounds = viewportBounds();
    const rect = toolbar.getBoundingClientRect();

    savedPosition = {
      xPct: clamp(
        (
          rect.left +
          rect.width / 2 -
          bounds.left
        ) / bounds.width,
        0,
        1
      ),
      yPct: clamp(
        (
          rect.top +
          rect.height / 2 -
          bounds.top
        ) / bounds.height,
        0,
        1
      )
    };

    persistPosition();
  }

  function resetToolbarPosition() {
    savedPosition = null;
    persistPosition();
    queueToolbarPosition();
  }

  function positionToolbar() {
    if (
      !toolbar ||
      toolbar.hidden ||
      dragState
    ) {
      return;
    }

    const bounds = viewportBounds();
    const width = toolbar.offsetWidth || 210;
    const height = toolbar.offsetHeight || 40;

    if (savedPosition) {
      setToolbarPosition(
        bounds.left +
          savedPosition.xPct *
            bounds.width -
          width / 2,
        bounds.top +
          savedPosition.yPct *
            bounds.height -
          height / 2
      );

      if (
        menu &&
        menu.classList.contains("tmhl-open")
      ) {
        positionMenu();
      }

      return;
    }

    let anchor = getSelectionRect();

    if (
      !anchor &&
      lastContextRect &&
      Date.now() - lastContextRectAt < 1500
    ) {
      anchor = lastContextRect;
    }

    if (anchor) {
      const gap =
        isCoarsePointer() ||
        isSmallScreen()
          ? 11
          : 10;

      const centeredLeft =
        anchor.left +
        anchor.width / 2 -
        width / 2;

      const above =
        anchor.top -
        height -
        gap;

      const below =
        anchor.bottom +
        gap;

      let top;

      if (
        isCoarsePointer() ||
        isSmallScreen()
      ) {
        top =
          below + height <=
          bounds.bottom - 8
            ? below
            : above;
      } else {
        top =
          above >=
          bounds.top + 8
            ? above
            : below;
      }

      setToolbarPosition(
        centeredLeft,
        top
      );
    } else {
      const current =
        toolbar.getBoundingClientRect();

      if (
        current.width > 0 &&
        current.height > 0 &&
        current.bottom > bounds.top &&
        current.top < bounds.bottom
      ) {
        setToolbarPosition(
          current.left,
          current.top
        );
      } else {
        setToolbarPosition(
          bounds.left +
            bounds.width / 2 -
            width / 2,
          bounds.bottom -
            height -
            90
        );
      }
    }

    if (
      menu &&
      menu.classList.contains("tmhl-open")
    ) {
      positionMenu();
    }
  }

  function queueToolbarPosition() {
    window.cancelAnimationFrame(
      positionFrame
    );

    positionFrame =
      window.requestAnimationFrame(() => {
        positionFrame =
          window.requestAnimationFrame(
            positionToolbar
          );
      });
  }

  function closeMenu() {
    if (!menu || !moreButton) return;

    menu.classList.remove(
      "tmhl-open",
      "tmhl-menu-up"
    );

    moreButton.setAttribute(
      "aria-expanded",
      "false"
    );
  }

  function positionMenu() {
    if (
      !toolbar ||
      !menu ||
      !menu.classList.contains("tmhl-open")
    ) {
      return;
    }

    menu.classList.remove(
      "tmhl-menu-up"
    );

    menu.style.left = "";
    menu.style.right = "0";

    window.requestAnimationFrame(() => {
      if (
        !menu ||
        !menu.classList.contains(
          "tmhl-open"
        )
      ) {
        return;
      }

      const bounds =
        viewportBounds();

      const toolbarRect =
        toolbar.getBoundingClientRect();

      const menuWidth =
        menu.offsetWidth;

      const menuHeight =
        menu.offsetHeight;

      const gap = 8;

      const roomBelow =
        toolbarRect.bottom +
          gap +
          menuHeight <=
        bounds.bottom - 8;

      const roomAbove =
        toolbarRect.top -
          gap -
          menuHeight >=
        bounds.top + 8;

      if (
        !roomBelow &&
        roomAbove
      ) {
        menu.classList.add(
          "tmhl-menu-up"
        );
      }

      const desiredLeft = clamp(
        toolbarRect.right -
          menuWidth,
        bounds.left + 8,
        Math.max(
          bounds.left + 8,
          bounds.right -
            menuWidth -
            8
        )
      );

      menu.style.right = "auto";

      menu.style.left =
        `${Math.round(
          desiredLeft -
          toolbarRect.left
        )}px`;
    });
  }

  function toggleMenu() {
    if (!menu || !moreButton) {
      return;
    }

    const opening =
      !menu.classList.contains(
        "tmhl-open"
      );

    if (!opening) {
      closeMenu();
      return;
    }

    menu.classList.add(
      "tmhl-open"
    );

    moreButton.setAttribute(
      "aria-expanded",
      "true"
    );

    positionMenu();
  }

  function buildGrip() {
    const grip =
      document.createElement(
        "button"
      );

    grip.type = "button";
    grip.className =
      "tmhl-compact-grip";

    grip.innerHTML =
      ICON.grip;

    grip.setAttribute(
      "aria-label",
      "Move highlight controls"
    );

    grip.title =
      "Drag to move. Double-click to make it follow your selection.";

    let localDrag = null;

    grip.addEventListener(
      "pointerdown",
      (event) => {
        if (
          event.button !== undefined &&
          event.button !== 0
        ) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        closeMenu();

        const rect =
          toolbar.getBoundingClientRect();

        localDrag = {
          pointerId:
            event.pointerId,
          startX:
            event.clientX,
          startY:
            event.clientY,
          startLeft:
            rect.left,
          startTop:
            rect.top,
          moved: false
        };

        dragState =
          localDrag;

        try {
          grip.setPointerCapture(
            event.pointerId
          );
        } catch {
          /* Pointer capture is optional. */
        }
      }
    );

    grip.addEventListener(
      "pointermove",
      (event) => {
        if (
          !localDrag ||
          event.pointerId !==
            localDrag.pointerId
        ) {
          return;
        }

        const dx =
          event.clientX -
          localDrag.startX;

        const dy =
          event.clientY -
          localDrag.startY;

        const threshold =
          isCoarsePointer()
            ? 8
            : 4;

        if (
          !localDrag.moved &&
          Math.hypot(
            dx,
            dy
          ) < threshold
        ) {
          return;
        }

        localDrag.moved =
          true;

        toolbar.classList.add(
          "tmhl-compact-dragging"
        );

        setToolbarPosition(
          localDrag.startLeft +
            dx,
          localDrag.startTop +
            dy
        );
      }
    );

    const finishDrag = (
      event
    ) => {
      if (
        !localDrag ||
        (
          event.pointerId !==
            undefined &&
          event.pointerId !==
            localDrag.pointerId
        )
      ) {
        return;
      }

      const moved =
        localDrag.moved;

      const pointerId =
        localDrag.pointerId;

      localDrag = null;
      dragState = null;

      toolbar.classList.remove(
        "tmhl-compact-dragging"
      );

      try {
        grip.releasePointerCapture(
          pointerId
        );
      } catch {
        /* Ignore if pointer capture was already released. */
      }

      if (moved) {
        saveCurrentToolbarPosition();
      }
    };

    grip.addEventListener(
      "pointerup",
      finishDrag
    );

    grip.addEventListener(
      "pointercancel",
      finishDrag
    );

    grip.addEventListener(
      "dblclick",
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        resetToolbarPosition();
      }
    );

    grip.addEventListener(
      "keydown",
      (event) => {
        const direction = {
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
          ArrowUp: [0, -1],
          ArrowDown: [0, 1]
        }[event.key];

        if (!direction) return;

        event.preventDefault();
        event.stopPropagation();

        const rect =
          toolbar.getBoundingClientRect();

        const step =
          event.shiftKey
            ? 18
            : 8;

        setToolbarPosition(
          rect.left +
            direction[0] *
              step,
          rect.top +
            direction[1] *
              step
        );

        saveCurrentToolbarPosition();
      }
    );

    return grip;
  }

  function buildMoreButton() {
    const button =
      document.createElement(
        "button"
      );

    button.type =
      "button";

    button.className =
      "tmhl-compact-more";

    button.innerHTML =
      ICON.more;

    button.title =
      "More actions";

    button.setAttribute(
      "aria-label",
      "More highlight actions"
    );

    button.setAttribute(
      "aria-haspopup",
      "true"
    );

    button.setAttribute(
      "aria-expanded",
      "false"
    );

    button.setAttribute(
      "aria-controls",
      "tmhl-compact-action-menu"
    );

    bindCompactPress(
      button,
      toggleMenu
    );

    return button;
  }

  function buildFollowButton() {
    const button =
      document.createElement(
        "button"
      );

    button.type =
      "button";

    button.className =
      "tmhl-tool tmhl-compact-follow";

    button.innerHTML =
      ICON.target;

    button.title =
      "Follow selection";

    button.setAttribute(
      "aria-label",
      "Follow selection"
    );

    button.dataset.tmhlLabel =
      "Follow selection";

    bindCompactPress(
      button,
      () => {
        closeMenu();
        resetToolbarPosition();
      }
    );

    return button;
  }

  function enhanceToolbar() {
    enhanceQueued = false;

    if (
      !toolbar ||
      toolbar.hidden
    ) {
      return;
    }

    if (
      toolbar.querySelector(
        ":scope > .tmhl-compact-grip"
      )
    ) {
      queueToolbarPosition();
      return;
    }

    const directChildren =
      Array.from(
        toolbar.children
      );

    const actionButtons =
      directChildren.filter(
        (node) =>
          node.classList.contains(
            "tmhl-tool"
          )
      );

    directChildren
      .filter(
        (node) =>
          node.classList.contains(
            "tmhl-divider"
          )
      )
      .forEach(
        (node) =>
          node.remove()
      );

    const grip =
      buildGrip();

    moreButton =
      buildMoreButton();

    menu =
      document.createElement(
        "div"
      );

    menu.id =
      "tmhl-compact-action-menu";

    menu.className =
      "tmhl-compact-menu";

    menu.setAttribute(
      "role",
      "group"
    );

    menu.setAttribute(
      "aria-label",
      "More highlight actions"
    );

    actionButtons.forEach(
      (button) => {
        const label =
          button.getAttribute(
            "aria-label"
          ) ||
          button.title ||
          "Action";

        button.dataset.tmhlLabel =
          label;

        menu.appendChild(
          button
        );
      }
    );

    menu.appendChild(
      buildFollowButton()
    );

    toolbar.insertBefore(
      grip,
      toolbar.firstChild
    );

    toolbar.append(
      moreButton,
      menu
    );

    toolbar.classList.add(
      "tmhl-compact-ready"
    );

    queueToolbarPosition();
  }

  function queueEnhanceToolbar() {
    if (enhanceQueued) {
      return;
    }

    enhanceQueued = true;

    queueMicrotask(
      enhanceToolbar
    );
  }

  function attachToolbar(node) {
    if (
      !node ||
      node === toolbar
    ) {
      return;
    }

    if (toolbarObserver) {
      toolbarObserver.disconnect();
    }

    toolbar = node;

    toolbarObserver =
      new MutationObserver(
        () => {
          if (
            !toolbar ||
            !toolbar.isConnected
          ) {
            return;
          }

          if (toolbar.hidden) {
            closeMenu();
            dragState = null;

            toolbar.classList.remove(
              "tmhl-compact-dragging"
            );

            return;
          }

          queueEnhanceToolbar();
        }
      );

    toolbarObserver.observe(
      toolbar,
      {
        childList: true,
        attributes: true,
        attributeFilter: [
          "hidden"
        ]
      }
    );

    if (!toolbar.hidden) {
      queueEnhanceToolbar();
    }
  }

  /* ------------------------------------------------------------------
   * Panel and launcher behavior
   * ---------------------------------------------------------------- */

  let panel = null;
  let launcher = null;
  let panelObserver = null;

  function syncLauncherWithPanel() {
    if (
      !panel ||
      !launcher
    ) {
      return;
    }

    const panelOpen =
      panel.classList.contains(
        "tmhl-open"
      );

    launcher.classList.toggle(
      "tmhl-panel-open",
      panelOpen
    );

    if (panelOpen) {
      if (
        !launcher.dataset
          .tmhlCompactPreviousTabindex
      ) {
        const previous =
          launcher.getAttribute(
            "tabindex"
          );

        launcher.dataset
          .tmhlCompactPreviousTabindex =
          previous === null
            ? "__none__"
            : previous;
      }

      launcher.tabIndex = -1;

      launcher.setAttribute(
        "aria-hidden",
        "true"
      );

      if ("inert" in launcher) {
        launcher.inert =
          true;
      }
    } else {
      const previous =
        launcher.dataset
          .tmhlCompactPreviousTabindex;

      if (
        previous ===
          "__none__" ||
        previous ===
          undefined
      ) {
        launcher.removeAttribute(
          "tabindex"
        );
      } else {
        launcher.setAttribute(
          "tabindex",
          previous
        );
      }

      delete launcher.dataset
        .tmhlCompactPreviousTabindex;

      launcher.removeAttribute(
        "aria-hidden"
      );

      if ("inert" in launcher) {
        launcher.inert =
          false;
      }
    }
  }

  function attachPanel(node) {
    if (
      !node ||
      node === panel
    ) {
      return;
    }

    if (panelObserver) {
      panelObserver.disconnect();
    }

    panel = node;

    panelObserver =
      new MutationObserver(
        syncLauncherWithPanel
      );

    panelObserver.observe(
      panel,
      {
        attributes: true,
        attributeFilter: [
          "class"
        ]
      }
    );

    syncLauncherWithPanel();
  }

  function attachLauncher(node) {
    if (
      !node ||
      node === launcher
    ) {
      return;
    }

    launcher = node;

    syncLauncherWithPanel();
  }

  /* ------------------------------------------------------------------
   * Mobile TypingMind sidebar behavior
   * ---------------------------------------------------------------- */

  function currentChatKey() {
    const match =
      window.location.href.match(
        /(?:#|[?&])chat=([^&?#]+)/
      );

    if (
      match &&
      match[1]
    ) {
      try {
        return decodeURIComponent(
          match[1]
        );
      } catch {
        return match[1];
      }
    }

    const selected =
      document.querySelector(
        '[data-element-id="selected-chat-item"]'
      );

    if (!selected) {
      return null;
    }

    const direct =
      selected.getAttribute(
        "data-chat-id"
      ) ||
      selected.dataset.chatId;

    if (direct) {
      return String(direct);
    }

    const link =
      selected.matches("a")
        ? selected
        : selected.closest("a") ||
          selected.querySelector(
            "a"
          );

    const href =
      link &&
      link.getAttribute(
        "href"
      );

    const hrefMatch =
      href &&
      href.match(
        /#chat=([^&?#]+)/
      );

    if (
      !hrefMatch ||
      !hrefMatch[1]
    ) {
      return null;
    }

    try {
      return decodeURIComponent(
        hrefMatch[1]
      );
    } catch {
      return hrefMatch[1];
    }
  }

  function closeHighlighterPanel() {
    if (
      window.TMHighlighter &&
      typeof window
        .TMHighlighter.close ===
        "function"
    ) {
      window.TMHighlighter.close();
      return;
    }

    const currentPanel =
      document.querySelector(
        SELECTOR.panel
      );

    const scrim =
      document.querySelector(
        SELECTOR.scrim
      );

    if (currentPanel) {
      currentPanel.classList.remove(
        "tmhl-open"
      );
    }

    if (scrim) {
      scrim.classList.remove(
        "tmhl-open"
      );
    }
  }

  function isTypingMindSidebarOpen() {
    if (!isSmallScreen()) {
      return false;
    }

    /*
     * A visible close control is the strongest
     * signal that the mobile navigation drawer
     * is currently open.
     */
    const closeButton =
      Array.from(
        document.querySelectorAll(
          SELECTOR.closeSidebar
        )
      ).find(isVisible);

    if (closeButton) {
      return true;
    }

    const nav =
      document.querySelector(
        SELECTOR.nav
      );

    if (
      nav &&
      isVisible(nav)
    ) {
      const rect =
        nav.getBoundingClientRect();

      const bounds =
        viewportBounds();

      const visibleWidth =
        Math.max(
          0,
          Math.min(
            rect.right,
            bounds.right
          ) -
            Math.max(
              rect.left,
              bounds.left
            )
        );

      if (
        visibleWidth >=
        Math.min(
          72,
          rect.width * 0.28
        )
      ) {
        return true;
      }
    }

    /*
     * TypingMind exposes this compact workspace
     * button when the drawer is collapsed.
     */
    const compactButton =
      document.querySelector(
        SELECTOR.compactSidebarButton
      );

    if (
      isVisible(
        compactButton
      )
    ) {
      return false;
    }

    return false;
  }

  let sidebarStateFrame = 0;
  let sidebarWasOpen = false;

  function syncMobileSidebarState() {
    window.cancelAnimationFrame(
      sidebarStateFrame
    );

    sidebarStateFrame =
      window.requestAnimationFrame(
        () => {
          const open =
            isTypingMindSidebarOpen();

          document.documentElement
            .classList.toggle(
              "tmhl-mobile-sidebar-open",
              open
            );

          if (
            open &&
            !sidebarWasOpen
          ) {
            closeMenu();
            closeHighlighterPanel();
          }

          sidebarWasOpen =
            open;
        }
      );
  }

  function closeTypingMindSidebar() {
    if (
      !isSmallScreen() ||
      !autoCloseEnabled()
    ) {
      return false;
    }

    const compactButton =
      document.querySelector(
        SELECTOR.compactSidebarButton
      );

    if (
      isVisible(
        compactButton
      )
    ) {
      syncMobileSidebarState();
      return true;
    }

    const closeButton =
      Array.from(
        document.querySelectorAll(
          SELECTOR.closeSidebar
        )
      ).find(isVisible);

    if (!closeButton) {
      return false;
    }

    closeButton.click();
    syncMobileSidebarState();

    return true;
  }

  let mobileCloseTimer = 0;

  function scheduleMobileAutoClose(
    delay = 30
  ) {
    if (
      !isSmallScreen() ||
      !autoCloseEnabled()
    ) {
      return;
    }

    window.clearTimeout(
      mobileCloseTimer
    );

    mobileCloseTimer =
      window.setTimeout(
        () => {
          closeHighlighterPanel();

          [
            20,
            120,
            280,
            520
          ].forEach(
            (wait) => {
              window.setTimeout(
                () => {
                  closeTypingMindSidebar();
                  syncMobileSidebarState();
                },
                wait
              );
            }
          );
        },
        delay
      );
  }

  let pendingNavStart = null;

  function onGlobalPointerDown(
    event
  ) {
    if (
      !(
        event.target instanceof
        Element
      )
    ) {
      return;
    }

    const mark =
      event.target.closest(
        "mark.tmhl-mark"
      );

    if (mark) {
      const rect =
        mark.getBoundingClientRect();

      lastContextRect = {
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        width: rect.width,
        height: rect.height
      };

      lastContextRectAt =
        Date.now();
    }

    if (
      isSmallScreen() &&
      event.target.closest(
        SELECTOR.nav
      )
    ) {
      pendingNavStart = {
        chatKey:
          currentChatKey(),
        time: Date.now()
      };
    }

    if (isSmallScreen()) {
      [
        0,
        60,
        160,
        320
      ].forEach(
        (delay) => {
          window.setTimeout(
            syncMobileSidebarState,
            delay
          );
        }
      );
    }
  }

  function onPotentialChatNavigation(
    event
  ) {
    if (
      !isSmallScreen() ||
      !(
        event.target instanceof
        Element
      ) ||
      !event.target.closest(
        SELECTOR.nav
      )
    ) {
      return;
    }

    const before =
      pendingNavStart &&
      Date.now() -
        pendingNavStart.time <
        1500
        ? pendingNavStart.chatKey
        : currentChatKey();

    pendingNavStart = null;

    let handled = false;

    [
      0,
      80,
      220,
      420,
      700
    ].forEach(
      (delay) => {
        window.setTimeout(
          () => {
            syncMobileSidebarState();

            if (handled) {
              return;
            }

            const after =
              currentChatKey();

            if (
              after &&
              after !== before
            ) {
              handled = true;
              scheduleMobileAutoClose();
            }
          },
          delay
        );
      }
    );
  }

  /* ------------------------------------------------------------------
   * Component connection
   * ---------------------------------------------------------------- */

  function connectComponents() {
    const nextToolbar =
      document.querySelector(
        SELECTOR.toolbar
      );

    const nextPanel =
      document.querySelector(
        SELECTOR.panel
      );

    const nextLauncher =
      document.querySelector(
        SELECTOR.launcher
      );

    if (nextToolbar) {
      attachToolbar(
        nextToolbar
      );
    }

    if (nextPanel) {
      attachPanel(
        nextPanel
      );
    }

    if (nextLauncher) {
      attachLauncher(
        nextLauncher
      );
    }

    syncMobileSidebarState();

    return Boolean(
      toolbar &&
      panel &&
      launcher
    );
  }

  function start() {
    injectStyles();

    let componentObserver =
      null;

    if (!connectComponents()) {
      componentObserver =
        new MutationObserver(
          () => {
            if (
              connectComponents()
            ) {
              componentObserver.disconnect();
            }
          }
        );

      componentObserver.observe(
        document.documentElement,
        {
          childList: true,
          subtree: true
        }
      );
    }

    /*
     * Watch TypingMind's React DOM for drawer
     * transitions, class changes and mobile
     * navigation state changes.
     */
    const sidebarObserver =
      new MutationObserver(
        () => {
          if (
            isSmallScreen()
          ) {
            syncMobileSidebarState();
          }
        }
      );

    sidebarObserver.observe(
      document.documentElement,
      {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          "class",
          "style",
          "hidden",
          "aria-hidden",
          "data-state"
        ]
      }
    );

    document.addEventListener(
      "pointerdown",
      onGlobalPointerDown,
      true
    );

    document.addEventListener(
      "click",
      onPotentialChatNavigation,
      true
    );

    window.addEventListener(
      "hashchange",
      () => {
        if (
          currentChatKey()
        ) {
          scheduleMobileAutoClose();
        }

        syncMobileSidebarState();
      }
    );

    window.addEventListener(
      "popstate",
      () => {
        if (
          currentChatKey()
        ) {
          scheduleMobileAutoClose();
        }

        syncMobileSidebarState();
      }
    );

    window.addEventListener(
      "resize",
      () => {
        if (
          toolbar &&
          !toolbar.hidden
        ) {
          queueToolbarPosition();
        }

        syncMobileSidebarState();
      }
    );

    if (
      window.visualViewport
    ) {
      window.visualViewport
        .addEventListener(
          "resize",
          () => {
            if (
              toolbar &&
              !toolbar.hidden
            ) {
              queueToolbarPosition();
            }

            syncMobileSidebarState();
          }
        );

      window.visualViewport
        .addEventListener(
          "scroll",
          () => {
            if (
              toolbar &&
              !toolbar.hidden
            ) {
              queueToolbarPosition();
            }

            syncMobileSidebarState();
          }
        );
    }

    [
      0,
      100,
      300,
      700
    ].forEach(
      (delay) => {
        window.setTimeout(
          syncMobileSidebarState,
          delay
        );
      }
    );

    window.TMHighlighterCompactUI = {
      version: VERSION,

      resetPosition() {
        resetToolbarPosition();
        return true;
      },

      autoCloseSidebar(
        enabled
      ) {
        if (
          typeof enabled ===
          "boolean"
        ) {
          try {
            localStorage.setItem(
              AUTO_CLOSE_KEY,
              enabled
                ? "true"
                : "false"
            );
          } catch {
            /* Ignore storage restrictions. */
          }
        }

        return autoCloseEnabled();
      },

      closeMobileSidebar() {
        return closeTypingMindSidebar();
      },

      syncMobileSidebar() {
        syncMobileSidebarState();
        return true;
      }
    };

    console.info(
      `[TM Highlighter Compact UI] v${VERSION} ready.`
    );
  }

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      start,
      {
        once: true
      }
    );
  } else {
    start();
  }
})();
