const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const apiSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'api.js'), 'utf8');
const sandbox = {
  URL,
  console,
  window: { GAS_URL: '' },
};
vm.createContext(sandbox);
vm.runInContext(`${apiSource}\nglobalThis.TestApi = Api;`, sandbox);

const Api = sandbox.TestApi;

const addLoanRequest = itemId => Api.addRequest({
  request_type: 'loan',
  item_id: itemId,
  quantity: 1,
  organization: 'テスト団体',
  user_name: 'テスト利用者',
  purpose: '動作確認',
  email: 'test@example.com',
});

async function run() {
  const trackedItem = await Api.addItem({
    name: '管理対象PC',
    category: 'PC',
    item_type: 'electronics',
    total_quantity: 3,
    tracking_enabled: true,
  });

  const firstRequest = await addLoanRequest(trackedItem.id);
  const secondRequest = await addLoanRequest(trackedItem.id);
  assert.equal((await Api.updateRequestStatus({ id: firstRequest.id, status: 'ready' })).success, true);
  assert.equal((await Api.updateRequestStatus({ id: firstRequest.id, status: 'received', assigned_identifiers: ['01'] })).success, true);
  assert.equal((await Api.updateRequestStatus({ id: secondRequest.id, status: 'ready' })).success, true);

  const duplicateAssignment = await Api.updateRequestStatus({
    id: secondRequest.id,
    status: 'received',
    assigned_identifiers: ['01'],
  });
  assert.match(duplicateAssignment.error, /すでに貸出中/);
  assert.equal((await Api.updateRequestStatus({ id: secondRequest.id, status: 'received', assigned_identifiers: ['02'] })).success, true);

  const whileLent = await Api.getItemDetail(trackedItem.id);
  assert.deepEqual([...whileLent.item.available_identifiers], ['03']);
  assert.equal(whileLent.item.identifier_assignments.length, 2);
  assert.deepEqual([...whileLent.item.transactions[0].assigned_identifiers], ['02']);
  const listedRequests = await Api.getRequests();
  assert.equal(listedRequests.requests.find(request => request.id === firstRequest.id).tracking_enabled, true);

  const disableWhileLent = await Api.updateItem({ id: trackedItem.id, tracking_enabled: false });
  assert.match(disableWhileLent.error, /OFFにできません/);

  assert.equal((await Api.updateRequestStatus({ id: firstRequest.id, status: 'returned' })).success, true);
  const returnedDetail = await Api.getRequestDetail(firstRequest.id);
  assert.deepEqual([...returnedDetail.request.transactions[0].assigned_identifiers], ['01']);
  const thirdRequest = await addLoanRequest(trackedItem.id);
  assert.equal((await Api.updateRequestStatus({ id: thirdRequest.id, status: 'ready' })).success, true);
  assert.equal((await Api.updateRequestStatus({ id: thirdRequest.id, status: 'received', assigned_identifiers: ['01'] })).success, true);

  const reusedIdentifier = await Api.getRequestDetail(thirdRequest.id);
  assert.deepEqual([...reusedIdentifier.request.assigned_identifiers], ['01']);
  const logs = await Api.getLogs();
  assert.ok(logs.logs.some(log => log.assigned_identifiers?.includes('01')));

  assert.equal((await Api.updateRequestStatus({ id: secondRequest.id, status: 'returned' })).success, true);
  assert.equal((await Api.updateRequestStatus({ id: thirdRequest.id, status: 'returned' })).success, true);
  assert.equal((await Api.updateItem({ id: trackedItem.id, tracking_enabled: false })).success, true);

  const largeItem = await Api.addItem({
    name: '管理対象120台',
    category: 'PC',
    item_type: 'electronics',
    total_quantity: 120,
    tracking_enabled: true,
  });
  const largeItemDetail = await Api.getItemDetail(largeItem.id);
  assert.equal(largeItemDetail.item.available_identifiers[0], '001');
  assert.equal(largeItemDetail.item.available_identifiers.at(-1), '120');

  const inconsistentHistoryItem = await Api.addItem({
    name: '履歴補正テスト',
    category: '生活用品',
    item_type: 'equipment',
    total_quantity: 5,
  });
  await Api.addTransaction({
    item_id: inconsistentHistoryItem.id,
    type: 'return',
    quantity: 4,
    target: '履歴補正',
  });
  const correctedItem = await Api.getItemDetail(inconsistentHistoryItem.id);
  assert.equal(correctedItem.item.lent_quantity, 0);
  assert.equal(correctedItem.item.current_quantity, 5);
  const correctedListItem = (await Api.getItems()).items.find(item => item.id === inconsistentHistoryItem.id);
  assert.equal(correctedListItem.lent_quantity, 0);
  assert.equal(correctedListItem.current_quantity, 5);
  const overstockRequest = await Api.addRequest({
    request_type: 'loan',
    item_id: inconsistentHistoryItem.id,
    quantity: 6,
    organization: 'テスト団体',
    user_name: 'テスト利用者',
    purpose: '在庫上限確認',
    email: 'test@example.com',
  });
  assert.match(overstockRequest.error, /利用可能 5/);

  console.log('tracking tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
