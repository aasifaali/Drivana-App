import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const config = {
    production,
    port: Number(env.PORT || 3000),
    host: env.HOST || '127.0.0.1',
    dbFile: env.DB_PATH || path.join(root, 'data', 'drivana.db'),
    webDist: path.join(root, 'web', 'dist'),
    jwtSecret: env.JWT_SECRET || '',
    googleClientId: env.GOOGLE_CLIENT_ID || '',
    adminEmails: (env.ADMIN_EMAILS || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
    // Local testing only: sign in without Google or SMS. Never on in production.
    devLogin: !production && env.DEV_LOGIN === '1',
    smsProvider: env.SMS_PROVIDER || 'console',
  };
  if (production && config.jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be set to at least 32 random characters in production');
  }
  if (!config.jwtSecret) config.jwtSecret = 'dev-only-secret-change-me-dev-only-secret';
  return config;
}
