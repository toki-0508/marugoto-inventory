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
  const selectedLoanItemsEl = document.getElementById('selectedLoanItems');
  const pickerModal = document.getElementById('pickerModal');
  const pickerTitle = document.getElementById('pickerTitle');
  const pickerClose = document.getElementById('pickerClose');
  const pickerSearch = document.getElementById('pickerSearch');
  const pickerCats = document.getElementById('pickerCats');
  const pickerList = document.getElementById('pickerList');

  const purchaseImageFile = document.getElementById('purchaseImageFile');
  const purchaseImagePreview = document.getElementById('purchaseImagePreview');
  const purchaseImageDropPlaceholder = document.querySelector('#purchaseImageDrop .placeholder');
  const purchaseImageClear = document.getElementById('purchaseImageClear');

  let requestType = 'loan';
  let purchaseImageDataUrl = '';
  const ITEM_CACHE_KEY = 'marugoto_apply_items_cache_v1';
  const ITEM_CACHE_TTL_MS = 60 * 1000;
  const ITEM_TYPE_OPTIONS = [
    { value: 'equipment', label: '物品' },
    { value: 'electronics', label: '電子機器' },
    { value: 'consumable', label: '消耗品' },
  ];
  const normalizeItemType = value => {
    const raw = String(value || '').trim();
    return (ITEM_TYPE_OPTIONS.find(option => option.value === raw || option.label === raw) || ITEM_TYPE_OPTIONS[0]).value;
  };
  const uniqueNonEmptyValues = values => [...new Set(values.map(v => String(v || '').trim()).filter(Boolean))];
  const bindSelectableField = (select, newInput) => {
    if (!select || !newInput) return () => {};
    const syncVisibility = () => {
      newInput.hidden = select.value !== '__new';
      if (newInput.hidden) newInput.value = '';
    };
    select.addEventListener('change', syncVisibility);
    syncVisibility();
    return syncVisibility;
  };

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
    form.purpose.required = requestType === 'loan';
    form.purchase_name.required = requestType === 'purchase';
    form.purchase_item_type.required = requestType === 'purchase';
    form.purchase_quantity.required = requestType === 'purchase';
    submitBtn.textContent = requestType === 'purchase' ? 'この内容で購入申請する' : 'この内容で申請する';
    qtyErr.hidden = true;
  };

  switchButtons.forEach(button => {
    button.addEventListener('click', () => updateMode(button.dataset.type));
  });

  let allItems = [];
  let curCat = '';
  let curItemType = '';
  let loanRequests = [];
  let itemsLoaded = false;
  let loanRequestsLoaded = false;
  let loanRequestsPromise = null;
  const selectedLoanItems = new Map();
  const stockMap = new Map();
  const itemMap = new Map();
  const organizationInput = form.organization;
  const purchaseStorageLocationSelect = form.purchase_storage_location;
  const purchaseStorageLocationNewInput = form.purchaseStorageLocationNew;
  const syncPurchaseStorageLocationField = bindSelectableField(
    purchaseStorageLocationSelect,
    purchaseStorageLocationNewInput
  );

  const requestCountsTowardOrganizationLimit = (request, itemType) => {
    if (request.request_type !== 'loan') return false;
    if (request.status === 'pending' || request.status === 'ready') return true;
    if (request.status === 'received' && itemType !== 'consumable') return true;
    return false;
  };

  const toFiniteNumber = value => {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  };

  const normalizeAvailableItem = item => {
    const currentQuantity = Number(item.current_quantity);
    const hasCurrentQuantity = item.current_quantity !== undefined &&
      item.current_quantity !== null &&
      item.current_quantity !== '' &&
      Number.isFinite(currentQuantity);
    const fallbackQuantity = Math.max(
      toFiniteNumber(item.total_quantity) - toFiniteNumber(item.reserved_quantity) - toFiniteNumber(item.lent_quantity),
      0
    );
    return {
      ...item,
      total_quantity: toFiniteNumber(item.total_quantity),
      reserved_quantity: toFiniteNumber(item.reserved_quantity),
      lent_quantity: toFiniteNumber(item.lent_quantity),
      item_type: normalizeItemType(item.item_type),
      current_quantity: hasCurrentQuantity ? currentQuantity : fallbackQuantity,
    };
  };

  const readCachedItems = () => {
    try {
      const cached = JSON.parse(sessionStorage.getItem(ITEM_CACHE_KEY) || 'null');
      if (!cached || Date.now() - cached.savedAt > ITEM_CACHE_TTL_MS || !Array.isArray(cached.items)) return [];
      return cached.items;
    } catch (error) {
      return [];
    }
  };

  const writeCachedItems = items => {
    try {
      sessionStorage.setItem(ITEM_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), items }));
    } catch (error) {
      // 容量制限などで失敗しても、通常のAPI取得結果を表示できればよい。
    }
  };

  const applyItems = items => {
    allItems = items.map(normalizeAvailableItem).filter(item => item.current_quantity > 0);
    stockMap.clear();
    itemMap.clear();
    allItems.forEach(item => {
      stockMap.set(String(item.id), item.current_quantity);
      itemMap.set(String(item.id), item);
    });
    itemsLoaded = true;
    buildCats();
    if (!pickerModal.hidden) {
      renderList();
    }
  };

  const loadLoanRequests = async () => {
    if (loanRequestsLoaded) return loanRequests;
    if (!loanRequestsPromise) {
      loanRequestsPromise = Api.getRequests()
        .then(requestsRes => {
          if (requestsRes.error) {
            showToast('申請取得エラー: ' + requestsRes.error);
            return [];
          }
          return requestsRes.requests || [];
        })
        .catch(error => {
          showToast('申請の取得に失敗: ' + (error.message || error));
          return [];
        })
        .then(requests => {
          loanRequests = requests;
          loanRequestsLoaded = true;
          loanRequestsPromise = null;
          return loanRequests;
        });
    }
    return loanRequestsPromise;
  };

  const selectedItemsNeedOrganizationLimit = () =>
    organizationInput.value.trim() &&
    [...selectedLoanItems.values()].some(({ item }) => Number(item.organization_quantity_limit) > 0);

  const getOrganizationAllocatedQuantity = (itemId, organization) => {
    const item = itemMap.get(String(itemId));
    const normalizedOrganization = String(organization || '').trim();
    if (!item || !normalizedOrganization) return 0;
    return loanRequests.reduce((total, request) => {
      if (Number(request.item_id) !== Number(itemId)) return total;
      if (String(request.organization || '').trim() !== normalizedOrganization) return total;
      if (!requestCountsTowardOrganizationLimit(request, item.item_type)) return total;
      return total + (Number(request.quantity) || 0);
    }, 0);
  };

  const getLoanItemQuantityLimit = itemId => {
    const item = itemMap.get(String(itemId));
    if (!item) return 0;
    const stockMax = Number(stockMap.get(String(itemId))) || 0;
    const organizationLimit = Number(item.organization_quantity_limit) || 0;
    const organization = organizationInput.value.trim();
    if (organizationLimit <= 0 || !organization) return stockMax;
    const allocated = getOrganizationAllocatedQuantity(itemId, organization);
    return Math.min(stockMax, Math.max(organizationLimit - allocated, 0));
  };

  const validateLoanSelections = () => {
    if (requestType !== 'loan') {
      qtyErr.hidden = true;
      return true;
    }
    for (const { item, quantity } of selectedLoanItems.values()) {
      const max = getLoanItemQuantityLimit(item.id);
      if (!quantity || quantity < 1) {
        qtyErr.textContent = `${item.name} の個数を入力してください`;
        qtyErr.hidden = false;
        return false;
      }
      if (quantity > max) {
        qtyErr.textContent = `${item.name} は最大 ${max} 個まで申請できます`;
        qtyErr.hidden = false;
        return false;
      }
    }
    qtyErr.hidden = true;
    return true;
  };

  const renderSelectedLoanItems = () => {
    const selections = [...selectedLoanItems.values()];
    if (!selections.length) {
      selectedLoanItemsEl.innerHTML = '<div class="selected-loan-empty">まだ物品が追加されていません</div>';
      return;
    }
    selectedLoanItemsEl.innerHTML = selections.map(({ item, quantity }) => {
      const max = getLoanItemQuantityLimit(item.id);
      const isInvalid = !quantity || quantity < 1 || quantity > max;
      return `
        <div class="selected-loan-item ${isInvalid ? 'invalid' : ''}" data-id="${item.id}">
          <div class="thumb">${
            item.image ? `<img src="${item.image}" alt="">` : pickIcon(item.name, item.category)
          }</div>
          <div class="selected-loan-info">
            <div class="nm">${escape(item.name)}</div>
            <div class="ct">在庫 ${item.current_quantity}${max !== item.current_quantity ? ` / 申請可能 ${max}` : ''}</div>
          </div>
          <input class="selected-loan-qty" data-qty-id="${item.id}" type="number" min="1" max="${max}" value="${quantity}" inputmode="numeric" aria-label="${escape(item.name)}の個数" />
          <button type="button" class="selected-loan-remove" data-remove-id="${item.id}" aria-label="${escape(item.name)}を取り消す">×</button>
        </div>
      `;
    }).join('');
    selectedLoanItemsEl.querySelectorAll('.selected-loan-qty').forEach(input => {
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') event.preventDefault();
      });
      input.addEventListener('input', () => {
        const selected = selectedLoanItems.get(String(input.dataset.qtyId));
        if (!selected) return;
        selected.quantity = Number(input.value);
        validateLoanSelections();
      });
    });
    selectedLoanItemsEl.querySelectorAll('.selected-loan-remove').forEach(button => {
      button.addEventListener('click', () => {
        selectedLoanItems.delete(String(button.dataset.removeId));
        renderSelectedLoanItems();
        validateLoanSelections();
      });
    });
  };

  const addLoanItemSelection = async (item, quantity) => {
    const normalizedQuantity = Number(quantity);
    if (organizationInput.value.trim() && Number(item.organization_quantity_limit) > 0) {
      await loadLoanRequests();
    }
    const max = getLoanItemQuantityLimit(item.id);
    if (!normalizedQuantity || normalizedQuantity < 1) {
      showToast('追加する個数を入力してください');
      return;
    }
    if (normalizedQuantity > max) {
      showToast(`${item.name} は最大 ${max} 個までです`);
      return;
    }
    selectedLoanItems.set(String(item.id), { item, quantity: normalizedQuantity });
    renderSelectedLoanItems();
    renderList();
    validateLoanSelections();
  };

  const renderList = () => {
    const q = pickerSearch.value.trim();
    const filtered = allItems.filter(i =>
      (!curCat || i.category === curCat) &&
      (!curItemType || i.item_type === curItemType) &&
      ItemSearch.matchesItem(i, q)
    );
    if (!filtered.length) {
      pickerList.innerHTML = '<div class="empty">該当する物品がありません</div>';
      return;
    }
    pickerList.innerHTML = filtered.map(i => {
      const max = getLoanItemQuantityLimit(i.id);
      const selected = selectedLoanItems.get(String(i.id));
      return `
        <div class="picker-item" data-id="${i.id}">
          <div class="thumb">${
            i.image ? `<img src="${i.image}" alt="">` : pickIcon(i.name, i.category)
          }</div>
          <div class="info">
            <div class="nm">${escape(i.name)}</div>
            <div class="ct">${escape(i.category || '-')}</div>
            ${i.aliases ? `<div class="ct">別名: ${escape(ItemSearch.formatAliases(i.aliases))}</div>` : ''}
          </div>
          <div class="picker-item-actions">
            <div class="stk">在庫 ${i.current_quantity}</div>
            <input class="picker-qty" data-qty-id="${i.id}" type="number" min="1" max="${max}" value="${selected?.quantity || 1}" inputmode="numeric" aria-label="${escape(i.name)}の個数" ${max <= 0 ? 'disabled' : ''} />
            <button type="button" class="picker-add" data-add-id="${i.id}" ${max <= 0 ? 'disabled' : ''}>${selected ? '更新' : '追加'}</button>
          </div>
        </div>
      `;
    }).join('');
    pickerList.querySelectorAll('.picker-add').forEach(button => {
      button.addEventListener('click', async () => {
        const id = button.dataset.addId;
        const item = allItems.find(candidate => String(candidate.id) === id);
        const qtyInput = button.closest('.picker-item')?.querySelector('.picker-qty');
        if (item) await addLoanItemSelection(item, qtyInput ? qtyInput.value : 1);
      });
    });
    pickerList.querySelectorAll('.picker-qty').forEach(input => {
      input.addEventListener('keydown', async event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        const item = allItems.find(candidate => String(candidate.id) === String(input.dataset.qtyId));
        if (item) await addLoanItemSelection(item, input.value);
      });
    });
  };

  const buildCats = () => {
    const cats = [...new Set(allItems.map(i => i.category).filter(Boolean))];
    pickerCats.innerHTML =
      `<div class="picker-type-row">
        <button type="button" class="pill active" data-type="">すべて</button>
        ${ITEM_TYPE_OPTIONS.map(option => `<button type="button" class="pill" data-type="${option.value}">${option.label}</button>`).join('')}
      </div>` +
      `<button type="button" class="pill active" data-cat="">すべて</button>` +
      cats.map(c => `<button type="button" class="pill" data-cat="${escape(c)}">${escape(c)}</button>`).join('');
    pickerCats.querySelectorAll('.pill[data-type]').forEach(p =>
      p.addEventListener('click', () => {
        pickerCats.querySelectorAll('.pill[data-type]').forEach(x => x.classList.remove('active'));
        p.classList.add('active');
        curItemType = p.dataset.type;
        renderList();
      })
    );
    pickerCats.querySelectorAll('.pill[data-cat]').forEach(p =>
      p.addEventListener('click', () => {
        pickerCats.querySelectorAll('.pill[data-cat]').forEach(x => x.classList.remove('active'));
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
  const showLoanItemList = () => {
    pickerTitle.textContent = '物品を選択';
    pickerSearch.value = '';
    curCat = '';
    curItemType = '';
    pickerCats.querySelectorAll('.pill[data-cat]').forEach((p, i) => p.classList.toggle('active', i === 0));
    pickerCats.querySelectorAll('.pill[data-type]').forEach((p, i) => p.classList.toggle('active', i === 0));
    showPicker();
    if (!itemsLoaded) {
      pickerList.innerHTML = '<div class="loading">読み込み中…</div>';
    } else if (!allItems.length) {
      pickerList.innerHTML = '<div class="empty">利用可能な物品がありません<br><span style="font-size:12px">(在庫 > 0 の物品を管理者が追加してください)</span></div>';
    } else {
      renderList();
    }
    setTimeout(() => pickerSearch.focus(), 50);
  };

  pickerBtn.addEventListener('click', () => {
    showLoanItemList();
  });
  pickerClose.addEventListener('click', hidePicker);
  pickerSearch.addEventListener('input', renderList);
  form.organization.addEventListener('input', () => {
    renderSelectedLoanItems();
    validateLoanSelections();
    if (!pickerModal.hidden) renderList();
    if (selectedItemsNeedOrganizationLimit()) {
      loadLoanRequests().then(() => {
        renderSelectedLoanItems();
        validateLoanSelections();
        if (!pickerModal.hidden) renderList();
      });
    }
  });

  const cachedItems = readCachedItems();
  if (cachedItems.length) {
    applyItems(cachedItems);
  }

  try {
    const itemsRes = await Api.getItems();
    if (itemsRes.error) {
      showToast('物品取得エラー: ' + itemsRes.error);
    }
    const items = itemsRes.items || [];
    writeCachedItems(items);
    applyItems(items);

    Api.getStorageLocations()
      .then(storageLocationsRes => {
        if (storageLocationsRes.error) {
          showToast('保管場所取得エラー: ' + storageLocationsRes.error);
          return;
        }
        const storageLocations = uniqueNonEmptyValues([
          ...(storageLocationsRes.storage_locations || []),
          ...items.map(item => item.storage_location),
        ]);
        purchaseStorageLocationSelect.innerHTML = `
          <option value="">選択してください</option>
          ${storageLocations.map(location => `<option>${escape(location)}</option>`).join('')}
          <option value="__new">＋ 新しい保管場所</option>
        `;
        syncPurchaseStorageLocationField();
      })
      .catch(error => {
        showToast('保管場所の取得に失敗: ' + (error.message || error));
      });
  } catch (error) {
    itemsLoaded = true;
    showToast('物品の取得に失敗: ' + (error.message || error));
    if (!pickerModal.hidden) {
      pickerList.innerHTML = '<div class="empty">物品の取得に失敗しました</div>';
    }
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();

    if (requestType === 'loan') {
      if (!selectedLoanItems.size) {
        showToast('物品を1つ以上追加してください');
        return;
      }
      if (selectedItemsNeedOrganizationLimit()) {
        await loadLoanRequests();
      }
      if (!validateLoanSelections()) return;
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
          purchase_item_type: form.purchase_item_type.value,
          purchase_quantity: Number(form.purchase_quantity.value),
          purchase_storage_location: form.purchase_storage_location.value === '__new'
            ? form.purchaseStorageLocationNew.value.trim()
            : form.purchase_storage_location.value.trim(),
          purchase_note: form.purchase_note.value.trim(),
          purchase_image: purchaseImageDataUrl,
        }
      : null;

    const isInvalid = requestType === 'purchase'
      ? (!payload.purchase_name || !payload.purchase_item_type || !payload.purchase_quantity || !payload.organization || !payload.user_name || !payload.email)
      : (!basePayload.organization || !basePayload.user_name || !basePayload.email || !form.purpose.value.trim());
    if (isInvalid) {
      showToast('必須項目を入力してください');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = requestType === 'purchase' ? '送信中…' : '申請中…';
    let result = null;
    let submittedCount = 0;
    if (requestType === 'purchase') {
      result = await Api.addRequest(payload);
    } else {
      const purpose = form.purpose.value.trim();
      for (const { item, quantity } of selectedLoanItems.values()) {
        result = await Api.addRequest({
          ...basePayload,
          item_id: Number(item.id),
          quantity,
          purpose,
        });
        if (result.error) break;
        submittedCount += 1;
      }
    }
    submitBtn.disabled = false;
    submitBtn.textContent = requestType === 'purchase' ? 'この内容で購入申請する' : 'この内容で申請する';
    if (result.error) {
      showToast(submittedCount
        ? `一部申請済みです（${submittedCount}件成功）: ${result.error}`
        : 'エラー: ' + result.error);
      return;
    }

    done.querySelector('h2').textContent = requestType === 'purchase'
      ? '購入申請を受け付けました'
      : '申請を受け付けました';
    done.querySelector('p').innerHTML = requestType === 'purchase'
      ? '申請内容は管理者が確認後、<br>物品一覧へ反映します。'
      : `${selectedLoanItems.size}件の申請内容は管理者が確認後、<br>順次対応いたします。`;

    form.hidden = true;
    done.hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  document.getElementById('again').addEventListener('click', () => {
    form.reset();
    selectedLoanItems.clear();
    renderSelectedLoanItems();
    setPurchasePreview('');
    syncPurchaseStorageLocationField();
    qtyErr.hidden = true;
    updateMode('loan');
    form.hidden = false;
    done.hidden = true;
    form.organization.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  updateMode('loan');
})();
