(function () {
  const SELECTOR = 'textarea, [contenteditable="true"]';
  let userClicked = false;

  // Track intentional clicks on the input area
  document.addEventListener('mousedown', (e) => {
    if (e.target.closest(SELECTOR)) userClicked = true;
  });

  // Blur the input whenever it gets focus, unless the user clicked it
  document.addEventListener(
    'focusin',
    (e) => {
      if (userClicked) {
        userClicked = false;
        return;
      }
      const el = e.target.closest(SELECTOR);
      if (el) el.blur();
    },
    true
  );
})();
