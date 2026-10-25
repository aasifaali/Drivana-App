# Drivana

On-demand drivers for the customer's own car. Node 22.13+ (Fastify, built-in `node:sqlite`) API in `server/`, React + Vite PWAs in `web/` (customer `/`, driver `/driver`, ops `/admin`). See README.md for how it works.

- `npm run dev`: API on :3000 and Vite on :5173 (proxies `/api`). Uses `.env` (DEV_LOGIN=1 locally).
- `npm test`: API flow tests (in-memory DB).
- `npm run build`: builds `web/dist`, which the server serves in production.
- Settings: `PORT`, `HOST`, `DB_PATH`, `JWT_SECRET`, `GOOGLE_CLIENT_ID`, `ADMIN_EMAILS`, `SMS_PROVIDER`, `DRIVER_LOGIN` (google | otp), `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` (online payment is off without the keys), `DEV_LOGIN` (see `.env.example`).
- Sign-in: customers, drivers and admins use Google; customers and drivers type a mobile number without OTP. Driver numbers are unique.
- Schema changes: add a new entry to `MIGRATIONS` in `server/db.js`; never edit a shipped one.

## Deployment

Deployed to the shared course server by following DEPLOY-GUIDE.md. The `deploy/` folder (Caddy, root systemd unit) is for a self-managed VPS and is **not** used here.

| | |
|---|---|
| Server | 187.127.162.81, user `aasifaalin` (`ssh aasifaalin@187.127.162.81`, key login) |
| App name | `driverbooking` |
| Port | 4002 on 127.0.0.1 |
| Address | https://driverbooking-aasifaalin.dhilber.in |
| Repo | https://github.com/aasifaali/Drivana-App (public, cloned over HTTPS) |
| Code | `~/apps/driverbooking/` |
| Database | `~/data/driverbooking/driverbooking.db` |
| Backups | `~/data/driverbooking/backups/` (cron 21:30 UTC, keeps 14 days) |
| Settings and secrets | `~/.config/driverbooking.env` (chmod 600, never in git) |
| Service | `~/.config/systemd/user/driverbooking.service` |

Update after pushing to GitHub:

```
ssh aasifaalin@187.127.162.81 "cd ~/apps/driverbooking && git pull && npm ci && npm run build && systemctl --user restart driverbooking"
```

Then check `systemctl --user status driverbooking --no-pager` and the address. Logs: `journalctl --user -u driverbooking -n 50 --no-pager`. If `DRIVER_LOGIN=otp` is ever set without a real SMS provider, OTP codes only appear in these logs.

Server rules: no sudo/apt/`npm install -g`; stay inside /home/aasifaalin and never touch other users' processes; listen on 127.0.0.1 within ports 4000–4099 only (this app: 4002, 4001 is reserved for quickbill); don't touch the web server, firewall or DNS; keep secrets only in `~/.config/driverbooking.env`; run apps only with `systemctl --user` services. Anything needing root: ask the instructor.
