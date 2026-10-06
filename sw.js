// バンド相関図 service worker
// 画面とアイコンを保存してオフラインでも開けるようにし、フォントとバンド写真は一度見たものを再利用する。
// 検索API（MusicBrainz / Wikipedia）は常にネットから取得する。
const VERSION = "v1";
const SHELL = `bandmap-shell-${VERSION}`;
const FONTS = "bandmap-fonts";
const IMAGES = "bandmap-images";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-192.png",
  "./icons/maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith("bandmap-shell-") && k !== SHELL).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trim(cacheName, max) {
  const c = await caches.open(cacheName);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // 画面本体: ネット優先（更新をすぐ反映）、オフラインなら保存版
  if (req.mode === "navigate" && url.origin === location.origin) {
    event.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(SHELL).then(c => c.put("./index.html", copy));
        return res;
      }).catch(() => caches.match("./index.html"))
    );
    return;
  }

  // 同じサイトのファイル（アイコンなど）: 保存版優先
  if (url.origin === location.origin) {
    event.respondWith(caches.match(req).then(hit => hit || fetch(req)));
    return;
  }

  // Google Fonts: 保存版を返しつつ裏で更新
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(caches.open(FONTS).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(res => { if (res.ok || res.type === "opaque") c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }

  // Wikipedia / Wikimedia の写真: 一度見たものは保存版（最大200枚）
  if (req.destination === "image" && /(^|\.)wikimedia\.org$|(^|\.)wikipedia\.org$/.test(url.hostname)) {
    event.respondWith(caches.open(IMAGES).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === "opaque") { c.put(req, res.clone()); trim(IMAGES, 200); }
      return res;
    }));
  }
  // それ以外（検索API）は通常どおりネットへ
});
