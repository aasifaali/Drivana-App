# Drivana

**Your car. Your driver.** Drivana is an on-demand service where customers book a verified driver to drive their own car, by the hour.

One Node server runs three web apps (PWAs):

| Path | Who | Sign-in |
|---|---|---|
| `/` | Customers book a driver, share the start OTP, pay cash, rate | Google (then types their mobile number, no OTP) |
| `/driver` | Drivers sign up, go online, accept requests, run trips, confirm cash | Google (types their mobile number in the profile); phone OTP once `DRIVER_LOGIN=otp` |
| `/admin` | Ops team: live bookings, manual assignment, driver approvals, commission dues, pricing | Google (allow-listed emails) |

Stack: Node 22.13+ (Fastify, built-in `node:sqlite`), React + Vite, plain CSS.

## Run it locally

```bash
npm install
cp .env.example .env      # DEV_LOGIN=1 is already set for local testing
npm run dev               # API on :3000, web on http://localhost:5173
```

With `DEV_LOGIN=1` every sign-in screen shows a **Developer sign-in** box, so you can test without Google or SMS. To try a full trip:

1. Open `http://localhost:5173/admin` and sign in as a test admin.
2. In another browser profile (or a private window), open `/driver`, use the developer sign-in with any mobile number and fill in the profile. Approve the driver in **Admin › Drivers**, then go online in the driver app.
3. Open `/` and sign in as a test customer, enter any mobile number, add a car and book.
4. Accept the request in the driver app. Use the OTP shown to the customer to start the trip, then end it and tap **Cash collected**.

Run the tests with `npm test`.

## How the business rules work

- **Booking stages:** `requested → accepted → arrived → in_progress → completed`, or `cancelled`. Every change is logged in `booking_events`, which you can see in the booking's History in the dashboard.
- **Matching:** each request is shown to approved, online drivers within the dispatch radius who can drive that gearbox, and the first to accept gets it. If nobody accepts, it appears under **Needs attention** in the dashboard with an **Assign driver** button.
- **Pricing:** the base fare covers the minimum hours, then the hourly rate applies. Overtime past the grace period is billed in 30-minute blocks, plus a flat night charge for trips touching 10pm–6am IST. Prices are copied onto each booking when it's made, so later changes in Settings don't alter past bookings.
- **Cash and commission:** when the driver taps *Cash collected*, the commission is added to what they owe (`ledger_entries`). When a driver pays you by UPI, record it under **Admin › Drivers › Payments**. A driver who owes more than the limit can't go online.
- **Prices are placeholders:** set real numbers in **Admin › Settings** before launch, along with the support phone and WhatsApp numbers.

## Deploy

**Course server:** Drivana runs on the shared course server. Follow `DEPLOY-GUIDE.md`; the details and update command are in `CLAUDE.md`.

### Your own Ubuntu VPS (later)

```bash
# On the server (Ubuntu 22.04/24.04)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt install -y nodejs caddy sqlite3
sudo useradd --system --home /opt/drivana drivana
sudo mkdir -p /opt/drivana && sudo chown drivana: /opt/drivana

# Copy the project (without node_modules, data, .env) to /opt/drivana, then:
cd /opt/drivana
sudo -u drivana npm ci
sudo -u drivana npm run build
sudo -u drivana cp .env.example .env    # then edit it, see below

sudo cp deploy/drivana.service /etc/systemd/system/
sudo systemctl enable --now drivana
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile   # edit the domain first
sudo systemctl reload caddy
```

Production `.env` (or `~/.config/driverbooking.env` on the course server): `NODE_ENV=production`, a random `JWT_SECRET` (`openssl rand -hex 32`), `GOOGLE_CLIENT_ID`, `ADMIN_EMAILS`, and **no** `DEV_LOGIN`. Add your domain to the Google OAuth client's *Authorized JavaScript origins*.

Back up the database every night with `deploy/backup.sh` (instructions inside), and copy the backups off the server.

To update: copy the new code, then `npm ci && npm run build && sudo systemctl restart drivana`.

## Before going public

- **SMS (optional, later):** drivers sign in with Google for now. To switch them to phone OTP, add a provider such as MSG91 or 2Factor in `server/sms.js` (DLT registration of your sender ID and template is required in India), then set `DRIVER_LOGIN=otp`.
- **Policies:** add Terms, Privacy and Cancellation pages, and settle damage liability and insurance for drivers.
- **Driver alerts:** drivers only see new requests while the app is open. Add web push, SMS or WhatsApp alerts next, and plan the native driver app.

## Not built yet

Online payments (Razorpay), scheduled bookings, outstation and one-way trips, live map tracking, driver document photo uploads, push notifications, in-app chat.
