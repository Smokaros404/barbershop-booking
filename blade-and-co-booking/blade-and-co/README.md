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

## SMS reminders (1 hour before)
The server texts each client once, about an hour before their cut. It uses Twilio (twilio.com).
Reminders are skipped for bookings made less than an hour ahead, and nothing is sent after the appointment has started.

1. Create a Twilio account and get a sender (a Twilio phone number, or a Messaging Service). Check Twilio's rules for sending to Greece.
2. In Render > Environment add:
   - TWILIO_ACCOUNT_SID = your Account SID
   - TWILIO_AUTH_TOKEN = your Auth Token
   - TWILIO_FROM = the sender phone number (+1...), or a Messaging Service SID starting with MG
   - DEFAULT_COUNTRY_CODE = 30 (used when a client types a number without +, default is 30)
   - SHOP_NAME = the name shown in the text (default "Blade & Co.")
3. Redeploy. The logs should say "SMS reminders are ON".

IMPORTANT: the server must be awake at the time of the reminder. Render's free plan puts the service to sleep when idle, so reminders will be missed. Use a paid (always-on) plan.

To test without sending real texts, set SMS_DRY_RUN=1: the text is printed in the logs instead.
