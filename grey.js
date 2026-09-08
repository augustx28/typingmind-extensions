(() => {
  const styleId = 'typingmind-search-bar-color';

  function apply() {
    let style = document.getElementById(styleId);

    if (!style) {
      style = document.createElement('style');
      style.id = styleId;
      document.head.appendChild(style);
    }

    style.textContent = `
      input[data-element-id="search-chats-bar"] {
        background-color: #131212 !important;
      }
    `;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply, { once: true });
  } else {
    apply();
  }
})();
