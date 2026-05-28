// SPA ルーター + 各画面のレンダリング

const view  = document.getElementById('view');
const title = document.getElementById('pageTitle');
const back  = document.getElementById('backBtn');
const tabs  = document.querySelectorAll('.tabbar .tab');
const toast = document.getElementById('toast');

const State = { items: [] };

const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));

const fmt = ts => {
  const d = new Date(ts);
  if (isNaN(d)) return '';
  const z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${z(d.getMonth()+1)}/${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`;
};

const showToast = msg => {
  toast.textContent = msg;
  toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toast.hidden = true; }, 1800);
};

const getRequestType = request => request.request_type === 'purchase' ? 'purchase' : 'loan';
const isPurchaseRequest = request => getRequestType(request) === 'purchase';
const requestDisplayName = request => {
  if (isPurchaseRequest(request)) {
    return request.approved_item_name || request.purchase_name || request.item_name || '購入申請';
  }
  return request.item_name || '';
};
const requestDisplayQuantity = request => Number(
  isPurchaseRequest(request)
    ? (request.approved_quantity || request.quantity || 0)
    : (request.quantity || 0)
);
const getItemType = item => item?.item_type === 'consumable' ? 'consumable' : 'equipment';
const getItemTypeLabel = item => getItemType(item) === 'consumable' ? '消耗品' : '物品';
const getRequestItemType = request => {
  if (isPurchaseRequest(request)) {
    return request.approved_item_type || request.purchase_item_type || 'equipment';
  }
  return request.item_type || 'equipment';
};
const getRequestItemTypeLabel = request => getRequestItemType(request) === 'consumable' ? '消耗品' : '物品';

// コメント入力モーダル（Promise を返す）
function askComment(opts) {
  return new Promise(resolve => {
    const modal     = document.getElementById('commentModal');
    const titleEl   = document.getElementById('cmTitle');
    const descEl    = document.getElementById('cmDesc');
    const input     = document.getElementById('cmInput');
    const cancelBtn = document.getElementById('cmCancel');
    const okBtn     = document.getElementById('cmConfirm');

    titleEl.textContent = opts.title || '';
    descEl.textContent  = opts.desc  || '';
    input.placeholder   = opts.placeholder || '';
    input.value         = '';
    okBtn.textContent   = opts.okLabel || '確定';
    modal.hidden = false;
    modal.style.display = 'flex';
    setTimeout(() => input.focus(), 50);

    const cleanup = () => {
      modal.hidden = true;
      modal.style.display = 'none';
      cancelBtn.onclick = null;
      okBtn.onclick = null;
    };
    cancelBtn.onclick = () => { cleanup(); resolve(null); };
    okBtn.onclick = () => {
      const v = input.value.trim();
      if (opts.required && !v) {
        showToast('入力してください');
        return;
      }
      cleanup();
      resolve(v);
    };
  });
}

// 起動時にモーダルを必ず非表示にしておく（キャッシュ等の保険）
(() => {
  const m = document.getElementById('commentModal');
  if (m) { m.hidden = true; m.style.display = 'none'; }
})();

// アクション → コメント要否を判定して実行
async function performAction(act, id) {
  let memo = '';
  if (act === 'ready') {
    const m = await askComment({
      title: '申請を承認する',
      desc: '受け取りの場所・日時などを入力してください。利用者にメールで通知されます。',
      placeholder: '例) 5/3 14:00 体育館前で受け取り\n返却は5/4 17:00までに同じ場所',
      okLabel: '承認する',
    });
    if (m === null) return null;  // キャンセル
    memo = m;
  } else if (act === 'rejected') {
    const m = await askComment({
      title: '申請を却下する',
      desc: '却下理由を入力してください。利用者にメールで通知されます。',
      placeholder: '例) 同日に他の予約があります',
      okLabel: '却下する',
      required: true,
    });
    if (m === null) return null;
    memo = m;
  } else {
    if (!confirm(`この申請を「${ACTION_LABEL[act]}」にしますか？`)) return null;
  }
  return Api.updateRequestStatus({ id, status: act, memo });
}

const setTabActive = name => {
  tabs.forEach(t => t.classList.toggle('active', t.dataset.go === name));
};
const setHeader = (text, withBack) => {
  title.textContent = text;
  back.hidden = !withBack;
};

// ---- アイコン ----
const ICON_RULES = [
  ['椅子', '🪑'],
  ['机', '🟫'],
  ['プロジェクター', '📽️'],
  ['プロジェクタ', '📽️'],
  ['マイク', '🎤'],
  ['コード', '🔌'],
  ['電源', '🔌'],
  ['スピーカー', '🔊'],
  ['カメラ', '📷'],
  ['ライト', '💡'],
  ['段ボール', '📦'],
];
const pickIcon = (name = '', category = '') => {
  for (const [k, v] of ICON_RULES) {
    if (name.includes(k) || category.includes(k)) return v;
  }
  return '📦';
};

// 画像をリサイズ＆JPEG圧縮して data URL を返す
async function resizeImage(file, maxSize = 320, quality = 0.75) {
  const dataUrl = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = dataUrl;
  });
  let { width, height } = img;
  const ratio = Math.min(1, maxSize / Math.max(width, height));
  width = Math.round(width * ratio);
  height = Math.round(height * ratio);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  canvas.getContext('2d').drawImage(img, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', quality);
}

// ---- Routing ----
const routes = {};
const navigate = (name, params = {}) => {
  const h = routes[name];
  if (h) h(params);
  else routes.home(params);
};
window.addEventListener('hashchange', () => {
  const [name, q] = location.hash.replace(/^#/, '').split('?');
  const params = Object.fromEntries(new URLSearchParams(q || ''));
  navigate(name || 'home', params);
});
const go = (name, params = {}) => {
  const q = new URLSearchParams(params).toString();
  location.hash = q ? `${name}?${q}` : name;
};

tabs.forEach(t => t.addEventListener('click', () => go(t.dataset.go)));
back.addEventListener('click', () => history.length > 1 ? history.back() : go('home'));
document.getElementById('logBtn').addEventListener('click', () => go('log'));
document.getElementById('sheetBtn').addEventListener('click', () => {
  if (!window.SHEET_URL) { showToast('config.js の SHEET_URL を設定してください'); return; }
  window.open(window.SHEET_URL, '_blank', 'noopener');
});

// ====================================================================
// 1. 物品一覧
// ====================================================================
routes.home = async () => {
  setHeader('物品一覧', false);
  setTabActive('home');
  view.innerHTML = `
    <div class="search-bar">
      <div class="search-icon" style="flex:1;display:flex"><input id="q" placeholder="物品名で検索" /></div>
      <select id="cat"><option value="">すべてのカテゴリ</option></select>
    </div>
    <div id="list"><div class="loading">読み込み中…</div></div>
  `;

  const { items = [] } = await Api.getItems();
  State.items = items;

  const cats = [...new Set(items.map(i => i.category).filter(Boolean))];
  const catSel = view.querySelector('#cat');
  cats.forEach(c => {
    const o = document.createElement('option');
    o.value = o.textContent = c;
    catSel.appendChild(o);
  });

  const list = view.querySelector('#list');
  const render = () => {
    const q = view.querySelector('#q').value.trim();
    const cat = catSel.value;
    const filtered = items.filter(i =>
      (!q || i.name.includes(q)) && (!cat || i.category === cat)
    );
    if (!filtered.length) { list.innerHTML = '<div class="empty">該当なし</div>'; return; }
    list.innerHTML = filtered.map(i => `
      <div class="item-card" data-id="${i.id}">
        <div class="item-top">
          <div class="item-icon">${
            i.image ? `<img src="${i.image}" alt="">` : pickIcon(i.name, i.category)
          }</div>
          <div class="item-info">
            <div class="item-name">${escape(i.name)}</div>
            <div class="item-cat">${escape(i.category || '')} / ${escape(getItemTypeLabel(i))}</div>
            <div class="item-note">${i.note ? '備考：' + escape(i.note) : ''}</div>
          </div>
        </div>
        <div class="stats-mini stats-mini-4">
          <div class="stat-mini total"><div class="lbl">総数</div><div class="num">${i.total_quantity}</div></div>
          <div class="stat-mini stock"><div class="lbl">在庫</div><div class="num">${i.current_quantity}</div></div>
          <div class="stat-mini reserved"><div class="lbl">予約済み</div><div class="num">${i.reserved_quantity || 0}</div></div>
          <div class="stat-mini lent"><div class="lbl">貸出中</div><div class="num">${i.lent_quantity}</div></div>
        </div>
      </div>
    `).join('');
    list.querySelectorAll('.item-card').forEach(c =>
      c.addEventListener('click', () => go('detail', { id: c.dataset.id }))
    );
  };
  view.querySelector('#q').addEventListener('input', render);
  catSel.addEventListener('change', render);
  render();
};

// ====================================================================
// 2. 物品詳細
// ====================================================================
routes.detail = async ({ id }) => {
  setHeader('物品詳細', true);
  setTabActive('home');
  view.innerHTML = `<div class="loading">読み込み中…</div>`;
  const { item, error } = await Api.getItemDetail(id);
  if (error || !item) { view.innerHTML = `<div class="empty">読み込みに失敗</div>`; return; }

  const breakdownRows = item.breakdown.length
    ? item.breakdown.map(b => `<tr><td>${escape(b.target)}</td><td>${b.quantity}</td></tr>`).join('') +
      `<tr class="total-row"><td>合計</td><td>${item.lent_quantity}</td></tr>`
    : `<tr><td colspan="2" class="empty-msg" style="text-align:center">なし</td></tr>`;
  const reservedRows = item.reserved_breakdown.length
    ? item.reserved_breakdown.map(b => `<tr><td>${escape(b.target)}</td><td>${b.quantity}</td></tr>`).join('') +
      `<tr class="total-row"><td>合計</td><td>${item.reserved_quantity || 0}</td></tr>`
    : `<tr><td colspan="2" class="empty-msg" style="text-align:center">なし</td></tr>`;

  const histRows = item.transactions.length
    ? item.transactions.map(t => {
        const d = new Date(t.timestamp);
        const dateStr = isNaN(d) ? '' :
          `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
        return `
          <tr>
            <td class="date">${dateStr}</td>
            <td><span class="tag ${t.type}">${t.type === 'lend' ? '貸出' : t.type === 'return' ? '返却' : '消耗'}</span></td>
            <td>${escape(t.target)}</td>
            <td class="qty">${t.quantity}</td>
          </tr>`;
      }).join('')
    : `<tr><td colspan="4" class="empty-msg" style="text-align:center">履歴なし</td></tr>`;

  view.innerHTML = `
    <div class="detail-hero">
      <div class="detail-img">${
        item.image ? `<img src="${item.image}" alt="">` : pickIcon(item.name, item.category)
      }</div>
      <h2>${escape(item.name)}</h2>
      <div class="meta">
        カテゴリ：${escape(item.category || '-')}<br>
        種別：${escape(getItemTypeLabel(item))}<br>
        備考：${escape(item.note || '-')}
      </div>
    </div>

    <div class="big-stats big-stats-4">
      <div class="big-stat total"><div class="lbl">総数</div><div class="num">${item.total_quantity}</div></div>
      <div class="big-stat stock"><div class="lbl">在庫</div><div class="num">${item.current_quantity}</div></div>
      <div class="big-stat reserved"><div class="lbl">予約済み</div><div class="num">${item.reserved_quantity || 0}</div></div>
      <div class="big-stat lent"><div class="lbl">貸出中</div><div class="num">${item.lent_quantity}</div></div>
    </div>

    <div class="section">
      <h3>現在の予約内訳</h3>
      <table class="kv-table">${reservedRows}</table>
    </div>

    <div class="section">
      <h3>現在の貸出内訳</h3>
      <table class="kv-table">${breakdownRows}</table>
    </div>

    <div class="section">
      <h3>履歴</h3>
      <table class="history-table">${histRows}</table>
    </div>

    <div class="req-action-row">
      <button class="btn-handover" id="editBtn">編集</button>
      <button class="btn-reject" id="deleteBtn">削除</button>
    </div>
  `;

  view.querySelector('#editBtn').addEventListener('click', () =>
    go('editItem', { id: item.id })
  );
  view.querySelector('#deleteBtn').addEventListener('click', async () => {
    if (!confirm(`「${item.name}」を削除しますか？\n\n貸出履歴・申請データはそのまま残ります。\nこの操作は取り消せません。`)) return;
    const r = await Api.deleteItem({ id: item.id });
    if (r.error) { showToast('エラー: ' + r.error); return; }
    showToast('削除しました');
    State.items = [];
    go('home');
  });
};

// ====================================================================
// 3. 申請一覧
// ====================================================================
const STATUS_LABEL = {
  pending:  '申請中',
  ready:    '受け取り待ち',
  received: '受け取り済',
  returned: '返却完了',
  approved: '登録済み',
  rejected: '却下',
};
const STATUS_ORDER = { pending: 0, ready: 1, received: 2, returned: 3, approved: 4, rejected: 5 };
const ACTION_LABEL = {
  ready:    '承認',
  rejected: '却下',
  received: '受け渡し完了',
  returned: '返却完了',
  approved: '登録',
};

const REQUEST_TYPE_LABEL = {
  loan: '貸出申請',
  purchase: '購入申請',
};

const renderActionButtons = request => {
  const status = request.status;
  if (isPurchaseRequest(request) && status === 'pending') return `
    <button class="btn-approve" data-act="approved">登録する</button>
    <button class="btn-reject"  data-act="rejected">却下</button>`;
  if (status === 'pending') return `
    <button class="btn-approve" data-act="ready">承認</button>
    <button class="btn-reject"  data-act="rejected">却下</button>`;
  if (status === 'ready') return `
    <button class="btn-handover" data-act="received">受け渡し完了</button>
    <button class="btn-reject"   data-act="rejected">却下</button>`;
  if (status === 'received' && getRequestItemType(request) !== 'consumable') return `
    <button class="btn-return" data-act="returned">返却完了</button>`;
  return '';
};

routes.requests = async () => {
  setHeader('申請一覧', false);
  setTabActive('requests');
  const filterPills = ['', 'pending', 'ready', 'received', 'returned', 'approved', 'rejected'];
  const filterLabels = ['すべて', '申請中', '受け取り待ち', '受け取り済', '返却完了', '登録済み', '却下'];

  view.innerHTML = `
    <div class="search-bar">
      <div class="search-icon" style="flex:1;display:flex"><input id="rq" placeholder="団体名・利用者・物品名で検索" /></div>
    </div>
    <div class="pill-bar">
      ${filterPills.map((v, i) =>
        `<button class="pill ${v==='' ? 'active' : ''}" data-st="${v}">${filterLabels[i]}</button>`
      ).join('')}
    </div>
    <div class="sort-row">
      <select id="sort">
        <option value="new">新しい順</option>
        <option value="old">古い順</option>
        <option value="status">ステータス順</option>
        <option value="item">物品名順</option>
        <option value="type">申請種別順</option>
      </select>
    </div>
    <div id="reqList"><div class="loading">読み込み中…</div></div>
  `;

  const { requests = [] } = await Api.getRequests();
  const list = view.querySelector('#reqList');
  let curStatus = '';

  const render = () => {
    const q  = view.querySelector('#rq').value.trim();
    const so = view.querySelector('#sort').value;
    let filtered = requests.filter(r =>
      (!curStatus || r.status === curStatus) &&
      (!q || r.organization.includes(q) || r.user_name.includes(q) || r.item_name.includes(q))
    );
    filtered.sort((a, b) => {
      if (so === 'old')    return new Date(a.created_at) - new Date(b.created_at);
      if (so === 'status') return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (so === 'item')   return requestDisplayName(a).localeCompare(requestDisplayName(b), 'ja');
      if (so === 'type')   return REQUEST_TYPE_LABEL[getRequestType(a)].localeCompare(REQUEST_TYPE_LABEL[getRequestType(b)], 'ja');
      return new Date(b.created_at) - new Date(a.created_at);
    });

    if (!filtered.length) { list.innerHTML = '<div class="empty">該当なし</div>'; return; }
    list.innerHTML = filtered.map(r => `
      <div class="req-card" data-id="${r.id}">
        <div class="top">
          <div class="req-badges">
            <span class="status status-${r.status}">${STATUS_LABEL[r.status]}</span>
            <span class="request-type-badge request-type-${getRequestType(r)}">${REQUEST_TYPE_LABEL[getRequestType(r)]}</span>
          </div>
          <span class="ts">${fmt(r.created_at)}</span>
        </div>
        <div class="title">${escape(requestDisplayName(r))} ×${requestDisplayQuantity(r)}</div>
        <div class="info">
          ${escape(r.organization)} / ${escape(r.user_name)}<br>
          種別：${escape(getRequestItemTypeLabel(r))}<br>
          ${isPurchaseRequest(r)
            ? `備考：${escape(r.purchase_note || '-' )}`
            : `用途：${escape(r.purpose)}`}
        </div>
        ${renderActionButtons(r) ?
          `<div class="actions">${renderActionButtons(r)}</div>` : ''}
      </div>
    `).join('');

    list.querySelectorAll('.req-card').forEach(card => {
      const id = Number(card.dataset.id);
      card.addEventListener('click', e => {
        if (e.target.closest('button')) return;
        go('reqDetail', { id });
      });
      card.querySelectorAll('button[data-act]').forEach(b => {
        b.addEventListener('click', async e => {
          e.stopPropagation();
          const act = b.dataset.act;
          if (act === 'approved') {
            go('approvePurchase', { id });
            return;
          }
          b.disabled = true;
          const res = await performAction(act, id);
          b.disabled = false;
          if (res === null) return;
          if (res.error) { showToast('エラー: ' + res.error); return; }
          showToast(ACTION_LABEL[act] + ' しました' + (
            res.mail_status === 'sent'     ? '（メール送信済）' :
            res.mail_status === 'no_email' ? '（メール: 宛先なし）' :
            res.mail_status === 'failed'   ? '（メール失敗: ' + (res.mail_error || '') + '）' : ''
          ));
          const { requests: fresh = [] } = await Api.getRequests();
          requests.length = 0;
          fresh.forEach(x => requests.push(x));
          render();
        });
      });
    });
  };

  view.querySelector('#rq').addEventListener('input', render);
  view.querySelector('#sort').addEventListener('change', render);
  view.querySelectorAll('.pill').forEach(p =>
    p.addEventListener('click', () => {
      view.querySelectorAll('.pill').forEach(x => x.classList.remove('active'));
      p.classList.add('active');
      curStatus = p.dataset.st;
      render();
    })
  );
  render();
};

// ====================================================================
// 4. 申請詳細
// ====================================================================
routes.reqDetail = async ({ id }) => {
  setHeader('申請詳細', true);
  setTabActive('requests');
  view.innerHTML = `<div class="loading">読み込み中…</div>`;
  const { request: r, error } = await Api.getRequestDetail(id);
  if (error || !r) { view.innerHTML = `<div class="empty">読み込みに失敗</div>`; return; }

  // 処理履歴のタイムライン
  const tlEvents = [{ ts: r.created_at, label: isPurchaseRequest(r) ? '購入申請' : '申請' }];
  if (r.processed_at && r.status !== 'pending') {
    tlEvents.push({
      ts: r.processed_at,
      label: STATUS_LABEL[r.status] === '受け取り待ち' ? '承認' : STATUS_LABEL[r.status]
    });
  }
  const tlHtml = tlEvents.map(e => `
    <div class="tl-item">
      <div class="tl-dot"></div>
      <div class="tl-content">
        <div class="tl-time">${fmt(e.ts)}</div>
        <div class="tl-label">${escape(e.label)}</div>
      </div>
    </div>
  `).join('');

  const txList = (r.transactions || []).length
    ? `<table class="history-table">${
        r.transactions.map(t => `
          <tr>
            <td class="date">${fmt(t.timestamp)}</td>
            <td><span class="tag ${t.type}">${t.type === 'lend' ? '貸出' : t.type === 'return' ? '返却' : '消耗'}</span></td>
            <td class="qty">${t.quantity}</td>
          </tr>`).join('')
      }</table>`
    : `<div class="empty-msg">${isPurchaseRequest(r) ? '購入申請では貸出履歴はありません' : 'まだ貸出処理は行われていません'}</div>`;

  view.innerHTML = `
    <div class="req-banner">
      <div class="status-big status-${r.status}">${STATUS_LABEL[r.status]}</div>
      <div class="ts">${fmt(r.created_at)} 申請</div>
      <div class="request-type-inline request-type-${getRequestType(r)}">${REQUEST_TYPE_LABEL[getRequestType(r)]}</div>
      <h2>${escape(requestDisplayName(r))} × ${requestDisplayQuantity(r)}</h2>
    </div>

    <div class="section">
      <table class="kv-table">
        <tr><td>団体名</td><td>${escape(r.organization)}</td></tr>
        <tr><td>利用者</td><td>${escape(r.user_name)}</td></tr>
        <tr><td>メール</td><td>${escape(r.email || '-')}</td></tr>
        <tr><td>種別</td><td>${escape(getRequestItemTypeLabel(r))}</td></tr>
        ${isPurchaseRequest(r)
          ? `
            <tr><td>申請物品名</td><td>${escape(r.purchase_name || r.item_name || '-')}</td></tr>
            <tr><td>申請総数</td><td>${requestDisplayQuantity(r)}</td></tr>
            <tr><td>備考</td><td>${escape(r.purchase_note || '-')}</td></tr>
            <tr><td>申請画像</td><td>${r.purchase_image ? `<img class="inline-preview" src="${r.purchase_image}" alt="">` : '-'}</td></tr>
            <tr><td>承認後カテゴリ</td><td>${escape(r.approved_category || '-')}</td></tr>
            <tr><td>承認後種別</td><td>${escape(r.approved_item_type ? getRequestItemTypeLabel({ ...r, approved_item_type: r.approved_item_type, request_type: 'purchase' }) : '-')}</td></tr>
          `
          : `<tr><td>用途</td><td>${escape(r.purpose)}</td></tr>`}
        <tr><td>管理者コメント</td><td>${escape(r.memo || '-')}</td></tr>
      </table>
    </div>

    <div class="section">
      <h3>処理履歴</h3>
      <div class="timeline">${tlHtml}</div>
    </div>

    <div class="section">
      <h3>${isPurchaseRequest(r) ? '処理結果' : '貸出履歴'}</h3>
      ${txList}
    </div>

    ${renderActionButtons(r) ?
      `<div class="req-action-row">${renderActionButtons(r)}</div>` : ''}
  `;

  view.querySelectorAll('button[data-act]').forEach(b => {
    b.addEventListener('click', async () => {
      const act = b.dataset.act;
      if (act === 'approved') {
        go('approvePurchase', { id: r.id });
        return;
      }
      b.disabled = true;
      const res = await performAction(act, r.id);
      b.disabled = false;
      if (res === null) return;
      if (res.error) { showToast('エラー: ' + res.error); return; }
      showToast(ACTION_LABEL[act] + ' しました');
      State.items = [];
      routes.reqDetail({ id: r.id });
    });
  });
};

// ====================================================================
// 5. 購入申請の承認
// ====================================================================
routes.approvePurchase = async ({ id }) => {
  setHeader('購入申請の登録', true);
  setTabActive('requests');
  view.innerHTML = `<div class="loading">読み込み中…</div>`;

  if (!State.items.length) {
    const { items = [] } = await Api.getItems();
    State.items = items;
  }
  const cats = [...new Set(State.items.map(i => i.category).filter(Boolean))];
  const { request: requestData, error } = await Api.getRequestDetail(id);
  if (error || !requestData || !isPurchaseRequest(requestData)) {
    view.innerHTML = `<div class="empty">購入申請の読み込みに失敗しました</div>`;
    return;
  }

  const approvedDraft = {
    name: requestData.approved_item_name || requestData.purchase_name || requestData.item_name || '',
    category: requestData.approved_category || '',
    item_type: requestData.approved_item_type || requestData.purchase_item_type || 'equipment',
    total_quantity: requestData.approved_quantity || requestData.quantity || 0,
    note: requestData.approved_note || requestData.purchase_note || '',
    image: requestData.approved_image || requestData.purchase_image || '',
  };

  view.innerHTML = `
    <form class="form-page" id="approvePurchaseForm">
      <div class="request-summary-card">
        <div class="request-type-inline request-type-purchase">購入申請</div>
        <h3>${escape(requestData.purchase_name || requestData.item_name || '')}</h3>
        <p>${escape(requestData.organization)} / ${escape(requestData.user_name)}</p>
      </div>

      <label>購入画像</label>
      <input type="file" id="imgFile" accept="image/*" hidden />
      <label for="imgFile" class="image-drop" id="imgDrop">
        <span class="placeholder">
          <span class="ic">📷</span>
          <span>タップして画像を選択（任意）</span>
        </span>
        <img id="imgPreview" alt="" hidden />
        <button type="button" id="imgClear" class="img-clear" hidden>×</button>
      </label>

      <label>物品名<span class="req">*</span></label>
      <input name="name" required value="${escape(approvedDraft.name)}" />

      <label>カテゴリ<span class="req">*</span></label>
      <select name="category" required>
        <option value="">選択してください</option>
        ${cats.map(c => `<option ${c === approvedDraft.category ? 'selected' : ''}>${escape(c)}</option>`).join('')}
        <option value="__new">＋ 新しいカテゴリ</option>
      </select>
      <input name="categoryNew" placeholder="新しいカテゴリ名" hidden style="margin-top:6px" />

      <label>種別<span class="req">*</span></label>
      <select name="item_type" required>
        <option value="equipment" ${approvedDraft.item_type === 'equipment' ? 'selected' : ''}>物品</option>
        <option value="consumable" ${approvedDraft.item_type === 'consumable' ? 'selected' : ''}>消耗品</option>
      </select>

      <label>総数<span class="req">*</span></label>
      <input name="total_quantity" type="number" min="1" required value="${approvedDraft.total_quantity}" />

      <label>備考</label>
      <textarea name="note" rows="3">${escape(approvedDraft.note || '')}</textarea>

      <label>管理者コメント</label>
      <textarea name="memo" rows="3" placeholder="任意でコメントを追加">${escape(requestData.memo || '')}</textarea>

      <button class="btn-primary" type="submit">この内容で登録する</button>
    </form>
  `;

  const form = view.querySelector('#approvePurchaseForm');
  form.category.addEventListener('change', () => {
    form.categoryNew.hidden = form.category.value !== '__new';
  });

  const fileInput = view.querySelector('#imgFile');
  const preview = view.querySelector('#imgPreview');
  const placeholder = view.querySelector('#imgDrop .placeholder');
  const clearBtn = view.querySelector('#imgClear');
  let imageDataUrl = approvedDraft.image || '';

  const setPreview = url => {
    imageDataUrl = url;
    if (url) {
      preview.src = url;
      preview.hidden = false;
      placeholder.style.display = 'none';
      clearBtn.hidden = false;
    } else {
      preview.src = '';
      preview.hidden = true;
      placeholder.style.display = '';
      clearBtn.hidden = true;
    }
  };
  if (imageDataUrl) setPreview(imageDataUrl);

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('画像ファイルを選択してください');
      return;
    }
    try {
      setPreview(await resizeImage(file));
    } catch (err) {
      showToast('画像の読み込みに失敗しました');
    }
  });
  clearBtn.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    fileInput.value = '';
    setPreview('');
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const category = form.category.value === '__new' ? form.categoryNew.value.trim() : form.category.value;
    const approvedItem = {
      name: form.name.value.trim(),
      category,
      item_type: form.item_type.value,
      total_quantity: Number(form.total_quantity.value),
      note: form.note.value.trim(),
      image: imageDataUrl,
    };
    if (!approvedItem.name || !approvedItem.category || !approvedItem.item_type || !approvedItem.total_quantity) {
      showToast('必須項目を入力してください');
      return;
    }
    const btn = form.querySelector('.btn-primary');
    btn.disabled = true;
    btn.textContent = '登録中…';
    const result = await Api.updateRequestStatus({
      id: requestData.id,
      status: 'approved',
      memo: form.memo.value.trim(),
      approved_item: approvedItem,
    });
    btn.disabled = false;
    btn.textContent = 'この内容で登録する';
    if (result.error) {
      showToast('エラー: ' + result.error);
      return;
    }
    showToast('物品一覧へ登録しました');
    State.items = [];
    go('reqDetail', { id: requestData.id });
  });
};

// ====================================================================
// 6. 物品追加
// ====================================================================
routes.add = async () => {
  setHeader('物品追加', false);
  setTabActive('add');
  view.innerHTML = `<div class="loading">読み込み中…</div>`;

  if (!State.items.length) {
    const { items = [] } = await Api.getItems();
    State.items = items;
  }
  const cats = [...new Set(State.items.map(i => i.category).filter(Boolean))];

  view.innerHTML = `
    <form class="form-page" id="addForm">
      <label>商品画像</label>
      <input type="file" id="imgFile" accept="image/*" hidden />
      <label for="imgFile" class="image-drop" id="imgDrop">
        <span class="placeholder">
          <span class="ic">📷</span>
          <span>タップして画像を選択（任意）</span>
        </span>
        <img id="imgPreview" alt="" hidden />
        <button type="button" id="imgClear" class="img-clear" hidden>×</button>
      </label>

      <label>物品名<span class="req">*</span></label>
      <input name="name" required placeholder="例) パイプ椅子" />

      <label>カテゴリ<span class="req">*</span></label>
      <select name="category" required>
        <option value="">選択してください</option>
        ${cats.map(c => `<option>${escape(c)}</option>`).join('')}
        <option value="__new">＋ 新しいカテゴリ</option>
      </select>
      <input name="categoryNew" placeholder="新しいカテゴリ名" hidden style="margin-top:6px" />

      <label>種別<span class="req">*</span></label>
      <select name="item_type" required>
        <option value="equipment">物品</option>
        <option value="consumable">消耗品</option>
      </select>

      <label>総数<span class="req">*</span></label>
      <input name="total_quantity" type="number" min="0" required inputmode="numeric" placeholder="例) 100" />

      <label>備考</label>
      <textarea name="note" rows="2" placeholder="例) 倉庫Aに保管"></textarea>

      <button class="btn-primary" type="submit">追加する</button>
    </form>
  `;

  const f = view.querySelector('#addForm');
  f.category.addEventListener('change', () => {
    f.categoryNew.hidden = f.category.value !== '__new';
  });

  // 画像ピッカー
  const fileInput = view.querySelector('#imgFile');
  const preview = view.querySelector('#imgPreview');
  const placeholder = view.querySelector('#imgDrop .placeholder');
  const clearBtn = view.querySelector('#imgClear');
  let imageDataUrl = '';

  const setPreview = url => {
    imageDataUrl = url;
    if (url) {
      preview.src = url; preview.hidden = false;
      placeholder.style.display = 'none';
      clearBtn.hidden = false;
    } else {
      preview.src = ''; preview.hidden = true;
      placeholder.style.display = '';
      clearBtn.hidden = true;
    }
  };

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('画像ファイルを選択してください'); return;
    }
    try {
      const dataUrl = await resizeImage(file);
      setPreview(dataUrl);
    } catch (err) {
      showToast('画像の読み込みに失敗しました');
    }
  });
  clearBtn.addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    fileInput.value = '';
    setPreview('');
  });

  f.addEventListener('submit', async e => {
    e.preventDefault();
    const cat = f.category.value === '__new' ? f.categoryNew.value.trim() : f.category.value;
    const payload = {
      name: f.name.value.trim(),
      category: cat,
      item_type: f.item_type.value,
      total_quantity: Number(f.total_quantity.value),
      note: f.note.value.trim(),
      image: imageDataUrl,
    };
    if (!payload.name || !payload.category || !payload.item_type) return;
    const btn = f.querySelector('.btn-primary');
    btn.disabled = true; btn.textContent = '送信中…';
    const r = await Api.addItem(payload);
    btn.disabled = false; btn.textContent = '追加する';
    if (r.error) { showToast('エラー: ' + r.error); return; }
    showToast('物品を追加しました');
    State.items = [];
    go('home');
  });
};

// ====================================================================
// 5b. 物品編集
// ====================================================================
routes.editItem = async ({ id }) => {
  setHeader('物品の編集', true);
  setTabActive('home');
  view.innerHTML = `<div class="loading">読み込み中…</div>`;

  if (!State.items.length) {
    const { items = [] } = await Api.getItems();
    State.items = items;
  }
  const cats = [...new Set(State.items.map(i => i.category).filter(Boolean))];

  const { item, error } = await Api.getItemDetail(id);
  if (error || !item) { view.innerHTML = `<div class="empty">読み込みに失敗</div>`; return; }

  // カテゴリが既存リストに無い場合も自動で追加表示
  if (item.category && !cats.includes(item.category)) cats.unshift(item.category);

  view.innerHTML = `
    <form class="form-page" id="editForm">
      <label>商品画像</label>
      <input type="file" id="imgFile" accept="image/*" hidden />
      <label for="imgFile" class="image-drop" id="imgDrop">
        <span class="placeholder">
          <span class="ic">📷</span>
          <span>タップして画像を選択（任意）</span>
        </span>
        <img id="imgPreview" alt="" hidden />
        <button type="button" id="imgClear" class="img-clear" hidden>×</button>
      </label>

      <label>物品名<span class="req">*</span></label>
      <input name="name" required value="${escape(item.name)}" />

      <label>カテゴリ<span class="req">*</span></label>
      <select name="category" required>
        <option value="">選択してください</option>
        ${cats.map(c => `<option ${c === item.category ? 'selected' : ''}>${escape(c)}</option>`).join('')}
        <option value="__new">＋ 新しいカテゴリ</option>
      </select>
      <input name="categoryNew" placeholder="新しいカテゴリ名" hidden style="margin-top:6px" />

      <label>種別<span class="req">*</span></label>
      <select name="item_type" required>
        <option value="equipment" ${getItemType(item) === 'equipment' ? 'selected' : ''}>物品</option>
        <option value="consumable" ${getItemType(item) === 'consumable' ? 'selected' : ''}>消耗品</option>
      </select>

      <label>総数<span class="req">*</span></label>
      <input name="total_quantity" type="number" min="0" required value="${item.total_quantity}" />

      <label>備考</label>
      <textarea name="note" rows="2">${escape(item.note || '')}</textarea>

      <button class="btn-primary" type="submit">更新する</button>
    </form>
  `;

  const f = view.querySelector('#editForm');
  f.category.addEventListener('change', () => {
    f.categoryNew.hidden = f.category.value !== '__new';
  });

  // 画像ピッカー（既存画像をプリセット）
  const fileInput = view.querySelector('#imgFile');
  const preview = view.querySelector('#imgPreview');
  const placeholder = view.querySelector('#imgDrop .placeholder');
  const clearBtn = view.querySelector('#imgClear');
  let imageDataUrl = item.image || '';

  const setPreview = url => {
    imageDataUrl = url;
    if (url) {
      preview.src = url; preview.hidden = false;
      placeholder.style.display = 'none';
      clearBtn.hidden = false;
    } else {
      preview.src = ''; preview.hidden = true;
      placeholder.style.display = '';
      clearBtn.hidden = true;
    }
  };
  if (imageDataUrl) setPreview(imageDataUrl);

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('画像ファイルを選択してください'); return;
    }
    try {
      const dataUrl = await resizeImage(file);
      setPreview(dataUrl);
    } catch (err) {
      showToast('画像の読み込みに失敗しました');
    }
  });
  clearBtn.addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    fileInput.value = '';
    setPreview('');
  });

  f.addEventListener('submit', async e => {
    e.preventDefault();
    const cat = f.category.value === '__new' ? f.categoryNew.value.trim() : f.category.value;
    const payload = {
      id: item.id,
      name: f.name.value.trim(),
      category: cat,
      item_type: f.item_type.value,
      total_quantity: Number(f.total_quantity.value),
      note: f.note.value.trim(),
      image: imageDataUrl,
    };
    if (!payload.name || !payload.category || !payload.item_type) return;
    const btn = f.querySelector('.btn-primary');
    btn.disabled = true; btn.textContent = '更新中…';
    const r = await Api.updateItem(payload);
    btn.disabled = false; btn.textContent = '更新する';
    if (r.error) { showToast('エラー: ' + r.error); return; }
    showToast('更新しました');
    State.items = [];
    go('detail', { id: item.id });
  });
};

// ====================================================================
// 6. 全体ログ
// ====================================================================
routes.log = async () => {
  setHeader('全体ログ', true);
  setTabActive('');
  view.innerHTML = `
    <div class="search-bar">
      <div class="search-icon" style="flex:1;display:flex"><input id="lq" placeholder="物品名・団体名・利用者名で検索" /></div>
      <select id="lt">
        <option value="">すべての種類</option>
        <option value="lend">貸出</option>
        <option value="return">返却</option>
      </select>
    </div>
    <div id="logList"><div class="loading">読み込み中…</div></div>
  `;
  const { logs = [] } = await Api.getLogs();
  const listEl = view.querySelector('#logList');

  const render = () => {
    const q = view.querySelector('#lq').value.trim();
    const t = view.querySelector('#lt').value;
    const filtered = logs.filter(l =>
      (!t || l.type === t) &&
      (!q || (l.item_name || '').includes(q) || (l.target || '').includes(q))
    );
    if (!filtered.length) { listEl.innerHTML = '<div class="empty">履歴なし</div>'; return; }
    listEl.innerHTML = filtered.map(l => `
      <div class="log-card">
        <div class="ic"><span class="tag ${l.type}">${l.type === 'lend' ? '貸出' : l.type === 'return' ? '返却' : '消耗'}</span></div>
        <div class="body">
          <div class="ttl">${escape(l.item_name)} ×${l.quantity}</div>
          <div class="meta">${escape(l.target || '')}</div>
        </div>
        <div class="time">${fmt(l.timestamp)}</div>
      </div>
    `).join('');
  };
  view.querySelector('#lq').addEventListener('input', render);
  view.querySelector('#lt').addEventListener('change', render);
  render();
};

// ---- Boot ----
window.dispatchEvent(new Event('hashchange'));
