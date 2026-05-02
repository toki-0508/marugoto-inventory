// Service Worker - 何もキャッシュしない（PWA インストール可能性のためだけに存在）
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
// fetch ハンドラなし → ブラウザがそのまま処理（SW キャッシュ介在なし）
