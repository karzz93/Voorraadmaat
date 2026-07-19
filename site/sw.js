const CACHE_VERSION =
  'voorraadmaat-v4.0.0';

const APP_SHELL = [
  '',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'js/app.js',
  'js/core.js',
  'js/recipes.js',
  'js/deals-api.js',
  'js/deals-engine.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener(
  'install',
  (event) => {
    event.waitUntil(
      (async () => {
        const cache =
          await caches.open(
            CACHE_VERSION
          );

        await cache.addAll(
          APP_SHELL.map(
            (filePath) =>
              new URL(
                filePath,
                self.registration.scope
              ).href
          )
        );

        await self.skipWaiting();
      })()
    );
  }
);

self.addEventListener(
  'activate',
  (event) => {
    event.waitUntil(
      (async () => {
        const keys =
          await caches.keys();

        await Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith(
                  'voorraadmaat-'
                ) &&
                key !==
                  CACHE_VERSION
            )
            .map(
              (key) =>
                caches.delete(key)
            )
        );

        await self.clients.claim();
      })()
    );
  }
);

self.addEventListener(
  'fetch',
  (event) => {
    const request =
      event.request;

    if (
      request.method !== 'GET'
    ) {
      return;
    }

    const url =
      new URL(request.url);

    /*
     * The Cloudflare Worker requests must not
     * be cached by this service worker.
     */
    if (
      url.origin !==
      self.location.origin
    ) {
      return;
    }

    if (
      request.mode ===
      'navigate'
    ) {
      event.respondWith(
        networkFirstNavigation(
          request
        )
      );

      return;
    }

    /*
     * JavaScript should always be checked online
     * first so updates are received quickly.
     */
    if (
      url.pathname.endsWith(
        '.js'
      )
    ) {
      event.respondWith(
        networkFirst(request)
      );

      return;
    }

    event.respondWith(
      networkFirst(request)
    );
  }
);

async function networkFirstNavigation(
  request
) {
  try {
    const response =
      await fetch(
        request,
        {
          cache: 'no-store',
        }
      );

    if (response.ok) {
      const cache =
        await caches.open(
          CACHE_VERSION
        );

      await cache.put(
        new URL(
          'index.html',
          self.registration.scope
        ).href,

        response.clone()
      );
    }

    return response;
  } catch {
    return (
      await caches.match(
        new URL(
          'index.html',
          self.registration.scope
        ).href
      )
    ) || Response.error();
  }
}

async function networkFirst(
  request
) {
  try {
    const response =
      await fetch(
        request,
        {
          cache: 'no-store',
        }
      );

    if (response.ok) {
      const cache =
        await caches.open(
          CACHE_VERSION
        );

      await cache.put(
        request,
        response.clone()
      );
    }

    return response;
  } catch {
    return (
      await caches.match(
        request
      )
    ) || Response.error();
  }
}
