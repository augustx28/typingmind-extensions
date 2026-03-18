(function () {
  'use strict';

  const SCROLL_DELAY = 300; // ms after chat loads before scrolling
  let lastChatId = null;

  function getChatContainer() {
    // TypingMind's main scrollable chat area
    return (
      document.querySelector('[class*="conversation"]') ||
      document.querySelector('[data-element-id="chat-space-middle-part"]') ||
      document.querySelector('.overflow-y-auto[class*="flex-1"]') ||
      document.querySelector('main .overflow-y-auto')
    );
  }

  function getCurrentChatId() {
    // Grab chat ID from URL hash or a unique attribute in DOM
    const hash = window.location.hash;
    if (hash) return hash;
    const activeChat = document.querySelector('[class*="chat"][class*="active"]');
    if (activeChat) return activeChat.textContent?.slice(0, 40);
    // Fallback: first message content as fingerprint
    const firstMsg = document.querySelector('[data-element-id="chat-space-middle-part"]');
    return firstMsg ? firstMsg.children.length + '-' + (firstMsg.scrollHeight || 0) : null;
  }

  function scrollToTop() {
    const container = getChatContainer();
    if (!container) return;

    // Try to find the first heading in the chat output
    const firstHeading = container.querySelector('h1, h2, h3');
    if (firstHeading) {
      firstHeading.scrollIntoView({ behavior: 'instant', block: 'start' });
    } else {
      container.scrollTop = 0;
    }
  }

  function checkForChatSwitch() {
    const currentId = getCurrentChatId();
    if (currentId && currentId !== lastChatId) {
      lastChatId = currentId;
      // Wait for messages to render, then scroll
      setTimeout(scrollToTop, SCROLL_DELAY);
      // Second pass in case lazy-loaded content shifts things
      setTimeout(scrollToTop, SCROLL_DELAY + 400);
    }
  }

  // Watch for DOM changes that indicate a chat switch
  const observer = new MutationObserver(() => {
    checkForChatSwitch();
  });

  function init() {
    const target =
      document.querySelector('[data-element-id="chat-space-middle-part"]') ||
      document.querySelector('main') ||
      document.body;

    observer.observe(target, { childList: true, subtree: true });

    // Also catch hash changes (TypingMind uses hash routing)
    window.addEventListener('hashchange', () => {
      setTimeout(scrollToTop, SCROLL_DELAY);
      setTimeout(scrollToTop, SCROLL_DELAY + 400);
    });

    // Initial check
    lastChatId = getCurrentChatId();
  }

  // Wait for TypingMind to fully load
  if (document.readyState === 'complete') {
    init();
  } else {
    window.addEventListener('load', init);
  }
})();
