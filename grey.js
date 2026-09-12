(function () {
  var STYLE_ID = "tm-chat-input-dark-theme";

  var CSS = `
    /* Chat input container — dark mode only.
       Replaces the dark navy (Tailwind slate-950 = #020617) with #0f0f0f. */
    .dark [data-element-id="chat-space-end-part"] [class~="dark:bg-slate-950"] {
      background-color: #0f0f0f !important;
    }

    /* The <textarea> is bg-transparent (no color of its own), so it
       automatically follows the container color above — nothing else needed.
       If you want the typing area to be a distinct #4f4d4b block instead,
       delete the comment markers around the rule below: */
    /*
    .dark textarea#chat-input-textbox {
      background-color: #4f4d4b !important;
    }
    */
  `;

  function inject() {
    if (document.getElementById(STYLE_ID)) return; // prevent duplicates
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
