# 申請フォームの申請履歴 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 申請フォームに「履歴」ボタンを追加し、団体名か名前で自分たちの申請とステータスを確認できるようにする。

**Architecture:** 絞り込み・表示用の純粋関数を `js/request-history.js`（グローバル `RequestHistory`）に置き、`js/apply.js` はパネルの開閉・取得・描画だけを担う。データは既存の `Api.getRequests()` をパネルを開くたびに取り直す。Apps Script は変更しない。

**Tech Stack:** 素の JavaScript（ビルドなし）、GitHub Pages、テストは `node:assert` + `node:vm`。

## Global Constraints

- 照合は OR 条件（団体名・名前のどちらかが部分一致すればヒット）。両方空なら検索しない。
- 正規化：NFKC、カタカナ→ひらがな、小文字化、空白と `、` `,` `・` `/` を除去。
- ステータス表示名は管理画面と同じ：申請中／受け取り待ち／受け取り済／返却完了／登録済み／却下。
- メールアドレスは表示しない。
- Apps Script（`gas/Code.gs`）は変更しない。

---

### Task 1: 絞り込みロジック `RequestHistory`

**Files:**
- Create: `js/request-history.js`
- Create: `tests/request-history.test.js`
- Modify: `package.json`（test スクリプトに追加）

**Interfaces:**
- Produces（グローバル `RequestHistory`）:
  - `normalize(value: any): string`
  - `filter(requests: object[], { organization?: string, name?: string }): object[]`（新しい順。両方空なら `[]`）
  - `statusLabel(status: string): string`
  - `itemLabel(request: object): string`（例 `マスキングテープ × 4`、購入は `購入：延長コード × 2`）
  - `formatDateTime(value: string): string`（`YYYY/MM/DD HH:mm`、不正値は `''`）

- [ ] **Step 1: 失敗するテストを書く**（`tests/request-history.test.js`）

```js
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
const ids = list => list.map(request => request.id);

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
```

- [ ] **Step 2: 失敗を確認する**

Run: `node tests/request-history.test.js`
Expected: FAIL（`js/request-history.js` が無いので ENOENT）

- [ ] **Step 3: 最小実装**（`js/request-history.js`）

```js
// 申請フォームの申請履歴：DOM に依存しない絞り込み・表示用の関数。
const RequestHistory = (() => {
  const STATUS_LABEL = {
    pending:  '申請中',
    ready:    '受け取り待ち',
    received: '受け取り済',
    returned: '返却完了',
    approved: '登録済み',
    rejected: '却下',
  };

  const kanaToHiragana = value => String(value || '').replace(/[ァ-ヶ]/g, char =>
    String.fromCharCode(char.charCodeAt(0) - 0x60)
  );

  // 団体名・名前の表記ゆれ（カナ/ひらがな、全角/半角、空白、複数名の区切り）を吸収する
  const normalize = value => kanaToHiragana(String(value || '').normalize('NFKC'))
    .toLowerCase()
    .replace(/[\s、,・/]+/g, '');

  const timeOf = request => {
    const time = Date.parse(request.created_at);
    return Number.isNaN(time) ? 0 : time;
  };

  // 団体名か名前のどちらかが部分一致した申請を新しい順に返す
  const filter = (requests, { organization = '', name = '' } = {}) => {
    const organizationQuery = normalize(organization);
    const nameQuery = normalize(name);
    if (!organizationQuery && !nameQuery) return [];
    return (requests || [])
      .filter(request =>
        (organizationQuery && normalize(request.organization).includes(organizationQuery)) ||
        (nameQuery && normalize(request.user_name).includes(nameQuery)))
      .sort((a, b) => timeOf(b) - timeOf(a) || Number(b.id) - Number(a.id));
  };

  const statusLabel = status => STATUS_LABEL[status] || String(status || '');

  const itemLabel = request => {
    const name = request.approved_item_name || request.item_name || request.purchase_name || '';
    const quantity = Number(request.approved_quantity) > 0 ? request.approved_quantity : request.quantity;
    return `${request.request_type === 'purchase' ? '購入：' : ''}${name} × ${quantity}`;
  };

  const pad = value => String(value).padStart(2, '0');
  const formatDateTime = value => {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };

  return { normalize, filter, statusLabel, itemLabel, formatDateTime };
})();
```

- [ ] **Step 4: パスを確認し、test スクリプトに追加**

`package.json` の `test` 末尾に ` && node tests/request-history.test.js` を足す。
Run: `npm test`
Expected: 全テスト PASS（`request history tests passed` を含む）

- [ ] **Step 5: Commit**

```bash
git add js/request-history.js tests/request-history.test.js package.json
git commit -m "Add request history filtering for the apply form"
```

### Task 2: 履歴パネルの画面

**Files:**
- Modify: `apply.html`（ヘッダーのボタン、完了画面のボタン、パネル、スクリプト読み込み、キャッシュ回避）
- Modify: `js/apply.js`（パネルの開閉・取得・描画）
- Modify: `css/style.css`（ヘッダーボタン、検索欄、カード調整）

**Interfaces:**
- Consumes: `RequestHistory.filter / statusLabel / itemLabel / formatDateTime`（Task 1）、`Api.getRequests()`（既存。`{ requests }` か `{ error }` を返す）

- [ ] **Step 1: `apply.html` を変更**

ヘッダー:
```html
  <header class="app-header">
    <span class="header-side" aria-hidden="true"></span>
    <h1>物品申請フォーム</h1>
    <button type="button" class="header-side header-text-btn" id="historyBtn">履歴</button>
  </header>
```
完了画面の「続けて申請する」の下:
```html
      <button type="button" class="btn-outline" id="doneHistory">申請履歴を確認する</button>
```
`pickerModal` の後にパネル:
```html
  <div class="picker-modal" id="historyModal" hidden style="display:none">
    <div class="picker-header">
      <h2>申請履歴</h2>
      <button type="button" class="picker-close" id="historyClose" aria-label="閉じる">×</button>
    </div>
    <form class="history-search" id="historyForm">
      <input name="organization" placeholder="団体名" />
      <input name="name" placeholder="名前" />
      <button type="submit" class="btn-primary green">検索</button>
      <p class="history-hint">団体名か名前のどちらかだけでも検索できます</p>
    </form>
    <div class="history-results" id="historyResults"></div>
  </div>
```
スクリプト（`apply.js` の前に追加し、バージョンを更新）、CSS にもバージョンを付ける:
```html
  <link rel="stylesheet" href="./css/style.css?v=20261021-1" />
  ...
  <script src="./js/request-history.js?v=20261021-1"></script>
  <script src="./js/apply.js?v=20261021-1"></script>
```

- [ ] **Step 2: `js/apply.js` にパネル処理を追加**（`document.getElementById('again')` のリスナーの直後）

```js
  const historyModal = document.getElementById('historyModal');
  const historyForm = document.getElementById('historyForm');
  const historyResults = document.getElementById('historyResults');
  let historyRequestsPromise = null;
  let historySearchGeneration = 0;

  // パネルを開くたびに取り直すので、申請直後でも最新の状態が出る
  const loadHistoryRequests = () => {
    if (!historyRequestsPromise) {
      const promise = Api.getRequests().then(res => {
        if (res.error) throw new Error(res.error);
        return res.requests || [];
      });
      promise.catch(() => {
        if (historyRequestsPromise === promise) historyRequestsPromise = null;
      });
      historyRequestsPromise = promise;
    }
    return historyRequestsPromise;
  };

  const renderHistoryCards = matches => {
    if (!matches.length) {
      historyResults.innerHTML = '<div class="empty">該当する申請が見つかりませんでした。<br>団体名や名前の書き方を変えて試してください。</div>';
      return;
    }
    historyResults.innerHTML = `<div class="history-count">${matches.length}件の申請が見つかりました</div>` + matches.map(r => `
      <div class="req-card history-card">
        <div class="top">
          <span class="status status-${escape(r.status)}">${escape(RequestHistory.statusLabel(r.status))}</span>
          <span class="ts">${escape(RequestHistory.formatDateTime(r.created_at))}</span>
        </div>
        <div class="title">${escape(RequestHistory.itemLabel(r))}</div>
        <div class="info">
          ${escape(r.organization)} / ${escape(r.user_name)}
          ${r.assigned_identifiers?.length ? `<br>識別番号：${escape(r.assigned_identifiers.join(', '))}` : ''}
          ${r.memo ? `<br>管理者メモ：${escape(r.memo)}` : ''}
        </div>
      </div>`).join('');
  };

  const runHistorySearch = async () => {
    const generation = ++historySearchGeneration;
    const query = { organization: historyForm.organization.value, name: historyForm.name.value };
    if (!query.organization.trim() && !query.name.trim()) {
      historyResults.innerHTML = '<div class="empty">団体名か名前を入力して検索してください</div>';
      return;
    }
    historyResults.innerHTML = '<div class="empty">読み込み中…</div>';
    try {
      const requests = await loadHistoryRequests();
      if (generation !== historySearchGeneration) return;
      renderHistoryCards(RequestHistory.filter(requests, query));
    } catch (error) {
      if (generation !== historySearchGeneration) return;
      historyResults.innerHTML = '<div class="empty">申請の取得に失敗しました<br><button type="button" class="history-retry" data-history-retry>再試行</button></div>';
    }
  };

  const openHistory = () => {
    historyRequestsPromise = null;
    historyForm.organization.value = form.organization.value.trim();
    historyForm.name.value = form.user_name.value.trim();
    historyModal.hidden = false;
    historyModal.style.display = 'flex';
    runHistorySearch();
  };

  const closeHistory = () => {
    historySearchGeneration++;
    historyModal.hidden = true;
    historyModal.style.display = 'none';
  };

  document.getElementById('historyBtn').addEventListener('click', openHistory);
  document.getElementById('doneHistory').addEventListener('click', openHistory);
  document.getElementById('historyClose').addEventListener('click', closeHistory);
  historyForm.addEventListener('submit', e => {
    e.preventDefault();
    runHistorySearch();
  });
  historyResults.addEventListener('click', e => {
    if (e.target.closest('[data-history-retry]')) runHistorySearch();
  });
```

- [ ] **Step 3: `css/style.css` に追加**

```css
.header-side { width: 52px; flex: none; }
.header-text-btn {
  background: transparent; border: 1px solid var(--line);
  border-radius: 8px; padding: 6px 0;
  font-size: 13px; font-weight: 700; color: var(--text);
  cursor: pointer;
}
.btn-outline {
  margin-top: 10px; width: 100%; padding: 13px;
  border: 1px solid var(--line); border-radius: 10px;
  background: var(--card); color: var(--text);
  font-size: 15px; font-weight: 700; cursor: pointer;
}
.history-search {
  display: grid; gap: 8px;
  padding: 12px 14px;
  background: #fff;
  border-bottom: 1px solid var(--line);
}
.history-search input {
  width: 100%; padding: 10px 12px;
  border: 1px solid var(--line); border-radius: 8px;
  font-size: 14px;
}
.history-search .btn-primary { margin-top: 0; padding: 11px; }
.history-hint { margin: 0; font-size: 12px; color: var(--sub); text-align: center; }
.history-results { flex: 1; overflow-y: auto; padding: 12px 14px 24px; }
.history-count { font-size: 13px; color: var(--sub); margin-bottom: 8px; }
.history-card { cursor: default; }
.history-retry {
  margin-top: 10px; padding: 8px 18px;
  border: 1px solid var(--line); border-radius: 8px;
  background: var(--card); font-size: 14px; cursor: pointer;
}
```

- [ ] **Step 4: 確認**

Run: `npm test && node --check js/apply.js js/request-history.js && git diff --check`
ブラウザ（本番に push 後、または `npm run dev` のローカル）で：履歴ボタン→団体名「ロジ」で検索→カードが新しい順に出る／名前だけ・両方空・該当なしの表示／申請フォームに団体名を入れてから開くと初期値が入る／閉じるボタン。コンソールに新しいエラーが無いこと。

- [ ] **Step 5: Commit**

```bash
git add apply.html js/apply.js css/style.css
git commit -m "Add request history panel to the apply form"
```
