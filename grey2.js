(function () {
  var STYLE_ID = "tm-chat-input-dark-theme-v2";

  var CSS = `
    /* 1) Chat input container — dark mode only.
       Replaces the dark navy (slate-950 = #020617) with #0f0f0f. */
    .dark [data-element-id="chat-space-end-part"] [class~="dark:bg-slate-950"] {
      background-color: #0f0f0f !important;
    }

    /* 2) Scroll-indicator gradient on the button row — fully transparent,
       so no navy shows over the new #0f0f0f. Covers the element itself plus
       any ::before/::after overlay it might use. Scoped to the chat input
       so nothing else in the app is affected. */
    .dark [data-element-id="chat-input-actions"] .scroll-indicator-gradient,
    .dark [data-element-id="chat-input-actions"] .scroll-indicator-gradient::before,
    .dark [data-element-id="chat-input-actions"] .scroll-indicator-gradient::after {
      background: transparent !important;
      background-image: none !important;
    }

    /* ALTERNATIVE for rule 2: if you'd rather keep the subtle "you can
       scroll" fade but blend it into the new color, delete rule 2 above and
       uncomment this:
    .dark [data-element-id="chat-input-actions"] .scroll-indicator-gradient {
      background: linear-gradient(to right, rgba(15,15,15,0) 75%, #0f0f0f 100%) !important;
    }
    */

    /* The <textarea> is bg-transparent, so it follows the container color.
       Uncomment if you want the typing area as a distinct #4f4d4b block:
    .dark textarea#chat-input-textbox {
      background-color: #4f4d4b !important;
    }
    */
  `;

  function inject() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", inject);
  } else {
    inject();
  }
})();
