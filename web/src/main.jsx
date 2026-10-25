import { StrictMode, lazy, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { api } from './api.js';
import { Splash } from './ui.jsx';
import { Contact, Privacy, Refunds, Terms } from './Legal.jsx';
import './styles.css';

const CustomerApp = lazy(() => import('./customer/CustomerApp.jsx'));
const DriverApp = lazy(() => import('./driver/DriverApp.jsx'));
const AdminApp = lazy(() => import('./admin/AdminApp.jsx'));

function Root() {
  const [config, setConfig] = useState(null);
  useEffect(() => {
    api('/config').then(setConfig).catch(() => setConfig({}));
  }, []);
  if (!config) return <Splash />;
  return (
    <Suspense fallback={<Splash />}>
      <Routes>
        <Route path="/driver/*" element={<DriverApp config={config} />} />
        <Route path="/admin/*" element={<AdminApp config={config} />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/refunds" element={<Refunds />} />
        <Route path="/contact" element={<Contact config={config} />} />
        <Route path="/*" element={<CustomerApp config={config} />} />
      </Routes>
    </Suspense>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Root />
    </BrowserRouter>
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
}
