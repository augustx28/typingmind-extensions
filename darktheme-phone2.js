(() => {
  const EXT_ID = 'custom-dark-theme-only-v2';
  const COLOR = '#000000';
  const BORDER_COLOR = 'rgba(54, 55, 57, 0.6)';
  const css = `
    /* 0a) Root + body. This is what shows behind the Android nav bar. */
    html.dark, body.dark, .dark,
    html.dark body, body.dark body {
      background-color: ${COLOR} !important;
    }
    /* 0b) Kill the app's gray variable so untargeted panels inherit black */
    html.dark, body.dark, .dark, :root {
      --main-dark-color: ${COLOR} !important;
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
    /* 11) Safe-area filler strips at the very bottom of the viewport */
    html.dark [style*="safe-area-inset-bottom"],
    body.dark [style*="safe-area-inset-bottom"],
    .dark [style*="safe-area-inset-bottom"] {
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
    if (style.textContent !== css) style.textContent = css;
  }
  function upsertThemeColor() {
    const metas = document.querySelectorAll('meta[name="theme-color"]');
    if (metas.length === 0) {
      const meta = document.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      meta.setAttribute('content', COLOR);
      document.head.appendChild(meta);
      return;
    }
    for (const meta of metas) {
      if (meta.getAttribute('content') !== COLOR) {
        meta.setAttribute('content', COLOR);
      }
    }
  }
  function apply() {
    upsertStyle();
    upsertThemeColor();
  }
  function init() {
    apply();
    const observer = new MutationObserver(apply);
    const watchTargets = [document.documentElement, document.body].filter(Boolean);
    for (const t of watchTargets) {
      observer.observe(t, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    }
    if (document.head) {
      observer.observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ['content'] });
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
