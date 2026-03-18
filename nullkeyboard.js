(function () {
  const CHAT_INPUT_SELECTOR = '#chat-input-textbox, [data-element-id="chat-input-textbox"]';
  let userClicked = false;

  document.addEventListener('mousedown', (e) => {
    if (e.target.closest(CHAT_INPUT_SELECTOR)) userClicked = true;
  });

  document.addEventListener(
    'focusin',
    (e) => {
      if (userClicked) {
        userClicked = false;
        return;
      }
      const el = e.target.closest(CHAT_INPUT_SELECTOR);
      if (el) el.blur();
    },
    true
  );
})();
