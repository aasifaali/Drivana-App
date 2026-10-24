// Business settings editable from the ops dashboard. These defaults are
// placeholders — set real prices in Dashboard › Settings before launch.
export const DEFAULT_SETTINGS = {
  city: 'Kovvappuram',
  minHours: 2,
  baseFare: 400, // covers minHours
  hourlyRate: 150, // each hour beyond minHours; extra time billed in 30-min blocks
  graceMinutes: 10, // overtime below this is not billed
  nightCharge: 150, // flat, if any part of the trip falls between 22:00 and 06:00 IST
  commissionPct: 20,
  dispatchRadiusKm: 15,
  owedLimit: 2000, // drivers owing more than this cannot go online
  requestTimeoutMinutes: 30, // unassigned requests older than this stop showing to drivers
  supportPhone: '',
  supportWhatsapp: '',
};

const NUMERIC = Object.keys(DEFAULT_SETTINGS).filter((k) => typeof DEFAULT_SETTINGS[k] === 'number');

export function getSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const stored = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
  return { ...DEFAULT_SETTINGS, ...stored };
}

export function updateSettings(db, patch) {
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  for (const [key, raw] of Object.entries(patch)) {
    if (!(key in DEFAULT_SETTINGS)) continue;
    let value = raw;
    if (NUMERIC.includes(key)) {
      value = Number(raw);
      if (!Number.isFinite(value) || value < 0) throw httpError(400, `${key} must be a non-negative number`);
    } else {
      value = String(raw ?? '').trim();
    }
    upsert.run(key, JSON.stringify(value));
  }
  return getSettings(db);
}

export function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}
