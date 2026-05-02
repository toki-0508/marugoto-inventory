// GAS との通信ラッパ。GAS_URL が空のときはモックデータで動く。

const Mock = (() => {
  const items = [];
  const tx = [];
  const requests = [];

  const calc = id => {
    let lent = 0, ret = 0;
    tx.forEach(t => { if (t.item_id === id) (t.type === 'lend' ? lent += t.quantity : ret += t.quantity); });
    return { lent, ret };
  };

  return {
    getItems: () => Promise.resolve({
      items: items.map(it => {
        const { lent, ret } = calc(it.id);
        return { ...it, current_quantity: it.total_quantity - lent + ret, lent_quantity: lent - ret };
      })
    }),
    getItemDetail: id => {
      id = Number(id);
      const it = items.find(i => i.id === id);
      if (!it) return Promise.resolve({ error: 'not found' });
      const myTx = tx.filter(t => t.item_id === id);
      const { lent, ret } = calc(id);
      const map = {};
      myTx.forEach(t => {
        map[t.target] = (map[t.target] || 0) + (t.type === 'lend' ? t.quantity : -t.quantity);
      });
      return Promise.resolve({
        item: {
          ...it,
          current_quantity: it.total_quantity - lent + ret,
          lent_quantity: lent - ret,
          transactions: [...myTx].reverse(),
          breakdown: Object.entries(map).filter(([,q]) => q > 0).map(([target, quantity]) => ({ target, quantity }))
        }
      });
    },
    addTransaction: payload => {
      const newId = tx.length ? tx[tx.length - 1].id + 1 : 1;
      tx.push({ id: newId, ...payload, timestamp: new Date().toISOString() });
      return Promise.resolve({ success: true, id: newId });
    },
    addItem: payload => {
      const newId = items.length ? items[items.length - 1].id + 1 : 1;
      items.push({ id: newId, ...payload, image: payload.image || '' });
      return Promise.resolve({ success: true, id: newId });
    },
    getLogs: () => Promise.resolve({
      logs: [...tx].reverse().map(t => ({
        ...t,
        item_name: (items.find(i => i.id === t.item_id) || {}).name || '?'
      }))
    }),
    getRequests: () => Promise.resolve({ requests: [...requests].reverse() }),
    addRequest: payload => {
      const newId = requests.length ? requests[requests.length - 1].id + 1 : 1;
      const it = items.find(i => i.id === Number(payload.item_id));
      const r = {
        id: newId,
        item_id: Number(payload.item_id),
        item_name: it ? it.name : '?',
        quantity: Number(payload.quantity),
        organization: payload.organization,
        user_name: payload.user_name,
        purpose: payload.purpose,
        status: 'pending',
        created_at: new Date().toISOString(),
        processed_at: '',
        memo: ''
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
    updateRequestStatus: ({ id, status, memo }) => {
      const r = requests.find(x => x.id === Number(id));
      if (!r) return Promise.resolve({ error: 'not found' });
      r.status = status;
      r.processed_at = new Date().toISOString();
      if (memo != null) r.memo = memo;
      // 受け渡し完了時は lend、返却完了時は return を自動記録
      if (status === 'received') {
        const newId = tx.length ? tx[tx.length - 1].id + 1 : 1;
        tx.push({
          id: newId, item_id: r.item_id, type: 'lend', quantity: r.quantity,
          target: `${r.organization}（${r.user_name}）`,
          timestamp: new Date().toISOString(),
          memo: `申請#${r.id}`
        });
      } else if (status === 'returned') {
        const newId = tx.length ? tx[tx.length - 1].id + 1 : 1;
        tx.push({
          id: newId, item_id: r.item_id, type: 'return', quantity: r.quantity,
          target: `${r.organization}（${r.user_name}）`,
          timestamp: new Date().toISOString(),
          memo: `申請#${r.id} 返却`
        });
      }
      return Promise.resolve({ success: true });
    }
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
  addTransaction(p) { return this._useMock() ? Mock.addTransaction(p) : this._post('addTransaction', p); },
  addItem(p)        { return this._useMock() ? Mock.addItem(p)        : this._post('addItem', p); },
  getRequests()       { return this._useMock() ? Mock.getRequests()        : this._get('getRequests'); },
  getRequestDetail(id){ return this._useMock() ? Mock.getRequestDetail(id) : this._get('getRequestDetail', { id }); },
  addRequest(p)       { return this._useMock() ? Mock.addRequest(p)        : this._post('addRequest', p); },
  updateRequestStatus(p) { return this._useMock() ? Mock.updateRequestStatus(p) : this._post('updateRequestStatus', p); },
};
