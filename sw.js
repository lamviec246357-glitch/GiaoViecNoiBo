// ================================================================
// SERVICE WORKER - Giao Việc Nội Bộ PWA
// Version: 1.0.0
// Chiến lược: Cache-first cho assets, Network-first cho app GAS
// ================================================================

const SW_VERSION   = 'gv-pwa-v1.0.0';
const STATIC_CACHE = 'gv-static-v1';
const DYNAMIC_CACHE = 'gv-dynamic-v1';

// Assets cần cache khi cài đặt
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// Trang offline fallback
const OFFLINE_PAGE = './index.html';

// ── INSTALL ──
self.addEventListener('install', function(event) {
  console.log('[SW] Installing version:', SW_VERSION);

  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(function(cache) {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(function() {
        // Kích hoạt ngay, không chờ tab cũ đóng
        return self.skipWaiting();
      })
      .catch(function(err) {
        console.warn('[SW] Cache install failed:', err);
      })
  );
});

// ── ACTIVATE ──
self.addEventListener('activate', function(event) {
  console.log('[SW] Activating version:', SW_VERSION);

  event.waitUntil(
    Promise.all([
      // Xóa cache cũ
      caches.keys().then(function(cacheNames) {
        return Promise.all(
          cacheNames
            .filter(function(name) {
              return name !== STATIC_CACHE && name !== DYNAMIC_CACHE;
            })
            .map(function(name) {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      }),
      // Claim tất cả clients ngay lập tức
      self.clients.claim()
    ])
  );
});

// ── FETCH ──
self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);

  // Bỏ qua các request không phải GET
  if (event.request.method !== 'GET') return;

  // Bỏ qua Chrome extension và các scheme khác
  if (!url.protocol.startsWith('http')) return;

  // ── GAS App requests: Network-first (luôn lấy fresh) ──
  if (url.hostname === 'script.google.com' ||
      url.hostname === 'script.googleusercontent.com') {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // ── Google fonts/APIs: Stale-while-revalidate ──
  if (url.hostname === 'fonts.googleapis.com' ||
      url.hostname === 'fonts.gstatic.com' ||
      url.hostname === 'cdnjs.cloudflare.com' ||
      url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  // ── Local static assets: Cache-first ──
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // ── Fallback: Network ──
  event.respondWith(fetch(event.request).catch(function() {
    return caches.match(OFFLINE_PAGE);
  }));
});

// ── Cache Strategies ──

// Cache-first: dùng cache, nếu không có thì fetch và lưu vào cache
function cacheFirst(request) {
  return caches.match(request).then(function(cached) {
    if (cached) {
      // Cập nhật cache ngầm
      fetchAndCache(request, STATIC_CACHE);
      return cached;
    }
    return fetchAndCache(request, DYNAMIC_CACHE);
  });
}

// Network-first: fetch mới, nếu lỗi thì dùng cache
function networkFirst(request) {
  return fetch(request)
    .then(function(response) {
      if (response && response.status === 200) {
        var cloned = response.clone();
        caches.open(DYNAMIC_CACHE).then(function(cache) {
          cache.put(request, cloned);
        });
      }
      return response;
    })
    .catch(function() {
      return caches.match(request).then(function(cached) {
        return cached || caches.match(OFFLINE_PAGE);
      });
    });
}

// Stale-while-revalidate: trả cache ngay, đồng thời fetch để cập nhật
function staleWhileRevalidate(request) {
  return caches.open(DYNAMIC_CACHE).then(function(cache) {
    return cache.match(request).then(function(cached) {
      var networkFetch = fetch(request).then(function(response) {
        if (response && response.status === 200) {
          cache.put(request, response.clone());
        }
        return response;
      }).catch(function() {
        return cached;
      });
      return cached || networkFetch;
    });
  });
}

// Helper: fetch và lưu vào cache
function fetchAndCache(request, cacheName) {
  return fetch(request).then(function(response) {
    if (!response || response.status !== 200 || response.type === 'opaque') {
      return response;
    }
    var cloned = response.clone();
    caches.open(cacheName).then(function(cache) {
      cache.put(request, cloned);
    });
    return response;
  }).catch(function() {
    return caches.match(OFFLINE_PAGE);
  });
}

// ── PUSH Notifications (chuẩn bị cho tương lai) ──
self.addEventListener('push', function(event) {
  if (!event.data) return;

  var data = event.data.json();
  var options = {
    body: data.body || 'Bạn có thông báo mới',
    icon: './icons/icon-192.png',
    badge: './icons/icon-72.png',
    tag: data.tag || 'gv-notification',
    data: { url: data.url || './' },
    actions: [
      { action: 'open',    title: 'Xem ngay' },
      { action: 'dismiss', title: 'Bỏ qua'  }
    ],
    requireInteraction: false,
    silent: false
  };

  event.waitUntil(
    self.registration.showNotification(
      data.title || 'Giao Việc Nội Bộ',
      options
    )
  );
});

// ── NOTIFICATION CLICK ──
self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  var targetUrl = (event.notification.data && event.notification.data.url)
    ? event.notification.data.url : './';

  if (event.action === 'dismiss') return;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(function(clientList) {
        // Nếu đã có tab mở → focus
        for (var i = 0; i < clientList.length; i++) {
          if (clientList[i].url === targetUrl && 'focus' in clientList[i]) {
            return clientList[i].focus();
          }
        }
        // Không có → mở tab mới
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});

// ── BACKGROUND SYNC (chuẩn bị cho tương lai) ──
self.addEventListener('sync', function(event) {
  if (event.tag === 'sync-tiendo') {
    console.log('[SW] Background sync: tiến độ');
    // Xử lý đồng bộ offline queue ở đây khi cần
  }
});

console.log('[SW] Service Worker loaded:', SW_VERSION);
