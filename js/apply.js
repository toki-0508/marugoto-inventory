// 利用者用 申請フォームのロジック

(async () => {
  const form  = document.getElementById('applyForm');
  const done  = document.getElementById('done');
  const toast = document.getElementById('toast');
  const qtyErr = document.getElementById('qtyErr');

  const showToast = msg => {
    toast.textContent = msg;
    toast.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { toast.hidden = true; }, 1800);
  };

  // 物品の在庫マップ（item_id → 在庫数）
  const stockMap = new Map();

  // 物品セレクト構築
  const sel = form.item_id;
  try {
    const { items = [] } = await Api.getItems();
    items
      .filter(i => i.current_quantity > 0)
      .forEach(i => {
        stockMap.set(String(i.id), i.current_quantity);
        const o = document.createElement('option');
        o.value = i.id;
        o.textContent = `${i.name}（在庫 ${i.current_quantity}）`;
        sel.appendChild(o);
      });
  } catch (e) {
    showToast('物品の取得に失敗しました');
  }

  // 個数バリデーション
  const validateQty = () => {
    const itemId = sel.value;
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
  sel.addEventListener('change', validateQty);

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!validateQty()) return;

    const payload = {
      item_id:      Number(form.item_id.value),
      quantity:     Number(form.quantity.value),
      organization: form.organization.value.trim(),
      user_name:    form.user_name.value.trim(),
      purpose:      form.purpose.value.trim(),
    };
    if (!payload.item_id || !payload.quantity || !payload.organization
        || !payload.user_name || !payload.purpose) return;

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
    qtyErr.hidden = true;
    form.quantity.classList.remove('invalid');
    form.hidden = false;
    done.hidden = true;
    form.organization.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
})();
