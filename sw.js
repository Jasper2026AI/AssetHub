/* AssetHub Service Worker
 * - 页面（index.html）：网络优先，离线时用缓存 → 有网就一定是最新版
 * - version.json / 行情 / GitHub 同步等跨域请求：不经过缓存，直接走网络
 * - 同源静态资源（js/css/图片）：先用缓存秒开，后台再更新
 */
const VER = '5.6';
const CACHE = 'assethub-v' + VER;
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'assets/css/style.css?v=' + VER,
  'assets/js/i18n.js?v=' + VER,
  'assets/js/charts.js?v=' + VER,
  'assets/js/api.js?v=' + VER,
  'assets/js/app.js?v=' + VER,
  'assets/img/logo.png',
  'assets/img/favicon.png',
  'assets/img/icon-192.png',
  'assets/img/icon-512.png',
  'assets/img/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('assethub-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;              // 行情 / 汇率 / GitHub Gist / 字体：不拦截
  if (url.pathname.endsWith('/version.json')) return;     // 版本检查永远走网络

  // 页面导航：网络优先，失败才用缓存（离线也能打开）
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put('index.html', copy)); }
        return res;
      }).catch(() => caches.match('index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  // 静态资源：缓存优先 + 后台更新
  e.respondWith(
    caches.open(CACHE).then(c => c.match(req).then(hit => {
      const net = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }))
  );
});
