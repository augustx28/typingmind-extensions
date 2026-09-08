(() => {
  "use strict";

  const styleId = "typingmind-dark-gray-theme";

  const css = `
    /* Search bar */
    .dark [data-element-id="search-chats-bar"] {
      background-color: #131313 !important;
    }

    /* Chat input box */
    .dark [data-element-id="chat-space-end-part"] > .bg-slate-100 {
      background-color: #181717 !important;
    }

    /* Fix the navy fade beside Send */
    .dark [data-element-id="chat-input-actions"]
      .scroll-indicator-gradient::after {
      background: linear-gradient(
        to right,
        rgba(24, 23, 23, 0),
        #181717
      ) !important;
    }
  `;

  function install() {
    let style = document.getElementById(styleId);

    if (!style) {
      style = document.createElement("style");
      style.id = styleId;
      (document.head || document.documentElement).appendChild(style);
    }

    style.textContent = css;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
