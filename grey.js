(function () {
  const BOX_COLOR  = '#131212'; // search box background
  const TEXT_COLOR = '#e5e5e5'; // text and placeholder inside it

  function paint() {
    const input = document.querySelector('input[placeholder*="Search chats" i]');
    if (!input) return;

    input.style.setProperty('background-color', BOX_COLOR, 'important');
    input.style.setProperty('color', TEXT_COLOR, 'important');
    input.style.setProperty('border-color', BOX_COLOR, 'important');

    const wrap = input.parentElement;
    if (wrap) {
      wrap.style.setProperty('background-color', BOX_COLOR, 'important');
      wrap.style.setProperty('border-color', BOX_COLOR, 'important');
    }
  }

  paint();

  new MutationObserver(paint).observe(document.body, {
    childList: true,
    subtree: true
  });
})();
