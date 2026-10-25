import { useEffect, useRef, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { api, post, put } from '../api.js';
import { DevLogin, ErrorBox, GoogleSignIn, Icon, Splash, dateTime, rupees, time, transmissionLabel, useAction, usePolling, useNow } from '../ui.jsx';

export default function AdminApp({ config }) {
  useEffect(() => document.body.classList.remove('dark'), []);
  const { data: me, error, refresh } = usePolling(() => api('/admin/me'), 0);

  if (error?.status === 401 || error?.status === 403) return <AdminLogin config={config} onDone={refresh} />;
  if (!me) return error ? <main className="admin-main"><ErrorBox error={error.message} /></main> : <Splash />;

  const logout = async () => { await post('/auth/logout', { role: 'admin' }); refresh(); };
  const link = ({ isActive }) => (isActive ? 'active' : undefined);

  return (
    <div className="admin">
      <nav className="admin-nav" aria-label="Dashboard">
        <span className="brand" style={{ color: '#FFFFFF', padding: '0 12px 16px' }}>
          <img src="/brand/drivana-mark-gold.png" alt="" /> Drivana Ops
        </span>
        <NavLink to="/admin" end className={link}>Bookings</NavLink>
        <NavLink to="/admin/drivers" className={link}>Drivers</NavLink>
        <NavLink to="/admin/settings" className={link}>Settings</NavLink>
        <span style={{ flex: 1 }} />
        <span className="small" style={{ color: '#A3B3A6', padding: '0 12px' }}>{me.user.email}</span>
        <button className="btn text" style={{ color: '#D8E2D6', justifyContent: 'flex-start' }} onClick={logout}><Icon name="logout" size={18} /> Sign out</button>
      </nav>
      <main className="admin-main">
        <Routes>
          <Route index element={<Bookings config={config} />} />
          <Route path="drivers" element={<Drivers />} />
          <Route path="settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}

function AdminLogin({ config, onDone }) {
  return (
    <main className="app" style={{ justifyContent: 'center' }}>
      <span className="brand"><img src="/brand/drivana-mark-forest.png" alt="" /> Drivana Ops</span>
      <h1 className="h1">Sign in to the dashboard</h1>
      <p className="muted" style={{ margin: 0 }}>Only Google accounts listed in ADMIN_EMAILS can sign in.</p>
      <GoogleSignIn clientId={config.googleClientId} role="admin" onDone={onDone} theme="filled_black" />
      {config.devLogin && <DevLogin role="admin" onDone={onDone} />}
    </main>
  );
}

// ---------------- Bookings ----------------

function Bookings({ config }) {
  const [scope, setScope] = useState('live');
  const overview = usePolling(() => api('/admin/overview'), 5000);
  const list = usePolling(() => api(`/admin/bookings?scope=${scope}`), 5000);
  const [openId, setOpenId] = useState(null);
  const now = useNow(30000);

  useEffect(() => { list.refresh(); }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps

  const o = overview.data;
  const waiting = (list.data || []).filter((b) => b.status === 'requested');
  const refreshAll = () => { overview.refresh(); list.refresh(); };

  return (
    <>
      <div className="spread" style={{ flexWrap: 'wrap' }}>
        <div className="stack" style={{ gap: 4 }}>
          <h1 className="h1">Bookings</h1>
          <span className="muted">{config.city} · refreshes every 5 seconds</span>
        </div>
      </div>

      <div className="stats">
        <Stat label="Waiting for a driver" value={o?.waiting} alert={o?.waiting > 0} />
        <Stat label="Trips in progress" value={o?.inProgress} />
        <Stat label="Drivers online" value={o?.driversOnline} />
        <Stat label="Driver approvals pending" value={o?.pendingApprovals} />
        <Stat label="Cash not yet confirmed" value={o?.cashPending} />
        <Stat label="Commission owed by drivers" value={o ? rupees(o.totalOwed) : null} />
      </div>

      {scope === 'live' && waiting.length > 0 && (
        <section className="panel">
          <h2 className="h2">Needs attention</h2>
          {waiting.map((b) => (
            <div key={b.id} className="row" style={{ flexWrap: 'wrap', background: 'var(--warn-bg)', borderRadius: 14, padding: '14px 16px' }}>
              <span className="status requested">No driver · {Math.max(0, Math.round((now - new Date(b.createdAt)) / 60000))} min</span>
              <div className="grow stack" style={{ gap: 2, minWidth: 220 }}>
                <b>{b.code} · {b.pickupAddress}</b>
                <span className="small muted">
                  {b.customer.name} {b.customer.phone} · {b.vehicle.model} · {transmissionLabel(b.vehicle.transmission)} · {b.bookedHours} hr
                </span>
              </div>
              <button className="btn dark small" onClick={() => setOpenId(b.id)}>Assign driver</button>
            </div>
          ))}
        </section>
      )}

      <section className="panel">
        <div className="spread" style={{ flexWrap: 'wrap' }}>
          <h2 className="h2">{scope === 'live' ? 'Live bookings' : 'All bookings'}</h2>
          <div className="tabbar" style={{ background: 'var(--ground)', minWidth: 240 }} role="group" aria-label="Show">
            <button aria-pressed={scope === 'live'} onClick={() => setScope('live')}>Live</button>
            <button aria-pressed={scope === 'all'} onClick={() => setScope('all')}>All</button>
          </div>
        </div>
        <ErrorBox error={list.error?.message} />
        {list.data && list.data.length === 0 && <p className="muted">No {scope === 'live' ? 'live ' : ''}bookings right now.</p>}
        {list.data && list.data.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Booking</th><th>Created</th><th>Customer</th><th>Driver</th><th>Car</th><th>Hours</th><th>Fare</th><th>Status</th></tr>
              </thead>
              <tbody>
                {list.data.map((b) => (
                  <tr key={b.id}>
                    <td><button className="btn text small" style={{ padding: 0, fontWeight: 900 }} onClick={() => setOpenId(b.id)}>{b.code}</button></td>
                    <td>{dateTime(b.createdAt)}</td>
                    <td>{b.customer.name}<div className="small muted">{b.customer.phone}</div></td>
                    <td>{b.driver ? <>{b.driver.name}<div className="small muted">{b.driver.phone}</div></> : '—'}</td>
                    <td>{b.vehicle.model}<div className="small muted">{transmissionLabel(b.vehicle.transmission)}</div></td>
                    <td>{b.bookedHours}</td>
                    <td>{rupees(b.fareTotal ?? b.estimate)}</td>
                    <td>
                      <span className={`status ${b.status}`}>{b.status.replace('_', ' ')}</span>
                      {b.status === 'completed' && b.paymentStatus === 'pending' && <span className="status cash" style={{ marginLeft: 6 }}>cash pending</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {openId && <BookingDialog id={openId} onClose={() => { setOpenId(null); refreshAll(); }} />}
    </>
  );
}

const Stat = ({ label, value, alert }) => (
  <div className={`stat ${alert ? 'alert' : ''}`}><span className="small" style={{ fontWeight: 700 }}>{label}</span><b>{value ?? '—'}</b></div>
);

function Dialog({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} className="sheet" onClose={onClose} aria-label={title}>
      <div className="stack">
        <div className="spread"><h2 className="h2">{title}</h2>
          <button className="icon-btn" onClick={() => ref.current.close()} aria-label="Close">✕</button></div>
        {children}
      </div>
    </dialog>
  );
}

function BookingDialog({ id, onClose }) {
  const detail = usePolling(() => api(`/admin/bookings/${id}`), 0);
  const candidates = usePolling(() => api(`/admin/bookings/${id}/candidates`), 0);
  const action = useAction();
  const [reason, setReason] = useState('');
  const b = detail.data;

  const assign = (driverId) => action.run(async () => { await post(`/admin/bookings/${id}/assign`, { driverId }); detail.refresh(); candidates.refresh(); });
  const cancel = () => action.run(async () => { await post(`/admin/bookings/${id}/cancel`, { reason: reason || 'Cancelled by Drivana' }); detail.refresh(); });

  return (
    <Dialog title={b ? `Booking ${b.code}` : 'Booking'} onClose={onClose}>
      {!b ? <Splash /> : (
        <>
          <div className="stack small" style={{ gap: 6 }}>
            <div><span className={`status ${b.status}`}>{b.status.replace('_', ' ')}</span></div>
            <div><b>Pickup:</b> {b.pickupAddress}</div>
            <div><b>Customer:</b> {b.customer.name} · <a href={`tel:${b.customer.phone}`}>{b.customer.phone}</a></div>
            <div><b>Car:</b> {b.vehicle.model} · {b.vehicle.regNumber} · {transmissionLabel(b.vehicle.transmission)}</div>
            <div><b>Driver:</b> {b.driver ? <>{b.driver.name} · <a href={`tel:${b.driver.phone}`}>{b.driver.phone}</a></> : 'Not assigned'}</div>
            <div><b>Hours:</b> {b.bookedHours} · <b>Estimate:</b> {rupees(b.estimate)}{b.fareTotal != null && <> · <b>Final:</b> {rupees(b.fareTotal)} (commission {rupees(b.commission)})</>}</div>
            <div><b>Start OTP:</b> {b.startOtp} <span className="muted">(read it to the driver only after confirming with the customer)</span></div>
          </div>
          <ErrorBox error={action.error} />

          {['requested', 'accepted', 'arrived'].includes(b.status) && (
            <div className="stack" style={{ gap: 8 }}>
              <b>{b.driver ? 'Reassign to another driver' : 'Assign a driver'}</b>
              {candidates.data?.length === 0 && <span className="small muted">No free approved drivers can drive this car.</span>}
              {candidates.data?.filter((d) => d.id !== b.driver?.id).map((d) => (
                <div key={d.id} className="spread card outline" style={{ padding: '10px 14px', flexDirection: 'row' }}>
                  <span className="small"><b>{d.name}</b> · {d.phone}<br />
                    <span className="muted">{d.online ? 'Online' : 'Offline'}{d.distanceKm != null ? ` · ${d.distanceKm} km away` : ''}</span></span>
                  <button className="btn dark small" disabled={action.busy} onClick={() => assign(d.id)}>Assign</button>
                </div>
              ))}
            </div>
          )}

          {['requested', 'accepted', 'arrived', 'in_progress'].includes(b.status) && (
            <div className="stack" style={{ gap: 8 }}>
              <b>Cancel booking</b>
              <input className="input" placeholder="Reason (shown in history)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <button className="btn ghost small danger" disabled={action.busy} onClick={cancel}>Cancel booking</button>
            </div>
          )}

          <div className="stack" style={{ gap: 4 }}>
            <b>History</b>
            {b.events.map((e, i) => (
              <span key={i} className="small"><span className="muted">{time(e.at)}</span> · {e.type.replace('_', ' ')}{e.actor ? ` by ${e.actor}` : ''}</span>
            ))}
          </div>
        </>
      )}
    </Dialog>
  );
}

// ---------------- Drivers ----------------

function Drivers() {
  const { data, error, refresh } = usePolling(() => api('/admin/drivers'), 10000);
  const action = useAction();
  const [settling, setSettling] = useState(null);
  const [reasonFor, setReasonFor] = useState(null); // { driver, status }

  const setStatus = (d, status, note) => {
    if ((status === 'rejected' || status === 'suspended') && note === undefined) return setReasonFor({ driver: d, status });
    return action.run(async () => { await post(`/admin/drivers/${d.id}/status`, { status, note }); setReasonFor(null); refresh(); });
  };

  return (
    <>
      <h1 className="h1">Drivers</h1>
      <ErrorBox error={error?.message || action.error} />
      {!data ? <Splash /> : data.length === 0 ? <p className="muted">No drivers yet. Drivers sign up at <b>/driver</b>.</p> : (
        <section className="panel">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Driver</th><th>Status</th><th>Licence</th><th>Drives</th><th>Rating</th><th>Trips</th><th>Owes</th><th>Actions</th></tr></thead>
              <tbody>
                {data.map((d) => (
                  <tr key={d.id}>
                    <td><b>{d.name || 'No name yet'}</b>{d.online && <span className="status approved" style={{ marginLeft: 6 }}>online</span>}
                      <div className="small muted">{d.phone}{d.experienceYears != null ? ` · ${d.experienceYears} yrs` : ''}</div></td>
                    <td><span className={`status ${d.status}`}>{d.profileComplete || d.status !== 'pending' ? d.status : 'signing up'}</span></td>
                    <td>{d.licenceNumber || '—'}<div className="small muted">{d.licenceExpiry ? `valid to ${d.licenceExpiry}` : ''}</div></td>
                    <td>{d.transmissions ? transmissionLabel(d.transmissions) : '—'}</td>
                    <td>{d.rating ?? '—'}</td>
                    <td>{d.trips}</td>
                    <td style={{ fontWeight: 800, color: d.owed > 0 ? 'var(--warn-text)' : undefined }}>{rupees(d.owed)}</td>
                    <td>
                      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                        {d.status !== 'approved' && d.profileComplete && <button className="btn dark small" disabled={action.busy} onClick={() => setStatus(d, 'approved')}>Approve</button>}
                        {d.status === 'pending' && d.profileComplete && <button className="btn ghost small" disabled={action.busy} onClick={() => setStatus(d, 'rejected')}>Reject</button>}
                        {d.status === 'approved' && <button className="btn ghost small" disabled={action.busy} onClick={() => setStatus(d, 'suspended')}>Suspend</button>}
                        <button className="btn ghost small" onClick={() => setSettling(d)}>Payments</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {settling && <PaymentsDialog driver={settling} onClose={() => { setSettling(null); refresh(); }} />}
      {reasonFor && <ReasonDialog {...reasonFor} busy={action.busy} onSubmit={setStatus} onClose={() => setReasonFor(null)} />}
    </>
  );
}

function ReasonDialog({ driver: d, status, busy, onSubmit, onClose }) {
  const [note, setNote] = useState('');
  const verb = status === 'rejected' ? 'Reject' : 'Suspend';
  return (
    <Dialog title={`${verb} ${d.name || d.phone}`} onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); onSubmit(d, status, note); }}>
        <label className="field"><span>Reason (the driver will see this)</span>
          <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} autoFocus /></label>
        <button className="btn dark small" disabled={busy}>{verb}</button>
      </form>
    </Dialog>
  );
}

function PaymentsDialog({ driver: d, onClose }) {
  const ledger = usePolling(() => api(`/admin/drivers/${d.id}/ledger`), 0);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const action = useAction();
  const owed = (ledger.data || []).reduce((sum, e) => sum + e.amount, 0);

  const record = (e) => {
    e.preventDefault();
    action.run(async () => {
      await post(`/admin/drivers/${d.id}/settlement`, { amount: Number(amount), note: note || 'UPI payment received' });
      setAmount(''); setNote(''); ledger.refresh();
    });
  };

  return (
    <Dialog title={`Payments · ${d.name || d.phone}`} onClose={onClose}>
      <div className="stat" style={{ background: 'var(--ground)' }}><span className="small">Currently owes Drivana</span><b>{rupees(owed)}</b></div>
      <form className="stack" onSubmit={record}>
        <b>Record a payment from the driver</b>
        <div className="row">
          <input className="input grow" type="number" min="1" inputMode="numeric" placeholder="Amount ₹" value={amount} onChange={(e) => setAmount(e.target.value)} required aria-label="Amount" />
          <input className="input grow" placeholder="Note (e.g. UPI ref)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
        </div>
        <ErrorBox error={action.error} />
        <button className="btn dark small" disabled={action.busy}>Record payment</button>
      </form>
      <div className="stack" style={{ gap: 4, maxHeight: 260, overflow: 'auto' }}>
        <b>History</b>
        {(ledger.data || []).length === 0 && <span className="small muted">No entries yet.</span>}
        {(ledger.data || []).map((e) => (
          <div key={e.id} className="spread small">
            <span><span className="muted">{dateTime(e.at)}</span> · {e.note || e.kind}</span>
            <b style={{ color: e.amount < 0 ? '#1E6B34' : undefined }}>{e.amount < 0 ? `− ${rupees(-e.amount)}` : rupees(e.amount)}</b>
          </div>
        ))}
      </div>
    </Dialog>
  );
}

// ---------------- Settings ----------------

const FIELDS = [
  ['city', 'City', 'text'],
  ['minHours', 'Minimum booking (hours)', 'number'],
  ['baseFare', 'Base fare for minimum hours (₹)', 'number'],
  ['hourlyRate', 'Each extra hour (₹)', 'number'],
  ['graceMinutes', 'Free overtime (minutes)', 'number'],
  ['nightCharge', 'Night charge 10pm–6am (₹)', 'number'],
  ['commissionPct', 'Drivana commission (%)', 'number'],
  ['dispatchRadiusKm', 'Send requests to drivers within (km)', 'number'],
  ['requestTimeoutMinutes', 'Hide unassigned requests from drivers after (minutes)', 'number'],
  ['owedLimit', 'Block drivers owing more than (₹)', 'number'],
  ['supportPhone', 'Support phone number', 'tel'],
  ['supportWhatsapp', 'Support WhatsApp number', 'tel'],
];

function Settings() {
  const { data, error } = usePolling(() => api('/admin/settings'), 0);
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(false);
  const action = useAction();
  useEffect(() => { if (data && !form) setForm(data); }, [data, form]);

  if (error) return <ErrorBox error={error.message} />;
  if (!form) return <Splash />;

  const save = (e) => {
    e.preventDefault();
    setSaved(false);
    action.run(async () => { setForm(await put('/admin/settings', form)); setSaved(true); });
  };
  const example = form.baseFare + Math.max(0, 4 - form.minHours) * form.hourlyRate;

  return (
    <form className="stack" onSubmit={save} style={{ gap: 20 }}>
      <h1 className="h1">Settings</h1>
      <div className="notice">Price changes apply to new bookings only. Example: a 4-hour booking currently costs <b>{rupees(example)}</b>, and the driver keeps <b>{rupees(example - Math.round(example * form.commissionPct / 100))}</b>.</div>
      <section className="panel">
        <div className="settings-grid">
          {FIELDS.map(([key, label, type]) => (
            <label key={key} className="field">
              <span>{label}</span>
              <input className="input" type={type} min={type === 'number' ? 0 : undefined} value={form[key]}
                onChange={(e) => setForm((f) => ({ ...f, [key]: type === 'number' ? Number(e.target.value) : e.target.value }))} />
            </label>
          ))}
        </div>
      </section>
      <ErrorBox error={action.error} />
      <div className="row">
        <button className="btn dark" disabled={action.busy}>Save settings</button>
        {saved && <span style={{ color: '#1E6B34', fontWeight: 800 }}>Saved</span>}
      </div>
    </form>
  );
}
