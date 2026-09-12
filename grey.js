(() => {
  const id = 'tm-chat-input-dark-background';
  let style = document.getElementById(id);

  if (!style) {
    style = document.createElement('style');
    style.id = id;
    (document.head || document.documentElement).appendChild(style);
  }

  style.textContent = `
    .dark [data-element-id="chat-space-end-part"]
    > [role="presentation"] {
      background-color: #0f0f0f !important;
    }
  `;
})();
