import crypto from 'node:crypto';
import { now, tx } from '../db.js';
import { normalizePhone, requireRole } from '../auth.js';
import { getSettings, httpError } from '../settings.js';
import { estimateFare, pricingSnapshot } from '../pricing.js';
import { activeBookingFor, bookingCode, bookingView, getBooking, listBookings, logEvent, unpaidCompletedFor } from '../bookings.js';
import { createOrder, markPaidOnline, paymentSignatureValid } from '../razorpay.js';

const CANCELLABLE = ['requested', 'accepted', 'arrived'];
const RATING_TAGS = ['Smooth driving', 'On time', 'Car cared for', 'Polite', 'Knew the roads'];

export default async function customerRoutes(app, { db, config }) {
  app.addHook('preHandler', requireRole(db, config, 'customer'));

  const vehiclesOf = (userId) =>
    db
      .prepare('SELECT id, model, transmission, reg_number AS regNumber FROM vehicles WHERE user_id = ? AND archived = 0 ORDER BY id')
      .all(userId);

  const ownBooking = (request) => {
    const b = getBooking(db, Number(request.params.id));
    if (!b || b.customer_id !== request.user.id) throw httpError(404, 'Booking not found');
    return b;
  };

  app.get('/me', async (request) => {
    const u = request.user;
    const active = activeBookingFor(db, 'customer_id', u.id) || unpaidOrUnrated(u.id);
    return {
      user: { id: u.id, name: u.name, email: u.email, phone: u.phone },
      vehicles: vehiclesOf(u.id),
      activeBooking: bookingView(active, 'customer'),
      ratingTags: RATING_TAGS,
    };
  });

  // A finished trip stays on screen until it is paid and rated (or skipped).
  function unpaidOrUnrated(userId) {
    const unpaid = unpaidCompletedFor(db, 'customer_id', userId);
    if (unpaid) return unpaid;
    return db
      .prepare(
        `SELECT id FROM bookings WHERE customer_id = ? AND status = 'completed' AND rating IS NULL
         AND ended_at > ? ORDER BY id DESC LIMIT 1`,
      )
      .all(userId, new Date(Date.now() - 6 * 3600000).toISOString())
      .map((r) => getBooking(db, r.id))[0];
  }

  app.patch('/me', async (request) => {
    const name = String(request.body?.name || '').trim();
    if (!name) throw httpError(400, 'Name is required');
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name.slice(0, 80), request.user.id);
    return { ok: true };
  });

  // Customers type their number once, no OTP. The driver uses it to call them.
  app.put('/phone', async (request) => {
    const phone = normalizePhone(request.body?.phone);
    db.prepare('UPDATE users SET phone = ? WHERE id = ?').run(phone, request.user.id);
    return { ok: true, phone };
  });

  app.post('/vehicles', async (request) => {
    const { model, transmission, regNumber } = request.body || {};
    if (!String(model || '').trim()) throw httpError(400, 'Car model is required');
    if (!['manual', 'automatic'].includes(transmission)) throw httpError(400, 'Choose manual or automatic');
    const reg = String(regNumber || '').toUpperCase().replace(/\s+/g, ' ').trim();
    if (reg.length < 4) throw httpError(400, 'Registration number is required');
    const { lastInsertRowid } = db
      .prepare('INSERT INTO vehicles (user_id, model, transmission, reg_number, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(request.user.id, String(model).trim().slice(0, 60), transmission, reg.slice(0, 20), now());
    return { id: Number(lastInsertRowid) };
  });

  app.delete('/vehicles/:id', async (request) => {
    db.prepare('UPDATE vehicles SET archived = 1 WHERE id = ? AND user_id = ?').run(Number(request.params.id), request.user.id);
    return { ok: true };
  });

  app.get('/estimate', async (request) => {
    const s = getSettings(db);
    const hours = parseHours(request.query.hours, s.minHours);
    return { hours, estimate: estimateFare(s, hours), pricing: pricingSnapshot(s) };
  });

  app.post('/bookings', async (request) => {
    const u = request.user;
    const { vehicleId, pickupAddress, pickupLat, pickupLng, hours: rawHours } = request.body || {};
    if (!u.phone) throw httpError(400, 'Verify your phone number first');
    const address = String(pickupAddress || '').trim();
    if (address.length < 5) throw httpError(400, 'Enter your pickup address');
    const vehicle = db.prepare('SELECT id FROM vehicles WHERE id = ? AND user_id = ? AND archived = 0').get(Number(vehicleId), u.id);
    if (!vehicle) throw httpError(400, 'Choose your car');
    const s = getSettings(db);
    const hours = parseHours(rawHours, s.minHours);
    const lat = isCoord(pickupLat, 90) ? Number(pickupLat) : null;
    const lng = isCoord(pickupLng, 180) ? Number(pickupLng) : null;
    const pricing = pricingSnapshot(s);

    const id = tx(db, () => {
      if (activeBookingFor(db, 'customer_id', u.id)) throw httpError(409, 'You already have an active booking');
      const { lastInsertRowid } = db
        .prepare(
          `INSERT INTO bookings (customer_id, vehicle_id, status, pickup_address, pickup_lat, pickup_lng,
             booked_hours, start_otp, pricing, estimate, created_at)
           VALUES (?, ?, 'requested', ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(u.id, vehicle.id, address.slice(0, 200), lat, lng, hours, String(crypto.randomInt(1000, 10000)),
          JSON.stringify(pricing), estimateFare(pricing, hours), now());
      logEvent(db, lastInsertRowid, u.id, 'requested', { hours });
      return Number(lastInsertRowid);
    });
    return bookingView(getBooking(db, id), 'customer');
  });

  app.get('/bookings', async (request) => {
    return listBookings(db, 'b.customer_id = ?', [request.user.id], 50).map((b) => bookingView(b, 'customer'));
  });

  app.get('/bookings/:id', async (request) => bookingView(ownBooking(request), 'customer'));

  app.post('/bookings/:id/cancel', async (request) => {
    const b = ownBooking(request);
    const reason = String(request.body?.reason || 'Cancelled by customer').slice(0, 200);
    const { changes } = db
      .prepare(
        `UPDATE bookings SET status = 'cancelled', cancel_reason = ?, cancelled_by = 'customer', cancelled_at = ?
         WHERE id = ? AND status IN ('${CANCELLABLE.join("','")}')`,
      )
      .run(reason, now(), b.id);
    if (!changes) throw httpError(409, 'This booking can no longer be cancelled');
    logEvent(db, b.id, request.user.id, 'cancelled', { reason });
    return bookingView(getBooking(db, b.id), 'customer');
  });

  // Pay after the trip, online. Step 1: a Razorpay order for the exact final fare.
  app.post('/bookings/:id/pay', async (request) => {
    if (!config.onlinePayments) throw httpError(400, 'Online payment is not available yet. Please pay in cash.');
    const b = ownBooking(request);
    if (b.status !== 'completed') throw httpError(409, 'You can pay once the trip ends');
    if (b.payment_status !== 'pending') throw httpError(409, 'This trip is already paid');
    let orderId = b.razorpay_order_id;
    if (!orderId) {
      const order = await createOrder(config, {
        amount: b.fare_total * 100,
        receipt: bookingCode(b.id),
        notes: { booking_id: String(b.id) },
      });
      orderId = order.id;
      db.prepare('UPDATE bookings SET razorpay_order_id = ? WHERE id = ? AND razorpay_order_id IS NULL').run(orderId, b.id);
      orderId = db.prepare('SELECT razorpay_order_id FROM bookings WHERE id = ?').get(b.id).razorpay_order_id;
    }
    const u = request.user;
    return {
      keyId: config.razorpay.keyId,
      orderId,
      amount: b.fare_total * 100,
      currency: 'INR',
      description: `Trip ${bookingCode(b.id)}`,
      prefill: { name: u.name || '', email: u.email || '', contact: u.phone || '' },
    };
  });

  // Step 2: checkout hands back a signed payment; verify it before marking paid.
  app.post('/bookings/:id/pay/verify', async (request) => {
    const b = ownBooking(request);
    const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = request.body || {};
    if (!orderId || orderId !== b.razorpay_order_id || !paymentId) throw httpError(400, 'Payment details do not match this trip');
    if (!paymentSignatureValid(config, orderId, paymentId, signature)) throw httpError(400, 'Could not verify the payment');
    markPaidOnline(db, b.id, orderId, paymentId);
    return bookingView(getBooking(db, b.id), 'customer');
  });

  app.post('/bookings/:id/rate', async (request) => {
    const b = ownBooking(request);
    if (b.status !== 'completed') throw httpError(409, 'You can rate a trip once it ends');
    const stars = Number(request.body?.stars);
    const skip = request.body?.skip === true;
    if (!skip && !(Number.isInteger(stars) && stars >= 1 && stars <= 5)) throw httpError(400, 'Choose 1 to 5 stars');
    const tags = (Array.isArray(request.body?.tags) ? request.body.tags : []).filter((t) => RATING_TAGS.includes(t));
    tx(db, () => {
      // rating 0 = skipped, so the trip stops showing on the home screen.
      const { changes } = db
        .prepare('UPDATE bookings SET rating = ?, rating_tags = ? WHERE id = ? AND rating IS NULL')
        .run(skip ? 0 : stars, JSON.stringify(tags), b.id);
      if (!changes) throw httpError(409, 'Already rated');
      if (!skip && b.driver_id) {
        db.prepare('UPDATE drivers SET rating_sum = rating_sum + ?, rating_count = rating_count + 1 WHERE user_id = ?').run(stars, b.driver_id);
      }
    });
    return { ok: true };
  });
}

function parseHours(raw, minHours) {
  const hours = Number(raw ?? minHours);
  if (!Number.isInteger(hours) || hours < minHours || hours > 24) {
    throw httpError(400, `Hours must be a whole number from ${minHours} to 24`);
  }
  return hours;
}

const isCoord = (v, max) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) && Math.abs(Number(v)) <= max;
