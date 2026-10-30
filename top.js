(() => {
  if (document.getElementById('tm-safe-area')) return;
  const style = document.createElement('style');
  style.id = 'tm-safe-area';
  style.textContent = `
    :root {
      --tm-top: max(env(safe-area-inset-top, 0px), 28px);
      --tm-bottom: max(env(safe-area-inset-bottom, 0px), 16px);
    }
    html, body {
      background-color: #0f0f0f !important;
    }
    body {
      padding-top: var(--tm-top) !important;
      padding-bottom: var(--tm-bottom) !important;
      box-sizing: border-box !important;
    }
    body::before {
      content: '';
      position: fixed;
      top: 0; left: 0; right: 0;
      height: var(--tm-top);
      background: #0f0f0f;
      z-index: 9999;
      pointer-events: none;
    }
    body::after {
      content: '';
      position: fixed;
      bottom: 0; left: 0; right: 0;
      height: var(--tm-bottom);
      background: #0f0f0f;
      z-index: 9999;
      pointer-events: none;
    }
  `;
  document.head.appendChild(style);
})();
