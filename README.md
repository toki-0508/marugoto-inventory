# まるごと祭 物品管理ツール

イベント運営向けの物品在庫・貸出管理 PWA。Google Apps Script + Google Sheets バックエンド。

## 特徴

- 管理者用画面：物品一覧 / 申請管理 / 物品追加 / ログ
- 利用者用画面：物品 利用申請フォーム
- 申請フロー：申請 → 承認 → 受け渡し → 返却 をステータスで管理
- 商品画像のアップロード対応
- PWA としてホーム画面に追加可能

## 構成

```
index.html              管理者用画面
apply.html              利用者用申請フォーム
css/style.css           スタイル
js/config.js            設定テンプレート（空）
js/config.local.js      個人設定（gitignore）
js/api.js               GAS 通信
js/app.js               管理画面ロジック
js/apply.js             申請画面ロジック
gas/Code.gs             Apps Script バックエンド
```

## セットアップ

### 1. スプレッドシートを作成

新規のスプレッドシートに 3 つのシートをヘッダ付きで作る。

**items**
| A: id | B: name | C: category | D: total_quantity | E: note | F: image |

**transactions**
| A: id | B: item_id | C: type | D: quantity | E: target | F: timestamp | G: memo |

**requests**
| A: id | B: item_id | C: item_name | D: quantity | E: organization | F: user_name | G: purpose | H: status | I: created_at | J: processed_at | K: memo |

### 2. Apps Script を設定

1. スプレッドシートのメニューから「拡張機能 → Apps Script」
2. `gas/Code.gs` の中身を貼り付け
3. 先頭の `SHEET_ID` をスプレッドシート ID（URL の `/d/` と `/edit` の間）に書き換え
4. 「デプロイ → 新しいデプロイ → ウェブアプリ」
   - アクセスできるユーザー：全員
   - 実行するユーザー：自分
5. デプロイ URL をコピー

### 3. ローカル設定

`js/config.local.js` を作成（`.gitignore` 済み）：

```js
window.GAS_URL = 'https://script.google.com/macros/s/XXXXXXXXX/exec';
window.SHEET_URL = 'https://docs.google.com/spreadsheets/d/XXXXXXXXX/edit';
```

### 4. 動作確認

`index.html` をブラウザで開く（ローカルサーバ推奨）。
`config.local.js` がない／`GAS_URL` が空のときはモックデータで動作。

## ステータス遷移

```
申請中 (pending)
  ├─ 承認 ──→ 受け取り待ち (ready)
  │           ├─ 受け渡し完了 ──→ 受け取り済 (received)
  │           │                     └─ 返却完了 ──→ 返却完了 (returned)
  │           └─ 却下 ──→ 却下 (rejected)
  └─ 却下 ──→ 却下 (rejected)
```

- **承認** 時点では在庫は減らない
- **受け渡し完了** 時に lend トランザクション記録 / 在庫減
- **返却完了** 時に return トランザクション記録 / 在庫戻る

## ライセンス

MIT
