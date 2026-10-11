import { isDbConnected } from '../config/db.js';

export function health(_req, res) {
  const db = isDbConnected();
  res.status(db ? 200 : 503).json({ status: db ? 'ok' : 'degraded', db: db ? 'up' : 'down' });
}
