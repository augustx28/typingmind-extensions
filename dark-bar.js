(function () {
  const dark = '#171717';

  function applyFix() {
    let vp = document.querySelector('meta[name="viewport"]');
    if (!vp) {
      vp = document.createElement('meta');
      vp.name = 'viewport';
      document.head.appendChild(vp);
    }
    if (!vp.content.includes('viewport-fit=cover')) {
      vp.content = (vp.content ? vp.content + ', ' : '') + 'viewport-fit=cover';
    }

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
  style.textContent = [
    'html, body { background-color: ' + dark + ' !important; }',
    'body { padding-bottom: env(safe-area-inset-bottom, 0px) !important; box-sizing: border-box !important; }'
  ].join('\n');
  document.head.appendChild(style);

  applyFix();
  new MutationObserver(applyFix).observe(document.head, {
    childList: true,
    subtree: true,
    attributes: true
  });
})();
