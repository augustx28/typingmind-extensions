(function () {
  "use strict";

  // --- Configuration ---
  const SCRIPT_PREFIX = 'tmfc_';
  const GOOGLE_FONTS = [
    "Roboto", "Open Sans", "Lato", "Montserrat", "Oswald", "Raleway",
    "Poppins", "Nunito", "Merriweather", "Inter", "Source Sans Pro",
    "PT Sans", "Ubuntu", "Noto Sans", "Fira Sans", "Work Sans",
    "Roboto Condensed", "Roboto Slab", "Playfair Display", "Cormorant Garamond",
    "Bebas Neue", "Titillium Web", "Josefin Sans", "Arimo", "Lexend", "EB Garamond",
    "DM Sans", "Manrope", "Space Grotesk", "Sora"
  ];
  const DEFAULT_FONT_WEIGHT = '400';
  const FONT_FILE_MAX_BYTES = 4 * 1024 * 1024; // 4 MB raw file cap (localStorage is limited)
  const UPLOADED_FONT_FAMILY = 'TMTweaksUploadedFont';

  const settingsKeys = {
    hideTeams: "tweak_hideTeams",
    hideLogo: "tweak_hideLogo",
    hidePinnedChars: "tweak_hidePinnedChars",
    workspaceIconColor: "tweak_workspaceIconColor",
    customPageTitle: "tweak_customPageTitle",
    customFaviconData: "tweak_customFaviconData",
    customFontUrl: "tweak_customFontUrl",
    customFontFamily: "tweak_customFontFamily",
    localFontFamily: "tweak_localFontFamily",
    customFontSize: "tweak_customFontSize",
    globalUiFont: "tweak_globalUiFont",
    globalFontFile: "tweak_globalFontFileData",
    userBubbleBgColor: "tweak_userBubbleBgColor",
    userBubbleTextColor: "tweak_userBubbleTextColor",
    inputBgColor: "tweak_inputBgColor",
    inputTextColor: "tweak_inputTextColor",
  };

  const CHAT_COLOR_KEYS = [
    settingsKeys.userBubbleBgColor,
    settingsKeys.userBubbleTextColor,
    settingsKeys.inputBgColor,
    settingsKeys.inputTextColor,
  ];

  // Visual fallbacks used by the pickers and the live preview when nothing is set.
  const CHAT_COLOR_DEFAULTS = {
    bubbleBg: "#2563eb",
    bubbleText: "#ffffff",
    inputBg: "#2c2d31",
    inputText: "#f0f0f0",
  };

  // One-tap color themes: bubble + input styled together.
  const CHAT_COLOR_THEMES = [
    { name: "Default", reset: true },
    { name: "Ocean",    bubbleBg: "#2563eb", bubbleText: "#ffffff", inputBg: "#1e293b", inputText: "#e2e8f0" },
    { name: "Midnight", bubbleBg: "#334155", bubbleText: "#f1f5f9", inputBg: "#0f172a", inputText: "#cbd5e1" },
    { name: "Forest",   bubbleBg: "#16a34a", bubbleText: "#f0fdf4", inputBg: "#14532d", inputText: "#dcfce7" },
    { name: "Sunset",   bubbleBg: "#ea580c", bubbleText: "#fff7ed", inputBg: "#7c2d12", inputText: "#fed7aa" },
    { name: "Grape",    bubbleBg: "#7c3aed", bubbleText: "#f5f3ff", inputBg: "#2e1065", inputText: "#ddd6fe" },
    { name: "Rose",     bubbleBg: "#e11d48", bubbleText: "#fff1f2", inputBg: "#4c0519", inputText: "#fecdd3" },
    { name: "Teal",     bubbleBg: "#0d9488", bubbleText: "#f0fdfa", inputBg: "#134e4a", inputText: "#ccfbf1" },
    { name: "Mono",     bubbleBg: "#e5e7eb", bubbleText: "#111827", inputBg: "#1f2937", inputText: "#f9fafb" },
  ];

  const consolePrefix = "TypingMind Tweaks:";
  const defaultWorkspaceIconColorVisual = "#9ca3af";
  const DEFAULT_FALLBACK_FAVICON = "/favicon.ico";
  let originalPageTitle = null;
  let faviconObserver = null;
  let faviconObserverActive = false;
  let activeGlobalUIFontLink = null;

  const cleanValue = (value) => {
    if (value === null || typeof value === 'undefined') return null;
    let cleaned = String(value).trim();
    if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
      cleaned = cleaned.slice(1, -1);
    }
    if (cleaned === "null") return null;
    return cleaned;
  };

  function getSetting(key, defaultValue = false) {
    const value = localStorage.getItem(key);
    if (value === null || value === "null") return defaultValue;
    try {
      return JSON.parse(value);
    } catch (e) {
      return value;
    }
  }

  function isValidCssColor(value) {
    if (!value || typeof value !== "string") return false;
    return /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value.trim());
  }

  // ---------------------------------------------------------------
  // Global UI font loading
  // ---------------------------------------------------------------
  function removeActiveGlobalUIFontLink() {
    if (activeGlobalUIFontLink) {
      activeGlobalUIFontLink.remove();
      activeGlobalUIFontLink = null;
    }
  }

  function loadGlobalGoogleFont(fontName) {
    removeActiveGlobalUIFontLink();
    if (!fontName) return;
    const weightsToLoad = "300;400;500;600;700";
    const fontUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontName).replace(/%20/g, '+')}:wght@${weightsToLoad}&display=swap`;
    const link = document.createElement('link');
    link.href = fontUrl;
    link.rel = 'stylesheet';
    link.onerror = () => {
      console.error(`${consolePrefix} Error loading Global UI Google Font: ${fontName}.`);
    };
    document.head.appendChild(link);
    activeGlobalUIFontLink = link;
  }

  function loadGlobalUrlFont(fontUrl) {
    removeActiveGlobalUIFontLink();
    const cleaned = cleanValue(fontUrl);
    if (!cleaned || !(cleaned.startsWith("http://") || cleaned.startsWith("https://"))) return;
    const link = document.createElement('link');
    link.href = cleaned;
    link.rel = 'stylesheet';
    link.onerror = () => {
      console.error(`${consolePrefix} Error loading Global UI Web Font URL: ${cleaned}.`);
    };
    document.head.appendChild(link);
    activeGlobalUIFontLink = link;
  }

  function getFontFormatFromFileName(fileName) {
    const ext = (String(fileName || '').split('.').pop() || '').toLowerCase();
    const map = { woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype' };
    return map[ext] || null;
  }

  // Injects (or removes) the @font-face rule for the uploaded font file.
  // Returns true when the font face is ready to use.
  function syncUploadedFontFace(fileData) {
    const styleId = "tweak-uploaded-font-face";
    let styleEl = document.getElementById(styleId);
    if (!fileData || !fileData.dataUrl) {
      if (styleEl) styleEl.remove();
      return false;
    }
    const formatPart = fileData.format ? ` format('${fileData.format}')` : "";
    const css = `@font-face { font-family: '${UPLOADED_FONT_FAMILY}'; src: url('${fileData.dataUrl}')${formatPart}; font-display: swap; }`;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }
    if (styleEl.textContent !== css) styleEl.textContent = css;
    return true;
  }

  function applyGlobalUiFont() {
    const fontSetting = getSetting(settingsKeys.globalUiFont, null);
    const targetElement = document.body;
    if (!targetElement) return;

    const isFileFont = !!(fontSetting && fontSetting.isFile);
    const fileData = isFileFont ? getSetting(settingsKeys.globalFontFile, null) : null;
    const fileFaceReady = syncUploadedFontFace(isFileFont ? fileData : null);

    if (!fontSetting || (!fontSetting.name && !fontSetting.isUrl)) {
      targetElement.style.fontFamily = '';
      targetElement.style.fontWeight = '';
      removeActiveGlobalUIFontLink();
      return;
    }
    if (isFileFont) {
      removeActiveGlobalUIFontLink();
      if (!fileFaceReady) {
        // The stored font file is missing; fall back to the default UI font.
        targetElement.style.fontFamily = '';
        targetElement.style.fontWeight = '';
        return;
      }
    } else if (fontSetting.isGoogle && fontSetting.name) {
      loadGlobalGoogleFont(fontSetting.name);
    } else if (fontSetting.isUrl && fontSetting.url) {
      loadGlobalUrlFont(fontSetting.url);
    } else {
      removeActiveGlobalUIFontLink();
    }
    const safeName = fontSetting.name && String(fontSetting.name).trim() !== "" ? `"${fontSetting.name}"` : null;
    const fallbackStack = 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"';
    targetElement.style.fontFamily = safeName ? `${safeName}, ${fallbackStack}` : fallbackStack;
    targetElement.style.fontWeight = fontSetting.weight || DEFAULT_FONT_WEIGHT;
  }

  // ---------------------------------------------------------------
  // Chat colors (user bubble + input box)
  // ---------------------------------------------------------------
  function applyChatColors() {
    const styleId = "tweak-chat-colors-style";
    let styleElement = document.getElementById(styleId);
    if (!styleElement) {
      styleElement = document.createElement("style");
      styleElement.id = styleId;
      document.head.appendChild(styleElement);
    }
    const bubbleBg = cleanValue(getSetting(settingsKeys.userBubbleBgColor, null));
    const bubbleText = cleanValue(getSetting(settingsKeys.userBubbleTextColor, null));
    const inputBg = cleanValue(getSetting(settingsKeys.inputBgColor, null));
    const inputText = cleanValue(getSetting(settingsKeys.inputTextColor, null));
    const rules = [];

    if (isValidCssColor(bubbleBg)) {
      rules.push(`
      [data-element-id="user-message"] {
        background-color: ${bubbleBg} !important;
      }`);
    }
    if (isValidCssColor(bubbleText)) {
      rules.push(`
      [data-element-id="user-message"],
      [data-element-id="user-message"] * {
        color: ${bubbleText} !important;
      }`);
    }
    if (isValidCssColor(inputBg)) {
      rules.push(`
      [data-element-id="chat-space-end-part"] [role="presentation"],
      [data-element-id="chat-input-textbox"] {
        background-color: ${inputBg} !important;
      }`);
    }
    if (isValidCssColor(inputText)) {
      rules.push(`
      [data-element-id="chat-input-textbox"] {
        color: ${inputText} !important;
      }
      [data-element-id="chat-input-textbox"]::placeholder {
        color: ${inputText} !important;
        opacity: 0.55;
      }`);
    }
    const newContent = rules.join("\n");
    if (styleElement.textContent !== newContent) {
      styleElement.textContent = newContent;
    }
  }

  function updateChatColorPreview() {
    const bubbleEl = document.getElementById("tweak-preview-bubble");
    const inputEl = document.getElementById("tweak-preview-input");
    if (!bubbleEl || !inputEl) return;
    const val = (key, fallback) => {
      const v = cleanValue(getSetting(key, null));
      return isValidCssColor(v) ? v : fallback;
    };
    bubbleEl.style.backgroundColor = val(settingsKeys.userBubbleBgColor, CHAT_COLOR_DEFAULTS.bubbleBg);
    bubbleEl.style.color = val(settingsKeys.userBubbleTextColor, CHAT_COLOR_DEFAULTS.bubbleText);
    inputEl.style.backgroundColor = val(settingsKeys.inputBgColor, CHAT_COLOR_DEFAULTS.inputBg);
    inputEl.style.color = val(settingsKeys.inputTextColor, CHAT_COLOR_DEFAULTS.inputText);
  }

  function loadChatColorInputs() {
    const mapping = [
      ["tweak_userBubbleBg_input", settingsKeys.userBubbleBgColor, CHAT_COLOR_DEFAULTS.bubbleBg],
      ["tweak_userBubbleText_input", settingsKeys.userBubbleTextColor, CHAT_COLOR_DEFAULTS.bubbleText],
      ["tweak_inputBg_input", settingsKeys.inputBgColor, CHAT_COLOR_DEFAULTS.inputBg],
      ["tweak_inputText_input", settingsKeys.inputTextColor, CHAT_COLOR_DEFAULTS.inputText],
    ];
    mapping.forEach(([id, key, fallback]) => {
      const el = document.getElementById(id);
      if (!el) return;
      const stored = cleanValue(getSetting(key, null));
      el.value = isValidCssColor(stored) ? stored : fallback;
    });
  }

  function applyChatTheme(theme) {
    if (theme.reset) {
      CHAT_COLOR_KEYS.forEach((key) => saveSetting(key, null));
    } else {
      saveSetting(settingsKeys.userBubbleBgColor, theme.bubbleBg);
      saveSetting(settingsKeys.userBubbleTextColor, theme.bubbleText);
      saveSetting(settingsKeys.inputBgColor, theme.inputBg);
      saveSetting(settingsKeys.inputTextColor, theme.inputText);
    }
    loadChatColorInputs();
    updateChatColorPreview();
    showFeedback(theme.reset ? "Chat colors reset to default." : `"${theme.name}" colors applied.`);
  }

  // ---------------------------------------------------------------
  // Visibility / color tweaks
  // ---------------------------------------------------------------
  function applyStylesBasedOnSettings() {
    const hideTeams = getSetting(settingsKeys.hideTeams);
    const hideLogo = getSetting(settingsKeys.hideLogo);
    const hidePinnedChars = getSetting(settingsKeys.hidePinnedChars);
    const wsIconColor = getSetting(settingsKeys.workspaceIconColor, null);

    const teamsButton = document.querySelector('button[data-element-id="workspace-tab-teams"]');
    if (teamsButton) teamsButton.style.display = hideTeams ? "none" : "";

    const workspaceBar = document.querySelector('div[data-element-id="workspace-bar"]');
    if (workspaceBar) {
      workspaceBar.querySelectorAll("svg").forEach((icon) => {
        if (icon.closest("#workspace-tab-tweaks")) return;
        icon.style.color = wsIconColor ? wsIconColor : "";
      });
      const tweaksButton = document.getElementById("workspace-tab-tweaks");
      if (tweaksButton) {
        const svgIcon = tweaksButton.querySelector("svg");
        if (svgIcon) {
          svgIcon.style.color = getSetting(settingsKeys.workspaceIconColor, defaultWorkspaceIconColorVisual);
        }
      }
    }
    const logoImage = document.querySelector('img[alt="TypingMind"][src="/logo.png"]');
    if (logoImage && logoImage.parentElement && logoImage.parentElement.parentElement) {
      logoImage.parentElement.parentElement.style.display = hideLogo ? "none" : "";
    }
    const pinnedCharsContainer = document.querySelector('div[data-element-id="pinned-characters-container"]');
    if (pinnedCharsContainer) pinnedCharsContainer.style.display = hidePinnedChars ? "none" : "";
  }

  function applyCustomTitle() {
    const customTitle = getSetting(settingsKeys.customPageTitle, null);
    if (customTitle && typeof customTitle === "string" && customTitle.trim() !== "") {
      if (document.title !== customTitle) document.title = customTitle;
    } else if (originalPageTitle && document.title !== originalPageTitle) {
      document.title = originalPageTitle;
    }
  }

  // ---------------------------------------------------------------
  // Settings modal
  // ---------------------------------------------------------------
  let modalOverlay = null;
  let modalElement = null;
  let feedbackElement = null;
  let feedbackTimer = null;

  function showFeedback(message, duration = 2000) {
    if (!feedbackElement) return;
    feedbackElement.textContent = message;
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => {
      feedbackElement.textContent = "\u00A0";
    }, duration);
  }

  function updateFontFileStatus() {
    const statusRow = document.getElementById(`${SCRIPT_PREFIX}font-file-status`);
    const nameEl = document.getElementById(`${SCRIPT_PREFIX}font-file-name`);
    if (!statusRow || !nameEl) return;
    const fileData = getSetting(settingsKeys.globalFontFile, null);
    if (fileData && fileData.dataUrl) {
      const activeSetting = getSetting(settingsKeys.globalUiFont, null);
      const inUse = !!(activeSetting && activeSetting.isFile);
      nameEl.textContent = `${fileData.fileName || "Uploaded font"}${inUse ? " \u2014 in use" : " \u2014 stored (not in use)"}`;
      statusRow.style.display = "flex";
    } else {
      nameEl.textContent = "";
      statusRow.style.display = "none";
    }
  }

  function createSettingsModal() {
    if (document.getElementById("tweak-modal-overlay")) return;

    const styles = `
      #tweak-modal-overlay {
        position: fixed; inset: 0;
        background-color: rgba(0, 0, 0, 0.72);
        display: none; justify-content: center; align-items: center;
        z-index: 10001; padding: 16px; box-sizing: border-box;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
      }
      #tweak-modal-overlay *, #tweak-modal-overlay *::before, #tweak-modal-overlay *::after { box-sizing: border-box; }
      #tweak-modal {
        background-color: #232426; color: #f0f0f0;
        width: 100%; max-width: 560px;
        max-height: 90vh; max-height: 90dvh;
        display: flex; flex-direction: column;
        padding: 22px 26px 18px;
        border-radius: 14px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.65);
        border: 1px solid #45464a;
      }
      #tweak-modal h2 { margin: 0 0 6px; color: #ffffff; font-size: 1.3em; font-weight: 600; text-align: center; }
      #tweak-modal-feedback { flex-shrink: 0; font-size: 0.85em; color: #8ec2ff; margin: 0 0 12px; min-height: 1.2em; text-align: center; font-weight: 500; }
      #tweak-modal-scrollable-content {
        flex: 1 1 auto; min-height: 0;
        overflow-y: auto; overflow-x: hidden;
        overscroll-behavior: contain;
        -webkit-overflow-scrolling: touch;
        padding-right: 8px; margin-right: -8px;
      }
      #tweak-modal-scrollable-content::-webkit-scrollbar { width: 8px; }
      #tweak-modal-scrollable-content::-webkit-scrollbar-track { background: #2e2f33; border-radius: 4px; }
      #tweak-modal-scrollable-content::-webkit-scrollbar-thumb { background-color: #5a5b60; border-radius: 4px; }
      #tweak-modal-scrollable-content::-webkit-scrollbar-thumb:hover { background-color: #737479; }

      .tweak-settings-section {
        background-color: #2c2d31; padding: 16px 18px;
        border-radius: 10px; border: 1px solid #3d3e43;
      }
      .tweak-settings-section + .tweak-settings-section,
      #tweak-modal-scrollable-content > * + * { margin-top: 14px; }
      .tweak-settings-section h3 {
        color: #e6e6e6; font-size: 1em; font-weight: 600;
        margin: 0 0 14px; border-bottom: 1px solid #45464a; padding-bottom: 8px;
      }

      .tweak-checkbox-item { margin-bottom: 14px; display: flex; align-items: center; gap: 12px; }
      .tweak-checkbox-item:last-child { margin-bottom: 2px; }
      .tweak-checkbox-item input[type='checkbox'] {
        flex-shrink: 0; cursor: pointer;
        background-color: #4b4c51; border-radius: 4px; border: 1px solid #6c6d72;
        appearance: none; -webkit-appearance: none;
        width: 1.25em; height: 1.25em; position: relative; margin: 0;
        transition: background-color 0.15s ease, border-color 0.15s ease;
      }
      .tweak-checkbox-item input[type='checkbox']::before {
        content: "\\2713"; display: block; position: absolute; top: 50%; left: 50%;
        transform: translate(-50%, -50%) scale(0);
        font-size: 0.85em; font-weight: bold; color: white;
        transition: transform 0.12s ease-in-out; line-height: 1;
      }
      .tweak-checkbox-item input[type='checkbox']:checked { background-color: #0d6efd; border-color: #0d6efd; }
      .tweak-checkbox-item input[type='checkbox']:checked::before { transform: translate(-50%, -50%) scale(1.15); }
      .tweak-checkbox-item input[type='checkbox']:focus-visible,
      #tweak-modal input:focus-visible, #tweak-modal select:focus-visible, #tweak-modal button:focus-visible {
        outline: 2px solid #4a94ff; outline-offset: 2px;
      }
      .tweak-checkbox-item label { cursor: pointer; flex: 1 1 auto; font-size: 0.95em; color: #e0e0e0; }

      .tweak-color-item {
        display: flex; flex-wrap: wrap; gap: 10px;
        align-items: center; justify-content: space-between;
      }
      .tweak-color-item label { color: #e0e0e0; font-size: 0.95em; }
      .tweak-color-input-wrapper { display: flex; align-items: center; gap: 10px; }
      .tweak-color-item input[type='color'] {
        width: 44px; height: 32px; border: 1px solid #6c6d72; border-radius: 6px;
        cursor: pointer; background-color: #4b4c51; padding: 2px;
      }

      .tweak-text-item {
        display: flex; flex-wrap: wrap; gap: 8px 12px;
        align-items: center; justify-content: space-between;
        margin-top: 12px;
      }
      .tweak-text-item label { color: #e0e0e0; font-size: 0.95em; white-space: nowrap; flex-shrink: 0; }
      .tweak-text-input-wrapper { display: flex; align-items: center; gap: 8px; flex: 1 1 220px; min-width: 0; }
      .tweak-text-item input[type='text'], .tweak-text-item input[type='number'] {
        flex: 1 1 auto; min-width: 0; width: auto;
        padding: 7px 10px; border: 1px solid #6c6d72; border-radius: 6px;
        background-color: #3a3b40; color: #f0f0f0; font-size: 0.9em;
      }
      .tweak-text-item input::placeholder { color: #9a9a9a; opacity: 1; }

      .tweak-reset-button {
        flex-shrink: 0; background-color: #55565c; color: white; border: 1px solid #55565c;
        padding: 6px 12px; border-radius: 6px; font-size: 0.85em; font-weight: 500;
        cursor: pointer; transition: background-color 0.15s ease;
      }
      .tweak-reset-button:hover { background-color: #66676d; }

      .tweak-modal-footer {
        flex-shrink: 0; margin-top: 16px; padding-top: 14px;
        border-top: 1px solid #45464a;
        display: flex; justify-content: flex-end;
      }
      #tweak-modal-bottom-close {
        background-color: #0d6efd; color: white; border: none;
        padding: 9px 22px; border-radius: 8px;
        font-size: 0.95em; font-weight: 500; cursor: pointer;
        transition: background-color 0.15s ease;
      }
      #tweak-modal-bottom-close:hover { background-color: #0b5ed7; }

      .font-customization-subsection-title {
        color: #cfcfcf; font-size: 0.9em; font-weight: 600;
        margin-top: 18px; margin-bottom: 8px; padding-bottom: 5px;
        border-bottom: 1px dashed #55565c;
      }
      .tweak-section-note { font-size: 0.83em; color: #a8a8a8; margin: 0 0 12px; }
      .tweak-sub-note { font-size: 0.85em; color: #bdbdbd; margin: 0 0 10px; }

      /* --- Chat colors section --- */
      .tweak-chat-preview {
        background-color: #17181b; border: 1px solid #3d3e43; border-radius: 12px;
        padding: 30px 14px 14px; margin-bottom: 14px; position: relative;
      }
      .tweak-preview-caption {
        position: absolute; top: 9px; left: 14px;
        font-size: 0.66em; text-transform: uppercase; letter-spacing: 0.09em; color: #7d7e83;
      }
      .tweak-preview-bubble-row { display: flex; justify-content: flex-end; margin-bottom: 10px; }
      .tweak-preview-bubble {
        max-width: 85%; padding: 9px 14px; border-radius: 16px 16px 4px 16px;
        font-size: 0.9em; line-height: 1.4; word-break: break-word;
        background-color: ${CHAT_COLOR_DEFAULTS.bubbleBg}; color: ${CHAT_COLOR_DEFAULTS.bubbleText};
        transition: background-color 0.15s ease, color 0.15s ease;
      }
      .tweak-preview-input {
        border-radius: 12px; padding: 10px 14px; font-size: 0.9em;
        background-color: ${CHAT_COLOR_DEFAULTS.inputBg}; color: ${CHAT_COLOR_DEFAULTS.inputText};
        border: 1px solid #45464a;
        transition: background-color 0.15s ease, color 0.15s ease;
      }
      .tweak-theme-row { display: flex; flex-wrap: wrap; gap: 10px 8px; margin: 2px 0 4px; }
      .tweak-theme-item { display: flex; flex-direction: column; align-items: center; gap: 5px; width: 46px; }
      .tweak-theme-item span { font-size: 0.66em; color: #b0b0b5; text-align: center; line-height: 1.1; }
      .tweak-theme-swatch {
        width: 34px; height: 34px; border-radius: 50%; padding: 0; cursor: pointer;
        border: 2px solid rgba(255, 255, 255, 0.22);
        transition: transform 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease;
      }
      .tweak-theme-swatch:hover { transform: scale(1.12); border-color: #ffffff; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.4); }
      .tweak-theme-swatch:active { transform: scale(0.94); }
      .tweak-theme-swatch--default {
        background-color: #3a3b40; color: #d8d8d8; font-size: 15px; line-height: 1;
        display: flex; align-items: center; justify-content: center;
      }

      /* --- Global font section --- */
      .${SCRIPT_PREFIX}form-group { margin-bottom: 14px; }
      .${SCRIPT_PREFIX}form-group label { display: block; margin-bottom: 6px; font-weight: 500; font-size: 0.88em; color: #c8c8c8; }
      .${SCRIPT_PREFIX}form-group select, .${SCRIPT_PREFIX}form-group input[type="text"] {
        width: 100%; padding: 8px 10px; border: 1px solid #6c6d72; border-radius: 6px;
        font-size: 0.92em; background-color: #3a3b40; color: #f0f0f0;
      }
      .${SCRIPT_PREFIX}form-group input[type="file"] {
        width: 100%; padding: 6px; border: 1px solid #6c6d72; border-radius: 6px;
        background-color: #3a3b40; color: #f0f0f0; font-size: 0.85em;
      }
      .${SCRIPT_PREFIX}font-file-status {
        display: none; align-items: center; justify-content: space-between; gap: 10px;
        margin-top: 8px; background-color: #3a3b40; border: 1px solid #55565c;
        border-radius: 6px; padding: 6px 10px; font-size: 0.85em; color: #dcdcdc;
      }
      .${SCRIPT_PREFIX}font-file-status span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
      .${SCRIPT_PREFIX}form-group small { display: block; margin-top: 6px; color: #a8a8a8; font-size: 0.82em; }
      .${SCRIPT_PREFIX}button-group { display: flex; justify-content: flex-end; margin-top: 14px; gap: 10px; }
      .${SCRIPT_PREFIX}button-group button {
        padding: 7px 16px; border: 1px solid transparent; border-radius: 6px;
        cursor: pointer; font-size: 0.9em; font-weight: 500;
        transition: background-color 0.15s ease;
      }
      .${SCRIPT_PREFIX}apply-button { background-color: #0d6efd; color: white; }
      .${SCRIPT_PREFIX}apply-button:hover { background-color: #0b5ed7; }
      .${SCRIPT_PREFIX}reset-button { background-color: #55565c; color: white; }
      .${SCRIPT_PREFIX}reset-button:hover { background-color: #66676d; }

      /* --- Favicon section --- */
      .tweak-favicon-input-group { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-bottom: 10px; }
      .tweak-favicon-input-group label { color: #e0e0e0; font-size: 0.95em; flex-shrink: 0; }
      .tweak-favicon-input-group input[type="file"] {
        flex: 1 1 200px; min-width: 0; color: #f0f0f0; font-size: 0.85em;
        padding: 6px; border: 1px solid #6c6d72; border-radius: 6px; background-color: #3a3b40;
      }
      .tweak-favicon-controls { display: flex; align-items: center; gap: 10px; min-height: 30px; }
      #tweak_favicon_preview {
        width: 24px; height: 24px; border: 1px solid #6c6d72;
        border-radius: 4px; display: none; background-color: #3a3b40;
      }

      /* --- Small screens --- */
      @media (max-width: 480px) {
        #tweak-modal-overlay { padding: 10px; align-items: flex-end; }
        #tweak-modal { padding: 18px 16px 14px; max-height: 94vh; max-height: 94dvh; border-radius: 14px 14px 10px 10px; }
        .tweak-settings-section { padding: 14px; }
        .tweak-text-item label, .tweak-color-item label, .tweak-favicon-input-group label { width: 100%; }
        .tweak-text-input-wrapper { flex: 1 1 100%; }
        #tweak-modal-bottom-close { width: 100%; padding: 11px; }
      }

      @media (prefers-reduced-motion: reduce) {
        #tweak-modal-overlay * { transition: none !important; }
      }
    `;
    const styleSheet = document.createElement("style");
    styleSheet.id = "tweak-modal-styles";
    styleSheet.textContent = styles;
    document.head.appendChild(styleSheet);

    modalOverlay = document.createElement("div");
    modalOverlay.id = "tweak-modal-overlay";
    modalOverlay.addEventListener("click", (e) => {
      if (e.target === modalOverlay) toggleModal(false);
    });
    modalElement = document.createElement("div");
    modalElement.id = "tweak-modal";
    modalElement.setAttribute("role", "dialog");
    modalElement.setAttribute("aria-modal", "true");
    modalElement.setAttribute("aria-label", "UI Tweaks settings");

    const header = document.createElement("h2");
    header.textContent = "UI Tweaks";
    feedbackElement = document.createElement("p");
    feedbackElement.id = "tweak-modal-feedback";
    feedbackElement.textContent = "\u00A0";
    const scrollableContent = document.createElement("div");
    scrollableContent.id = "tweak-modal-scrollable-content";

    // --- General settings ---
    const settingsSection = document.createElement("div");
    settingsSection.className = "tweak-settings-section";
    const settingsHeader = document.createElement('h3');
    settingsHeader.textContent = 'General settings';
    settingsSection.appendChild(settingsHeader);

    const checkboxSettings = [
      { key: settingsKeys.hideTeams, label: "Hide 'Teams' menu item" },
      { key: settingsKeys.hideLogo, label: "Hide logo & announcement" },
      { key: settingsKeys.hidePinnedChars, label: "Hide 'Characters' in new chat" },
    ];
    checkboxSettings.forEach(setting => {
      const itemDiv = document.createElement("div");
      itemDiv.className = "tweak-checkbox-item";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = setting.key;
      checkbox.checked = getSetting(setting.key, false);
      checkbox.addEventListener("change", (e) => saveSetting(setting.key, e.target.checked));
      const label = document.createElement("label");
      label.htmlFor = setting.key;
      label.textContent = setting.label;
      itemDiv.append(checkbox, label);
      settingsSection.appendChild(itemDiv);
    });

    function createColorPicker(id, labelText, settingKey, defaultValue) {
      const item = document.createElement("div");
      item.className = "tweak-color-item";
      const label = document.createElement("label");
      label.htmlFor = id;
      label.textContent = labelText;
      const wrapper = document.createElement("div");
      wrapper.className = "tweak-color-input-wrapper";
      const input = document.createElement("input");
      input.type = "color";
      input.id = id;
      input.addEventListener("input", (e) => saveSetting(settingKey, e.target.value));
      const resetButton = document.createElement("button");
      resetButton.textContent = "Reset";
      resetButton.className = "tweak-reset-button";
      resetButton.type = "button";
      resetButton.addEventListener("click", () => {
        saveSetting(settingKey, null);
        input.value = defaultValue;
      });
      wrapper.append(input, resetButton);
      item.append(label, wrapper);
      return item;
    }

    function createTextInput(id, labelText, settingKey, placeholder, type = "text", attributes = {}) {
      const item = document.createElement("div");
      item.className = "tweak-text-item";
      const label = document.createElement("label");
      label.htmlFor = id;
      label.textContent = labelText;
      const wrapper = document.createElement("div");
      wrapper.className = "tweak-text-input-wrapper";
      const input = document.createElement("input");
      input.type = type;
      input.id = id;
      input.placeholder = placeholder;
      Object.keys(attributes).forEach(attr => input.setAttribute(attr, attributes[attr]));
      input.addEventListener("input", (e) => saveSetting(settingKey, e.target.value || null));
      const clearButton = document.createElement("button");
      clearButton.textContent = "Clear";
      clearButton.className = "tweak-reset-button";
      clearButton.type = "button";
      clearButton.addEventListener("click", () => {
        saveSetting(settingKey, null);
        input.value = "";
      });
      wrapper.append(input, clearButton);
      item.append(label, wrapper);
      return item;
    }

    const wsIconColorPicker = createColorPicker("tweak_workspaceIconColor_input", "Menu icon color:", settingsKeys.workspaceIconColor, defaultWorkspaceIconColorVisual);
    wsIconColorPicker.style.marginTop = "16px";
    wsIconColorPicker.style.paddingTop = "14px";
    wsIconColorPicker.style.borderTop = "1px solid #45464a";
    settingsSection.appendChild(wsIconColorPicker);

    const customTitleInput = createTextInput("tweak_customPageTitle_input", "Page title:", settingsKeys.customPageTitle, "Custom page title");
    customTitleInput.style.paddingTop = "14px";
    customTitleInput.style.borderTop = "1px solid #45464a";
    settingsSection.appendChild(customTitleInput);

    // --- Chat colors section ---
    const chatColorsSection = document.createElement("div");
    chatColorsSection.className = "tweak-settings-section";
    const chatColorsHeader = document.createElement("h3");
    chatColorsHeader.textContent = "Chat colors";
    chatColorsSection.appendChild(chatColorsHeader);
    const chatColorsNote = document.createElement("p");
    chatColorsNote.className = "tweak-section-note";
    chatColorsNote.textContent = "Style your message bubble and the input box. Tap a theme, or fine-tune each color below.";
    chatColorsSection.appendChild(chatColorsNote);

    const previewEl = document.createElement("div");
    previewEl.className = "tweak-chat-preview";
    previewEl.setAttribute("aria-hidden", "true");
    previewEl.innerHTML = `
      <div class="tweak-preview-caption">Live preview</div>
      <div class="tweak-preview-bubble-row"><div class="tweak-preview-bubble" id="tweak-preview-bubble">Hey! This is one of my messages \u2728</div></div>
      <div class="tweak-preview-input" id="tweak-preview-input">Type a message\u2026</div>
    `;
    chatColorsSection.appendChild(previewEl);

    const themesTitle = document.createElement("div");
    themesTitle.className = "font-customization-subsection-title";
    themesTitle.textContent = "Quick themes";
    themesTitle.style.marginTop = "4px";
    chatColorsSection.appendChild(themesTitle);

    const themeRow = document.createElement("div");
    themeRow.className = "tweak-theme-row";
    CHAT_COLOR_THEMES.forEach((theme) => {
      const item = document.createElement("div");
      item.className = "tweak-theme-item";
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "tweak-theme-swatch" + (theme.reset ? " tweak-theme-swatch--default" : "");
      swatch.title = theme.reset ? "Reset to TypingMind defaults" : `Apply "${theme.name}" colors`;
      swatch.setAttribute("aria-label", swatch.title);
      if (theme.reset) {
        swatch.textContent = "\u21BA";
      } else {
        swatch.style.background = `linear-gradient(135deg, ${theme.bubbleBg} 0%, ${theme.bubbleBg} 55%, ${theme.inputBg} 55%, ${theme.inputBg} 100%)`;
      }
      swatch.addEventListener("click", () => applyChatTheme(theme));
      const caption = document.createElement("span");
      caption.textContent = theme.name;
      item.append(swatch, caption);
      themeRow.appendChild(item);
    });
    chatColorsSection.appendChild(themeRow);

    const fineTuneTitle = document.createElement("div");
    fineTuneTitle.className = "font-customization-subsection-title";
    fineTuneTitle.textContent = "Fine-tune";
    chatColorsSection.appendChild(fineTuneTitle);

    const bubbleBgPicker = createColorPicker("tweak_userBubbleBg_input", "My bubble background:", settingsKeys.userBubbleBgColor, CHAT_COLOR_DEFAULTS.bubbleBg);
    bubbleBgPicker.style.marginTop = "5px";
    const bubbleTextPicker = createColorPicker("tweak_userBubbleText_input", "My bubble text:", settingsKeys.userBubbleTextColor, CHAT_COLOR_DEFAULTS.bubbleText);
    bubbleTextPicker.style.marginTop = "10px";
    const inputBgPicker = createColorPicker("tweak_inputBg_input", "Input box background:", settingsKeys.inputBgColor, CHAT_COLOR_DEFAULTS.inputBg);
    inputBgPicker.style.marginTop = "10px";
    const inputTextPicker = createColorPicker("tweak_inputText_input", "Input box text:", settingsKeys.inputTextColor, CHAT_COLOR_DEFAULTS.inputText);
    inputTextPicker.style.marginTop = "10px";
    chatColorsSection.append(bubbleBgPicker, bubbleTextPicker, inputBgPicker, inputTextPicker);

    // --- Global UI font section ---
    const globalFontSettingsSection = document.createElement("div");
    globalFontSettingsSection.className = "tweak-settings-section";
    globalFontSettingsSection.innerHTML = `
        <h3>Global UI font</h3>
        <p class="tweak-section-note">Changes the font of the entire app. Pick one source below.</p>
        <div class="${SCRIPT_PREFIX}form-group">
            <label for="${SCRIPT_PREFIX}google-font-select">Google Font:</label>
            <select id="${SCRIPT_PREFIX}google-font-select">
                <option value="">-- Select Google Font --</option>
                ${[...GOOGLE_FONTS].sort().map(font => `<option value="${font}">${font}</option>`).join('')}
            </select>
        </div>
        <div class="${SCRIPT_PREFIX}form-group">
            <label for="${SCRIPT_PREFIX}local-font-input">Local font (exact name):</label>
            <input type="text" id="${SCRIPT_PREFIX}local-font-input" placeholder="e.g., Arial, Cascadia Code">
        </div>
        <div class="${SCRIPT_PREFIX}form-group">
            <label for="${SCRIPT_PREFIX}global-font-url">Web font URL:</label>
            <input type="text" id="${SCRIPT_PREFIX}global-font-url" placeholder="https://fonts.googleapis.com/css2?family=...">
            <small>Paste a CSS URL, then enter the exact font-family name from that CSS below.</small>
        </div>
        <div class="${SCRIPT_PREFIX}form-group">
            <label for="${SCRIPT_PREFIX}global-font-family">URL font family:</label>
            <input type="text" id="${SCRIPT_PREFIX}global-font-family" placeholder="Exact font-family name from the CSS">
        </div>
        <div class="${SCRIPT_PREFIX}form-group">
            <label for="${SCRIPT_PREFIX}font-file-input">Or upload a font file:</label>
            <input type="file" id="${SCRIPT_PREFIX}font-file-input" accept=".ttf,.otf,.woff,.woff2">
            <div class="${SCRIPT_PREFIX}font-file-status" id="${SCRIPT_PREFIX}font-file-status">
                <span id="${SCRIPT_PREFIX}font-file-name"></span>
                <button type="button" class="tweak-reset-button" id="${SCRIPT_PREFIX}remove-font-file">Remove</button>
            </div>
            <small>.ttf, .otf, .woff or .woff2 \u2014 applied instantly and stored only in this browser. Max 4 MB (.woff2 is smallest).</small>
        </div>
        <div class="${SCRIPT_PREFIX}form-group">
            <label for="${SCRIPT_PREFIX}font-weight-select">Font weight:</label>
            <select id="${SCRIPT_PREFIX}font-weight-select">
                <option value="300">Light (300)</option>
                <option value="400" selected>Normal (400)</option>
                <option value="500">Medium (500)</option>
                <option value="600">Semi-bold (600)</option>
                <option value="700">Bold (700)</option>
            </select>
        </div>
        <div class="${SCRIPT_PREFIX}button-group">
            <button type="button" class="${SCRIPT_PREFIX}reset-button" id="${SCRIPT_PREFIX}reset-font-button">Reset</button>
            <button type="button" class="${SCRIPT_PREFIX}apply-button" id="${SCRIPT_PREFIX}apply-font-button">Apply</button>
        </div>
    `;

    // --- Chat font section ---
    const fontSettingsContainer = document.createElement("div");
    fontSettingsContainer.className = "tweak-settings-section";
    fontSettingsContainer.innerHTML = `<h3>Chat font customization</h3>`;
    const fontScopeNotice = document.createElement("p");
    fontScopeNotice.className = "tweak-section-note";
    fontScopeNotice.textContent = "These settings only affect the chat message area.";
    fontSettingsContainer.appendChild(fontScopeNotice);

    const localFontSubTitle = document.createElement("div");
    localFontSubTitle.className = "font-customization-subsection-title";
    localFontSubTitle.textContent = "Local font (overrides URL font)";
    fontSettingsContainer.appendChild(localFontSubTitle);
    const localFontDescription = document.createElement("p");
    localFontDescription.className = "tweak-sub-note";
    localFontDescription.textContent = "Use a font installed on your device. Type the exact font name.";
    fontSettingsContainer.appendChild(localFontDescription);
    const localFontFamilyInput = createTextInput("tweak_localFontFamily_input", "Local font:", settingsKeys.localFontFamily, "e.g., Arial, Verdana");
    localFontFamilyInput.style.marginTop = "5px";
    fontSettingsContainer.appendChild(localFontFamilyInput);

    const urlFontSubTitle = document.createElement("div");
    urlFontSubTitle.className = "font-customization-subsection-title";
    urlFontSubTitle.textContent = "Web font (via URL)";
    fontSettingsContainer.appendChild(urlFontSubTitle);
    const fontUrlDescription = document.createElement("p");
    fontUrlDescription.className = "tweak-sub-note";
    fontUrlDescription.textContent = "Import from a URL (e.g., a Google Fonts CSS link).";
    fontSettingsContainer.appendChild(fontUrlDescription);
    const customFontUrlInput = createTextInput("tweak_customFontUrl_input", "Font URL:", settingsKeys.customFontUrl, "Google Fonts URL");
    customFontUrlInput.style.marginTop = "5px";
    fontSettingsContainer.appendChild(customFontUrlInput);
    const customFontFamilyInput = createTextInput("tweak_customFontFamily_input", "URL font family:", settingsKeys.customFontFamily, "Font name from URL");
    fontSettingsContainer.appendChild(customFontFamilyInput);

    const sizeSubTitle = document.createElement("div");
    sizeSubTitle.className = "font-customization-subsection-title";
    sizeSubTitle.textContent = "Font size";
    fontSettingsContainer.appendChild(sizeSubTitle);
    const fontSizeInput = createTextInput("tweak_customFontSize_input", "Font size (px):", settingsKeys.customFontSize, "e.g., 16", "number", {
      min: "8", max: "72", step: "1", inputmode: "numeric"
    });
    fontSizeInput.style.marginTop = "5px";
    fontSettingsContainer.appendChild(fontSizeInput);

    // --- Favicon section ---
    const faviconSettingsSection = document.createElement("div");
    faviconSettingsSection.className = "tweak-settings-section";
    faviconSettingsSection.innerHTML = `<h3>Favicon customization</h3>`;
    const faviconItemContainer = document.createElement("div");
    const faviconInputGroup = document.createElement("div");
    faviconInputGroup.className = "tweak-favicon-input-group";
    const faviconLabelEl = document.createElement("label");
    faviconLabelEl.htmlFor = "tweak_customFaviconData_input";
    faviconLabelEl.textContent = "Upload favicon:";
    const faviconFileInputEl = document.createElement("input");
    faviconFileInputEl.type = "file";
    faviconFileInputEl.id = "tweak_customFaviconData_input";
    faviconFileInputEl.accept = ".ico,.png,.jpg,.jpeg,.svg,.gif";
    faviconInputGroup.append(faviconLabelEl, faviconFileInputEl);
    faviconItemContainer.appendChild(faviconInputGroup);

    const faviconControlsGroup = document.createElement("div");
    faviconControlsGroup.className = "tweak-favicon-controls";
    const faviconPreviewEl = document.createElement("img");
    faviconPreviewEl.id = "tweak_favicon_preview";
    faviconPreviewEl.alt = "Favicon preview";
    const clearFaviconButtonEl = document.createElement("button");
    clearFaviconButtonEl.id = "tweak_clear_favicon_button";
    clearFaviconButtonEl.textContent = "Clear favicon";
    clearFaviconButtonEl.className = "tweak-reset-button";
    clearFaviconButtonEl.type = "button";
    clearFaviconButtonEl.style.display = "none";
    faviconControlsGroup.append(faviconPreviewEl, clearFaviconButtonEl);
    faviconItemContainer.appendChild(faviconControlsGroup);
    faviconSettingsSection.appendChild(faviconItemContainer);

    faviconFileInputEl.addEventListener("change", (event) => {
      const file = event.target.files[0];
      if (!file) return;
      if (file.size > 512 * 1024) {
        showFeedback("Favicon file is too large (max 512 KB).", 2500);
        faviconFileInputEl.value = "";
        return;
      }
      const reader = new FileReader();
      reader.onload = function (e) {
        saveSetting(settingsKeys.customFaviconData, e.target.result);
        faviconPreviewEl.src = e.target.result;
        faviconPreviewEl.style.display = "inline-block";
        clearFaviconButtonEl.style.display = "inline-block";
        showFeedback("Favicon updated.");
      };
      reader.onerror = function () {
        showFeedback("Error reading favicon file.", 2500);
        console.error(`${consolePrefix} Error reading favicon file.`);
      };
      reader.readAsDataURL(file);
    });
    clearFaviconButtonEl.addEventListener("click", () => {
      saveSetting(settingsKeys.customFaviconData, null);
      faviconFileInputEl.value = "";
      faviconPreviewEl.src = "";
      faviconPreviewEl.style.display = "none";
      clearFaviconButtonEl.style.display = "none";
      showFeedback("Favicon cleared. Default restored.", 2500);
    });

    scrollableContent.append(settingsSection, chatColorsSection, globalFontSettingsSection, fontSettingsContainer, faviconSettingsSection);

    const footer = document.createElement("div");
    footer.className = "tweak-modal-footer";
    const closeButtonBottom = document.createElement("button");
    closeButtonBottom.id = "tweak-modal-bottom-close";
    closeButtonBottom.type = "button";
    closeButtonBottom.textContent = "Close";
    closeButtonBottom.addEventListener("click", () => toggleModal(false));
    footer.appendChild(closeButtonBottom);

    modalElement.append(header, feedbackElement, scrollableContent, footer);
    modalOverlay.appendChild(modalElement);
    document.body.appendChild(modalOverlay);

    // --- Global font listeners ---
    const googleFontSelect = document.getElementById(`${SCRIPT_PREFIX}google-font-select`);
    const localFontInput = document.getElementById(`${SCRIPT_PREFIX}local-font-input`);
    const urlFontInput = document.getElementById(`${SCRIPT_PREFIX}global-font-url`);
    const urlFontFamilyInput = document.getElementById(`${SCRIPT_PREFIX}global-font-family`);
    const fontWeightSelect = document.getElementById(`${SCRIPT_PREFIX}font-weight-select`);
    const fontFileInput = document.getElementById(`${SCRIPT_PREFIX}font-file-input`);
    const removeFontFileButton = document.getElementById(`${SCRIPT_PREFIX}remove-font-file`);

    const handleApplyGlobalFont = () => {
      const selectedGoogleFont = googleFontSelect.value;
      const enteredLocalFont = localFontInput.value.trim();
      const enteredUrl = urlFontInput.value.trim();
      const enteredUrlFamily = urlFontFamilyInput.value.trim();
      const selectedWeight = fontWeightSelect.value;
      let settingToSave = null;

      if (selectedGoogleFont) {
        settingToSave = { name: selectedGoogleFont, isGoogle: true, isUrl: false, custom: false, weight: selectedWeight };
      } else if (enteredUrl) {
        if (!(enteredUrl.startsWith("http://") || enteredUrl.startsWith("https://"))) {
          showFeedback("Invalid web font URL. It must start with http:// or https://", 2500);
          return;
        }
        if (!enteredUrlFamily) {
          showFeedback("Please provide the URL font family name.", 2500);
          return;
        }
        settingToSave = { name: enteredUrlFamily, isGoogle: false, isUrl: true, custom: false, url: enteredUrl, weight: selectedWeight };
      } else if (enteredLocalFont) {
        settingToSave = { name: enteredLocalFont, isGoogle: false, isUrl: false, custom: true, weight: selectedWeight };
      } else {
        const storedFontFile = getSetting(settingsKeys.globalFontFile, null);
        if (storedFontFile && storedFontFile.dataUrl) {
          settingToSave = { name: UPLOADED_FONT_FAMILY, isGoogle: false, isUrl: false, custom: false, isFile: true, weight: selectedWeight, fileName: storedFontFile.fileName };
        } else {
          const currentSetting = getSetting(settingsKeys.globalUiFont, null);
          if (currentSetting && (currentSetting.name || currentSetting.isUrl)) {
            settingToSave = { ...currentSetting, weight: selectedWeight };
          } else {
            showFeedback("No global UI font selected.");
            return;
          }
        }
      }
      saveSetting(settingsKeys.globalUiFont, settingToSave);
      updateFontFileStatus();
      showFeedback("Global UI font applied.");
    };

    const handleResetGlobalFont = () => {
      saveSetting(settingsKeys.globalUiFont, null);
      googleFontSelect.value = '';
      localFontInput.value = '';
      urlFontInput.value = '';
      urlFontFamilyInput.value = '';
      fontWeightSelect.value = DEFAULT_FONT_WEIGHT;
      updateFontFileStatus();
      showFeedback("Global UI font reset.");
    };

    document.getElementById(`${SCRIPT_PREFIX}apply-font-button`).addEventListener('click', handleApplyGlobalFont);
    document.getElementById(`${SCRIPT_PREFIX}reset-font-button`).addEventListener('click', handleResetGlobalFont);

    // --- Font file upload listeners ---
    fontFileInput.addEventListener("change", (event) => {
      const file = event.target.files[0];
      if (!file) return;
      const format = getFontFormatFromFileName(file.name);
      if (!format) {
        showFeedback("Unsupported font type. Use .ttf, .otf, .woff or .woff2.", 3000);
        fontFileInput.value = "";
        return;
      }
      if (file.size > FONT_FILE_MAX_BYTES) {
        showFeedback("Font file is too large (max 4 MB). A .woff2 version is much smaller.", 3500);
        fontFileInput.value = "";
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        saveSetting(settingsKeys.globalFontFile, {
          fileName: file.name,
          dataUrl: e.target.result,
          format: format,
        });
        const stored = getSetting(settingsKeys.globalFontFile, null);
        if (!stored || !stored.dataUrl) {
          // Storage failed (saveSetting already showed the error).
          fontFileInput.value = "";
          updateFontFileStatus();
          return;
        }
        saveSetting(settingsKeys.globalUiFont, {
          name: UPLOADED_FONT_FAMILY,
          isGoogle: false, isUrl: false, custom: false, isFile: true,
          weight: fontWeightSelect.value,
          fileName: file.name,
        });
        googleFontSelect.value = '';
        localFontInput.value = '';
        urlFontInput.value = '';
        urlFontFamilyInput.value = '';
        updateFontFileStatus();
        showFeedback(`Font "${file.name}" applied.`);
      };
      reader.onerror = () => {
        showFeedback("Error reading font file.", 2500);
        console.error(`${consolePrefix} Error reading font file.`);
      };
      reader.readAsDataURL(file);
    });

    removeFontFileButton.addEventListener("click", () => {
      const currentSetting = getSetting(settingsKeys.globalUiFont, null);
      saveSetting(settingsKeys.globalFontFile, null);
      if (currentSetting && currentSetting.isFile) {
        saveSetting(settingsKeys.globalUiFont, null);
      }
      fontFileInput.value = "";
      updateFontFileStatus();
      showFeedback("Uploaded font removed.");
    });

    // Mutually exclusive inputs
    googleFontSelect.addEventListener('change', () => {
      if (googleFontSelect.value) {
        localFontInput.value = '';
        urlFontInput.value = '';
        urlFontFamilyInput.value = '';
      }
    });
    localFontInput.addEventListener('input', () => {
      if (localFontInput.value.trim()) {
        googleFontSelect.value = '';
        urlFontInput.value = '';
        urlFontFamilyInput.value = '';
      }
    });
    const urlInputHandler = () => {
      if (urlFontInput.value.trim() || urlFontFamilyInput.value.trim()) {
        googleFontSelect.value = '';
        localFontInput.value = '';
      }
    };
    urlFontInput.addEventListener('input', urlInputHandler);
    urlFontFamilyInput.addEventListener('input', urlInputHandler);

    updateChatColorPreview();
    updateFontFileStatus();
  }

  function loadSettingsIntoModal() {
    if (!modalElement) return;
    modalElement.querySelectorAll(".tweak-checkbox-item input[type='checkbox']").forEach(cb => {
      cb.checked = getSetting(cb.id, false);
    });
    document.getElementById("tweak_workspaceIconColor_input").value = getSetting(settingsKeys.workspaceIconColor, defaultWorkspaceIconColorVisual);
    document.getElementById("tweak_customPageTitle_input").value = getSetting(settingsKeys.customPageTitle, "") || "";
    document.getElementById("tweak_localFontFamily_input").value = getSetting(settingsKeys.localFontFamily, "") || "";
    document.getElementById("tweak_customFontUrl_input").value = getSetting(settingsKeys.customFontUrl, "") || "";
    document.getElementById("tweak_customFontFamily_input").value = getSetting(settingsKeys.customFontFamily, "") || "";
    const fontSize = getSetting(settingsKeys.customFontSize, null);
    document.getElementById("tweak_customFontSize_input").value = fontSize !== null ? fontSize : "";

    loadChatColorInputs();
    updateChatColorPreview();

    const fontSetting = getSetting(settingsKeys.globalUiFont, null);
    const googleFontSelect = document.getElementById(`${SCRIPT_PREFIX}google-font-select`);
    const localFontInput = document.getElementById(`${SCRIPT_PREFIX}local-font-input`);
    const urlFontInput = document.getElementById(`${SCRIPT_PREFIX}global-font-url`);
    const urlFontFamilyInput = document.getElementById(`${SCRIPT_PREFIX}global-font-family`);
    const fontWeightSelect = document.getElementById(`${SCRIPT_PREFIX}font-weight-select`);

    googleFontSelect.value = '';
    localFontInput.value = '';
    urlFontInput.value = '';
    urlFontFamilyInput.value = '';
    fontWeightSelect.value = DEFAULT_FONT_WEIGHT;

    if (fontSetting && (fontSetting.name || fontSetting.isUrl)) {
      if (fontSetting.isGoogle) {
        googleFontSelect.value = fontSetting.name || '';
      } else if (fontSetting.isUrl) {
        urlFontInput.value = fontSetting.url || '';
        urlFontFamilyInput.value = fontSetting.name || '';
      } else if (fontSetting.isFile) {
        // Shown via the uploaded-file status row instead of the text inputs.
      } else {
        localFontInput.value = fontSetting.name || '';
      }
      fontWeightSelect.value = fontSetting.weight || DEFAULT_FONT_WEIGHT;
    }

    updateFontFileStatus();
    const fontFileInputEl = document.getElementById(`${SCRIPT_PREFIX}font-file-input`);
    if (fontFileInputEl) fontFileInputEl.value = "";

    const storedFaviconDataRaw = getSetting(settingsKeys.customFaviconData, null);
    const faviconFileInputElModal = document.getElementById("tweak_customFaviconData_input");
    const faviconPreviewElModal = document.getElementById("tweak_favicon_preview");
    const clearFaviconButtonElModal = document.getElementById("tweak_clear_favicon_button");
    const cleanedFaviconDataModal = cleanValue(storedFaviconDataRaw);
    if (faviconFileInputElModal) faviconFileInputElModal.value = "";
    const hasFavicon = cleanedFaviconDataModal && cleanedFaviconDataModal.trim() !== "";
    if (faviconPreviewElModal) {
      faviconPreviewElModal.src = hasFavicon ? cleanedFaviconDataModal : "";
      faviconPreviewElModal.style.display = hasFavicon ? "inline-block" : "none";
    }
    if (clearFaviconButtonElModal) clearFaviconButtonElModal.style.display = hasFavicon ? "inline-block" : "none";
    if (feedbackElement) feedbackElement.textContent = "\u00A0";
  }

  function saveSetting(key, value) {
    try {
      let valueToStore = value;
      if ([settingsKeys.customFontUrl, settingsKeys.customFontFamily, settingsKeys.localFontFamily, settingsKeys.customPageTitle, settingsKeys.customFaviconData].includes(key)) {
        valueToStore = (value && String(value).trim() !== "") ? String(value).trim() : null;
      } else if (key === settingsKeys.customFontSize) {
        valueToStore = (value !== null && !isNaN(parseInt(value, 10)) && String(value).trim() !== "") ? parseInt(value, 10) : null;
      }

      if (valueToStore === null) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(
          key,
          (typeof valueToStore === 'object' || typeof valueToStore === 'boolean' || typeof valueToStore === 'number') ?
            JSON.stringify(valueToStore) : valueToStore
        );
      }

      const silentKeys = [
        settingsKeys.customFaviconData,
        settingsKeys.globalUiFont,
        settingsKeys.globalFontFile,
        ...CHAT_COLOR_KEYS,
      ];
      if (!silentKeys.includes(key)) {
        showFeedback("Settings saved.");
      }

      applyStylesBasedOnSettings();
      if (key === settingsKeys.customPageTitle) applyCustomTitle();
      if ([settingsKeys.customFontUrl, settingsKeys.customFontFamily, settingsKeys.localFontFamily, settingsKeys.customFontSize].includes(key)) {
        applyCustomFont();
      }
      if (key === settingsKeys.customFaviconData) applyCustomFavicon();
      if (key === settingsKeys.globalUiFont || key === settingsKeys.globalFontFile) applyGlobalUiFont();
      if (CHAT_COLOR_KEYS.includes(key)) {
        applyChatColors();
        updateChatColorPreview();
      }

    } catch (error) {
      console.error(`${consolePrefix} Error saving setting ${key}:`, error);
      const isQuotaError = error && (error.name === "QuotaExceededError" || error.code === 22 || error.code === 1014);
      showFeedback(isQuotaError ? "Not enough browser storage for this. Try a smaller file (.woff2 fonts are tiny)." : "Error saving settings.", 3500);
    }
  }

  function toggleModal(forceState) {
    if (!modalOverlay) return;
    const isVisible = window.getComputedStyle(modalOverlay).display !== "none";
    const shouldShow = typeof forceState === "boolean" ? forceState : !isVisible;
    if (shouldShow) {
      loadSettingsIntoModal();
      modalOverlay.style.display = "flex";
    } else {
      modalOverlay.style.display = "none";
    }
    // Re-sync the button's active/inactive look immediately
    syncTweaksButton();
  }

  document.addEventListener("keydown", (event) => {
    const isMac = navigator.userAgent.toUpperCase().includes("MAC");
    const modifierPressed = isMac ? event.metaKey : event.altKey;
    if (event.shiftKey && modifierPressed && event.key.toUpperCase() === "T") {
      event.preventDefault();
      event.stopPropagation();
      toggleModal();
    }
    if (event.key === 'Escape' && modalOverlay && window.getComputedStyle(modalOverlay).display !== 'none') {
      event.preventDefault();
      toggleModal(false);
    }
  });

  // ---------------------------------------------------------------
  // Workspace bar "Tweaks" button
  // ---------------------------------------------------------------
  function getReferenceButton(workspaceBar) {
    // Prefer buttons unlikely to be in an "active" state, in priority order.
    const cloudSyncBtn = workspaceBar.querySelector('button[data-element-id="workspace-tab-cloudsync"]');
    const settingsBtn = workspaceBar.querySelector('button[data-element-id="workspace-tab-settings"]');
    const chatBtn = workspaceBar.querySelector('button[data-element-id="workspace-tab-chat"]');
    return cloudSyncBtn || settingsBtn || chatBtn || workspaceBar.querySelector('button[data-element-id^="workspace-tab-"]');
  }

  function syncTweaksButton() {
    const workspaceBar = document.querySelector('div[data-element-id="workspace-bar"]');
    if (!workspaceBar) return;

    const referenceButton = getReferenceButton(workspaceBar);
    if (!referenceButton) return;

    let tweaksButton = document.getElementById("workspace-tab-tweaks");

    // 1. Create the button if it doesn't exist yet
    if (!tweaksButton) {
      tweaksButton = document.createElement("button");
      tweaksButton.id = "workspace-tab-tweaks";
      tweaksButton.type = "button";
      tweaksButton.title = "Open UI Tweaks (Shift+Alt+T or Shift+Cmd+T)";
      tweaksButton.setAttribute("aria-label", "Open UI Tweaks");
      tweaksButton.dataset.elementId = "workspace-tab-tweaks";
      tweaksButton.dataset.tooltipId = "global";
      tweaksButton.dataset.tooltipPlace = "right";

      const svgIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svgIcon.setAttribute("viewBox", "0 0 24 24");
      svgIcon.setAttribute("fill", "currentColor");
      const svgPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      svgPath.setAttribute("d", "M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4c-.83 0-1.5-.67-1.5-1.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z");
      svgIcon.appendChild(svgPath);

      const textSpan = document.createElement("span");
      textSpan.textContent = "Tweaks";

      tweaksButton.append(svgIcon, textSpan);
      tweaksButton.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleModal(true);
      });

      // Insert directly before the Settings tab so it sits with the other tabs;
      // fall back to sitting right after the reference button.
      const settingsBtn = workspaceBar.querySelector('button[data-element-id="workspace-tab-settings"]');
      if (settingsBtn && settingsBtn.parentNode) {
        settingsBtn.parentNode.insertBefore(tweaksButton, settingsBtn);
      } else if (referenceButton.parentNode) {
        referenceButton.parentNode.insertBefore(tweaksButton, referenceButton.nextSibling);
      }
    }

    // 2. Continuously mirror the reference button so alignment always matches
    let targetClass = referenceButton.className;
    const isTweaksActive = modalOverlay && window.getComputedStyle(modalOverlay).display !== "none";
    const isRefActive = targetClass.includes("bg-white/20") && !targetClass.includes("hover:bg-white/20");

    if (isRefActive && !isTweaksActive) {
      // Downgrade the copied "active" look to the normal inactive look
      targetClass = targetClass.replace("bg-white/20", "sm:hover:bg-white/20");
      targetClass = targetClass.replace(/\btext-white\b/g, "text-white/70");
    } else if (isTweaksActive && !isRefActive) {
      // Show as active while the Tweaks modal is open
      targetClass = targetClass.replace("sm:hover:bg-white/20", "bg-white/20");
      targetClass = targetClass.replace(/\btext-white\/70\b/g, "text-white");
    }
    if (tweaksButton.className !== targetClass) {
      tweaksButton.className = targetClass;
    }

    // Mirror the icon's classes (size, margins) so it lines up pixel-perfect
    const refSvg = referenceButton.querySelector("svg");
    const mySvg = tweaksButton.querySelector("svg");
    if (mySvg) {
      const refSvgClass = refSvg ? (refSvg.getAttribute("class") || "") : "w-4 h-4 flex-shrink-0";
      if (mySvg.getAttribute("class") !== refSvgClass) {
        mySvg.setAttribute("class", refSvgClass || "w-4 h-4 flex-shrink-0");
      }
      mySvg.style.color = getSetting(settingsKeys.workspaceIconColor, defaultWorkspaceIconColorVisual);
    }

    // Mirror the label's classes and visibility (handles collapsed/mobile bar)
    const refSpan = referenceButton.querySelector("span");
    const mySpan = tweaksButton.querySelector("span");
    if (mySpan) {
      if (refSpan) {
        const refSpanClass = refSpan.getAttribute("class") || "";
        if (mySpan.getAttribute("class") !== refSpanClass) {
          mySpan.setAttribute("class", refSpanClass);
        }
        mySpan.style.display = window.getComputedStyle(refSpan).display === "none" ? "none" : "";
      } else {
        mySpan.style.display = "none";
      }
    }

    // Mirror tooltip behavior
    if (referenceButton.hasAttribute("data-tooltip-content")) {
      tweaksButton.setAttribute("data-tooltip-content", "Tweaks");
    } else {
      tweaksButton.removeAttribute("data-tooltip-content");
    }
  }

  // ---------------------------------------------------------------
  // Chat font
  // ---------------------------------------------------------------
  function applyCustomFont() {
    const customFontUrl = getSetting(settingsKeys.customFontUrl, null);
    const customFontFamilyFromUrl = getSetting(settingsKeys.customFontFamily, null);
    const localFontFamilyUser = getSetting(settingsKeys.localFontFamily, null);
    const customFontSizeRaw = getSetting(settingsKeys.customFontSize, null);
    const styleId = "tweak-custom-font-style";
    let styleElement = document.getElementById(styleId);
    if (!styleElement) {
      styleElement = document.createElement("style");
      styleElement.id = styleId;
      document.head.appendChild(styleElement);
    }
    const cssRules = [];
    const cleanedUrl = cleanValue(customFontUrl);
    const cleanedFamilyFromUrl = cleanValue(customFontFamilyFromUrl);
    const cleanedLocalFamily = cleanValue(localFontFamilyUser);
    const parsedSize = parseInt(customFontSizeRaw, 10);
    const cleanedSize = (customFontSizeRaw !== null && !isNaN(parsedSize) && parsedSize > 0) ? parsedSize : null;

    if (cleanedUrl && (cleanedUrl.startsWith("http://") || cleanedUrl.startsWith("https://"))) {
      cssRules.push(`@import url('${cleanedUrl}');`);
    }
    let effectiveFontFamily = cleanedLocalFamily || cleanedFamilyFromUrl;
    if (effectiveFontFamily) {
      effectiveFontFamily = effectiveFontFamily.trim();
      if (effectiveFontFamily.includes(" ") && !/^['"].*['"]$/.test(effectiveFontFamily)) {
        effectiveFontFamily = `'${effectiveFontFamily}'`;
      }
    }
    const styleDeclarations = [];
    if (effectiveFontFamily) {
      const fallbackFontStack = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"`;
      styleDeclarations.push(`  font-family: ${effectiveFontFamily}, ${fallbackFontStack} !important;`);
    }
    if (cleanedSize) {
      styleDeclarations.push(`  font-size: ${cleanedSize}px !important;`);
    }

    if (styleDeclarations.length === 0) {
      if (styleElement.textContent !== "") styleElement.textContent = "";
      return;
    }

    const declarationsString = styleDeclarations.join("\n");
    cssRules.push(`
      [data-element-id="chat-space-middle-part"],
      [data-element-id="chat-space-middle-part"] .prose,
      [data-element-id="chat-space-middle-part"] .prose-sm,
      [data-element-id="chat-space-middle-part"] .text-sm,
      div[data-radix-scroll-area-viewport] .whitespace-pre-wrap,
      [data-element-id="user-message"],
      [data-element-id="user-message"] > div
      {
      ${declarationsString}
      }`);
    const newStyleContent = cssRules.join("\n");
    if (styleElement.textContent !== newStyleContent) {
      styleElement.textContent = newStyleContent;
    }
  }

  // ---------------------------------------------------------------
  // Favicon
  // ---------------------------------------------------------------
  function applyCustomFavicon() {
    // Pause the observer so our own DOM changes don't re-trigger it
    if (faviconObserver && faviconObserverActive) {
      faviconObserver.disconnect();
      faviconObserverActive = false;
    }
    const faviconDataRaw = getSetting(settingsKeys.customFaviconData, null);
    const customFaviconHref = cleanValue(faviconDataRaw);
    document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]').forEach(link => link.remove());
    const newFaviconLink = document.createElement("link");
    newFaviconLink.rel = "icon";
    if (customFaviconHref && customFaviconHref.trim() !== "") {
      newFaviconLink.href = customFaviconHref;
      const typeMap = {
        'data:image/svg+xml': 'image/svg+xml',
        'data:image/png': 'image/png',
        'data:image/jpeg': 'image/jpeg',
        'data:image/gif': 'image/gif',
        'data:image/x-icon': 'image/x-icon',
      };
      for (const prefix in typeMap) {
        if (customFaviconHref.startsWith(prefix)) {
          newFaviconLink.type = typeMap[prefix];
          break;
        }
      }
    } else {
      newFaviconLink.href = DEFAULT_FALLBACK_FAVICON;
      if (DEFAULT_FALLBACK_FAVICON.endsWith('.ico')) newFaviconLink.type = 'image/x-icon';
    }
    document.head.appendChild(newFaviconLink);
    // Resume observing
    if (faviconObserver && document.head) {
      faviconObserver.observe(document.head, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["href", "rel", "type"],
      });
      faviconObserverActive = true;
    }
  }

  function setupFaviconObserver() {
    if (faviconObserver) {
      faviconObserver.disconnect();
      faviconObserverActive = false;
    }
    faviconObserver = new MutationObserver((mutationsList) => {
      let sitePotentiallyChangedFavicon = false;
      const currentCustomHref = cleanValue(getSetting(settingsKeys.customFaviconData, null)) || DEFAULT_FALLBACK_FAVICON;
      for (const mutation of mutationsList) {
        if (mutation.type === "childList") {
          mutation.addedNodes.forEach(node => {
            if (node.nodeName === "LINK" && (node.getAttribute('rel') === 'icon' || node.getAttribute('rel') === 'shortcut icon')) {
              if (node.href !== currentCustomHref) sitePotentiallyChangedFavicon = true;
            }
          });
          mutation.removedNodes.forEach(node => {
            if (node.nodeName === "LINK" && (node.getAttribute('rel') === 'icon' || node.getAttribute('rel') === 'shortcut icon')) {
              sitePotentiallyChangedFavicon = true;
            }
          });
        } else if (mutation.type === "attributes" && mutation.target.nodeName === "LINK" &&
          (mutation.target.getAttribute('rel') === 'icon' || mutation.target.getAttribute('rel') === 'shortcut icon')) {
          if (mutation.target.href !== currentCustomHref) sitePotentiallyChangedFavicon = true;
        }
      }
      if (sitePotentiallyChangedFavicon) {
        setTimeout(() => applyCustomFavicon(), 50);
      }
    });
    if (document.head) {
      faviconObserver.observe(document.head, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["href", "rel", "type"],
      });
      faviconObserverActive = true;
    } else {
      console.warn(`${consolePrefix} document.head not available for faviconObserver. Retrying.`);
      setTimeout(setupFaviconObserver, 200);
    }
  }

  // ---------------------------------------------------------------
  // Init & main observer (debounced with requestAnimationFrame)
  // ---------------------------------------------------------------
  function syncAll() {
    applyStylesBasedOnSettings();
    applyCustomTitle();
    applyCustomFont();
    applyChatColors();
    syncTweaksButton();
  }

  function initializeTweaks() {
    if (originalPageTitle === null) originalPageTitle = document.title;
    createSettingsModal();
    syncAll();
    applyGlobalUiFont();
    applyCustomFavicon();
    setupFaviconObserver();
  }

  let syncScheduled = false;
  const observer = new MutationObserver(() => {
    if (syncScheduled) return;
    syncScheduled = true;
    requestAnimationFrame(() => {
      syncScheduled = false;
      syncAll();
    });
  });

  function startObserving() {
    if (!document.body) {
      setTimeout(startObserving, 100);
      return;
    }
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    initializeTweaks();
    startObserving();
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      initializeTweaks();
      startObserving();
    });
  }
  console.log(`${consolePrefix} Initialized. Shortcut: Shift+Alt+T (Win/Linux) or Shift+Cmd+T (Mac).`);

})();
