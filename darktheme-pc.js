(() => {
  const EXT_ID = 'darktheme-pc';
  const COLOR = '#262626';

  /* ===========================================================
     BLOCK A - BASE DARK THEME
     =========================================================== */
  const themeCss = `
    /* 1) .md:flex .overflow-y-auto .resize-container */
    html.dark .md\\:flex .overflow-y-auto .resize-container,
    body.dark .md\\:flex .overflow-y-auto .resize-container,
    .dark .md\\:flex .overflow-y-auto .resize-container {
      background-color: ${COLOR} !important;
    }

    /* 2) .resize-container .flex-col .dark:bg-[--main-dark-color] */
    html.dark .resize-container .flex-col .dark\\:bg-\\[--main-dark-color\\],
    body.dark .resize-container .flex-col .dark\\:bg-\\[--main-dark-color\\],
    .dark .resize-container .flex-col .dark\\:bg-\\[--main-dark-color\\] {
      background-color: ${COLOR} !important;
    }

    /* 3) #nav-handler .transition-all .overflow-y-auto > .dark:bg-[--main-dark-color] */
    html.dark #nav-handler .transition-all .overflow-y-auto > .dark\\:bg-\\[--main-dark-color\\],
    body.dark #nav-handler .transition-all .overflow-y-auto > .dark\\:bg-\\[--main-dark-color\\],
    .dark #nav-handler .transition-all .overflow-y-auto > .dark\\:bg-\\[--main-dark-color\\] {
      background-color: ${COLOR} !important;
    }

    /* 4) #nav-handler .transition-all .@container */
    html.dark #nav-handler .transition-all .\\@container,
    body.dark #nav-handler .transition-all .\\@container,
    .dark #nav-handler .transition-all .\\@container {
      background-color: ${COLOR} !important;
    }

    /* 5) #__next .custom-theme */
    html.dark #__next .custom-theme,
    body.dark #__next .custom-theme,
    .dark #__next .custom-theme {
      background-color: ${COLOR} !important;
    }

    /* 6) .overflow-auto div .lg:sticky */
    html.dark .overflow-auto div .lg\\:sticky,
    body.dark .overflow-auto div .lg\\:sticky,
    .dark .overflow-auto div .lg\\:sticky {
      background-color: ${COLOR} !important;
    }

    /* 7) .overflow-auto div .sticky */
    html.dark .overflow-auto div .sticky,
    body.dark .overflow-auto div .sticky,
    .dark .overflow-auto div .sticky {
      background-color: ${COLOR} !important;
    }

    /* 8) .md:pl-[--current-sidebar-width] .text-sm .dark:bg-[--main-dark-color] (Transparent) */
    html.dark .md\\:pl-\\[--current-sidebar-width\\] .text-sm .dark\\:bg-\\[--main-dark-color\\],
    body.dark .md\\:pl-\\[--current-sidebar-width\\] .text-sm .dark\\:bg-\\[--main-dark-color\\],
    .dark .md\\:pl-\\[--current-sidebar-width\\] .text-sm .dark\\:bg-\\[--main-dark-color\\] {
      background-color: rgba(27,29,33,0) !important;
    }

    /* 9) .md:pl-[--current-sidebar-width] .overflow-y-auto .@container */
    html.dark .md\\:pl-\\[--current-sidebar-width\\] .overflow-y-auto .\\@container,
    body.dark .md\\:pl-\\[--current-sidebar-width\\] .overflow-y-auto .\\@container,
    .dark .md\\:pl-\\[--current-sidebar-width\\] .overflow-y-auto .\\@container {
      background-color: ${COLOR} !important;
    }

    /* 10) DARK MODE DESKTOP/TABLET:
       Make chat response borders extremely subtle.
       Uses [id^="response-"] so it works across all response IDs/models.
       Mobile is left untouched. */
    @media (min-width: 768px) {
      html.dark [id^="response-"] .sm\\:px-6,
      body.dark [id^="response-"] .sm\\:px-6,
      .dark [id^="response-"] .sm\\:px-6,

      html.dark [id^="response-"] > [class*="border"],
      body.dark [id^="response-"] > [class*="border"],
      .dark [id^="response-"] > [class*="border"],

      html.dark [id^="response-"] > div > [class*="border"],
      body.dark [id^="response-"] > div > [class*="border"],
      .dark [id^="response-"] > div > [class*="border"] {
        border-color: rgba(75, 85, 99, 0.09) !important;
      }
    }

    /* 11) FIX — DARK MODE: native <select> dropdowns.
       Native <option> items don't inherit the app's dark styling, so when a
       dropdown opens (e.g. "API Type" in Add Custom Model) the list items
       were unreadable against the dark popup. Give the select's popup an
       explicit dark palette with readable text. */
    html.dark select,
    body.dark select,
    .dark select {
      color-scheme: dark;
    }

    html.dark select option,
    body.dark select option,
    .dark select option,
    html.dark select optgroup,
    body.dark select optgroup,
    .dark select optgroup {
      background-color: ${COLOR} !important;
      color: #dfdedb !important;
    }

    /* Keep the hovered / currently-selected item clearly visible */
    html.dark select option:hover,
    body.dark select option:hover,
    .dark select option:hover,
    html.dark select option:checked,
    body.dark select option:checked,
    .dark select option:checked {
      background-color: #2563eb !important;
      color: #ffffff !important;
    }

    /* Disabled options: dimmed but still readable */
    html.dark select option:disabled,
    body.dark select option:disabled,
    .dark select option:disabled {
      color: rgba(223, 222, 219, 0.45) !important;
    }

    /* 12) FIX — no transitions/animations on dropdown items.
       The native popup snapshots its colors the instant it opens; if the
       app animates color changes, the popup can capture a mid-transition
       (dark-on-dark) frame and only correct itself later. Zeroing these
       makes the final themed colors apply instantly. Scoped to <option>/
       <optgroup> only, so nothing else in the UI loses its animations. */
    html.dark select option,
    body.dark select option,
    .dark select option,
    html.dark select optgroup,
    body.dark select optgroup,
    .dark select optgroup {
      transition: none !important;
      animation: none !important;
    }
  `;

  /* ===========================================================
     BLOCK B - MENU / WORKSPACE TWEAKS

     Loaded AFTER the theme block so these win any tie where both
     blocks hit the same element with equal specificity. These rules
     are intentionally not .dark-scoped, matching the original menu
     extension, so they apply in light mode too.
     =========================================================== */
  const menuCss = `
    /* =========================================
       1. Folder Icon Color Change
       ========================================= */
    svg.text-slate-400 {
      color: #DA9010 !important;
    }

    /* =========================================
       2. Workspace & Background Overrides
       ========================================= */
    /* Overflow hidden area background */
    .md\\:pl-\\[--workspace-width\\] .flex-shrink-0 .bg-\\[--workspace-color\\] .justify-center > .overflow-hidden {
      background-color: #38383c !important;
    }

    /* Sidebar/Nav handler height adjustments */
    #nav-handler .md\\:w-\\[--sidebar-width\\] .h-\\[var\\(--workspace-height\\)\\] {
      background-color: #191919 !important;
    }

    /* Workspace color generic */
    .md\\:w-auto .flex-col .bg-\\[--workspace-color\\] {
      background-color: #191919 !important;
    }

    /* Transition opacity container (Background) */
    .md\\:w-auto .flex-col .flex-col .md\\:pl-\\[--workspace-width\\] > .transition-opacity {
      background-color: #191919 !important;
    }

    /* Navigation container */
    .md\\:w-auto .flex-col .md\\:pl-\\[--workspace-width\\] {
      background-color: #191919 !important;
    }

    /* Nav handler specific height vars */
    #nav-handler .h-\\[--workspace-height\\] .h-\\[var\\(--workspace-height\\)\\] {
      background-color: #191919 !important;
    }

    /* =========================================
       3. Navigation & Header Adjustments
       ========================================= */
    /* Svg positioning */
    #nav-handler .md\\:flex .w-5 {
      position: relative;
      top: 3px;
    }

    /* Division background color */
    #nav-handler .md\\:w-\\[--workspace-width\\] .md\\:flex {
      background-color: #191919;
    }

    /* Hide Span Tag (visibility hidden) */
    #nav-handler .md\\:flex .md\\:leading-none {
      visibility: hidden;
    }

    /* Transition opacity (Opacity Level) */
    .md\\:w-auto .flex-shrink-0 .transition-opacity {
      opacity: 0.3;
    }

    /* Hide Font Bold Elements (1st & 2nd child) */
    .md\\:pl-\\[--current-sidebar-width\\] .sm\\:block .font-bold:nth-child(1) {
      visibility: hidden;
    }

    .md\\:pl-\\[--current-sidebar-width\\] .sm\\:block .font-bold:nth-child(2) {
      visibility: hidden;
    }

    /* =========================================
       4. Homepage Logo
       ========================================= */
    .antialiased > .justify-start > .justify-start img {
      visibility: hidden !important;
    }

    /* =========================================
       5. Mobile Media Queries
       ========================================= */
    /* NOTE: every rule removed from this section targeted a workspace tab by
       its child index (:nth-child(8), (10), (11)) and nudged it with
       position/left/width. Those indices only hold for one exact number of
       tabs -- installing or removing an extension that adds a tab shifts every
       later index by one, so the offsets land on the wrong tab and it overlaps
       its neighbour. Anything index-independent is kept below. If a tab needs
       nudging again, target it by [data-element-id="workspace-tab-..."], which
       does not move when the tab count changes. */

    /* Max-width: 585.991px */
    @media (max-width: 585.991px) {
      /* Span Tag positioning */
      .overflow-x-auto .justify-center .md\\:leading-none {
        position: relative;
        top: 2px;
      }
    }

    /* Max-width: 499.995px */
    @media (max-width: 499.995px) {
      /* Text white margins */
      .overflow-x-auto .justify-start .text-white {
        margin-left: 2px;
        margin-right: 2px;
      }
    }

    /* Max-width: 498.991px */
    @media (max-width: 498.991px) {
      /* Force reset transform on deep nested justify-start */
      #__next .custom-theme #nav-handler .md\\:pl-\\[--current-sidebar-width\\] .overflow-y-auto .resize-container .flex-col .custom-scrollbar .dynamic-chat-content-container .antialiased .justify-start .justify-start:nth-child(1) .justify-start {
        transform: translatex(0px) translatey(0px) !important;
      }
    }
  `;

  /* Single stylesheet. Theme first, menu second: later rules win ties.
     Swap these two if you want the theme to override the menu instead. */
  const css = themeCss + menuCss;

  /* Tracks the current live <style> element so we can guard its contents. */
  let styleEl = null;

  /* Watches OUR style tag itself. If anything else (e.g. an older copy of
     this script still installed, or an app cleanup pass) rewrites or empties
     it, we restore the correct CSS immediately instead of waiting for the
     next theme-class change — which was the "dark for a few seconds, then
     correct" window. Safe from loops: our own restore writes identical
     content, so the follow-up callback is a no-op. */
  const contentGuard = new MutationObserver(upsertStyle);

  function upsertStyle() {
    let style = document.getElementById(EXT_ID);

    if (!style) {
      style = document.createElement('style');
      style.id = EXT_ID;
      document.head.appendChild(style);
    }

    /* Only write when the content actually differs — avoids forcing a
       style recalc on every unrelated mutation. */
    if (style.textContent !== css) {
      style.textContent = css;
    }

    /* FIX: keep our tag as the LAST element in <head>. TypingMind lazy-loads
       CSS chunks (e.g. when the Models modal opens); if one lands after us,
       it wins !important ties by source order. Staying last guarantees our
       rules always take priority. appendChild on an existing node just moves
       it, and we skip the call when already last, so no churn. */
    if (document.head.lastElementChild !== style) {
      document.head.appendChild(style);
    }

    /* (Re)attach the content guard whenever the tag instance changes. */
    if (style !== styleEl) {
      styleEl = style;
      contentGuard.disconnect();
      contentGuard.observe(style, {
        childList: true,
        characterData: true,
        subtree: true
      });
    }
  }

  /* FIX: runs in the capture phase BEFORE the browser opens a dropdown
     (mouse, keyboard, or focus). Re-asserts the stylesheet and forces a
     synchronous style flush on the select, so the popup's very first paint
     already uses the final themed colors — no dark-on-dark frame. Costs
     nothing for non-select targets (single early return). */
  function flushSelectStyles(e) {
    const t = e.target;
    const sel = t && typeof t.closest === 'function' ? t.closest('select') : null;
    if (!sel) return;

    upsertStyle();
    void getComputedStyle(sel).color; /* forces the flush */
  }

  function init() {
    upsertStyle();

    const observer = new MutationObserver(upsertStyle);

    const watchTargets = [
      document.documentElement,
      document.body
    ].filter(Boolean);

    for (const t of watchTargets) {
      observer.observe(t, {
        attributes: true,
        attributeFilter: ['class', 'data-theme']
      });
    }

    /* Re-inject the style tag if the app ever wipes/replaces <head> content,
       and re-assert last position when new stylesheets are appended. */
    if (document.head) {
      observer.observe(document.head, { childList: true });
    }

    document.addEventListener('mousedown', flushSelectStyles, true);
    document.addEventListener('keydown', flushSelectStyles, true);
    document.addEventListener('focusin', flushSelectStyles, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
(() => {
  const styleId = 'typingmind-search-bar-color';

  function apply() {
    let style = document.getElementById(styleId);

    if (!style) {
      style = document.createElement('style');
      style.id = styleId;
      document.head.appendChild(style);
    }

    style.textContent = `
      input[data-element-id="search-chats-bar"] {
        background-color: #131212 !important;
      }
    `;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply, { once: true });
  } else {
    apply();
  }
})();
