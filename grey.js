(function () {
  const STYLE_ID = 'tm-dark-gray-patch';

  const INPUT_BG = '#100f0f'; // textarea / input line
  const BOX_BG   = '#131212'; // input box container + chat area
  const FADE_BG  = '#131212'; // scroll indicator, single flat color

  const css = `
/* ================= Input (textarea) ================= */
.jsx-7078ffb922cb3c38 .leading-normal,
[data-element-id="chat-input-textbox"] {
  background-color: ${INPUT_BG} !important;
}

/* ================= Input box container ================= */
.pb-safe .bg-slate-100 {
  background-color: ${BOX_BG} !important;
}

/* ================= Scroll indicator: no gradient, one color ================= */
/* Case 1: gradient applied as a mask on the container */
.scroll-indicator-gradient {
  -webkit-mask-image: none !important;
          mask-image: none !important;
  background-image: none !important;
  background-color: ${FADE_BG} !important;
}

/* Case 2: gradient applied via a pseudo-element strip */
.scroll-indicator-gradient::before,
.scroll-indicator-gradient::after {
  background-image: none !important;
  background: none !important;
  -webkit-mask-image: none !important;
          mask-image: none !important;
  content: none !important;
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

  // Re-inject if something wipes the tag out of <head>
  const target = document.head || document.documentElement;
  new MutationObserver(() => {
    if (!document.getElementById(STYLE_ID)) inject();
  }).observe(target, { childList: true });
})();
