import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { loadConfig } from '../config.js';
import { buildApp } from '../app.js';

const KEY_SECRET = 'test_key_secret';
const WEBHOOK_SECRET = 'test_webhook_secret';
const sign = (payload, secret) => crypto.createHmac('sha256', secret).update(payload).digest('hex');

function setup() {
  const config = loadConfig({
    DEV_LOGIN: '1',
    DB_PATH: ':memory:',
    RAZORPAY_KEY_ID: 'rzp_test_dummy',
    RAZORPAY_KEY_SECRET: KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
  });
  config.webDist = '/nonexistent';
  return buildApp(config, { logger: false });
}

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
    return { status: res.statusCode, data: res.body ? res.json() : null };
  };
}

// Stand-in for Razorpay's Orders API.
let orderCount = 0;
const realFetch = globalThis.fetch;
function fakeRazorpay() {
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://api.razorpay.com/v1/orders');
    const body = JSON.parse(init.body);
    return new Response(JSON.stringify({ id: `order_test${++orderCount}`, amount: body.amount, currency: 'INR', status: 'created' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
}

async function finishedTrip({ customer, driver }, vehicleId) {
  let r = await customer('POST', '/api/customer/bookings', { vehicleId, pickupAddress: 'Near Kovvappuram Junction', hours: 2 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const id = r.data.id;
  await driver('POST', `/api/driver/requests/${id}/accept`);
  await driver('POST', `/api/driver/bookings/${id}/arrived`);
  const otp = (await customer('GET', '/api/customer/me')).data.activeBooking.startOtp;
  assert.equal((await driver('POST', `/api/driver/bookings/${id}/start`, { otp })).status, 200);
  r = await driver('POST', `/api/driver/bookings/${id}/end`);
  assert.equal(r.data.status, 'completed');
  return r.data;
}

test('online payment after the trip', async (t) => {
  fakeRazorpay();
  t.after(() => { globalThis.fetch = realFetch; });
  const app = setup();
  const customer = client(app);
  const driver = client(app);
  const admin = client(app);

  assert.equal((await customer('GET', '/api/config')).data.onlinePayments, true);
  await customer('POST', '/api/auth/dev', { role: 'customer', name: 'Anita S' });
  await driver('POST', '/api/auth/dev', { role: 'driver', phone: '9876543210' });
  await admin('POST', '/api/auth/dev', { role: 'admin', name: 'Ops' });
  await customer('PUT', '/api/customer/phone', { phone: '9000000001' });
  const vehicleId = (await customer('POST', '/api/customer/vehicles', { model: 'Swift', transmission: 'manual', regNumber: 'KL13AB1234' })).data.id;
  await driver('PUT', '/api/driver/profile', { name: 'Ravi', licenceNumber: 'KL1320200001234', licenceExpiry: '2035-01-01', transmissions: 'both' });
  const [d] = (await admin('GET', '/api/admin/drivers')).data;
  await admin('POST', `/api/admin/drivers/${d.id}/status`, { status: 'approved' });
  await driver('POST', '/api/driver/status', { online: true });

  // Paid through checkout.
  const trip = await finishedTrip({ customer, driver }, vehicleId);
  let r = await customer('POST', `/api/customer/bookings/${trip.id}/pay`);
  assert.equal(r.status, 200);
  assert.equal(r.data.amount, trip.fareTotal * 100);
  assert.equal(r.data.keyId, 'rzp_test_dummy');
  assert.equal(JSON.stringify(r.data).includes(KEY_SECRET), false, 'secret never sent to the browser');
  const orderId = r.data.orderId;
  assert.equal((await customer('POST', `/api/customer/bookings/${trip.id}/pay`)).data.orderId, orderId, 'order is reused');

  const paymentId = 'pay_test1';
  r = await customer('POST', `/api/customer/bookings/${trip.id}/pay/verify`, { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: 'forged' });
  assert.equal(r.status, 400, 'forged signature rejected');
  r = await customer('POST', `/api/customer/bookings/${trip.id}/pay/verify`, {
    razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: sign(`${orderId}|${paymentId}`, KEY_SECRET),
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.paymentStatus, 'collected');
  assert.equal(r.data.paymentMethod, 'online');

  // Drivana holds the fare, so it owes the driver their share.
  let me = (await driver('GET', '/api/driver/me')).data;
  assert.equal(me.owed, -trip.driverEarning);
  assert.equal(me.activeBooking, null, 'paid trip leaves the driver screen');
  assert.equal((await driver('POST', `/api/driver/bookings/${trip.id}/cash-collected`)).status, 409);

  // A webhook for the same payment changes nothing.
  const event = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: paymentId, order_id: orderId, amount: trip.fareTotal * 100 } } } });
  r = await app.inject({ method: 'POST', url: '/api/razorpay/webhook', payload: event, headers: { 'content-type': 'application/json', 'x-razorpay-signature': sign(event, WEBHOOK_SECRET) } });
  assert.equal(r.statusCode, 200);
  assert.equal((await driver('GET', '/api/driver/me')).data.owed, -trip.driverEarning);

  // Paid, but the customer closed the app: only the webhook arrives.
  const trip2 = await finishedTrip({ customer, driver }, vehicleId);
  const order2 = (await customer('POST', `/api/customer/bookings/${trip2.id}/pay`)).data.orderId;
  const event2 = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_test2', order_id: order2, amount: trip2.fareTotal * 100 } } } });
  r = await app.inject({ method: 'POST', url: '/api/razorpay/webhook', payload: event2, headers: { 'content-type': 'application/json', 'x-razorpay-signature': 'bad' } });
  assert.equal(r.statusCode, 400, 'unsigned webhook rejected');
  r = await app.inject({ method: 'POST', url: '/api/razorpay/webhook', payload: event2, headers: { 'content-type': 'application/json', 'x-razorpay-signature': sign(event2, WEBHOOK_SECRET) } });
  assert.equal(r.statusCode, 200);
  assert.equal((await customer('GET', `/api/customer/bookings/${trip2.id}`)).data.paymentMethod, 'online');

  // Ops pays the driver out by UPI.
  const owedToDriver = trip.driverEarning + trip2.driverEarning;
  assert.equal((await admin('GET', '/api/admin/overview')).data.owedToDrivers, owedToDriver);
  await admin('POST', `/api/admin/drivers/${d.id}/settlement`, { amount: owedToDriver, direction: 'payout' });
  me = (await driver('GET', '/api/driver/me')).data;
  assert.equal(me.owed, 0);
  await app.close();
});

test('online payment is off without keys', async () => {
  const config = loadConfig({ DEV_LOGIN: '1', DB_PATH: ':memory:' });
  config.webDist = '/nonexistent';
  const app = buildApp(config, { logger: false });
  const r = await app.inject({ method: 'GET', url: '/api/config' });
  assert.equal(r.json().onlinePayments, false);
  await app.close();
});
