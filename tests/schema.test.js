const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const gasSource = fs.readFileSync(path.join(__dirname, '..', 'gas', 'Code.gs'), 'utf8');
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(`
${gasSource}
globalThis.SchemaTestApi = {
  ensureItemTypeColumn: _ensureItemTypeColumn,
  ensureSheetHeaders: _ensureSheetHeaders,
  backfillMissingItemCategories: _backfillMissingItemCategories,
  inventoryQuantities: _inventoryQuantities,
};
`, sandbox);

class FakeRange {
  constructor(sheet, row, column, rowCount = 1, columnCount = 1) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    this.rowCount = rowCount;
    this.columnCount = columnCount;
  }

  getValues() {
    return Array.from({ length: this.rowCount }, (_, rowOffset) => (
      Array.from({ length: this.columnCount }, (_, columnOffset) => (
        this.sheet.getCell(this.row + rowOffset, this.column + columnOffset)
      ))
    ));
  }

  setValue(value) {
    this.sheet.setCell(this.row, this.column, value);
    return this;
  }

  setValues(values) {
    values.forEach((rowValues, rowOffset) => {
      rowValues.forEach((value, columnOffset) => {
        this.sheet.setCell(this.row + rowOffset, this.column + columnOffset, value);
      });
    });
    return this;
  }

  setFontWeight() {
    return this;
  }
}

class FakeSheet {
  constructor(rows) {
    this.rows = rows.map(row => [...row]);
    this.frozenRows = 0;
  }

  getCell(row, column) {
    return this.rows[row - 1]?.[column - 1] ?? '';
  }

  setCell(row, column, value) {
    while (this.rows.length < row) this.rows.push([]);
    while (this.rows[row - 1].length < column) this.rows[row - 1].push('');
    this.rows[row - 1][column - 1] = value;
  }

  getLastColumn() {
    return this.rows.reduce((max, row) => Math.max(max, row.length), 0);
  }

  getLastRow() {
    return this.rows.length;
  }

  getRange(row, column, rowCount, columnCount) {
    return new FakeRange(this, row, column, rowCount, columnCount);
  }

  getFrozenRows() {
    return this.frozenRows;
  }

  setFrozenRows(count) {
    this.frozenRows = count;
  }
}

const {
  ensureItemTypeColumn,
  ensureSheetHeaders,
  backfillMissingItemCategories,
  inventoryQuantities,
} = sandbox.SchemaTestApi;

const existingColumns = new FakeSheet([
  ['id', 'name', 'aliases', 'total_quantity', 'storage_location', 'note', 'organization_quantity_limit', 'image', 'category', 'item_type'],
  [1, 'ヘッドホン', '', 1, '倉庫', '', '', '', '電子機械', '電子機器'],
]);
const originalRows = JSON.stringify(existingColumns.rows);
assert.equal(ensureItemTypeColumn(existingColumns), 10);
assert.equal(JSON.stringify(existingColumns.rows), originalRows, 'existing columns must not be moved or deleted');

const missingItemType = new FakeSheet([
  ['id', 'name', '', 'category'],
  [1, '机', 'do-not-overwrite', '生活用品'],
]);
assert.equal(ensureItemTypeColumn(missingItemType), 5);
assert.equal(missingItemType.getCell(1, 3), '');
assert.equal(missingItemType.getCell(2, 3), 'do-not-overwrite');
assert.equal(missingItemType.getCell(1, 5), 'item_type');
assert.equal(missingItemType.getCell(2, 5), '物品');

ensureSheetHeaders(missingItemType, ['id', 'name', 'category', 'item_type', 'aliases']);
assert.equal(missingItemType.getCell(1, 3), '', 'blank legacy columns must remain untouched');
assert.equal(missingItemType.getCell(1, 6), 'aliases');
assert.equal(missingItemType.getFrozenRows(), 1);

const missingCategories = new FakeSheet([
  ['id', 'name', 'category', 'item_type'],
  [1, '机', '', '物品'],
  [2, 'PC', '', '電子機器'],
  [3, '紙', '', '消耗品'],
  [4, '特注品', '独自カテゴリ', '物品'],
]);
assert.equal(backfillMissingItemCategories(missingCategories), 3);
assert.deepEqual(
  missingCategories.rows.slice(1).map(row => row[2]),
  ['生活用品', '電子機械', '消耗品', '独自カテゴリ']
);
assert.equal(backfillMissingItemCategories(missingCategories), 0, 'backfill must be idempotent');

assert.deepEqual(
  JSON.parse(JSON.stringify(inventoryQuantities(5, 0, 0, 4))),
  { current: 5, reserved: 0, lent: 0 }
);
assert.deepEqual(
  JSON.parse(JSON.stringify(inventoryQuantities(5, 3, 4, 1))),
  { current: 0, reserved: 3, lent: 3 }
);

console.log('schema migration tests passed');
