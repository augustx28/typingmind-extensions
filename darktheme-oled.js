/* TypingMind: menu tweaks + OLED dark theme, merged.
 *
 * OLED build: every chrome surface is true black (#000000) so OLED pixels
 * switch off instead of lighting up dark grey.
 *
 * Injection order: menu first, theme second. When both blocks target the same
 * element with equal specificity and both use !important, the theme wins.
 * If a panel comes out the wrong shade, swap the two upsertStyle() calls
 * inside apply().
 *
 * Replace the old (#161616 / #191919) script with this one. Running both
 * installs at the same time makes two MutationObservers fight over the same
 * elements.
 */

(() => {
  const MENU_ID = 'tm-menu-tweaks-oled-v1';
  const THEME_ID = 'custom-dark-theme-oled-v1';

  /* ===========================================================
     PALETTE - change colors here, not in the rules below
     =========================================================== */

  /* True black. Backgrounds, panels, nav, workspace, inputs. */
  const BG = '#000000';

  /* One step above black. Use for anything that must read as a separate
     surface (handles, dividers, raised strips). Set to BG for a fully flat
     look. */
  const SURFACE = '#0d0d0d';

  /* Grey borders vanish on black, so borders are low-opacity white instead. */
  const BORDER_COLOR = 'rgba(255, 255, 255, 0.08)';

  /* Slightly stronger border for input fields, which need a visible edge. */
  const INPUT_BORDER_COLOR = 'rgba(255, 255, 255, 0.12)';

  /* Scrollbar thumb. Low enough to disappear until you look for it. */
  const SCROLLBAR_THUMB = 'rgba(255, 255, 255, 0.14)';

  /* Accent, kept from the original. Amber holds up well on black. */
  const ACCENT = '#DA9010';

  /* ===========================================================
     BLOCK 1 - MENU / WORKSPACE TWEAKS
     =========================================================== */
  const menuCss = `
    /* =========================================
       1. Folder Icon Color Change
       ========================================= */
    svg.text-slate-400 {
      color: ${ACCENT} !important;
    }

    /* =========================================
       2. Workspace & Background Overrides
       ========================================= */
    /* Overflow hidden area background. This one sits ON TOP of the workspace
       column, so it uses SURFACE rather than BG to stay distinguishable. */
    .md\\:pl-\\[--workspace-width\\] .flex-shrink-0 .bg-\\[--workspace-color\\] .justify-center > .overflow-hidden {
      background-color: ${SURFACE} !important;
    }

    /* Sidebar/Nav handler height adjustments */
    #nav-handler .md\\:w-\\[--sidebar-width\\] .h-\\[var\\(--workspace-height\\)\\] {
      background-color: ${BG} !important;
    }

    /* Workspace color generic */
    .md\\:w-auto .flex-col .bg-\\[--workspace-color\\] {
      background-color: ${BG} !important;
    }

    /* Transition opacity container (Background) */
    .md\\:w-auto .flex-col .flex-col .md\\:pl-\\[--workspace-width\\] > .transition-opacity {
      background-color: ${BG} !important;
    }

    /* Navigation container */
    .md\\:w-auto .flex-col .md\\:pl-\\[--workspace-width\\] {
      background-color: ${BG} !important;
    }

    /* Nav handler specific height vars */
    #nav-handler .h-\\[--workspace-height\\] .h-\\[var\\(--workspace-height\\)\\] {
      background-color: ${BG} !important;
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
      background-color: ${BG};
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
       tabs. Installing or removing an extension that adds a tab shifts every
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
     BLOCK 2 - OLED THEME
     =========================================================== */
  const themeCss = `
    /* 0) Root surfaces. Without these, overscroll bounce and any gutter the
          app does not paint show up as the browser's default dark grey. */
    html.dark,
    body.dark,
    html.dark body {
      background-color: ${BG} !important;
    }

    /* 1) .md:flex .overflow-y-auto .resize-container */
    html.dark .md\\:flex .overflow-y-auto .resize-container,
    body.dark .md\\:flex .overflow-y-auto .resize-container,
    .dark .md\\:flex .overflow-y-auto .resize-container {
      background-color: ${BG} !important;
    }
    /* 2) .resize-container .flex-col .dark:bg-[--main-dark-color] */
    html.dark .resize-container .flex-col .dark\\:bg-\\[--main-dark-color\\],
    body.dark .resize-container .flex-col .dark\\:bg-\\[--main-dark-color\\],
    .dark .resize-container .flex-col .dark\\:bg-\\[--main-dark-color\\] {
      background-color: ${BG} !important;
    }
    /* 3) #nav-handler .transition-all .overflow-y-auto > .dark:bg-[--main-dark-color] */
    html.dark #nav-handler .transition-all .overflow-y-auto > .dark\\:bg-\\[--main-dark-color\\],
    body.dark #nav-handler .transition-all .overflow-y-auto > .dark\\:bg-\\[--main-dark-color\\],
    .dark #nav-handler .transition-all .overflow-y-auto > .dark\\:bg-\\[--main-dark-color\\] {
      background-color: ${BG} !important;
    }
    /* 4) #nav-handler .transition-all .@container */
    html.dark #nav-handler .transition-all .\\@container,
    body.dark #nav-handler .transition-all .\\@container,
    .dark #nav-handler .transition-all .\\@container {
      background-color: ${BG} !important;
    }
    /* 5) #__next .custom-theme */
    html.dark #__next .custom-theme,
    body.dark #__next .custom-theme,
    .dark #__next .custom-theme {
      background-color: ${BG} !important;
    }
    /* 6) .overflow-auto div .lg:sticky */
    html.dark .overflow-auto div .lg\\:sticky,
    body.dark .overflow-auto div .lg\\:sticky,
    .dark .overflow-auto div .lg\\:sticky {
      background-color: ${BG} !important;
    }
    /* 7) .overflow-auto div .sticky */
    html.dark .overflow-auto div .sticky,
    body.dark .overflow-auto div .sticky,
    .dark .overflow-auto div .sticky {
      background-color: ${BG} !important;
    }
    /* 8) .md:pl-[--current-sidebar-width] .text-sm .dark:bg-[--main-dark-color]
          Left transparent, same as the original, so the layer underneath
          shows through. */
    html.dark .md\\:pl-\\[--current-sidebar-width\\] .text-sm .dark\\:bg-\\[--main-dark-color\\],
    body.dark .md\\:pl-\\[--current-sidebar-width\\] .text-sm .dark\\:bg-\\[--main-dark-color\\],
    .dark .md\\:pl-\\[--current-sidebar-width\\] .text-sm .dark\\:bg-\\[--main-dark-color\\] {
      background-color: transparent !important;
    }
    /* 9) .md:pl-[--current-sidebar-width] .overflow-y-auto .@container */
    html.dark .md\\:pl-\\[--current-sidebar-width\\] .overflow-y-auto .\\@container,
    body.dark .md\\:pl-\\[--current-sidebar-width\\] .overflow-y-auto .\\@container,
    .dark .md\\:pl-\\[--current-sidebar-width\\] .overflow-y-auto .\\@container {
      background-color: ${BG} !important;
    }
    /* 10) Output/response box outline. Response IDs are dynamic
           (#response-<uuid>), so match the prefix instead of a single
           hardcoded ID. */
    html.dark [id^="response-"] .sm\\:px-6,
    body.dark [id^="response-"] .sm\\:px-6,
    .dark [id^="response-"] .sm\\:px-6 {
      border-color: ${BORDER_COLOR} !important;
    }

    /* 11) Search bar. Was its own script with no observer, so it stopped
           applying whenever TypingMind re-rendered the sidebar. Folded in
           here so the MutationObserver below keeps it alive. A black input
           on a black panel is invisible, so it gets a hairline border. */
    html.dark input[data-element-id="search-chats-bar"],
    body.dark input[data-element-id="search-chats-bar"],
    .dark input[data-element-id="search-chats-bar"],
    input[data-element-id="search-chats-bar"] {
      background-color: ${BG} !important;
      border: 1px solid ${INPUT_BORDER_COLOR} !important;
    }

    /* 12) Scrollbars. The default light thumb is the brightest thing left on
           a black page. Delete this rule if you prefer the stock look. */
    html.dark .custom-scrollbar::-webkit-scrollbar,
    body.dark .custom-scrollbar::-webkit-scrollbar,
    .dark .custom-scrollbar::-webkit-scrollbar {
      background-color: transparent !important;
    }
    html.dark .custom-scrollbar::-webkit-scrollbar-thumb,
    body.dark .custom-scrollbar::-webkit-scrollbar-thumb,
    .dark .custom-scrollbar::-webkit-scrollbar-thumb {
      background-color: ${SCROLLBAR_THUMB} !important;
      border-radius: 8px !important;
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
