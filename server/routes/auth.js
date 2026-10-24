import { now } from '../db.js';
import { getSettings, httpError } from '../settings.js';
import {
  checkOtp,
  clearSession,
  normalizePhone,
  requestOtp,
  setSession,
  upsertGoogleUser,
  verifyGoogleCredential,
} from '../auth.js';

export default async function authRoutes(app, { db, config }) {
  app.get('/api/config', async () => {
    const s = getSettings(db);
    return {
      googleClientId: config.googleClientId,
      devLogin: config.devLogin,
      city: s.city,
      supportPhone: s.supportPhone,
      supportWhatsapp: s.supportWhatsapp,
      minHours: s.minHours,
    };
  });

  // Customers and admins sign in with Google.
  app.post('/api/auth/google', async (request, reply) => {
    const { credential, role } = request.body || {};
    if (!['customer', 'admin'].includes(role)) throw httpError(400, 'Invalid role');
    const profile = await verifyGoogleCredential(config, credential);
    if (role === 'admin' && !config.adminEmails.includes(profile.email)) {
      throw httpError(403, 'This Google account is not allowed to use the dashboard');
    }
    const user = upsertGoogleUser(db, role, profile);
    setSession(reply, config, user);
    return { ok: true };
  });

  // Drivers sign in with their phone number.
  app.post('/api/auth/driver/otp', async (request) => {
    const phone = normalizePhone(request.body?.phone);
    await requestOtp(config, 'driver-login', phone, request.log);
    return { ok: true, phone };
  });

  app.post('/api/auth/driver/verify', async (request, reply) => {
    const phone = normalizePhone(request.body?.phone);
    checkOtp('driver-login', phone, request.body?.code);
    const user = findOrCreateDriver(db, phone);
    setSession(reply, config, user);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    clearSession(reply, request.body?.role);
    return { ok: true };
  });

  if (config.devLogin) {
    // Local testing only (DEV_LOGIN=1, never in production).
    app.post('/api/auth/dev', async (request, reply) => {
      const { role, name, phone, email } = request.body || {};
      if (!['customer', 'driver', 'admin'].includes(role)) throw httpError(400, 'Invalid role');
      let user;
      if (role === 'driver') {
        user = findOrCreateDriver(db, normalizePhone(phone));
        if (name && !user.name) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, user.id);
      } else {
        const label = String(name || `Test ${role}`).trim();
        const fakeEmail = (email || `${label.toLowerCase().replace(/\W+/g, '.')}@dev.local`).toLowerCase();
        user = upsertGoogleUser(db, role, { sub: `dev:${fakeEmail}`, email: fakeEmail, name: label });
      }
      setSession(reply, config, user);
      return { ok: true };
    });
  }
}

function findOrCreateDriver(db, phone) {
  const existing = db.prepare("SELECT * FROM users WHERE role = 'driver' AND phone = ?").get(phone);
  if (existing) return existing;
  const ts = now();
  const { lastInsertRowid } = db.prepare("INSERT INTO users (role, phone, created_at) VALUES ('driver', ?, ?)").run(phone, ts);
  db.prepare('INSERT INTO drivers (user_id) VALUES (?)').run(lastInsertRowid);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid);
}
