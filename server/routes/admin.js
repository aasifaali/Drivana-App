import { now, tx } from '../db.js';
import { requireRole } from '../auth.js';
import { getSettings, httpError, updateSettings } from '../settings.js';
import { distanceKm } from '../pricing.js';
import { ACTIVE_STATUSES, activeBookingFor, bookingView, canDrive, getBooking, listBookings, logEvent } from '../bookings.js';

// A driver counts as online only if their app checked in recently.
const ONLINE_WINDOW_MS = 3 * 60000;

export default async function adminRoutes(app, { db, config }) {
  app.addHook('preHandler', requireRole(db, config, 'admin'));

  app.get('/me', async (request) => ({ user: { name: request.user.name, email: request.user.email } }));

  app.get('/overview', async () => {
    const count = (sql, ...p) => db.prepare(sql).get(...p).n;
    const recent = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString();
    return {
      inProgress: count("SELECT COUNT(*) AS n FROM bookings WHERE status IN ('accepted', 'arrived', 'in_progress')"),
      waiting: count("SELECT COUNT(*) AS n FROM bookings WHERE status = 'requested'"),
      driversOnline: count("SELECT COUNT(*) AS n FROM drivers WHERE status = 'approved' AND is_online = 1 AND last_seen_at >= ?", recent),
      pendingApprovals: count(
        "SELECT COUNT(*) AS n FROM drivers d JOIN users u ON u.id = d.user_id WHERE d.status = 'pending' AND d.licence_number IS NOT NULL",
      ),
      cashPending: count("SELECT COUNT(*) AS n FROM bookings WHERE status = 'completed' AND payment_status = 'pending'"),
      // Per-driver balances: positive = driver owes Drivana, negative = Drivana owes the driver.
      ...db
        .prepare(
          `SELECT COALESCE(SUM(CASE WHEN bal > 0 THEN bal END), 0) AS totalOwed,
                  COALESCE(-SUM(CASE WHEN bal < 0 THEN bal END), 0) AS owedToDrivers
           FROM (SELECT SUM(amount) AS bal FROM ledger_entries GROUP BY driver_id)`,
        )
        .get(),
    };
  });

  app.get('/bookings', async (request) => {
    const scope = request.query.scope || 'live';
    if (scope === 'live') {
      return listBookings(
        db,
        `b.status IN ('${ACTIVE_STATUSES.join("','")}') OR (b.status = 'completed' AND b.payment_status = 'pending')`,
        [],
        200,
      ).map((b) => bookingView(b, 'admin'));
    }
    return listBookings(db, '1 = 1', [], 200).map((b) => bookingView(b, 'admin'));
  });

  app.get('/bookings/:id', async (request) => {
    const b = getBooking(db, Number(request.params.id));
    if (!b) throw httpError(404, 'Booking not found');
    const events = db
      .prepare('SELECT e.type, e.data, e.created_at AS at, u.name AS actor FROM booking_events e LEFT JOIN users u ON u.id = e.actor_id WHERE booking_id = ? ORDER BY e.id')
      .all(b.id)
      .map((e) => ({ ...e, data: e.data ? JSON.parse(e.data) : null }));
    return { ...bookingView(b, 'admin'), startOtp: b.start_otp, events };
  });

  // Drivers who could take a booking, closest and online first.
  app.get('/bookings/:id/candidates', async (request) => {
    const b = getBooking(db, Number(request.params.id));
    if (!b) throw httpError(404, 'Booking not found');
    const recent = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString();
    return db
      .prepare("SELECT d.*, u.name, u.phone FROM drivers d JOIN users u ON u.id = d.user_id WHERE d.status = 'approved'")
      .all()
      .filter((d) => canDrive(d.transmissions, b.vehicle_transmission))
      .filter((d) => !activeBookingFor(db, 'driver_id', d.user_id))
      .map((d) => ({
        id: d.user_id,
        name: d.name,
        phone: d.phone,
        online: !!d.is_online && d.last_seen_at >= recent,
        distanceKm: d.lat != null && b.pickup_lat != null ? Math.round(distanceKm(d.lat, d.lng, b.pickup_lat, b.pickup_lng) * 10) / 10 : null,
      }))
      .sort((a, z) => Number(z.online) - Number(a.online) || (a.distanceKm ?? 1e9) - (z.distanceKm ?? 1e9));
  });

  app.post('/bookings/:id/assign', async (request) => {
    const id = Number(request.params.id);
    const driverId = Number(request.body?.driverId);
    tx(db, () => {
      const b = getBooking(db, id);
      if (!b) throw httpError(404, 'Booking not found');
      if (!['requested', 'accepted', 'arrived'].includes(b.status)) throw httpError(409, 'Only bookings that have not started can be assigned');
      const d = db.prepare("SELECT * FROM drivers WHERE user_id = ? AND status = 'approved'").get(driverId);
      if (!d) throw httpError(400, 'Choose an approved driver');
      if (!canDrive(d.transmissions, b.vehicle_transmission)) throw httpError(400, 'This driver cannot drive this transmission');
      const busy = activeBookingFor(db, 'driver_id', driverId);
      if (busy && busy.id !== id) throw httpError(409, 'This driver is on another booking');
      db.prepare("UPDATE bookings SET driver_id = ?, status = 'accepted', accepted_at = ?, arrived_at = NULL WHERE id = ?").run(driverId, now(), id);
      logEvent(db, id, request.user.id, b.driver_id ? 'reassigned' : 'assigned', { driverId, previousDriverId: b.driver_id });
    });
    return bookingView(getBooking(db, id), 'admin');
  });

  app.post('/bookings/:id/cancel', async (request) => {
    const id = Number(request.params.id);
    const reason = String(request.body?.reason || 'Cancelled by Drivana').slice(0, 200);
    const { changes } = db
      .prepare(
        `UPDATE bookings SET status = 'cancelled', cancel_reason = ?, cancelled_by = 'admin', cancelled_at = ?
         WHERE id = ? AND status IN ('requested', 'accepted', 'arrived', 'in_progress')`,
      )
      .run(reason, now(), id);
    if (!changes) throw httpError(409, 'This booking cannot be cancelled');
    logEvent(db, id, request.user.id, 'cancelled', { reason });
    return bookingView(getBooking(db, id), 'admin');
  });

  app.get('/drivers', async () => {
    const recent = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString();
    return db
      .prepare(
        `SELECT d.*, u.name, u.phone, u.created_at,
           (SELECT COALESCE(SUM(amount), 0) FROM ledger_entries l WHERE l.driver_id = d.user_id) AS owed,
           (SELECT COUNT(*) FROM bookings b WHERE b.driver_id = d.user_id AND b.status = 'completed') AS trips
         FROM drivers d JOIN users u ON u.id = d.user_id
         ORDER BY CASE d.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, u.created_at DESC`,
      )
      .all()
      .map((d) => ({
        id: d.user_id,
        name: d.name,
        phone: d.phone,
        status: d.status,
        licenceNumber: d.licence_number,
        licenceExpiry: d.licence_expiry,
        transmissions: d.transmissions,
        experienceYears: d.experience_years,
        online: !!d.is_online && d.last_seen_at >= recent,
        rating: d.rating_count ? Math.round((d.rating_sum / d.rating_count) * 10) / 10 : null,
        trips: d.trips,
        owed: d.owed,
        adminNote: d.admin_note,
        profileComplete: !!(d.name && d.licence_number),
        joinedAt: d.created_at,
      }));
  });

  app.post('/drivers/:id/status', async (request) => {
    const id = Number(request.params.id);
    const { status, note } = request.body || {};
    if (!['approved', 'rejected', 'suspended', 'pending'].includes(status)) throw httpError(400, 'Invalid status');
    const { changes } = db
      .prepare('UPDATE drivers SET status = ?, admin_note = ?, is_online = CASE WHEN ? = \'approved\' THEN is_online ELSE 0 END WHERE user_id = ?')
      .run(status, note ? String(note).slice(0, 300) : null, status, id);
    if (!changes) throw httpError(404, 'Driver not found');
    return { ok: true };
  });

  app.get('/drivers/:id/ledger', async (request) => {
    return db
      .prepare('SELECT id, booking_id AS bookingId, kind, amount, note, created_at AS at FROM ledger_entries WHERE driver_id = ? ORDER BY id DESC LIMIT 200')
      .all(Number(request.params.id));
  });

  // Money moving between Drivana and a driver, by UPI or cash.
  // "settlement": driver paid Drivana their commission (negative entry).
  // "payout": Drivana paid the driver their share of online trips (positive entry).
  app.post('/drivers/:id/settlement', async (request) => {
    const id = Number(request.params.id);
    const amount = Math.round(Number(request.body?.amount));
    const payout = request.body?.direction === 'payout';
    if (!(amount > 0)) throw httpError(400, 'Enter the amount');
    if (!db.prepare('SELECT 1 FROM drivers WHERE user_id = ?').get(id)) throw httpError(404, 'Driver not found');
    const note = String(request.body?.note || (payout ? 'Paid to driver' : 'Payment received')).slice(0, 200);
    db.prepare('INSERT INTO ledger_entries (driver_id, kind, amount, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      id, payout ? 'payout' : 'settlement', payout ? amount : -amount, note, request.user.id, now(),
    );
    return { ok: true };
  });

  app.get('/settings', async () => getSettings(db));
  app.put('/settings', async (request) => updateSettings(db, request.body || {}));
}
