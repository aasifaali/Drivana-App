import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

// Each entry runs once, in order. Never edit a migration that has shipped;
// add a new one instead.
const MIGRATIONS = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    role TEXT NOT NULL CHECK (role IN ('customer', 'driver', 'admin')),
    name TEXT,
    email TEXT,
    google_sub TEXT,
    phone TEXT,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX users_role_google ON users(role, google_sub) WHERE google_sub IS NOT NULL;
  CREATE UNIQUE INDEX users_role_phone ON users(role, phone) WHERE phone IS NOT NULL;

  CREATE TABLE vehicles (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    model TEXT NOT NULL,
    transmission TEXT NOT NULL CHECK (transmission IN ('manual', 'automatic')),
    reg_number TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX vehicles_user ON vehicles(user_id);

  CREATE TABLE drivers (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
    licence_number TEXT,
    licence_expiry TEXT,
    transmissions TEXT CHECK (transmissions IN ('manual', 'automatic', 'both')),
    experience_years INTEGER,
    is_online INTEGER NOT NULL DEFAULT 0,
    lat REAL,
    lng REAL,
    last_seen_at TEXT,
    rating_sum INTEGER NOT NULL DEFAULT 0,
    rating_count INTEGER NOT NULL DEFAULT 0,
    admin_note TEXT
  );

  CREATE TABLE bookings (
    id INTEGER PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES users(id),
    vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
    driver_id INTEGER REFERENCES users(id),
    status TEXT NOT NULL CHECK (status IN
      ('requested', 'accepted', 'arrived', 'in_progress', 'completed', 'cancelled')),
    pickup_address TEXT NOT NULL,
    pickup_lat REAL,
    pickup_lng REAL,
    booked_hours INTEGER NOT NULL,
    start_otp TEXT NOT NULL,
    pricing TEXT NOT NULL,
    estimate INTEGER NOT NULL,
    fare_total INTEGER,
    fare_breakdown TEXT,
    commission INTEGER,
    driver_earning INTEGER,
    payment_method TEXT NOT NULL DEFAULT 'cash',
    payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'collected')),
    rating INTEGER,
    rating_tags TEXT,
    cancel_reason TEXT,
    cancelled_by TEXT,
    created_at TEXT NOT NULL,
    accepted_at TEXT,
    arrived_at TEXT,
    started_at TEXT,
    ended_at TEXT,
    cash_collected_at TEXT,
    cancelled_at TEXT
  );
  CREATE INDEX bookings_status ON bookings(status);
  CREATE INDEX bookings_customer ON bookings(customer_id);
  CREATE INDEX bookings_driver ON bookings(driver_id);

  CREATE TABLE booking_declines (
    booking_id INTEGER NOT NULL REFERENCES bookings(id),
    driver_id INTEGER NOT NULL REFERENCES users(id),
    PRIMARY KEY (booking_id, driver_id)
  );

  CREATE TABLE booking_events (
    id INTEGER PRIMARY KEY,
    booking_id INTEGER NOT NULL REFERENCES bookings(id),
    actor_id INTEGER REFERENCES users(id),
    type TEXT NOT NULL,
    data TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX booking_events_booking ON booking_events(booking_id);

  -- Positive amount = driver owes Drivana more; negative = driver paid us.
  CREATE TABLE ledger_entries (
    id INTEGER PRIMARY KEY,
    driver_id INTEGER NOT NULL REFERENCES users(id),
    booking_id INTEGER REFERENCES bookings(id),
    kind TEXT NOT NULL CHECK (kind IN ('commission', 'settlement', 'adjustment')),
    amount INTEGER NOT NULL,
    note TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL
  );
  CREATE INDEX ledger_driver ON ledger_entries(driver_id);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // Customer numbers are no longer OTP-verified, so only driver numbers
  // (their login) must be unique.
  `
  DROP INDEX users_role_phone;
  CREATE UNIQUE INDEX users_driver_phone ON users(phone) WHERE role = 'driver' AND phone IS NOT NULL;
  `,
];

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db) {
  const { user_version: current } = db.prepare('PRAGMA user_version').get();
  for (let v = current; v < MIGRATIONS.length; v++) {
    tx(db, () => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export const now = () => new Date().toISOString();
