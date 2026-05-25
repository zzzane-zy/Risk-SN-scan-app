const CACHE_NAME = 'sn-scanner-offline-v1';
// 这里列出需要被下载到手机本地离线使用的文件
const urlsToCache = [
  './',
  './index.html',
  './Risk-SN.csv',
  './html5-qrcode.min.js',
  './manifest.json'
];

// 安装时缓存所有文件
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

// 断网时拦截请求，直接从本地缓存读取文件
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});
