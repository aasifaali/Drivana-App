import { useEffect, useRef, useState } from 'react';
import { api, post, put } from '../api.js';
import {
  Brand, DevLogin, ErrorBox, Icon, KeralaScene, PhoneOtpForm, Splash, SupportLinks,
  dateTime, getPosition, rupees, transmissionLabel, useAction, useLocationPermission, useManifest, usePolling,
} from '../ui.jsx';
import DriverTrip from './DriverTrip.jsx';

export default function DriverApp({ config }) {
  useManifest('/driver.webmanifest', '/icons/driver-apple-touch-icon.png');
  useEffect(() => {
    document.body.classList.add('dark');
    return () => document.body.classList.remove('dark');
  }, []);
  const { data: me, error, refresh } = usePolling(() => api('/driver/me'), 5000);

  if (error?.status === 401) return <DriverLogin config={config} onDone={refresh} />;
  if (!me) {
    return error ? (
      <main className="app dark"><ErrorBox error={error.message} /><button className="btn primary" onClick={refresh}>Try again</button></main>
    ) : <Splash />;
  }

  const logout = async () => {
    if (me.profile.isOnline) await post('/driver/status', { online: false }).catch(() => {});
    await post('/auth/logout', { role: 'driver' });
    refresh();
  };

  const p = me.profile;
  let body;
  if (p.status === 'suspended') {
    body = <Message title="Your account is paused" text={p.adminNote || 'Please contact Drivana support.'} />;
  } else if (!p.complete || p.status === 'rejected') {
    body = <ProfileForm me={me} onDone={refresh} />;
  } else if (p.status === 'pending') {
    body = <Message title="Thanks! We're checking your details" text="Our team will verify your licence and call you. Once approved, you can go online and start getting bookings." />;
  } else if (me.activeBooking) {
    body = <DriverTrip booking={me.activeBooking} refresh={refresh} />;
  } else {
    body = <DriverHome me={me} refresh={refresh} />;
  }

  return (
    <main className="app dark">
      <header className="topbar">
        <Brand variant="gold" label="Drivana Partner" />
        <button className="icon-btn" onClick={logout} aria-label="Sign out" title="Sign out"><Icon name="logout" /></button>
      </header>
      {body}
      <div className="push"><SupportLinks config={config} /></div>
    </main>
  );
}

function DriverLogin({ config, onDone }) {
  return (
    <main className="app dark welcome">
      <KeralaScene />
      <header className="topbar"><Brand variant="gold" label="Drivana Partner" /></header>
      <div className="stack grow" style={{ justifyContent: 'center', gap: 20 }}>
        <h1 className="h1" style={{ fontSize: 34 }}>Drive with Drivana</h1>
        <p className="muted" style={{ margin: 0, fontSize: 17 }}>Earn by driving customers' own cars, on your schedule. Sign in with your mobile number.</p>
        <PhoneOtpForm sendPath="/auth/driver/otp" verifyPath="/auth/driver/verify" onDone={onDone} submitLabel="Sign in" dark />
        {config.devLogin && <DevLogin role="driver" onDone={onDone} dark />}
      </div>
    </main>
  );
}

function Message({ title, text }) {
  return (
    <section className="card" style={{ textAlign: 'center', alignItems: 'center', padding: 28 }}>
      <img src="/brand/drivana-mark-gold.png" alt="" width="56" height="56" />
      <h1 className="h2" style={{ fontSize: 22 }}>{title}</h1>
      <p className="muted" style={{ margin: 0 }}>{text}</p>
    </section>
  );
}

function ProfileForm({ me, onDone }) {
  const p = me.profile;
  const [form, setForm] = useState({
    name: me.user.name || '',
    licenceNumber: p.licenceNumber || '',
    licenceExpiry: p.licenceExpiry || '',
    transmissions: p.transmissions || '',
    experienceYears: p.experienceYears ?? '',
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const { busy, error, run } = useAction();

  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); run(async () => { await put('/driver/profile', form); onDone(); }); }}>
      <h1 className="h1">Your driver profile</h1>
      {p.status === 'rejected' && (
        <div className="notice">Your application was not approved{p.adminNote ? `: ${p.adminNote}` : '.'} Update your details and submit again.</div>
      )}
      <label className="field"><span>Full name (as on licence)</span>
        <input className="input" value={form.name} onChange={set('name')} required autoComplete="name" /></label>
      <label className="field"><span>Driving licence number</span>
        <input className="input" value={form.licenceNumber} onChange={set('licenceNumber')} required style={{ textTransform: 'uppercase' }} /></label>
      <label className="field"><span>Licence valid until</span>
        <input className="input" type="date" value={form.licenceExpiry} onChange={set('licenceExpiry')} required /></label>
      <div className="field"><span>Cars you can drive</span>
        <div className="chips three" role="group" aria-label="Cars you can drive">
          {['manual', 'automatic', 'both'].map((t) => (
            <button key={t} type="button" className="chip" aria-pressed={form.transmissions === t}
              onClick={() => setForm((f) => ({ ...f, transmissions: t }))}>{t === 'both' ? 'Both' : transmissionLabel(t)}</button>
          ))}
        </div>
      </div>
      <label className="field"><span>Years of driving experience</span>
        <input className="input" type="number" min="0" max="60" inputMode="numeric" value={form.experienceYears} onChange={set('experienceYears')} /></label>
      <p className="small muted" style={{ margin: 0 }}>Keep your original licence ready — our team will verify it before approving you.</p>
      <ErrorBox error={error} />
      <button className="btn primary block" disabled={busy || !form.transmissions}>Submit for approval</button>
    </form>
  );
}

// Sends the driver's position every 30s while online and the app is open.
function useLiveLocation(enabled) {
  const last = useRef(0);
  useEffect(() => {
    if (!enabled || !navigator.geolocation) return undefined;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        if (Date.now() - last.current < 30000) return;
        last.current = Date.now();
        post('/driver/location', { lat: pos.coords.latitude, lng: pos.coords.longitude }).catch(() => {});
      },
      () => {},
      { enableHighAccuracy: false, maximumAge: 60000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);
}

function DriverHome({ me, refresh }) {
  const online = me.profile.isOnline;
  const toggle = useAction();
  const [tab, setTab] = useState('requests');
  useLiveLocation(online);
  const permission = useLocationPermission();
  const [locationError, setLocationError] = useState(null);

  const setOnline = (value) =>
    toggle.run(async () => {
      let pos = {};
      setLocationError(null);
      if (value) {
        pos = await getPosition().catch((err) => {
          setLocationError(err.message);
          return {};
        });
      }
      await post('/driver/status', { online: value, ...pos });
      refresh();
    });

  return (
    <>
      <div className="spread">
        <div className="stack" style={{ gap: 2 }}>
          <span className="small muted">Today</span>
          <span style={{ fontSize: 22, fontWeight: 900 }}>{rupees(me.today.earned)} · {me.today.trips} trip{me.today.trips === 1 ? '' : 's'}</span>
        </div>
        <button className="toggle" aria-pressed={online} disabled={toggle.busy} onClick={() => setOnline(!online)}>
          <span className="track"><span className="knob" /></span>
          {online ? 'Online' : 'Offline'}
        </button>
      </div>
      <ErrorBox error={toggle.error} />
      {online && (permission === 'denied' || locationError) && (
        <div className="error" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <b>Turn on location to get nearby bookings</b>
          <span className="small">{locationError || 'Location is blocked for this app. Allow it in your browser settings, then go offline and online again.'}</span>
        </div>
      )}

      {me.owed > 0 && (
        <div className={me.blocked ? 'error' : 'card'} style={{ gap: 4 }}>
          <b>{me.blocked ? 'Settle your dues to go online' : 'Commission due to Drivana'}</b>
          <span className="small">
            You owe {rupees(me.owed)} from cash trips{me.blocked ? `, above the ${rupees(me.owedLimit)} limit` : ''}. Pay by UPI and our team will update it.
          </span>
        </div>
      )}

      <div className="tabbar" role="group" aria-label="Sections" style={{ background: 'var(--forest-2)' }}>
        <button aria-pressed={tab === 'requests'} onClick={() => setTab('requests')} style={tab === 'requests' ? { background: 'var(--gold)', color: 'var(--forest)' } : undefined}>Requests</button>
        <button aria-pressed={tab === 'history'} onClick={() => setTab('history')} style={tab === 'history' ? { background: 'var(--gold)', color: 'var(--forest)' } : undefined}>My trips</button>
      </div>

      {tab === 'history' ? <History /> : online ? <Requests refresh={refresh} /> : (
        <div className="card" style={{ textAlign: 'center', alignItems: 'center', padding: 28 }}>
          <b style={{ fontSize: 18 }}>You're offline</b>
          <span className="muted">Go online to start receiving bookings near you. Keep this app open while online.</span>
          <button className="btn primary" disabled={toggle.busy || me.blocked} onClick={() => setOnline(true)}>Go online</button>
        </div>
      )}
    </>
  );
}

function Requests({ refresh }) {
  const { data, error, refresh: reload } = usePolling(() => api('/driver/requests'), 4000);
  const action = useAction();
  const seen = useRef(new Set());

  // Buzz the phone when a new request appears.
  useEffect(() => {
    if (!data) return;
    const fresh = data.filter((r) => !seen.current.has(r.id));
    fresh.forEach((r) => seen.current.add(r.id));
    if (fresh.length) navigator.vibrate?.([200, 100, 200]);
  }, [data]);

  if (error) return <ErrorBox error={error.message} />;
  if (!data) return <Splash />;
  if (!data.length) {
    return (
      <div className="card" style={{ textAlign: 'center', alignItems: 'center', padding: 28 }}>
        <div className="pulse" />
        <b>Waiting for bookings</b>
        <span className="small muted">New requests near you will appear here.</span>
      </div>
    );
  }

  const accept = (id) => action.run(async () => { await post(`/driver/requests/${id}/accept`); refresh(); });
  const decline = (id) => action.run(async () => { await post(`/driver/requests/${id}/decline`); reload(); });

  return (
    <>
    <ErrorBox error={action.error} />
    <ul className="list">
      {data.map((r) => (
        <li key={r.id} className="card inverse">
          <span className="small" style={{ color: 'var(--gold)', fontWeight: 900, letterSpacing: '0.08em' }}>NEW BOOKING</span>
          <div className="stack" style={{ gap: 2 }}>
            <span className="small muted">You earn about</span>
            <span className="big-number">{rupees(r.estimatedEarning)}</span>
            <span className="small" style={{ color: '#C7D1C3' }}>for {r.bookedHours} hr · extra time paid per 30 min</span>
          </div>
          <div className="stack" style={{ background: 'var(--forest-2)', borderRadius: 18, padding: 16, gap: 12 }}>
            <div className="row" style={{ alignItems: 'flex-start' }}><Icon name="pin" />
              <div className="stack" style={{ gap: 2 }}><b>{r.pickupAddress}</b>
                <span className="small muted">{r.distanceKm != null ? `${r.distanceKm} km away` : 'Distance unknown'} · {r.customer.name}</span></div></div>
            <div className="row"><Icon name="car" /><b>{r.vehicle.model} · {transmissionLabel(r.vehicle.transmission)}</b></div>
            <div className="row"><Icon name="clock" /><b>Start now · {r.bookedHours} hours</b></div>
          </div>
          <div className="chips three">
            <button className="btn small" style={{ background: 'var(--forest-3)', color: '#FFFFFF', minHeight: 60 }} disabled={action.busy} onClick={() => decline(r.id)}>Decline</button>
            <button className="btn primary" style={{ gridColumn: 'span 2', minHeight: 60 }} disabled={action.busy} onClick={() => accept(r.id)}>Accept</button>
          </div>
        </li>
      ))}
    </ul>
    </>
  );
}

function History() {
  const { data, error } = usePolling(() => api('/driver/bookings'), 0);
  if (error) return <ErrorBox error={error.message} />;
  if (!data) return <Splash />;
  if (!data.length) return <p className="muted center">Your completed trips will show up here.</p>;
  return (
    <ul className="list">
      {data.map((b) => (
        <li key={b.id} className="card" style={{ gap: 6 }}>
          <div className="spread"><b>{dateTime(b.startedAt || b.createdAt)}</b><span className={`status ${b.status}`}>{b.status}</span></div>
          <span className="small muted">{b.vehicle.model} · {b.pickupAddress}</span>
          {b.status === 'completed' && (
            <div className="spread small"><span>Fare {rupees(b.fareTotal)} · commission {rupees(b.commission)}</span><b>You earned {rupees(b.driverEarning)}</b></div>
          )}
        </li>
      ))}
    </ul>
  );
}
