// 利用者用 申請フォーム + 物品ピッカー

(async () => {
  const form = document.getElementById('applyForm');
  const done = document.getElementById('done');
  const toast = document.getElementById('toast');
  const qtyErr = document.getElementById('qtyErr');
  const submitBtn = document.getElementById('submitBtn');

  const requestSwitch = document.getElementById('requestSwitch');
  const loanFields = document.getElementById('loanFields');
  const purchaseFields = document.getElementById('purchaseFields');
  const switchButtons = [...requestSwitch.querySelectorAll('.request-switch-btn')];

  const pickerBtn = document.getElementById('itemPickerBtn');
  const pickerModal = document.getElementById('pickerModal');
  const pickerClose = document.getElementById('pickerClose');
  const pickerSearch = document.getElementById('pickerSearch');
  const pickerCats = document.getElementById('pickerCats');
  const pickerList = document.getElementById('pickerList');
  const itemIdInput = document.getElementById('itemIdInput');

  const purchaseImageFile = document.getElementById('purchaseImageFile');
  const purchaseImagePreview = document.getElementById('purchaseImagePreview');
  const purchaseImageDropPlaceholder = document.querySelector('#purchaseImageDrop .placeholder');
  const purchaseImageClear = document.getElementById('purchaseImageClear');

  let requestType = 'loan';
  let purchaseImageDataUrl = '';

  const showToast = msg => {
    toast.textContent = msg;
    toast.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { toast.hidden = true; }, 1800);
  };

  const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));

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

  async function resizeImage(file, maxSize = 320, quality = 0.75) {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });
    let { width, height } = image;
    const ratio = Math.min(1, maxSize / Math.max(width, height));
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(image, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', quality);
  }

  const setPurchasePreview = url => {
    purchaseImageDataUrl = url;
    if (url) {
      purchaseImagePreview.src = url;
      purchaseImagePreview.hidden = false;
      purchaseImageDropPlaceholder.style.display = 'none';
      purchaseImageClear.hidden = false;
    } else {
      purchaseImagePreview.src = '';
      purchaseImagePreview.hidden = true;
      purchaseImageDropPlaceholder.style.display = '';
      purchaseImageClear.hidden = true;
    }
  };

  purchaseImageFile.addEventListener('change', async () => {
    const file = purchaseImageFile.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('画像ファイルを選択してください');
      return;
    }
    try {
      setPurchasePreview(await resizeImage(file));
    } catch (error) {
      showToast('画像の読み込みに失敗しました');
    }
  });
  purchaseImageClear.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    purchaseImageFile.value = '';
    setPurchasePreview('');
  });

  const updateMode = nextType => {
    requestType = nextType === 'purchase' ? 'purchase' : 'loan';
    switchButtons.forEach(button => {
      button.classList.toggle('active', button.dataset.type === requestType);
    });
    loanFields.hidden = requestType !== 'loan';
    purchaseFields.hidden = requestType !== 'purchase';
    form.quantity.required = requestType === 'loan';
    form.purpose.required = requestType === 'loan';
    form.purchase_name.required = requestType === 'purchase';
    form.purchase_quantity.required = requestType === 'purchase';
    submitBtn.textContent = requestType === 'purchase' ? 'この内容で購入申請する' : 'この内容で申請する';
    qtyErr.hidden = true;
    form.quantity.classList.remove('invalid');
  };

  switchButtons.forEach(button => {
    button.addEventListener('click', () => updateMode(button.dataset.type));
  });

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
    hidePicker();
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

  pickerModal.hidden = true;
  pickerModal.style.display = 'none';

  const showPicker = () => {
    pickerModal.hidden = false;
    pickerModal.style.display = 'flex';
  };
  const hidePicker = () => {
    pickerModal.hidden = true;
    pickerModal.style.display = 'none';
  };

  pickerBtn.addEventListener('click', () => {
    pickerSearch.value = '';
    curCat = '';
    pickerCats.querySelectorAll('.pill').forEach((p, i) => p.classList.toggle('active', i === 0));
    showPicker();
    if (!allItems.length) {
      pickerList.innerHTML = '<div class="empty">利用可能な物品がありません<br><span style="font-size:12px">(在庫 > 0 の物品を管理者が追加してください)</span></div>';
    } else {
      renderList();
    }
    setTimeout(() => pickerSearch.focus(), 50);
  });
  pickerClose.addEventListener('click', hidePicker);
  pickerSearch.addEventListener('input', renderList);

  const validateQty = () => {
    if (requestType !== 'loan') {
      qtyErr.hidden = true;
      form.quantity.classList.remove('invalid');
      return true;
    }
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

  try {
    const res = await Api.getItems();
    if (res.error) {
      showToast('物品取得エラー: ' + res.error);
    }
    const items = res.items || [];
    allItems = items.filter(i => i.current_quantity > 0);
    allItems.forEach(i => stockMap.set(String(i.id), i.current_quantity));
    buildCats();
  } catch (error) {
    showToast('物品の取得に失敗: ' + (error.message || error));
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();

    if (requestType === 'loan') {
      if (!itemIdInput.value) {
        showToast('物品を選択してください');
        return;
      }
      if (!validateQty()) return;
    }

    const basePayload = {
      request_type: requestType,
      organization: form.organization.value.trim(),
      user_name: form.user_name.value.trim(),
      email: form.email.value.trim(),
    };

    const payload = requestType === 'purchase'
      ? {
          ...basePayload,
          purchase_name: form.purchase_name.value.trim(),
          purchase_quantity: Number(form.purchase_quantity.value),
          purchase_note: form.purchase_note.value.trim(),
          purchase_image: purchaseImageDataUrl,
        }
      : {
          ...basePayload,
          item_id: Number(itemIdInput.value),
          quantity: Number(form.quantity.value),
          purpose: form.purpose.value.trim(),
        };

    const isInvalid = requestType === 'purchase'
      ? (!payload.purchase_name || !payload.purchase_quantity || !payload.organization || !payload.user_name || !payload.email)
      : (!payload.item_id || !payload.quantity || !payload.organization || !payload.user_name || !payload.email || !payload.purpose);
    if (isInvalid) {
      showToast('必須項目を入力してください');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = requestType === 'purchase' ? '送信中…' : '申請中…';
    const result = await Api.addRequest(payload);
    submitBtn.disabled = false;
    submitBtn.textContent = requestType === 'purchase' ? 'この内容で購入申請する' : 'この内容で申請する';
    if (result.error) {
      showToast('エラー: ' + result.error);
      return;
    }

    done.querySelector('h2').textContent = requestType === 'purchase'
      ? '購入申請を受け付けました'
      : '申請を受け付けました';
    done.querySelector('p').innerHTML = requestType === 'purchase'
      ? '申請内容は管理者が確認後、<br>物品一覧へ反映します。'
      : '申請内容は管理者が確認後、<br>順次対応いたします。';

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
    setPurchasePreview('');
    qtyErr.hidden = true;
    form.quantity.classList.remove('invalid');
    updateMode('loan');
    form.hidden = false;
    done.hidden = true;
    form.organization.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  updateMode('loan');
})();
