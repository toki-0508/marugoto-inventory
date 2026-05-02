// オフライン不要なので最小構成。インストール可能にするためだけに存在。
self.addEventListener('install',  e => self.skipWaiting());
self.addEventListener('activate', e => self.clients.claim());
self.addEventListener('fetch', () => {});
