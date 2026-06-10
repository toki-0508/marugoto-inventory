# まるごと祭 物品管理ツール

イベント運営向けの物品在庫・貸出管理 PWA。Google Apps Script + Google Sheets バックエンド。

## 特徴

- 管理者用画面：物品一覧 / 申請管理 / 物品追加 / ログ
- 利用者用画面：物品利用申請フォーム / 物品購入申請フォーム
- 貸出申請は 申請 → 承認 → 受け渡し → 返却 をステータスで管理
- 購入申請は管理者が内容を編集して承認すると物品一覧へ登録
- 保管場所は候補として保存され、以後は選択肢から再利用できる
- 申請中 / 承認済みの貸出依頼は「予約済み」として在庫に反映
- 物品ごとに `物品` / `消耗品` を設定できる
- 物品ごとに団体単位の最大貸出数を任意設定できる
- 商品画像のアップロード対応
- PWA としてホーム画面に追加可能

## 構成

```
index.html              管理者用画面
apply.html              利用者用申請フォーム
css/style.css           スタイル
js/config.js            共通設定
js/config.local.js      個人設定（gitignore / 共通設定を上書き）
js/api.js               GAS 通信
js/app.js               管理画面ロジック
js/apply.js             申請画面ロジック
gas/Code.gs             Apps Script バックエンド
```

## セットアップ

### 1. スプレッドシートを作成

新規のスプレッドシートに 4 つのシートをヘッダ付きで作る。

**items**
| A: id | B: name | C: category | D: item_type | E: total_quantity | F: organization_quantity_limit | G: storage_location | H: note | I: image |

- `item_type` には `物品` / `消耗品` を入れる
- 互換のため `equipment` / `consumable` でも動作する
- `organization_quantity_limit` は任意。入力時は同一団体が同時に確保できる最大数として扱う

**transactions**
| A: id | B: item_id | C: type | D: quantity | E: target | F: timestamp | G: memo |

**requests**
| A: id | B: item_id | C: item_name | D: quantity | E: organization | F: user_name | G: purpose | H: status | I: created_at | J: processed_at | K: memo | L: email | M: request_type | N: purchase_name | O: purchase_image | P: purchase_note | Q: purchase_item_type | R: purchase_storage_location | S: approved_item_name | T: approved_category | U: approved_item_type | V: approved_quantity | W: approved_storage_location | X: approved_note | Y: approved_image |

**storage_locations**
| A: id | B: name | C: created_at |

- 保管場所の選択肢はこの `storage_locations` シートで管理する

### 2. Apps Script を設定

1. スプレッドシートのメニューから「拡張機能 → Apps Script」
2. `gas/Code.gs` の中身を貼り付け
3. 先頭の `SHEET_ID` をスプレッドシート ID（URL の `/d/` と `/edit` の間）に書き換え
4. Apps Script エディタで `setupSheets()` を 1 回実行して、`requests` シートの追加列と `storage_locations` シートを揃える
5. 「デプロイ → 新しいデプロイ → ウェブアプリ」
   - アクセスできるユーザー：全員
   - 実行するユーザー：自分
6. デプロイ URL をコピー

### 3. ローカル設定

`js/config.local.example.js` を参考に `js/config.local.js` を作成（`.gitignore` 済み）：

```js
window.GAS_URL = 'https://script.google.com/macros/s/XXXXXXXXX/exec';
window.SHEET_URL = 'https://docs.google.com/spreadsheets/d/XXXXXXXXX/edit';
```

### 4. 動作確認

ローカルサーバを立てて確認する。

```bash
npm run dev
```

`http://localhost:4173/index.html` を開く。
`config.local.js` がない／`GAS_URL` が空のときはモックデータで動作。

## Mac での開発メモ

- 初回のみ: `git clone https://github.com/toki-0508/marugoto-inventory.git`
- 更新取得: `git pull origin main`
- 変更反映: `git add . && git commit -m "..." && git push origin main`
- ローカル設定は `js/config.local.js` にだけ書き、共通設定を直接編集しない

## ステータス遷移

```
申請中 (pending)
  ├─ 承認 ──→ 受け取り待ち (ready)
  │           ├─ 受け渡し完了 ──→ 受け取り済 (received)
  │           │                     └─ 返却完了 ──→ 返却完了 (returned)
  │           └─ 却下 ──→ 却下 (rejected)
  └─ 却下 ──→ 却下 (rejected)
```

- **申請中 / 受け取り待ち** の間は「予約済み」として在庫から差し引く
- **物品** は受け渡し完了で予約済みから貸出中へ移る
- **消耗品** は受け渡し完了で処理完了し、返却は発生せず、総数と在庫が減る
- **返却完了** 時に return トランザクション記録 / 在庫戻る

### 購入申請

```
申請中 (pending)
  ├─ 登録済み (approved)
  └─ 却下 (rejected)
```

- 承認時に管理者がカテゴリ・種別・物品名・総数・保管場所・備考・画像を編集して物品一覧へ登録する

## ライセンス

MIT
