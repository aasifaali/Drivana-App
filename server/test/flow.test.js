import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../config.js';
import { buildApp } from '../app.js';
import { finalFare } from '../pricing.js';

function setup() {
  const config = loadConfig({ DEV_LOGIN: '1', DB_PATH: ':memory:' });
  config.webDist = '/nonexistent';
  const app = buildApp(config, { logger: false });
  return app;
}

// Tiny client that keeps one cookie jar per actor.
function client(app) {
  const jar = {};
  return async (method, url, body) => {
    const res = await app.inject({
      method,
      url,
      payload: body,
      headers: { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') },
    });
    for (const c of res.cookies) jar[c.name] = c.value;
    const data = res.body ? res.json() : null;
    return { status: res.statusCode, data };
  };
}

test('full cash booking flow', async () => {
  const app = setup();
  const customer = client(app);
  const driver = client(app);
  const driver2 = client(app);
  const admin = client(app);

  assert.equal((await customer('GET', '/api/customer/me')).status, 401);

  await customer('POST', '/api/auth/dev', { role: 'customer', name: 'Anita S' });
  await driver('POST', '/api/auth/dev', { role: 'driver', phone: '9876543210' });
  await driver2('POST', '/api/auth/dev', { role: 'driver', phone: '9876543211' });
  await admin('POST', '/api/auth/dev', { role: 'admin', name: 'Ops' });

  // Booking needs a verified phone.
  let r = await customer('POST', '/api/customer/vehicles', { model: 'Hyundai Creta', transmission: 'automatic', regNumber: 'kl 13 ab 1234' });
  assert.equal(r.status, 200);
  const vehicleId = r.data.id;
  r = await customer('POST', '/api/customer/bookings', { vehicleId, pickupAddress: 'Near Kovvappuram Junction', hours: 4 });
  assert.equal(r.status, 400);
  assert.equal((await customer('PUT', '/api/customer/phone', { phone: '12345' })).status, 400, 'invalid number');
  assert.equal((await customer('PUT', '/api/customer/phone', { phone: '90000 00001' })).data.phone, '+919000000001');

  // Driver onboarding and approval.
  r = await driver('PUT', '/api/driver/profile', {
    name: 'Ravi Kumar', phone: '9876543210', licenceNumber: 'KL1320200001234', licenceExpiry: '2035-01-01', transmissions: 'both', experienceYears: 6,
  });
  assert.equal(r.status, 200);
  assert.equal((await driver('POST', '/api/driver/status', { online: true })).status, 403);
  assert.equal((await driver2('PUT', '/api/driver/profile', { name: 'Dup', phone: '9876543210', licenceNumber: 'KL1320200009999', licenceExpiry: '2035-01-01', transmissions: 'manual' })).status, 409, 'driver numbers are unique');
  await driver2('PUT', '/api/driver/profile', { name: 'Manual Only', licenceNumber: 'KL1320200009999', licenceExpiry: '2035-01-01', transmissions: 'manual' });
  const drivers = (await admin('GET', '/api/admin/drivers')).data;
  for (const d of drivers) await admin('POST', `/api/admin/drivers/${d.id}/status`, { status: 'approved' });
  assert.equal((await driver('POST', '/api/driver/status', { online: true, lat: 11.95, lng: 75.35 })).status, 200);
  await driver2('POST', '/api/driver/status', { online: true, lat: 11.95, lng: 75.35 });

  // Customer books.
  r = await customer('POST', '/api/customer/bookings', { vehicleId, pickupAddress: 'Near Kovvappuram Junction', pickupLat: 11.96, pickupLng: 75.36, hours: 4 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const booking = r.data;
  assert.equal(booking.estimate, 400 + 2 * 150);
  assert.match(booking.startOtp, /^\d{4}$/);
  assert.equal((await customer('POST', '/api/customer/bookings', { vehicleId, pickupAddress: 'Second booking here', hours: 2 })).status, 409);

  // Manual-only driver must not see an automatic car; the other driver does.
  assert.equal((await driver2('GET', '/api/driver/requests')).data.length, 0);
  r = await driver('GET', '/api/driver/requests');
  assert.equal(r.data.length, 1);
  assert.equal(r.data[0].startOtp, undefined, 'drivers must not see the OTP');
  assert.equal(r.data[0].customer.phone, undefined, 'phone hidden before accepting');

  assert.equal((await driver('POST', `/api/driver/requests/${booking.id}/accept`)).status, 200);
  assert.equal((await driver2('POST', `/api/driver/requests/${booking.id}/accept`)).status, 403, 'wrong transmission');
  await admin('POST', `/api/admin/drivers/${drivers.find((d) => d.name === 'Manual Only').id}/status`, { status: 'approved' });
  app.db.prepare("UPDATE drivers SET transmissions = 'both' WHERE user_id = (SELECT id FROM users WHERE name = 'Manual Only')").run();
  assert.equal((await driver2('POST', `/api/driver/requests/${booking.id}/accept`)).status, 409, 'already taken');

  r = await customer('GET', '/api/customer/me');
  assert.equal(r.data.activeBooking.status, 'accepted');
  assert.equal(r.data.activeBooking.driver.name, 'Ravi Kumar');

  await driver('POST', `/api/driver/bookings/${booking.id}/arrived`);
  assert.equal((await driver('POST', `/api/driver/bookings/${booking.id}/start`, { otp: '0000' })).status, booking.startOtp === '0000' ? 200 : 400);
  assert.equal((await driver('POST', `/api/driver/bookings/${booking.id}/start`, { otp: booking.startOtp })).status, 200);

  // Pretend the trip lasted 4h40m.
  const started = new Date(Date.now() - (4 * 60 + 40) * 60000).toISOString();
  app.db.prepare('UPDATE bookings SET started_at = ? WHERE id = ?').run(started, booking.id);
  r = await driver('POST', `/api/driver/bookings/${booking.id}/end`);
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'completed');
  assert.equal(r.data.fareBreakdown.extra, 150); // 40 min over → two 30-min blocks
  const total = r.data.fareTotal;

  r = await driver('POST', `/api/driver/bookings/${booking.id}/cash-collected`);
  assert.equal(r.status, 200);
  let me = (await driver('GET', '/api/driver/me')).data;
  assert.equal(me.owed, Math.round(total * 0.2));

  assert.equal((await customer('POST', `/api/customer/bookings/${booking.id}/rate`, { stars: 5, tags: ['On time'] })).status, 200);
  assert.equal((await customer('GET', '/api/customer/me')).data.activeBooking, null);

  // Settlement clears the dues.
  await admin('POST', `/api/admin/drivers/${me.user.id}/settlement`, { amount: me.owed });
  me = (await driver('GET', '/api/driver/me')).data;
  assert.equal(me.owed, 0);
  assert.equal(me.profile.rating, 5);

  // Owed limit blocks going online.
  await admin('PUT', '/api/admin/settings', { owedLimit: 0 });
  app.db.prepare("INSERT INTO ledger_entries (driver_id, kind, amount, created_at) VALUES (?, 'adjustment', 10, 'x')").run(me.user.id);
  assert.equal((await driver('POST', '/api/driver/status', { online: true })).status, 403);

  await app.close();
});

test('admin assign and cancel', async () => {
  const app = setup();
  const customer = client(app);
  const driver = client(app);
  const admin = client(app);
  await customer('POST', '/api/auth/dev', { role: 'customer', name: 'Karthik' });
  await driver('POST', '/api/auth/dev', { role: 'driver', phone: '9123456789' });
  await admin('POST', '/api/auth/dev', { role: 'admin' });
  app.db.prepare("UPDATE users SET phone = '+919000000002' WHERE role = 'customer'").run();
  const { data: v } = await customer('POST', '/api/customer/vehicles', { model: 'Swift', transmission: 'manual', regNumber: 'KL13X1' });
  const { data: b } = await customer('POST', '/api/customer/bookings', { vehicleId: v.id, pickupAddress: 'Kovvappuram market', hours: 2 });
  await driver('PUT', '/api/driver/profile', { name: 'Suresh', licenceNumber: 'KL0000111', licenceExpiry: '2034-05-05', transmissions: 'manual' });
  const driverId = (await admin('GET', '/api/admin/drivers')).data[0].id;

  assert.equal((await admin('POST', `/api/admin/bookings/${b.id}/assign`, { driverId })).status, 400, 'pending drivers cannot be assigned');
  await admin('POST', `/api/admin/drivers/${driverId}/status`, { status: 'approved' });
  const cands = (await admin('GET', `/api/admin/bookings/${b.id}/candidates`)).data;
  assert.equal(cands.length, 1);
  assert.equal((await admin('POST', `/api/admin/bookings/${b.id}/assign`, { driverId })).status, 200);
  assert.equal((await driver('GET', '/api/driver/me')).data.activeBooking.id, b.id);
  assert.equal((await admin('POST', `/api/admin/bookings/${b.id}/cancel`, { reason: 'Customer called' })).status, 200);
  assert.equal((await customer('GET', '/api/customer/me')).data.activeBooking, null);
  assert.equal((await customer('GET', '/api/admin/overview')).status, 401, 'customers cannot reach admin APIs');
  await app.close();
});

test('night charge and grace period', () => {
  const p = { minHours: 2, baseFare: 400, hourlyRate: 150, graceMinutes: 10, nightCharge: 150, commissionPct: 20 };
  // 10:00–12:08 IST: within grace, daytime.
  let f = finalFare(p, 2, '2026-11-01T04:30:00Z', '2026-11-01T06:38:00Z');
  assert.deepEqual([f.total, f.breakdown.extra, f.breakdown.night], [400, 0, 0]);
  // 21:00–23:00 IST: crosses 22:00.
  f = finalFare(p, 2, '2026-11-01T15:30:00Z', '2026-11-01T17:30:00Z');
  assert.equal(f.breakdown.night, 150);
  assert.equal(f.commission, Math.round(550 * 0.2));
});
