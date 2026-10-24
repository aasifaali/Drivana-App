// All amounts are whole rupees.

export function pricingSnapshot(s) {
  const { minHours, baseFare, hourlyRate, graceMinutes, nightCharge, commissionPct } = s;
  return { minHours, baseFare, hourlyRate, graceMinutes, nightCharge, commissionPct };
}

export function estimateFare(p, hours) {
  return p.baseFare + Math.max(0, hours - p.minHours) * p.hourlyRate;
}

// Final fare from the actual trip. The customer always pays at least the
// booked hours; overtime past the grace period is billed in 30-minute blocks.
export function finalFare(p, bookedHours, startedAt, endedAt) {
  const start = new Date(startedAt);
  const end = new Date(endedAt);
  const minutes = Math.max(0, Math.ceil((end - start) / 60000));
  const booked = estimateFare(p, bookedHours);

  const overtime = minutes - bookedHours * 60;
  const extraBlocks = overtime > p.graceMinutes ? Math.ceil(overtime / 30) : 0;
  const extra = Math.round(extraBlocks * (p.hourlyRate / 2));

  const night = overlapsNight(start, end) ? p.nightCharge : 0;
  const total = booked + extra + night;
  const commission = Math.round((total * p.commissionPct) / 100);

  return {
    minutes,
    breakdown: { booked, extra, extraMinutes: extraBlocks * 30, night },
    total,
    commission,
    driverEarning: total - commission,
  };
}

const istHour = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Kolkata' });

function overlapsNight(start, end) {
  const step = 15 * 60000;
  for (let t = start.getTime(); t <= end.getTime(); t += step) {
    const h = Number(istHour.format(new Date(t)));
    if (h >= 22 || h < 6) return true;
  }
  const h = Number(istHour.format(end));
  return h >= 22 || h < 6;
}

export function distanceKm(aLat, aLng, bLat, bLng) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
