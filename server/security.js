import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password, stored) {
  const [salt, value] = stored.split(':');
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(value, 'hex');
  return expected.length === candidate.length && timingSafeEqual(expected, candidate);
}
export const tokenHash = token => createHash('sha256').update(token).digest('hex');
export const publicUser = user => user ? { id: user.id, username: user.username, name: user.name, role: user.role } : null;
