import crypto from 'node:crypto';
import { now, tx } from './db.js';
import { logEvent } from './bookings.js';
import { httpError } from './settings.js';

// Razorpay Orders API over plain fetch. The secret never leaves the server;
// the browser only gets the key id and an order id.
export async function createOrder(config, { amount, receipt, notes }) {
  const { keyId, keySecret } = config.razorpay;
  let res;
  try {
    res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount, currency: 'INR', receipt, notes }),
    });
  } catch {
    throw httpError(502, 'Could not reach the payment provider. Please try again.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.id) throw httpError(502, data?.error?.description || 'Could not start the payment');
  return data;
}

function hmacMatches(payload, secret, signature) {
  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(payload).digest('hex'));
  const given = Buffer.from(String(signature || ''));
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

// Checkout returns this signature after a successful payment.
export const paymentSignatureValid = (config, orderId, paymentId, signature) =>
  hmacMatches(`${orderId}|${paymentId}`, config.razorpay.keySecret, signature);

export const webhookSignatureValid = (config, rawBody, signature) =>
  !!config.razorpay.webhookSecret && hmacMatches(rawBody, config.razorpay.webhookSecret, signature);

// Marks a completed trip as paid online. Safe to call twice (checkout + webhook).
// Drivana now holds the fare, so the driver's share goes on their ledger as
// money Drivana owes them (a negative entry).
export function markPaidOnline(db, bookingId, orderId, paymentId) {
  return tx(db, () => {
    const b = db.prepare('SELECT * FROM bookings WHERE id = ? AND razorpay_order_id = ?').get(bookingId, orderId);
    if (!b) return false;
    if (b.payment_status === 'collected') {
      if (b.razorpay_payment_id !== paymentId) {
        // Already paid another way (e.g. cash) — flag it so the team can refund.
        logEvent(db, b.id, null, 'duplicate_online_payment', { paymentId });
      }
      return false;
    }
    db.prepare(
      `UPDATE bookings SET payment_status = 'collected', payment_method = 'online', razorpay_payment_id = ?, paid_at = ?
       WHERE id = ? AND payment_status = 'pending'`,
    ).run(paymentId, now(), b.id);
    db.prepare("INSERT INTO ledger_entries (driver_id, booking_id, kind, amount, note, created_at) VALUES (?, ?, 'online_fare', ?, ?, ?)").run(
      b.driver_id, b.id, -b.driver_earning, `Your share of online trip ${b.id}`, now(),
    );
    logEvent(db, b.id, null, 'paid_online', { amount: b.fare_total, paymentId });
    return true;
  });
}

// Razorpay calls this when a payment is captured, in case the customer closed
// the app before checkout reported back. Needs the raw body for the signature.
export async function razorpayWebhookRoutes(app, { db, config }) {
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    request.rawBody = body;
    try {
      done(null, JSON.parse(body));
    } catch {
      done(httpError(400, 'Invalid JSON'));
    }
  });

  app.post('/api/razorpay/webhook', async (request) => {
    if (!webhookSignatureValid(config, request.rawBody, request.headers['x-razorpay-signature'])) {
      throw httpError(400, 'Invalid signature');
    }
    const { event, payload } = request.body || {};
    const payment = payload?.payment?.entity;
    if (!['payment.captured', 'order.paid'].includes(event) || !payment?.order_id) return { ok: true };
    const b = db.prepare('SELECT id, fare_total FROM bookings WHERE razorpay_order_id = ?').get(payment.order_id);
    if (b && payment.amount === b.fare_total * 100) markPaidOnline(db, b.id, payment.order_id, payment.id);
    return { ok: true };
  });
}
