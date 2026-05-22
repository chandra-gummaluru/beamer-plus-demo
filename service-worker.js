const CACHE_NAME = 'beamer-plus-v6';
const STATIC_CACHE_NAME = 'beamer-plus-static-v6';
const DYNAMIC_CACHE_NAME = 'beamer-plus-dynamic-v6';

// Static assets to cache immediately
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/viewer.html',
  '/offline.html',
  '/static/css/shared.css',
  '/static/css/control-panel.css',
  '/static/css/button.css',
  '/static/css/selector.css',
  '/static/css/label.css',
  '/static/css/toggle.css',
  '/static/css/canvas.css',
  '/static/css/timer.css',
  '/static/css/modal.css',
  '/static/css/splash.css',
  '/static/js/main.js',
  '/static/js/beamer_ui.js',
  '/static/js/beamer_modal.js',
  '/static/js/button.js',
  '/static/js/canvas.js',
  '/static/js/events.js',
  '/static/js/iframe-widget-renderer.js',
  '/static/js/label.js',
  '/static/js/modal.js',
  '/static/js/selector.js',
  '/static/js/timer.js',
  '/static/js/toggle.js',
  '/manifest.json',
  '/static/icons/icon-192x192.png',
  '/static/icons/icon-512x512.png'
];

// CDN assets to cache (optional - cache on first use instead)
const CDN_ASSETS = [
  'https://cdn.socket.io/4.7.2/socket.io.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.0/jszip.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js',
  'https://cdn.jsdelivr.net/npm/marked/marked.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing...');
  
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Caching static assets');
        // Cache assets one by one to avoid failing the entire install
        return Promise.allSettled(
          STATIC_ASSETS.map(url => 
            cache.add(url).catch(err => {
              console.warn(`[Service Worker] Failed to cache ${url}:`, err.message);
              return null;
            })
          )
        );
      })
      .then(() => {
        console.log('[Service Worker] Static assets cached, skipping waiting');
        return self.skipWaiting();
      })
      .catch(err => {
        console.error('[Service Worker] Installation failed:', err);
        throw err;
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating...');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((cacheName) => {
            return cacheName !== STATIC_CACHE_NAME && 
                   cacheName !== DYNAMIC_CACHE_NAME;
          })
          .map((cacheName) => {
            console.log('[Service Worker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          })
      );
    }).then(() => {
      console.log('[Service Worker] Activation complete');
      return self.clients.claim();
    })
  );
});

// Fetch event - network-first for API calls, cache-first for static assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Skip WebSocket connections and Socket.IO polling
  if (url.pathname.includes('/socket.io/') || 
      request.url.includes('transport=polling') ||
      request.url.includes('transport=websocket')) {
    return;
  }
  
  // Network-first strategy for API calls
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Clone the response before caching
          const responseClone = response.clone();
          
          // Only cache successful responses
          if (response.status === 200) {
            caches.open(DYNAMIC_CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          
          return response;
        })
        .catch(() => {
          // Try to serve from cache if network fails
          return caches.match(request);
        })
    );
    return;
  }
  
  // Cache-first strategy for static assets
  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        
        // If not in cache, fetch from network and cache it
        return fetch(request)
          .then((response) => {
            // Don't cache non-successful responses
            if (!response || response.status !== 200 || response.type === 'error') {
              return response;
            }
            
            // Clone the response
            const responseClone = response.clone();
            
            // Determine which cache to use
            const cacheName = STATIC_ASSETS.includes(url.pathname) || 
                             CDN_ASSETS.includes(request.url)
                             ? STATIC_CACHE_NAME 
                             : DYNAMIC_CACHE_NAME;
            
            caches.open(cacheName).then((cache) => {
              cache.put(request, responseClone);
            });
            
            return response;
          })
          .catch((err) => {
            console.error('[Service Worker] Fetch failed:', err);
            
            // Return offline page for navigation requests
            if (request.mode === 'navigate') {
              return caches.match('/index.html');
            }
            
            throw err;
          });
      })
  );
});

// Handle messages from clients
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => caches.delete(cacheName))
        );
      }).then(() => {
        return self.registration.unregister();
      }).then(() => {
        event.ports[0].postMessage({ success: true });
      })
    );
  }
});
