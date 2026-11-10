(function () {
  if (!/Android/i.test(navigator.userAgent)) return;
  if (!window.matchMedia('(display-mode: standalone)').matches) return;

  const dark = '#161616';
  function setBar() {
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
      if (m.hasAttribute('media')) m.removeAttribute('media');
      if (m.content !== dark) m.content = dark;
    });
  }

  const s = document.createElement('style');
  s.textContent =
    'html.dark, html.dark body { background-color: ' + dark + ' !important; }' +
    '[data-element-id="chat-space-beginning-part"] {' +
    '  padding-top: max(4px, calc(env(safe-area-inset-top, 0px) - 6px)) !important;' +
    '}';
  document.head.appendChild(s);

  setBar();
  new MutationObserver(setBar).observe(document.head, { childList: true, subtree: true, attributes: true });
})();
