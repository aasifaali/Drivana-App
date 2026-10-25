import { useCallback, useEffect, useRef, useState } from 'react';
import { post } from './api.js';

// ---------- Icons (inline stroke SVG) ----------
const paths = {
  pin: <><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></>,
  car: <><path d="M5 17h14M3 13l2-5a2 2 0 0 1 2-1.3h10A2 2 0 0 1 19 8l2 5v4H3z" /><circle cx="7.5" cy="17" r="1.8" /><circle cx="16.5" cy="17" r="1.8" /></>,
  clock: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>,
  phone: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />,
  chat: <path d="M4 5h16v11H8l-4 4z" />,
  shield: <><path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z" /><path d="M9 12l2 2 4-4" /></>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  check: <path d="M5 12l5 5 9-10" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  back: <path d="M15 6l-6 6 6 6" />,
  locate: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /><circle cx="12" cy="12" r="7" /></>,
  logout: <><path d="M15 4h4v16h-4" /><path d="M10 8l-4 4 4 4M6 12h10" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01" /></>,
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
};

export function Icon({ name, size = 20, stroke = 2, ...rest }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" {...rest}>
      {paths[name]}
    </svg>
  );
}

export function Star({ filled, size = 32 }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : '#9AA1AA'} strokeWidth="1.6" strokeLinejoin="round">
      <path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z" />
    </svg>
  );
}

export function Brand({ variant = 'navy', label = 'Drivana' }) {
  return (
    <span className="brand">
      <img src={`/brand/drivana-mark-${variant}.png`} alt="" />
      {label}
    </span>
  );
}

export const Splash = () => (
  <div className="splash" role="status" aria-label="Loading"><div className="spinner" /></div>
);

export const ErrorBox = ({ error }) => (error ? <div className="error" role="alert">{error}</div> : null);

// ---------- Formatting ----------
export const rupees = (n) => (n == null ? '—' : `₹${Number(n).toLocaleString('en-IN')}`);
export const time = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '');
export const dateTime = (iso) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
export const initials = (name) => String(name || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
export const transmissionLabel = (t) => ({ manual: 'Manual', automatic: 'Automatic', both: 'Manual & automatic' })[t] || t;
export function duration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
export const minutesLabel = (mins) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return [h && `${h} hr`, m && `${m} min`].filter(Boolean).join(' ') || '0 min';
};

// ---------- Hooks ----------

// Loads data, re-polls every `intervalMs` while the tab is visible.
export function usePolling(load, intervalMs) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  const refresh = useCallback(async () => {
    try {
      setData(await loadRef.current());
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    refresh();
    if (!intervalMs) return undefined;
    const id = setInterval(() => document.visibilityState === 'visible' && refresh(), intervalMs);
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh, intervalMs]);

  return { data, error, refresh };
}

// Wraps an async action with busy + error state.
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = useCallback(async (fn) => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(err.message);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

const LOCATION_BLOCKED_HELP = /iPhone|iPad/.test(navigator.userAgent)
  ? 'Location is blocked. On iPhone: Settings › Privacy & Security › Location Services › Safari Websites › While Using, then try again.'
  : 'Location is blocked. Tap the icon to the left of the web address › Permissions (or Site settings) › Location › Allow, then try again.';

export function getPosition({ timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Location is not available on this device'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (err) => {
        const e = new Error(
          err.code === err.PERMISSION_DENIED
            ? LOCATION_BLOCKED_HELP
            : 'Could not find your location. Turn on location (GPS) on your phone and try again.',
        );
        e.denied = err.code === err.PERMISSION_DENIED;
        reject(e);
      },
      { enableHighAccuracy: true, timeout, maximumAge: 60000 },
    );
  });
}

// 'granted' | 'prompt' | 'denied' | 'unknown'; updates if the user changes it.
export function useLocationPermission() {
  const [state, setState] = useState('unknown');
  useEffect(() => {
    let status;
    const update = () => setState(status.state);
    navigator.permissions?.query({ name: 'geolocation' }).then((s) => {
      status = s;
      update();
      s.addEventListener('change', update);
    }).catch(() => {});
    return () => status?.removeEventListener('change', update);
  }, []);
  return state;
}

// Points the install manifest and icon at the right app (customer vs driver).
export function useManifest(href, appleIcon) {
  useEffect(() => {
    document.getElementById('manifest')?.setAttribute('href', href);
    document.getElementById('apple-icon')?.setAttribute('href', appleIcon);
  }, [href, appleIcon]);
}

// ---------- Shared pieces ----------

export function GoogleSignIn({ clientId, role, onDone, theme = 'filled_black' }) {
  const ref = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!clientId) return undefined;
    let cancelled = false;
    const init = () => {
      if (cancelled || !window.google?.accounts?.id) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async ({ credential }) => {
          try {
            await post('/auth/google', { credential, role });
            onDone();
          } catch (err) {
            setError(err.message);
          }
        },
      });
      window.google.accounts.id.renderButton(ref.current, {
        theme, size: 'large', shape: 'pill', text: 'continue_with', width: Math.min(ref.current.offsetWidth || 340, 400),
      });
    };
    if (window.google?.accounts?.id) init();
    else {
      let script = document.getElementById('gsi');
      if (!script) {
        script = document.createElement('script');
        script.id = 'gsi';
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener('load', init);
    }
    return () => { cancelled = true; };
  }, [clientId, role, onDone, theme]);

  if (!clientId) return null;
  return (
    <div className="stack">
      <div ref={ref} style={{ minHeight: 44, display: 'flex', justifyContent: 'center' }} />
      <ErrorBox error={error} />
    </div>
  );
}

// Two-step phone form: send code, then verify. `sendPath` / `verifyPath` are API paths.
export function PhoneOtpForm({ sendPath, verifyPath, onDone, submitLabel = 'Verify', dark }) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState(null);
  const { busy, error, run } = useAction();

  const send = (e) => {
    e.preventDefault();
    run(async () => {
      const r = await post(sendPath, { phone });
      setSentTo(r.phone);
    });
  };
  const verify = (e) => {
    e.preventDefault();
    run(async () => {
      await post(verifyPath, { phone: sentTo, code });
      onDone();
    });
  };

  if (!sentTo) {
    return (
      <form className="stack" onSubmit={send}>
        <label className="field">
          <span>Mobile number</span>
          <input className="input" type="tel" inputMode="numeric" autoComplete="tel-national" placeholder="98765 43210"
            value={phone} onChange={(e) => setPhone(e.target.value)} required />
        </label>
        <ErrorBox error={error} />
        <button className={`btn block ${dark ? 'primary' : 'dark'}`} disabled={busy}>Send code</button>
      </form>
    );
  }
  return (
    <form className="stack" onSubmit={verify}>
      <label className="field">
        <span>Enter the 6-digit code sent to {sentTo}</span>
        <input className="input otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
          value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required autoFocus />
      </label>
      <ErrorBox error={error} />
      <button className={`btn block ${dark ? 'primary' : 'dark'}`} disabled={busy || code.length !== 6}>{submitLabel}</button>
      <button type="button" className="btn text" onClick={() => { setSentTo(null); setCode(''); }}>Change number</button>
    </form>
  );
}

// Local testing only: shown when the server runs with DEV_LOGIN=1.
export function DevLogin({ role, onDone, dark }) {
  const [value, setValue] = useState('');
  const { busy, error, run } = useAction();
  const isDriver = role === 'driver';
  return (
    <form className="card outline" onSubmit={(e) => {
      e.preventDefault();
      run(async () => {
        await post('/auth/dev', isDriver ? { role, phone: value } : { role, name: value });
        onDone();
      });
    }}>
      <span className="small muted"><b>Developer sign-in</b> — only visible because DEV_LOGIN=1</span>
      <input className="input" placeholder={isDriver ? 'Driver mobile number' : 'Your name'} value={value}
        onChange={(e) => setValue(e.target.value)} required />
      <ErrorBox error={error} />
      <button className={`btn small ${dark ? 'primary' : 'dark'}`} disabled={busy}>Sign in as test {role}</button>
    </form>
  );
}

export function SupportLinks({ config }) {
  if (!config?.supportPhone && !config?.supportWhatsapp) return null;
  const wa = String(config.supportWhatsapp || '').replace(/\D/g, '');
  return (
    <div className="row" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
      {config.supportPhone && (
        <a className="btn text" href={`tel:${config.supportPhone}`}><Icon name="phone" size={18} /> Call support</a>
      )}
      {wa && (
        <a className="btn text" href={`https://wa.me/${wa.length === 10 ? `91${wa}` : wa}`} target="_blank" rel="noreferrer">
          <Icon name="chat" size={18} /> WhatsApp support
        </a>
      )}
    </div>
  );
}
