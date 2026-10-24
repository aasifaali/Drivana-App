import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { now } from './db.js';
import { httpError } from './settings.js';
import { sendSms } from './sms.js';

// One cookie per role, so the same browser can be signed in to the customer
// app, the driver app and the dashboard at once.
const COOKIE = { customer: 'dv_c', driver: 'dv_d', admin: 'dv_a' };
const SESSION_DAYS = 30;

export function setSession(reply, config, user) {
  const token = jwt.sign({ uid: user.id, role: user.role }, config.jwtSecret, { expiresIn: `${SESSION_DAYS}d` });
  reply.setCookie(COOKIE[user.role], token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.production,
    maxAge: SESSION_DAYS * 86400,
  });
}

export function clearSession(reply, role) {
  if (COOKIE[role]) reply.clearCookie(COOKIE[role], { path: '/' });
}

// preHandler: attaches request.user or answers 401.
export function requireRole(db, config, role) {
  const findUser = db.prepare('SELECT * FROM users WHERE id = ? AND role = ?');
  return async (request) => {
    const token = request.cookies[COOKIE[role]];
    if (!token) throw httpError(401, 'Please sign in');
    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch {
      throw httpError(401, 'Session expired, please sign in again');
    }
    const user = findUser.get(payload.uid, role);
    if (!user) throw httpError(401, 'Please sign in');
    request.user = user;
  };
}

let googleClient;
export async function verifyGoogleCredential(config, credential) {
  if (!config.googleClientId) throw httpError(500, 'Google sign-in is not configured');
  googleClient ??= new OAuth2Client(config.googleClientId);
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: config.googleClientId });
    const p = ticket.getPayload();
    if (!p.email_verified) throw new Error('unverified');
    return { sub: p.sub, email: p.email.toLowerCase(), name: p.name || p.email };
  } catch {
    throw httpError(401, 'Google sign-in failed');
  }
}

export function upsertGoogleUser(db, role, { sub, email, name }) {
  const existing = db.prepare('SELECT * FROM users WHERE role = ? AND google_sub = ?').get(role, sub);
  if (existing) {
    db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, existing.id);
    return { ...existing, email };
  }
  const { lastInsertRowid } = db
    .prepare('INSERT INTO users (role, name, email, google_sub, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(role, name, email, sub, now());
  return db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid);
}

// ---- Phone OTP --------------------------------------------------------------

export function normalizePhone(input) {
  const digits = String(input || '').replace(/\D/g, '');
  const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  if (!/^[6-9]\d{9}$/.test(local)) throw httpError(400, 'Enter a valid 10-digit Indian mobile number');
  return `+91${local}`;
}

const OTP_TTL_MS = 5 * 60000;
const RESEND_MS = 30000;
const MAX_ATTEMPTS = 5;
const otps = new Map(); // key -> { hash, expires, attempts, sentAt }

const hash = (code) => crypto.createHash('sha256').update(code).digest('hex');

export async function requestOtp(config, purpose, phone, log) {
  const key = `${purpose}:${phone}`;
  const prev = otps.get(key);
  if (prev && Date.now() - prev.sentAt < RESEND_MS) throw httpError(429, 'Please wait 30 seconds before asking for another code');
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  otps.set(key, { hash: hash(code), expires: Date.now() + OTP_TTL_MS, attempts: 0, sentAt: Date.now() });
  await sendSms(config, phone, `${code} is your Drivana verification code. It expires in 5 minutes.`, log);
}

export function checkOtp(purpose, phone, code) {
  const key = `${purpose}:${phone}`;
  const entry = otps.get(key);
  if (!entry || entry.expires < Date.now()) throw httpError(400, 'Code expired, please request a new one');
  entry.attempts += 1;
  if (entry.attempts > MAX_ATTEMPTS) {
    otps.delete(key);
    throw httpError(429, 'Too many attempts, please request a new code');
  }
  const ok = crypto.timingSafeEqual(Buffer.from(entry.hash), Buffer.from(hash(String(code || '').trim())));
  if (!ok) throw httpError(400, 'Incorrect code');
  otps.delete(key);
}
