import { mkdirSync } from 'node:fs';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db.js';
import { createApp } from './app.js';

const directory = new URL('./data/', import.meta.url);
mkdirSync(directory, { recursive: true });
const db = openDatabase(fileURLToPath(new URL('grain.sqlite', directory)), {
  onCredentials(accounts) {
    console.log('首次启动：随机生成以下演示账号密码，仅本次控制台显示，请妥善保存。');
    for (const account of accounts) console.log(`${account.username} (${account.role}): ${account.password}`);
  },
});
const app = createApp(db);
app.use(express.static(fileURLToPath(new URL('../dist/', import.meta.url))));
const server = app.listen(3001, '127.0.0.1', () => {
  console.log('演示后端 http://127.0.0.1:3001 — 所有种子数据均为演示，真实设备未接入，AI未配置。');
});
server.on('error', error => { console.error('启动失败:', error.message); db.close(); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => { db.close(); process.exitCode = 0; }));
