import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, post, put } from '../api.js';
import {
  Brand, DevLogin, ErrorBox, GoogleSignIn, Icon, KeralaScene, Splash, SupportLinks,
  dateTime, getPosition, rupees, transmissionLabel, useAction, useLocationPermission, useManifest, usePolling,
} from '../ui.jsx';
import BookingStatus from './BookingStatus.jsx';

export default function CustomerApp({ config }) {
  useManifest('/manifest.webmanifest', '/icons/apple-touch-icon.png');
  useEffect(() => document.body.classList.remove('dark'), []);
  const { data: me, error, refresh } = usePolling(() => api('/customer/me'), 5000);
  const [tab, setTab] = useState('book');

  if (error?.status === 401) return <Welcome config={config} onDone={refresh} />;
  if (!me) {
    return error ? (
      <main className="app"><ErrorBox error={error.message} /><button className="btn dark" onClick={refresh}>Try again</button></main>
    ) : <Splash />;
  }

  const logout = async () => {
    await post('/auth/logout', { role: 'customer' });
    refresh();
  };

  let body;
  if (!me.user.phone) body = <PhoneStep onDone={refresh} />;
  else if (me.vehicles.length === 0) body = <CarStep onDone={refresh} first />;
  else if (me.activeBooking) body = <BookingStatus booking={me.activeBooking} ratingTags={me.ratingTags} refresh={refresh} />;
  else {
    body = (
      <>
        <div className="tabbar" role="group" aria-label="Sections">
          <button aria-pressed={tab === 'book'} onClick={() => setTab('book')}>Book</button>
          <button aria-pressed={tab === 'trips'} onClick={() => setTab('trips')}>My trips</button>
        </div>
        {tab === 'book' ? <BookScreen me={me} config={config} refresh={refresh} /> : <Trips />}
      </>
    );
  }

  return (
    <main className="app">
      <header className="topbar">
        <Brand />
        <button className="icon-btn" onClick={logout} aria-label="Sign out" title="Sign out"><Icon name="logout" /></button>
      </header>
      {body}
      <div className="push"><SupportLinks config={config} /></div>
    </main>
  );
}

function Welcome({ config, onDone }) {
  useEffect(() => {
    document.body.classList.add('dark');
    return () => document.body.classList.remove('dark');
  }, []);
  return (
    <main className="app welcome">
      <KeralaScene />
      <div className="stack grow" style={{ justifyContent: 'center', gap: 22 }}>
        <img src="/brand/drivana-mark-gold.png" alt="" width="88" height="88" />
        <div className="stack" style={{ gap: 10 }}>
          <h1 className="wordmark">Drivana</h1>
          <div className="tagline">Your car.<br />Your driver.</div>
        </div>
        <div className="stack" style={{ gap: 14, marginTop: 8 }}>
          <div className="feature"><span><Icon name="shield" size={18} /></span><span>Verified drivers, licence checked</span></div>
          <div className="feature"><span><Icon name="clock" size={18} /></span><span>Book by the hour, in minutes</span></div>
          <div className="feature"><span><Icon name="lock" size={18} /></span><span>OTP-secured car handover</span></div>
        </div>
      </div>
      <div className="stack">
        <GoogleSignIn clientId={config.googleClientId} role="customer" onDone={onDone} theme="outline" />
        {config.devLogin && <DevLogin role="customer" onDone={onDone} dark />}
        {!config.googleClientId && !config.devLogin && (
          <div className="notice">Sign-in is not set up yet. Add GOOGLE_CLIENT_ID to the server's .env file.</div>
        )}
        <p className="small center" style={{ color: '#A3B3A6', margin: 0 }}>
          By continuing you agree to our <Link to="/terms" style={{ color: '#D8E2D6' }}>Terms</Link> and{' '}
          <Link to="/privacy" style={{ color: '#D8E2D6' }}>Privacy Policy</Link>
        </p>
      </div>
    </main>
  );
}

function PhoneStep({ onDone }) {
  const [phone, setPhone] = useState('');
  const { busy, error, run } = useAction();
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      await put('/customer/phone', { phone });
      onDone();
    });
  };
  return (
    <form className="stack" onSubmit={submit}>
      <h1 className="h1">Add your mobile number</h1>
      <p className="muted" style={{ margin: 0 }}>Your driver will call this number when they reach your car.</p>
      <label className="field">
        <span>Mobile number</span>
        <input className="input" type="tel" inputMode="numeric" autoComplete="tel-national" placeholder="98765 43210"
          value={phone} onChange={(e) => setPhone(e.target.value)} required autoFocus />
      </label>
      <ErrorBox error={error} />
      <button className="btn dark block" disabled={busy}>Continue</button>
    </form>
  );
}

function CarStep({ onDone, onCancel, first }) {
  const [model, setModel] = useState('');
  const [transmission, setTransmission] = useState('');
  const [regNumber, setRegNumber] = useState('');
  const { busy, error, run } = useAction();

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      await post('/customer/vehicles', { model, transmission, regNumber });
      onDone();
    });
  };

  return (
    <form className="stack" onSubmit={submit}>
      <h1 className="h1">{first ? 'Tell us about your car' : 'Add a car'}</h1>
      {first && <p className="muted" style={{ margin: 0 }}>We only send drivers who can drive it.</p>}
      <label className="field">
        <span>Car model</span>
        <input className="input" placeholder="e.g. Maruti Swift" value={model} onChange={(e) => setModel(e.target.value)} required />
      </label>
      <div className="field">
        <span>Gearbox</span>
        <div className="chips two" role="group" aria-label="Gearbox">
          {['manual', 'automatic'].map((t) => (
            <button type="button" key={t} className="chip" aria-pressed={transmission === t} onClick={() => setTransmission(t)}>
              {transmissionLabel(t)}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        <span>Registration number</span>
        <input className="input" placeholder="KL 13 AB 1234" value={regNumber} onChange={(e) => setRegNumber(e.target.value)}
          style={{ textTransform: 'uppercase' }} required />
      </label>
      <ErrorBox error={error} />
      <button className="btn dark block" disabled={busy || !transmission}>Save car</button>
      {onCancel && <button type="button" className="btn text" onClick={onCancel}>Cancel</button>}
    </form>
  );
}

function BookScreen({ me, config, refresh }) {
  const minHours = config.minHours || 2;
  const presets = [...new Set([minHours, 4, 8])].filter((h) => h >= minHours);
  const [address, setAddress] = useState('');
  const [coords, setCoords] = useState(null);
  const [vehicleId, setVehicleId] = useState(me.vehicles[0]?.id);
  const [hours, setHours] = useState(presets[0]);
  const [custom, setCustom] = useState(false);
  const [estimate, setEstimate] = useState(null);
  const [addingCar, setAddingCar] = useState(false);
  const locate = useAction();
  const book = useAction();

  useEffect(() => {
    if (!me.vehicles.some((v) => v.id === vehicleId)) setVehicleId(me.vehicles[0]?.id);
  }, [me.vehicles, vehicleId]);

  useEffect(() => {
    let live = true;
    if (Number.isInteger(hours) && hours >= minHours) {
      api(`/customer/estimate?hours=${hours}`).then((r) => live && setEstimate(r.estimate)).catch(() => live && setEstimate(null));
    } else setEstimate(null);
    return () => { live = false; };
  }, [hours, minHours]);

  const useMyLocation = () =>
    locate.run(async () => {
      const pos = await getPosition();
      setCoords(pos);
      if (!address) setAddress('My current location');
    });

  // Ask for location as soon as the booking screen opens, so the driver gets
  // an exact pin. Stays quiet if the customer has blocked it.
  const permission = useLocationPermission();
  const asked = useRef(false);
  const [autoLocating, setAutoLocating] = useState(false);
  const [autoFailed, setAutoFailed] = useState(false);
  useEffect(() => {
    if (asked.current || permission === 'unknown' && navigator.permissions || permission === 'denied') return;
    asked.current = true;
    setAutoLocating(true);
    getPosition()
      .then(setCoords)
      .catch(() => setAutoFailed(true))
      .finally(() => setAutoLocating(false));
  }, [permission]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = (e) => {
    e.preventDefault();
    book.run(async () => {
      await post('/customer/bookings', { vehicleId, pickupAddress: address, pickupLat: coords?.lat, pickupLng: coords?.lng, hours });
      refresh();
    });
  };

  const firstName = me.user.name && !me.user.name.includes('@') ? me.user.name.split(' ')[0] : '';
  const carDone = useCallback(() => { setAddingCar(false); refresh(); }, [refresh]);
  if (addingCar) return <CarStep onDone={carDone} onCancel={() => setAddingCar(false)} />;

  return (
    <form className="stack" style={{ gap: 18 }} onSubmit={submit}>
      <div>
        <h1 className="h1">Need a driver{firstName ? `, ${firstName}` : ''}?</h1>
        <span className="muted" style={{ fontWeight: 700 }}>Your car. Your driver.</span>
      </div>

      <div className="field">
        <span>Pickup — where is your car?</span>
        <div className="row" style={{ gap: 8 }}>
          <input className="input grow" placeholder="House name, street, landmark" value={address}
            onChange={(e) => setAddress(e.target.value)} required minLength={5} aria-label="Pickup address" />
          <button type="button" className="icon-btn" style={{ width: 52, height: 52, borderRadius: 14 }}
            onClick={useMyLocation} disabled={locate.busy} aria-label="Use my current location" title="Use my current location">
            <Icon name="locate" />
          </button>
        </div>
        {coords ? (
          <span className="small" style={{ color: '#1E6B34', fontWeight: 700 }}>Location pinned — add a house name or landmark to help your driver</span>
        ) : locate.busy || autoLocating ? (
          <span className="small muted">Finding your location… allow location if your browser asks</span>
        ) : (permission === 'denied' || autoFailed) && !locate.error ? (
          <span className="small muted">Couldn't get your location. Type your address, or tap the pin button to try again.</span>
        ) : null}
        <ErrorBox error={locate.error} />
      </div>

      <div className="field">
        <span>Your car</span>
        <div className="stack" style={{ gap: 8 }}>
          {me.vehicles.map((v) => (
            <label key={v.id} className="card outline" style={{ position: 'relative', flexDirection: 'row', alignItems: 'center', padding: '12px 16px', cursor: 'pointer',
              borderColor: v.id === vehicleId ? 'var(--forest)' : undefined, borderWidth: v.id === vehicleId ? 2 : 1 }}>
              <input type="radio" name="vehicle" checked={v.id === vehicleId} onChange={() => setVehicleId(v.id)}
                style={{ position: 'absolute', opacity: 0 }} />
              <span className="icon-btn" style={{ borderRadius: 12, border: 'none', background: 'var(--ground)' }}><Icon name="car" /></span>
              <span className="grow stack" style={{ gap: 2 }}>
                <b>{v.model}</b>
                <span className="small muted">{transmissionLabel(v.transmission)} · {v.regNumber}</span>
              </span>
              {v.id === vehicleId && <Icon name="check" stroke={3} />}
            </label>
          ))}
          <button type="button" className="btn text" style={{ alignSelf: 'flex-start' }} onClick={() => setAddingCar(true)}>+ Add another car</button>
        </div>
      </div>

      <div className="field">
        <span>How long do you need them?</span>
        <div className="chips" role="group" aria-label="Hours">
          {presets.map((h) => (
            <button type="button" key={h} className="chip" aria-pressed={!custom && hours === h} onClick={() => { setCustom(false); setHours(h); }}>
              {h} hr
            </button>
          ))}
          <button type="button" className="chip" aria-pressed={custom} onClick={() => setCustom(true)}>Custom</button>
        </div>
        {custom && (
          <input className="input" type="number" min={minHours} max={24} step={1} inputMode="numeric" aria-label="Number of hours"
            placeholder={`Hours (${minHours}–24)`} onChange={(e) => setHours(Number(e.target.value))} />
        )}
      </div>

      <div className="spread" style={{ alignItems: 'flex-end' }}>
        <div className="stack" style={{ gap: 2 }}>
          <span className="small muted">Estimated fare · pay in cash</span>
          <span style={{ fontSize: 30, fontWeight: 900, letterSpacing: '-0.02em' }}>{rupees(estimate)}</span>
        </div>
        <span className="small muted" style={{ textAlign: 'right' }}>Extra time billed<br />per 30 min</span>
      </div>
      <ErrorBox error={book.error} />
      <button className="btn primary block" disabled={book.busy || !vehicleId || estimate == null}>
        Find a driver <Icon name="arrow" />
      </button>
    </form>
  );
}

function Trips() {
  const { data, error } = usePolling(() => api('/customer/bookings'), 0);
  if (error) return <ErrorBox error={error.message} />;
  if (!data) return <Splash />;
  if (!data.length) return <p className="muted center">No trips yet. Your bookings will show up here.</p>;
  return (
    <ul className="list">
      {data.map((b) => (
        <li key={b.id} className="card" style={{ gap: 6 }}>
          <div className="spread">
            <b>{dateTime(b.createdAt)}</b>
            <span className={`status ${b.status}`}>{b.status.replace('_', ' ')}</span>
          </div>
          <span className="small muted">{b.vehicle.model} · {b.bookedHours} hr · {b.pickupAddress}</span>
          <div className="spread small">
            <span>{b.driver ? `Driver: ${b.driver.name}` : 'No driver'}</span>
            <b>{rupees(b.fareTotal ?? b.estimate)}</b>
          </div>
        </li>
      ))}
    </ul>
  );
}
