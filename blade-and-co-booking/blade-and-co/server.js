'use strict';
// Blade & Co. booking server. No dependencies: run with `node server.js`.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const TZ = process.env.SHOP_TZ || 'Europe/Athens';
const EMAIL = (process.env.BARBER_EMAIL || '').trim().toLowerCase();
const PASS = process.env.BARBER_PASSWORD || '';
const PROD = process.env.NODE_ENV === 'production';
const PROXY = process.env.TRUST_PROXY === '1';
// SMS reminders (Twilio). Leave the TWILIO_* variables empty to switch reminders off.
const SID = process.env.TWILIO_ACCOUNT_SID || '', TOKEN = process.env.TWILIO_AUTH_TOKEN || '', FROM = process.env.TWILIO_FROM || '';
const DRY = process.env.SMS_DRY_RUN === '1';
const CC = (process.env.DEFAULT_COUNTRY_CODE || '30').replace(/\D/g, '');
const SHOP = process.env.SHOP_NAME || 'Blade & Co.';
const SMS_ON = DRY || !!(SID && TOKEN && FROM);
if (!EMAIL || PASS.length < 10) {
  console.error('Set BARBER_EMAIL and BARBER_PASSWORD (at least 10 characters) before starting.');
  process.exit(1);
}

fs.mkdirSync(DIR, { recursive: true });
const FILE = path.join(DIR, 'bookings.json');
let DB = [];
try { DB = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) {}
// Blocked time set by the barber: { date, all: true } or { date, times: [...] }
const BFILE = path.join(DIR, 'blocks.json');
let BLK = [];
try { BLK = JSON.parse(fs.readFileSync(BFILE, 'utf8')); } catch (e) {}
const saveBlk = () => { fs.writeFileSync(BFILE + '.tmp', JSON.stringify(BLK)); fs.renameSync(BFILE + '.tmp', BFILE); };
const save = () => { fs.writeFileSync(FILE + '.tmp', JSON.stringify(DB)); fs.renameSync(FILE + '.tmp', FILE); };

const OPEN = [];
for (let h = 9; h <= 19; h++) { OPEN.push(h + ':00'); if (h < 19) OPEN.push(h + ':30'); }

const sha = s => crypto.createHash('sha256').update(s).digest();
const same = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const nowMin = () => { const [h, m] = new Date().toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).split(':'); return +h * 60 + +m; };
// Times that cannot be booked on a date: existing bookings plus anything the barber blocked.
const takenOn = d => {
  const t = DB.filter(b => b.date === d).map(b => b.time), k = BLK.find(x => x.date === d);
  return k ? [...new Set([...t, ...(k.all ? OPEN : k.times)])] : t;
};
// A client is identified by mobile number (last 10 digits, so +30 and local formats match).
const key10 = s => String(s).replace(/\D/g, '').slice(-10);
const upcoming = b => { const [h, m] = b.time.split(':').map(Number); return b.date > today() || (b.date === today() && h * 60 + m > nowMin()); };

// Sessions and rate limits live in memory.
const SESS = new Map(), HITS = new Map();
const tooMany = (k, max, ms) => {
  const t = Date.now(); let h = HITS.get(k);
  if (!h || h.r < t) { h = { n: 0, r: t + ms }; HITS.set(k, h); }
  return ++h.n > max;
};
setInterval(() => {
  const t = Date.now();
  for (const [k, h] of HITS) if (h.r < t) HITS.delete(k);
  for (const [k, e] of SESS) if (e < t) SESS.delete(k);
}, 60000).unref();

const ip = req => (PROXY && (req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress;
const cookie = (req, n) => ((req.headers.cookie || '').split(';').map(s => s.trim().split('=')).find(p => p[0] === n) || [])[1];
const authed = req => (SESS.get(cookie(req, 'sid')) || 0) > Date.now();
const send = (res, code, obj, h = {}) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...h });
  res.end(JSON.stringify(obj));
};
const readBody = req => new Promise((ok, no) => {
  let s = '';
  req.on('data', c => { s += c; if (s.length > 10000) { no(new Error('too big')); req.destroy(); } });
  req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch (e) { no(e); } });
});

function validDate(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || isNaN(new Date(d + 'T12:00:00Z'))) return 'Invalid date.';
  if (d < today()) return 'That date has passed.';
  if (new Date(d + 'T12:00:00Z').getUTCDay() === 0) return 'We are closed on Sundays.';
  return '';
}

async function api(req, res, url) {
  const route = req.method + ' ' + url.pathname;
  if (req.method !== 'GET' && !(req.headers['content-type'] || '').includes('application/json'))
    return send(res, 415, { error: 'Unsupported request.' });

  if (route === 'GET /api/slots') {
    const d = url.searchParams.get('date') || '';
    const bad = validDate(d);
    return bad ? send(res, 400, { error: bad }) : send(res, 200, { taken: takenOn(d) });
  }

  if (route === 'GET /api/mine') {
    if (tooMany('mine' + ip(req), 120, 3600e3)) return send(res, 429, { error: 'Too many requests.' });
    const t = url.searchParams.get('token') || '';
    const b = t.length === 32 ? DB.find(x => x.token === t && upcoming(x)) : null;
    return send(res, 200, b ? { active: true, booking: { fn: b.fn, ln: b.ln, date: b.date, time: b.time } } : { active: false });
  }

  if (route === 'POST /api/bookings') {
    if (tooMany('book' + ip(req), 20, 3600e3)) return send(res, 429, { error: 'Too many bookings. Try again later.' });
    const b = await readBody(req);
    const fn = String(b.fn || '').trim(), ln = String(b.ln || '').trim(), ph = String(b.ph || '').trim();
    const date = String(b.date || ''), time = String(b.time || '');
    if (!fn || fn.length > 60 || !ln || ln.length > 60) return send(res, 400, { error: 'Enter your name and surname.' });
    if (!/^[+\d][\d\s()-]{7,24}$/.test(ph) || ph.replace(/\D/g, '').length < 8) return send(res, 400, { error: 'Enter a valid mobile number.' });
    const bad = validDate(date);
    if (bad) return send(res, 400, { error: bad });
    if (!OPEN.includes(time)) return send(res, 400, { error: 'Invalid time.' });
    const [h, m] = time.split(':').map(Number);
    if (date === today() && h * 60 + m <= nowMin()) return send(res, 400, { error: 'That time has passed.' });
    if (DB.some(x => upcoming(x) && key10(x.ph) === key10(ph)))
      return send(res, 403, { error: 'This number already has an upcoming booking. You can book again once it is done, or if the barbershop cancels it.', code: 'already_booked' });
    if (takenOn(date).includes(time)) return send(res, 409, { error: 'That time was just taken.', taken: takenOn(date) });
    const token = crypto.randomBytes(16).toString('hex');
    const bk = { id: crypto.randomUUID(), token, fn, ln, ph, date, time, at: Date.now() };
    if (minsUntil(bk) <= 60) bk.reminded = 'skipped'; // booked less than an hour ahead: no reminder
    DB.push(bk);
    save();
    return send(res, 201, { ok: true, token });
  }

  if (route === 'GET /api/closed') {
    const t = today();
    return send(res, 200, { dates: BLK.filter(b => b.all && b.date >= t).map(b => b.date) });
  }

  if (route === 'GET /api/blocks') {
    if (!authed(req)) return send(res, 401, { error: 'Sign in required.' });
    const t = today();
    return send(res, 200, { blocks: BLK.filter(b => b.date >= t).sort((a, b) => a.date.localeCompare(b.date)) });
  }

  if (route === 'PUT /api/blocks') {
    if (!authed(req)) return send(res, 401, { error: 'Sign in required.' });
    const b = await readBody(req);
    const date = String(b.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date + 'T12:00:00Z'))) return send(res, 400, { error: 'Invalid date.' });
    if (date < today()) return send(res, 400, { error: 'That date has passed.' });
    const times = Array.isArray(b.times) ? [...new Set(b.times.map(String).filter(t => OPEN.includes(t)))] : [];
    const all = b.all === true || times.length === OPEN.length;
    BLK = BLK.filter(x => x.date !== date && x.date >= today());
    if (all || times.length) BLK.push(all ? { date, all: true } : { date, times: OPEN.filter(t => times.includes(t)) });
    saveBlk();
    const closed = all ? OPEN : times;
    return send(res, 200, { ok: true, conflicts: DB.filter(x => x.date === date && closed.includes(x.time)).length });
  }

  if (route === 'POST /api/login') {
    if (tooMany('login' + ip(req), 10, 15 * 60e3)) return send(res, 429, { error: 'Too many attempts.' });
    const b = await readBody(req);
    const okMail = same(String(b.email || '').trim().toLowerCase(), EMAIL);
    const okPass = same(String(b.password || ''), PASS);
    if (!(okMail && okPass)) return send(res, 401, { error: 'Wrong email or password.' });
    const sid = crypto.randomBytes(32).toString('hex');
    SESS.set(sid, Date.now() + 12 * 3600e3);
    return send(res, 200, { ok: true }, { 'Set-Cookie': `sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${PROD ? '; Secure' : ''}` });
  }

  if (route === 'POST /api/logout') {
    SESS.delete(cookie(req, 'sid'));
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }

  if (route === 'GET /api/bookings') {
    if (!authed(req)) return send(res, 401, { error: 'Sign in required.' });
    const t = today();
    const list = DB.filter(b => b.date >= t).sort((a, b) => (a.date + a.time.padStart(5, '0')).localeCompare(b.date + b.time.padStart(5, '0')));
    return send(res, 200, { bookings: list.map(({ token, ...b }) => b) });
  }

  const del = url.pathname.match(/^\/api\/bookings\/([\w-]+)$/);
  if (req.method === 'DELETE' && del) {
    if (!authed(req)) return send(res, 401, { error: 'Sign in required.' });
    DB = DB.filter(b => b.id !== del[1]);
    save();
    return send(res, 200, { ok: true });
  }

  send(res, 404, { error: 'Not found.' });
}

// ---- SMS reminders: sent once, about 1 hour before the appointment ----
function e164(raw) {
  const d = String(raw).replace(/\D/g, '');
  if (/^\s*\+/.test(raw)) return '+' + d;
  if (d.startsWith('00')) return '+' + d.slice(2);
  return '+' + CC + d.replace(/^0+/, '');
}
async function sendSms(to, text) {
  if (DRY) { console.log('[SMS dry run] to', to, ':', text); return; }
  const p = new URLSearchParams({ To: to, Body: text });
  p.set(/^MG/.test(FROM) ? 'MessagingServiceSid' : 'From', FROM);
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(SID + ':' + TOKEN).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: p,
  });
  if (!r.ok) throw new Error('Twilio ' + r.status + ' ' + (await r.text()).slice(0, 200));
}
function minsUntil(b) {
  const [h, m] = b.time.split(':').map(Number);
  const days = Math.round((Date.parse(b.date + 'T00:00:00Z') - Date.parse(today() + 'T00:00:00Z')) / 864e5);
  return days * 1440 + h * 60 + m - nowMin();
}
let reminding = false;
async function remind() {
  if (reminding || !SMS_ON) return;
  reminding = true;
  try {
    for (const b of DB) {
      if (b.reminded) continue;
      const u = minsUntil(b);
      if (u <= 0) { b.reminded = 'skipped'; save(); continue; }   // appointment already started
      if (u > 60) continue;
      if ((b.tries || 0) >= 3) { b.reminded = 'failed'; save(); continue; }
      try {
        await sendSms(e164(b.ph), `${SHOP}: reminder, your cut is today at ${b.time.padStart(5, '0')}. See you soon!`);
        b.reminded = 'sent';
      } catch (e) { b.tries = (b.tries || 0) + 1; console.error('SMS failed:', e.message); }
      save();
    }
  } finally { reminding = false; }
}

const SEC = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
};
if (PROD) SEC['Strict-Transport-Security'] = 'max-age=31536000';

http.createServer(async (req, res) => {
  for (const k in SEC) res.setHeader(k, SEC[k]);
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(path.join(__dirname, 'public', 'index.html')));
    }
    res.writeHead(404); res.end('Not found');
  } catch (e) {
    if (!res.headersSent) send(res, 400, { error: 'Bad request.' }); else res.end();
  }
}).listen(PORT, () => {
  console.log('Blade & Co. running on port ' + PORT);
  console.log(SMS_ON ? 'SMS reminders are ON' : 'SMS reminders are OFF (set the TWILIO_* variables to turn them on)');
  if (SMS_ON) { setInterval(remind, 60000); setTimeout(remind, 5000); }
});
