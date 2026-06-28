// GAS との通信ラッパ。GAS_URL が空のときはモックデータで動く。

const Mock = (() => {
  const items = [];
  const tx = [];
  const requests = [];
  const storageLocations = [];

  const normalizeItemType = value => {
    const raw = String(value || '').trim();
    if (!raw) return 'equipment';
    if (raw === 'consumable' || raw === '消耗品') return 'consumable';
    if (raw === 'equipment' || raw === '物品') return 'equipment';
    return 'equipment';
  };

  const calcLending = id => {
    let lent = 0, ret = 0;
    tx.forEach(t => {
      if (t.item_id !== id) return;
      if (t.type === 'lend') lent += t.quantity;
      if (t.type === 'return') ret += t.quantity;
    });
    return { lent, ret };
  };

  const calcReserved = id => {
    const activeStatuses = new Set(['pending', 'ready']);
    const map = {};
    let reserved = 0;
    requests.forEach(r => {
      if (r.request_type !== 'loan') return;
      if (r.item_id !== id) return;
      if (!activeStatuses.has(r.status)) return;
      reserved += r.quantity;
      const target = `${r.organization}（${r.user_name}）`;
      map[target] = (map[target] || 0) + r.quantity;
    });
    return {
      reserved,
      breakdown: Object.entries(map).map(([target, quantity]) => ({ target, quantity })),
    };
  };

  const nextItemId = () => items.length ? items[items.length - 1].id + 1 : 1;
  const nextTxId = () => tx.length ? tx[tx.length - 1].id + 1 : 1;
  const nextRequestId = () => requests.length ? requests[requests.length - 1].id + 1 : 1;
  const nextStorageLocationId = () => storageLocations.length ? storageLocations[storageLocations.length - 1].id + 1 : 1;
  const isConsumable = item => item && normalizeItemType(item.item_type) === 'consumable';
  const normalizeStorageLocationName = value => String(value || '').trim();
  const upsertStorageLocation = value => {
    const name = normalizeStorageLocationName(value);
    if (!name) return '';
    if (storageLocations.some(location => location.name === name)) return name;
    storageLocations.push({ id: nextStorageLocationId(), name, created_at: new Date().toISOString() });
    return name;
  };
  const syncStorageLocationsFromItems = () => {
    items.forEach(item => {
      upsertStorageLocation(item.storage_location);
    });
  };

  const normalizePurchaseDraft = request => ({
    name: request.approved_item_name || request.purchase_name || request.item_name || '',
    category: request.approved_category || request.purchase_category || '',
    item_type: normalizeItemType(request.approved_item_type || request.purchase_item_type),
    total_quantity: Number(request.approved_quantity || request.quantity || 0),
    organization_quantity_limit: '',
    storage_location: request.approved_storage_location || request.purchase_storage_location || '',
    note: request.approved_note || request.purchase_note || '',
    image: request.approved_image || request.purchase_image || '',
    aliases: '',
  });

  const requestCountsTowardOrganizationLimit = (request, itemType) => {
    if (request.request_type !== 'loan') return false;
    if (request.status === 'pending' || request.status === 'ready') return true;
    if (request.status === 'received' && itemType !== 'consumable') return true;
    return false;
  };

  const getOrganizationAllocatedQuantity = (itemId, organization, itemType, excludeRequestId) => {
    const normalizedOrganization = String(organization || '').trim();
    if (!itemId || !normalizedOrganization) return 0;
    let allocated = 0;
    requests.forEach(request => {
      if (excludeRequestId && Number(request.id) === Number(excludeRequestId)) return;
      if (Number(request.item_id) !== Number(itemId)) return;
      if (String(request.organization || '').trim() !== normalizedOrganization) return;
      if (!requestCountsTowardOrganizationLimit(request, itemType)) return;
      allocated += Number(request.quantity) || 0;
    });
    return allocated;
  };

  return {
    getItems: () => Promise.resolve({
      items: items.map(it => {
        const { lent, ret } = calcLending(it.id);
        const { reserved } = calcReserved(it.id);
        return {
          ...it,
          current_quantity: it.total_quantity - reserved - lent + ret,
          reserved_quantity: reserved,
          lent_quantity: lent - ret,
        };
      })
    }),
    getItemDetail: id => {
      id = Number(id);
      const it = items.find(i => i.id === id);
      if (!it) return Promise.resolve({ error: 'not found' });
      const myTx = tx.filter(t => t.item_id === id);
      const { lent, ret } = calcLending(id);
      const map = {};
      myTx.forEach(t => {
        map[t.target] = (map[t.target] || 0) + (t.type === 'lend' ? t.quantity : -t.quantity);
      });
      const { reserved, breakdown: reservedBreakdown } = calcReserved(id);
      return Promise.resolve({
        item: {
          ...it,
          current_quantity: it.total_quantity - reserved - lent + ret,
          reserved_quantity: reserved,
          lent_quantity: lent - ret,
          transactions: [...myTx].reverse(),
          breakdown: Object.entries(map).filter(([,q]) => q > 0).map(([target, quantity]) => ({ target, quantity })),
          reserved_breakdown: reservedBreakdown,
        }
      });
    },
    addTransaction: payload => {
      const newId = nextTxId();
      tx.push({ id: newId, ...payload, timestamp: new Date().toISOString() });
      return Promise.resolve({ success: true, id: newId });
    },
    addItem: payload => {
      const newId = nextItemId();
      items.push({
        id: newId,
        ...payload,
        organization_quantity_limit: payload.organization_quantity_limit === '' || payload.organization_quantity_limit == null
          ? ''
          : (Number(payload.organization_quantity_limit) || ''),
        storage_location: upsertStorageLocation(payload.storage_location),
        item_type: normalizeItemType(payload.item_type),
        image: payload.image || '',
        aliases: payload.aliases || ''
      });
      return Promise.resolve({ success: true, id: newId });
    },
    updateItem: payload => {
      const it = items.find(x => x.id === Number(payload.id));
      if (!it) return Promise.resolve({ error: 'not found' });
      ['name', 'category', 'item_type', 'total_quantity', 'organization_quantity_limit', 'storage_location', 'note', 'image', 'aliases'].forEach(k => {
        if (payload[k] === undefined) return;
        if (k === 'total_quantity') {
          it[k] = Number(payload[k]);
          return;
        }
        if (k === 'organization_quantity_limit') {
          it[k] = payload[k] === '' || payload[k] == null ? '' : (Number(payload[k]) || '');
          return;
        }
        if (k === 'item_type') {
          it[k] = normalizeItemType(payload[k]);
          return;
        }
        if (k === 'storage_location') {
          it[k] = upsertStorageLocation(payload[k]);
          return;
        }
        it[k] = payload[k];
      });
      return Promise.resolve({ success: true });
    },
    getStorageLocations: () => {
      syncStorageLocationsFromItems();
      return Promise.resolve({
        storage_locations: storageLocations.map(location => location.name)
      });
    },
    addStorageLocation: payload => {
      const name = upsertStorageLocation(payload && payload.name);
      if (!name) return Promise.resolve({ error: 'storage location name is required' });
      return Promise.resolve({ success: true, name });
    },
    deleteItem: payload => {
      const idx = items.findIndex(x => x.id === Number(payload.id));
      if (idx < 0) return Promise.resolve({ error: 'not found' });
      items.splice(idx, 1);
      return Promise.resolve({ success: true });
    },
    getLogs: () => Promise.resolve({
      logs: [...tx].reverse().map(t => ({
        ...t,
        item_name: (items.find(i => i.id === t.item_id) || {}).name || '?'
      }))
    }),
    getRequests: () => Promise.resolve({ requests: [...requests].reverse() }),
    addRequest: payload => {
      const newId = nextRequestId();
      const type = payload.request_type === 'purchase' ? 'purchase' : 'loan';
      let itemId = '';
      let itemName = '';
      let itemType = '';
      let quantity = 0;

      if (type === 'loan') {
        const it = items.find(i => i.id === Number(payload.item_id));
        if (!it) return Promise.resolve({ error: 'not found' });
        const { lent, ret } = calcLending(it.id);
        const { reserved } = calcReserved(it.id);
        const available = it.total_quantity - reserved - lent + ret;
        quantity = Number(payload.quantity);
        if (!quantity || quantity > available) {
          return Promise.resolve({ error: `在庫不足です（利用可能 ${available}）` });
        }
        const organizationLimit = Number(it.organization_quantity_limit) || 0;
        if (organizationLimit > 0) {
          const allocated = getOrganizationAllocatedQuantity(it.id, payload.organization, normalizeItemType(it.item_type));
          if (allocated + quantity > organizationLimit) {
            const remaining = Math.max(organizationLimit - allocated, 0);
            return Promise.resolve({ error: `この団体の申請上限を超えています（残り ${remaining}）` });
          }
        }
        itemId = Number(payload.item_id);
        itemName = it.name;
        itemType = normalizeItemType(it.item_type);
      } else {
        itemName = String(payload.purchase_name || '').trim();
        quantity = Number(payload.purchase_quantity);
        if (!itemName || !quantity) return Promise.resolve({ error: 'invalid payload' });
      }

      const r = {
        id: newId,
        request_type: type,
        item_id: itemId,
        item_name: itemName,
        item_type: itemType,
        quantity,
        organization: payload.organization,
        user_name: payload.user_name,
        purpose: type === 'loan' ? payload.purpose : '',
        email: payload.email || '',
        status: 'pending',
        created_at: new Date().toISOString(),
        processed_at: '',
        memo: '',
        purchase_name: type === 'purchase' ? itemName : '',
        purchase_image: type === 'purchase' ? (payload.purchase_image || '') : '',
        purchase_note: type === 'purchase' ? (payload.purchase_note || '') : '',
        purchase_item_type: type === 'purchase' ? normalizeItemType(payload.purchase_item_type) : '',
        purchase_storage_location: type === 'purchase' ? upsertStorageLocation(payload.purchase_storage_location) : '',
        purchase_category: '',
        approved_item_name: '',
        approved_category: '',
        approved_item_type: '',
        approved_quantity: '',
        approved_storage_location: '',
        approved_note: '',
        approved_image: '',
      };
      requests.push(r);
      return Promise.resolve({ success: true, id: newId });
    },
    getRequestDetail: id => {
      const r = requests.find(x => x.id === Number(id));
      if (!r) return Promise.resolve({ error: 'not found' });
      const myTx = tx.filter(t => (t.memo || '').indexOf('申請#' + r.id) === 0);
      return Promise.resolve({ request: { ...r, transactions: [...myTx].reverse() } });
    },
    updateRequestStatus: ({ id, status, memo, approved_item }) => {
      const r = requests.find(x => x.id === Number(id));
      if (!r) return Promise.resolve({ error: 'not found' });
      if (r.request_type === 'purchase' && status === 'approved' && r.status === 'approved') {
        return Promise.resolve({ error: 'already approved' });
      }
      r.status = status;
      r.processed_at = new Date().toISOString();
      if (memo != null) r.memo = memo;
      if (approved_item && r.request_type === 'purchase') {
        r.approved_item_name = approved_item.name || '';
        r.approved_category = approved_item.category || '';
        r.approved_item_type = normalizeItemType(approved_item.item_type);
        r.approved_quantity = Number(approved_item.total_quantity) || '';
        r.approved_storage_location = approved_item.storage_location || '';
        r.approved_note = approved_item.note || '';
        r.approved_image = approved_item.image || '';
      }
      // 受け渡し完了時は lend、返却完了時は return を自動記録
      if (status === 'received') {
        const item = items.find(x => x.id === Number(r.item_id));
        const newId = nextTxId();
        if (isConsumable(item)) {
          item.total_quantity = Math.max(0, Number(item.total_quantity || 0) - Number(r.quantity || 0));
          tx.push({
            id: newId, item_id: r.item_id, type: 'consume', quantity: r.quantity,
            target: `${r.organization}（${r.user_name}）`,
            timestamp: new Date().toISOString(),
            memo: `申請#${r.id} 消耗`
          });
        } else {
          tx.push({
            id: newId, item_id: r.item_id, type: 'lend', quantity: r.quantity,
            target: `${r.organization}（${r.user_name}）`,
            timestamp: new Date().toISOString(),
            memo: `申請#${r.id}`
          });
        }
      } else if (status === 'returned') {
        const newId = nextTxId();
        tx.push({
          id: newId, item_id: r.item_id, type: 'return', quantity: r.quantity,
          target: `${r.organization}（${r.user_name}）`,
          timestamp: new Date().toISOString(),
          memo: `申請#${r.id} 返却`
        });
      } else if (status === 'approved' && r.request_type === 'purchase') {
        const draft = normalizePurchaseDraft(r);
        if (!draft.name || !draft.category || !draft.item_type || !draft.total_quantity) {
          return Promise.resolve({ error: 'invalid approved item' });
        }
        draft.storage_location = upsertStorageLocation(draft.storage_location);
        const newId = nextItemId();
        items.push({ id: newId, ...draft });
      }
      return Promise.resolve({ success: true });
    },
  };
})();

const Api = {
  _useMock: () => !window.GAS_URL,

  async _get(action, params = {}) {
    const u = new URL(window.GAS_URL);
    u.searchParams.set('action', action);
    Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
    const res = await fetch(u.toString());
    return res.json();
  },

  async _post(action, payload) {
    const res = await fetch(window.GAS_URL, {
      method: 'POST',
      // text/plain にして CORS preflight を避ける（GAS の慣例）
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, payload })
    });
    return res.json();
  },

  getItems()        { return this._useMock() ? Mock.getItems()        : this._get('getItems'); },
  getItemDetail(id) { return this._useMock() ? Mock.getItemDetail(id) : this._get('getItemDetail', { id }); },
  getLogs()         { return this._useMock() ? Mock.getLogs()         : this._get('getLogs'); },
  getStorageLocations() { return this._useMock() ? Mock.getStorageLocations() : this._get('getStorageLocations'); },
  addTransaction(p) { return this._useMock() ? Mock.addTransaction(p) : this._post('addTransaction', p); },
  addItem(p)        { return this._useMock() ? Mock.addItem(p)        : this._post('addItem', p); },
  updateItem(p)     { return this._useMock() ? Mock.updateItem(p)     : this._post('updateItem', p); },
  deleteItem(p)     { return this._useMock() ? Mock.deleteItem(p)     : this._post('deleteItem', p); },
  getRequests()       { return this._useMock() ? Mock.getRequests()        : this._get('getRequests'); },
  getRequestDetail(id){ return this._useMock() ? Mock.getRequestDetail(id) : this._get('getRequestDetail', { id }); },
  addRequest(p)       { return this._useMock() ? Mock.addRequest(p)        : this._post('addRequest', p); },
  addStorageLocation(p) { return this._useMock() ? Mock.addStorageLocation(p) : this._post('addStorageLocation', p); },
  updateRequestStatus(p) { return this._useMock() ? Mock.updateRequestStatus(p) : this._post('updateRequestStatus', p); },
};
