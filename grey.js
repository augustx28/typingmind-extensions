/* ============================================================
   TypingMind Dark-Gray Patch  v1
   Console helpers: tmTheme.audit() | tmTheme.findNavy()
                    tmTheme.findGradients() | tmTheme.off() / .on()
                    tmTheme.set('sidebar', '#181717')
   ============================================================ */
(function () {
  'use strict';

  const STYLE_ID = 'tm-dark-gray-patch';

  /* ---------- edit only this block ---------- */
  const C = {
    input:       '#100f0f',  // chat input textarea
    inputBox:    '#131212',  // container wrapping the input
    sidebar:     '#131212',  // sidebar background (was navy)
    search:      '#100f0f',  // search-chats field
    chatArea:    '#131212',  // main chat scroll area
    fade:        '#131212',  // flat color replacing the scroll gradient
    text:        '#e5e5e5',
    placeholder: '#7a7a7a'
  };
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

/* 3. Sidebar: navy to gray */
[data-element-id="side-bar-background"],
[data-element-id="sidebar-beginning-part"],
[data-element-id="sidebar-middle-part"],
[data-element-id="sidebar-end-part"],
[data-element-id="workspace-bar"] {
  background-color: ${C.sidebar} !important;
  background-image: none !important;
}

/* 3b. Search field inside the sidebar */
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

/* 5. Scroll indicator: one flat color, no gradient */
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

  /* Head-only observer. Cheap, and it re-adds the tag if TypingMind wipes it. */
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
      if (!(key in C)) {
        console.warn('[tmTheme] unknown key:', key, '| valid:', Object.keys(C).join(', '));
        return;
      }
      C[key] = value;
      inject();
    },

    /* Which selectors actually match anything on your build */
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

    /* Find every element still painted navy-ish */
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

    /* Find every element still running a gradient */
    findGradients() {
      const hits = [];
      document.querySelectorAll('*').forEach(el => {
        const bi = getComputedStyle(el).backgroundImage;
        if (bi && bi.includes('gradient')) {
          hits.push({ ...describe(el), image: bi.slice(0, 100) });
        }
      });
      console.table(hits);
      return hits;
    }
  };

  console.log('[tmTheme] loaded. Try tmTheme.audit()');
})();
