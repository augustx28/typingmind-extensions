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

    /* 11) FIX — DARK MODE: native <select> dropdown lists.
       The theme repaints the app's own surfaces, but the open list of a
       native <select> is drawn by the browser using the select/option
       colors, which nothing above ever sets. The options fell through
       with low-contrast gray on a dark popup (nearly invisible).
       This makes them readable and tells the browser to render the
       popup itself as dark. Light mode is untouched. */
    html.dark select,
    body.dark select,
    .dark select {
      color-scheme: dark !important;
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

    /* Keep genuinely disabled options visually distinct */
    html.dark select option:disabled,
    body.dark select option:disabled,
    .dark select option:disabled {
      color: #8a8a8a !important;
    }
  `;

  function upsertStyle() {
    let style = document.getElementById(EXT_ID);

    if (!style) {
      style = document.createElement('style');
      style.id = EXT_ID;
      document.head.appendChild(style);
    }

    /* FIX: only rewrite when the content actually changed, otherwise every
       class flip on <html>/<body> forces a full style recalculation. */
    if (style.textContent !== css) {
      style.textContent = css;
    }
  }

  function init() {
    upsertStyle();

    const watchTargets = [
      document.documentElement,
      document.body
    ].filter(Boolean);

    const observer = new MutationObserver(upsertStyle);

    for (const t of watchTargets) {
      observer.observe(t, {
        attributes: true,
        attributeFilter: ['class', 'data-theme']
      });
    }

    /* FIX: re-inject the style tag if the app ever re-renders <head> and
       drops it (before, the theme would silently die until the next
       light/dark toggle). Safe from loops thanks to the equality check. */
    observer.observe(document.head, { childList: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
