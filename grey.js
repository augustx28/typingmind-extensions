(function () {
  const STYLE_ID = 'tm-search-box-color';
  const BOX_COLOR = '#131212'; // change this one value

  const css = `
input[data-element-id="search-chats-bar"] {
  background-color: ${BOX_COLOR} !important;
  background-image: none !important;
}
`;

  function inject() {
    const old = document.getElementById(STYLE_ID);
    if (old) old.remove();

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  if (document.head) {
    inject();
  } else {
    document.addEventListener('DOMContentLoaded', inject, { once: true });
  }

  const target = document.head || document.documentElement;
  new MutationObserver(() => {
    if (!document.getElementById(STYLE_ID)) inject();
  }).observe(target, { childList: true });
})();
