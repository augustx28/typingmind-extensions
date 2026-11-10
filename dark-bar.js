(function () {
  if (!/Android/i.test(navigator.userAgent)) return;
  if (!window.matchMedia('(display-mode: standalone)').matches) return;

  const dark = '#171717';

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
  style.id = 'tm-android-safe-top';
  style.textContent = [
    'html, body { background-color: var(--main-dark-color, ' + dark + ') !important; }',
    '#__next {',
    '  position: fixed !important;',
    '  top: env(safe-area-inset-top, 0px) !important;',
    '  left: 0 !important;',
    '  right: 0 !important;',
    '  bottom: 0 !important;',
    '  transform: translateZ(0) !important;',
    '}',
    '[data-element-id="main-content-area"] > main {',
    '  height: calc(100dvh - env(safe-area-inset-top, 0px)) !important;',
    '  max-height: calc(100dvh - env(safe-area-inset-top, 0px)) !important;',
    '}',
    '#headlessui-portal-root [role="dialog"] {',
    '  padding-top: env(safe-area-inset-top, 0px) !important;',
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
