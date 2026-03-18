(function () {
  const MOBILE_MAX_WIDTH = 1024;
  const SCROLL_DELAY = 400;
  const MAX_RETRIES = 5;

  function isMobile() {
    return window.innerWidth <= MOBILE_MAX_WIDTH;
  }

  function getScrollableParent(el) {
    let parent = el?.parentElement;
    while (parent) {
      const style = getComputedStyle(parent);
      const overflowY = style.overflowY;
      if (
        (overflowY === 'auto' || overflowY === 'scroll') &&
        parent.scrollHeight > parent.clientHeight
      ) {
        return parent;
      }
      parent = parent.parentElement;
    }
    return null;
  }

  function scrollChatToTop(retries = 0) {
    if (!isMobile()) return;

    const firstMessage = document.querySelector(
      '[data-element-id="ai-response"], [data-element-id="user-message"]'
    );
    const scrollable = getScrollableParent(firstMessage);

    if (scrollable) {
      scrollable.scrollTop = 0;
    } else if (retries < MAX_RETRIES) {
      setTimeout(() => scrollChatToTop(retries + 1), SCROLL_DELAY);
    }
  }

  let lastChatId = null;

  function detectChatSwitch() {
    const currentId =
      window.location.hash ||
      document.querySelector('[data-chat-id]')?.getAttribute('data-chat-id') ||
      document.title;

    if (currentId !== lastChatId) {
      lastChatId = currentId;
      setTimeout(() => scrollChatToTop(0), SCROLL_DELAY);
    }
  }

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
