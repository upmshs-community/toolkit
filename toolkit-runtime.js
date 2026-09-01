(() => {
  const SW_URL = "./service-worker.js?v=8a1";
  const UPDATE_KEY = "toolkit-sw-last-update-v8a1";
  const SIX_HOURS = 6 * 60 * 60 * 1000;

  function connectionAllowsPrefetch() {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!connection) return true;
    if (connection.saveData) return false;
    return !["slow-2g","2g"].includes(String(connection.effectiveType || "").toLowerCase());
  }

  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    if (!/^https?:$/.test(location.protocol)) return;

    try {
      const registration = await navigator.serviceWorker.register(SW_URL, { scope: "./" });

      const last = Number(localStorage.getItem(UPDATE_KEY) || 0);
      if (Date.now() - last > SIX_HOURS) {
        localStorage.setItem(UPDATE_KEY, String(Date.now()));
        registration.update().catch(() => {});
      }
    } catch (error) {
      console.warn("[Toolkit runtime] Service worker registration failed.", error);
    }
  }

  function scheduleRegistration() {
    if ("requestIdleCallback" in window) {
      requestIdleCallback(() => registerServiceWorker(), { timeout: 1800 });
    } else {
      window.addEventListener("load", () => setTimeout(registerServiceWorker, 250), { once: true });
    }
  }

  function warmInternalLink(anchor) {
    if (!connectionAllowsPrefetch() || !navigator.onLine) return;
    if (!anchor?.href || anchor.dataset.prefetched === "1") return;

    let url;
    try { url = new URL(anchor.href, location.href); }
    catch { return; }

    if (url.origin !== location.origin) return;
    if (!/\.html(?:$|\?|\#)/i.test(url.pathname + url.search + url.hash)) return;

    anchor.dataset.prefetched = "1";
    fetch(url.href, { credentials: "same-origin", cache: "default" }).catch(() => {});
  }

  function enableIntentPrefetch() {
    if (!connectionAllowsPrefetch()) return;

    let timer = null;
    document.addEventListener("pointerover", event => {
      const anchor = event.target.closest?.("a[href]");
      if (!anchor) return;
      clearTimeout(timer);
      timer = setTimeout(() => warmInternalLink(anchor), 120);
    }, { passive: true });

    document.addEventListener("focusin", event => {
      const anchor = event.target.closest?.("a[href]");
      if (anchor) warmInternalLink(anchor);
    });
  }

  scheduleRegistration();
  enableIntentPrefetch();
})();
