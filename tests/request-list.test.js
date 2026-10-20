const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const functionSource = appSource.match(/function findRequestById\(requests, id\) \{[\s\S]*?\n\}/);
assert.ok(functionSource, 'findRequestById must remain available to request-list actions');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(`${functionSource[0]}\nglobalThis.findRequestByIdForTest = findRequestById;`, sandbox);

const requests = [
  { id: 10, status: 'pending' },
  { id: '11', status: 'ready' },
];
assert.equal(sandbox.findRequestByIdForTest(requests, '10'), requests[0]);
assert.equal(sandbox.findRequestByIdForTest(requests, 11), requests[1]);
assert.equal(sandbox.findRequestByIdForTest(requests, 99), null);

const requestRouteSource = appSource.slice(
  appSource.indexOf('routes.requests = async'),
  appSource.indexOf('routes.reqDetail = async')
);
assert.match(requestRouteSource, /performAction\(act, id, request\)/);
assert.doesNotMatch(requestRouteSource, /performAction\(act, id, r\)/);
assert.match(requestRouteSource, /const id = card\.dataset\.id;/);
assert.doesNotMatch(requestRouteSource, /const id = Number\(card\.dataset\.id\);/);

console.log('request list action tests passed');
