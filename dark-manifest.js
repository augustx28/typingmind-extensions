/* == TypingMind | Dark Navigation Bar Strip ====================================
 * Turns the white strip behind Android's navigation buttons dark in the
 * installed app.
 *
 * Chrome paints that strip with the background_color from TypingMind's
 * manifest (#ffffff) and bakes it into the installed app. Chrome rebuilds the
 * installed app when the manifest's colours change, and it recognises the app
 * by start_url, not by where the manifest lives. So this:
 * - points the page at dark-manifest.json, a copy of TypingMind's manifest
 *   with #191919 colours and absolute URLs
 * - patches any copy of manifest.json in the app's offline cache, in case
 *   Chrome reads the manifest before this script runs
 * Chrome checks the manifest at most once a day, when the app opens, then
 * rebuilds the app once the phone is charging on Wi-Fi.
 * Uninstall the extension and the next check switches the strip back to white.
 * ============================================================================ */

(() => {
  'use strict';

  if (window.__tmxDarkManifestInstalled) return;
  window.__tmxDarkManifestInstalled = true;

  const ORIGIN = 'https://www.typingmind.com';
  const DARK_MANIFEST =
    'https://cdn.jsdelivr.net/gh/augustx28/typingmind-extensions@ccr-6ec2f684-ixsiq6/dark-manifest.json';
  const CACHE_PATCH_DELAY_MS = 5000;

  // dark-manifest.json hardcodes www.typingmind.com URLs, so it would be a
  // different app anywhere else.
  if (location.origin !== ORIGIN) return;

  const swap = () => {
    if (!document.head) return;
    let links = document.head.querySelectorAll('link[rel~="manifest"]');
    if (!links.length) {
      const link = document.createElement('link');
      link.rel = 'manifest';
      document.head.appendChild(link);
      links = [link];
    }
    for (const link of links) {
      if (link.getAttribute('href') !== DARK_MANIFEST) {
        link.setAttribute('href', DARK_MANIFEST);
      }
      // With credentials, the CDN's wildcard CORS header is rejected.
      if (link.hasAttribute('crossorigin')) link.removeAttribute('crossorigin');
    }
  };

  const isManifestUrl = (url) => {
    const u = new URL(url);
    return u.origin === ORIGIN && u.pathname === '/manifest.json';
  };

  const patchCaches = async () => {
    if (!window.caches) return;
    const res = await fetch(DARK_MANIFEST, { cache: 'no-cache' });
    if (!res.ok) return;
    const body = await res.text();
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const req of await cache.keys()) {
        if (!isManifestUrl(req.url)) continue;
        const old = await cache.match(req);
        if (old && (await old.text()) === body) continue;
        await cache.put(
          req,
          new Response(body, {
            status: 200,
            headers: { 'Content-Type': 'application/manifest+json' },
          })
        );
      }
    }
  };

  // Run right away: Chrome reads the manifest as soon as the page finishes
  // loading.
  swap();

  // Next.js can re-render <head> and restore the original link.
  new MutationObserver(swap).observe(document.head || document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['href', 'rel', 'crossorigin'],
  });

  setTimeout(() => {
    patchCaches().catch((err) => console.warn('[dark-manifest] cache patch failed', err));
  }, CACHE_PATCH_DELAY_MS);
})();
