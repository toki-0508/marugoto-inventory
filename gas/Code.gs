/**
 * まるごと祭 物品管理ツール  -  Google Apps Script バックエンド
 *
 * 【セットアップ手順】
 * 1) スプレッドシートを新規作成し、シートを 3 つ用意する
 *    シート名: items
 *      A1: id  B1: name  C1: category  D1: total_quantity  E1: note  F1: image
 *    シート名: transactions
 *      A1: id  B1: item_id  C1: type  D1: quantity  E1: target  F1: timestamp  G1: memo
 *    シート名: requests
 *      A1: id  B1: item_id  C1: item_name  D1: quantity  E1: organization
 *      F1: user_name  G1: purpose  H1: status  I1: created_at  J1: processed_at
 *      K1: memo  L1: email
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
  ensure(ITEMS_SHEET, ['id', 'name', 'category', 'total_quantity', 'note', 'image']);
  ensure(TX_SHEET,    ['id', 'item_id', 'type', 'quantity', 'target', 'timestamp', 'memo']);
  ensure(REQ_SHEET,   ['id', 'item_id', 'item_name', 'quantity', 'organization', 'user_name',
                       'purpose', 'status', 'created_at', 'processed_at', 'memo', 'email']);
  return 'Done';
}

function getItems() {
  const items = _sheet(ITEMS_SHEET).getDataRange().getValues();
  const tx    = _sheet(TX_SHEET).getDataRange().getValues();

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
    const [id, name, category, total, note, image] = items[i];
    if (!id) continue;
    const s = stock[id] || { lent: 0, ret: 0 };
    result.push({
      id, name, category,
      total_quantity: Number(total) || 0,
      current_quantity: (Number(total) || 0) - s.lent + s.ret,
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
        total_quantity: Number(items[i][3]) || 0,
        note: items[i][4] || '',
        image: items[i][5] || ''
      };
      break;
    }
  }
  if (!item) return { error: 'item not found' };

  const tx = _sheet(TX_SHEET).getDataRange().getValues();
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

  item.current_quantity = item.total_quantity - lent + ret;
  item.lent_quantity = lent - ret;
  item.transactions = transactions.reverse();
  item.breakdown = Object.keys(map)
    .filter(k => map[k] > 0)
    .map(k => ({ target: k, quantity: map[k] }));

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
    newId, p.name, p.category || '', Number(p.total_quantity) || 0,
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
      if (p.total_quantity !== undefined) sheet.getRange(row, 4).setValue(Number(p.total_quantity) || 0);
      if (p.note           !== undefined) sheet.getRange(row, 5).setValue(p.note);
      if (p.image          !== undefined) sheet.getRange(row, 6).setValue(p.image);
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
  const sheet = _sheet(REQ_SHEET);
  const values = sheet.getDataRange().getValues();
  const list = [];
  for (let i = 1; i < values.length; i++) {
    const [id, item_id, item_name, qty, organization, user_name, purpose,
           status, created_at, processed_at, memo, email] = values[i];
    if (!id) continue;
    list.push({
      id, item_id, item_name,
      quantity: Number(qty),
      organization, user_name, purpose,
      status: status || 'pending',
      created_at:   created_at   instanceof Date ? created_at.toISOString()   : String(created_at || ''),
      processed_at: processed_at instanceof Date ? processed_at.toISOString() : String(processed_at || ''),
      memo: memo || '',
      email: email || ''
    });
  }
  return { requests: list.reverse() };
}

function addRequest(p) {
  if (!p || !p.item_id || !p.quantity || !p.organization || !p.user_name || !p.purpose) {
    return { error: 'invalid payload' };
  }
  // 物品名はサーバ側で確定させる
  const items = _sheet(ITEMS_SHEET).getDataRange().getValues();
  let item_name = '';
  for (let i = 1; i < items.length; i++) {
    if (items[i][0] == p.item_id) { item_name = items[i][1]; break; }
  }
  if (!item_name) return { error: 'item not found' };

  const sheet = _sheet(REQ_SHEET);
  const newId = _nextId(sheet);
  sheet.appendRow([
    newId, Number(p.item_id), item_name, Number(p.quantity),
    p.organization, p.user_name, p.purpose,
    'pending', new Date(), '', '', p.email || ''
  ]);
  return { success: true, id: newId };
}

function getRequestDetail(id) {
  const sheet = _sheet(REQ_SHEET);
  const values = sheet.getDataRange().getValues();
  let r = null;
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] == id) {
      const v = values[i];
      r = {
        id: v[0], item_id: v[1], item_name: v[2],
        quantity: Number(v[3]),
        organization: v[4], user_name: v[5], purpose: v[6],
        status: v[7] || 'pending',
        created_at:   v[8]  instanceof Date ? v[8].toISOString()  : String(v[8]  || ''),
        processed_at: v[9]  instanceof Date ? v[9].toISOString()  : String(v[9]  || ''),
        memo: v[10] || '',
        email: v[11] || ''
      };
      break;
    }
  }
  if (!r) return { error: 'request not found' };

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
  const allowed = ['pending', 'ready', 'received', 'returned', 'rejected'];
  if (allowed.indexOf(p.status) === -1) return { error: 'invalid status' };

  const sheet = _sheet(REQ_SHEET);
  const values = sheet.getDataRange().getValues();
  let rowIdx = -1, row = null;
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] == p.id) { rowIdx = i + 1; row = values[i]; break; }
  }
  if (rowIdx === -1) return { error: 'request not found' };

  sheet.getRange(rowIdx, 8).setValue(p.status);                    // H: status
  sheet.getRange(rowIdx, 10).setValue(new Date());                 // J: processed_at
  if (p.memo != null) sheet.getRange(rowIdx, 11).setValue(p.memo); // K: memo

  // 受け渡し完了 → lend、返却完了 → return を自動記録
  if (p.status === 'received' || p.status === 'returned') {
    const txSheet = _sheet(TX_SHEET);
    const newId = _nextId(txSheet);
    const target = `${row[4]}（${row[5]}）`; // organization (user_name)
    const isReturn = p.status === 'returned';
    txSheet.appendRow([
      newId, Number(row[1]), isReturn ? 'return' : 'lend',
      Number(row[3]), target, new Date(),
      `申請#${row[0]}${isReturn ? ' 返却' : ''}`
    ]);
  }

  // 承認 (ready) / 却下 (rejected) のときメール通知
  let mail_status = 'skipped';
  let mail_error = '';
  if (p.status === 'ready' || p.status === 'rejected') {
    const email = row[11] || '';
    if (!email) {
      mail_status = 'no_email';
    } else {
      try {
        sendStatusEmail({
          to: email,
          status: p.status,
          requesterName: row[5],
          itemName: row[2],
          quantity: row[3],
          organization: row[4],
          adminComment: p.memo || ''
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
  const isApprove = o.status === 'ready';
  const subject = isApprove
    ? '【まるごと祭 物品管理】申請が承認されました'
    : '【まるごと祭 物品管理】申請が却下されました';
  const lines = [];
  lines.push(`${o.requesterName} 様`);
  lines.push('');
  lines.push(isApprove ? '以下の物品申請が承認されました。' : '以下の物品申請は却下されました。');
  lines.push('');
  lines.push(`物品 : ${o.itemName}`);
  lines.push(`数量 : ${o.quantity}`);
  lines.push(`団体 : ${o.organization}`);
  lines.push('');
  if (o.adminComment) {
    lines.push(isApprove ? '【受け取りについて】' : '【却下理由】');
    lines.push(o.adminComment);
    lines.push('');
  }
  if (isApprove) {
    lines.push('上記の指示に従って受け取りに来てください。');
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
