import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from './db.js';
import { eventAction, createLedger, createOperation, dashboard } from './service.js';
import { verifyPassword } from './security.js';
import { createApp } from './app.js';

const keeper = { id: 'keeper' };
const reviewer = { id: 'reviewer' };
function fixture(t) {
  let credentials;
  const db = openDatabase(':memory:', { onCredentials: value => { credentials = value; } });
  t.after(() => db.close());
  return { db, credentials };
}
const statusError = status => error => error.status === status;
const action = (db, user, id, name, version, note = '演示人工记录') => eventAction(db, user, id, { action: name, version, note });

test('seed: 3 sites, 6 warehouses, demo labels, random scrypt credentials', t => {
  const { db, credentials } = fixture(t);
  const data = dashboard(db, keeper);
  assert.equal(data.warehouses.length, 6);
  assert.equal(new Set(data.warehouses.map(w => w.site)).size, 3);
  assert.ok(data.devices.every(d => d.demo && d.status.includes('未接入')));
  assert.equal(credentials.length, 2);
  assert.notEqual(credentials[0].password, credentials[1].password);
  assert.ok(verifyPassword(credentials[0].password, db.prepare('SELECT password FROM users WHERE id=?').get('keeper').password));
});

test('workflow: full lifecycle, evidence, role guards, optimistic locking', t => {
  const { db } = fixture(t);
  assert.throws(() => action(db, reviewer, 'EV-001', 'claim', 1), statusError(403));
  assert.equal(action(db, keeper, 'EV-001', 'claim', 1).status, '核查中');
  assert.throws(() => action(db, keeper, 'EV-001', 'confirm', 2), statusError(403));
  assert.throws(() => action(db, reviewer, 'EV-001', 'confirm', 2, ''), statusError(400));
  assert.equal(action(db, reviewer, 'EV-001', 'confirm', 2).status, '待执行');
  assert.throws(() => action(db, keeper, 'EV-001', 'start', 2), statusError(409));
  assert.equal(action(db, keeper, 'EV-001', 'start', 3).status, '执行中');
  assert.throws(() => action(db, keeper, 'EV-001', 'submit', 4, ' '), statusError(400));
  assert.equal(action(db, keeper, 'EV-001', 'submit', 4).evidence.length, 1);
  const observed = action(db, reviewer, 'EV-001', 'observe', 5, '');
  assert.equal(observed.status, '待复核');
  assert.equal(observed.version, 6);
  assert.equal(action(db, reviewer, 'EV-001', 'return', 6).status, '待执行');
  action(db, keeper, 'EV-001', 'start', 7);
  action(db, keeper, 'EV-001', 'submit', 8);
  const result = action(db, reviewer, 'EV-001', 'approve', 9);
  assert.equal(result.status, '已归档');
  assert.equal(result.reviewer, 'reviewer');
  assert.equal(result.evidence.length, 2);
  assert.throws(() => action(db, keeper, 'EV-001', 'start', 10), statusError(409));
});

test('historical executor cannot review even after reassignment and role change', t => {
  const { db } = fixture(t);
  db.prepare('UPDATE users SET role=? WHERE id=?').run('supervisor', 'keeper');
  const row = db.prepare('SELECT data FROM events WHERE id=?').get('EV-005');
  const event = JSON.parse(row.data);
  event.assignee = 'reviewer';
  db.prepare('UPDATE events SET data=? WHERE id=?').run(JSON.stringify(event), event.id);
  for (const operation of ['approve', 'return', 'observe']) assert.throws(() => action(db, keeper, event.id, operation, 1), statusError(403));
  assert.equal(JSON.parse(db.prepare('SELECT data FROM events WHERE id=?').get(event.id).data).version, 1);
});

test('another operator cannot start/submit; caller cannot forge role', t => {
  const { db } = fixture(t);
  db.prepare('INSERT INTO users SELECT ?,?,?,role,password FROM users WHERE id=?').run('other', 'other', '演示其他保管员', 'keeper');
  assert.throws(() => action(db, { id: 'other' }, 'EV-003', 'start', 1), statusError(403));
  assert.throws(() => action(db, { id: 'other' }, 'EV-004', 'submit', 1), statusError(403));
  assert.throws(() => action(db, { id: 'keeper', role: 'supervisor' }, 'EV-005', 'approve', 1), statusError(403));
  assert.throws(() => dashboard(db, null), statusError(401));
});

test('inventory: deposits, withdrawals, capacity, permissions, exact decimals and audit', t => {
  const { db } = fixture(t);
  const body = { type: '入库', warehouseId: 'WH-01', quantity: 0.123, note: '演示入库' };
  assert.equal(createLedger(db, keeper, body).warehouse.stock, 1000.123);
  assert.equal(createLedger(db, keeper, { ...body, type: '出库' }).warehouse.stock, 1000);
  for (const quantity of [-1, 0, NaN, Infinity, '1', 0.0001]) assert.throws(() => createLedger(db, keeper, { ...body, quantity }), statusError(400));
  assert.throws(() => createLedger(db, reviewer, body), statusError(403));
  assert.throws(() => createLedger(db, keeper, { ...body, quantity: 2001 }), statusError(409));
  assert.throws(() => createLedger(db, keeper, { ...body, type: '出库', quantity: 1001 }), statusError(409));
  const data = dashboard(db, keeper);
  assert.equal(data.ledger.length, 8);
  assert.equal(data.audit.filter(a => a.action === 'ledger.create').length, 2);
});

test('inventory transaction rolls back warehouse and ledger if audit insert fails', t => {
  const { db } = fixture(t);
  db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  assert.throws(() => createLedger(db, keeper, { type: '入库', warehouseId: 'WH-01', quantity: 1, note: '演示' }));
  const data = dashboard(db, keeper);
  assert.equal(data.warehouses[0].stock, 1000);
  assert.equal(data.ledger.length, 6);
});

const transferBody = { type: '移仓', warehouseId: 'WH-01', targetWarehouseId: 'WH-03', quantity: 0.123, note: '演示移仓' };
const operationBody = { warehouseId: 'WH-01', eventId: 'EV-001', type: '巡检', note: '演示现场巡检记录', performedAt: '2020-01-01T08:00:00+08:00' };

test('移仓：精确数量、双仓库存、目标字段及审计', t => {
  const { db } = fixture(t);
  const result = createLedger(db, keeper, transferBody);
  assert.equal(result.warehouse.stock, 999.877);
  assert.equal(result.targetWarehouse.stock, 1200.123);
  const data = dashboard(db, reviewer);
  assert.equal(data.ledger[0].targetWarehouseId, 'WH-03');
  assert.equal(data.ledger.length, 7);
  assert.equal(data.warehouses.reduce((sum, w) => sum + w.stock, 0), 7500);
  assert.equal(data.audit[0].targetBefore, 1200);
  assert.equal(data.audit[0].targetAfter, 1200.123);
  assert.equal(data.audit[0].after, 999.877);
});

test('移仓：越权、数量、仓房与容量校验均不写入', t => {
  const { db } = fixture(t);
  const before = dashboard(db, keeper);
  assert.throws(() => createLedger(db, { ...reviewer, role: 'operator' }, transferBody), statusError(403));
  assert.throws(() => createLedger(db, null, transferBody), statusError(401));
  for (const quantity of [0, -1, NaN, Infinity, '1', 0.0001, 1e10]) assert.throws(() => createLedger(db, keeper, { ...transferBody, quantity }), statusError(400));
  for (const targetWarehouseId of ['WH-01', '', undefined, 2]) assert.throws(() => createLedger(db, keeper, { ...transferBody, targetWarehouseId }), statusError(400));
  for (const patch of [{ warehouseId: 'missing' }, { targetWarehouseId: 'missing' }]) assert.throws(() => createLedger(db, keeper, { ...transferBody, ...patch }), statusError(404));
  assert.throws(() => createLedger(db, keeper, { ...transferBody, quantity: 1001 }), statusError(409));
  assert.deepEqual(dashboard(db, keeper), before);
  assert.throws(() => createLedger(db, keeper, { ...transferBody, targetWarehouseId: 'WH-02' }), /粮种不同/);
  createLedger(db, keeper, { type: '入库', warehouseId: 'WH-03', quantity: 1799, note: '演示接近满仓' });
  const full = dashboard(db, keeper);
  assert.throws(() => createLedger(db, keeper, { ...transferBody, quantity: 2 }), statusError(409));
  assert.deepEqual(dashboard(db, keeper), full);
});

test('移仓：第二仓更新、台账和审计失败均完全回滚', t => {
  const { db } = fixture(t);
  for (const trigger of [
    "BEFORE UPDATE ON warehouses WHEN OLD.id='WH-01'",
    'BEFORE INSERT ON ledger',
    'BEFORE INSERT ON audit',
  ]) {
    const before = dashboard(db, keeper);
    db.exec(`CREATE TRIGGER fail_transfer ${trigger} BEGIN SELECT RAISE(ABORT, 'test failure'); END`);
    assert.throws(() => createLedger(db, keeper, transferBody));
    assert.deepEqual(dashboard(db, keeper), before);
    db.exec('DROP TRIGGER fail_transfer');
  }
});

test('作业：类型、权限、必填文本、日期和关联事件校验', t => {
  const { db } = fixture(t);
  const before = dashboard(db, keeper);
  assert.throws(() => createOperation(db, reviewer, operationBody), statusError(403));
  assert.throws(() => createOperation(db, null, operationBody), statusError(401));
  for (const patch of [{ type: '其他' }, { note: ' ' }, { note: 1 }, { note: '字'.repeat(2001) }, { warehouseId: 1 }, { eventId: 1 }, { eventId: 'EV-002' }]) assert.throws(() => createOperation(db, keeper, { ...operationBody, ...patch }), statusError(400));
  for (const performedAt of ['', 'invalid', '2023-02-29', '2024-02-30T00:00:00Z', '2020-13-01', '2020-01-01T25:00', null, 123, new Date(Date.now() + 86400000).toISOString()]) assert.throws(() => createOperation(db, keeper, { ...operationBody, performedAt }), statusError(400));
  for (const patch of [{ warehouseId: 'missing' }, { eventId: 'missing' }]) assert.throws(() => createOperation(db, keeper, { ...operationBody, ...patch }), statusError(404));
  assert.deepEqual(dashboard(db, keeper), before);
  for (const type of ['巡检', '通风', '控温', '质量检验']) {
    const entry = createOperation(db, keeper, { ...operationBody, type, eventId: type === '巡检' ? 'EV-001' : undefined });
    assert.equal(entry.type, type);
    assert.equal(entry.demo, true);
    assert.equal(entry.actor, 'keeper');
    assert.equal(entry.performedAt, '2020-01-01T00:00:00.000Z');
  }
  const after = dashboard(db, reviewer);
  assert.equal(after.operations.length, 4);
  assert.equal(after.audit.filter(a => a.action === 'operations.create').length, 4);
  assert.deepEqual(after.events, before.events);
  assert.deepEqual(after.warehouses, before.warehouses);
  assert.deepEqual(after.ledger, before.ledger);
});

test('作业：审计失败回滚作业记录', t => {
  const { db } = fixture(t);
  const before = dashboard(db, keeper);
  db.exec("CREATE TRIGGER fail_operation_audit BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  assert.throws(() => createOperation(db, keeper, operationBody));
  assert.deepEqual(dashboard(db, keeper), before);
});

test('SQLite data and initial credentials persist without reseeding', () => {
  const directory = mkdtempSync(join(tmpdir(), 'grain-test-'));
  let db;
  try {
    const file = join(directory, 'test.sqlite');
    db = openDatabase(file);
    db.exec('DROP TABLE operations');
    db.close();
    db = openDatabase(file, { onCredentials: () => assert.fail('existing database must not reseed') });
    assert.deepEqual(dashboard(db, keeper).operations, []);
    const operation = createOperation(db, keeper, operationBody);
    createLedger(db, keeper, transferBody);
    createLedger(db, keeper, { type: '出库', warehouseId: 'WH-01', quantity: 10, note: '演示持久化' });
    const password = db.prepare('SELECT password FROM users WHERE id=?').get('keeper').password;
    db.close();
    db = openDatabase(file, { onCredentials: () => assert.fail('must not regenerate passwords') });
    const persisted = dashboard(db, reviewer);
    assert.equal(persisted.warehouses[0].stock, 989.877);
    assert.equal(persisted.warehouses[2].stock, 1200.123);
    assert.equal(persisted.ledger.find(l => l.type === '移仓').targetWarehouseId, 'WH-03');
    assert.deepEqual(persisted.operations, [operation]);
    assert.ok(persisted.audit.some(a => a.entityId === operation.id));
    assert.equal(db.prepare('SELECT password FROM users WHERE id=?').get('keeper').password, password);
  } finally { db?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('HTTP: session, origin validation, cookie, login, API, logout and expiry', async t => {
  const { db, credentials } = fixture(t);
  const server = createApp(db).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:5173' };
  const request = (path, options) => fetch(`${base}/api${path}`, options);
  assert.deepEqual(await (await request('/session')).json(), { user: null });
  assert.equal((await request('/dashboard')).status, 401);
  const body = JSON.stringify(credentials[0]);
  assert.equal((await request('/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status, 403);
  assert.equal((await request('/login', { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' }, body })).status, 403);
  assert.equal((await request('/login', { method: 'POST', headers, body: JSON.stringify({ username: 'keeper', password: 'wrong' }) })).status, 401);
  const response = await request('/login', { method: 'POST', headers, body });
  assert.equal(response.status, 200);
  const setCookie = response.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  const cookie = setCookie.split(';')[0];
  const auth = { ...headers, Cookie: cookie };
  assert.equal((await (await request('/session', { headers: auth })).json()).user.role, 'operator');
  const dashboardResponse = await (await request('/dashboard', { headers: auth })).json();
  assert.equal(dashboardResponse.warehouses.length, 6);
  assert.equal((await request('/events/EV-001/action', { method: 'POST', headers: auth, body: JSON.stringify({ action: 'claim', version: 1 }) })).status, 200);
  assert.equal((await request('/ledger', { method: 'POST', headers: auth, body: JSON.stringify({ type: '入库', warehouseId: 'WH-01', quantity: 1, note: '演示' }) })).status, 201);
  assert.equal((await request('/operations', { method: 'POST', headers, body: JSON.stringify(operationBody) })).status, 401);
  assert.equal((await request('/operations', { method: 'POST', headers: auth, body: JSON.stringify(operationBody) })).status, 201);
  const transferResponse = await request('/ledger', { method: 'POST', headers: auth, body: JSON.stringify(transferBody) });
  assert.equal(transferResponse.status, 201);
  assert.equal((await transferResponse.json()).entry.targetWarehouseId, 'WH-03');
  const supervisorLogin = await request('/login', { method: 'POST', headers, body: JSON.stringify(credentials[1]) });
  const supervisorAuth = { ...headers, Cookie: supervisorLogin.headers.get('set-cookie').split(';')[0] };
  assert.equal((await request('/operations', { method: 'POST', headers: supervisorAuth, body: JSON.stringify(operationBody) })).status, 403);
  assert.equal((await request('/ledger', { method: 'POST', headers: supervisorAuth, body: JSON.stringify(transferBody) })).status, 403);
  assert.equal((await (await request('/dashboard', { headers: supervisorAuth })).json()).operations.length, 1);
  assert.equal((await request('/logout', { method: 'POST', headers: auth, body: '{}' })).status, 200);
  assert.deepEqual(await (await request('/session', { headers: auth })).json(), { user: null });
  const again = await request('/login', { method: 'POST', headers, body });
  const expired = again.headers.get('set-cookie').split(';')[0];
  db.prepare('UPDATE sessions SET expires=0').run();
  assert.equal((await request('/dashboard', { headers: { Cookie: expired } })).status, 401);
});
