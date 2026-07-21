(() => {
  const EXT_ID = 'custom-dark-theme-only-v2';
  const COLOR = '#262626';

  const css = `
    /* ── LIGHT MODE: user message bubble (keep as-is, blue) ── */
    html:not(.dark) [data-element-id="user-message"],
    body:not(.dark) [data-element-id="user-message"] {
      background-color: #2563eb !important;
      color: #ffffff !important;
    }

    /* ── DARK MODE: user message bubble → #141414 bg + #dfdedb text ── */
    html.dark [data-element-id="user-message"],
    body.dark [data-element-id="user-message"],
    .dark [data-element-id="user-message"] {
      background-color: #141414 !important;
      color: #dfdedb !important;
    }

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
      background-color: rgba(27, 29, 33, 0) !important;
    }

    /* 9) .md:pl-[--current-sidebar-width] .overflow-y-auto .@container */
    html.dark .md\\:pl-\\[--current-sidebar-width\\] .overflow-y-auto .\\@container,
    body.dark .md\\:pl-\\[--current-sidebar-width\\] .overflow-y-auto .\\@container,
    .dark .md\\:pl-\\[--current-sidebar-width\\] .overflow-y-auto .\\@container {
      background-color: ${COLOR} !important;
    }
  `;

  function upsertStyle() {
    let style = document.getElementById(EXT_ID);

    if (!style) {
      style = document.createElement('style');
      style.id = EXT_ID;
      document.head.appendChild(style);
    }

    style.textContent = css;
  }

  function init() {
    upsertStyle();

    const watchTargets = [
      document.documentElement,
      document.body
    ].filter(Boolean);

    const observer = new MutationObserver(upsertStyle);

    for (const target of watchTargets) {
      observer.observe(target, {
        attributes: true,
        attributeFilter: ['class', 'data-theme']
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
