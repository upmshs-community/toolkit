const CACHE_NAME = "upm-shs-fieldwork-v2";
const APP_SHELL = [
  "./field-forms.html","./household-survey.html","./dynamic-form.html",
  "./styles.css","./form-engine.css","./offline-db.js","./form-engine.js",
  "./field-forms.js","./household-survey.js","./dynamic-form.js",
  "./supabase-config.js","./assets/shs-logo.png","./assets/up-upm-branding.png",
  "./manifest.webmanifest"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache =>
    Promise.allSettled(APP_SHELL.map(url => cache.add(url)))
  ));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k !== CACHE_NAME && k.startsWith("upm-shs-fieldwork"))
      .map(k => caches.delete(k))
  )));
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  if (req.mode === "navigate" && sameOrigin) {
    event.respondWith(fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
      return res;
    }).catch(async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      if (url.pathname.endsWith("household-survey.html")) return caches.match("./household-survey.html");
      if (url.pathname.endsWith("dynamic-form.html")) return caches.match("./dynamic-form.html");
      return caches.match("./field-forms.html");
    }));
    return;
  }

  if (sameOrigin) {
    event.respondWith(caches.match(req).then(cached => cached || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
      return res;
    })));
  }
});
