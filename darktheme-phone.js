/* TypingMind: menu tweaks + dark theme, merged.
 *
 * Injection order: menu first, theme second. When both blocks target the same
 * element with equal specificity and both use !important, the theme wins.
 * If a panel comes out the wrong shade, swap the two upsertStyle() calls
 * inside apply().
 */

(() => {
  const MENU_ID = 'tm-menu-tweaks-v1';
  const THEME_ID = 'custom-dark-theme-only-v2';

  const COLOR = '#161616';
  const BORDER_COLOR = 'rgba(54, 55, 57, 0.6)';

  /* ===========================================================
     BLOCK 1 - MENU / WORKSPACE TWEAKS
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

  /* ===========================================================
     BLOCK 2 - DARK THEME
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
    /* 8) .md:pl-[--current-sidebar-width] .text-sm .dark:bg-[--main-dark-color] */
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
    /* 10) Output/response box outline. Response IDs are dynamic (#response-<uuid>),
           so match the prefix instead of a single hardcoded ID. */
    html.dark [id^="response-"] .sm\\:px-6,
    body.dark [id^="response-"] .sm\\:px-6,
    .dark [id^="response-"] .sm\\:px-6 {
      border-color: ${BORDER_COLOR} !important;
    }
  `;

  /* ===========================================================
     INJECTION
     =========================================================== */
  function upsertStyle(id, css) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('style');
      el.id = id;
      document.head.appendChild(el);
    }
    if (el.textContent !== css) el.textContent = css;
  }

  function apply() {
    upsertStyle(MENU_ID, menuCss);
    upsertStyle(THEME_ID, themeCss);
  }

  function init() {
    apply();
    const watchTargets = [document.documentElement, document.body].filter(Boolean);
    const observer = new MutationObserver(apply);
    for (const t of watchTargets) {
      observer.observe(t, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    }
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
