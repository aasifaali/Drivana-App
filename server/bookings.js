import { now } from './db.js';

export const ACTIVE_STATUSES = ['requested', 'accepted', 'arrived', 'in_progress'];
const ACTIVE_SQL = `('${ACTIVE_STATUSES.join("','")}')`;

export function logEvent(db, bookingId, actorId, type, data) {
  db.prepare('INSERT INTO booking_events (booking_id, actor_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    bookingId,
    actorId ?? null,
    type,
    data ? JSON.stringify(data) : null,
    now(),
  );
}

const BOOKING_SELECT = `
  SELECT b.*,
    v.model AS vehicle_model, v.transmission AS vehicle_transmission, v.reg_number AS vehicle_reg,
    c.name AS customer_name, c.phone AS customer_phone,
    d.name AS driver_name, d.phone AS driver_phone,
    dr.rating_sum AS driver_rating_sum, dr.rating_count AS driver_rating_count,
    dr.experience_years AS driver_experience, dr.transmissions AS driver_transmissions
  FROM bookings b
  JOIN vehicles v ON v.id = b.vehicle_id
  JOIN users c ON c.id = b.customer_id
  LEFT JOIN users d ON d.id = b.driver_id
  LEFT JOIN drivers dr ON dr.user_id = b.driver_id`;

export function getBooking(db, id) {
  return db.prepare(`${BOOKING_SELECT} WHERE b.id = ?`).get(id);
}

export function listBookings(db, where = '1 = 1', params = [], limit = 100) {
  return db.prepare(`${BOOKING_SELECT} WHERE ${where} ORDER BY b.id DESC LIMIT ${Number(limit)}`).all(...params);
}

export function activeBookingFor(db, column, userId) {
  return db.prepare(`${BOOKING_SELECT} WHERE b.${column} = ? AND b.status IN ${ACTIVE_SQL} ORDER BY b.id DESC LIMIT 1`).get(userId);
}

export function unpaidCompletedFor(db, column, userId) {
  return db
    .prepare(`${BOOKING_SELECT} WHERE b.${column} = ? AND b.status = 'completed' AND b.payment_status = 'pending' ORDER BY b.id DESC LIMIT 1`)
    .get(userId);
}

export const bookingCode = (id) => `DV-${String(id).padStart(4, '0')}`;

// Shape a booking row for one audience. Only the customer sees the start OTP.
export function bookingView(b, audience) {
  if (!b) return null;
  const view = {
    id: b.id,
    code: bookingCode(b.id),
    status: b.status,
    pickupAddress: b.pickup_address,
    pickupLat: b.pickup_lat,
    pickupLng: b.pickup_lng,
    bookedHours: b.booked_hours,
    estimate: b.estimate,
    fareTotal: b.fare_total,
    fareBreakdown: b.fare_breakdown ? JSON.parse(b.fare_breakdown) : null,
    paymentMethod: b.payment_method,
    paymentStatus: b.payment_status,
    rating: b.rating,
    cancelReason: b.cancel_reason,
    cancelledBy: b.cancelled_by,
    createdAt: b.created_at,
    acceptedAt: b.accepted_at,
    arrivedAt: b.arrived_at,
    startedAt: b.started_at,
    endedAt: b.ended_at,
    vehicle: { model: b.vehicle_model, transmission: b.vehicle_transmission, regNumber: b.vehicle_reg },
    customer: { name: b.customer_name, phone: b.customer_phone },
    driver: b.driver_id
      ? {
          id: b.driver_id,
          name: b.driver_name,
          phone: b.driver_phone,
          rating: b.driver_rating_count ? Math.round((b.driver_rating_sum / b.driver_rating_count) * 10) / 10 : null,
          ratingCount: b.driver_rating_count,
          experienceYears: b.driver_experience,
          transmissions: b.driver_transmissions,
        }
      : null,
  };
  // The customer sees the start code only once the driver is at the car.
  if (audience === 'customer' && b.status === 'arrived') view.startOtp = b.start_otp;
  if (audience !== 'customer') {
    view.commission = b.commission;
    view.driverEarning = b.driver_earning;
  }
  return view;
}

export function owedBalance(db, driverId) {
  return db.prepare('SELECT COALESCE(SUM(amount), 0) AS owed FROM ledger_entries WHERE driver_id = ?').get(driverId).owed;
}

export function canDrive(driverTransmissions, vehicleTransmission) {
  return driverTransmissions === 'both' || driverTransmissions === vehicleTransmission;
}
