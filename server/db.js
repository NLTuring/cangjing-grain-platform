import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { hashPassword } from './security.js';

export function transaction(db, operation) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = operation(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function openDatabase(filename = ':memory:', { onCredentials = () => {} } = {}) {
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('operator','supervisor')), password TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS warehouses (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, warehouse_id TEXT NOT NULL REFERENCES warehouses(id), version INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS executors (event_id TEXT NOT NULL REFERENCES events(id), user_id TEXT NOT NULL REFERENCES users(id), PRIMARY KEY(event_id,user_id));
    CREATE TABLE IF NOT EXISTS ledger (id TEXT PRIMARY KEY, warehouse_id TEXT NOT NULL REFERENCES warehouses(id), data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, warehouse_id TEXT NOT NULL REFERENCES warehouses(id), event_id TEXT REFERENCES events(id), data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit (seq INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  const credentials = [];
  transaction(db, () => {
    if (db.prepare('SELECT 1 FROM metadata WHERE key = ?').get('seeded')) return;
    for (const [username, role, name] of [['keeper', 'operator', '演示保管员'], ['reviewer', 'supervisor', '演示复核员']]) {
      const password = randomBytes(18).toString('base64url');
      db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run(username, username, name, role, hashPassword(password));
      credentials.push({ username, password, role });
    }
    const now = new Date().toISOString();
    for (let i = 1; i <= 6; i++) {
      const id = `WH-${String(i).padStart(2, '0')}`;
      const warehouse = { id, name: `演示${i}号仓`, site: `演示${['北','东','南'][Math.floor((i - 1) / 2)]}库区`, grain: i % 2 ? '演示小麦' : '演示稻谷', stock: 900 + i * 100, capacity: 3000, temp: i === 1 ? 29.6 : 21 + i / 2, humidity: 58 + i, status: i === 1 ? '演示预警' : '演示正常', updatedAt: now, demo: true };
      db.prepare('INSERT INTO warehouses VALUES (?,?)').run(id, JSON.stringify(warehouse));
      for (const [type, name] of [['temperature', '温湿度传感器'], ['gateway', '采集网关']]) {
        const device = { id: `DEMO-${i}-${type}`, name: `演示${i}仓${name}`, type, status: '演示模拟（未接入真实设备）', warehouseId: id, demo: true };
        db.prepare('INSERT INTO devices VALUES (?,?)').run(device.id, JSON.stringify(device));
      }
      const opening = { id: `DEMO-OPEN-${i}`, type: '入库', warehouseId: id, quantity: warehouse.stock, note: '演示期初库存，非真实业务数据', createdAt: now, demo: true };
      db.prepare('INSERT INTO ledger VALUES (?,?,?)').run(opening.id, id, JSON.stringify(opening));
    }
    const statuses = ['待核查', '核查中', '待执行', '执行中', '待复核', '已归档'];
    statuses.forEach((status, i) => {
      const id = `EV-${String(i + 1).padStart(3, '0')}`;
      const history = [{ action: 'seed', from: null, to: status, actor: 'system', actorName: '演示初始化', note: '演示事件快照，非真实处置记录；AI未配置', createdAt: now }];
      const event = { id, warehouseId: `WH-${String(i + 1).padStart(2, '0')}`, title: `演示：${['粮温偏高待核查','湿度波动核查','通风作业待执行','仓内巡检执行','测温复测待复核','历史巡检已归档'][i]}`, status, severity: i === 0 ? '高' : '中', createdAt: now, assignee: i ? 'keeper' : null, reviewer: i === 5 ? 'reviewer' : null, version: 1, evidence: i >= 4 ? [{ actor: 'keeper', note: '演示执行记录：模拟人工复测，无真实设备或AI结果', createdAt: now }] : [], history, demo: true };
      db.prepare('INSERT INTO events VALUES (?,?,?,?)').run(id, event.warehouseId, 1, JSON.stringify(event));
      if (i) db.prepare('INSERT INTO executors VALUES (?,?)').run(id, 'keeper');
    });
    db.prepare('INSERT INTO audit(data) VALUES (?)').run(JSON.stringify({ action: 'seed', actor: 'system', note: '全部初始化数据为演示，设备未接入，AI未配置', createdAt: now }));
    db.prepare('INSERT INTO metadata VALUES (?,?)').run('seeded', '1');
  });
  if (credentials.length) onCredentials(credentials);
  return db;
}
