import { now, tx } from '../db.js';
import { normalizePhone, requireRole } from '../auth.js';
import { getSettings, httpError } from '../settings.js';
import { distanceKm, finalFare } from '../pricing.js';
import {
  activeBookingFor,
  bookingView,
  canDrive,
  getBooking,
  listBookings,
  logEvent,
  owedBalance,
  unpaidCompletedFor,
} from '../bookings.js';

export default async function driverRoutes(app, { db, config }) {
  app.addHook('preHandler', requireRole(db, config, 'driver'));

  const profileOf = (userId) => db.prepare('SELECT * FROM drivers WHERE user_id = ?').get(userId);

  const requireApproved = (request) => {
    const d = profileOf(request.user.id);
    if (d.status !== 'approved') throw httpError(403, 'Your account is not approved yet');
    return d;
  };

  const ownBooking = (request) => {
    const b = getBooking(db, Number(request.params.id));
    if (!b || b.driver_id !== request.user.id) throw httpError(404, 'Booking not found');
    return b;
  };

  // Moves a booking from one status to the next, only if it is still in the
  // expected status. Returns false when someone else changed it first.
  const transition = (id, from, to, extraSql = '', params = []) =>
    db.prepare(`UPDATE bookings SET status = ?${extraSql} WHERE id = ? AND status = ?`).run(to, ...params, id, from).changes > 0;

  app.get('/me', async (request) => {
    const u = request.user;
    const d = profileOf(u.id);
    const s = getSettings(db);
    const owed = owedBalance(db, u.id);
    const today = db
      .prepare(
        `SELECT COUNT(*) AS trips, COALESCE(SUM(driver_earning), 0) AS earned FROM bookings
         WHERE driver_id = ? AND status = 'completed' AND ended_at >= ?`,
      )
      .get(u.id, startOfTodayIst());
    const active = activeBookingFor(db, 'driver_id', u.id) || unpaidCompletedFor(db, 'driver_id', u.id);
    return {
      user: { id: u.id, name: u.name, phone: u.phone },
      profile: {
        status: d.status,
        licenceNumber: d.licence_number,
        licenceExpiry: d.licence_expiry,
        transmissions: d.transmissions,
        experienceYears: d.experience_years,
        isOnline: !!d.is_online,
        rating: d.rating_count ? Math.round((d.rating_sum / d.rating_count) * 10) / 10 : null,
        ratingCount: d.rating_count,
        adminNote: d.admin_note,
        complete: !!(u.name && u.phone && d.licence_number && d.licence_expiry && d.transmissions),
      },
      owed,
      owedLimit: s.owedLimit,
      blocked: owed > s.owedLimit,
      today,
      activeBooking: bookingView(active, 'driver'),
    };
  });

  app.put('/profile', async (request) => {
    const d = profileOf(request.user.id);
    if (d.status === 'approved' || d.status === 'suspended') throw httpError(409, 'Contact support to change your details');
    const { name, phone: rawPhone, licenceNumber, licenceExpiry, transmissions, experienceYears } = request.body || {};
    if (!String(name || '').trim()) throw httpError(400, 'Name is required');
    // OTP sign-in already gave us a verified number; Google sign-in drivers type it here.
    const phone = request.user.phone && !rawPhone ? request.user.phone : normalizePhone(rawPhone);
    const taken = db.prepare("SELECT id FROM users WHERE role = 'driver' AND phone = ? AND id != ?").get(phone, request.user.id);
    if (taken) throw httpError(409, 'This mobile number is already registered to another driver');
    if (String(licenceNumber || '').trim().length < 6) throw httpError(400, 'Enter your driving licence number');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(licenceExpiry || '') || licenceExpiry < new Date().toISOString().slice(0, 10)) {
      throw httpError(400, 'Enter a valid licence expiry date');
    }
    if (!['manual', 'automatic', 'both'].includes(transmissions)) throw httpError(400, 'Choose which cars you can drive');
    const years = Math.max(0, Math.min(60, Math.floor(Number(experienceYears) || 0)));
    tx(db, () => {
      db.prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?').run(String(name).trim().slice(0, 80), phone, request.user.id);
      db.prepare(
        `UPDATE drivers SET licence_number = ?, licence_expiry = ?, transmissions = ?, experience_years = ?, status = 'pending'
         WHERE user_id = ?`,
      ).run(String(licenceNumber).toUpperCase().trim().slice(0, 30), licenceExpiry, transmissions, years, request.user.id);
    });
    return { ok: true };
  });

  app.post('/status', async (request) => {
    requireApproved(request);
    const online = request.body?.online === true;
    if (online) {
      const s = getSettings(db);
      const owed = owedBalance(db, request.user.id);
      if (owed > s.owedLimit) throw httpError(403, `Please settle ₹${owed} with Drivana before going online`);
    }
    db.prepare('UPDATE drivers SET is_online = ?, last_seen_at = ? WHERE user_id = ?').run(online ? 1 : 0, now(), request.user.id);
    if (online) saveLocation(request);
    return { online };
  });

  app.post('/location', async (request) => {
    saveLocation(request);
    return { ok: true };
  });

  function saveLocation(request) {
    const lat = Number(request.body?.lat);
    const lng = Number(request.body?.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      db.prepare('UPDATE drivers SET lat = ?, lng = ?, last_seen_at = ? WHERE user_id = ?').run(lat, lng, now(), request.user.id);
    } else {
      db.prepare('UPDATE drivers SET last_seen_at = ? WHERE user_id = ?').run(now(), request.user.id);
    }
  }

  // Open requests this driver can take: unassigned, recent, a car they can
  // drive, nearby (when both locations are known), and not declined by them.
  app.get('/requests', async (request) => {
    const d = requireApproved(request);
    db.prepare('UPDATE drivers SET last_seen_at = ? WHERE user_id = ?').run(now(), request.user.id);
    if (!d.is_online || activeBookingFor(db, 'driver_id', request.user.id)) return [];
    const s = getSettings(db);
    const since = new Date(Date.now() - s.requestTimeoutMinutes * 60000).toISOString();
    return listBookings(
      db,
      `b.status = 'requested' AND b.driver_id IS NULL AND b.created_at >= ?
       AND NOT EXISTS (SELECT 1 FROM booking_declines x WHERE x.booking_id = b.id AND x.driver_id = ?)`,
      [since, request.user.id],
    )
      .filter((b) => canDrive(d.transmissions, b.vehicle_transmission))
      .map((b) => {
        const km = d.lat != null && b.pickup_lat != null ? distanceKm(d.lat, d.lng, b.pickup_lat, b.pickup_lng) : null;
        return { b, km };
      })
      .filter(({ km }) => km === null || km <= s.dispatchRadiusKm)
      .map(({ b, km }) => {
        const p = JSON.parse(b.pricing);
        const view = bookingView(b, 'driver');
        // Drivers see the customer's phone only after accepting.
        view.customer = { name: firstName(b.customer_name) };
        view.distanceKm = km === null ? null : Math.round(km * 10) / 10;
        view.estimatedEarning = b.estimate - Math.round((b.estimate * p.commissionPct) / 100);
        return view;
      });
  });

  app.post('/requests/:id/accept', async (request) => {
    const d = requireApproved(request);
    const id = Number(request.params.id);
    tx(db, () => {
      if (activeBookingFor(db, 'driver_id', request.user.id)) throw httpError(409, 'Finish your current trip first');
      const s = getSettings(db);
      if (owedBalance(db, request.user.id) > s.owedLimit) throw httpError(403, 'Please settle your dues with Drivana first');
      const b = getBooking(db, id);
      if (!b) throw httpError(404, 'Booking not found');
      if (!canDrive(d.transmissions, b.vehicle_transmission)) throw httpError(403, 'This car needs a different transmission');
      const ok = db
        .prepare("UPDATE bookings SET status = 'accepted', driver_id = ?, accepted_at = ? WHERE id = ? AND status = 'requested' AND driver_id IS NULL")
        .run(request.user.id, now(), id).changes;
      if (!ok) throw httpError(409, 'Another driver took this booking');
      logEvent(db, id, request.user.id, 'accepted');
    });
    return bookingView(getBooking(db, id), 'driver');
  });

  app.post('/requests/:id/decline', async (request) => {
    db.prepare('INSERT OR IGNORE INTO booking_declines (booking_id, driver_id) VALUES (?, ?)').run(Number(request.params.id), request.user.id);
    return { ok: true };
  });

  app.post('/bookings/:id/arrived', async (request) => {
    const b = ownBooking(request);
    if (!transition(b.id, 'accepted', 'arrived', ', arrived_at = ?', [now()])) throw httpError(409, 'Booking is not waiting for you to arrive');
    logEvent(db, b.id, request.user.id, 'arrived');
    return bookingView(getBooking(db, b.id), 'driver');
  });

  app.post('/bookings/:id/start', async (request) => {
    const b = ownBooking(request);
    if (b.status === 'accepted') throw httpError(409, "Tap \"I've reached the car\" first so the customer gets the OTP");
    if (b.status !== 'arrived') throw httpError(409, 'This trip cannot be started');
    if (String(request.body?.otp || '').trim() !== b.start_otp) throw httpError(400, 'Wrong OTP — ask the customer for the 4-digit code');
    if (!transition(b.id, 'arrived', 'in_progress', ', started_at = ?', [now()])) throw httpError(409, 'This trip cannot be started');
    logEvent(db, b.id, request.user.id, 'started');
    return bookingView(getBooking(db, b.id), 'driver');
  });

  app.post('/bookings/:id/end', async (request) => {
    const b = ownBooking(request);
    const endedAt = now();
    const fare = finalFare(JSON.parse(b.pricing), b.booked_hours, b.started_at, endedAt);
    const ok = transition(
      b.id,
      'in_progress',
      'completed',
      ', ended_at = ?, fare_total = ?, fare_breakdown = ?, commission = ?, driver_earning = ?',
      [endedAt, fare.total, JSON.stringify({ ...fare.breakdown, minutes: fare.minutes }), fare.commission, fare.driverEarning],
    );
    if (!ok) throw httpError(409, 'This trip is not in progress');
    logEvent(db, b.id, request.user.id, 'ended', { total: fare.total, minutes: fare.minutes });
    return bookingView(getBooking(db, b.id), 'driver');
  });

  // Cash only for now: the driver keeps the fare and owes Drivana the commission.
  app.post('/bookings/:id/cash-collected', async (request) => {
    const b = ownBooking(request);
    tx(db, () => {
      const ok = db
        .prepare("UPDATE bookings SET payment_status = 'collected', cash_collected_at = ? WHERE id = ? AND status = 'completed' AND payment_status = 'pending'")
        .run(now(), b.id).changes;
      if (!ok) throw httpError(409, 'Payment already recorded');
      db.prepare("INSERT INTO ledger_entries (driver_id, booking_id, kind, amount, note, created_at) VALUES (?, ?, 'commission', ?, ?, ?)").run(
        request.user.id, b.id, b.commission, `Commission on cash trip ${b.id}`, now(),
      );
      logEvent(db, b.id, request.user.id, 'cash_collected', { amount: b.fare_total });
    });
    return bookingView(getBooking(db, b.id), 'driver');
  });

  app.get('/bookings', async (request) => {
    return listBookings(db, "b.driver_id = ? AND b.status IN ('completed', 'cancelled')", [request.user.id], 50).map((b) => bookingView(b, 'driver'));
  });
}

const firstName = (name) => String(name || 'Customer').split(' ')[0];

function startOfTodayIst() {
  const istDate = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
  return new Date(`${istDate}T00:00:00+05:30`).toISOString();
}
