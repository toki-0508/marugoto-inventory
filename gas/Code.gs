/**
 * まるごと祭 物品管理ツール  -  Google Apps Script バックエンド
 *
 * 【セットアップ手順】
 * 1) スプレッドシートを新規作成し、シートを 3 つ用意する
 *    シート名: items
 *      A1: id  B1: name  C1: category  D1: item_type  E1: total_quantity  F1: note  G1: image
 *    シート名: transactions
 *      A1: id  B1: item_id  C1: type  D1: quantity  E1: target  F1: timestamp  G1: memo
 *    シート名: requests
 *      A1: id  B1: item_id  C1: item_name  D1: quantity  E1: organization
 *      F1: user_name  G1: purpose  H1: status  I1: created_at  J1: processed_at
 *      K1: memo  L1: email  M1: request_type  N1: purchase_name  O1: purchase_image
 *      P1: purchase_note  Q1: purchase_item_type  R1: approved_item_name  S1: approved_category
 *      T1: approved_item_type  U1: approved_quantity  V1: approved_note  W1: approved_image
 *
 * 2) Apps Script エディタを開いて、このファイルの中身を貼り付ける
 *
 * 3) 下の SHEET_ID をそのスプレッドシートの ID に書き換える
 *    （URL の /d/ と /edit の間の文字列）
 *
 * 4) [デプロイ] → [新しいデプロイ] → 種類: ウェブアプリ
 *    アクセスできるユーザー: 全員（リンクを知っている全員）
 *    実行するユーザー: 自分
 *    デプロイ後に表示される URL を js/config.js の GAS_URL に貼る
 */

const SHEET_ID = '';                 // ← デプロイ時に各自のスプレッドシート ID を設定
const ITEMS_SHEET = 'items';
const TX_SHEET = 'transactions';
const REQ_SHEET = 'requests';
const ACTIVE_RESERVATION_STATUSES = { pending: true, ready: true };
const ITEM_TYPE_LABELS = { equipment: '物品', consumable: '消耗品' };

function doGet(e) {
  return _respond(() => {
    const action = (e && e.parameter && e.parameter.action) || '';
    switch (action) {
      case 'getItems':      return getItems();
      case 'getItemDetail': return getItemDetail(Number(e.parameter.id));
      case 'getLogs':       return getLogs();
      case 'getRequests':       return getRequests();
      case 'getRequestDetail':  return getRequestDetail(Number(e.parameter.id));
      default:              return { error: 'unknown action: ' + action };
    }
  });
}

function doPost(e) {
  return _respond(() => {
    const body = JSON.parse(e.postData.contents);
    switch (body.action) {
      case 'addTransaction':       return addTransaction(body.payload);
      case 'addItem':              return addItem(body.payload);
      case 'updateItem':           return updateItem(body.payload);
      case 'deleteItem':           return deleteItem(body.payload);
      case 'addRequest':           return addRequest(body.payload);
      case 'updateRequestStatus':  return updateRequestStatus(body.payload);
      default:                     return { error: 'unknown action: ' + body.action };
    }
  });
}

function _respond(fn) {
  let out;
  try { out = fn(); } catch (err) { out = { error: String(err && err.message || err) }; }
  return ContentService
    .createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

function _sheet(name) {
  if (!SHEET_ID) throw new Error('SHEET_ID が未設定です。Code.gs の冒頭にスプレッドシート ID を入れてください。');
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(name);
  if (!sheet) {
    throw new Error(`シート「${name}」が見つかりません。Apps Script の setupSheets() を一度実行してください。`);
  }
  return sheet;
}

// 既存 ID の最大値 + 1 を返す（行削除があっても衝突しない）
function _nextId(sheet) {
  const data = sheet.getDataRange().getValues();
  let max = 0;
  for (let i = 1; i < data.length; i++) {
    const id = Number(data[i][0]);
    if (!isNaN(id) && id > max) max = id;
  }
  return max + 1;
}

function _toIso(value) {
  return value instanceof Date ? value.toISOString() : String(value || '');
}

function _requestHeaders() {
  return [
    'id', 'item_id', 'item_name', 'quantity', 'organization', 'user_name',
    'purpose', 'status', 'created_at', 'processed_at', 'memo', 'email',
    'request_type', 'purchase_name', 'purchase_image', 'purchase_note', 'purchase_item_type',
    'approved_item_name', 'approved_category', 'approved_item_type', 'approved_quantity',
    'approved_note', 'approved_image'
  ];
}

function _normalizeRequestRow(row) {
  return {
    id: row[0],
    item_id: row[1],
    item_name: row[2] || '',
    quantity: Number(row[3]) || 0,
    organization: row[4] || '',
    user_name: row[5] || '',
    purpose: row[6] || '',
    status: row[7] || 'pending',
    created_at: _toIso(row[8]),
    processed_at: _toIso(row[9]),
    memo: row[10] || '',
    email: row[11] || '',
    request_type: row[12] || 'loan',
    purchase_name: row[13] || '',
    purchase_image: row[14] || '',
    purchase_note: row[15] || '',
    purchase_item_type: row[16] || 'equipment',
    approved_item_name: row[17] || '',
    approved_category: row[18] || '',
    approved_item_type: row[19] || '',
    approved_quantity: Number(row[20]) || 0,
    approved_note: row[21] || '',
    approved_image: row[22] || ''
  };
}

function _getRequestsData() {
  const values = _sheet(REQ_SHEET).getDataRange().getValues();
  const list = [];
  for (let i = 1; i < values.length; i++) {
    if (!values[i][0]) continue;
    list.push(_normalizeRequestRow(values[i]));
  }
  return list;
}

function _getReservationMap() {
  const map = {};
  const requests = _getRequestsData();
  for (let i = 0; i < requests.length; i++) {
    const req = requests[i];
    if (req.request_type !== 'loan') continue;
    if (!ACTIVE_RESERVATION_STATUSES[req.status]) continue;
    const itemId = req.item_id;
    if (!itemId) continue;
    if (!map[itemId]) map[itemId] = { reserved: 0, breakdown: {} };
    map[itemId].reserved += req.quantity;
    const target = req.organization + '（' + req.user_name + '）';
    map[itemId].breakdown[target] = (map[itemId].breakdown[target] || 0) + req.quantity;
  }
  return map;
}

function _buildApprovedPurchaseDraft(req, approvedItem) {
  const quantity = Number(
    (approvedItem && approvedItem.total_quantity) || req.approved_quantity || req.quantity || 0
  ) || 0;
  return {
    name: (approvedItem && approvedItem.name) || req.approved_item_name || req.purchase_name || req.item_name || '',
    category: (approvedItem && approvedItem.category) || req.approved_category || '',
    item_type: (approvedItem && approvedItem.item_type) || req.approved_item_type || req.purchase_item_type || 'equipment',
    total_quantity: quantity,
    note: (approvedItem && approvedItem.note) || req.approved_note || req.purchase_note || '',
    image: (approvedItem && approvedItem.image) || req.approved_image || req.purchase_image || ''
  };
}

/**
 * 必要な 3 シートをヘッダ付きで自動作成する。
 * Apps Script のエディタで関数選択 → 実行ボタンを押すだけ。
 */
function setupSheets() {
  if (!SHEET_ID) throw new Error('SHEET_ID が未設定です');
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const ensure = (name, headers) => {
    let s = ss.getSheetByName(name);
    if (!s) s = ss.insertSheet(name);
    const lastCol = s.getLastColumn();
    if (lastCol === 0) {
      s.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
      s.setFrozenRows(1);
    } else if (lastCol < headers.length) {
      const add = headers.slice(lastCol);
      s.getRange(1, lastCol + 1, 1, add.length).setValues([add]).setFontWeight('bold');
    }
  };
  ensure(ITEMS_SHEET, ['id', 'name', 'category', 'item_type', 'total_quantity', 'note', 'image']);
  ensure(TX_SHEET,    ['id', 'item_id', 'type', 'quantity', 'target', 'timestamp', 'memo']);
  ensure(REQ_SHEET, _requestHeaders());
  return 'Done';
}

function getItems() {
  const items = _sheet(ITEMS_SHEET).getDataRange().getValues();
  const tx    = _sheet(TX_SHEET).getDataRange().getValues();
  const reservations = _getReservationMap();

  const stock = {};
  for (let i = 1; i < tx.length; i++) {
    const [, item_id, type, qty] = tx[i];
    if (!item_id) continue;
    if (!stock[item_id]) stock[item_id] = { lent: 0, ret: 0 };
    if (type === 'lend')   stock[item_id].lent += Number(qty);
    if (type === 'return') stock[item_id].ret  += Number(qty);
  }

  const result = [];
  for (let i = 1; i < items.length; i++) {
    const [id, name, category, itemType, total, note, image] = items[i];
    if (!id) continue;
    const s = stock[id] || { lent: 0, ret: 0 };
    const reserved = reservations[id] ? reservations[id].reserved : 0;
    result.push({
      id, name, category,
      item_type: itemType || 'equipment',
      item_type_label: ITEM_TYPE_LABELS[itemType] || ITEM_TYPE_LABELS.equipment,
      total_quantity: Number(total) || 0,
      current_quantity: (Number(total) || 0) - reserved - s.lent + s.ret,
      reserved_quantity: reserved,
      lent_quantity: s.lent - s.ret,
      note: note || '',
      image: image || ''
    });
  }
  return { items: result };
}

function getItemDetail(itemId) {
  const items = _sheet(ITEMS_SHEET).getDataRange().getValues();
  let item = null;
  for (let i = 1; i < items.length; i++) {
    if (items[i][0] == itemId) {
      item = {
        id: items[i][0], name: items[i][1], category: items[i][2],
        item_type: items[i][3] || 'equipment',
        item_type_label: ITEM_TYPE_LABELS[items[i][3]] || ITEM_TYPE_LABELS.equipment,
        total_quantity: Number(items[i][4]) || 0,
        note: items[i][5] || '',
        image: items[i][6] || ''
      };
      break;
    }
  }
  if (!item) return { error: 'item not found' };

  const tx = _sheet(TX_SHEET).getDataRange().getValues();
  const reservations = _getReservationMap();
  const transactions = [];
  const map = {};
  let lent = 0, ret = 0;
  for (let i = 1; i < tx.length; i++) {
    const [id, iid, type, qty, target, ts, memo] = tx[i];
    if (iid != itemId) continue;
    const q = Number(qty);
    transactions.push({
      id, item_id: iid, type, quantity: q, target,
      timestamp: ts instanceof Date ? ts.toISOString() : String(ts),
      memo: memo || ''
    });
    if (type === 'lend')   { lent += q; map[target] = (map[target] || 0) + q; }
    if (type === 'return') { ret  += q; map[target] = (map[target] || 0) - q; }
  }

  const reservation = reservations[itemId] || { reserved: 0, breakdown: {} };
  item.current_quantity = item.total_quantity - reservation.reserved - lent + ret;
  item.reserved_quantity = reservation.reserved;
  item.lent_quantity = lent - ret;
  item.transactions = transactions.reverse();
  item.breakdown = Object.keys(map)
    .filter(k => map[k] > 0)
    .map(k => ({ target: k, quantity: map[k] }));
  item.reserved_breakdown = Object.keys(reservation.breakdown)
    .map(k => ({ target: k, quantity: reservation.breakdown[k] }));

  return { item };
}

function addTransaction(p) {
  if (!p || !p.item_id || !p.type || !p.quantity || !p.target) {
    return { error: 'invalid payload' };
  }
  const sheet = _sheet(TX_SHEET);
  const newId = _nextId(sheet);
  sheet.appendRow([
    newId, Number(p.item_id), p.type, Number(p.quantity),
    p.target, new Date(), p.memo || ''
  ]);
  return { success: true, id: newId };
}

function addItem(p) {
  if (!p || !p.name) return { error: 'invalid payload' };
  const sheet = _sheet(ITEMS_SHEET);
  const newId = _nextId(sheet);
  sheet.appendRow([
    newId, p.name, p.category || '', p.item_type || 'equipment', Number(p.total_quantity) || 0,
    p.note || '', p.image || ''
  ]);
  return { success: true, id: newId };
}

function updateItem(p) {
  if (!p || !p.id) return { error: 'invalid payload' };
  const sheet = _sheet(ITEMS_SHEET);
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] == p.id) {
      const row = i + 1;
      if (p.name           !== undefined) sheet.getRange(row, 2).setValue(p.name);
      if (p.category       !== undefined) sheet.getRange(row, 3).setValue(p.category);
      if (p.item_type      !== undefined) sheet.getRange(row, 4).setValue(p.item_type || 'equipment');
      if (p.total_quantity !== undefined) sheet.getRange(row, 5).setValue(Number(p.total_quantity) || 0);
      if (p.note           !== undefined) sheet.getRange(row, 6).setValue(p.note);
      if (p.image          !== undefined) sheet.getRange(row, 7).setValue(p.image);
      return { success: true };
    }
  }
  return { error: 'item not found' };
}

function deleteItem(p) {
  if (!p || !p.id) return { error: 'invalid payload' };
  const sheet = _sheet(ITEMS_SHEET);
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] == p.id) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { error: 'item not found' };
}

function getRequests() {
  const items = _sheet(ITEMS_SHEET).getDataRange().getValues();
  const itemTypes = {};
  for (let i = 1; i < items.length; i++) {
    itemTypes[items[i][0]] = items[i][3] || 'equipment';
  }
  return {
    requests: _getRequestsData().map(request => ({
      ...request,
      item_type: request.request_type === 'loan' ? (itemTypes[request.item_id] || 'equipment') : ''
    })).reverse()
  };
}

function addRequest(p) {
  if (!p || !p.organization || !p.user_name || !p.email) {
    return { error: 'invalid payload' };
  }
  const requestType = p.request_type === 'purchase' ? 'purchase' : 'loan';
  const items = _sheet(ITEMS_SHEET).getDataRange().getValues();
  let item_id = '';
  let item_name = '';
  let quantity = 0;
  let purpose = '';
  let purchase_name = '';
  let purchase_image = '';
  let purchase_note = '';
  let purchase_item_type = 'equipment';

  if (requestType === 'loan') {
    if (!p.item_id || !p.quantity || !p.purpose) return { error: 'invalid payload' };
    let item = null;
    for (let i = 1; i < items.length; i++) {
      if (items[i][0] == p.item_id) {
        item = {
          id: items[i][0],
          name: items[i][1],
          total_quantity: Number(items[i][4]) || 0
        };
        break;
      }
    }
    if (!item) return { error: 'item not found' };

    const tx = _sheet(TX_SHEET).getDataRange().getValues();
    let lent = 0;
    let ret = 0;
    for (let i = 1; i < tx.length; i++) {
      if (tx[i][1] != item.id) continue;
      if (tx[i][2] === 'lend') lent += Number(tx[i][3]) || 0;
      if (tx[i][2] === 'return') ret += Number(tx[i][3]) || 0;
    }
    const reservations = _getReservationMap();
    const reserved = reservations[item.id] ? reservations[item.id].reserved : 0;
    const available = item.total_quantity - reserved - lent + ret;
    quantity = Number(p.quantity) || 0;
    if (!quantity || quantity > available) {
      return { error: '在庫不足です（利用可能 ' + available + '）' };
    }
    item_id = Number(p.item_id);
    item_name = item.name;
    purpose = p.purpose;
  } else {
    purchase_name = String(p.purchase_name || '').trim();
    quantity = Number(p.purchase_quantity) || 0;
    purchase_image = p.purchase_image || '';
    purchase_note = p.purchase_note || '';
    purchase_item_type = p.purchase_item_type || 'equipment';
    if (!purchase_name || !quantity) return { error: 'invalid payload' };
    item_name = purchase_name;
  }

  const sheet = _sheet(REQ_SHEET);
  const newId = _nextId(sheet);
  sheet.appendRow([
    newId, item_id ? Number(item_id) : '', item_name, quantity,
    p.organization, p.user_name, purpose,
    'pending', new Date(), '', '', p.email || '',
    requestType, purchase_name, purchase_image, purchase_note, purchase_item_type,
    '', '', '', '', '', ''
  ]);
  return { success: true, id: newId };
}

function getRequestDetail(id) {
  const values = _sheet(REQ_SHEET).getDataRange().getValues();
  let r = null;
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] == id) {
      r = _normalizeRequestRow(values[i]);
      break;
    }
  }
  if (!r) return { error: 'request not found' };
  if (r.request_type === 'loan') {
    const items = _sheet(ITEMS_SHEET).getDataRange().getValues();
    for (let i = 1; i < items.length; i++) {
      if (items[i][0] == r.item_id) {
        r.item_type = items[i][3] || 'equipment';
        break;
      }
    }
  }

  const tag = '申請#' + r.id;
  const tx = _sheet(TX_SHEET).getDataRange().getValues();
  const transactions = [];
  for (let i = 1; i < tx.length; i++) {
    const memo = String(tx[i][6] || '');
    if (memo.indexOf(tag) !== 0) continue;
    transactions.push({
      id: tx[i][0], item_id: tx[i][1], type: tx[i][2],
      quantity: Number(tx[i][3]), target: tx[i][4],
      timestamp: tx[i][5] instanceof Date ? tx[i][5].toISOString() : String(tx[i][5]),
      memo
    });
  }
  r.transactions = transactions.reverse();
  return { request: r };
}

function updateRequestStatus(p) {
  if (!p || !p.id || !p.status) return { error: 'invalid payload' };
  const allowed = ['pending', 'ready', 'received', 'returned', 'rejected', 'approved'];
  if (allowed.indexOf(p.status) === -1) return { error: 'invalid status' };

  const sheet = _sheet(REQ_SHEET);
  const values = sheet.getDataRange().getValues();
  let rowIdx = -1, row = null;
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] == p.id) { rowIdx = i + 1; row = values[i]; break; }
  }
  if (rowIdx === -1) return { error: 'request not found' };

  const request = _normalizeRequestRow(row);
  if (request.request_type === 'purchase' && p.status === 'approved' && request.status === 'approved') {
    return { error: 'already approved' };
  }
  if (request.request_type === 'purchase' && p.status === 'approved') {
    const approvedItem = p.approved_item || {};
    const draft = _buildApprovedPurchaseDraft(request, approvedItem);
    if (!draft.name || !draft.category || !draft.item_type || !draft.total_quantity) {
      return { error: 'approved item is invalid' };
    }
    const itemSheet = _sheet(ITEMS_SHEET);
    const newItemId = _nextId(itemSheet);
    itemSheet.appendRow([
      newItemId, draft.name, draft.category, draft.item_type, draft.total_quantity, draft.note, draft.image
    ]);
    sheet.getRange(rowIdx, 18).setValue(draft.name);            // R: approved_item_name
    sheet.getRange(rowIdx, 19).setValue(draft.category);        // S: approved_category
    sheet.getRange(rowIdx, 20).setValue(draft.item_type);       // T: approved_item_type
    sheet.getRange(rowIdx, 21).setValue(draft.total_quantity);  // U: approved_quantity
    sheet.getRange(rowIdx, 22).setValue(draft.note);            // V: approved_note
    sheet.getRange(rowIdx, 23).setValue(draft.image);           // W: approved_image
  }

  sheet.getRange(rowIdx, 8).setValue(p.status);                    // H: status
  sheet.getRange(rowIdx, 10).setValue(new Date());                 // J: processed_at
  if (p.memo != null) sheet.getRange(rowIdx, 11).setValue(p.memo); // K: memo

  // 受け渡し完了 → lend、返却完了 → return を自動記録
  if (request.request_type === 'loan' && (p.status === 'received' || p.status === 'returned')) {
    const txSheet = _sheet(TX_SHEET);
    const itemSheet = _sheet(ITEMS_SHEET);
    const itemValues = itemSheet.getDataRange().getValues();
    let itemRowIdx = -1;
    let itemType = 'equipment';
    let itemTotal = 0;
    for (let i = 1; i < itemValues.length; i++) {
      if (itemValues[i][0] == request.item_id) {
        itemRowIdx = i + 1;
        itemType = itemValues[i][3] || 'equipment';
        itemTotal = Number(itemValues[i][4]) || 0;
        break;
      }
    }
    const target = request.organization + '（' + request.user_name + '）';
    const isReturn = p.status === 'returned';
    const newId = _nextId(txSheet);
    if (p.status === 'received' && itemType === 'consumable') {
      if (itemRowIdx === -1) return { error: 'item not found' };
      itemSheet.getRange(itemRowIdx, 5).setValue(Math.max(0, itemTotal - Number(request.quantity)));
      txSheet.appendRow([
        newId, Number(request.item_id), 'consume',
        Number(request.quantity), target, new Date(),
        '申請#' + request.id + ' 消耗'
      ]);
    } else {
      txSheet.appendRow([
        newId, Number(request.item_id), isReturn ? 'return' : 'lend',
        Number(request.quantity), target, new Date(),
        '申請#' + request.id + (isReturn ? ' 返却' : '')
      ]);
    }
  }

  // 承認 / 却下 のときメール通知
  let mail_status = 'skipped';
  let mail_error = '';
  if (p.status === 'ready' || p.status === 'approved' || p.status === 'rejected') {
    const email = request.email || '';
    if (!email) {
      mail_status = 'no_email';
    } else {
      try {
        sendStatusEmail({
          to: email,
          status: p.status,
          requestType: request.request_type,
          requesterName: request.user_name,
          itemName: request.item_name,
          itemType: request.item_type,
          quantity: request.quantity,
          organization: request.organization,
          adminComment: p.memo || '',
          approvedItemName: request.request_type === 'purchase'
            ? ((p.approved_item && p.approved_item.name) || request.approved_item_name || request.purchase_name || request.item_name)
            : '',
          approvedItemType: request.request_type === 'purchase'
            ? ((p.approved_item && p.approved_item.item_type) || request.approved_item_type || request.purchase_item_type || 'equipment')
            : ''
        });
        mail_status = 'sent';
      } catch (e) {
        mail_status = 'failed';
        mail_error = String(e && e.message || e);
        console.error('Email send failed:', mail_error);
      }
    }
  }

  return { success: true, mail_status: mail_status, mail_error: mail_error };
}

/**
 * メール送信テスト用。Apps Script のエディタで関数選択 → 実行。
 * 初回は MailApp の権限承認ダイアログが出る → 許可してください。
 * 自分のメールアドレス宛にテストメールが届けば OK。
 */
function testEmail() {
  const me = Session.getActiveUser().getEmail();
  if (!me) throw new Error('実行ユーザーのメールアドレスが取得できません');
  MailApp.sendEmail(me, '【テスト】まるごと祭 物品管理', 'メール送信が正しく動いています。');
  return 'sent to ' + me;
}

function sendStatusEmail(o) {
  const isRejected = o.status === 'rejected';
  const isPurchase = o.requestType === 'purchase';
  const isApprove = !isRejected;
  const subject = isRejected
    ? '【まるごと祭 物品管理】申請が却下されました'
    : isPurchase
      ? '【まるごと祭 物品管理】購入申請が承認されました'
      : '【まるごと祭 物品管理】申請が承認されました';
  const lines = [];
  lines.push(`${o.requesterName} 様`);
  lines.push('');
  if (isPurchase) {
    lines.push(isApprove ? '以下の物品購入申請が承認されました。' : '以下の物品購入申請は却下されました。');
  } else {
    lines.push(isApprove ? '以下の物品申請が承認されました。' : '以下の物品申請は却下されました。');
  }
  lines.push('');
  lines.push(`物品 : ${o.approvedItemName || o.itemName}`);
  if (o.approvedItemType || o.itemType) {
    lines.push(`種別 : ${ITEM_TYPE_LABELS[o.approvedItemType || o.itemType] || ITEM_TYPE_LABELS.equipment}`);
  }
  lines.push(`数量 : ${o.quantity}`);
  lines.push(`団体 : ${o.organization}`);
  lines.push('');
  if (o.adminComment) {
    lines.push(isApprove && !isPurchase ? '【受け取りについて】' : isApprove ? '【管理者コメント】' : '【却下理由】');
    lines.push(o.adminComment);
    lines.push('');
  }
  if (isApprove && !isPurchase) {
    lines.push('上記の指示に従って受け取りに来てください。');
    lines.push('');
  } else if (isApprove && isPurchase) {
    lines.push('承認後の内容で物品一覧へ登録しました。');
    lines.push('');
  }
  lines.push('-- まるごと祭 物品管理');
  MailApp.sendEmail(o.to, subject, lines.join('\n'));
}

function getLogs() {
  const items = _sheet(ITEMS_SHEET).getDataRange().getValues();
  const names = {};
  for (let i = 1; i < items.length; i++) names[items[i][0]] = items[i][1];

  const tx = _sheet(TX_SHEET).getDataRange().getValues();
  const logs = [];
  for (let i = 1; i < tx.length; i++) {
    const [id, iid, type, qty, target, ts, memo] = tx[i];
    if (!id) continue;
    logs.push({
      id, item_id: iid, item_name: names[iid] || '?',
      type, quantity: Number(qty), target,
      timestamp: ts instanceof Date ? ts.toISOString() : String(ts),
      memo: memo || ''
    });
  }
  return { logs: logs.reverse() };
}
