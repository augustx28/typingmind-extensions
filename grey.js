(function () {
  const STYLE_ID = 'tm-search-bar-color';
  const SEARCH_BG = '#131212'; // change this one value

  const css = `
[data-element-id="search-chats-bar"] {
  background-color: ${SEARCH_BG} !important;
}

[data-element-id="search-chats-bar"] input,
[data-element-id="search-chats-bar"] > div,
input[data-element-id="search-chats-bar"] {
  background-color: ${SEARCH_BG} !important;
}
`;
