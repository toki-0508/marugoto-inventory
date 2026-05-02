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
    <div id="list"><div class="empty">読み込み中…</div></div>
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
            <div class="item-cat">${escape(i.category || '')}</div>
            <div class="item-note">${i.note ? '備考：' + escape(i.note) : ''}</div>
          </div>
        </div>
        <div class="stats-mini">
          <div class="stat-mini total"><div class="lbl">総数</div><div class="num">${i.total_quantity}</div></div>
          <div class="stat-mini stock"><div class="lbl">在庫</div><div class="num">${i.current_quantity}</div></div>
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
  view.innerHTML = `<div class="empty">読み込み中…</div>`;
  const { item, error } = await Api.getItemDetail(id);
  if (error || !item) { view.innerHTML = `<div class="empty">読み込みに失敗</div>`; return; }

  const breakdownRows = item.breakdown.length
    ? item.breakdown.map(b => `<tr><td>${escape(b.target)}</td><td>${b.quantity}</td></tr>`).join('') +
      `<tr class="total-row"><td>合計</td><td>${item.lent_quantity}</td></tr>`
    : `<tr><td colspan="2" class="empty-msg" style="text-align:center">なし</td></tr>`;

  const histRows = item.transactions.length
    ? item.transactions.map(t => {
        const d = new Date(t.timestamp);
        const dateStr = isNaN(d) ? '' :
          `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
        return `
          <tr>
            <td class="date">${dateStr}</td>
            <td>${t.type === 'lend' ? '受け渡し' : '返却完了'}</td>
            <td><span class="tag ${t.type}">${t.type === 'lend' ? '貸出' : '返却'}</span></td>
            <td>${escape(t.target)}</td>
            <td class="qty">${t.quantity}</td>
          </tr>`;
      }).join('')
    : `<tr><td colspan="5" class="empty-msg" style="text-align:center">履歴なし</td></tr>`;

  view.innerHTML = `
    <div class="detail-hero">
      <div class="detail-img">${
        item.image ? `<img src="${item.image}" alt="">` : pickIcon(item.name, item.category)
      }</div>
      <h2>${escape(item.name)}</h2>
      <div class="meta">
        カテゴリ：${escape(item.category || '-')}<br>
        備考：${escape(item.note || '-')}
      </div>
    </div>

    <div class="big-stats">
      <div class="big-stat total"><div class="lbl">総数</div><div class="num">${item.total_quantity}</div></div>
      <div class="big-stat stock"><div class="lbl">在庫</div><div class="num">${item.current_quantity}</div></div>
      <div class="big-stat lent"><div class="lbl">貸出中</div><div class="num">${item.lent_quantity}</div></div>
    </div>

    <div class="section">
      <h3>現在の貸出内訳</h3>
      <table class="kv-table">${breakdownRows}</table>
    </div>

    <div class="section">
      <h3>履歴</h3>
      <table class="history-table">${histRows}</table>
    </div>
  `;
};

// ====================================================================
// 3. 申請一覧
// ====================================================================
const STATUS_LABEL = {
  pending:  '申請中',
  ready:    '受け取り待ち',
  received: '受け取り済',
  returned: '返却完了',
  rejected: '却下',
};
const STATUS_ORDER = { pending: 0, ready: 1, received: 2, returned: 3, rejected: 4 };
const ACTION_LABEL = {
  ready:    '承認',
  rejected: '却下',
  received: '受け渡し完了',
  returned: '返却完了',
};

const renderActionButtons = status => {
  if (status === 'pending') return `
    <button class="btn-approve" data-act="ready">承認</button>
    <button class="btn-reject"  data-act="rejected">却下</button>`;
  if (status === 'ready') return `
    <button class="btn-handover" data-act="received">受け渡し完了</button>
    <button class="btn-reject"   data-act="rejected">却下</button>`;
  if (status === 'received') return `
    <button class="btn-return" data-act="returned">返却完了</button>`;
  return '';
};

routes.requests = async () => {
  setHeader('申請一覧', false);
  setTabActive('requests');
  const filterPills = ['', 'pending', 'ready', 'received', 'returned', 'rejected'];
  const filterLabels = ['すべて', '申請中', '受け取り待ち', '受け取り済', '返却完了', '却下'];

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
      </select>
    </div>
    <div id="reqList"><div class="empty">読み込み中…</div></div>
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
      if (so === 'item')   return a.item_name.localeCompare(b.item_name, 'ja');
      return new Date(b.created_at) - new Date(a.created_at);
    });

    if (!filtered.length) { list.innerHTML = '<div class="empty">該当なし</div>'; return; }
    list.innerHTML = filtered.map(r => `
      <div class="req-card" data-id="${r.id}">
        <div class="top">
          <span class="status status-${r.status}">${STATUS_LABEL[r.status]}</span>
          <span class="ts">${fmt(r.created_at)}</span>
        </div>
        <div class="title">${escape(r.item_name)} ×${r.quantity}</div>
        <div class="info">
          ${escape(r.organization)} / ${escape(r.user_name)}<br>
          用途：${escape(r.purpose)}
        </div>
        ${renderActionButtons(r.status) ?
          `<div class="actions">${renderActionButtons(r.status)}</div>` : ''}
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
          if (!confirm(`この申請を「${ACTION_LABEL[act]}」にしますか？`)) return;
          b.disabled = true;
          const res = await Api.updateRequestStatus({ id, status: act });
          if (res.error) { showToast('エラー: ' + res.error); b.disabled = false; return; }
          showToast(ACTION_LABEL[act] + ' しました');
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
  view.innerHTML = `<div class="empty">読み込み中…</div>`;
  const { request: r, error } = await Api.getRequestDetail(id);
  if (error || !r) { view.innerHTML = `<div class="empty">読み込みに失敗</div>`; return; }

  // 処理履歴のタイムライン
  const tlEvents = [{ ts: r.created_at, label: '申請' }];
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
            <td><span class="tag ${t.type}">${t.type === 'lend' ? '貸出' : '返却'}</span></td>
            <td class="qty">${t.quantity}</td>
          </tr>`).join('')
      }</table>`
    : `<div class="empty-msg">まだ貸出処理は行われていません</div>`;

  view.innerHTML = `
    <div class="req-banner">
      <div class="status-big status-${r.status}">${STATUS_LABEL[r.status]}</div>
      <div class="ts">${fmt(r.created_at)} 申請</div>
      <h2>${escape(r.item_name)} × ${r.quantity}</h2>
    </div>

    <div class="section">
      <table class="kv-table">
        <tr><td>団体名</td><td>${escape(r.organization)}</td></tr>
        <tr><td>利用者</td><td>${escape(r.user_name)}</td></tr>
        <tr><td>用途</td><td>${escape(r.purpose)}</td></tr>
        <tr><td>備考</td><td>${escape(r.memo || '-')}</td></tr>
      </table>
    </div>

    <div class="section">
      <h3>処理履歴</h3>
      <div class="timeline">${tlHtml}</div>
    </div>

    <div class="section">
      <h3>貸出履歴</h3>
      ${txList}
    </div>

    ${renderActionButtons(r.status) ?
      `<div class="req-action-row">${renderActionButtons(r.status)}</div>` : ''}
  `;

  view.querySelectorAll('button[data-act]').forEach(b => {
    b.addEventListener('click', async () => {
      const act = b.dataset.act;
      if (!confirm(`この申請を「${ACTION_LABEL[act]}」にしますか？`)) return;
      b.disabled = true;
      const res = await Api.updateRequestStatus({ id: r.id, status: act });
      if (res.error) { showToast('エラー: ' + res.error); b.disabled = false; return; }
      showToast(ACTION_LABEL[act] + ' しました');
      State.items = [];
      routes.reqDetail({ id: r.id });
    });
  });
};

// ====================================================================
// 5. 物品追加
// ====================================================================
routes.add = async () => {
  setHeader('物品追加', false);
  setTabActive('add');

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
      total_quantity: Number(f.total_quantity.value),
      note: f.note.value.trim(),
      image: imageDataUrl,
    };
    if (!payload.name || !payload.category) return;
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
// 6. 全体ログ
// ====================================================================
routes.log = async () => {
  setHeader('全体ログ', true);
  view.innerHTML = `
    <div class="search-bar">
      <div class="search-icon" style="flex:1;display:flex"><input id="lq" placeholder="物品名・団体名・利用者名で検索" /></div>
      <select id="lt">
        <option value="">すべての種類</option>
        <option value="lend">貸出</option>
        <option value="return">返却</option>
      </select>
    </div>
    <div id="logList"><div class="empty">読み込み中…</div></div>
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
        <div class="ic"><span class="tag ${l.type}">${l.type === 'lend' ? '貸出' : '返却'}</span></div>
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
