const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'request-history.js'), 'utf8');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(`${source}\nglobalThis.RequestHistoryForTest = RequestHistory;`, sandbox);
const { normalize, filter, statusLabel, itemLabel, formatDateTime } = sandbox.RequestHistoryForTest;

const requests = [
  { id: 1, organization: 'CONNECT Lab.', user_name: '田島ちひろ、目崎奏介、西村悠呂', item_name: 'マスキングテープ', quantity: 4, status: 'received', created_at: '2026-10-01T06:34:18.293Z' },
  { id: 2, organization: 'ろじ　受付', user_name: '山本詩恩', item_name: '使い捨てリストバンド', quantity: 1, status: 'pending', created_at: '2026-10-20T10:56:00.000Z' },
  { id: 3, organization: '安全管理', user_name: '中島 桜', item_name: '厚紙', quantity: 4, status: 'returned', created_at: '2026-08-06T07:10:00.192Z' },
  { id: 4, organization: 'ロジ', user_name: '松本淳之介', item_name: 'トランシーバー', quantity: 2, status: 'ready', created_at: '2026-09-15T00:00:00.000Z' },
];
const ids = list => [...list].map(request => request.id);

// 正規化：カタカナ/ひらがな、全角/半角、空白・区切り記号の揺れを吸収する
assert.equal(normalize('ロジ'), normalize('ろじ'));
assert.equal(normalize('ＣＯＮＮＥＣＴ'), 'connect');
assert.equal(normalize('中島 桜'), '中島桜');
assert.equal(normalize('田島ちひろ、目崎奏介'), '田島ちひろ目崎奏介');

// 団体名だけ：表記ゆれ込みで部分一致し、新しい順に並ぶ
assert.deepEqual(ids(filter(requests, { organization: 'ロジ' })), [2, 4]);
// 名前だけ：複数名が入った利用者欄でも自分の名前でヒットする
assert.deepEqual(ids(filter(requests, { name: '目崎奏介' })), [1]);
assert.deepEqual(ids(filter(requests, { name: '中島桜' })), [3]);
// OR 条件：どちらかが一致すれば両方とも出る
assert.deepEqual(ids(filter(requests, { organization: '安全管理', name: '山本詩恩' })), [2, 3]);
// 両方空・空白だけなら何も返さない
assert.deepEqual(ids(filter(requests, { organization: ' ', name: '' })), []);
// どれにも一致しない
assert.deepEqual(ids(filter(requests, { organization: '存在しない団体' })), []);

assert.equal(statusLabel('pending'), '申請中');
assert.equal(statusLabel('ready'), '受け取り待ち');
assert.equal(statusLabel('received'), '受け取り済');
assert.equal(statusLabel('returned'), '返却完了');
assert.equal(statusLabel('approved'), '登録済み');
assert.equal(statusLabel('rejected'), '却下');

assert.equal(itemLabel({ request_type: 'loan', item_name: 'マスキングテープ', quantity: 4, approved_quantity: 0 }), 'マスキングテープ × 4');
assert.equal(itemLabel({ request_type: 'purchase', item_name: '延長コード', purchase_name: '延長コード', quantity: 2 }), '購入：延長コード × 2');
assert.equal(itemLabel({ request_type: 'purchase', item_name: '延長コード', approved_item_name: '延長コード 5m', quantity: 2, approved_quantity: 3 }), '購入：延長コード 5m × 3');

assert.match(formatDateTime('2026-10-20T10:56:00.000Z'), /^2026\/10\/2\d \d{2}:\d{2}$/);
assert.equal(formatDateTime(''), '');
assert.equal(formatDateTime('not a date'), '');

console.log('request history tests passed');
