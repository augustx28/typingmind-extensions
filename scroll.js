(function () {
  const MOBILE_MAX_WIDTH = 1024;
  const SCROLL_DELAY = 300;

  function isMobile() {
    return window.innerWidth <= MOBILE_MAX_WIDTH;
  }

  function scrollChatToTop() {
    if (!isMobile()) return;
    const chatContainer =
      document.querySelector('[class*="chat-messages"]') ||
      document.querySelector('.prose')?.closest('[style*="overflow"]') ||
      document.querySelector('main [style*="overflow-y"]') ||
      document.querySelector('main');

    if (chatContainer) {
      chatContainer.scrollTop = 0;
    }
  }

  let lastChatId = null;

  function detectChatSwitch() {
    // TypingMind changes the URL hash or a data attribute when switching chats
    const currentId =
      window.location.hash ||
      document.querySelector('[data-chat-id]')?.getAttribute('data-chat-id') ||
      document.title;

    if (currentId !== lastChatId) {
      lastChatId = currentId;
      setTimeout(scrollChatToTop, SCROLL_DELAY);
    }
  }

  // Watch for DOM changes that signal a chat switch
  const observer = new MutationObserver(() => {
    detectChatSwitch();
  });

  function init() {
    const target = document.querySelector('main') || document.body;
    observer.observe(target, { childList: true, subtree: true });
    detectChatSwitch();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
