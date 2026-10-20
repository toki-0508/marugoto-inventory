const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const gasSource = fs.readFileSync(path.join(__dirname, '..', 'gas', 'Code.gs'), 'utf8');
const gasSandbox = { console };
vm.createContext(gasSandbox);
vm.runInContext(`${gasSource}\nglobalThis.itemFromRowForTest = _itemFromRow;`, gasSandbox);

const cols = { id: 1, name: 2, category: 3, item_type: 4, total_quantity: 5 };
const itemFromRow = row => gasSandbox.itemFromRowForTest(row, cols);

// 種別はカテゴリではないため、空欄カテゴリを種別から推測して埋めない
assert.equal(itemFromRow([1, 'セロテープ', '', '消耗品', 3]).category, '');
assert.equal(itemFromRow([2, '机', '', '物品', 1]).category, '');
assert.equal(itemFromRow([3, 'マイク', '', '電子機器', 1]).category, '');
assert.equal(itemFromRow([4, '付箋', ' 雑貨 ', '消耗品', 5]).category, '雑貨');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const defaultCategorySource = appSource.match(/const DEFAULT_CATEGORY_OPTIONS = \[[\s\S]*?\];/);
assert.ok(defaultCategorySource, 'DEFAULT_CATEGORY_OPTIONS must remain defined');
const appSandbox = {};
vm.createContext(appSandbox);
vm.runInContext(`${defaultCategorySource[0]}\nglobalThis.defaultCategories = DEFAULT_CATEGORY_OPTIONS;`, appSandbox);
const defaultCategories = [...appSandbox.defaultCategories];

assert.ok(!defaultCategories.includes('消耗品'), '消耗品 is an item type, not a category');
assert.ok(!defaultCategories.includes('物品'), '物品 is an item type, not a category');
assert.ok(defaultCategories.includes('学校備品'));
// 電子系カテゴリは「電子機器」に統一した
assert.ok(defaultCategories.includes('電子機器'));
assert.ok(!defaultCategories.includes('電子機械'), '電子機械 was unified into 電子機器');

console.log('category tests passed');
