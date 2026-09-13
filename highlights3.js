/* ══════════════════════════════════════════════════════════════════════
   TYPINGMIND HIGHLIGHTS v2 — mobile-first rebuild
   ──────────────────────────────────────────────────────────────────────
   • Select text in any chat → tap a colour to highlight it
   • Launcher button: tap = open highlights, drag = move it,
     fades when idle, hides while the keyboard is open
   • Panel: full-screen sheet on phones, side panel on desktop
   • Three-dot menu at the TOP, labeled buttons, fully wrapped text
   • GitHub backup: public or private repos both work
     (pull works without a token on public repos; pushes always need
      a token — that's a GitHub rule, not ours)
   ══════════════════════════════════════════════════════════════════════ */
(() => {
  'use strict';
  if (window.__TMHL_V2__) return;
  window.__TMHL_V2__ = true;

  /* ───────────────────────── state & storage ─────────────────────── */
  const LS_DATA     = 'tmhl.data.v2';
  const LS_SETTINGS = 'tmhl.settings.v2';
  const LS_FAB      = 'tmhl.fab.pos.v2';
  const SS_JUMP     = 'tmhl.jump.v2';

  /* highlight colours — edit these if you want different shades */
  const COLORS = {
    yellow: '#ffdf7e',
    green : '#b6f0c1',
    blue  : '#b9e0ff',
    pink  : '#ffd0dd',
    purple: '#e4d4ff',
  };

  const load  = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch { return d; } };
  const saveLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

  let highlights = load(LS_DATA, []);
  let settings = Object.assign(
    { ghUser: '', ghRepo: '', ghBranch: 'main', ghPath: 'highlights.json', ghToken: '', lastSync: 0 },
    load(LS_SETTINGS, {})
  );
  let panelOpen = false, busy = false, filterMode = 'all', currentRange = null, applying = false, idleT = null, selT = null;

  const persist = () => {
    if (!saveLS(LS_DATA, highlights)) toast('Browser storage is full — export a backup', 'alert');
    updateBadges();
  };

  const uid = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  const debounce = (fn, ms) => { let t = null; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const dateStamp = () => new Date().toISOString().slice(0, 10);
  const fmtDate = ts => {
    const d = new Date(ts || 0);
    if (isNaN(d)) return '';
    const now = new Date();
    if (d.toDateString() === now.toDateString())
      return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };
  const b64encode = str => { const b = new TextEncoder().encode(str); let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s); };
  const b64decode = b64 => { const bin = atob(String(b64).replace(/\s/g, '')); return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))); };

  const convId = () => {
    const m = location.pathname.match(/\/c\/([^/?#]+)/);
    return m ? m[1] : (location.pathname || '/');
  };
  const convTitle = () => {
    let t = (document.title || '').replace(/\s*[-–—|]\s*TypingMind\s*$/i, '').trim();
    if (!t || /^typingmind$/i.test(t)) {
      const h = document.querySelector('main h1, h1');
      t = h ? h.textContent.trim() : '';
    }
    return t || 'Conversation';
  };

  /* ───────────────────────── icons ───────────────────────────────── */
  const S = inner => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
  const ICONS = {
    logo:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 5h14"/><rect x="4" y="9.5" width="13" height="5.5" rx="2" fill="currentColor" stroke="none"/><path d="M5 19h9"/></svg>',
    copy:     S('<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5.5 15V6.5A2 2 0 0 1 7.5 4.5H16"/>'),
    find:     S('<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.3-4.3"/>'),
    trash:    S('<path d="M4 7h16"/><path d="M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7"/><path d="M6.5 7l.7 12a2 2 0 0 0 2 1.9h5.6a2 2 0 0 0 2-1.9l.7-12"/><path d="M10 11v6"/><path d="M14 11v6"/>'),
    eraser:   S('<path d="M20 20H8.9a2 2 0 0 1-1.4-.6l-3.7-3.7a2 2 0 0 1 0-2.8l9.5-9.5a2 2 0 0 1 2.8 0l4.4 4.4a2 2 0 0 1 0 2.8L13.4 19.6"/><path d="m7.1 10.3 6.6 6.6"/>'),
    sync:     S('<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1L20.5 8.3"/><path d="M20.5 3.5v4.8h-4.8"/>'),
    download: S('<path d="M12 3.5V14"/><path d="m7.5 10 4.5 4.5 4.5-4.5"/><path d="M4.5 19.5h15"/>'),
    upload:   S('<path d="M12 14V3.5"/><path d="m7.5 8 4.5-4.5L16.5 8"/><path d="M4.5 19.5h15"/>'),
    fileDown: S('<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9z"/><path d="M14 3.5V8h5"/><path d="M12 11v6"/><path d="m9.5 14.5 2.5 2.5 2.5-2.5"/>'),
    fileUp:   S('<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9z"/><path d="M14 3.5V8h5"/><path d="M12 17v-6"/><path d="m9.5 13.5 2.5-2.5 2.5 2.5"/>'),
    fileText: S('<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9z"/><path d="M14 3.5V8h5"/><path d="M9 12.5h6"/><path d="M9 16h4"/>'),
    sliders:  S('<path d="M4 6h8.5"/><circle cx="15.5" cy="6" r="2.3"/><path d="M18.3 6H20"/><path d="M4 12h1.5"/><circle cx="8.5" cy="12" r="2.3"/><path d="M11.3 12H20"/><path d="M4 18h7.5"/><circle cx="14.5" cy="18" r="2.3"/><path d="M17.3 18H20"/>'),
    dots:     '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>',
    x:        S('<path d="M6 6l12 12"/><path d="M18 6 6 18"/>'),
    search:   S('<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.3-4.3"/>'),
    check:    S('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
    alert:    S('<circle cx="12" cy="12" r="9"/><path d="M12 7.5V13"/><path d="M12 16.4h.01"/>'),
  };

  /* ───────────────────────── styles ───────────────────────────────── */
  const CSS = `
/* the marks inside conversations */
mark.tmhl-mark{
  background: var(--tmhl-c, #ffdf7e);
  color: #26221a;
  padding: 0 2px;
  border-radius: 3px;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}
mark.tmhl-mark.tmhl-pulse{ animation: tmhl-pulse 1.8s ease .15s; }
@keyframes tmhl-pulse{
  0%   { box-shadow: 0 0 0 0 rgba(217,119,6,.55); }
  70%  { box-shadow: 0 0 0 12px rgba(217,119,6,0); }
  100% { box-shadow: 0 0 0 0 rgba(217,119,6,0); }
}

/* root + theming */
#tmhl-root{
  --bg:#faf9f7; --card:#ffffff; --border:#e7e4de; --text:#22201b; --muted:#8b877e;
  --accent:#d97706; --danger:#d64545; --ok:#2f8f4a;
  --shadow-md:0 4px 16px rgba(25,20,10,.10);
  --shadow-lg:0 18px 50px rgba(25,20,10,.16), 0 4px 14px rgba(25,20,10,.08);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Inter,"Helvetica Neue",Arial,sans-serif;
  font-size:14px; line-height:1.45; color:var(--text);
  -webkit-font-smoothing:antialiased;
}
html.dark #tmhl-root, body.dark #tmhl-root, html[data-theme="dark"] #tmhl-root{
  --bg:#16171a; --card:#1e2024; --border:#2d3037; --text:#edeae4; --muted:#96938b;
  --accent:#f0a83c; --danger:#e0656a; --ok:#5fbf7a;
  --shadow-md:0 4px 16px rgba(0,0,0,.35);
  --shadow-lg:0 18px 50px rgba(0,0,0,.5), 0 4px 14px rgba(0,0,0,.35);
}
@media (prefers-color-scheme: dark){
  html:not(.light):not([data-theme="light"]) #tmhl-root{
    --bg:#16171a; --card:#1e2024; --border:#2d3037; --text:#edeae4; --muted:#96938b;
    --accent:#f0a83c; --danger:#e0656a; --ok:#5fbf7a;
    --shadow-md:0 4px 16px rgba(0,0,0,.35);
    --shadow-lg:0 18px 50px rgba(0,0,0,.5), 0 4px 14px rgba(0,0,0,.35);
  }
}
#tmhl-root *{ box-sizing:border-box; }
#tmhl-root button{
  font:inherit; color:inherit; background:none; border:0; padding:0;
  cursor:pointer; -webkit-tap-highlight-color:transparent; touch-action:manipulation;
}
#tmhl-root input{ font:inherit; color:inherit; }
#tmhl-root [hidden]{ display:none !important; }

/* launcher (floater) */
#tmhl-fab{
  position:fixed; width:46px; height:46px; border-radius:15px;
  background:var(--card); border:1px solid var(--border);
  box-shadow:var(--shadow-md); color:var(--accent);
  display:grid; place-items:center; z-index:2147483000;
  touch-action:none; user-select:none; -webkit-user-select:none;
  transition:opacity .25s ease;
}
#tmhl-fab:active{ transform:scale(.93); }
#tmhl-fab.idle{ opacity:.42; }
#tmhl-fab.dragging{ cursor:grabbing; box-shadow:var(--shadow-lg); }
#tmhl-fab.snapping{ transition:left .25s cubic-bezier(.2,.8,.2,1), top .25s cubic-bezier(.2,.8,.2,1), opacity .25s ease; }
#tmhl-fab.gone, #tmhl-fab.kb{ opacity:0 !important; pointer-events:none; }
#tmhl-fab svg{ width:22px; height:22px; pointer-events:none; }
#tmhl-fab .tmhl-badge{
  position:absolute; top:-5px; right:-5px;
  min-width:18px; height:18px; padding:0 4px;
  border-radius:99px; background:var(--accent); color:#fff;
  font-size:10.5px; font-weight:700; line-height:18px; text-align:center;
  border:2px solid var(--bg);
}

/* scrim + panel */
#tmhl-scrim{
  position:fixed; inset:0; background:rgba(12,12,15,.42);
  z-index:2147483001; opacity:0; pointer-events:none; touch-action:none;
  transition:opacity .25s ease;
}
#tmhl-scrim.in{ opacity:1; pointer-events:auto; }
#tmhl-panel{
  position:fixed; top:0; right:0; bottom:0; width:min(420px,100vw);
  background:var(--bg); z-index:2147483002; overflow:hidden;
  display:flex; flex-direction:column;
  transform:translateX(103%); transition:transform .32s cubic-bezier(.32,.72,0,1);
  border-left:1px solid var(--border); box-shadow:var(--shadow-lg);
}
#tmhl-panel.open{ transform:translateX(0); }

/* header — the three-dot menu lives HERE now */
.tmhl-head{
  display:flex; align-items:center; gap:8px;
  padding:12px 12px 10px; padding-top:max(12px, env(safe-area-inset-top));
  border-bottom:1px solid var(--border);
}
.tmhl-title{ display:flex; align-items:center; gap:8px; flex:1; min-width:0; }
.tmhl-title svg{ width:21px; height:21px; color:var(--accent); flex:none; }
.tmhl-title h2{ font-size:16px; font-weight:700; letter-spacing:-.01em; white-space:nowrap; }
.tmhl-count{ font-size:11px; font-weight:700; color:var(--muted); background:var(--card); border:1px solid var(--border); border-radius:99px; padding:2px 8px; }
.tmhl-hbtns{ display:flex; gap:2px; flex:none; }
.tmhl-ibtn{ width:38px; height:38px; border-radius:11px; display:grid; place-items:center; color:var(--muted); transition:background .15s, color .15s; }
.tmhl-ibtn:hover{ background:var(--card); color:var(--text); }
.tmhl-ibtn:active{ transform:scale(.92); }
.tmhl-ibtn svg{ width:19px; height:19px; }
.tmhl-ibtn.spin svg{ animation:tmhl-rot .9s linear infinite; }
@keyframes tmhl-rot{ to{ transform:rotate(360deg); } }

/* search + filter */
.tmhl-tools{ padding:10px 12px; display:flex; flex-direction:column; gap:8px; border-bottom:1px solid var(--border); }
.tmhl-search{ display:flex; align-items:center; gap:8px; height:40px; padding:0 11px; background:var(--card); border:1px solid var(--border); border-radius:11px; }
.tmhl-search svg{ width:16px; height:16px; color:var(--muted); flex:none; }
.tmhl-search input{ flex:1; min-width:0; border:0; outline:0; background:none; font-size:14px; }
.tmhl-seg{ display:flex; gap:3px; padding:3px; background:var(--card); border:1px solid var(--border); border-radius:11px; }
.tmhl-seg button{ flex:1; height:31px; border-radius:8px; font-size:12.5px; font-weight:600; color:var(--muted); transition:background .15s, color .15s; }
.tmhl-seg button.on{ background:var(--accent); color:#fff; }
@media (max-width:640px){
  #tmhl-root input{ font-size:16px; } /* stops iOS zoom-on-focus */
}

/* list + highlight cards — text always wraps fully */
.tmhl-list{
  flex:1; overflow-y:auto; overscroll-behavior:contain; -webkit-overflow-scrolling:touch;
  padding:12px 12px calc(24px + env(safe-area-inset-bottom));
  display:flex; flex-direction:column; gap:10px;
}
.tmhl-list::-webkit-scrollbar{ width:8px; }
.tmhl-list::-webkit-scrollbar-thumb{ background:var(--border); border-radius:8px; }
.tmhl-card{ display:flex; gap:11px; padding:12px; background:var(--card); border:1px solid var(--border); border-radius:14px; }
.tmhl-bar{ width:4px; border-radius:99px; flex:none; }
.tmhl-body{ flex:1; min-width:0; }
.tmhl-text{ font-size:14px; line-height:1.55; white-space:pre-wrap; overflow-wrap:anywhere; word-break:break-word; }
.tmhl-meta{ margin-top:6px; font-size:11.5px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.tmhl-acts{ display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; }
.tmhl-act{ display:inline-flex; align-items:center; gap:6px; height:32px; padding:0 11px; border-radius:9px; border:1px solid var(--border); color:var(--muted); font-size:12px; font-weight:600; transition:color .15s, border-color .15s; }
.tmhl-act svg{ width:14px; height:14px; }
.tmhl-act:hover{ color:var(--text); border-color:var(--muted); }
.tmhl-act:active{ transform:scale(.95); }
.tmhl-act.danger{ color:var(--danger); }
.tmhl-act.danger:hover{ border-color:var(--danger); }

/* empty state */
.tmhl-empty{ position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; padding:32px; text-align:center; pointer-events:none; }
.tmhl-empty svg{ width:44px; height:44px; color:var(--accent); opacity:.95; }
.tmhl-empty b{ font-size:15px; font-weight:700; }
.tmhl-empty span{ font-size:13px; color:var(--muted); line-height:1.55; max-width:260px; }

/* dropdown menu */
#tmhl-menu{
  position:fixed; z-index:2147483005; min-width:240px; max-width:calc(100vw - 24px);
  background:var(--card); border:1px solid var(--border); border-radius:14px;
  box-shadow:var(--shadow-lg); padding:6px;
  transform-origin:top right; transform:scale(.92); opacity:0; pointer-events:none;
  transition:transform .16s ease, opacity .16s ease;
}
#tmhl-menu.open{ transform:scale(1); opacity:1; pointer-events:auto; }
.tmhl-mi{ display:flex; align-items:center; gap:10px; width:100%; height:40px; padding:0 10px; border-radius:9px; font-size:13.5px; font-weight:500; text-align:left; }
.tmhl-mi:hover{ background:var(--bg); }
.tmhl-mi svg{ width:17px; height:17px; color:var(--muted); flex:none; }
.tmhl-mi.danger, .tmhl-mi.danger svg{ color:var(--danger); }
.tmhl-msep{ height:1px; margin:5px 8px; background:var(--border); }

/* selection toolbar */
#tmhl-selbar{
  position:fixed; z-index:2147483008;
  display:flex; align-items:center; gap:2px; padding:5px;
  background:#1e2025; border-radius:14px;
  box-shadow:0 10px 30px rgba(8,8,12,.35), 0 0 0 1px rgba(255,255,255,.07);
  opacity:0; pointer-events:none; transform:scale(.9);
  transition:opacity .14s ease, transform .14s ease;
}
#tmhl-selbar.show{ opacity:1; pointer-events:auto; transform:scale(1); }
#tmhl-selbar, #tmhl-selbar *{ user-select:none; -webkit-user-select:none; -webkit-touch-callout:none; }
.tmhl-dot{ width:31px; height:31px; border-radius:50%; flex:none; border:2px solid rgba(255,255,255,.14); }
.tmhl-dot:hover{ border-color:#fff; }
.tmhl-sdiv{ width:1px; height:20px; margin:0 4px; background:rgba(255,255,255,.16); flex:none; }
.tmhl-sbtn{ width:33px; height:33px; border-radius:10px; color:#cfcdd6; display:grid; place-items:center; flex:none; }
.tmhl-sbtn:hover{ background:rgba(255,255,255,.1); color:#fff; }
.tmhl-sbtn svg{ width:16px; height:16px; }

/* toasts */
#tmhl-toasts{
  position:fixed; left:50%; bottom:calc(16px + env(safe-area-inset-bottom));
  transform:translateX(-50%); z-index:2147483020;
  display:flex; flex-direction:column; align-items:center; gap:8px;
  pointer-events:none; width:max-content; max-width:calc(100vw - 32px);
}
.tmhl-toast{
  display:flex; align-items:center; gap:8px;
  background:#1e2025; color:#f2f0ec; font-size:13px; font-weight:600;
  padding:10px 15px; border-radius:12px; box-shadow:0 10px 30px rgba(8,8,12,.35);
  opacity:0; transform:translateY(8px); transition:opacity .22s ease, transform .22s ease;
  max-width:100%;
}
.tmhl-toast.in{ opacity:1; transform:none; }
.tmhl-toast svg{ width:15px; height:15px; flex:none; }
.tmhl-toast.ok svg{ color:#7fd67f; }
.tmhl-toast.err svg{ color:#ff8f7a; }

/* modals */
#tmhl-modal-scrim{
  position:fixed; inset:0; z-index:2147483015;
  background:rgba(12,12,15,.48);
  display:grid; place-items:center; padding:18px;
  opacity:0; pointer-events:none; transition:opacity .2s ease;
}
#tmhl-modal-scrim.in{ opacity:1; pointer-events:auto; }
.tmhl-modal{
  width:min(460px,100%); max-height:min(86vh,760px); overflow-y:auto; overscroll-behavior:contain;
  background:var(--bg); border:1px solid var(--border); border-radius:18px;
  padding:20px; box-shadow:var(--shadow-lg);
  transform:scale(.96) translateY(10px); transition:transform .2s ease;
}
#tmhl-modal-scrim.in .tmhl-modal{ transform:none; }
.tmhl-modal h3{ display:flex; align-items:center; gap:9px; font-size:16.5px; font-weight:700; letter-spacing:-.01em; }
.tmhl-modal h3 svg{ width:19px; height:19px; color:var(--accent); flex:none; }
.tmhl-sub{ margin-top:6px; font-size:13px; color:var(--muted); line-height:1.55; }
.tmhl-field{ margin-top:13px; }
.tmhl-field label{ display:block; margin-bottom:5px; font-size:12px; font-weight:600; color:var(--muted); }
.tmhl-field input{ width:100%; height:42px; padding:0 12px; border-radius:11px; border:1px solid var(--border); background:var(--card); font-size:14px; outline:0; }
.tmhl-field input:focus{ border-color:var(--accent); box-shadow:0 0 0 3px rgba(217,119,6,.15); }
.tmhl-grid2{ display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.tmhl-note{ margin-top:13px; padding:11px 13px; background:var(--card); border:1px solid var(--border); border-radius:11px; font-size:12.5px; color:var(--muted); line-height:1.6; }
.tmhl-note b{ color:var(--text); }
.tmhl-status{ margin-top:10px; font-size:12.5px; line-height:1.5; }
.tmhl-status.ok{ color:var(--ok); }
.tmhl-status.err{ color:var(--danger); }
.tmhl-mfoot{ display:flex; gap:8px; margin-top:18px; }
.tmhl-btn{ display:inline-flex; align-items:center; justify-content:center; gap:8px; height:40px; padding:0 16px; border-radius:11px; font-size:13.5px; font-weight:600; }
.tmhl-btn svg{ width:16px; height:16px; }
.tmhl-btn.primary{ flex:1; background:var(--accent); color:#fff; }
.tmhl-btn.ghost{ background:var(--card); border:1px solid var(--border); }
.tmhl-btn.danger{ flex:1; background:var(--danger); color:#fff; }
`;

  /* ───────────────────────── markup ───────────────────────────────── */
  const root = document.createElement('div');
  root.id = 'tmhl-root';
  root.innerHTML = `
    <style>${CSS}</style>

    <div id="tmhl-fab" role="button" tabindex="0" aria-label="Open highlights">
      ${ICONS.logo}
      <span class="tmhl-badge" id="tmhl-badge" hidden>0</span>
    </div>

    <div id="tmhl-scrim"></div>

    <aside id="tmhl-panel" role="dialog" aria-label="Highlights">
      <header class="tmhl-head">
        <div class="tmhl-title">
          ${ICONS.logo}
          <h2>Highlights</h2>
          <span class="tmhl-count" id="tmhl-count">0</span>
        </div>
        <div class="tmhl-hbtns">
          <button class="tmhl-ibtn" id="tmhl-b-sync" title="Sync with GitHub" aria-label="Sync with GitHub">${ICONS.sync}</button>
          <button class="tmhl-ibtn" id="tmhl-b-menu" title="More options" aria-label="More options">${ICONS.dots}</button>
          <button class="tmhl-ibtn" id="tmhl-b-close" title="Close" aria-label="Close highlights">${ICONS.x}</button>
        </div>
      </header>

      <div class="tmhl-tools">
        <label class="tmhl-search">
          ${ICONS.search}
          <input id="tmhl-q" type="search" placeholder="Search highlights" autocomplete="off">
        </label>
        <div class="tmhl-seg" id="tmhl-seg">
          <button type="button" data-f="all" class="on">All chats</button>
          <button type="button" data-f="chat">This chat</button>
        </div>
      </div>

      <div class="tmhl-list" id="tmhl-list"></div>

      <div class="tmhl-empty" id="tmhl-empty" hidden>
        ${ICONS.logo}
        <b>No highlights yet</b>
        <span>Select any text in a conversation, then tap a colour to save it here.</span>
      </div>
    </aside>

    <div id="tmhl-menu" role="menu">
      <button class="tmhl-mi" role="menuitem" data-act="sync">${ICONS.sync}<span>Sync now</span></button>
      <button class="tmhl-mi" role="menuitem" data-act="pull">${ICONS.download}<span>Pull from GitHub</span></button>
      <button class="tmhl-mi" role="menuitem" data-act="push">${ICONS.upload}<span>Push to GitHub</span></button>
      <div class="tmhl-msep"></div>
      <button class="tmhl-mi" role="menuitem" data-act="export-json">${ICONS.fileDown}<span>Export JSON</span></button>
      <button class="tmhl-mi" role="menuitem" data-act="export-md">${ICONS.fileText}<span>Export Markdown</span></button>
      <button class="tmhl-mi" role="menuitem" data-act="import">${ICONS.fileUp}<span>Import backup…</span></button>
      <div class="tmhl-msep"></div>
      <button class="tmhl-mi" role="menuitem" data-act="settings">${ICONS.sliders}<span>GitHub settings</span></button>
      <button class="tmhl-mi danger" role="menuitem" data-act="clear">${ICONS.trash}<span>Delete all highlights</span></button>
    </div>

    <div id="tmhl-selbar"></div>
    <div id="tmhl-toasts"></div>
    <div id="tmhl-modal-scrim"></div>
    <input type="file" id="tmhl-file" accept="application/json,.json" hidden>
  `;

  const ui = {};

  /* ───────────────────────── toasts ───────────────────────────────── */
  function toast(msg, icon){
    if (!ui.toasts) return;
    const key = ICONS[icon] ? icon : 'check';
    const t = document.createElement('div');
    t.className = 'tmhl-toast ' + (key === 'alert' ? 'err' : 'ok');
    t.innerHTML = ICONS[key];
    const s = document.createElement('span');
    s.textContent = msg;
    t.appendChild(s);
    ui.toasts.appendChild(t);
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 260); }, 2400);
  }

  /* ───────────────────────── panel ───────────────────────────────── */
  function openPanel(){
    panelOpen = true;
    ui.panel.style.height = '';
    ui.panel.classList.add('open');
    ui.scrim.classList.add('in');
    ui.fab.classList.add('gone');
    renderList();
  }
  function closePanel(){
    panelOpen = false;
    ui.panel.classList.remove('open');
    ui.scrim.classList.remove('in');
    ui.fab.classList.remove('gone');
    closeMenu();
  }
  const togglePanel = () => panelOpen ? closePanel() : openPanel();

  function toggleMenu(){
    const willOpen = !ui.menu.classList.contains('open');
    ui.menu.classList.toggle('open', willOpen);
    if (!willOpen) return;
    const r = ui.menuBtn.getBoundingClientRect();
    const w = ui.menu.offsetWidth;
    let right = Math.max(10, window.innerWidth - r.right);
    if (right + w > window.innerWidth - 10) right = Math.max(10, window.innerWidth - w - 10);
    ui.menu.style.right = right + 'px';
    let top = r.bottom + 6;
    if (top + ui.menu.offsetHeight > window.innerHeight - 10)
      top = Math.max(10, r.top - ui.menu.offsetHeight - 6);
    ui.menu.style.top = top + 'px';
  }
  const closeMenu = () => ui.menu.classList.remove('open');

  function updateBadges(){
    const n = highlights.length;
    ui.badge.hidden = n === 0;
    ui.badge.textContent = n > 99 ? '99+' : String(n);
    ui.count.textContent = String(n);
  }

  function renderList(){
    const q = ui.q.value.trim().toLowerCase();
    let items = filterMode === 'all' ? highlights.slice() : highlights.filter(h => h.convId === convId());
    if (q) items = items.filter(h =>
      (h.text || '').toLowerCase().includes(q) || (h.convTitle || '').toLowerCase().includes(q));
    items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    ui.count.textContent = String(highlights.length);
    ui.list.innerHTML = '';
    ui.empty.hidden = items.length > 0;
    ui.empty.querySelector('b').textContent = q ? 'No matches' : 'No highlights yet';
    ui.empty.querySelector('span').textContent = q
      ? 'Try a different search.'
      : (filterMode === 'chat'
          ? 'Nothing highlighted in this chat yet. Select some text to start.'
          : 'Select any text in a conversation, then tap a colour to save it here.');
    const frag = document.createDocumentFragment();
    for (const h of items) frag.appendChild(card(h));
    ui.list.appendChild(frag);
  }

  function card(h){
    const cardEl = document.createElement('div'); cardEl.className = 'tmhl-card';
    const bar = document.createElement('div'); bar.className = 'tmhl-bar';
    bar.style.background = COLORS[h.color] || COLORS.yellow;
    const body = document.createElement('div'); body.className = 'tmhl-body';
    const text = document.createElement('div'); text.className = 'tmhl-text';
    text.textContent = h.text || '';
    const meta = document.createElement('div'); meta.className = 'tmhl-meta';
    meta.textContent = (h.convTitle || 'Conversation') + ' · ' + fmtDate(h.createdAt);
    const acts = document.createElement('div'); acts.className = 'tmhl-acts';
    const mk = (icon, label, fn, danger) => {
      const b = document.createElement('button');
      b.className = 'tmhl-act' + (danger ? ' danger' : '');
      b.title = label;
      b.innerHTML = icon + '<span>' + label + '</span>';
      b.addEventListener('click', fn);
      return b;
    };
    acts.append(
      mk(ICONS.copy, 'Copy',   () => copyText(h.text)),
      mk(ICONS.find, 'Find',   () => locate(h)),
      mk(ICONS.trash, 'Delete', () => removeHighlightById(h.id), true)
    );
    body.append(text, meta, acts);
    cardEl.append(bar, body);
    return cardEl;
  }

  /* ───────────────────────── actions ─────────────────────────────── */
  async function copyText(t){
    try { await navigator.clipboard.writeText(t); toast('Copied', 'check'); }
    catch {
      const ta = document.createElement('textarea');
      ta.value = t; ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('Copied', 'check'); }
      catch { toast('Copy failed', 'alert'); }
      ta.remove();
    }
  }

  function locate(h){
    if (h.convId === convId()){
      closePanel();
      applyHighlights();
      tryScrollTo(h.id);
    } else {
      sessionStorage.setItem(SS_JUMP, h.id);
      closePanel();
      location.assign(h.path || ('/c/' + h.convId));
    }
  }

  function tryScrollTo(id, tries){
    tries = tries || 0;
    const m = document.querySelector('mark.tmhl-mark[data-hl="' + id + '"]');
    if (m){
      m.scrollIntoView({ behavior: 'smooth', block: 'center' });
      m.classList.add('tmhl-pulse');
      setTimeout(() => m.classList.remove('tmhl-pulse'), 2100);
    } else if (tries < 25){
      setTimeout(() => tryScrollTo(id, tries + 1), 320);
    } else {
      toast('Couldn’t find that highlight on this page', 'alert');
    }
  }

  function removeHighlightById(id){
    highlights = highlights.filter(h => h.id !== id);
    persist();
    if (panelOpen) renderList();
    document.querySelectorAll('mark.tmhl-mark[data-hl="' + id + '"]').forEach(unwrap);
    toast('Highlight removed', 'trash');
  }
  function unwrap(m){
    const p = m.parentNode;
    if (!p) return;
    while (m.firstChild) p.insertBefore(m.firstChild, m);
    p.removeChild(m);
    if (p.normalize) p.normalize();
  }
  const unwrapAll = () => document.querySelectorAll('mark.tmhl-mark').forEach(unwrap);

  /* ───────────────────────── selection toolbar ───────────────────── */
  function buildSelbar(){
    ui.selbar.innerHTML = '';
    for (const key of Object.keys(COLORS)){
      const b = document.createElement('button');
      b.className = 'tmhl-dot';
      b.title = key[0].toUpperCase() + key.slice(1) + ' highlight';
      b.style.background = COLORS[key];
      b.addEventListener('click', () => addHighlight(key));
      ui.selbar.appendChild(b);
    }
    const sep = document.createElement('div'); sep.className = 'tmhl-sdiv';
    ui.selbar.appendChild(sep);
    const cp = iconBtn(ICONS.copy, 'Copy text', () => currentRange && copyText(currentRange.toString()));
    const er = iconBtn(ICONS.eraser, 'Remove highlight', eraseAtSelection);
    er.hidden = true;
    ui.selbar.append(cp, er);
    ui.eraser = er;
  }
  function iconBtn(icon, title, fn){
    const b = document.createElement('button');
    b.className = 'tmhl-sbtn';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = icon;
    b.addEventListener('click', fn);
    return b;
  }

  function checkSelection(){
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || panelOpen || ui.modal.classList.contains('in'))
      return hideSelbar();
    const range = sel.getRangeAt(0);
    const raw = range.toString();
    if (!raw || raw.trim().length < 2) return hideSelbar();
    let el = range.commonAncestorContainer;
    if (el.nodeType === 3) el = el.parentElement;
    if (!el || el.closest('#tmhl-root')) return hideSelbar();
    if (el.closest('input, textarea, select, [contenteditable="true"]')) return hideSelbar();
    const main = document.querySelector('main');
    if (main && !main.contains(el)) return hideSelbar();
    currentRange = range.cloneRange();
    showSelbar(range);
  }

  function showSelbar(range){
    ui.eraser.hidden = !markNear(range);
    ui.selbar.classList.add('show');
    const r = range.getBoundingClientRect();
    const w = ui.selbar.offsetWidth, h = ui.selbar.offsetHeight;
    let x = r.left + r.width / 2 - w / 2;
    x = Math.min(Math.max(x, 10), window.innerWidth - w - 10);
    let y = r.top - h - 12;
    if (y < 10) y = Math.min(r.bottom + 12, window.innerHeight - h - 10);
    ui.selbar.style.left = Math.round(x) + 'px';
    ui.selbar.style.top = Math.round(Math.max(10, y)) + 'px';
  }
  const hideSelbar = () => ui.selbar.classList.remove('show');

  function markNear(range){
    if (!range) return null;
    let n = range.startContainer;
    if (n.nodeType === 3) n = n.parentElement;
    return n ? n.closest('mark.tmhl-mark') : null;
  }

  function eraseAtSelection(){
    const m = markNear(currentRange);
    if (m && m.dataset.hl) removeHighlightById(m.dataset.hl);
    hideSelbar();
  }

  function clearSelection(){
    const sel = document.getSelection();
    if (sel) sel.removeAllRanges();
  }

  /* ───────────────────────── highlight core ───────────────────────── */
  function addHighlight(colorKey){
    if (!currentRange) return;
    const text = currentRange.toString();
    if (!text || text.trim().length < 2) return;

    /* re-selecting an existing highlight just recolors it */
    const existing = markNear(currentRange);
    if (existing && existing.dataset.hl){
      const h = highlights.find(x => x.id === existing.dataset.hl);
      if (h){
        h.color = colorKey;
        h.updatedAt = Date.now();
        document.querySelectorAll('mark.tmhl-mark[data-hl="' + h.id + '"]')
          .forEach(m => m.style.setProperty('--tmhl-c', COLORS[colorKey]));
        persist();
        if (panelOpen) renderList();
        hideSelbar(); currentRange = null; clearSelection();
        toast('Color updated', 'check');
        return;
      }
    }

    const id = uid();
    const ctx = contextAround(currentRange);
    wrapRange(currentRange, id, colorKey);
    highlights.unshift({
      id, text, color: colorKey,
      convId: convId(), convTitle: convTitle(), path: location.pathname,
      before: ctx.before, after: ctx.after,
      createdAt: Date.now(), updatedAt: Date.now(),
    });
    persist();
    hideSelbar(); currentRange = null; clearSelection();
    if (panelOpen) renderList();
    toast('Highlight saved', 'check');
  }

  function contextAround(range){
    try {
      let scope = range.commonAncestorContainer;
      if (scope.nodeType === 3) scope = scope.parentElement;
      if (!scope) return { before: '', after: '' };
      const pre = document.createRange();
      pre.selectNodeContents(scope);
      pre.setEnd(range.startContainer, range.startOffset);
      const post = document.createRange();
      post.selectNodeContents(scope);
      post.setStart(range.endContainer, range.endOffset);
      return { before: pre.toString().slice(-64), after: post.toString().slice(0, 64) };
    } catch { return { before: '', after: '' }; }
  }

  function wrapRange(range, id, colorKey){
    let rootEl = range.commonAncestorContainer;
    if (rootEl.nodeType === 3) rootEl = rootEl.parentElement;
    if (!rootEl) return;
    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null);
    const jobs = [];
    let n;
    while ((n = walker.nextNode())){
      if (n.parentElement.closest('#tmhl-root')) continue;
      if (n.parentElement.closest('mark.tmhl-mark')) continue;
      if (!range.intersectsNode(n)) continue;
      const s = n === range.startContainer ? range.startOffset : 0;
      const e = n === range.endContainer ? range.endOffset : n.nodeValue.length;
      if (e > s) jobs.push([n, s, e]);
    }
    for (const job of jobs) wrapTextNode(job[0], job[1], job[2], id, colorKey);
  }

  function wrapTextNode(node, s, e, id, colorKey){
    const parent = node.parentNode;
    if (!parent) return;
    const mark = document.createElement('mark');
    mark.className = 'tmhl-mark';
    mark.setAttribute('data-hl', id);
    mark.style.setProperty('--tmhl-c', COLORS[colorKey] || COLORS.yellow);
    if (s === 0 && e === node.nodeValue.length){
      parent.insertBefore(mark, node);
      mark.appendChild(node);
    } else {
      const mid = node.splitText(s);
      mid.splitText(e - s);
      parent.replaceChild(mark, mid);
      mark.appendChild(mid);
    }
  }

  function chatRootEl(){
    return document.querySelector('main') || document.querySelector('[role="main"]') || document.body;
  }

  function buildIndex(){
    const parts = [];
    let text = '';
    const walker = document.createTreeWalker(chatRootEl(), NodeFilter.SHOW_TEXT, {
      acceptNode(n){
        const p = n.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (p.closest('#tmhl-root') || p.closest('script, style, noscript, textarea')) return NodeFilter.FILTER_REJECT;
        if (p.closest('mark.tmhl-mark')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let n;
    while ((n = walker.nextNode())){
      parts.push({ node: n, start: text.length });
      text += n.nodeValue;
    }
    return { parts, text };
  }

  /* re-wraps stored highlights after TypingMind re-renders the chat */
  function applyHighlights(){
    if (applying) return;
    const cid = convId();
    const pending = highlights.filter(h => h && h.convId === cid && h.text && h.text.trim());
    if (!pending.length) return;
    const have = new Set();
    document.querySelectorAll('mark.tmhl-mark').forEach(m => have.add(m.dataset.hl));
    const todo = pending.filter(h => !have.has(h.id));
    if (!todo.length) return;
    applying = true;
    try {
      for (const h of todo){
        const idx = buildIndex();
        let start = -1;
        const needle = (h.before || '') + h.text + (h.after || '');
        let at = (h.before || h.after) ? idx.text.indexOf(needle) : -1;
        if (at >= 0) start = at + (h.before || '').length;
        else { at = idx.text.indexOf(h.text); if (at >= 0) start = at; }
        if (start < 0) continue;
        const end = start + h.text.length;
        for (const p of idx.parts){
          const s = Math.max(start - p.start, 0);
          const e = Math.min(end - p.start, p.node.nodeValue.length);
          if (e > s) wrapTextNode(p.node, s, e, h.id, h.color);
        }
      }
    } finally { applying = false; }
  }

  /* ───────────────────────── floater ─────────────────────────────── */
  function setFabXY(x, y){
    const s = ui.fab.offsetWidth || 46;
    x = Math.min(Math.max(x, 8), window.innerWidth - s - 8);
    y = Math.min(Math.max(y, 10), window.innerHeight - s - 12);
    ui.fab.style.left = Math.round(x) + 'px';
    ui.fab.style.top = Math.round(y) + 'px';
  }
  function initFab(){
    const p = load(LS_FAB, null);
    if (p && typeof p.x === 'number') setFabXY(p.x, p.y);
    else setFabXY(window.innerWidth - 62, Math.round(window.innerHeight * 0.6));
  }
  function wakeFab(){
    ui.fab.classList.remove('idle');
    clearTimeout(idleT);
    idleT = setTimeout(() => { if (!panelOpen) ui.fab.classList.add('idle'); }, 3500);
  }

  /* ───────────────────────── GitHub sync ─────────────────────────── */
  const ghCfg = () => ({
    user: settings.ghUser.trim(), repo: settings.ghRepo.trim(),
    branch: (settings.ghBranch || 'main').trim(),
    path: (settings.ghPath || 'highlights.json').trim(),
    token: (settings.ghToken || '').trim(),
  });
  const ghHeaders = t => { const h = { Accept: 'application/vnd.github+json' }; if (t) h.Authorization = 'Bearer ' + t; return h; };
  const encPath = p => p.split('/').map(encodeURIComponent).join('/');

  async function remoteGet(){
    const c = ghCfg();
    if (!c.user || !c.repo) throw new Error('Add your GitHub username and repository in “GitHub settings” first.');
    const res = await fetch(
      'https://api.github.com/repos/' + encodeURIComponent(c.user) + '/' + encodeURIComponent(c.repo) +
      '/contents/' + encPath(c.path) + '?ref=' + encodeURIComponent(c.branch) + '&_=' + Date.now(),
      { headers: ghHeaders(c.token), cache: 'no-store' }
    );
    if (res.status === 404) return null;
    if (res.status === 401) throw new Error('GitHub rejected your token — check that it’s valid and not expired.');
    if (!res.ok) throw new Error('GitHub error ' + res.status);
    const d = await res.json();
    let data = [];
    try { const p = JSON.parse(b64decode(d.content || '')); if (Array.isArray(p)) data = p; } catch {}
    return { sha: d.sha, data };
  }

  async function remotePut(arr){
    const c = ghCfg();
    if (!c.token) throw new Error('Pushing needs a token — GitHub requires one even for public repos. Add it under “GitHub settings”.');
    let info = await remoteGet();
    for (let i = 0; i < 2; i++){
      const body = {
        message: 'TypingMind highlights — ' + new Date().toLocaleString(),
        branch: c.branch,
        content: b64encode(JSON.stringify(arr, null, 2)),
      };
      if (info) body.sha = info.sha;
      const res = await fetch(
        'https://api.github.com/repos/' + encodeURIComponent(c.user) + '/' + encodeURIComponent(c.repo) + '/contents/' + encPath(c.path),
        { method: 'PUT', headers: Object.assign(ghHeaders(c.token), { 'Content-Type': 'application/json' }), body: JSON.stringify(body) }
      );
      if (res.ok) return;
      if ((res.status === 409 || res.status === 422) && i === 0){ info = await remoteGet(); continue; }
      if (res.status === 401) throw new Error('Token rejected — for a public repo, the “public_repo” scope (classic) or Contents read+write (fine-grained) is enough.');
      if (res.status === 404) throw new Error('Repository or branch not found — check the repo name and branch in settings.');
      throw new Error('Push failed (GitHub error ' + res.status + ')');
    }
    throw new Error('Push failed — the file changed on GitHub while syncing. Try again.');
  }

  function mergeSets(a, b){
    const map = new Map();
    for (const h of a) if (h && h.id) map.set(h.id, h);
    for (const h of b) if (h && h.id){
      const ex = map.get(h.id);
      if (!ex || (h.updatedAt || 0) >= (ex.updatedAt || 0)) map.set(h.id, h);
    }
    return [...map.values()];
  }

  async function doSync(mode){
    if (busy) return;
    busy = true;
    ui.syncBtn.classList.add('spin');
    try {
      if (mode === 'push'){
        if (!highlights.length) throw new Error('Nothing to push yet — highlight something first.');
        await remotePut(highlights);
        settings.lastSync = Date.now(); saveLS(LS_SETTINGS, settings);
        toast('Pushed ' + highlights.length + ' highlights to GitHub', 'check');
      } else {
        const remote = await remoteGet();
        const rdata = remote ? remote.data : [];
        if (!rdata.length && !highlights.length) throw new Error('No highlights on GitHub yet.');
        const before = highlights.length;
        highlights = mergeSets(rdata, highlights);
        persist();
        if (panelOpen) renderList();
        applyHighlights();
        const gained = highlights.length - before;
        if (mode === 'pull'){
          toast(gained > 0 ? 'Pulled ' + gained + (gained === 1 ? ' highlight' : ' highlights') + ' from GitHub' : 'Already up to date', 'check');
        } else {
          await remotePut(highlights);
          settings.lastSync = Date.now(); saveLS(LS_SETTINGS, settings);
          toast('Synced with GitHub', 'check');
        }
      }
    } catch (err){
      toast((err && err.message) || 'Something went wrong', 'alert');
    } finally {
      busy = false;
      ui.syncBtn.classList.remove('spin');
    }
  }

  /* ───────────────────────── settings / confirm ──────────────────── */
  function closeModal(){ ui.modal.classList.remove('in'); ui.modal.innerHTML = ''; }

  function openSettings(){
    const m = ui.modal;
    m.innerHTML =
      '<div class="tmhl-modal">' +
        '<h3>' + ICONS.sliders + 'GitHub backup</h3>' +
        '<p class="tmhl-sub">Saves your highlights to any GitHub repository — public or private.' +
        (settings.lastSync ? ' Last sync: ' + new Date(settings.lastSync).toLocaleString() + '.' : '') + '</p>' +
        '<div class="tmhl-field"><label>GitHub username</label><input id="ts-user" autocomplete="off" spellcheck="false" placeholder="your-username"></div>' +
        '<div class="tmhl-field"><label>Repository</label><input id="ts-repo" autocomplete="off" spellcheck="false" placeholder="my-highlights"></div>' +
        '<div class="tmhl-grid2">' +
          '<div class="tmhl-field"><label>Branch</label><input id="ts-branch" placeholder="main"></div>' +
          '<div class="tmhl-field"><label>File path</label><input id="ts-path" placeholder="highlights.json"></div>' +
        '</div>' +
        '<div class="tmhl-field"><label>Token — only needed to push</label><input id="ts-token" type="password" autocomplete="off" placeholder="ghp_…"></div>' +
        '<div class="tmhl-note"><b>Public repo?</b> Pulling needs no token at all. Pushing always needs one — that’s a GitHub rule, even for public repos. A classic token with <b>public_repo</b> scope, or a fine-grained token with <b>Contents: Read and write</b> on that repo, is all you need.</div>' +
        '<div class="tmhl-status" id="ts-status"></div>' +
        '<div class="tmhl-mfoot">' +
          '<button class="tmhl-btn ghost" data-x="test">Test</button>' +
          '<button class="tmhl-btn ghost" data-x="cancel">Cancel</button>' +
          '<button class="tmhl-btn primary" data-x="save">Save</button>' +
        '</div>' +
      '</div>';
    const q = s => m.querySelector(s);
    q('#ts-user').value = settings.ghUser;
    q('#ts-repo').value = settings.ghRepo;
    q('#ts-branch').value = settings.ghBranch || 'main';
    q('#ts-path').value = settings.ghPath || 'highlights.json';
    q('#ts-token').value = settings.ghToken;
    m.classList.add('in');
    m.onclick = e => { if (e.target === m) closeModal(); };
    const readForm = () => ({
      user: q('#ts-user').value.trim(), repo: q('#ts-repo').value.trim(),
      branch: q('#ts-branch').value.trim() || 'main',
      path: q('#ts-path').value.trim() || 'highlights.json',
      token: q('#ts-token').value.trim(),
    });
    q('[data-x="cancel"]').onclick = closeModal;
    q('[data-x="save"]').onclick = () => {
      const v = readForm();
      settings.ghUser = v.user; settings.ghRepo = v.repo; settings.ghBranch = v.branch;
      settings.ghPath = v.path; settings.ghToken = v.token;
      saveLS(LS_SETTINGS, settings);
      closeModal();
      toast('Settings saved', 'check');
    };
    q('[data-x="test"]').onclick = async () => {
      const st = q('#ts-status');
      const v = readForm();
      if (!v.user || !v.repo){ st.className = 'tmhl-status err'; st.textContent = 'Enter a username and repository first.'; return; }
      st.className = 'tmhl-status'; st.textContent = 'Checking…';
      try {
        const res = await fetch('https://api.github.com/repos/' + encodeURIComponent(v.user) + '/' + encodeURIComponent(v.repo), { headers: ghHeaders(v.token) });
        if (res.status === 404) throw new Error('Repository not found — check the spelling (or it’s private and the token is missing).');
        if (res.status === 401) throw new Error('Token rejected.');
        if (!res.ok) throw new Error('GitHub error ' + res.status + '.');
        const repo = await res.json();
        let msg = 'Connected to ' + repo.full_name + ' (' + (repo.private ? 'private' : 'public') + ').';
        const f = await fetch(
          'https://api.github.com/repos/' + encodeURIComponent(v.user) + '/' + encodeURIComponent(v.repo) +
          '/contents/' + encPath(v.path) + '?ref=' + encodeURIComponent(v.branch),
          { headers: ghHeaders(v.token) }
        );
        if (f.ok){
          const d = await f.json();
          let n = 0;
          try { const p = JSON.parse(b64decode(d.content || '')); if (Array.isArray(p)) n = p.length; } catch {}
          msg += ' ' + n + ' highlight' + (n === 1 ? '' : 's') + ' in ' + v.path + '.';
        } else if (f.status === 404){
          msg += ' No backup file yet — it gets created on your first push.';
        } else {
          msg += ' (file check: HTTP ' + f.status + ')';
        }
        st.className = 'tmhl-status ok';
        st.textContent = msg;
      } catch (err){
        st.className = 'tmhl-status err';
        st.textContent = (err && err.message) || 'Connection failed.';
      }
    };
  }

  function confirmClear(){
    if (!highlights.length) return toast('Nothing to delete', 'alert');
    const m = ui.modal;
    m.innerHTML =
      '<div class="tmhl-modal">' +
        '<h3>' + ICONS.trash + 'Delete all highlights?</h3>' +
        '<p class="tmhl-sub">This removes all ' + highlights.length + ' highlights from this browser. Anything already pushed to GitHub stays there until you push again.</p>' +
        '<div class="tmhl-mfoot">' +
          '<button class="tmhl-btn ghost" data-x="cancel">Cancel</button>' +
          '<button class="tmhl-btn danger" data-x="ok">Delete everything</button>' +
        '</div>' +
      '</div>';
    m.classList.add('in');
    m.onclick = e => { if (e.target === m) closeModal(); };
    m.querySelector('[data-x="cancel"]').onclick = closeModal;
    m.querySelector('[data-x="ok"]').onclick = () => {
      highlights = [];
      persist();
      unwrapAll();
      if (panelOpen) renderList();
      closeModal();
      toast('All highlights deleted', 'trash');
    };
  }

  /* ───────────────────────── export / import ──────────────────────── */
  function downloadFile(name, content, type){
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Download started', 'check');
  }

  function toMarkdown(){
    const groups = new Map();
    for (const h of highlights){
      const k = h.convTitle || 'Conversation';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(h);
    }
    let md = '# TypingMind Highlights\n\n' + new Date().toLocaleString() + '\n';
    for (const entry of groups){
      md += '\n## ' + entry[0] + '\n\n';
      const arr = entry[1].slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      for (const h of arr) md += '> ' + String(h.text || '').replace(/\n/g, '\n> ') + '\n\n';
    }
    return md;
  }

  function handleImport(){
    const f = ui.file.files && ui.file.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const arr = JSON.parse(rd.result);
        if (!Array.isArray(arr)) throw new Error();
        const clean = arr.filter(h => h && h.id && typeof h.text === 'string');
        const before = highlights.length;
        highlights = mergeSets(highlights, clean);
        persist();
        if (panelOpen) renderList();
        applyHighlights();
        const gained = highlights.length - before;
        toast(gained > 0 ? 'Imported ' + gained + (gained === 1 ? ' highlight' : ' highlights') : 'Nothing new to import', 'check');
      } catch {
        toast('That file isn’t a valid highlights backup', 'alert');
      }
      ui.file.value = '';
    };
    rd.readAsText(f);
  }

  /* ───────────────────────── events ───────────────────────────────── */
  function wireEvents(){
    ui.scrim.addEventListener('click', closePanel);
    ui.closeBtn.addEventListener('click', closePanel);
    ui.syncBtn.addEventListener('click', () => doSync('sync'));
    ui.menuBtn.addEventListener('click', toggleMenu);
    ui.q.addEventListener('input', renderList);
    ui.seg.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      filterMode = b.dataset.f;
      ui.seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      renderList();
    });

    ui.menu.addEventListener('click', e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      closeMenu();
      const a = b.dataset.act;
      if (a === 'sync') doSync('sync');
      else if (a === 'pull') doSync('pull');
      else if (a === 'push') doSync('push');
      else if (a === 'export-json') downloadFile('typingmind-highlights-' + dateStamp() + '.json', JSON.stringify(highlights, null, 2), 'application/json');
      else if (a === 'export-md') downloadFile('typingmind-highlights-' + dateStamp() + '.md', toMarkdown(), 'text/markdown');
      else if (a === 'import') ui.file.click();
      else if (a === 'settings') openSettings();
      else if (a === 'clear') confirmClear();
    });
    document.addEventListener('pointerdown', e => {
      if (!ui.menu.classList.contains('open')) return;
      if (e.target.closest('#tmhl-menu') || e.target.closest('#tmhl-b-menu')) return;
      closeMenu();
    }, true);

    document.addEventListener('selectionchange', () => {
      clearTimeout(selT);
      selT = setTimeout(checkSelection, 160);
    });
    ui.selbar.addEventListener('pointerdown', e => e.preventDefault()); /* keeps the selection alive on tap */
    window.addEventListener('scroll', hideSelbar, true);
    window.addEventListener('resize', () => { hideSelbar(); closeMenu(); setFabXY(ui.fab.offsetLeft, ui.fab.offsetTop); });

    /* floater: drag to move, tap to open */
    let drag = null;
    ui.fab.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: ui.fab.offsetLeft, oy: ui.fab.offsetTop, moved: false };
      try { ui.fab.setPointerCapture(e.pointerId); } catch {}
      wakeFab();
    });
    ui.fab.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (!drag.moved && Math.hypot(dx, dy) > 7){ drag.moved = true; ui.fab.classList.add('dragging'); }
      if (drag.moved) setFabXY(drag.ox + dx, drag.oy + dy);
    });
    const endDrag = e => {
      if (!drag || e.pointerId !== drag.id) return;
      const moved = drag.moved;
      drag = null;
      ui.fab.classList.remove('dragging');
      if (!moved){ togglePanel(); return; }
      ui.fab.classList.add('snapping');
      const s = ui.fab.offsetWidth;
      const x = (ui.fab.offsetLeft + s / 2) < window.innerWidth / 2 ? 10 : window.innerWidth - s - 10;
      setFabXY(x, ui.fab.offsetTop);
      saveLS(LS_FAB, { x: ui.fab.offsetLeft, y: ui.fab.offsetTop });
      setTimeout(() => ui.fab.classList.remove('snapping'), 320);
    };
    ui.fab.addEventListener('pointerup', endDrag);
    ui.fab.addEventListener('pointercancel', e => {
      if (drag && e.pointerId === drag.id){ drag = null; ui.fab.classList.remove('dragging'); }
    });
    ui.fab.addEventListener('pointerenter', wakeFab);
    ui.fab.addEventListener('contextmenu', e => e.preventDefault());
    ui.fab.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePanel(); } });

    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (ui.menu.classList.contains('open')) closeMenu();
      else if (ui.modal.classList.contains('in')) closeModal();
      else if (panelOpen) closePanel();
    });

    ui.file.addEventListener('change', handleImport);

    /* keyboard awareness (phones) */
    if (window.visualViewport){
      const vv = window.visualViewport;
      const onVV = () => {
        const kb = (window.innerHeight - vv.height) > 140;
        ui.fab.classList.toggle('kb', kb);
        if (panelOpen) ui.panel.style.height = kb ? vv.height + 'px' : '';
      };
      vv.addEventListener('resize', onVV);
      onVV();
    }

    /* re-apply highlights whenever TypingMind re-renders messages */
    new MutationObserver(debounce(applyHighlights, 400))
      .observe(document.documentElement, { childList: true, subtree: true, characterData: true });

    /* re-apply when switching conversations */
    let lastPath = location.pathname;
    setInterval(() => {
      if (location.pathname !== lastPath){
        lastPath = location.pathname;
        setTimeout(applyHighlights, 500);
      }
    }, 600);
  }

  /* ───────────────────────── boot ────────────────────────────────── */
  function boot(){
    document.body.appendChild(root);
    Object.assign(ui, {
      fab:     root.querySelector('#tmhl-fab'),
      badge:   root.querySelector('#tmhl-badge'),
      scrim:   root.querySelector('#tmhl-scrim'),
      panel:   root.querySelector('#tmhl-panel'),
      list:    root.querySelector('#tmhl-list'),
      empty:   root.querySelector('#tmhl-empty'),
      count:   root.querySelector('#tmhl-count'),
      q:       root.querySelector('#tmhl-q'),
      seg:     root.querySelector('#tmhl-seg'),
      syncBtn: root.querySelector('#tmhl-b-sync'),
      menuBtn: root.querySelector('#tmhl-b-menu'),
      closeBtn:root.querySelector('#tmhl-b-close'),
      menu:    root.querySelector('#tmhl-menu'),
      selbar:  root.querySelector('#tmhl-selbar'),
      toasts:  root.querySelector('#tmhl-toasts'),
      modal:   root.querySelector('#tmhl-modal-scrim'),
      file:    root.querySelector('#tmhl-file'),
    });
    buildSelbar();
    initFab();
    wakeFab();
    wireEvents();
    updateBadges();
    setTimeout(applyHighlights, 900);
    setTimeout(applyHighlights, 2600);
    const jump = sessionStorage.getItem(SS_JUMP);
    if (jump){
      sessionStorage.removeItem(SS_JUMP);
      setTimeout(() => tryScrollTo(jump), 1400);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
