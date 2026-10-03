// Hand-written service worker: offline app shell + asset cache. User data is in MongoDB via server actions (POSTs, which this ignores).
// ponytail: no precache manifest of build chunks; a page's JS is cached the first time it loads online
// (Link prefetching covers most of the app). Switch to Serwist if full first-install offline matters.
const CACHE = "mathme-v1";
const PAGES = ["/", "/start", "/start/easy", "/start/medium", "/start/hard", "/start/expert", "/practice", "/history", "/stats", "/words", "/words/collection", "/words/settings"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PAGES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

// Clone synchronously: once the page starts reading the body, it can no longer be cloned.
const store = (request) => (res) => {
  if (res.ok) {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(request, copy));
  }
  return res;
};

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // Build assets are content-hashed and immutable: cache first.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(caches.match(request).then((hit) => hit ?? fetch(request).then(store(request))));
    return;
  }

  // Everything else (pages, RSC payloads, icons): network first so deploys show up, cache as offline fallback.
  // Navigations ignore the query string so /practice?mode=… falls back to the cached /practice shell.
  event.respondWith(
    fetch(request)
      .then(store(request))
      .catch(() =>
        caches.match(request, { ignoreSearch: request.mode === "navigate" }).then((hit) => hit ?? Response.error()),
      ),
  );
});
