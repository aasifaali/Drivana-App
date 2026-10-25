import { useState } from 'react';
import { post } from '../api.js';
import { ErrorBox, Icon, Star, duration, initials, minutesLabel, rupees, time, transmissionLabel, useAction, useNow } from '../ui.jsx';

const HEADLINES = {
  requested: { tag: 'Finding a driver', title: 'Looking for a driver near you' },
  accepted: { tag: 'Driver on the way', title: 'Your driver is coming' },
  arrived: { tag: 'Driver has arrived', title: 'Your driver is at your car' },
  in_progress: { tag: 'Trip in progress', title: 'Enjoy the ride' },
  completed: { tag: 'Trip complete', title: 'Trip complete' },
};

export default function BookingStatus({ booking: b, ratingTags, refresh, config }) {
  const head = HEADLINES[b.status];
  return (
    <section className="stack" style={{ gap: 14 }}>
      <div className="stack" style={{ gap: 6 }}>
        <span className="small muted">Booking {b.code}</span>
        <span className="tag leaf" style={{ alignSelf: 'flex-start' }}>{head.tag}</span>
        <h1 className="h1">{head.title}</h1>
        <span className="muted">{b.pickupAddress}</span>
      </div>

      {b.status === 'requested' && <Searching booking={b} />}
      {b.driver && b.status !== 'completed' && <DriverCard driver={b.driver} />}
      {b.status === 'accepted' && <OtpPending />}
      {b.status === 'arrived' && b.startOtp && <OtpCard otp={b.startOtp} />}
      {b.status === 'in_progress' && <TripTimer booking={b} />}
      {b.status !== 'completed' && b.status !== 'in_progress' && <Timeline booking={b} />}
      {b.status === 'completed' && <Completed booking={b} ratingTags={ratingTags} refresh={refresh} onlinePayments={config?.onlinePayments} />}
      {['requested', 'accepted', 'arrived'].includes(b.status) && <CancelButton booking={b} refresh={refresh} />}
    </section>
  );
}

function Searching({ booking: b }) {
  return (
    <div className="card" style={{ alignItems: 'center', textAlign: 'center', padding: 28 }}>
      <div className="pulse" />
      <b>Sending your request to nearby drivers</b>
      <span className="small muted">
        {b.vehicle.model} ({transmissionLabel(b.vehicle.transmission)}) · {b.bookedHours} hr · est. {rupees(b.estimate)}
      </span>
      <span className="small muted">Usually takes a few minutes. Our team will call you if it takes longer.</span>
    </div>
  );
}

function DriverCard({ driver: d }) {
  return (
    <div className="card">
      <div className="row">
        <div className="avatar">{initials(d.name)}</div>
        <div className="grow stack" style={{ gap: 2 }}>
          <b style={{ fontSize: 18 }}>{d.name}</b>
          <span className="small muted row" style={{ gap: 6 }}>
            {d.rating ? <><Star filled size={14} /> {d.rating} · {d.ratingCount} ratings</> : 'New driver'}
          </span>
        </div>
        {d.phone && (
          <a className="icon-btn solid" href={`tel:${d.phone}`} aria-label={`Call ${d.name}`}><Icon name="phone" /></a>
        )}
      </div>
      <div className="tags">
        <span className="tag"><Icon name="shield" size={14} stroke={2.4} /> Licence verified</span>
        {d.transmissions && <span className="tag">Drives {transmissionLabel(d.transmissions).toLowerCase()}</span>}
        {d.experienceYears ? <span className="tag">{d.experienceYears} yrs experience</span> : null}
      </div>
    </div>
  );
}

function OtpCard({ otp }) {
  return (
    <div className="card inverse">
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <b>Start trip OTP</b>
        <span className="small" style={{ color: '#BFCCC1', textAlign: 'right' }}>Share only when the driver<br />is at your car</span>
      </div>
      <div className="otp-digits" aria-label={`OTP ${otp.split('').join(' ')}`}>
        {otp.split('').map((d, i) => <span key={i}>{d}</span>)}
      </div>
    </div>
  );
}

function OtpPending() {
  return (
    <div className="card inverse" style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Icon name="lock" size={22} />
      <span className="grow">
        <b>Start trip OTP</b><br />
        <span className="small" style={{ color: '#BFCCC1' }}>Your 4-digit code will appear here when your driver reaches your car.</span>
      </span>
    </div>
  );
}

function Timeline({ booking: b }) {
  const steps = [
    { label: 'Booking placed', at: b.createdAt, done: true },
    { label: 'Driver assigned', at: b.acceptedAt, done: !!b.acceptedAt },
    { label: 'Driver at your car', at: b.arrivedAt, done: !!b.arrivedAt },
    { label: `Trip starts · ${b.bookedHours} hr booked`, done: false },
  ];
  const current = steps.findIndex((s) => !s.done);
  return (
    <div className="card">
      <ol className="timeline">
        {steps.map((s, i) => (
          <li key={s.label}>
            <span className={`dot ${s.done ? 'done' : i === current ? 'now' : ''}`}>{s.done && <Icon name="check" size={14} stroke={3} />}</span>
            <span className="grow" style={{ fontWeight: i === current ? 800 : 600, color: s.done || i === current ? undefined : 'var(--muted)' }}>{s.label}</span>
            {s.at && <span className="small muted">{time(s.at)}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

function TripTimer({ booking: b }) {
  const now = useNow();
  const elapsed = now - new Date(b.startedAt).getTime();
  const pct = Math.min(100, (elapsed / (b.bookedHours * 3600000)) * 100);
  return (
    <div className="card inverse" style={{ alignItems: 'center', textAlign: 'center' }}>
      <span className="small" style={{ color: 'var(--gold)', fontWeight: 800, letterSpacing: '0.08em' }}>TIME USED</span>
      <span className="big-number">{duration(elapsed)}</span>
      <span className="small" style={{ color: '#BFCCC1' }}>of {b.bookedHours} hr booked · started {time(b.startedAt)}</span>
      <div className="progress" style={{ width: '100%' }}><div style={{ width: `${pct}%` }} /></div>
      {pct >= 100 && <span className="small" style={{ color: '#FFC83D' }}>Extra time is billed per 30 minutes</span>}
    </div>
  );
}

function Completed({ booking: b, ratingTags, refresh, onlinePayments }) {
  const f = b.fareBreakdown || {};
  const paid = b.paymentStatus === 'collected';
  return (
    <>
      <div className="card">
        <div className="spread" style={{ paddingBottom: 12, borderBottom: '1px dashed var(--line)' }}>
          <div className="stack" style={{ gap: 2 }}><span className="small muted">Duration</span><b>{minutesLabel(f.minutes || 0)}</b></div>
          <div className="stack" style={{ gap: 2, textAlign: 'right' }}><span className="small muted">Driver</span><b>{b.driver?.name}</b></div>
        </div>
        <div className="spread small"><span>Booked · {b.bookedHours} hr</span><b>{rupees(f.booked)}</b></div>
        {f.extra > 0 && <div className="spread small"><span>Extra time · {f.extraMinutes} min</span><b>{rupees(f.extra)}</b></div>}
        {f.night > 0 && <div className="spread small"><span>Night charge</span><b>{rupees(f.night)}</b></div>}
        <div className="spread" style={{ paddingTop: 12, borderTop: '1px solid var(--line)' }}>
          <b>Total</b>
          <span style={{ fontSize: 28, fontWeight: 900 }}>{rupees(b.fareTotal)}</span>
        </div>
      </div>

      {paid ? (
        <div className="card" style={{ textAlign: 'center' }}>
          <span className="row" style={{ justifyContent: 'center', fontWeight: 800 }}>
            <Icon name="check" stroke={3} /> {b.paymentMethod === 'online' ? 'Paid online' : 'Paid in cash'} — thank you!
          </span>
        </div>
      ) : onlinePayments ? (
        <PayOnline booking={b} refresh={refresh} />
      ) : (
        <div className="notice" style={{ textAlign: 'center' }}>
          <span>Please pay <b>{rupees(b.fareTotal)}</b> in cash to {b.driver?.name?.split(' ')[0] || 'your driver'}. They will confirm it in their app.</span>
        </div>
      )}

      {b.rating == null && <RateDriver booking={b} tags={ratingTags} refresh={refresh} />}
    </>
  );
}

let checkoutScript;
function loadCheckout() {
  checkoutScript ||= new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = 'https://checkout.razorpay.com/v1/checkout.js';
    el.onload = () => resolve(window.Razorpay);
    el.onerror = () => { checkoutScript = null; reject(new Error('Could not load the payment page. Check your internet and try again.')); };
    document.head.appendChild(el);
  });
  return checkoutScript;
}

// Pay after the trip: Razorpay checkout (UPI, cards, netbanking) or cash to the driver.
function PayOnline({ booking: b, refresh }) {
  const action = useAction();
  const driverName = b.driver?.name?.split(' ')[0] || 'your driver';

  const payCash = () => action.run(async () => { await post(`/customer/bookings/${b.id}/pay-cash`); refresh(); });

  const pay = () =>
    action.run(async () => {
      const [Razorpay, order] = await Promise.all([loadCheckout(), post(`/customer/bookings/${b.id}/pay`)]);
      await new Promise((resolve, reject) => {
        const rzp = new Razorpay({
          key: order.keyId,
          order_id: order.orderId,
          amount: order.amount,
          currency: order.currency,
          name: 'Drivana',
          description: order.description,
          prefill: order.prefill,
          theme: { color: '#16402B' },
          handler: (res) => post(`/customer/bookings/${b.id}/pay/verify`, res).then(resolve, reject),
          modal: { ondismiss: () => resolve() },
        });
        rzp.on('payment.failed', (res) => reject(new Error(res.error?.description || 'Payment failed. Please try again.')));
        rzp.open();
      });
      refresh();
    });

  if (b.paymentChoice === 'cash') {
    return (
      <div className="notice" style={{ textAlign: 'center', gap: 8 }}>
        <span>Please pay <b>{rupees(b.fareTotal)}</b> in cash to {driverName}. They will confirm it in their app.</span>
        <button className="btn text small" disabled={action.busy} onClick={pay}>Pay online instead</button>
        <ErrorBox error={action.error} />
      </div>
    );
  }

  return (
    <div className="card" style={{ textAlign: 'center', gap: 10 }}>
      <b>Pay {rupees(b.fareTotal)}</b>
      <button className="btn primary block" disabled={action.busy} onClick={pay}>
        {action.busy ? 'Opening payment…' : 'Pay online now'}
      </button>
      <button className="btn ghost block" disabled={action.busy} onClick={payCash}>I'll pay cash to {driverName}</button>
      <ErrorBox error={action.error} />
    </div>
  );
}

function RateDriver({ booking: b, tags, refresh }) {
  const [stars, setStars] = useState(0);
  const [picked, setPicked] = useState([]);
  const { busy, error, run } = useAction();
  const name = b.driver?.name?.split(' ')[0] || 'your driver';
  const send = (body) => run(async () => { await post(`/customer/bookings/${b.id}/rate`, body); refresh(); });
  const toggle = (t) => setPicked((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));

  return (
    <div className="card" style={{ alignItems: 'center' }}>
      <b>How was {name}?</b>
      <div className="stars" role="group" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" aria-label={`${n} star${n > 1 ? 's' : ''}`} aria-pressed={stars === n} onClick={() => setStars(n)}>
            <Star filled={n <= stars} />
          </button>
        ))}
      </div>
      {stars > 0 && (
        <div className="tags" style={{ justifyContent: 'center' }}>
          {tags.map((t) => (
            <button key={t} type="button" className="chip" style={{ minHeight: 36, fontSize: 13 }} aria-pressed={picked.includes(t)} onClick={() => toggle(t)}>{t}</button>
          ))}
        </div>
      )}
      <ErrorBox error={error} />
      <button className="btn dark block" disabled={busy || !stars} onClick={() => send({ stars, tags: picked })}>Submit rating</button>
      <button className="btn text" disabled={busy} onClick={() => send({ skip: true })}>Skip</button>
    </div>
  );
}

function CancelButton({ booking: b, refresh }) {
  const [confirming, setConfirming] = useState(false);
  const { busy, error, run } = useAction();
  if (!confirming) return <button className="btn text danger" onClick={() => setConfirming(true)}>Cancel booking</button>;
  return (
    <div className="card outline">
      <b>Cancel this booking?</b>
      {b.driver && <span className="small muted">{b.driver.name} is already on the way.</span>}
      <ErrorBox error={error} />
      <div className="row">
        <button className="btn ghost grow small" onClick={() => setConfirming(false)}>Keep it</button>
        <button className="btn dark grow small" disabled={busy}
          onClick={() => run(async () => { await post(`/customer/bookings/${b.id}/cancel`); refresh(); })}>
          Yes, cancel
        </button>
      </div>
    </div>
  );
}
