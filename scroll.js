(function () {
  'use strict';

  const SCROLL_DELAY = 300; // ms after chat loads, tweak if needed

  function scrollToFirstResponse() {
    const chatContainer = document.querySelector('[class*="conversation"]') ||
      document.querySelector('main [class*="overflow-auto"]') ||
      document.querySelector('main [class*="scroll"]');

    if (!chatContainer) return;

    // Try first assistant message or first heading
    const target =
      chatContainer.querySelector('[data-role="assistant"], [class*="assistant"]') ||
      chatContainer.querySelector('h1, h2, h3');

    if (target) {
      target.scrollIntoView({ behavior: 'instant', block: 'start' });
    } else {
      chatContainer.scrollTop = 0;
    }
  }

  // Watch for chat switching (URL hash or DOM changes)
  let lastChat = location.hash;

  const observer = new MutationObserver(() => {
    const currentChat = location.hash;
    if (currentChat !== lastChat) {
      lastChat = currentChat;
      setTimeout(scrollToFirstResponse, SCROLL_DELAY);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Also catch popstate (back/forward nav)
  window.addEventListener('popstate', () => {
    setTimeout(scrollToFirstResponse, SCROLL_DELAY);
  });

  // Fallback: hashchange
  window.addEventListener('hashchange', () => {
    lastChat = location.hash;
    setTimeout(scrollToFirstResponse, SCROLL_DELAY);
  });
})();
