(() => {
  const EXT_ID = 'tm-status-bar-fix-v1';
  const COLOR = '#161616';
  const NUDGE = '#161617'; // one digit off, visually identical, forces a repaint

  let meta = null;
  let observer = null;

  function ensureRootCss() {
    const css = `
      html, body {
        background-color: ${COLOR} !important;
      }
    `;
    let style = document.getElementById(EXT_ID + '-css');
    if (!style) {
      style = document.createElement('style');
      style.id = EXT_ID + '-css';
      document.head.appendChild(style);
    }
    if (style.textContent !== css) style.textContent = css;
  }

  function ensureThemeColor() {
    // Remove every other theme-color tag, including the
    // prefers-color-scheme variants Chrome now picks between.
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
      if (m !== meta) m.remove();
    });

    if (!meta || !meta.isConnected) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      meta.setAttribute('data-ext', EXT_ID);
      meta.setAttribute('content', COLOR);
      document.head.appendChild(meta);
      return;
    }

    // Only touch attributes that are actually wrong, so the
    // observer doesn't fire itself in a loop.
    if (meta.hasAttribute('media')) meta.removeAttribute('media');
    if (meta.getAttribute('content') !== COLOR) {
      meta.setAttribute('content', COLOR);
    }
  }

  function apply() {
    if (observer) observer.disconnect();
    ensureRootCss();
    ensureThemeColor();
    if (observer) {
      observer.observe(document.head, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['name', 'content', 'media']
      });
    }
  }

  function init() {
    ensureRootCss();
    ensureThemeColor();

    // Startup nudge: Chrome repaints the system bar on a real value
    // change, so flip once to clear any stale white paint.
    meta.setAttribute('content', NUDGE);
    requestAnimationFrame(() => {
      meta.setAttribute('content', COLOR);
      observer = new MutationObserver(apply);
      apply();
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) apply();
    });
    window.addEventListener('pageshow', apply);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
