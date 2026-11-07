/* ใบราคา 3ส. (เว็บแอพ): มีเน็ต = ใช้ไฟล์ล่าสุดจากเว็บเสมอ (แล้วจำไว้) · ไม่มีเน็ต = ใช้ไฟล์ที่จำไว้ → เปิดแอพดูราคาล่าสุดได้
   ไม่แตะคำขอไปเว็บ Google (ดึง/บันทึกราคา) */
var V = "px-2026.11.08-005911-062b2ea6f8";
var FILES = ["./", "fonts/fonts.css", "fonts/prompt-400-latin.woff2", "fonts/prompt-400-thai.woff2", "fonts/prompt-600-latin.woff2", "fonts/prompt-600-thai.woff2", "fonts/prompt-700-latin.woff2", "fonts/prompt-700-thai.woff2", "icon-180.png", "icon-192.png", "icon-512.png", "index.html", "manifest.webmanifest", "px-app.js", "px-core.js"];
self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(V).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf("px-") === 0 && k !== V; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req, { cache: "no-cache" }).then(function (res) {
      if (res && res.ok) { var copy = res.clone(); caches.open(V).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () {
      return caches.open(V).then(function (c) { return c.match(req, { ignoreSearch: true }); }).then(function (hit) {
        return hit || caches.match("./index.html");
      });
    })
  );
});
