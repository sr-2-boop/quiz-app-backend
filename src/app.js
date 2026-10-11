import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { health } from './controllers/health.controller.js';
import { requireAuth } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { createRateLimiters } from './middleware/rateLimit.js';
import { adminRoutes } from './routes/admin/index.js';
import { authRoutes } from './routes/auth.routes.js';
import { participantRoutes } from './routes/participant.routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Must match the real proxy chain so rate limits see client IPs (see TRUST_PROXY in .env.example).
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/api/health' },
      // Method, URL and status only: no headers (cookies), bodies (passwords, mobiles) or query secrets.
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());

  const limiters = createRateLimiters();

  // Public: health check and login/logout. Nothing else.
  app.get('/api/health', health);
  app.use('/api/auth', authRoutes(limiters));

  // Every other route requires a valid JWT.
  app.use('/api', requireAuth);
  app.use('/api/admin', adminRoutes(limiters));
  app.use('/api', participantRoutes(limiters));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
