import { loadConfig } from './config.js';
import { buildApp } from './app.js';

const config = loadConfig();
const app = buildApp(config);

try {
  await app.listen({ port: config.port, host: config.host });
  if (config.devLogin) app.log.warn('DEV_LOGIN is on: anyone can sign in without Google or SMS. Never enable this in production.');
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
}
