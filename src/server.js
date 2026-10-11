import './config/load-env-file.js';
import http from 'node:http';
import { createApp } from './app.js';
import { connectDb, disconnectDb } from './config/db.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { startSweeper } from './jobs/sweeper.js';
import { stopLiveBroadcasts } from './services/live.service.js';
import { initSockets } from './sockets/index.js';

await connectDb(env.MONGODB_URI);

const app = createApp();
const server = http.createServer(app);
const io = initSockets(server);
const stopSweeper = startSweeper();

server.listen(env.PORT, '0.0.0.0', () => {
  logger.info(`API listening on port ${env.PORT} (${env.NODE_ENV})`);
  if (!env.CODE_EXECUTION_ENABLED) logger.info('Code execution is disabled (CODE_EXECUTION_ENABLED=false)');
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');
  stopSweeper();
  stopLiveBroadcasts();
  await new Promise((resolve) => io.close(() => resolve(undefined)));
  await disconnectDb();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
