/* ============================================================
   TypingMind Dark-Gray Patch  v2
   Console: tmTheme.inspectFade() | tmTheme.dumpRule('scroll-indicator')
            tmTheme.audit() | tmTheme.findNavy() | tmTheme.findGradients()
            tmTheme.off() / .on() | tmTheme.set('fade', '#181717')
   ============================================================ */
(function () {
  'use strict';

  const STYLE_ID = 'tm-dark-gray-patch';

  /* ---------- edit only this block ---------- */
  const C = {
    input:       '#100f0f',  // chat input textarea
    inputBox:    '#131212',  // container wrapping the input
    sidebar:     '#131212',  // sidebar background
    search:      '#100f0f',  // search-chats field
    chatArea:    '#131212',  // main chat scroll area
    fade:        '#131212',  // flat color replacing the scroll gradient
    text:        '#e5e5e5',
    placeholder: '#7a7a7a'
  };

  // 'flat' = solid color where the gradient was
  // 'off'  = remove the fade entirely, nothing painted
  let FADE_MODE = 'flat';
  /* ----------------------------------------- */

  const css = () => `
/* 1. Chat input textarea */
#chat-input-textbox,
[data-element-id="chat-input-textbox"],
[data-element-id="chat-space-end-part"] textarea {
  background-color: ${C.input} !important;
  background-image: none !important;
  color: ${C.text} !important;
}

/* 2. Box wrapping the input */
[data-element-id="chat-space-end-part"] .bg-slate-100,
[data-element-id="chat-space-end-part"] .bg-white,
.pb-safe .bg-slate-100 {
  background-color: ${C.inputBox} !important;
  background-image: none !important;
}

/* 3. Sidebar (confirmed working, left alone) */
[data-element-id="side-bar-background"],
[data-element-id="sidebar-beginning-part"],
[data-element-id="sidebar-middle-part"],
[data-element-id="sidebar-end-part"],
[data-element-id="workspace-bar"] {
  background-color: ${C.sidebar} !important;
  background-image: none !important;
}

[data-element-id="search-chats-bar"],
[data-element-id="side-bar-background"] input[type="text"],
[data-element-id="side-bar-background"] input[type="search"] {
  background-color: ${C.search} !important;
  background-image: none !important;
  color: ${C.text} !important;
  border-color: rgba(255,255,255,.08) !important;
}
[data-element-id="search-chats-bar"]::placeholder,
[data-element-id="side-bar-background"] input::placeholder {
  color: ${C.placeholder} !important;
}

/* 4. Chat area */
[data-element-id="chat-space-background"],
[data-element-id="chat-space-beginning-part"],
[data-element-id="chat-space-middle-part"],
[data-element-id="chat-space-end-part"] {
  background-color: ${C.chatArea} !important;
  background-image: none !important;
}

/* 5. THE FIX. Real class is .scroll-indicator-gradient.
   Class repeated to double specificity so it beats their !important
   regardless of stylesheet order. Covers background-image,
   pseudo-element overlays, and mask-image. */
.scroll-indicator-gradient.scroll-indicator-gradient,
[class*="scroll-indicator"] {
  background-image: none !important;
  background-color: ${FADE_MODE === 'flat' ? C.fade : 'transparent'} !important;
  -webkit-mask-image: none !important;
  mask-image: none !important;
}

.scroll-indicator-gradient.scroll-indicator-gradient::before,
.scroll-indicator-gradient.scroll-indicator-gradient::after {
  background-image: none !important;
  -webkit-mask-image: none !important;
  mask-image: none !important;
  ${FADE_MODE === 'flat'
    ? `background-color: ${C.fade} !important;`
    : `content: none !important; display: none !important;`}
}

/* 5b. Any leftover Tailwind gradients in the chat column */
[data-element-id="chat-space-beginning-part"] [class*="bg-gradient-to"],
[data-element-id="chat-space-middle-part"] [class*="bg-gradient-to"],
[data-element-id="chat-space-end-part"] [class*="bg-gradient-to"] {
  background-image: none !important;
  background-color: ${C.fade} !important;
}
`;

  function inject() {
    let el = document.getElementById(STYLE_ID);
    if (!el) {
      el = document.createElement('style');
      el.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(el);
    }
    const next = css();
    if (el.textContent !== next) el.textContent = next;
    return el;
  }

  inject();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject, { once: true });
  }

  const headObserver = new MutationObserver(() => {
    if (!document.getElementById(STYLE_ID)) inject();
  });
  (function start() {
    if (document.head) headObserver.observe(document.head, { childList: true });
    else requestAnimationFrame(start);
  })();

  const classOf = (el) => {
    const c = el.className;
    if (c && typeof c === 'object' && 'baseVal' in c) return c.baseVal;
    return String(c || '');
  };

  const describe = (el) => ({
    tag: el.tagName.toLowerCase(),
    id: el.id || '',
    elementId: el.getAttribute('data-element-id') || '',
    cls: classOf(el).slice(0, 90)
  });

  window.tmTheme = {
    on: inject,

    off() {
      const el = document.getElementById(STYLE_ID);
      if (el) el.remove();
      headObserver.disconnect();
    },

    set(key, value) {
      if (key === 'fadeMode') {
        if (value !== 'flat' && value !== 'off') {
          console.warn("[tmTheme] fadeMode must be 'flat' or 'off'");
          return;
        }
        FADE_MODE = value;
        inject();
        return;
      }
      if (!(key in C)) {
        console.warn('[tmTheme] unknown key:', key, '| valid:', Object.keys(C).join(', '), ', fadeMode');
        return;
      }
      C[key] = value;
      inject();
    },

    /* Shows exactly HOW the fade is built: element, ::before, ::after */
    inspectFade(selector = '.scroll-indicator-gradient') {
      const el = document.querySelector(selector);
      if (!el) { console.warn('[tmTheme] not on page:', selector); return null; }
      const read = (pseudo) => {
        const s = getComputedStyle(el, pseudo);
        return {
          target: pseudo || 'element',
          content: pseudo ? s.content : '-',
          backgroundImage: (s.backgroundImage || 'none').slice(0, 110),
          backgroundColor: s.backgroundColor,
          maskImage: (s.maskImage || s.webkitMaskImage || 'none').slice(0, 110),
          position: s.position,
          display: s.display
        };
      };
      const rows = [read(null), read('::before'), read('::after')];
      console.table(rows);
      return rows;
    },

    /* Prints TypingMind's own CSS rule so we stop guessing */
    dumpRule(needle = 'scroll-indicator') {
      const found = [];
      const walk = (rules, href) => {
        for (const rule of rules) {
          if (rule.selectorText && rule.selectorText.includes(needle)) {
            found.push({ sheet: href || 'inline <style>', css: rule.cssText });
          }
          if (rule.cssRules) walk(rule.cssRules, href);
        }
      };
      for (const sheet of document.styleSheets) {
        try { walk(sheet.cssRules, sheet.href); }
        catch (e) { /* cross-origin sheet, unreadable, skip */ }
      }
      if (!found.length) console.warn('[tmTheme] no rule matched:', needle);
      found.forEach(f => console.log(`[${f.sheet}]\n${f.css}\n`));
      return found;
    },

    audit() {
      const sels = css()
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('}')
        .map(b => b.split('{')[0].trim())
        .filter(Boolean)
        .flatMap(s => s.split(',').map(x => x.trim()))
        .filter(Boolean);

      const rows = [...new Set(sels)].map(sel => {
        const probe = sel.replace(/::?[a-z-]+$/i, '');
        let matches;
        try { matches = document.querySelectorAll(probe).length; }
        catch (e) { matches = 'invalid'; }
        return { selector: sel, matches };
      });

      console.table(rows.sort((a, b) => (Number(b.matches) || 0) - (Number(a.matches) || 0)));
      return rows;
    },

    findNavy() {
      const hits = [];
      document.querySelectorAll('*').forEach(el => {
        const bg = getComputedStyle(el).backgroundColor;
        const m = bg.match(/\d+(\.\d+)?/g);
        if (!m || m.length < 3) return;
        const [r, g, b] = m.map(Number);
        const alpha = m.length > 3 ? Number(m[3]) : 1;
        if (alpha < 0.1) return;
        if (b > 40 && b - r > 15 && b - g > 10 && (r + g + b) / 3 < 150) {
          hits.push({ ...describe(el), bg });
        }
      });
      console.table(hits);
      return hits;
    },

    findGradients() {
      const hits = [];
      document.querySelectorAll('*').forEach(el => {
        const s = getComputedStyle(el);
        const bi = s.backgroundImage || '';
        const mi = s.maskImage || s.webkitMaskImage || '';
        if (bi.includes('gradient') || mi.includes('gradient')) {
          hits.push({
            ...describe(el),
            source: bi.includes('gradient') ? 'background-image' : 'mask-image',
            value: (bi.includes('gradient') ? bi : mi).slice(0, 100)
          });
        }
      });
      console.table(hits);
      return hits;
    }
  };

  console.log('[tmTheme] v2 loaded. Run tmTheme.inspectFade()');
})();
