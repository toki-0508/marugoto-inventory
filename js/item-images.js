// 画面内に入った物品画像だけを少量ずつ取得する。
const ItemImages = (() => {
  const BATCH_SIZE = 8;
  const cache = new Map();
  const queuedCallbacks = new Map();
  let flushTimer = null;
  let isLoading = false;

  const renderImage = (element, image) => {
    if (!image || !element.isConnected) return;
    const img = document.createElement('img');
    img.src = image;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    element.replaceChildren(img);
  };

  const scheduleFlush = () => {
    if (flushTimer || isLoading || !queuedCallbacks.size) return;
    flushTimer = setTimeout(flush, 50);
  };

  const flush = async () => {
    flushTimer = null;
    if (isLoading || !queuedCallbacks.size) return;

    const ids = [...queuedCallbacks.keys()].slice(0, BATCH_SIZE);
    isLoading = true;
    try {
      const response = await Api.getItemImages(ids);
      if (response.error) throw new Error(response.error);
      const imagesById = new Map(
        (response.images || []).map(entry => [String(entry.id), entry.image || ''])
      );
      ids.forEach(id => {
        const image = imagesById.get(id) || '';
        cache.set(id, image);
        const callbacks = queuedCallbacks.get(id) || [];
        queuedCallbacks.delete(id);
        callbacks.forEach(callback => callback(image));
      });
    } catch (error) {
      // 基本情報の表示を優先し、画像取得失敗時はアイコン表示を維持する。
      ids.forEach(id => queuedCallbacks.delete(id));
    } finally {
      isLoading = false;
      scheduleFlush();
    }
  };

  const enqueue = (id, callback) => {
    const normalizedId = String(id);
    if (cache.has(normalizedId)) {
      callback(cache.get(normalizedId));
      return;
    }
    const callbacks = queuedCallbacks.get(normalizedId) || [];
    callbacks.push(callback);
    queuedCallbacks.set(normalizedId, callbacks);
    scheduleFlush();
  };

  const observe = (root, items) => {
    if (!root) return () => {};
    const itemsById = new Map(items.map(item => [String(item.id), item]));
    const elements = [...root.querySelectorAll('[data-item-image]')];
    let observer = null;

    const requestImage = element => {
      const id = String(element.dataset.itemImage || '');
      const item = itemsById.get(id);
      if (!item) return;
      enqueue(id, image => {
        if (!image) return;
        item.image = image;
        renderImage(element, image);
      });
    };

    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          observer.unobserve(entry.target);
          requestImage(entry.target);
        });
      }, { rootMargin: '160px' });
      elements.forEach(element => observer.observe(element));
    } else {
      elements.forEach(requestImage);
    }

    return () => observer?.disconnect();
  };

  return { observe };
})();
