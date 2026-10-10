import express from 'express';
import { randomBytes } from 'node:crypto';
import { ApiError, audit, dashboard, eventAction, createLedger, createOperation } from './service.js';
import { hashPassword, verifyPassword, publicUser, tokenHash } from './security.js';
import { transaction } from './db.js';

const COOKIE = 'grain_session';
const TTL = 8 * 60 * 60 * 1000;
export function createApp(db, { origins = ['http://127.0.0.1:3001', 'http://127.0.0.1:5173', 'http://localhost:5173'] } = {}) {
  const app = express();
  app.disable('x-powered-by');
  const dummyPassword = hashPassword(randomBytes(24).toString('hex'));
  const attempts = new Map();
  const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: false, path: '/' };
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      if (!origin || !origins.includes(origin) || req.get('sec-fetch-site') === 'cross-site') return next(new ApiError(403, '拒绝非同源写入请求'));
      if (!req.is('application/json')) return next(new ApiError(415, '请使用 application/json'));
    }
    next();
  });
  app.use(express.json({ limit: '16kb', strict: true }));
  app.use('/api', (req, res, next) => {
    const cookie = (req.headers.cookie ?? '').split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE}=`));
    const token = cookie?.slice(COOKIE.length + 1);
    if (token && /^[a-f0-9]{64}$/.test(token)) {
      req.sessionHash = tokenHash(token);
      req.user = db.prepare('SELECT u.id,u.username,u.name,u.role FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token=? AND s.expires>?').get(req.sessionHash, Date.now());
    }
    next();
  });
  const authenticated = (req, res, next) => req.user ? next() : next(new ApiError(401, '请先登录'));
  app.get('/api/session', (req, res) => res.json({ user: publicUser(req.user) }));
  app.post('/api/login', (req, res) => {
    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string' || username.length > 100 || password.length > 256) throw new ApiError(400, '账号或密码格式不正确');
    const key = req.ip;
    const time = Date.now();
    for (const [ip, limit] of attempts) if (limit.until <= time) attempts.delete(ip);
    const limit = attempts.get(key) ?? { count: 0, until: time + 15 * 60 * 1000 };
    if (limit.count >= 10) throw new ApiError(429, '登录尝试过多，请15分钟后重试');
    const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
    const valid = verifyPassword(password, user?.password ?? dummyPassword);
    if (!valid || !user) {
      limit.count++;
      attempts.set(key, limit);
      audit(db, { action: 'login.failed', actor: null, note: '演示平台登录失败' });
      throw new ApiError(401, '账号或密码错误');
    }
    const token = randomBytes(32).toString('hex');
    transaction(db, () => {
      db.prepare('DELETE FROM sessions WHERE expires<=?').run(time);
      if (req.sessionHash) db.prepare('DELETE FROM sessions WHERE token=?').run(req.sessionHash);
      db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(tokenHash(token), user.id, time + TTL);
      audit(db, { action: 'login', actor: user.id });
    });
    attempts.delete(key);
    res.cookie(COOKIE, token, { ...cookieOptions, maxAge: TTL });
    res.json({ user: publicUser(user) });
  });
  app.post('/api/logout', (req, res) => {
    transaction(db, () => {
      if (req.sessionHash) db.prepare('DELETE FROM sessions WHERE token=?').run(req.sessionHash);
      if (req.user) audit(db, { action: 'logout', actor: req.user.id });
    });
    res.clearCookie(COOKIE, cookieOptions);
    res.json({ user: null });
  });
  app.get('/api/dashboard', authenticated, (req, res) => res.json(dashboard(db, req.user)));
  app.post('/api/events/:id/action', authenticated, (req, res) => res.json(eventAction(db, req.user, req.params.id, req.body ?? {})));
  app.post('/api/ledger', authenticated, (req, res) => res.status(201).json(createLedger(db, req.user, req.body ?? {})));
  app.post('/api/operations', authenticated, (req, res) => res.status(201).json(createOperation(db, req.user, req.body ?? {})));
  app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));
  app.use((error, req, res, next) => {
    const status = error instanceof ApiError ? error.status : error.type === 'entity.too.large' ? 413 : error.type === 'entity.parse.failed' ? 400 : 500;
    if (status === 500) console.error('API内部错误:', error.message);
    res.status(status).json({ error: status === 500 ? '服务器内部错误' : status === 413 ? '请求内容过大' : status === 400 && !(error instanceof ApiError) ? 'JSON格式错误' : error.message });
  });
  return app;
}
