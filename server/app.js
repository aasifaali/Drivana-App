import fs from 'node:fs';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { openDb } from './db.js';
import authRoutes from './routes/auth.js';
import customerRoutes from './routes/customer.js';
import driverRoutes from './routes/driver.js';
import adminRoutes from './routes/admin.js';
import { razorpayWebhookRoutes } from './razorpay.js';

export function buildApp(config, { logger = true } = {}) {
  const app = Fastify({ logger, trustProxy: true, bodyLimit: 64 * 1024 });
  const db = openDb(config.dbFile);
  app.decorate('db', db);
  app.addHook('onClose', async () => db.close());

  app.register(cookie);

  app.setErrorHandler((err, request, reply) => {
    const status = err.statusCode && err.statusCode < 600 ? err.statusCode : 500;
    if (status >= 500) request.log.error(err);
    reply.status(status).send({ error: status >= 500 ? 'Something went wrong' : err.message });
  });

  const deps = { db, config };
  app.register(authRoutes, deps);
  app.register(customerRoutes, { ...deps, prefix: '/api/customer' });
  app.register(driverRoutes, { ...deps, prefix: '/api/driver' });
  app.register(adminRoutes, { ...deps, prefix: '/api/admin' });
  app.register(razorpayWebhookRoutes, deps);
  app.get('/api/health', async () => ({ ok: true }));

  // Serve the built PWA; any non-API path falls back to index.html.
  const hasWeb = fs.existsSync(config.webDist);
  if (hasWeb) {
    app.register(fastifyStatic, {
      root: config.webDist,
      wildcard: false,
      setHeaders(reply, filePath) {
        if (filePath.endsWith('sw.js') || filePath.endsWith('.html') || filePath.endsWith('.webmanifest')) {
          reply.header('Cache-Control', 'no-cache');
        } else if (filePath.includes('/assets/')) {
          reply.header('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    });
  }
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/') || !hasWeb || request.method !== 'GET') {
      return reply.status(404).send({ error: 'Not found' });
    }
    return reply.type('text/html').header('Cache-Control', 'no-cache').sendFile('index.html');
  });

  return app;
}
