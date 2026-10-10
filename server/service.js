import { randomUUID } from 'node:crypto';
import { transaction } from './db.js';

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new ApiError(status, message); };
const now = () => new Date().toISOString();
export function audit(db, entry) {
  db.prepare('INSERT INTO audit(data) VALUES (?)').run(JSON.stringify({ ...entry, createdAt: now() }));
}
function requireUser(db, user) {
  const actual = user?.id && db.prepare('SELECT id,username,name,role FROM users WHERE id=?').get(user.id);
  if (!actual) fail(401, '请先登录');
  return actual;
}
function noteText(value, required = false) {
  if (value !== undefined && typeof value !== 'string') fail(400, '备注必须是文本');
  const text = (value ?? '').trim();
  if (text.length > 2000 || (required && !text)) fail(400, '请填写1至2000字备注');
  return text;
}
export function dashboard(db, user) {
  requireUser(db, user);
  const result = {};
  for (const table of ['warehouses', 'events', 'ledger', 'devices', 'operations']) {
    result[table] = db.prepare(`SELECT data FROM ${table} ORDER BY rowid`).all().map(row => JSON.parse(row.data));
  }
  result.ledger.reverse();
  result.operations.reverse();
  result.audit = db.prepare('SELECT seq,data FROM audit ORDER BY seq DESC LIMIT 500').all().map(row => ({ id: row.seq, ...JSON.parse(row.data) }));
  return result;
}

export function eventAction(db, user, id, body = {}) {
  user = requireUser(db, user);
  const { action, version } = body;
  const transitions = { claim: ['待核查', '核查中', 'operator'], confirm: ['核查中', '待执行', 'supervisor'], start: ['待执行', '执行中', 'operator'], submit: ['执行中', '待复核', 'operator'], approve: ['待复核', '已归档', 'supervisor'], return: ['待复核', '待执行', 'supervisor'], observe: ['待复核', '待复核', 'supervisor'] };
  if (!Object.hasOwn(transitions, action)) fail(400, '无效事件操作');
  if (!Number.isSafeInteger(version) || version < 1) fail(400, '必须提供有效事件版本');
  const note = noteText(body.note, ['confirm', 'submit', 'approve', 'return'].includes(action));
  return transaction(db, () => {
    const row = db.prepare('SELECT * FROM events WHERE id=?').get(id);
    if (!row) fail(404, '事件不存在');
    const event = JSON.parse(row.data);
    const [from, to, role] = transitions[action];
    if (user.role !== role) fail(403, '当前角色无权执行此操作');
    if (['approve', 'return', 'observe'].includes(action) && (event.assignee === user.id || db.prepare('SELECT 1 FROM executors WHERE event_id=? AND user_id=?').get(id, user.id))) fail(403, '当前或历史执行人不能复核同一事件');
    if (row.version !== version) fail(409, '事件已更新，请刷新后重试');
    if (event.status !== from) fail(409, '当前事件状态不允许此操作');
    if (['start', 'submit'].includes(action) && event.assignee !== user.id) fail(403, '仅事件领取人可以执行和提交');
    if (action === 'claim') {
      event.assignee = user.id;
      db.prepare('INSERT OR IGNORE INTO executors VALUES (?,?)').run(id, user.id);
    }
    if (['start', 'submit'].includes(action)) db.prepare('INSERT OR IGNORE INTO executors VALUES (?,?)').run(id, user.id);
    if (action === 'submit') event.evidence.push({ actor: user.id, actorName: user.name, note, createdAt: now() });
    if (['approve', 'return', 'observe'].includes(action)) event.reviewer = user.id;
    if (action === 'start') event.reviewer = null;
    event.status = to;
    event.version = version + 1;
    const record = { action, from, to, actor: user.id, actorName: user.name, note, createdAt: now() };
    event.history.push(record);
    const updated = db.prepare('UPDATE events SET version=?,data=? WHERE id=? AND version=?').run(event.version, JSON.stringify(event), id, version);
    if (updated.changes !== 1) fail(409, '事件版本冲突');
    audit(db, { ...record, entity: 'event', entityId: id, version: event.version, demo: true });
    return event;
  });
}

export function createLedger(db, user, body = {}) {
  user = requireUser(db, user);
  if (user.role !== 'operator') fail(403, '仅保管员可登记库存变动');
  const type = ({ in: '入库', out: '出库', inbound: '入库', outbound: '出库', '入库': '入库', '出库': '出库', '移仓': '移仓' })[body.type];
  if (!['入库', '出库', '移仓'].includes(type)) fail(400, '类型必须为入库、出库或移仓');
  if (typeof body.warehouseId !== 'string') fail(400, '请选择仓库');
  if (type === '移仓' && (typeof body.targetWarehouseId !== 'string' || !body.targetWarehouseId)) fail(400, '请选择目标仓房');
  if (type === '移仓' && body.targetWarehouseId === body.warehouseId) fail(400, '源仓房与目标仓房不能相同');
  const quantity = body.quantity;
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1e9 || Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 1e-6) fail(400, '数量必须为正数，最多三位小数（吨）');
  const note = noteText(body.note, true);
  return transaction(db, () => {
    const row = db.prepare('SELECT data FROM warehouses WHERE id=?').get(body.warehouseId);
    if (!row) fail(404, '仓库不存在');
    const warehouse = JSON.parse(row.data);
    const before = warehouse.stock;
    const afterUnits = Math.round(before * 1000) + (type === '入库' ? 1 : -1) * Math.round(quantity * 1000);
    if (afterUnits < 0) fail(409, '出库数量超过当前库存');
    if (afterUnits > Math.round(warehouse.capacity * 1000)) fail(409, '入库数量超过仓容');
    warehouse.stock = afterUnits / 1000;
    warehouse.updatedAt = now();
    let targetWarehouse;
    let targetBefore;
    if (type === '移仓') {
      const targetRow = db.prepare('SELECT data FROM warehouses WHERE id=?').get(body.targetWarehouseId);
      if (!targetRow) fail(404, '目标仓房不存在');
      targetWarehouse = JSON.parse(targetRow.data);
      if (targetWarehouse.grain !== warehouse.grain) fail(409, '源仓房与目标仓房粮种不同，不允许直接移仓');
      targetBefore = targetWarehouse.stock;
      const targetUnits = Math.round(targetBefore * 1000) + Math.round(quantity * 1000);
      if (targetUnits > Math.round(targetWarehouse.capacity * 1000)) fail(409, '移仓数量超过目标仓容');
      targetWarehouse.stock = targetUnits / 1000;
      targetWarehouse.updatedAt = now();
      db.prepare('UPDATE warehouses SET data=? WHERE id=?').run(JSON.stringify(targetWarehouse), targetWarehouse.id);
    }
    const entry = { id: randomUUID(), type, warehouseId: warehouse.id, ...(targetWarehouse ? { targetWarehouseId: targetWarehouse.id } : {}), quantity, note, createdAt: now(), actor: user.id, demo: true };
    db.prepare('UPDATE warehouses SET data=? WHERE id=?').run(JSON.stringify(warehouse), warehouse.id);
    db.prepare('INSERT INTO ledger VALUES (?,?,?)').run(entry.id, warehouse.id, JSON.stringify(entry));
    audit(db, { action: 'ledger.create', entity: 'ledger', entityId: entry.id, actor: user.id, actorName: user.name, warehouseId: warehouse.id, targetWarehouseId: targetWarehouse?.id, targetBefore, targetAfter: targetWarehouse?.stock, type, quantity, before, after: warehouse.stock, note, demo: true });
    return { entry, warehouse, ...(targetWarehouse ? { targetWarehouse } : {}) };
  });
}

export function createOperation(db, user, body = {}) {
  user = requireUser(db, user);
  if (user.role !== 'operator') fail(403, '仅保管员可登记作业记录');
  if (typeof body.warehouseId !== 'string' || !body.warehouseId) fail(400, '请选择仓房');
  if (!['巡检', '通风', '控温', '质量检验'].includes(body.type)) fail(400, '请选择有效作业类型');
  const note = noteText(body.note, true);
  const eventId = body.eventId === undefined || body.eventId === '' || body.eventId === null ? null : body.eventId;
  if (eventId !== null && typeof eventId !== 'string') fail(400, '关联事件格式不正确');
  const value = body.performedAt;
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value) || !Number.isFinite(time) || new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== value.slice(0, 10) || time > Date.now()) fail(400, '作业时间必须为合法且不晚于当前的日期');
  return transaction(db, () => {
    if (!db.prepare('SELECT 1 FROM warehouses WHERE id=?').get(body.warehouseId)) fail(404, '仓房不存在');
    if (eventId) {
      const event = db.prepare('SELECT warehouse_id FROM events WHERE id=?').get(eventId);
      if (!event) fail(404, '关联事件不存在');
      if (event.warehouse_id !== body.warehouseId) fail(400, '关联事件不属于所选仓房');
    }
    const entry = { id: randomUUID(), warehouseId: body.warehouseId, eventId, type: body.type, note, performedAt: new Date(time).toISOString(), createdAt: now(), actor: user.id, actorName: user.name, demo: true };
    db.prepare('INSERT INTO operations VALUES (?,?,?,?)').run(entry.id, entry.warehouseId, eventId, JSON.stringify(entry));
    audit(db, { action: 'operations.create', entity: 'operation', entityId: entry.id, actor: user.id, actorName: user.name, warehouseId: entry.warehouseId, eventId, type: entry.type, performedAt: entry.performedAt, note, demo: true });
    return entry;
  });
}
