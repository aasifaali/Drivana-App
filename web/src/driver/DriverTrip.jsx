import { useState } from 'react';
import { post } from '../api.js';
import { ErrorBox, Icon, duration, initials, minutesLabel, rupees, time, transmissionLabel, useAction, useNow } from '../ui.jsx';

export default function DriverTrip({ booking: b, refresh }) {
  const action = useAction();
  const call = (path, body) => action.run(async () => { await post(`/driver/bookings/${b.id}/${path}`, body); refresh(); });

  return (
    <section className="stack" style={{ gap: 14 }}>
      <span className="small muted">Booking {b.code}</span>
      {b.status === 'in_progress' && <Running booking={b} />}
      {b.status === 'completed' ? <CollectCash booking={b} action={action} call={call} /> : <CustomerCard booking={b} />}
      {b.status === 'accepted' && (
        <button className="btn primary block" disabled={action.busy} onClick={() => call('arrived')}>I've reached the car</button>
      )}
      {['accepted', 'arrived'].includes(b.status) && <StartTrip action={action} call={call} />}
      {b.status === 'in_progress' && <EndTrip action={action} call={call} />}
      {b.status !== 'completed' && <ErrorBox error={action.error} />}
    </section>
  );
}

function CustomerCard({ booking: b }) {
  const mapsUrl = b.pickupLat != null
    ? `https://www.google.com/maps/search/?api=1&query=${b.pickupLat},${b.pickupLng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.pickupAddress)}`;
  return (
    <div className="card">
      <div className="row">
        <div className="avatar">{initials(b.customer.name)}</div>
        <div className="grow stack" style={{ gap: 2 }}>
          <b style={{ fontSize: 17 }}>{b.customer.name}</b>
          <span className="small muted">{b.vehicle.model} · {b.vehicle.regNumber}</span>
        </div>
        {b.customer.phone && <a className="icon-btn solid" href={`tel:${b.customer.phone}`} aria-label="Call customer"><Icon name="phone" /></a>}
      </div>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <Icon name="pin" />
        <span className="grow">{b.pickupAddress}</span>
      </div>
      <div className="tags">
        <span className="tag">{transmissionLabel(b.vehicle.transmission)}</span>
        <span className="tag">{b.bookedHours} hr booked</span>
      </div>
      {b.status !== 'in_progress' && (
        <a className="btn ghost small" href={mapsUrl} target="_blank" rel="noreferrer"><Icon name="pin" size={18} /> Open in Google Maps</a>
      )}
    </div>
  );
}

function StartTrip({ action, call }) {
  const [otp, setOtp] = useState('');
  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); call('start', { otp }); }}>
      <b>Start the trip</b>
      <span className="small muted">Check the car with the customer, then ask them for the 4-digit OTP shown in their app.</span>
      <input className="input otp" inputMode="numeric" maxLength={4} placeholder="••••" aria-label="Customer OTP"
        value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} />
      <button className="btn primary block" disabled={action.busy || otp.length !== 4}>Start trip</button>
    </form>
  );
}

function Running({ booking: b }) {
  const now = useNow();
  const elapsed = now - new Date(b.startedAt).getTime();
  const pct = Math.min(100, (elapsed / (b.bookedHours * 3600000)) * 100);
  return (
    <div className="card" style={{ alignItems: 'center', textAlign: 'center', padding: 24 }}>
      <span className="small" style={{ color: 'var(--gold)', fontWeight: 900, letterSpacing: '0.08em' }}>TRIP IN PROGRESS</span>
      <span className="big-number" style={{ fontSize: 56 }}>{duration(elapsed)}</span>
      <span className="small muted">of {b.bookedHours} hr booked · started {time(b.startedAt)}</span>
      <div className="progress" style={{ width: '100%' }}><div style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function EndTrip({ action, call }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) return <button className="btn dark block" style={{ minHeight: 64 }} onClick={() => setConfirming(true)}>End trip</button>;
  return (
    <div className="card">
      <b>End the trip now?</b>
      <span className="small muted">Make sure the car is parked and handed back to the customer.</span>
      <div className="row">
        <button className="btn ghost grow small" onClick={() => setConfirming(false)}>Not yet</button>
        <button className="btn primary grow small" disabled={action.busy} onClick={() => call('end')}>Yes, end trip</button>
      </div>
    </div>
  );
}

function CollectCash({ booking: b, action, call }) {
  const f = b.fareBreakdown || {};
  return (
    <div className="card inverse" style={{ alignItems: 'center', textAlign: 'center', padding: 24 }}>
      <span className="small" style={{ color: 'var(--gold)', fontWeight: 900, letterSpacing: '0.08em' }}>COLLECT IN CASH</span>
      <span className="big-number" style={{ fontSize: 56 }}>{rupees(b.fareTotal)}</span>
      <span className="small muted">
        {minutesLabel(f.minutes || 0)} · booked {rupees(f.booked)}
        {f.extra > 0 ? ` + extra ${rupees(f.extra)}` : ''}{f.night > 0 ? ` + night ${rupees(f.night)}` : ''}
      </span>
      <span className="small">You keep {rupees(b.driverEarning)} · Drivana commission {rupees(b.commission)}</span>
      <ErrorBox error={action.error} />
      <button className="btn primary block" disabled={action.busy} onClick={() => call('cash-collected')}>
        <Icon name="check" stroke={3} /> Cash collected
      </button>
    </div>
  );
}
