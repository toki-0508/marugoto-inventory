// 利用者用 申請フォーム + 物品ピッカー

(async () => {
  const form  = document.getElementById('applyForm');
  const done  = document.getElementById('done');
  const toast = document.getElementById('toast');
  const qtyErr = document.getElementById('qtyErr');

  const pickerBtn    = document.getElementById('itemPickerBtn');
  const pickerModal  = document.getElementById('pickerModal');
  const pickerClose  = document.getElementById('pickerClose');
  const pickerSearch = document.getElementById('pickerSearch');
  const pickerCats   = document.getElementById('pickerCats');
  const pickerList   = document.getElementById('pickerList');
  const itemIdInput  = document.getElementById('itemIdInput');

  const showToast = msg => {
    toast.textContent = msg;
    toast.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { toast.hidden = true; }, 1800);
  };

  const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));

  // ---- アイコン ----
  const ICON_RULES = [
    ['椅子', '🪑'], ['机', '🟫'], ['プロジェクター', '📽️'], ['プロジェクタ', '📽️'],
    ['マイク', '🎤'], ['コード', '🔌'], ['電源', '🔌'], ['スピーカー', '🔊'],
    ['カメラ', '📷'], ['ライト', '💡'], ['段ボール', '📦'],
  ];
  const pickIcon = (name = '', category = '') => {
    for (const [k, v] of ICON_RULES) {
      if (name.includes(k) || category.includes(k)) return v;
    }
    return '📦';
  };

  // ---- ピッカー ----
  let allItems = [];
  let curCat = '';
  const stockMap = new Map();

  const renderList = () => {
    const q = pickerSearch.value.trim();
    const filtered = allItems.filter(i =>
      (!curCat || i.category === curCat) && (!q || i.name.includes(q))
    );
    if (!filtered.length) {
      pickerList.innerHTML = '<div class="empty">該当する物品がありません</div>';
      return;
    }
    pickerList.innerHTML = filtered.map(i => `
      <div class="picker-item" data-id="${i.id}">
        <div class="thumb">${
          i.image ? `<img src="${i.image}" alt="">` : pickIcon(i.name, i.category)
        }</div>
        <div class="info">
          <div class="nm">${escape(i.name)}</div>
          <div class="ct">${escape(i.category || '-')}</div>
        </div>
        <div class="stk">在庫 ${i.current_quantity}</div>
      </div>
    `).join('');
    pickerList.querySelectorAll('.picker-item').forEach(el =>
      el.addEventListener('click', () => {
        const id = el.dataset.id;
        const item = allItems.find(x => String(x.id) === id);
        if (item) selectItem(item);
      })
    );
  };

  const selectItem = item => {
    itemIdInput.value = item.id;
    pickerBtn.innerHTML = `
      <span class="thumb">${
        item.image ? `<img src="${item.image}" alt="">` : pickIcon(item.name, item.category)
      }</span>
      <span class="label">${escape(item.name)}（在庫 ${item.current_quantity}）</span>
      <span class="arrow">▼</span>
    `;
    pickerModal.hidden = true;
    validateQty();
  };

  const buildCats = () => {
    const cats = [...new Set(allItems.map(i => i.category).filter(Boolean))];
    pickerCats.innerHTML =
      `<button type="button" class="pill active" data-cat="">すべて</button>` +
      cats.map(c => `<button type="button" class="pill" data-cat="${escape(c)}">${escape(c)}</button>`).join('');
    pickerCats.querySelectorAll('.pill').forEach(p =>
      p.addEventListener('click', () => {
        pickerCats.querySelectorAll('.pill').forEach(x => x.classList.remove('active'));
        p.classList.add('active');
        curCat = p.dataset.cat;
        renderList();
      })
    );
  };

  pickerBtn.addEventListener('click', () => {
    if (!allItems.length) { showToast('利用可能な物品がありません'); return; }
    pickerSearch.value = '';
    curCat = '';
    pickerCats.querySelectorAll('.pill').forEach((p, i) =>
      p.classList.toggle('active', i === 0));
    pickerModal.hidden = false;
    renderList();
    setTimeout(() => pickerSearch.focus(), 50);
  });
  pickerClose.addEventListener('click', () => { pickerModal.hidden = true; });
  pickerSearch.addEventListener('input', renderList);

  // ---- 個数バリデーション ----
  const validateQty = () => {
    const itemId = itemIdInput.value;
    const qty = Number(form.quantity.value);
    if (!itemId || !qty) {
      form.quantity.classList.remove('invalid');
      qtyErr.hidden = true;
      return true;
    }
    const max = stockMap.get(itemId);
    if (qty > max) {
      qtyErr.textContent = `在庫を超えています（最大 ${max}）`;
      qtyErr.hidden = false;
      form.quantity.classList.add('invalid');
      return false;
    }
    qtyErr.hidden = true;
    form.quantity.classList.remove('invalid');
    return true;
  };
  form.quantity.addEventListener('input', validateQty);

  // ---- 初期データ取得 ----
  try {
    const { items = [] } = await Api.getItems();
    allItems = items.filter(i => i.current_quantity > 0);
    allItems.forEach(i => stockMap.set(String(i.id), i.current_quantity));
    buildCats();
  } catch (e) {
    showToast('物品の取得に失敗しました');
  }

  // ---- 送信 ----
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!itemIdInput.value) { showToast('物品を選択してください'); return; }
    if (!validateQty()) return;

    const payload = {
      item_id:      Number(itemIdInput.value),
      quantity:     Number(form.quantity.value),
      organization: form.organization.value.trim(),
      user_name:    form.user_name.value.trim(),
      email:        form.email.value.trim(),
      purpose:      form.purpose.value.trim(),
    };
    if (!payload.item_id || !payload.quantity || !payload.organization
        || !payload.user_name || !payload.email || !payload.purpose) return;

    const btn = form.querySelector('.btn-primary');
    btn.disabled = true; btn.textContent = '送信中…';
    const r = await Api.addRequest(payload);
    btn.disabled = false; btn.textContent = 'この内容で申請する';
    if (r.error) { showToast('エラー: ' + r.error); return; }
    form.hidden = true;
    done.hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  document.getElementById('again').addEventListener('click', () => {
    form.reset();
    itemIdInput.value = '';
    pickerBtn.innerHTML = `
      <span class="ph">物品を選択してください</span>
      <span class="arrow">▼</span>
    `;
    qtyErr.hidden = true;
    form.quantity.classList.remove('invalid');
    form.hidden = false;
    done.hidden = true;
    form.organization.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
})();
