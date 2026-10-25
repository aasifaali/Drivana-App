import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Brand } from './ui.jsx';

// Starting-point policies. Have them reviewed before scaling up.
const UPDATED = '25 October 2026';
const CONTACT = 'aasifaalin@gmail.com';

function Page({ title, children }) {
  useEffect(() => {
    document.body.classList.remove('dark');
    document.title = `${title} · Drivana`;
    return () => { document.title = 'Drivana'; };
  }, [title]);
  return (
    <main className="app legal" style={{ maxWidth: 720 }}>
      <header className="topbar"><Link to="/" style={{ textDecoration: 'none' }}><Brand /></Link></header>
      <article className="stack" style={{ gap: 6, lineHeight: 1.6 }}>
        <h1 className="h1">{title}</h1>
        <p className="muted small" style={{ marginTop: 0 }}>Last updated {UPDATED}</p>
        {children}
      </article>
      <footer className="push row small muted" style={{ gap: 16, paddingTop: 24 }}>
        <Link to="/privacy">Privacy Policy</Link>
        <Link to="/terms">Terms of Service</Link>
        <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
      </footer>
    </main>
  );
}

export function Privacy() {
  return (
    <Page title="Privacy Policy">
      <p>
        Drivana ("we", "us") connects people who need a driver for their own car with verified drivers in and around
        Kovvappuram, Kannur, Kerala. This policy explains what we collect, why, and the choices you have.
      </p>

      <h2 className="h2">What we collect</h2>
      <ul>
        <li><b>From Google Sign-In:</b> your name, email address and Google account ID. We do not get your Google password or access to anything else in your Google account.</li>
        <li><b>Your mobile number</b>, so your driver and our team can call you about a booking.</li>
        <li><b>Your car details:</b> model, gearbox type and registration number.</li>
        <li><b>Booking details:</b> pickup address, your location if you choose "use my current location", booking times, fares, cancellations and ratings.</li>
        <li><b>Drivers:</b> name, mobile number, driving licence number and expiry, experience, and location while online in the driver app.</li>
      </ul>

      <h2 className="h2">How we use it</h2>
      <ul>
        <li>To create your account, match you with a driver and run your booking.</li>
        <li>To calculate fares, record cash payments and settle commission with drivers.</li>
        <li>To provide support, resolve disputes, keep the service safe and prevent misuse.</li>
      </ul>
      <p>We do not sell your personal data and we do not use it for advertising.</p>

      <h2 className="h2">Who can see it</h2>
      <ul>
        <li><b>Your driver</b> sees your first name before accepting, and your name, phone number, pickup address and car details after accepting your booking.</li>
        <li><b>You</b> see your driver's name, phone number, rating and experience once a driver is assigned.</li>
        <li><b>The Drivana operations team</b> can see bookings and accounts to run the service and help you.</li>
        <li>We may disclose information if required by law or to protect someone's safety.</li>
      </ul>
      <p>Our servers are run by our hosting provider, which stores the data on our behalf.</p>

      <h2 className="h2">How long we keep it</h2>
      <p>
        We keep your account while it is active, and booking records for as long as needed for accounting, legal and
        dispute purposes. You can ask us to delete your account at any time; we will delete or anonymise your data
        unless we must keep some records by law.
      </p>

      <h2 className="h2">Your choices</h2>
      <ul>
        <li>Location access is optional; you can type your pickup address instead.</li>
        <li>You can ask for a copy of your data, a correction, or deletion by emailing <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.</li>
      </ul>

      <h2 className="h2">Security</h2>
      <p>The site uses HTTPS, sign-in sessions are protected, and access to data is limited to the people who need it. No system is perfectly secure, so please tell us at once if you notice anything wrong.</p>

      <h2 className="h2">Children</h2>
      <p>Drivana is for adults (18+). We do not knowingly collect data from children.</p>

      <h2 className="h2">Changes and contact</h2>
      <p>We will update this page if this policy changes. Questions: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.</p>
    </Page>
  );
}

export function Terms() {
  return (
    <Page title="Terms of Service">
      <p>
        These terms apply when you use Drivana's website and apps to book a driver, or to drive with Drivana. By using
        Drivana you agree to them.
      </p>

      <h2 className="h2">The service</h2>
      <p>
        Drivana helps you book a driver who drives <b>your own car</b>, by the hour. Drivers are independent and have
        their driving licence checked by Drivana before they can take bookings. Drivana does not provide cars.
      </p>

      <h2 className="h2">Your account</h2>
      <ul>
        <li>You must be 18 or older and give accurate details, including a mobile number you can be reached on.</li>
        <li>You are responsible for activity on your account. Tell us if you think someone else is using it.</li>
      </ul>

      <h2 className="h2">Your car</h2>
      <ul>
        <li>Your car must be roadworthy and have a valid registration certificate, insurance and pollution certificate, kept in the car.</li>
        <li>Choose the correct gearbox (manual or automatic) so we can send a suitable driver.</li>
        <li>Check the car with the driver before sharing the start OTP, and again when the trip ends.</li>
      </ul>

      <h2 className="h2">Fares and payment</h2>
      <ul>
        <li>The app shows an estimate before you book. Every booking has a minimum number of hours.</li>
        <li>The final fare is based on the time used: at least the hours you booked, with extra time charged in 30-minute blocks after a short grace period, plus a night charge for trips between 10 pm and 6 am.</li>
        <li>For now, you pay the final fare <b>in cash to the driver</b> when the trip ends.</li>
      </ul>

      <h2 className="h2">Cancellations</h2>
      <p>You can cancel in the app before the trip starts. Please cancel as early as possible once a driver is on the way. We may cancel a booking if no driver is available or if we have safety concerns.</p>

      <h2 className="h2">Conduct</h2>
      <ul>
        <li>Treat each other with respect. Drivers must follow traffic laws and must not drive under the influence.</li>
        <li>Customers must not ask drivers to break the law, overload the car or drive unsafely.</li>
        <li>We may suspend accounts that break these terms or put others at risk.</li>
      </ul>

      <h2 className="h2">Damage, accidents and liability</h2>
      <ul>
        <li>Report any accident, damage or traffic fine to Drivana within 24 hours, with photos if possible.</li>
        <li>Your car's insurance remains the primary cover for the car. Drivers are responsible for damage caused by their own negligence or breaking the law.</li>
        <li>To the extent the law allows, Drivana is not liable for indirect losses, and our total liability for a booking is limited to the fare for that booking. Nothing in these terms limits rights you have under Indian consumer law.</li>
      </ul>

      <h2 className="h2">Changes, law and contact</h2>
      <p>
        We may update these terms and will show the new date above. These terms are governed by the laws of India, and
        courts in Kannur, Kerala have jurisdiction. Contact: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>
    </Page>
  );
}
