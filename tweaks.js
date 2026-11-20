(function () {
  "use strict";

  // --- Configuration ---
  const SCRIPT_PREFIX = 'tmfc_';

  // Popular Google Fonts. They show first in the font search, and they keep
  // the picker working when the full list can't be downloaded.
  // Each line: "Family|category|normal weights|italic weights". The weights
  // are base-36 bitmasks over 100..900 (bit 0 = 100 ... bit 8 = 900).
  // Categories: s = sans-serif, r = serif, d = display, h = handwriting, m = monospace.
  const POPULAR_GOOGLE_FONTS_DATA = [
    "Inter|s|e7|e7", "Roboto|s|e7|e7", "Open Sans|s|70|70", "Lato|s|99|99",
    "Montserrat|s|e7|e7", "Poppins|s|e7|e7", "Nunito|s|e6|e6", "Raleway|s|e7|e7",
    "Work Sans|s|e7|e7", "DM Sans|s|e7|e7", "Manrope|s|72|0", "Plus Jakarta Sans|s|72|72",
    "Outfit|s|e7|0", "Figtree|s|e4|e4", "Rubik|s|e4|e4", "Mulish|s|e6|e6",
    "Noto Sans|s|e7|e7", "Source Sans 3|s|e6|e6", "IBM Plex Sans|s|3j|3j", "Fira Sans|s|e7|e7",
    "Ubuntu|s|2k|2k", "PT Sans|s|20|20", "Karla|s|72|72", "Barlow|s|e7|e7",
    "Lexend|s|e7|0", "Sora|s|73|0", "Space Grotesk|s|3g|0", "Urbanist|s|e7|e7",
    "Onest|s|e7|0", "Geist|s|e7|0", "Albert Sans|s|e7|e7", "Instrument Sans|s|3c|3c",
    "Public Sans|s|e7|e7", "Quicksand|s|3g|0", "Josefin Sans|s|3j|3j", "Titillium Web|s|a6|32",
    "Arimo|s|3c|3c", "Roboto Condensed|s|e7|e7", "Oswald|s|3i|0", "Atkinson Hyperlegible Next|s|72|72",
    "Nunito Sans|s|e6|e6", "Hanken Grotesk|s|e7|e7", "Red Hat Display|s|e4|e4",
    "Merriweather|r|e4|e4", "Lora|r|3c|3c", "Playfair Display|r|e0|e0", "EB Garamond|r|6w|6w",
    "Cormorant Garamond|r|3g|3g", "Libre Baskerville|r|3c|3c", "Source Serif 4|r|e6|e6",
    "Noto Serif|r|e7|e7", "PT Serif|r|20|20", "Roboto Slab|r|e7|0", "Crimson Pro|r|e6|e6",
    "Literata|r|e6|e6", "Newsreader|r|72|72", "Fraunces|r|e7|e7", "IBM Plex Serif|r|3j|3j",
    "JetBrains Mono|m|73|73", "Fira Code|m|3g|0", "Roboto Mono|m|3j|3j", "IBM Plex Mono|m|3j|3j",
    "Source Code Pro|m|e6|e6", "Space Mono|m|20|20", "Geist Mono|m|e7|0", "Bebas Neue|s|8|0",
  ].join("\n");
  // Where the full Google Fonts list comes from, tried in order. Both allow
  // requests from the browser. Fontsource mirrors Google Fonts and updates daily.
  const GOOGLE_FONT_CATALOG_SOURCES = [
    { name: "Fontsource", url: "https://api.fontsource.org/v1/fonts?type=google" },
    { name: "jsDelivr", url: "https://cdn.jsdelivr.net/npm/google-font-metadata@6/data/api-response.json" },
  ];
  const GOOGLE_FONT_CATALOG_CACHE_KEY = "tweak_googleFontCatalogCache";
  const GOOGLE_FONT_CATALOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // refresh the list weekly
  const GOOGLE_FONT_CATALOG_TIMEOUT_MS = 15000;
  const GOOGLE_FONT_RESULTS_LIMIT = 60;
  const ALL_FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];
  const FONT_WEIGHT_NAMES = {
    100: "Thin", 200: "Extra-light", 300: "Light", 400: "Normal", 500: "Medium",
    600: "Semi-bold", 700: "Bold", 800: "Extra-bold", 900: "Black",
  };
  const FONT_CATEGORY_CODES = { "sans-serif": "s", serif: "r", display: "d", handwriting: "h", monospace: "m" };
  const FONT_CATEGORY_LABELS = { s: "Sans", r: "Serif", d: "Display", h: "Handwriting", m: "Mono", o: "Other" };
  const UI_FONT_FALLBACK_STACK = 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"';
  const PREVIEW_URL_DELAY_MS = 700;
  // Where the UI weight applies: TypingMind's own app and its pop-up menus and
  // dialogs. Panels that other extensions add to the page sit outside these.
  const UI_WEIGHT_SCOPES = ["#__next", "#headlessui-portal-root", "[data-radix-popper-content-wrapper]"];
  // Chat text that keeps the chat text weight: the conversation (replies and
  // sent messages). The message box is part of the interface, so it follows
  // the UI weight while you type.
  const CHAT_TEXT_ROOTS = ['[data-element-id="chat-space-middle-part"]'];
  const DEFAULT_FONT_WEIGHT = '400';
  const FONT_FILE_MAX_BYTES = 4 * 1024 * 1024; // 4 MB raw file cap (localStorage is limited)
  const UPLOADED_FONT_FAMILY = 'TMTweaksUploadedFont';
  const CHAT_FONT_FAMILY_PREFIX = 'TMTweaksChat ';
  const HIDDEN_LOGO_ATTR = 'data-tm-tweaks-hidden-logo';

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
    chatFontFile: "tweak_chatFontFileData",
    sidebarFontSize: "tweak_sidebarFontSize",
    userBubbleBgColor: "tweak_userBubbleBgColor",
    userBubbleTextColor: "tweak_userBubbleTextColor",
  };

  const CHAT_COLOR_KEYS = [
    settingsKeys.userBubbleBgColor,
    settingsKeys.userBubbleTextColor,
  ];

  // Sidebar containers whose text follows the menu bar chat list size setting.
  const SIDEBAR_TEXT_SELECTORS = [
    '[data-element-id="side-bar-middle-part"]',
    '[data-element-id="custom-chat-item"]',
    '[data-element-id="selected-chat-item"]',
    '[data-element-id="chat-folder"]',
  ];
  const SIDEBAR_TEXT_TAGS = ["div", "span", "p", "a", "button"];

  // Visual fallbacks used by the pickers and the live preview when nothing is set.
  const CHAT_COLOR_DEFAULTS = {
    bubbleBg: "#2563eb",
    bubbleText: "#ffffff",
  };

  // One-tap color themes for the user's message bubble.
  const CHAT_COLOR_THEMES = [
    { name: "Default", reset: true },
    { name: "Ocean",    bubbleBg: "#2563eb", bubbleText: "#ffffff" },
    { name: "Midnight", bubbleBg: "#334155", bubbleText: "#f1f5f9" },
    { name: "Forest",   bubbleBg: "#16a34a", bubbleText: "#f0fdf4" },
    { name: "Sunset",   bubbleBg: "#ea580c", bubbleText: "#fff7ed" },
    { name: "Grape",    bubbleBg: "#7c3aed", bubbleText: "#f5f3ff" },
    { name: "Rose",     bubbleBg: "#e11d48", bubbleText: "#fff1f2" },
    { name: "Teal",     bubbleBg: "#0d9488", bubbleText: "#f0fdfa" },
    { name: "Mono",     bubbleBg: "#e5e7eb", bubbleText: "#111827" },
  ];

  const consolePrefix = "TypingMind Tweaks:";
  const defaultWorkspaceIconColorVisual = "#9ca3af";
  const DEFAULT_FALLBACK_FAVICON = "/favicon.ico";
  let originalPageTitle = null;
  let faviconObserver = null;
  let faviconObserverActive = false;
  let activeGlobalFontSheet = null; // stylesheet handle, see attachStylesheetWithFallback()
  let activeUploadedFontFace = null;

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
  // Adds a stylesheet <link>. If it fails, the next URL in the list is tried.
  // Returns a handle so the stylesheet can be removed (or a pending fallback
  // cancelled) later.
  function attachStylesheetWithFallback(urls, label) {
    const list = urls.filter((url, index) => url && urls.indexOf(url) === index);
    const handle = { requested: list[0], link: null, cancelled: false, failed: false };
    const attempt = (index) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = list[index];
      link.onerror = () => {
        if (handle.cancelled) return;
        link.remove();
        handle.link = null;
        if (index + 1 < list.length) {
          attempt(index + 1);
        } else {
          handle.failed = true;
          if (label) console.error(`${consolePrefix} Error loading ${label}.`);
        }
      };
      document.head.appendChild(link);
      handle.link = link;
    };
    if (list.length) attempt(0);
    return handle;
  }

  function detachStylesheet(handle) {
    if (!handle) return;
    handle.cancelled = true;
    if (handle.link) handle.link.remove();
    handle.link = null;
  }

  function removeActiveGlobalUIFontLink() {
    detachStylesheet(activeGlobalFontSheet);
    activeGlobalFontSheet = null;
  }

  // Swaps the global font stylesheet, unless the same one is already loaded
  // (re-adding it would make the whole app flash its fallback font).
  function setGlobalFontStylesheet(urls, label) {
    if (activeGlobalFontSheet && !activeGlobalFontSheet.failed && activeGlobalFontSheet.requested === urls[0]) return;
    removeActiveGlobalUIFontLink();
    activeGlobalFontSheet = attachStylesheetWithFallback(urls, label);
  }

  function googleFontCssUrl(family, axisSpec) {
    const familyParam = encodeURIComponent(String(family).trim()).replace(/%20/g, "+");
    return `https://fonts.googleapis.com/css2?family=${familyParam}${axisSpec ? `:${axisSpec}` : ""}&display=swap`;
  }

  // Loads every weight (and italic) the family really has, so bold text and
  // the chosen weight use real font files instead of browser-faked ones.
  function loadGlobalGoogleFont(fontName, axisSpec) {
    if (!fontName) {
      removeActiveGlobalUIFontLink();
      return;
    }
    const spec = axisSpec || buildGoogleFontAxisSpec(findGoogleFont(fontName));
    // If Google rejects that request, fall back to the family's regular style.
    setGlobalFontStylesheet(
      [googleFontCssUrl(fontName, spec), googleFontCssUrl(fontName, "")],
      `Global UI Google Font: ${fontName}`
    );
  }

  function loadGlobalUrlFont(fontUrl) {
    const cleaned = cleanValue(fontUrl);
    if (!cleaned || !(cleaned.startsWith("http://") || cleaned.startsWith("https://"))) {
      removeActiveGlobalUIFontLink();
      return;
    }
    setGlobalFontStylesheet([cleaned], `Global UI Web Font URL: ${cleaned}`);
  }

  function getFontFormatFromFileName(fileName) {
    const ext = (String(fileName || '').split('.').pop() || '').toLowerCase();
    const map = { woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype' };
    return map[ext] || null;
  }

  // Guesses family name, weight and style from a font file name, e.g.
  // "TestTiemposText-BoldItalic BF66cb09e5c2.otf" -> { family: "TestTiemposText", weight: 700, italic: true }
  function parseFontFileName(fileName) {
    const WEIGHT_NAMES = [
      ["extrablack", 950], ["ultrablack", 950],
      ["extrabold", 800], ["ultrabold", 800],
      ["semibold", 600], ["demibold", 600],
      ["extralight", 200], ["ultralight", 200],
      ["hairline", 100], ["thin", 100],
      ["light", 300],
      ["regular", 400], ["normal", 400], ["book", 400],
      ["medium", 500],
      ["bold", 700],
      ["heavy", 900], ["black", 900],
    ];
    // Common abbreviations, matched only as a whole token.
    const ABBREVIATIONS = {
      th: { w: 100 }, xlt: { w: 200 },
      lt: { w: 300 }, rg: { w: 400 }, reg: { w: 400 }, bk: { w: 400 },
      md: { w: 500 }, med: { w: 500 }, sb: { w: 600 }, sbd: { w: 600 }, smbd: { w: 600 },
      bd: { w: 700 }, bld: { w: 700 }, xb: { w: 800 }, xbd: { w: 800 },
      hv: { w: 900 }, blk: { w: 900 },
      it: { i: true }, ital: { i: true }, obl: { i: true },
      thit: { w: 100, i: true }, ltit: { w: 300, i: true },
      rgit: { w: 400, i: true }, regit: { w: 400, i: true }, mdit: { w: 500, i: true },
      sbit: { w: 600, i: true }, bdit: { w: 700, i: true }, xbit: { w: 800, i: true },
      hvit: { w: 900, i: true }, blkit: { w: 900, i: true },
    };
    const base = String(fileName || "").replace(/\.[^.]+$/, "").replace(/[_\s]+/g, "-");
    const tokens = base.split("-").filter(Boolean);
    let weight = null;
    let italic = false;
    const familyTokens = [];
    tokens.forEach((token) => {
      let work = token;
      let low = work.toLowerCase();
      const abbrev = ABBREVIATIONS[low];
      if (abbrev) {
        if (abbrev.w) weight = abbrev.w;
        if (abbrev.i) italic = true;
        return;
      }
      if (/(italic|oblique)$/.test(low)) {
        italic = true;
        work = work.slice(0, work.length - (low.endsWith("italic") ? 6 : 7));
        low = work.toLowerCase();
      }
      if (!work) return;
      if (low === "demi") { weight = 600; return; }
      for (const [name, w] of WEIGHT_NAMES) {
        if (low === name) { weight = w; work = ""; break; }
        if (low.endsWith(name) && low.length > name.length) {
          weight = w;
          work = work.slice(0, work.length - name.length);
          break;
        }
      }
      if (!work) return;
      if (/^\d{3}$/.test(work) && +work >= 100 && +work <= 950) {
        weight = +work;
        return;
      }
      // Drop version numbers and hash/serial codes (e.g. "BF66cb09e5c26bb3b",
      // "2024", "v1.2") so files from the same family group together.
      const digitCount = (work.match(/\d/g) || []).length;
      const looksLikeJunk =
        /^v?\d+([._-]\d+)*$/i.test(work) ||
        (work.length >= 8 && digitCount >= 3) ||
        digitCount >= 5;
      if (!looksLikeJunk) familyTokens.push(work);
    });
    const family = (familyTokens.join(" ") || "Uploaded font").replace(/['"\\]/g, "").trim();
    return { family: family || "Uploaded font", weight: weight === null ? 400 : weight, italic };
  }

  function fontVariantLabel(file) {
    const names = { 100: "Thin", 200: "ExtraLight", 300: "Light", 400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold", 800: "ExtraBold", 900: "Black", 950: "ExtraBlack" };
    const w = file.weight || 400;
    const base = names[w] || String(w);
    if (file.italic) return w === 400 ? "Italic" : `${base} Italic`;
    return base;
  }

  function chatFontFamilyCssName(family) {
    return CHAT_FONT_FAMILY_PREFIX + family;
  }

  // The stored chat font files can be several MB, so they're parsed once and
  // kept in memory until the setting changes, instead of on every page update
  // (which happens constantly while a reply is streaming in).
  let chatFontStoreCache = null;

  function invalidateChatFontStore() {
    chatFontStoreCache = null;
  }

  // Returns a copy, so callers can change it freely before saving.
  function getChatFontStore() {
    if (!chatFontStoreCache) chatFontStoreCache = readChatFontStore();
    return { activeFamily: chatFontStoreCache.activeFamily, files: chatFontStoreCache.files.slice() };
  }

  // Reads the stored chat font files, migrating the old single-file format.
  // Names are re-parsed on every read, so parser improvements automatically
  // re-group files that were uploaded earlier.
  function readChatFontStore() {
    const raw = getSetting(settingsKeys.chatFontFile, null);
    if (!raw || typeof raw !== "object") return { activeFamily: null, files: [] };
    if (Array.isArray(raw.files)) {
      const files = [];
      raw.files.forEach((f) => {
        if (!f || !f.dataUrl) return;
        const parsed = parseFontFileName(f.fileName);
        const entry = { ...f, family: parsed.family, weight: parsed.weight, italic: parsed.italic };
        const dupIndex = files.findIndex((x) =>
          x.family === entry.family && (x.weight || 400) === entry.weight && !!x.italic === entry.italic
        );
        if (dupIndex >= 0) files[dupIndex] = entry; else files.push(entry);
      });
      let activeFamily = raw.activeFamily || null;
      if (activeFamily && !files.some((f) => f.family === activeFamily)) {
        // The stored family name predates a parser change; follow the file it pointed at.
        const source = raw.files.find((f) => f && f.dataUrl && f.family === activeFamily);
        activeFamily = source ? parseFontFileName(source.fileName).family : null;
        if (activeFamily && !files.some((f) => f.family === activeFamily)) activeFamily = null;
      }
      return { activeFamily, files };
    }
    if (raw.dataUrl) {
      const parsed = parseFontFileName(raw.fileName);
      const localSet = !!cleanValue(getSetting(settingsKeys.localFontFamily, null));
      const familySet = !!cleanValue(getSetting(settingsKeys.customFontFamily, null));
      return {
        activeFamily: (!localSet && !familySet) ? parsed.family : null,
        files: [{ fileName: raw.fileName, dataUrl: raw.dataUrl, format: raw.format, family: parsed.family, weight: parsed.weight, italic: parsed.italic }],
      };
    }
    return { activeFamily: null, files: [] };
  }

  // Injects (or removes) the @font-face rule for an uploaded font file.
  // The CSS format() hint is deliberately left out here: when a hint does not
  // match the real bytes of the file, the browser skips the source silently and
  // the uploaded font appears to do nothing. Used as the fallback path only.
  // Returns true when the font face is ready to use.
  function syncUploadedFontFace(fileData, styleId, fontFamily) {
    let styleEl = document.getElementById(styleId);
    if (!fileData || !fileData.dataUrl) {
      if (styleEl) styleEl.remove();
      return false;
    }
    const css = `@font-face { font-family: '${fontFamily}'; src: url('${fileData.dataUrl}'); font-display: swap; }`;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }
    if (styleEl.textContent !== css) styleEl.textContent = css;
    return true;
  }

  // Turns a stored base64 data URL back into raw bytes for the FontFace API.
  function dataUrlToArrayBuffer(dataUrl) {
    const raw = String(dataUrl || "");
    const commaIndex = raw.indexOf(",");
    if (commaIndex === -1) return null;
    if (!raw.slice(0, commaIndex).includes(";base64")) return null;
    try {
      const binary = atob(raw.slice(commaIndex + 1));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes.buffer;
    } catch (e) {
      console.error(`${consolePrefix} Could not decode the stored global font file.`, e);
      return null;
    }
  }

  function unregisterUploadedFontFace() {
    if (activeUploadedFontFace && document.fonts) {
      try { document.fonts.delete(activeUploadedFontFace); } catch (e) { /* ignore */ }
    }
    activeUploadedFontFace = null;
  }

  // Registers the uploaded global font straight from its bytes. The browser
  // reads the real file signature instead of trusting a CSS format() hint, and
  // nothing is fetched through a data: URL, so this works where the plain
  // @font-face rule quietly failed.
  function registerUploadedGlobalFont(fileData) {
    if (typeof FontFace === "undefined" || !document.fonts || !document.fonts.add) return false;
    const signature = `${fileData.fileName || ""}|${String(fileData.dataUrl).length}`;
    if (activeUploadedFontFace && activeUploadedFontFace.tmTweaksSignature === signature) return true;
    unregisterUploadedFontFace();
    const buffer = dataUrlToArrayBuffer(fileData.dataUrl);
    if (!buffer) return false;
    let face;
    try {
      face = new FontFace(UPLOADED_FONT_FAMILY, buffer, { display: "swap" });
    } catch (e) {
      console.error(`${consolePrefix} Could not create a font face for the uploaded global font.`, e);
      return false;
    }
    face.tmTweaksSignature = signature;
    activeUploadedFontFace = face;
    face.load().then((loadedFace) => {
      document.fonts.add(loadedFace);
    }).catch((error) => {
      console.error(`${consolePrefix} The uploaded global font could not be parsed:`, error);
      if (activeUploadedFontFace === face) activeUploadedFontFace = null;
      // Last resort: hand the file to the CSS engine instead.
      syncUploadedFontFace(fileData, "tweak-uploaded-font-face", UPLOADED_FONT_FAMILY);
      showFeedback("That font file could not be read. Try the .woff2 or .ttf version of it.", 4000);
    });
    return true;
  }

  // Single entry point for the uploaded global font: register the bytes when we
  // can, and keep the CSS rule around only when the FontFace API is unavailable.
  function syncUploadedGlobalFont(fileData) {
    if (!fileData || !fileData.dataUrl) {
      unregisterUploadedFontFace();
      syncUploadedFontFace(null, "tweak-uploaded-font-face", UPLOADED_FONT_FAMILY);
      return false;
    }
    const registered = registerUploadedGlobalFont(fileData);
    syncUploadedFontFace(registered ? null : fileData, "tweak-uploaded-font-face", UPLOADED_FONT_FAMILY);
    return true;
  }

  // Injects @font-face rules (one per weight/style) for the active uploaded chat family.
  function syncUploadedChatFontFaces(files) {
    const styleId = "tweak-uploaded-chat-font-face";
    let styleEl = document.getElementById(styleId);
    const usable = (files || []).filter((f) => f && f.dataUrl);
    if (!usable.length) {
      if (styleEl) styleEl.remove();
      return false;
    }
    const css = usable.map((f) => {
      const formatPart = f.format ? ` format('${f.format}')` : "";
      return `@font-face { font-family: '${chatFontFamilyCssName(f.family)}'; src: url('${f.dataUrl}')${formatPart}; font-weight: ${f.weight || 400}; font-style: ${f.italic ? "italic" : "normal"}; font-display: swap; }`;
    }).join("\n");
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }
    if (styleEl.textContent !== css) styleEl.textContent = css;
    return true;
  }

  // Backs the inline body style with a real stylesheet rule, so parts of the app
  // that carry their own sans-serif class still pick up the chosen font. No
  // !important on purpose: the chat font settings must stay on top.
  function setGlobalUiFontStack(stack) {
    const styleId = "tweak-global-ui-font-style";
    let styleEl = document.getElementById(styleId);
    if (!stack) {
      if (styleEl) styleEl.remove();
      return;
    }
    const css = `html, body, .font-sans { font-family: ${stack}; }`;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }
    if (styleEl.textContent !== css) styleEl.textContent = css;
  }

  // UI weight: puts the whole TypingMind interface (menus, sidebar, buttons,
  // titles, settings, the message box) in one weight. The conversation is left
  // out and keeps the chat text weight, so bold words in chat stay bold.
  // Only TypingMind's own app and its pop-ups are touched; panels from other
  // extensions, and this menu, keep their own look.
  function setUiWeightStyle(uiWeight, chatWeight) {
    const styleId = "tweak-ui-weight-style";
    let styleEl = document.getElementById(styleId);
    const weight = parseInt(uiWeight, 10);
    if (!(weight >= 1 && weight <= 1000)) {
      if (styleEl) styleEl.remove();
      return;
    }
    const chat = parseInt(chatWeight, 10) || parseInt(DEFAULT_FONT_WEIGHT, 10);
    const chatText = CHAT_TEXT_ROOTS.concat(CHAT_TEXT_ROOTS.map((selector) => `${selector} *`)).join(", ");
    const css = `
      :is(${UI_WEIGHT_SCOPES.join(", ")}) :not(${chatText}) { font-weight: ${weight} !important; }
      ${CHAT_TEXT_ROOTS.join(", ")} { font-weight: ${chat} !important; }`;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }
    if (styleEl.textContent !== css) styleEl.textContent = css;
  }

  function applyGlobalUiFont() {
    const fontSetting = getSetting(settingsKeys.globalUiFont, null);
    const targetElement = document.body;
    if (!targetElement) return;

    const isFileFont = !!(fontSetting && fontSetting.isFile);
    const fileData = isFileFont ? getSetting(settingsKeys.globalFontFile, null) : null;
    const fileFaceReady = syncUploadedGlobalFont(isFileFont ? fileData : null);

    if (!fontSetting || (!fontSetting.name && !fontSetting.isUrl)) {
      targetElement.style.fontFamily = '';
      targetElement.style.fontWeight = '';
      setGlobalUiFontStack(null);
      setUiWeightStyle(null);
      removeActiveGlobalUIFontLink();
      return;
    }
    if (isFileFont) {
      removeActiveGlobalUIFontLink();
      if (!fileFaceReady) {
        // The stored font file is missing; fall back to the default UI font.
        targetElement.style.fontFamily = '';
        targetElement.style.fontWeight = '';
        setGlobalUiFontStack(null);
        setUiWeightStyle(null);
        return;
      }
    } else if (fontSetting.isGoogle && fontSetting.name) {
      loadGlobalGoogleFont(fontSetting.name, fontSetting.axes);
    } else if (fontSetting.isUrl && fontSetting.url) {
      loadGlobalUrlFont(fontSetting.url);
    } else {
      removeActiveGlobalUIFontLink();
    }
    const safeName = fontSetting.name && String(fontSetting.name).trim() !== "" ? `"${fontSetting.name}"` : null;
    const stack = safeName ? `${safeName}, ${UI_FONT_FALLBACK_STACK}` : UI_FONT_FALLBACK_STACK;
    targetElement.style.fontFamily = stack;
    targetElement.style.fontWeight = fontSetting.weight || DEFAULT_FONT_WEIGHT;
    setGlobalUiFontStack(safeName ? stack : null);
    setUiWeightStyle(fontSetting.uiWeight, fontSetting.weight || DEFAULT_FONT_WEIGHT);
  }

  // ---------------------------------------------------------------
  // Google Fonts catalog: every family plus the weights it really has
  // ---------------------------------------------------------------
  let googleFontCatalog = null;
  let googleFontCatalogRequest = null;
  let googleFontCatalogFailed = false;

  function weightMaskToList(mask) {
    return ALL_FONT_WEIGHTS.filter((weight, index) => mask & (1 << index));
  }

  function weightListToMask(weights) {
    let mask = 0;
    (weights || []).forEach((value) => {
      const weight = Number(value);
      if (weight >= 100 && weight <= 900 && weight % 100 === 0) mask |= 1 << (weight / 100 - 1);
    });
    return mask;
  }

  function fontSearchKey(text) {
    return String(text || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function decodeFontCatalog(text) {
    const fonts = [];
    String(text || "").split("\n").forEach((line) => {
      const [family, category, normal, italic] = line.split("|");
      if (!family) return;
      const entry = { family, category: category || "o", normal: parseInt(normal, 36) || 0, italic: parseInt(italic, 36) || 0 };
      if (entry.normal || entry.italic) fonts.push(entry);
    });
    return fonts;
  }

  function encodeFontCatalog(fonts) {
    return fonts.map((f) => `${f.family}|${f.category}|${f.normal.toString(36)}|${f.italic.toString(36)}`).join("\n");
  }

  const POPULAR_GOOGLE_FONTS = decodeFontCatalog(POPULAR_GOOGLE_FONTS_DATA);
  const POPULAR_FONT_RANK = new Map(POPULAR_GOOGLE_FONTS.map((font, index) => [font.family.toLowerCase(), index]));

  function buildFontCatalog(fonts, source, fetchedAt) {
    const byName = new Map();
    const list = [];
    fonts.forEach((font) => {
      const lower = font.family.toLowerCase();
      if (byName.has(lower)) return;
      const entry = {
        family: font.family,
        category: font.category,
        normal: font.normal,
        italic: font.italic,
        lower,
        key: fontSearchKey(font.family),
        rank: POPULAR_FONT_RANK.has(lower) ? POPULAR_FONT_RANK.get(lower) : Infinity,
      };
      byName.set(lower, entry);
      list.push(entry);
    });
    list.sort((a, b) => a.lower.localeCompare(b.lower));
    return { fonts: list, byName, source, fetchedAt };
  }

  // Reads both the Fontsource list (weights + styles) and Google's own format
  // (variants such as "regular", "700" and "700italic").
  function parseFontCatalogResponse(json) {
    const items = Array.isArray(json) ? json : (json && Array.isArray(json.items) ? json.items : []);
    const fonts = [];
    items.forEach((item) => {
      if (!item || typeof item.family !== "string") return;
      const family = item.family.trim();
      if (!family || /[|\n]/.test(family)) return;
      if (item.category === "icons" || (item.type && item.type !== "google")) return;
      let normal = 0;
      let italic = 0;
      if (Array.isArray(item.variants)) {
        item.variants.forEach((variant) => {
          const text = String(variant);
          const weight = (text === "regular" || text === "italic") ? 400 : parseInt(text, 10);
          const bit = weightListToMask([weight]);
          if (text.endsWith("italic")) italic |= bit; else normal |= bit;
        });
      } else if (Array.isArray(item.weights)) {
        const mask = weightListToMask(item.weights);
        const styles = Array.isArray(item.styles) && item.styles.length ? item.styles : ["normal"];
        if (styles.includes("normal")) normal = mask;
        if (styles.includes("italic")) italic = mask;
      }
      if (!normal && !italic) return;
      fonts.push({ family, category: FONT_CATEGORY_CODES[item.category] || "o", normal, italic });
    });
    return fonts;
  }

  function readFontCatalogCache() {
    try {
      const raw = localStorage.getItem(GOOGLE_FONT_CATALOG_CACHE_KEY);
      if (!raw) return null;
      const cached = JSON.parse(raw);
      if (!cached || cached.v !== 1 || typeof cached.d !== "string") return null;
      const fonts = decodeFontCatalog(cached.d);
      return fonts.length >= 500 ? { fonts, source: cached.s || "cache", fetchedAt: Number(cached.t) || 0 } : null;
    } catch (e) {
      return null;
    }
  }

  function writeFontCatalogCache(fonts, source, fetchedAt) {
    try {
      localStorage.setItem(GOOGLE_FONT_CATALOG_CACHE_KEY, JSON.stringify({ v: 1, t: fetchedAt, s: source, d: encodeFontCatalog(fonts) }));
    } catch (e) {
      // Browser storage is full (uploaded fonts live there too). The list still works for this visit.
      console.warn(`${consolePrefix} Could not save the Google Fonts list for next time.`, e);
    }
  }

  // The list to use right now: the saved full list, or the built-in popular fonts.
  function getGoogleFontCatalog() {
    if (!googleFontCatalog) {
      const cached = readFontCatalogCache();
      googleFontCatalog = cached
        ? buildFontCatalog(cached.fonts.concat(POPULAR_GOOGLE_FONTS), cached.source, cached.fetchedAt)
        : buildFontCatalog(POPULAR_GOOGLE_FONTS, "builtin", 0);
    }
    return googleFontCatalog;
  }

  function findGoogleFont(name) {
    const lower = String(name || "").trim().toLowerCase();
    return lower ? (getGoogleFontCatalog().byName.get(lower) || null) : null;
  }

  async function downloadFontCatalog() {
    for (const source of GOOGLE_FONT_CATALOG_SOURCES) {
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), GOOGLE_FONT_CATALOG_TIMEOUT_MS) : null;
      try {
        const response = await fetch(source.url, { credentials: "omit", signal: controller ? controller.signal : undefined });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const fonts = parseFontCatalogResponse(await response.json());
        if (fonts.length >= 500) return { fonts, source: source.name };
        throw new Error(`only ${fonts.length} fonts in the response`);
      } catch (error) {
        console.warn(`${consolePrefix} Could not load the Google Fonts list from ${source.name}.`, error);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    return null;
  }

  // Downloads the full list when there's no saved copy yet or the copy is
  // over a week old. Always resolves with the catalog to use.
  function refreshGoogleFontCatalog() {
    const current = getGoogleFontCatalog();
    if (current.source !== "builtin" && Date.now() - current.fetchedAt < GOOGLE_FONT_CATALOG_MAX_AGE_MS) {
      return Promise.resolve(current);
    }
    if (!googleFontCatalogRequest) {
      googleFontCatalogFailed = false;
      googleFontCatalogRequest = downloadFontCatalog().then((result) => {
        googleFontCatalogRequest = null;
        if (!result) {
          googleFontCatalogFailed = true;
          return getGoogleFontCatalog();
        }
        const fetchedAt = Date.now();
        googleFontCatalog = buildFontCatalog(result.fonts.concat(POPULAR_GOOGLE_FONTS), result.source, fetchedAt);
        writeFontCatalogCache(result.fonts, result.source, fetchedAt);
        return googleFontCatalog;
      });
    }
    return googleFontCatalogRequest;
  }

  // The css2 "ital,wght@..." part of a request. Google leaves out any style a
  // family doesn't have, so a family missing from the list asks for them all.
  function buildGoogleFontAxisSpec(entry) {
    const normal = entry ? entry.normal : 0x1ff;
    const italic = entry ? entry.italic : 0x1ff;
    const tuples = weightMaskToList(normal).map((weight) => `0,${weight}`)
      .concat(weightMaskToList(italic).map((weight) => `1,${weight}`));
    return tuples.length ? `ital,wght@${tuples.join(";")}` : "";
  }

  function availableFontWeights(entry) {
    const list = entry ? weightMaskToList(entry.normal || entry.italic) : [];
    return list.length ? list : ALL_FONT_WEIGHTS.slice();
  }

  function fontWeightLabel(weight) {
    return `${FONT_WEIGHT_NAMES[weight] || "Weight"} (${weight})`;
  }

  // Ranks matches: exact name, then names starting with the text, then any
  // word starting with it, then names containing it. Popular fonts go first
  // within each group.
  function searchGoogleFonts(query) {
    const catalog = getGoogleFontCatalog();
    const text = String(query || "").trim().toLowerCase();
    const key = fontSearchKey(text);
    if (!key) {
      const popular = catalog.fonts.filter((font) => font.rank !== Infinity).sort((a, b) => a.rank - b.rank);
      return { results: popular, total: popular.length, isPopular: true };
    }
    const matches = [];
    catalog.fonts.forEach((font) => {
      let score;
      if (font.key === key) score = 0;
      else if (font.lower.startsWith(text) || font.key.startsWith(key)) score = 1;
      else if (font.lower.split(" ").some((word) => word.startsWith(text))) score = 2;
      else if (font.key.includes(key)) score = 3;
      else return;
      matches.push({ font, score });
    });
    matches.sort((a, b) =>
      (a.score - b.score) ||
      (a.font.rank === b.font.rank ? 0 : (a.font.rank < b.font.rank ? -1 : 1)) ||
      (a.font.family.length - b.font.family.length) ||
      a.font.lower.localeCompare(b.font.lower)
    );
    return { results: matches.map((match) => match.font), total: matches.length, isPopular: false };
  }

  // ---------------------------------------------------------------
  // Menu bar font size
  // ---------------------------------------------------------------
  function applySidebarFontSize() {
    const styleId = "tweak-sidebar-font-size-style";
    let styleElement = document.getElementById(styleId);
    if (!styleElement) {
      styleElement = document.createElement("style");
      styleElement.id = styleId;
      document.head.appendChild(styleElement);
    }
    const rawValue = getSetting(settingsKeys.sidebarFontSize, null);
    const parsed = parseInt(rawValue, 10);
    const sidebarSize = (rawValue === null || typeof rawValue === "undefined" || String(rawValue).trim() === "" || isNaN(parsed))
      ? null
      : Math.min(40, Math.max(8, parsed));
    let newContent = "";

    if (sidebarSize) {
      const selectors = [];
      SIDEBAR_TEXT_SELECTORS.forEach((base) => {
        selectors.push(base);
        SIDEBAR_TEXT_TAGS.forEach((tag) => selectors.push(`${base} ${tag}`));
      });
      newContent = `
      ${selectors.join(",\n      ")} {
        font-size: ${sidebarSize}px !important;
        line-height: 1.35 !important;
      }`;
    }
    if (styleElement.textContent !== newContent) {
      styleElement.textContent = newContent;
    }
  }

  // ---------------------------------------------------------------
  // Chat bubble colors
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
    const newContent = rules.join("\n");
    if (styleElement.textContent !== newContent) {
      styleElement.textContent = newContent;
    }
  }

  function updateChatColorPreview() {
    const bubbleEl = document.getElementById("tweak-preview-bubble");
    if (!bubbleEl) return;
    const val = (key, fallback) => {
      const v = cleanValue(getSetting(key, null));
      return isValidCssColor(v) ? v : fallback;
    };
    bubbleEl.style.backgroundColor = val(settingsKeys.userBubbleBgColor, CHAT_COLOR_DEFAULTS.bubbleBg);
    bubbleEl.style.color = val(settingsKeys.userBubbleTextColor, CHAT_COLOR_DEFAULTS.bubbleText);
  }

  function loadChatColorInputs() {
    const mapping = [
      ["tweak_userBubbleBg_input", settingsKeys.userBubbleBgColor, CHAT_COLOR_DEFAULTS.bubbleBg],
      ["tweak_userBubbleText_input", settingsKeys.userBubbleTextColor, CHAT_COLOR_DEFAULTS.bubbleText],
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
    }
    loadChatColorInputs();
    updateChatColorPreview();
    showFeedback(theme.reset ? "Bubble colors reset to default." : `"${theme.name}" colors applied.`);
  }

  // ---------------------------------------------------------------
  // Visibility / color tweaks
  // ---------------------------------------------------------------

  // Finds the homepage logo block: the logo, the "TypingMind" wordmark and the
  // tagline under it. TypingMind now shows its logo in several places, and the
  // first one on the page is the menu bar button that opens the sidebar, so
  // every logo is checked instead of only the first one.
  function findHomepageLogoBlocks() {
    const controls = 'a[href], button, input, textarea, select, [role="button"]';
    const blocks = [];
    document.querySelectorAll('img[alt="TypingMind"]').forEach((img) => {
      // Leave the menu bar and the sidebar alone.
      if (img.closest('[data-element-id="workspace-bar"], [data-element-id^="side-bar"], [data-element-id^="sidebar"]')) return;
      const row = img.parentElement;
      const block = row && row.parentElement;
      if (!block || block === document.body || block === document.documentElement) return;
      // The homepage logo sits right next to the "TypingMind" wordmark.
      if (!(row.textContent || "").replace(/\s+/g, "").includes("TypingMind")) return;
      // Only hide a block that is just the logo and its text: no buttons,
      // no links, no inputs and no other images.
      if (block.closest(controls) || block.querySelector(controls)) return;
      if (block.querySelectorAll("img").length > 1) return;
      if (!blocks.includes(block)) blocks.push(block);
    });
    return blocks;
  }

  // Hides the homepage logo block while the setting is on, and shows again
  // anything this script hid once the setting is off.
  function applyHomepageLogoVisibility(hide) {
    const targets = hide ? findHomepageLogoBlocks() : [];
    document.querySelectorAll(`[${HIDDEN_LOGO_ATTR}]`).forEach((el) => {
      if (targets.includes(el)) return;
      el.style.display = "";
      el.removeAttribute(HIDDEN_LOGO_ATTR);
    });
    targets.forEach((el) => {
      if (el.style.display !== "none") el.style.display = "none";
      if (!el.hasAttribute(HIDDEN_LOGO_ATTR)) el.setAttribute(HIDDEN_LOGO_ATTR, "");
    });
  }

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
    applyHomepageLogoVisibility(!!hideLogo);
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
      nameEl.textContent = `${fileData.fileName || "Uploaded font"}${inUse ? " (in use)" : " (stored, not in use)"}`;
      statusRow.style.display = "flex";
    } else {
      nameEl.textContent = "";
      statusRow.style.display = "none";
    }
  }

  function renderChatFontFileList() {
    const listEl = document.getElementById("tweak_chatFontFile_list");
    if (!listEl) return;
    const store = getChatFontStore();
    listEl.innerHTML = "";
    if (!store.files.length) {
      listEl.style.display = "none";
      return;
    }
    listEl.style.display = "flex";
    const families = [];
    store.files.forEach((f) => { if (!families.includes(f.family)) families.push(f.family); });
    families.forEach((family) => {
      const familyFiles = store.files
        .filter((f) => f.family === family)
        .sort((a, b) => ((a.weight || 400) - (b.weight || 400)) || ((a.italic ? 1 : 0) - (b.italic ? 1 : 0)));
      const isActive = store.activeFamily === family;
      const item = document.createElement("div");
      item.className = "tweak-font-family-item" + (isActive ? " tweak-font-family-item--active" : "");
      const info = document.createElement("div");
      info.className = "tweak-font-family-info";
      const nameEl = document.createElement("div");
      nameEl.className = "tweak-font-family-name";
      nameEl.textContent = family + (isActive ? " (in use)" : "");
      const stylesEl = document.createElement("div");
      stylesEl.className = "tweak-font-family-styles";
      stylesEl.textContent = familyFiles.map(fontVariantLabel).join(", ");
      info.append(nameEl, stylesEl);

      const useButton = document.createElement("button");
      useButton.type = "button";
      useButton.className = "tweak-reset-button tweak-font-use-button" + (isActive ? " tweak-font-use-button--active" : "");
      useButton.textContent = isActive ? "Stop" : "Use";
      useButton.title = isActive ? `Stop using "${family}" (your link/local font takes over)` : `Use "${family}" for the chat`;
      useButton.addEventListener("click", () => {
        const s = getChatFontStore();
        const activating = s.activeFamily !== family;
        s.activeFamily = activating ? family : null;
        saveSetting(settingsKeys.chatFontFile, s);
        showFeedback(activating ? `"${family}" is now the chat font.` : `"${family}" turned off.`);
      });

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "tweak-reset-button";
      removeButton.textContent = "Remove";
      removeButton.title = `Delete "${family}" from this browser`;
      removeButton.addEventListener("click", () => {
        const s = getChatFontStore();
        s.files = s.files.filter((f) => f.family !== family);
        if (s.activeFamily === family) s.activeFamily = null;
        saveSetting(settingsKeys.chatFontFile, s.files.length ? s : null);
        showFeedback(`"${family}" removed.`);
      });

      item.append(info, useButton, removeButton);
      listEl.appendChild(item);
    });
  }

  // ---------------------------------------------------------------
  // Global UI font picker: Google Font search, weights and preview
  // ---------------------------------------------------------------
  let selectedGoogleFont = null; // picked in the menu; saved only when "Apply" is tapped
  let preferredUiWeight = ""; // "" = Default (TypingMind's mixed weights)
  let fontResultItems = [];
  let fontResultActiveIndex = -1;
  let previewFontSheet = null;
  let previewUrlTimer = null;

  function pickerEl(name) {
    return document.getElementById(`${SCRIPT_PREFIX}${name}`);
  }

  function isTweaksModalOpen() {
    return !!modalOverlay && window.getComputedStyle(modalOverlay).display !== "none";
  }

  function isFontResultsOpen() {
    const list = pickerEl("google-font-results");
    return !!(list && list.classList.contains("is-open"));
  }

  function describeFontEntry(entry) {
    const count = availableFontWeights(entry).length;
    const parts = [FONT_CATEGORY_LABELS[entry.category] || FONT_CATEGORY_LABELS.o, count === 1 ? "1 weight" : `${count} weights`];
    if (entry.italic) parts.push("italic");
    return parts.join(" \u00B7 ");
  }

  function renderFontResults(keepScroll) {
    const list = pickerEl("google-font-results");
    const input = pickerEl("google-font-search");
    if (!list || !input) return;
    const previousScroll = list.scrollTop;
    const typed = input.value.trim();
    // While the box only shows the chosen font, list the popular picks instead.
    const query = (selectedGoogleFont && typed.toLowerCase() === selectedGoogleFont.toLowerCase()) ? "" : typed;
    const catalog = getGoogleFontCatalog();
    const { results, total, isPopular } = searchGoogleFonts(query);
    const shown = isPopular ? results : results.slice(0, GOOGLE_FONT_RESULTS_LIMIT);
    const fragment = document.createDocumentFragment();
    const addNote = (text) => {
      const note = document.createElement("div");
      note.className = "tweak-font-results-note";
      note.textContent = text;
      fragment.appendChild(note);
    };
    if (isPopular) {
      addNote(catalog.source === "builtin"
        ? "Popular fonts"
        : `Popular fonts. Type to search all ${catalog.fonts.length.toLocaleString()}.`);
    }
    const selectedLower = selectedGoogleFont ? selectedGoogleFont.toLowerCase() : null;
    shown.forEach((entry, index) => {
      const isSelected = entry.lower === selectedLower;
      const row = document.createElement("div");
      row.className = "tweak-font-result" + (isSelected ? " is-selected" : "");
      row.id = `${SCRIPT_PREFIX}google-font-option-${index}`;
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", isSelected ? "true" : "false");
      row.tabIndex = -1;
      const name = document.createElement("span");
      name.className = "tweak-font-result-name";
      name.textContent = entry.family;
      const meta = document.createElement("span");
      meta.className = "tweak-font-result-meta";
      meta.textContent = describeFontEntry(entry);
      row.append(name, meta);
      row.addEventListener("click", () => chooseGoogleFont(entry.family, true));
      fragment.appendChild(row);
    });
    if (!shown.length) {
      addNote(catalog.source === "builtin"
        ? `"${typed}" isn't in the popular list. Check the spelling, then press Enter or Apply to use it anyway.`
        : `No Google Font matches "${typed}".`);
    } else if (total > shown.length) {
      addNote(`Showing ${shown.length} of ${total.toLocaleString()} matches. Keep typing to narrow it down.`);
    }
    list.innerHTML = "";
    list.appendChild(fragment);
    list.scrollTop = keepScroll ? previousScroll : 0;
    fontResultItems = shown;
    setActiveFontResult(query && shown.length ? 0 : -1, false);
  }

  function setActiveFontResult(index, scrollToIt) {
    const list = pickerEl("google-font-results");
    const input = pickerEl("google-font-search");
    if (!list || !input) return;
    fontResultActiveIndex = index;
    list.querySelectorAll(".tweak-font-result").forEach((row, i) => row.classList.toggle("is-active", i === index));
    const row = index >= 0 ? document.getElementById(`${SCRIPT_PREFIX}google-font-option-${index}`) : null;
    if (!row) {
      input.removeAttribute("aria-activedescendant");
      return;
    }
    input.setAttribute("aria-activedescendant", row.id);
    if (scrollToIt) {
      // Scroll only the list, never the menu around it.
      const top = row.offsetTop;
      const bottom = top + row.offsetHeight;
      if (top < list.scrollTop) list.scrollTop = top;
      else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
    }
  }

  function openFontResults() {
    const list = pickerEl("google-font-results");
    const input = pickerEl("google-font-search");
    if (!list || !input) return;
    renderFontResults();
    list.classList.add("is-open");
    input.setAttribute("aria-expanded", "true");
    keepFontResultsInView();
  }

  function closeFontResults() {
    const list = pickerEl("google-font-results");
    const input = pickerEl("google-font-search");
    if (list) list.classList.remove("is-open");
    if (input) {
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
    }
    fontResultActiveIndex = -1;
  }

  // Scrolls the menu so the open list isn't cut off at the bottom or hidden
  // behind the phone keyboard, while keeping the search box in view.
  function keepFontResultsInView() {
    const list = pickerEl("google-font-results");
    const input = pickerEl("google-font-search");
    const scroller = document.getElementById("tweak-modal-scrollable-content");
    if (!list || !input || !scroller || !list.classList.contains("is-open")) return;
    const scrollerRect = scroller.getBoundingClientRect();
    const viewport = window.visualViewport;
    const visibleBottom = Math.min(scrollerRect.bottom, viewport ? viewport.offsetTop + viewport.height : window.innerHeight);
    const overflow = list.getBoundingClientRect().bottom - visibleBottom + 8;
    if (overflow <= 0) return;
    const room = input.getBoundingClientRect().top - scrollerRect.top - 8;
    const delta = Math.min(overflow, Math.max(0, room));
    if (delta > 0) scroller.scrollTop += delta;
  }

  // Selects a Google Font in the menu (or clears it with null).
  function chooseGoogleFont(name, fromUser) {
    const input = pickerEl("google-font-search");
    const entry = name ? findGoogleFont(name) : null;
    selectedGoogleFont = name ? (entry ? entry.family : String(name).trim()) : null;
    if (input) input.value = selectedGoogleFont || "";
    closeFontResults();
    if (fromUser && selectedGoogleFont) {
      // A Google Font replaces the other sources, same as before.
      ["local-font-input", "global-font-url", "global-font-family"].forEach((id) => {
        const field = pickerEl(id);
        if (field) field.value = "";
      });
    }
    refreshUiWeightOptions();
    updateGoogleFontClearButton();
    updateGlobalFontPreview();
  }

  // Settles whatever is typed in the search box: an exact font name selects
  // it and an empty box clears the selection. Anything else puts the current
  // selection back, unless only the popular list is available and the typed
  // name is being confirmed (Enter or Apply).
  function commitTypedGoogleFont(confirming) {
    const input = pickerEl("google-font-search");
    if (!input) return;
    const typed = input.value.trim();
    if (!typed) {
      if (selectedGoogleFont) chooseGoogleFont(null, false);
      return;
    }
    if (selectedGoogleFont && typed.toLowerCase() === selectedGoogleFont.toLowerCase()) {
      input.value = selectedGoogleFont;
      return;
    }
    const match = findGoogleFont(typed);
    if (match) {
      chooseGoogleFont(match.family, true);
    } else if (confirming && getGoogleFontCatalog().source === "builtin") {
      chooseGoogleFont(typed, true);
    } else {
      input.value = selectedGoogleFont || "";
      updateGoogleFontClearButton();
    }
  }

  // The UI weight list: "Default" plus only the weights the chosen Google Font
  // has (every weight for other sources). Keeps the user's pick when the font
  // has it, otherwise the closest weight it does have.
  function refreshUiWeightOptions() {
    const select = pickerEl("ui-weight-select");
    if (!select) return;
    const entry = selectedGoogleFont ? findGoogleFont(selectedGoogleFont) : null;
    const weights = availableFontWeights(entry);
    const signature = weights.join(",");
    if (select.dataset.weights !== signature) {
      select.innerHTML = "";
      const defaultOption = document.createElement("option");
      defaultOption.value = "";
      defaultOption.textContent = "Default (TypingMind's mixed weights)";
      select.appendChild(defaultOption);
      weights.forEach((weight) => {
        const option = document.createElement("option");
        option.value = String(weight);
        option.textContent = fontWeightLabel(weight);
        select.appendChild(option);
      });
      select.dataset.weights = signature;
    }
    const wanted = Number(preferredUiWeight);
    if (!wanted) {
      select.value = "";
    } else {
      const closest = weights.reduce((best, weight) => (Math.abs(weight - wanted) < Math.abs(best - wanted) ? weight : best), weights[0]);
      select.value = String(weights.includes(wanted) ? wanted : closest);
    }
    updateUiWeightInfo(entry);
  }

  function updateUiWeightInfo(entry) {
    const info = pickerEl("ui-weight-info");
    if (!info) return;
    if (selectedGoogleFont && entry) {
      const weights = availableFontWeights(entry);
      const range = weights.length === 1
        ? `only ${fontWeightLabel(weights[0])}`
        : `${weights.length} weights, from ${fontWeightLabel(weights[0])} to ${fontWeightLabel(weights[weights.length - 1])}`;
      info.textContent = `${entry.family} has ${range}.`;
    } else if (selectedGoogleFont) {
      info.textContent = `${selectedGoogleFont} isn't in the font list, so every weight is shown. If it lacks one, the closest weight it has is used.`;
    } else {
      info.textContent = "For local, web URL and uploaded fonts every weight is listed. If the font doesn't include the one you pick, the closest weight it has is used.";
    }
  }

  function updateGoogleFontClearButton() {
    const input = pickerEl("google-font-search");
    const clear = pickerEl("google-font-clear");
    if (input && clear) clear.style.display = input.value ? "flex" : "none";
  }

  function updateGoogleFontStatus() {
    const status = pickerEl("google-font-status");
    const input = pickerEl("google-font-search");
    const catalog = getGoogleFontCatalog();
    const count = catalog.fonts.length.toLocaleString();
    if (input) input.placeholder = catalog.source === "builtin" ? "Search Google Fonts" : `Search ${count} Google Fonts`;
    if (!status) return;
    if (catalog.source !== "builtin") {
      status.textContent = `All ${count} Google Fonts. Search by name, then pick one from the list.`;
    } else if (googleFontCatalogRequest) {
      status.textContent = "Loading the full Google Fonts list\u2026";
    } else if (googleFontCatalogFailed) {
      status.textContent = `Couldn't load the full list right now, so ${count} popular fonts are shown. It tries again next time you open this menu.`;
    } else {
      status.textContent = `${count} popular fonts.`;
    }
  }

  function setPreviewFontStylesheet(urls) {
    const list = (urls || []).filter(Boolean);
    if (previewFontSheet && list.length && !previewFontSheet.failed && previewFontSheet.requested === list[0]) return;
    detachStylesheet(previewFontSheet);
    previewFontSheet = list.length ? attachStylesheetWithFallback(list) : null;
  }

  // Shows the sample text in whatever the form currently points at, at the
  // UI weight (or the chat text weight while UI weight is on Default, since
  // that's what the interface's regular text uses then), before anything is applied.
  function updateGlobalFontPreview() {
    const textEl = pickerEl("font-preview-text");
    const metaEl = pickerEl("font-preview-meta");
    if (!textEl || !metaEl) return;
    const fieldValue = (id) => ((pickerEl(id) || {}).value || "").trim();
    const uiWeight = fieldValue("ui-weight-select");
    const weight = uiWeight || fieldValue("font-weight-select") || DEFAULT_FONT_WEIGHT;
    const localName = fieldValue("local-font-input");
    const url = fieldValue("global-font-url");
    const urlFamily = fieldValue("global-font-family");
    if (previewUrlTimer) {
      clearTimeout(previewUrlTimer);
      previewUrlTimer = null;
    }
    let family = null;
    let source = "";
    if (selectedGoogleFont) {
      const spec = buildGoogleFontAxisSpec(findGoogleFont(selectedGoogleFont));
      setPreviewFontStylesheet([googleFontCssUrl(selectedGoogleFont, spec), googleFontCssUrl(selectedGoogleFont, "")]);
      family = selectedGoogleFont;
      source = "Google Fonts";
    } else if (urlFamily && /^https?:\/\//i.test(url)) {
      // Wait until typing pauses, so half-typed URLs aren't requested.
      previewUrlTimer = setTimeout(() => {
        previewUrlTimer = null;
        setPreviewFontStylesheet([url]);
      }, PREVIEW_URL_DELAY_MS);
      family = urlFamily;
      source = "web font URL";
    } else if (localName) {
      setPreviewFontStylesheet(null);
      family = localName;
      source = "installed on this device";
    } else {
      setPreviewFontStylesheet(null);
      const applied = getSetting(settingsKeys.globalUiFont, null);
      if (applied && applied.isFile) {
        family = UPLOADED_FONT_FAMILY;
        source = "uploaded file";
      } else if (applied && applied.name) {
        family = String(applied.name);
        source = "currently applied";
      }
    }
    textEl.style.fontFamily = family ? `"${family.replace(/["\\]/g, "")}", ${UI_FONT_FALLBACK_STACK}` : "";
    textEl.style.fontWeight = weight;
    const shownName = family === UPLOADED_FONT_FAMILY ? "Uploaded font" : family;
    const weightText = uiWeight ? `UI weight ${fontWeightLabel(Number(weight))}` : "default weights";
    metaEl.textContent = family
      ? `${shownName} (${source}), ${weightText}`
      : `TypingMind default font, ${weightText}`;
  }

  function createSettingsModal() {
    if (document.getElementById("tweak-modal-overlay")) return;

    const styles = `
      #tweak-modal-overlay {
        position: fixed; inset: 0;
        background-color: rgba(0, 0, 0, 0.72);
        display: none; justify-content: center; align-items: center;
        z-index: 10001; padding: 16px; box-sizing: border-box;
        padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
      }
      #tweak-modal-overlay *, #tweak-modal-overlay *::before, #tweak-modal-overlay *::after { box-sizing: border-box; }
      #tweak-modal {
        position: relative;
        background-color: #232426; color: #f0f0f0;
        width: 100%; max-width: 560px;
        max-height: 90vh; max-height: 90dvh;
        display: flex; flex-direction: column;
        padding: 22px 26px 18px;
        border-radius: 14px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.65);
        border: 1px solid #45464a;
      }
      #tweak-modal h2 { margin: 0 0 6px; padding: 0 36px; color: #ffffff; font-size: 1.3em; font-weight: 600; text-align: center; }
      #tweak-modal-x {
        position: absolute; top: 14px; right: 14px;
        width: 34px; height: 34px; padding: 0; border: none; border-radius: 50%;
        background-color: transparent; color: #a8a8ad;
        font-size: 24px; line-height: 1; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        transition: background-color 0.15s ease, color 0.15s ease;
      }
      #tweak-modal-x:hover { background-color: #36373c; color: #ffffff; }
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
      .tweak-preview-bubble-row:last-child { margin-bottom: 0; }
      .tweak-preview-bubble-row--other { justify-content: flex-start; }
      .tweak-preview-bubble {
        max-width: 85%; padding: 9px 14px; border-radius: 16px 16px 4px 16px;
        font-size: 0.9em; line-height: 1.4; word-break: break-word;
        background-color: ${CHAT_COLOR_DEFAULTS.bubbleBg}; color: ${CHAT_COLOR_DEFAULTS.bubbleText};
        transition: background-color 0.15s ease, color 0.15s ease;
      }
      .tweak-preview-bubble--other {
        background-color: #2c2d31; color: #cfcfd4;
        border-radius: 16px 16px 16px 4px;
      }
      .tweak-theme-row { display: flex; flex-wrap: wrap; gap: 10px 8px; margin: 2px 0 4px; }
      .tweak-theme-item { display: flex; flex-direction: column; align-items: center; gap: 5px; width: 46px; }
      .tweak-theme-item span { font-size: 0.66em; color: #b0b0b5; text-align: center; line-height: 1.1; }
      .tweak-theme-swatch {
        width: 34px; height: 34px; border-radius: 50%; padding: 0; cursor: pointer;
        border: 2px solid rgba(255, 255, 255, 0.22);
        display: flex; align-items: center; justify-content: center;
        font-size: 12px; font-weight: 600; line-height: 1;
        transition: transform 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease;
      }
      .tweak-theme-swatch:hover { transform: scale(1.12); border-color: #ffffff; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.4); }
      .tweak-theme-swatch:active { transform: scale(0.94); }
      .tweak-theme-swatch--default {
        background-color: #3a3b40; color: #d8d8d8; font-size: 15px; font-weight: 400;
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
      .tweak-font-family-list { display: none; flex-direction: column; gap: 8px; margin-top: 8px; }
      .tweak-font-family-item {
        display: flex; align-items: center; gap: 8px;
        background-color: #3a3b40; border: 1px solid #55565c;
        border-radius: 6px; padding: 8px 10px;
        transition: border-color 0.15s ease;
      }
      .tweak-font-family-item--active { border-color: #0d6efd; }
      .tweak-font-family-info { flex: 1 1 auto; min-width: 0; }
      .tweak-font-family-name {
        font-size: 0.88em; font-weight: 600; color: #f0f0f0;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .tweak-font-family-item--active .tweak-font-family-name { color: #8ec2ff; }
      .tweak-font-family-styles { font-size: 0.76em; color: #a8a8a8; margin-top: 2px; }
      .tweak-font-use-button--active { background-color: #0d6efd; border-color: #0d6efd; }
      .tweak-font-use-button--active:hover { background-color: #0b5ed7; }
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

      /* --- Google Font search --- */
      .tweak-font-search-wrap { position: relative; }
      .${SCRIPT_PREFIX}form-group .tweak-font-search-wrap input[type="text"] { padding-right: 42px; }
      .tweak-font-search-clear {
        display: none; align-items: center; justify-content: center;
        position: absolute; top: 50%; right: 5px; transform: translateY(-50%);
        width: 30px; height: 30px; padding: 0; border: none; border-radius: 6px;
        background-color: transparent; color: #a8a8ad; font-size: 20px; line-height: 1; cursor: pointer;
      }
      .tweak-font-search-clear:hover { background-color: #4a4b50; color: #ffffff; }
      .tweak-font-results {
        display: none; position: relative; margin-top: 6px;
        max-height: 264px; overflow-y: auto; overflow-x: hidden;
        overscroll-behavior: contain; -webkit-overflow-scrolling: touch;
        background-color: #2f3034; border: 1px solid #55565c; border-radius: 8px; outline: none;
      }
      .tweak-font-results.is-open { display: block; }
      .tweak-font-results::-webkit-scrollbar { width: 6px; }
      .tweak-font-results::-webkit-scrollbar-thumb { background-color: #5a5b60; border-radius: 3px; }
      .tweak-font-result {
        display: flex; align-items: center; justify-content: space-between; gap: 10px;
        min-height: 42px; padding: 8px 12px; cursor: pointer; outline: none;
        border-bottom: 1px solid #3a3b40; font-size: 0.9em; color: #ececec;
        -webkit-tap-highlight-color: transparent;
      }
      .tweak-font-result:last-child { border-bottom: none; }
      .tweak-font-result.is-active, .tweak-font-result:active { background-color: #3d3e44; }
      @media (hover: hover) { .tweak-font-result:hover { background-color: #3d3e44; } }
      .tweak-font-result-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .tweak-font-result.is-selected .tweak-font-result-name { color: #8ec2ff; font-weight: 600; }
      .tweak-font-result.is-selected .tweak-font-result-name::after { content: " \\2713"; }
      .tweak-font-result-meta { flex-shrink: 0; font-size: 0.78em; color: #9a9aa0; white-space: nowrap; }
      .tweak-font-results-note { padding: 8px 12px; font-size: 0.76em; line-height: 1.4; color: #9a9aa0; border-bottom: 1px solid #3a3b40; }
      .tweak-font-results-note:last-child { border-bottom: none; }

      /* --- Font weight explanation + preview --- */
      .${SCRIPT_PREFIX}form-group small.tweak-weight-explainer { color: #c9c9cd; line-height: 1.45; }
      .tweak-weight-explainer strong { color: #ececec; font-weight: 600; }
      .tweak-font-preview {
        position: relative; margin: 2px 0 16px;
        background-color: #17181b; border: 1px solid #3d3e43; border-radius: 10px;
        padding: 28px 14px 12px;
      }
      .tweak-font-preview-text { font-size: 1.05em; line-height: 1.45; color: #f2f2f2; word-break: break-word; }
      .tweak-font-preview-meta { margin-top: 8px; font-size: 0.74em; color: #8d8e93; }

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
        /* A floating card instead of a near full-screen sheet. In a fullscreen
           PWA, Android can draw its status bar and navigation buttons on top of
           the page, so the card keeps fixed gaps above and below (wider still
           when the browser reports safe-area insets) and the Close button
           always stays clear of the navigation bar. */
        #tweak-modal-overlay {
          --tweak-gap-top: max(44px, calc(env(safe-area-inset-top, 0px) + 16px));
          --tweak-gap-bottom: max(76px, calc(env(safe-area-inset-bottom, 0px) + 24px));
          padding: var(--tweak-gap-top) 12px var(--tweak-gap-bottom);
          align-items: center;
        }
        #tweak-modal {
          padding: 18px 16px 14px;
          max-height: calc(100vh - var(--tweak-gap-top) - var(--tweak-gap-bottom));
          max-height: calc(100dvh - var(--tweak-gap-top) - var(--tweak-gap-bottom));
          border-radius: 14px;
        }
        #tweak-modal-x { top: 10px; right: 10px; }
        .tweak-settings-section { padding: 14px; }
        .tweak-text-item label, .tweak-color-item label, .tweak-favicon-input-group label { width: 100%; }
        .tweak-text-input-wrapper { flex: 1 1 100%; }
        #tweak-modal-bottom-close { width: 100%; padding: 11px; }
      }

      /* Bigger touch screens (tablets, foldables): same nav-bar clearance. */
      @media (pointer: coarse) and (min-width: 481px) {
        #tweak-modal-overlay {
          --tweak-gap-top: max(32px, calc(env(safe-area-inset-top, 0px) + 16px));
          --tweak-gap-bottom: max(64px, calc(env(safe-area-inset-bottom, 0px) + 24px));
          padding-top: var(--tweak-gap-top);
          padding-bottom: var(--tweak-gap-bottom);
        }
        #tweak-modal {
          max-height: calc(100vh - var(--tweak-gap-top) - var(--tweak-gap-bottom));
          max-height: calc(100dvh - var(--tweak-gap-top) - var(--tweak-gap-bottom));
        }
      }
      /* Phones turned sideways: little height to spare, and the 3-button bar
         moves to the side, so keep only a small gap (room for a gesture bar). */
      @media (pointer: coarse) and (min-width: 481px) and (max-height: 500px) {
        #tweak-modal-overlay {
          --tweak-gap-top: 12px;
          --tweak-gap-bottom: max(28px, calc(env(safe-area-inset-bottom, 0px) + 12px));
        }
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

    // --- Chat bubble colors section ---
    const chatColorsSection = document.createElement("div");
    chatColorsSection.className = "tweak-settings-section";
    const chatColorsHeader = document.createElement("h3");
    chatColorsHeader.textContent = "Chat bubble colors";
    chatColorsSection.appendChild(chatColorsHeader);
    const chatColorsNote = document.createElement("p");
    chatColorsNote.className = "tweak-section-note";
    chatColorsNote.textContent = "Style your message bubbles. Tap a theme, or fine-tune each color below.";
    chatColorsSection.appendChild(chatColorsNote);

    const previewEl = document.createElement("div");
    previewEl.className = "tweak-chat-preview";
    previewEl.setAttribute("aria-hidden", "true");
    previewEl.innerHTML = `
      <div class="tweak-preview-caption">Live preview</div>
      <div class="tweak-preview-bubble-row tweak-preview-bubble-row--other"><div class="tweak-preview-bubble tweak-preview-bubble--other">How does this look?</div></div>
      <div class="tweak-preview-bubble-row"><div class="tweak-preview-bubble" id="tweak-preview-bubble">Hey! This is one of my messages \u2728</div></div>
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
        swatch.textContent = "Aa";
        swatch.style.backgroundColor = theme.bubbleBg;
        swatch.style.color = theme.bubbleText;
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

    const bubbleBgPicker = createColorPicker("tweak_userBubbleBg_input", "Bubble background:", settingsKeys.userBubbleBgColor, CHAT_COLOR_DEFAULTS.bubbleBg);
    bubbleBgPicker.style.marginTop = "5px";
    const bubbleTextPicker = createColorPicker("tweak_userBubbleText_input", "Bubble text:", settingsKeys.userBubbleTextColor, CHAT_COLOR_DEFAULTS.bubbleText);
    bubbleTextPicker.style.marginTop = "10px";
    chatColorsSection.append(bubbleBgPicker, bubbleTextPicker);

    // --- Global UI font section ---
    const globalFontSettingsSection = document.createElement("div");
    globalFontSettingsSection.className = "tweak-settings-section";
    globalFontSettingsSection.innerHTML = `
        <h3>Global UI font</h3>
        <p class="tweak-section-note">Changes the font of the entire app. Pick one source below.</p>
        <div class="${SCRIPT_PREFIX}form-group">
            <label for="${SCRIPT_PREFIX}google-font-search">Google Font:</label>
            <div class="tweak-font-picker" id="${SCRIPT_PREFIX}google-font-picker">
                <div class="tweak-font-search-wrap">
                    <input type="text" id="${SCRIPT_PREFIX}google-font-search" placeholder="Search Google Fonts"
                        autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done"
                        role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${SCRIPT_PREFIX}google-font-results">
                    <button type="button" class="tweak-font-search-clear" id="${SCRIPT_PREFIX}google-font-clear" aria-label="Clear Google Font" title="Clear">\u00D7</button>
                </div>
                <div class="tweak-font-results" id="${SCRIPT_PREFIX}google-font-results" role="listbox" aria-label="Google Fonts" tabindex="-1"></div>
            </div>
            <small id="${SCRIPT_PREFIX}google-font-status">Loading the full Google Fonts list\u2026</small>
        </div>
        <div class="${SCRIPT_PREFIX}form-group">
            <label for="${SCRIPT_PREFIX}ui-weight-select">UI weight:</label>
            <select id="${SCRIPT_PREFIX}ui-weight-select">
                <option value="" selected>Default (TypingMind's mixed weights)</option>
                ${ALL_FONT_WEIGHTS.map((weight) => `<option value="${weight}">${fontWeightLabel(weight)}</option>`).join("")}
            </select>
            <small class="tweak-weight-explainer"><strong>What this changes:</strong> one weight for the whole interface: menus, sidebar, buttons, titles, settings and the message box you type in. Replies and sent messages use Chat text weight below. Default keeps TypingMind's usual mix.</small>
            <small id="${SCRIPT_PREFIX}ui-weight-info"></small>
        </div>
        <div class="tweak-font-preview" aria-hidden="true">
            <div class="tweak-preview-caption">Interface preview</div>
            <div class="tweak-font-preview-text" id="${SCRIPT_PREFIX}font-preview-text">The quick brown fox jumps over the lazy dog. 0123456789</div>
            <div class="tweak-font-preview-meta" id="${SCRIPT_PREFIX}font-preview-meta"></div>
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
            <small>.ttf, .otf, .woff or .woff2. Applied instantly and stored only in this browser. Max 4 MB (.woff2 is smallest).</small>
        </div>
        <div class="${SCRIPT_PREFIX}form-group">
            <label for="${SCRIPT_PREFIX}font-weight-select">Chat text weight:</label>
            <select id="${SCRIPT_PREFIX}font-weight-select">
                ${ALL_FONT_WEIGHTS.map((weight) => `<option value="${weight}"${String(weight) === DEFAULT_FONT_WEIGHT ? " selected" : ""}>${fontWeightLabel(weight)}</option>`).join("")}
            </select>
            <small class="tweak-weight-explainer"><strong>What this changes:</strong> how thick chat text is, meaning the replies and your messages once they're sent. Bold words stay bold. If UI weight is on Default, this also sets the rest of the app's regular text, including the message box.</small>
        </div>
        <div class="${SCRIPT_PREFIX}button-group">
            <button type="button" class="${SCRIPT_PREFIX}reset-button" id="${SCRIPT_PREFIX}reset-font-button">Reset</button>
            <button type="button" class="${SCRIPT_PREFIX}apply-button" id="${SCRIPT_PREFIX}apply-font-button">Apply</button>
        </div>
    `;

    // --- Menu bar font size section ---
    const uiSizeSection = document.createElement("div");
    uiSizeSection.className = "tweak-settings-section";
    const uiSizeHeader = document.createElement("h3");
    uiSizeHeader.textContent = "Menu bar font size";
    uiSizeSection.appendChild(uiSizeHeader);
    const uiSizeNote = document.createElement("p");
    uiSizeNote.className = "tweak-section-note";
    uiSizeNote.textContent = "Sizes the chat titles and folders in the left sidebar. Leave it empty to keep the TypingMind default. Allowed range: 8 to 40.";
    uiSizeSection.appendChild(uiSizeNote);

    const sidebarFontSizeInput = createTextInput("tweak_sidebarFontSize_input", "Chat list size (px):", settingsKeys.sidebarFontSize, "e.g., 16", "number", {
      min: "8", max: "40", step: "1", inputmode: "numeric"
    });
    sidebarFontSizeInput.style.marginTop = "5px";
    uiSizeSection.appendChild(sidebarFontSizeInput);

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

    const chatFileSubTitle = document.createElement("div");
    chatFileSubTitle.className = "font-customization-subsection-title";
    chatFileSubTitle.textContent = "Font file upload (takes priority when selected)";
    fontSettingsContainer.appendChild(chatFileSubTitle);
    const chatFileGroup = document.createElement("div");
    chatFileGroup.className = `${SCRIPT_PREFIX}form-group`;
    chatFileGroup.style.marginTop = "5px";
    chatFileGroup.innerHTML = `
        <label for="tweak_chatFontFile_input">Add font files (you can select several at once: Regular, Bold, Italic\u2026):</label>
        <input type="file" id="tweak_chatFontFile_input" accept=".ttf,.otf,.woff,.woff2" multiple>
        <div class="tweak-font-family-list" id="tweak_chatFontFile_list"></div>
        <small>Files with the same name are grouped into one font, and bold/italic in messages will use the matching file. Tap "Use" to switch fonts, or "Stop" to go back to your link/local font above. Nothing gets erased. .ttf, .otf, .woff or .woff2, max 4 MB each (.woff2 is smallest), stored only in this browser.</small>
    `;
    fontSettingsContainer.appendChild(chatFileGroup);

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

    scrollableContent.append(settingsSection, chatColorsSection, globalFontSettingsSection, uiSizeSection, fontSettingsContainer, faviconSettingsSection);

    const footer = document.createElement("div");
    footer.className = "tweak-modal-footer";
    const closeButtonBottom = document.createElement("button");
    closeButtonBottom.id = "tweak-modal-bottom-close";
    closeButtonBottom.type = "button";
    closeButtonBottom.textContent = "Close";
    closeButtonBottom.addEventListener("click", () => toggleModal(false));
    footer.appendChild(closeButtonBottom);

    // Second close button in the corner, always reachable even if the bottom
    // of the screen is covered.
    const closeButtonTop = document.createElement("button");
    closeButtonTop.id = "tweak-modal-x";
    closeButtonTop.type = "button";
    closeButtonTop.title = "Close";
    closeButtonTop.setAttribute("aria-label", "Close UI Tweaks");
    closeButtonTop.textContent = "\u00D7";
    closeButtonTop.addEventListener("click", () => toggleModal(false));

    modalElement.append(closeButtonTop, header, feedbackElement, scrollableContent, footer);
    modalOverlay.appendChild(modalElement);
    document.body.appendChild(modalOverlay);

    // --- Global font listeners ---
    const googleFontSearch = document.getElementById(`${SCRIPT_PREFIX}google-font-search`);
    const googleFontPicker = document.getElementById(`${SCRIPT_PREFIX}google-font-picker`);
    const googleFontClear = document.getElementById(`${SCRIPT_PREFIX}google-font-clear`);
    const localFontInput = document.getElementById(`${SCRIPT_PREFIX}local-font-input`);
    const urlFontInput = document.getElementById(`${SCRIPT_PREFIX}global-font-url`);
    const urlFontFamilyInput = document.getElementById(`${SCRIPT_PREFIX}global-font-family`);
    const fontWeightSelect = document.getElementById(`${SCRIPT_PREFIX}font-weight-select`); // chat text weight
    const uiWeightSelect = document.getElementById(`${SCRIPT_PREFIX}ui-weight-select`);
    const fontFileInput = document.getElementById(`${SCRIPT_PREFIX}font-file-input`);
    const removeFontFileButton = document.getElementById(`${SCRIPT_PREFIX}remove-font-file`);

    // Google Font search box
    googleFontSearch.addEventListener("focus", () => openFontResults());
    googleFontSearch.addEventListener("click", () => {
      if (!isFontResultsOpen()) openFontResults();
    });
    googleFontSearch.addEventListener("input", () => {
      openFontResults();
      updateGoogleFontClearButton();
    });
    googleFontSearch.addEventListener("keydown", (event) => {
      const open = isFontResultsOpen();
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (!open) {
          openFontResults();
          return;
        }
        if (!fontResultItems.length) return;
        const step = event.key === "ArrowDown" ? 1 : -1;
        const count = fontResultItems.length;
        const next = fontResultActiveIndex < 0
          ? (step > 0 ? 0 : count - 1)
          : (fontResultActiveIndex + step + count) % count;
        setActiveFontResult(next, true);
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (open && fontResultActiveIndex >= 0 && fontResultItems[fontResultActiveIndex]) {
          chooseGoogleFont(fontResultItems[fontResultActiveIndex].family, true);
        } else {
          closeFontResults();
          commitTypedGoogleFont(true);
        }
        // On touch screens, "Done" should also put the keyboard away.
        if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) googleFontSearch.blur();
      } else if (event.key === "Escape" && open) {
        // First Escape closes just the list; the next one closes the menu.
        event.preventDefault();
        event.stopPropagation();
        closeFontResults();
        commitTypedGoogleFont(false);
      } else if (event.key === "Tab" && open) {
        closeFontResults();
        commitTypedGoogleFont(false);
      }
    });
    googleFontPicker.addEventListener("focusout", () => {
      setTimeout(() => {
        if (googleFontPicker.contains(document.activeElement)) return;
        if (isFontResultsOpen()) closeFontResults();
        commitTypedGoogleFont(false);
      }, 0);
    });
    googleFontClear.addEventListener("click", () => {
      chooseGoogleFont(null, false);
      googleFontSearch.focus();
    });
    if (window.visualViewport) {
      // The phone keyboard opening shrinks the visible area; keep the list in view.
      window.visualViewport.addEventListener("resize", () => {
        if (isFontResultsOpen()) keepFontResultsInView();
      });
    }

    uiWeightSelect.addEventListener("change", () => {
      preferredUiWeight = uiWeightSelect.value;
      updateGlobalFontPreview();
    });
    // The preview follows the chat text weight only while UI weight is on Default.
    fontWeightSelect.addEventListener("change", () => updateGlobalFontPreview());

    const handleApplyGlobalFont = () => {
      // Use a font name typed into the search box even if it wasn't tapped in the list.
      const typedGoogleFont = googleFontSearch.value.trim();
      const typedIsUnknown = typedGoogleFont
        && !(selectedGoogleFont && typedGoogleFont.toLowerCase() === selectedGoogleFont.toLowerCase())
        && !findGoogleFont(typedGoogleFont)
        && getGoogleFontCatalog().source !== "builtin";
      if (typedIsUnknown) {
        showFeedback(`No Google Font named "${typedGoogleFont}". Pick one from the list.`, 3000);
        return;
      }
      closeFontResults();
      commitTypedGoogleFont(true);
      const chosenGoogleFont = selectedGoogleFont;
      const enteredLocalFont = localFontInput.value.trim();
      const enteredUrl = urlFontInput.value.trim();
      const enteredUrlFamily = urlFontFamilyInput.value.trim();
      const selectedWeight = fontWeightSelect.value; // chat text weight
      const selectedUiWeight = uiWeightSelect.value || null; // null = Default (mixed)
      let settingToSave = null;

      if (chosenGoogleFont) {
        settingToSave = {
          name: chosenGoogleFont, isGoogle: true, isUrl: false, custom: false,
          weight: selectedWeight, uiWeight: selectedUiWeight,
          // The weights/italics to request, so the font loads right on every
          // page load without needing the font list.
          axes: buildGoogleFontAxisSpec(findGoogleFont(chosenGoogleFont)),
        };
      } else if (enteredUrl) {
        if (!(enteredUrl.startsWith("http://") || enteredUrl.startsWith("https://"))) {
          showFeedback("Invalid web font URL. It must start with http:// or https://", 2500);
          return;
        }
        if (!enteredUrlFamily) {
          showFeedback("Please provide the URL font family name.", 2500);
          return;
        }
        settingToSave = { name: enteredUrlFamily, isGoogle: false, isUrl: true, custom: false, url: enteredUrl, weight: selectedWeight, uiWeight: selectedUiWeight };
      } else if (enteredLocalFont) {
        settingToSave = { name: enteredLocalFont, isGoogle: false, isUrl: false, custom: true, weight: selectedWeight, uiWeight: selectedUiWeight };
      } else {
        const storedFontFile = getSetting(settingsKeys.globalFontFile, null);
        if (storedFontFile && storedFontFile.dataUrl) {
          settingToSave = { name: UPLOADED_FONT_FAMILY, isGoogle: false, isUrl: false, custom: false, isFile: true, weight: selectedWeight, uiWeight: selectedUiWeight, fileName: storedFontFile.fileName };
        } else {
          const currentSetting = getSetting(settingsKeys.globalUiFont, null);
          if (currentSetting && (currentSetting.name || currentSetting.isUrl)) {
            settingToSave = { ...currentSetting, weight: selectedWeight, uiWeight: selectedUiWeight };
          } else {
            showFeedback("No global UI font selected.");
            return;
          }
        }
      }
      saveSetting(settingsKeys.globalUiFont, settingToSave);
      updateFontFileStatus();
      updateGlobalFontPreview();
      showFeedback("Global UI font applied.");
    };

    const handleResetGlobalFont = () => {
      saveSetting(settingsKeys.globalUiFont, null);
      localFontInput.value = '';
      urlFontInput.value = '';
      urlFontFamilyInput.value = '';
      fontWeightSelect.value = DEFAULT_FONT_WEIGHT;
      preferredUiWeight = "";
      chooseGoogleFont(null, false); // also resets the UI weight list and the preview
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
        preferredUiWeight = uiWeightSelect.value;
        saveSetting(settingsKeys.globalUiFont, {
          name: UPLOADED_FONT_FAMILY,
          isGoogle: false, isUrl: false, custom: false, isFile: true,
          weight: fontWeightSelect.value,
          uiWeight: uiWeightSelect.value || null,
          fileName: file.name,
        });
        localFontInput.value = '';
        urlFontInput.value = '';
        urlFontFamilyInput.value = '';
        chooseGoogleFont(null, false); // also refreshes the UI weight list and the preview
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

    // --- Chat font file listeners ---
    const chatFontFileInput = document.getElementById("tweak_chatFontFile_input");

    chatFontFileInput.addEventListener("change", async (event) => {
      const pickedFiles = Array.from(event.target.files || []);
      if (!pickedFiles.length) return;
      const readAsDataUrl = (file) => new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve({ dataUrl: e.target.result });
        reader.onerror = () => resolve({ error: true });
        reader.readAsDataURL(file);
      });

      const store = getChatFontStore();
      const skipped = [];
      let added = 0;
      let lastFamily = null;

      for (const file of pickedFiles) {
        const format = getFontFormatFromFileName(file.name);
        if (!format || file.size > FONT_FILE_MAX_BYTES) {
          skipped.push(file.name);
          continue;
        }
        const result = await readAsDataUrl(file);
        if (result.error) {
          skipped.push(file.name);
          continue;
        }
        const parsed = parseFontFileName(file.name);
        // Replace an existing file with the same family + weight + style.
        store.files = store.files.filter((f) => !(
          f.family === parsed.family &&
          (f.weight || 400) === parsed.weight &&
          !!f.italic === parsed.italic
        ));
        store.files.push({
          fileName: file.name,
          dataUrl: result.dataUrl,
          format: format,
          family: parsed.family,
          weight: parsed.weight,
          italic: parsed.italic,
        });
        added++;
        lastFamily = parsed.family;
      }
      chatFontFileInput.value = "";

      if (!added) {
        showFeedback("No files added. Use .ttf, .otf, .woff or .woff2 under 4 MB each.", 3500);
        renderChatFontFileList();
        return;
      }
      store.activeFamily = lastFamily;
      saveSetting(settingsKeys.chatFontFile, store);
      // If storage was full, saveSetting already showed the error; check what actually stuck.
      const stored = getChatFontStore();
      if (!stored.files.some((f) => f.family === lastFamily)) return;
      const skippedNote = skipped.length ? ` (${skipped.length} file${skipped.length > 1 ? "s" : ""} skipped)` : "";
      showFeedback(`"${lastFamily}" is now the chat font.${skippedNote}`, skipped.length ? 3500 : 2000);
    });

    // Mutually exclusive inputs (picking a Google Font clears these in chooseGoogleFont)
    const clearGoogleFontChoice = () => {
      if (selectedGoogleFont || googleFontSearch.value) chooseGoogleFont(null, false);
    };
    localFontInput.addEventListener('input', () => {
      if (localFontInput.value.trim()) {
        urlFontInput.value = '';
        urlFontFamilyInput.value = '';
        clearGoogleFontChoice();
      }
      updateGlobalFontPreview();
    });
    const urlInputHandler = () => {
      if (urlFontInput.value.trim() || urlFontFamilyInput.value.trim()) {
        localFontInput.value = '';
        clearGoogleFontChoice();
      }
      updateGlobalFontPreview();
    };
    urlFontInput.addEventListener('input', urlInputHandler);
    urlFontFamilyInput.addEventListener('input', urlInputHandler);

    updateChatColorPreview();
    updateFontFileStatus();
    renderChatFontFileList();
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
    const sidebarSizeValue = getSetting(settingsKeys.sidebarFontSize, null);
    document.getElementById("tweak_sidebarFontSize_input").value = sidebarSizeValue !== null ? sidebarSizeValue : "";

    loadChatColorInputs();
    updateChatColorPreview();

    const fontSetting = getSetting(settingsKeys.globalUiFont, null);
    const googleFontSearch = document.getElementById(`${SCRIPT_PREFIX}google-font-search`);
    const localFontInput = document.getElementById(`${SCRIPT_PREFIX}local-font-input`);
    const urlFontInput = document.getElementById(`${SCRIPT_PREFIX}global-font-url`);
    const urlFontFamilyInput = document.getElementById(`${SCRIPT_PREFIX}global-font-family`);
    const chatWeightSelect = document.getElementById(`${SCRIPT_PREFIX}font-weight-select`);

    selectedGoogleFont = null;
    localFontInput.value = '';
    urlFontInput.value = '';
    urlFontFamilyInput.value = '';
    preferredUiWeight = "";
    let chatWeight = DEFAULT_FONT_WEIGHT;

    if (fontSetting && (fontSetting.name || fontSetting.isUrl)) {
      if (fontSetting.isGoogle) {
        selectedGoogleFont = fontSetting.name || null;
      } else if (fontSetting.isUrl) {
        urlFontInput.value = fontSetting.url || '';
        urlFontFamilyInput.value = fontSetting.name || '';
      } else if (fontSetting.isFile) {
        // Shown via the uploaded-file status row instead of the text inputs.
      } else {
        localFontInput.value = fontSetting.name || '';
      }
      chatWeight = String(fontSetting.weight || DEFAULT_FONT_WEIGHT);
      preferredUiWeight = fontSetting.uiWeight ? String(fontSetting.uiWeight) : "";
    }
    if (chatWeightSelect) {
      chatWeightSelect.value = chatWeight;
      if (chatWeightSelect.value !== chatWeight) chatWeightSelect.value = DEFAULT_FONT_WEIGHT;
    }
    if (googleFontSearch) googleFontSearch.value = selectedGoogleFont || "";
    closeFontResults();
    refreshUiWeightOptions();
    updateGoogleFontClearButton();
    updateGoogleFontStatus();
    updateGlobalFontPreview();

    // Pick up chat font changes made in another tab since the menu was last open.
    invalidateChatFontStore();
    updateFontFileStatus();
    const fontFileInputEl = document.getElementById(`${SCRIPT_PREFIX}font-file-input`);
    if (fontFileInputEl) fontFileInputEl.value = "";
    renderChatFontFileList();
    const chatFontFileInputEl = document.getElementById("tweak_chatFontFile_input");
    if (chatFontFileInputEl) chatFontFileInputEl.value = "";

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
      } else if ([settingsKeys.customFontSize, settingsKeys.sidebarFontSize].includes(key)) {
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
      // These settings feed the parsed chat font files, so drop the in-memory copy.
      if ([settingsKeys.chatFontFile, settingsKeys.localFontFamily, settingsKeys.customFontFamily].includes(key)) {
        invalidateChatFontStore();
      }

      const silentKeys = [
        settingsKeys.customFaviconData,
        settingsKeys.globalUiFont,
        settingsKeys.globalFontFile,
        settingsKeys.chatFontFile,
        ...CHAT_COLOR_KEYS,
      ];
      if (!silentKeys.includes(key)) {
        showFeedback("Settings saved.");
      }

      applyStylesBasedOnSettings();
      if (key === settingsKeys.customPageTitle) applyCustomTitle();
      // Typing a local/URL font hands the chat over to it: quietly stop using
      // the uploaded font (it stays stored, so it's one tap to switch back).
      if ((key === settingsKeys.localFontFamily || key === settingsKeys.customFontFamily) && valueToStore) {
        const chatStore = getChatFontStore();
        if (chatStore.activeFamily) {
          chatStore.activeFamily = null;
          saveSetting(settingsKeys.chatFontFile, chatStore);
        }
      }
      if ([settingsKeys.customFontUrl, settingsKeys.customFontFamily, settingsKeys.localFontFamily, settingsKeys.customFontSize, settingsKeys.chatFontFile].includes(key)) {
        applyCustomFont();
        renderChatFontFileList();
      }
      if (key === settingsKeys.sidebarFontSize) applySidebarFontSize();
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
      // Fetch (or refresh) the full Google Fonts list in the background.
      const catalogReady = refreshGoogleFontCatalog();
      updateGoogleFontStatus();
      catalogReady.then(() => {
        if (!isTweaksModalOpen()) return;
        updateGoogleFontStatus();
        refreshUiWeightOptions();
        updateGlobalFontPreview();
        if (isFontResultsOpen()) renderFontResults(true);
      });
    } else {
      closeFontResults();
      if (previewUrlTimer) {
        clearTimeout(previewUrlTimer);
        previewUrlTimer = null;
      }
      setPreviewFontStylesheet(null);
      modalOverlay.style.display = "none";
    }
    // Re-sync the button's active/inactive look immediately
    syncTweaksButton();
  }

  document.addEventListener("keydown", (event) => {
    const isMac = navigator.userAgent.toUpperCase().includes("MAC");
    const modifierPressed = isMac ? event.metaKey : event.altKey;
    // Some events (e.g. autofill) arrive without a key value.
    const key = typeof event.key === "string" ? event.key : "";
    if (event.shiftKey && modifierPressed && key.toUpperCase() === "T") {
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
    // Uploaded font files: the selected family takes priority over local/URL fonts.
    const chatStore = getChatFontStore();
    const activeFiles = chatStore.activeFamily
      ? chatStore.files.filter((f) => f.family === chatStore.activeFamily)
      : [];
    const chatFileReady = syncUploadedChatFontFaces(activeFiles);
    let effectiveFontFamily = chatFileReady
      ? chatFontFamilyCssName(chatStore.activeFamily)
      : (cleanedLocalFamily || cleanedFamilyFromUrl);
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
    // The chat font only changes when its settings change (saveSetting
    // re-applies it right away), so it's rebuilt here only if its style tag
    // went missing. Rebuilding it on every page update meant re-reading the
    // stored font files many times a second while a reply was streaming in.
    const chatFontStyleMissing = !document.getElementById("tweak-custom-font-style")
      || (!!getChatFontStore().activeFamily && !document.getElementById("tweak-uploaded-chat-font-face"));
    if (chatFontStyleMissing) applyCustomFont();
    applySidebarFontSize();
    applyChatColors();
    syncTweaksButton();
  }

  // Settings changed in another TypingMind tab: apply them here too.
  window.addEventListener("storage", (event) => {
    const chatFontKeys = [
      settingsKeys.chatFontFile, settingsKeys.localFontFamily, settingsKeys.customFontFamily,
      settingsKeys.customFontUrl, settingsKeys.customFontSize,
    ];
    if (event.key === null || chatFontKeys.includes(event.key)) {
      invalidateChatFontStore();
      applyCustomFont();
    }
    if (event.key === null || event.key === settingsKeys.globalUiFont || event.key === settingsKeys.globalFontFile) {
      applyGlobalUiFont();
    }
  });

  function initializeTweaks() {
    if (originalPageTitle === null) originalPageTitle = document.title;
    // Clean up values from removed features (input-box colors, app-wide font size).
    try {
      localStorage.removeItem("tweak_inputBgColor");
      localStorage.removeItem("tweak_inputTextColor");
      localStorage.removeItem("tweak_globalUiFontSize");
    } catch (e) { /* ignore */ }
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
