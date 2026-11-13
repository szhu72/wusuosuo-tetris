// 最小 Service Worker：讓瀏覽器把遊戲辨識為可安裝的 App。
// 不做離線快取，每次都抓最新版本，避免更新後還看到舊版。
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
