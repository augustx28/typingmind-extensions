// TypingMind: chat input background colors, dark mode only.
;(() => {
  const STYLE_ID = 'tm-chat-input-colors-v1';
  const style = document.getElementById(STYLE_ID) || document.createElement('style');
  style.id = STYLE_ID;

  style.textContent = `
    /* Outer chat input box, including the toolbar. */
    .dark [data-element-id="chat-space-end-part"] > div[role="presentation"] {
      background-color: #0f0f0f !important;
    }

    /* Background of the field where you type. */
    .dark [data-element-id="chat-space-end-part"] textarea#chat-input-textbox {
      background-color: #4f4d4b !important;
    }
  `;

  (document.head || document.documentElement).appendChild(style);
})();
