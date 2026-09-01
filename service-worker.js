const VERSION = "8a1";
const OFFLINE_CACHE = `upm-shs-offline-${VERSION}`;
const CODE_CACHE = `upm-shs-code-${VERSION}`;
const IMAGE_CACHE = `upm-shs-images-${VERSION}`;

const OFFLINE_SHELL = [
  "./field-forms.html",
  "./household-survey.html",
  "./dynamic-form.html",
  "./styles.css",
  "./form-engine.css",
  "./offline-db.js",
  "./form-engine.js",
  "./field-forms.js",
  "./household-survey.js",
  "./dynamic-form.js",
  "./supabase-config.js",
  "./manifest.webmanifest"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(OFFLINE_CACHE).then(cache =>
      Promise.allSettled(OFFLINE_SHELL.map(url => cache.add(url)))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key =>
            (
              key.startsWith("upm-shs-fieldwork") ||
              key.startsWith("upm-shs-offline-") ||
              key.startsWith("upm-shs-code-") ||
              key.startsWith("upm-shs-images-")
            ) &&
            ![OFFLINE_CACHE, CODE_CACHE, IMAGE_CACHE].includes(key)
          )
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

function timeout(ms) {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error("network timeout")), ms)
  );
}

async function putIfUsable(cacheName, request, response) {
  if (!response || !response.ok || response.type === "opaque") return response;
  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
  return response;
}

async function networkFirst(request, cacheName, timeoutMs = 2800) {
  const cached = await caches.match(request);
  try {
    const response = await Promise.race([fetch(request), timeout(timeoutMs)]);
    return await putIfUsable(cacheName, request, response);
  } catch {
    if (cached) return cached;
    throw new Error("network and cache unavailable");
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cached = await caches.match(request);
  const update = fetch(request)
    .then(response => putIfUsable(cacheName, request, response))
    .catch(() => null);
  return cached || update;
}

async function cacheFirstImage(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  return putIfUsable(IMAGE_CACHE, request, response);
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // HTML: prefer fresh code while online, cached page when weak/offline.
  if (request.mode === "navigate") {
    event.respondWith(
      networkFirst(request, CODE_CACHE, 3200).catch(async () => {
        const exact = await caches.match(request);
        if (exact) return exact;

        if (url.pathname.endsWith("household-survey.html")) {
          return caches.match("./household-survey.html");
        }
        if (url.pathname.endsWith("dynamic-form.html")) {
          return caches.match("./dynamic-form.html");
        }
        if (url.pathname.endsWith("field-forms.html")) {
          return caches.match("./field-forms.html");
        }

        return new Response(
          "<!doctype html><meta charset='utf-8'><title>Offline</title><p>The Toolkit page is not cached on this device yet. Reconnect and open it once before offline use.</p>",
          { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 503 }
        );
      })
    );
    return;
  }

  // JS/CSS: fresh online, cached fallback. Fixes long-lived stale-code problems.
  if (request.destination === "script" || request.destination === "style") {
    event.respondWith(networkFirst(request, CODE_CACHE, 2600).catch(() => caches.match(request)));
    return;
  }

  // Same-origin images: cache-first because branding imagery is version-stable.
  if (request.destination === "image") {
    event.respondWith(cacheFirstImage(request).catch(() => caches.match(request)));
    return;
  }

  // Other same-origin static files: instant cached response with background refresh.
  event.respondWith(staleWhileRevalidate(request, CODE_CACHE));
});
