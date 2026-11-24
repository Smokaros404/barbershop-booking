# Blade & Co. booking site

Clients book on the website. You log in (bottom of the page, "Barber login") and see every reservation on any device.
The server checks your password and stores all bookings. It also blocks double bookings.

## Run on your computer
Needs Node 18 or newer. No packages to install.

    BARBER_EMAIL=you@example.com BARBER_PASSWORD='a-long-password' node server.js

Open http://localhost:3000

On Windows (PowerShell):

    $env:BARBER_EMAIL="you@example.com"; $env:BARBER_PASSWORD="a-long-password"; node server.js

## Put it online (Render.com example)
1. Upload this folder to a private GitHub repository.
2. On Render: New > Web Service > pick the repository. Runtime: Node. Start command: `node server.js`.
3. Environment variables:
   - BARBER_EMAIL = your email
   - BARBER_PASSWORD = a long password (at least 10 characters)
   - NODE_ENV = production
   - TRUST_PROXY = 1
   - DATA_DIR = /var/data
4. Add a Disk (mount path /var/data). Without a disk, bookings are erased on every restart.
5. Open the URL Render gives you. HTTPS is automatic.

Other hosts work too (Railway, Fly.io, any VPS): run `node server.js` with the same variables and keep DATA_DIR on persistent storage.

## Settings
- Opening hours: 09:00-19:00 every 30 minutes, closed Sundays (`OPEN` in server.js and `validDate`).
- SHOP_TZ: time zone for "today" (default Europe/Athens).
- Work photos: edit the `WORKS` list in public/index.html.
