(function () {
  let lastChatId = null;

  function getScrollContainer() {
    // TypingMind's main chat scroll container
    return document.querySelector('[class*="conversation-messages"]')
      || document.querySelector('.overflow-y-auto[class*="flex-1"]')
      || document.querySelector('#chat-container .overflow-y-auto')
      || document.querySelector('main .overflow-y-auto');
  }

  function getCurrentChatId() {
    const match = window.location.hash.match(/chat\/([^/]+)/);
    return match ? match[1] : document.querySelector('[data-chat-id]')?.dataset?.chatId || null;
  }

  function scrollToTop() {
    const container = getScrollContainer();
    if (container) {
      // Small delay to let TypingMind finish its own scroll-to-bottom
      setTimeout(() => {
        container.scrollTop = 0;
      }, 150);
      // Double tap in case TypingMind fights back
      setTimeout(() => {
        container.scrollTop = 0;
      }, 500);
    }
  }

  // Watch for chat switches via URL hash changes
  window.addEventListener('hashchange', () => {
    const newId = getCurrentChatId();
    if (newId && newId !== lastChatId) {
      lastChatId = newId;
      scrollToTop();
    }
  });

  // Watch for DOM changes that signal a new chat loaded
  const observer = new MutationObserver(() => {
    const newId = getCurrentChatId();
    if (newId && newId !== lastChatId) {
      lastChatId = newId;
      scrollToTop();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Initial scroll on load
  setTimeout(scrollToTop, 1000);
})();
