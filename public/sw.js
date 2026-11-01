// Cal's service worker: caches the app shell only.
//
//   - Build assets (/_next/static/, hashed and immutable), icons and the manifest: cache first.
//   - Page navigations: always from the network; when offline, the cached /offline page.
//   - Everything else, above all /api/ (meal data and photos of whoever is signed in): never
//     cached here, so nothing personal outlives a sign-out on a shared device.
//
// Bump VERSION to drop old caches after a change to this file.
const VERSION = "v3";
const SHELL_CACHE = `cal-shell-${VERSION}`;
const OFFLINE_URL = "/offline";
const PRECACHE = [OFFLINE_URL, "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("cal-") && key !== SHELL_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

const isShellAsset = (url) =>
  url.origin === self.location.origin &&
  (url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest");

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // never cached

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => (await caches.match(OFFLINE_URL)) ?? Response.error()),
    );
    return;
  }

  if (isShellAsset(url)) {
    event.respondWith(
      caches.open(SHELL_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok && response.type === "basic") cache.put(request, response.clone());
        return response;
      }),
    );
  }
});

// ---- Background Sync: meals waiting on the device ----
// The app keeps meals that could not be uploaded yet in IndexedDB (lib/client/capture-queue.ts;
// keep the names and record shape in step). Where the browser supports Background Sync, the page
// registers SYNC_TAG and the browser wakes this worker when a connection is back. Meals go up only
// into the account that took them, and the server ignores repeats of the same clientId.
const QUEUE_DB = "cal-capture";
const QUEUE_STORE = "meals";
const SYNC_TAG = "cal-upload-queue";

const openQueue = () =>
  new Promise((resolve) => {
    const req = indexedDB.open(QUEUE_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(QUEUE_STORE))
        req.result.createObjectStore(QUEUE_STORE, { keyPath: "clientId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });

const inQueue = (db, mode, run) =>
  new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, mode);
    const req = run(tx.objectStore(QUEUE_STORE));
    let result;
    req.onsuccess = () => {
      result = req.result;
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });

const sendQueued = async () => {
  const me = await fetch("/api/me", { credentials: "same-origin", cache: "no-store" });
  if (!me.ok) return; // Signed out: the meals wait for their owner.
  const { id } = await me.json();
  const db = await openQueue();
  if (!db) return;
  let changed = false;
  try {
    for (const meal of await inQueue(db, "readonly", (s) => s.getAll())) {
      if (meal.userId !== id || meal.state !== "waiting" || meal.nextAttemptAt > Date.now())
        continue;
      const form = new FormData();
      meal.photos.forEach((photo, i) =>
        form.append("photos", new Blob([photo.data], { type: photo.type }), `photo-${i + 1}.jpg`),
      );
      form.set("eatenAt", meal.eatenAt);
      form.set("tz", meal.tz);
      form.set("clientId", meal.clientId);
      if (meal.note) form.set("note", meal.note);
      // A network error throws here, and the browser runs the sync again later.
      const response = await fetch("/api/meals", {
        method: "POST",
        body: form,
        credentials: "same-origin",
      });
      if (response.ok) {
        await inQueue(db, "readwrite", (s) => s.delete(meal.clientId));
        changed = true;
      } else if (response.status === 401) {
        return;
      } else if (response.status === 408 || response.status === 429 || response.status >= 500) {
        throw new Error("The server is busy; the browser tries again later.");
      } else {
        const body = await response.json().catch(() => null);
        await inQueue(db, "readwrite", (s) =>
          s.put({
            ...meal,
            state: "failed",
            attempts: meal.attempts + 1,
            error: (body && body.error) || "The upload was refused.",
          }),
        );
        changed = true;
      }
    }
  } finally {
    db.close();
    if (changed)
      for (const client of await self.clients.matchAll({ type: "window" }))
        client.postMessage({ type: "cal-queue-changed" });
  }
};

self.addEventListener("sync", (event) => {
  if (event.tag !== SYNC_TAG) return;
  const locks = self.navigator && self.navigator.locks;
  // The same lock as the page's uploader, so a meal is not sent twice at once.
  event.waitUntil(
    locks && locks.request ? locks.request(SYNC_TAG, () => sendQueued()) : sendQueued(),
  );
});

// Notifications (lib/push/service.ts sends them, encrypted for this device): "analysis ready" and
// "a question about your meal". The payload is {title, body, url, tag}; a tap opens the meal in
// an open Cal window, or a new one. Only same-origin paths are opened.
const safePath = (url) => {
  try {
    const target = new URL(url, self.location.origin);
    return target.origin === self.location.origin ? target.pathname + target.search : "/today";
  } catch {
    return "/today";
  }
};

self.addEventListener("push", (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    message = {};
  }
  const title = typeof message.title === "string" ? message.title : "Cal";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof message.body === "string" ? message.body : "",
      tag: typeof message.tag === "string" ? message.tag : undefined,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: safePath(message.url || "/today") },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = safePath(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        if ("navigate" in client) await client.navigate(path).catch(() => undefined);
        return;
      }
      await self.clients.openWindow(path);
    })(),
  );
});
