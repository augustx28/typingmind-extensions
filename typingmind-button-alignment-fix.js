/* =====================================================================
   TypingMind — Tweaks + Drive Sync workspace-bar alignment fix
   =====================================================================

   Apply PART A to your Tweaks extension and PART B to your Drive Sync
   extension. Both parts are required: Part A fixes the Tweaks button's
   markup, Part B retires the shim that was compensating for it.

   Resulting tab order, regardless of which script loads first:

        … | Drive Sync | Tweaks | Settings

   ===================================================================== */


/* =====================================================================
   PART A — TWEAKS EXTENSION
   ---------------------------------------------------------------------
   In the "Workspace bar 'Tweaks' button" section, delete the existing
   getReferenceButton() and syncTweaksButton() functions and paste this
   block in their place.
   ===================================================================== */

  const SVG_NS = "http://www.w3.org/2000/svg";
  const TWEAKS_ICON_PATH =
    "M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4c-.83 0-1.5-.67-1.5-1.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z";

  /**
   * Pick a tab to copy. Only ever a native TypingMind tab — mirroring another
   * extension's button copies its mistakes. An inactive tab is preferred so we
   * never inherit selected-state styling from nested elements.
   */
  function getReferenceButton(workspaceBar) {
    const tabs = Array.from(
      workspaceBar.querySelectorAll('button[data-element-id^="workspace-tab-"]')
    ).filter((b) => !/tweaks|drivesync/.test(b.dataset.elementId || ""));
    if (!tabs.length) return null;

    const inactive = tabs.filter((b) => !/(^|\s)bg-white\/20(\s|$)/.test(b.className));
    const pool = inactive.length ? inactive : tabs;

    for (const id of ["workspace-tab-settings", "workspace-tab-chat", "workspace-tab-cloudsync"]) {
      const hit = pool.find((b) => b.dataset.elementId === id);
      if (hit) return hit;
    }
    return pool[0];
  }

  /**
   * TypingMind renders a tab as:
   *   <button><span>[icon wrapper]<svg/></span><span>Label</span></button>
   * The old code grabbed the *first* span — the icon wrapper — and put its
   * classes on the label. Find the span that actually holds the text instead.
   */
  function tabLabelSpan(button) {
    return (
      Array.from(button.querySelectorAll("span")).find(
        (s) => !s.querySelector("svg") && s.textContent && s.textContent.trim()
      ) || null
    );
  }

  /** Swap TypingMind's selected/unselected utility classes without touching the rest. */
  function normalizeTabClass(className, active) {
    const tokens = String(className || "").split(/\s+/).filter(Boolean);
    const looksActive = tokens.includes("bg-white/20");
    const out = [];
    for (const t of tokens) {
      if (active && !looksActive) {
        if (t === "sm:hover:bg-white/20" || t === "hover:bg-white/20") { out.push("bg-white/20"); continue; }
        if (t === "text-white/70") { out.push("text-white"); continue; }
      } else if (!active && looksActive) {
        if (t === "bg-white/20") { out.push("sm:hover:bg-white/20"); continue; }
        if (t === "text-white") { out.push("text-white/70"); continue; }
      }
      out.push(t);
    }
    return Array.from(new Set(out)).join(" ");
  }

  /**
   * Clone a real tab rather than hand-assembling one. This is the whole fix:
   * we inherit the exact wrapper elements, responsive classes and type scale
   * TypingMind uses, so the tab shrinks, wraps and hides its label on a phone
   * the same way every native tab does.
   */
  function buildTweaksButton(reference, active) {
    const btn = reference.cloneNode(true);

    btn.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
    Array.from(btn.attributes).forEach((attr) => {
      if (/^(id|aria-controls|aria-selected|aria-current|data-state|data-headlessui-state)$/.test(attr.name)) {
        btn.removeAttribute(attr.name);
      }
    });

    btn.id = "workspace-tab-tweaks";
    btn.type = "button";
    btn.setAttribute("data-element-id", "workspace-tab-tweaks");
    btn.setAttribute("aria-label", "Open UI Tweaks");
    btn.title = "Open UI Tweaks (Shift+Alt+T or Shift+Cmd+T)";
    btn.className = normalizeTabClass(reference.className, active);

    if (reference.hasAttribute("data-tooltip-content")) {
      btn.setAttribute("data-tooltip-content", "Tweaks");
    } else {
      btn.removeAttribute("data-tooltip-content");
    }

    const svg = btn.querySelector("svg");
    if (svg) {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("fill", "currentColor");
      svg.removeAttribute("stroke");
      svg.removeAttribute("stroke-width");
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", TWEAKS_ICON_PATH);
      svg.appendChild(path);
    }

    // If the reference has no visible label (collapsed rail), neither do we.
    const label = tabLabelSpan(btn);
    if (label) label.textContent = "Tweaks";

    // Drop anything else the clone carried in, e.g. an unread badge.
    Array.from(btn.querySelectorAll("span")).forEach((s) => {
      if (s !== label && !s.querySelector("svg") && s.textContent && s.textContent.trim()) s.remove();
    });

    return btn;
  }

  /** Deterministic slot, whichever extension mounted first. */
  function placeTweaksButton(workspaceBar, btn) {
    const sync = workspaceBar.querySelector('button[data-element-id="workspace-tab-drivesync"]');
    const settings = workspaceBar.querySelector('button[data-element-id="workspace-tab-settings"]');
    if (sync && sync.parentNode) {
      sync.parentNode.insertBefore(btn, sync.nextSibling);
    } else if (settings && settings.parentNode) {
      settings.parentNode.insertBefore(btn, settings);
    } else {
      const anyTab = workspaceBar.querySelector('button[data-element-id^="workspace-tab-"]');
      if (anyTab && anyTab.parentNode) anyTab.parentNode.appendChild(btn);
    }
  }

  function syncTweaksButton() {
    const workspaceBar = document.querySelector('div[data-element-id="workspace-bar"]');
    if (!workspaceBar) return;
    const reference = getReferenceButton(workspaceBar);
    if (!reference) return;

    const active = !!(modalOverlay && window.getComputedStyle(modalOverlay).display !== "none");
    const refLabel = tabLabelSpan(reference);
    const refSvg = reference.querySelector("svg");

    // Rebuild only when TypingMind's own markup actually changes (theme swap,
    // breakpoint, collapsed rail) instead of on every animation frame.
    const signature = [
      reference.dataset.elementId || "",
      reference.className,
      refLabel ? refLabel.className : "(none)",
      refSvg ? refSvg.getAttribute("class") || "" : "(none)",
      reference.childElementCount,
      active ? "1" : "0",
    ].join("|");

    let btn = document.getElementById("workspace-tab-tweaks");
    if (!btn || btn.dataset.tweaksSig !== signature) {
      const fresh = buildTweaksButton(reference, active);
      fresh.dataset.tweaksSig = signature;
      fresh.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleModal(true);
      });
      if (btn && btn.parentNode) btn.replaceWith(fresh);
      else placeTweaksButton(workspaceBar, fresh);
      btn = fresh;
    }

    const svg = btn.querySelector("svg");
    if (svg) {
      svg.style.color = getSetting(settingsKeys.workspaceIconColor, defaultWorkspaceIconColorVisual);
    }
  }


/* ---------------------------------------------------------------------
   PART A2 (optional, Tweaks) — "Hide Teams" leaves a gap behind
   ---------------------------------------------------------------------
   Tailwind's space-x-* utility keys off the `hidden` ATTRIBUTE, not
   computed display, so a display:none tab still contributes its sibling
   margin. In applyStylesBasedOnSettings(), replace:

       if (teamsButton) teamsButton.style.display = hideTeams ? "none" : "";

   with:
--------------------------------------------------------------------- */

    if (teamsButton) {
      teamsButton.style.display = hideTeams ? "none" : "";
      teamsButton.toggleAttribute("hidden", !!hideTeams);
    }


/* =====================================================================
   PART B — DRIVE SYNC EXTENSION
   ===================================================================== */

/* ---------------------------------------------------------------------
   B1 (required) — retire the Tweaks shim.
   Replace the whole applyTweaksCompat() method with this.

   The shim's `overflow-wrap:anywhere` + `min-width:0` removed the Tweaks
   tab's min-content floor, so on a narrow bar it shrank past every other
   tab and collided with Settings. With Part A applied, the Tweaks label
   already carries TypingMind's own classes and needs no help.
--------------------------------------------------------------------- */

    applyTweaksCompat() {
      // Clear the stylesheet older versions of this script left behind.
      const stale = document.getElementById("tmds-compat");
      if (stale) stale.remove();
    },


/* ---------------------------------------------------------------------
   B2 (required) — deterministic slot. In mount(), replace:

       if (settings) settings.parentNode.insertBefore(btn, settings);
       else anchor.parentNode.insertBefore(btn, anchor.nextSibling);

   with:
--------------------------------------------------------------------- */

      const tweaksTab = document.getElementById("workspace-tab-tweaks");
      if (tweaksTab && tweaksTab.parentNode) tweaksTab.parentNode.insertBefore(btn, tweaksTab);
      else if (settings) settings.parentNode.insertBefore(btn, settings);
      else anchor.parentNode.insertBefore(btn, anchor.nextSibling);


/* ---------------------------------------------------------------------
   B3 (recommended) — use TypingMind's own icon wrapper instead of a
   hard-coded div, so the Sync icon sits on the same baseline as the rest.
   In renderButton(), replace everything from `const refSvg = …` down to
   the end of the `const html = …` assignment with this.
--------------------------------------------------------------------- */

      const refSvg = tpl.querySelector("svg");
      const refSpan = Array.from(tpl.querySelectorAll("span")).find(
        (s) => !s.querySelector("svg") && s.textContent && s.textContent.trim()
      );
      const refWrap =
        refSvg && refSvg.parentElement && refSvg.parentElement !== tpl ? refSvg.parentElement : null;
      const wrapClass = (refWrap?.getAttribute("class") || "relative flex flex-shrink-0").replace(/"/g, "");
      const svgClass = (refSvg?.getAttribute("class") || "w-4 h-4 flex-shrink-0").replace(/"/g, "");
      const spanClass = (refSpan?.getAttribute("class") || "").replace(/"/g, "");

      const html =
        `<span class="${wrapClass}" style="position:relative">` +
        `<svg class="${svgClass}" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
        `<g stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">` +
        `<path d="M10 4.5a5.5 5.5 0 0 1 5.24 3.83"/>` +
        `<path d="M10 15.5a5.5 5.5 0 0 1-5.24-3.83"/>` +
        `<polyline points="12.6,4.2 15.5,4.6 15.1,7.5"/>` +
        `<polyline points="7.4,15.8 4.5,15.4 4.9,12.5"/>` +
        `</g></svg>` +
        `<span id="tmds-dot"></span></span>` +
        (refSpan ? `<span class="${spanClass}">Sync</span>` : "");
