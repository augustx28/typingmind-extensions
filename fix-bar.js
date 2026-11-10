(function () {
  if (!/Android/i.test(navigator.userAgent)) return;
  if (!window.matchMedia('(display-mode: standalone)').matches) return;

  const dark = '#161616';
  const topGap = 'max(0px, calc(env(safe-area-inset-top, 0px) - 6px))';

  function keepDarkBar() {
    const metas = document.querySelectorAll('meta[name="theme-color"]');
    if (!metas.length) {
      const m = document.createElement('meta');
      m.name = 'theme-color';
      m.content = dark;
      document.head.appendChild(m);
    } else {
      metas.forEach((m) => {
        if (m.hasAttribute('media')) m.removeAttribute('media');
        if (m.content !== dark) m.content = dark;
      });
    }
  }

  const style = document.createElement('style');
  style.id = 'tm-android-safe-top-v4';
  style.textContent = [
    'html, body { background-color: ' + dark + ' !important; }',
    '#__next {',
    '  position: fixed !important;',
    '  top: ' + topGap + ' !important;',
    '  left: 0 !important;',
    '  right: 0 !important;',
    '  bottom: 0 !important;',
    '  transform: translateZ(0) !important;',
    '}',
    '[data-element-id="main-content-area"] > main {',
    '  height: calc(100dvh - ' + topGap + ' - var(--workspace-height, 0px)) !important;',
    '  max-height: calc(100dvh - ' + topGap + ' - var(--workspace-height, 0px)) !important;',
    '}',
    '[data-element-id="main-content-area"]:not(:has([data-element-id="chat-space-middle-part"])) main,',
    '[data-element-id="main-content-area"]:not(:has([data-element-id="chat-space-middle-part"])) .overflow-y-auto {',
    '  padding-bottom: 90px !important;',
    '}',
    '#headlessui-portal-root [role="dialog"] {',
    '  padding-top: ' + topGap + ' !important;',
    '}'
  ].join('\n');

  if (!document.getElementById(style.id)) {
    document.head.appendChild(style);
  }

  keepDarkBar();
  new MutationObserver(keepDarkBar).observe(document.head, {
    childList: true,
    subtree: true,
    attributes: true
  });
})();
