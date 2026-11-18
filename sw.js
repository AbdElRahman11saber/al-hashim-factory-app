/* مخزن ورشة آل هاشم — Service Worker
   بيحفظ واجهة التطبيق (App Shell) عشان تفتح بسرعة وتشتغل كتطبيق
   مثبّت. البيانات نفسها بتيجي دايماً من السيرفر (Apps Script) ومش
   بتتخزن هنا، فالتحديثات بتوصلك أول بأول. */
var CACHE_NAME = 'hashim-factory-v1';
var SHELL = ['./', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) { return cache.addAll(SHELL); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  // طلبات السيرفر (Apps Script) وخارج النطاق: سيبها تعدي للشبكة على طول، من غير تخزين.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (cached) {
      if (cached) {
        // Cache-first للواجهة + تحديث الكاش في الخلفية.
        fetch(req).then(function (res) {
          if (res && res.ok) caches.open(CACHE_NAME).then(function (c) { c.put(req, res.clone()); });
        }).catch(function () {});
        return cached;
      }
      return fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        if (req.mode === 'navigate') return caches.match('index.html');
        throw new Error('offline');
      });
    })
  );
});
