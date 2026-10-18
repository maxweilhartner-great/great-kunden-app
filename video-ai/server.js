// GR·EAT Video AI – Webserver: Upload, Freigabe-Liste, Konto-Verknüpfung, Veröffentlichung.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

const config = require('./src/config');
const store = require('./src/store');
const jobs = require('./src/jobs');
const { generateTexts, CATEGORIES } = require('./src/captions');
const { listMusic } = require('./src/pipeline');
const { PLATFORMS, PLATFORM_IDS } = require('./src/platforms');

const app = express();
app.use(express.json({ limit: '2mb' }));

// ---------- Anmeldung: Team (hochladen) und Admin (freigeben, Konten) ----------

const AUTH_ENABLED = Boolean(config.TEAM_PASSWORD || config.ADMIN_PASSWORD);
const sign = (role) => `${role}.${crypto.createHmac('sha256', config.SESSION_SECRET).update(role).digest('hex').slice(0, 32)}`;

function roleOf(req) {
  if (!AUTH_ENABLED) return 'admin';
  const cookie = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith('gva='));
  const value = cookie && decodeURIComponent(cookie.slice(4));
  return ['admin', 'team'].find((r) => value === sign(r)) || null;
}

const requireRole = (role) => (req, res, next) => {
  const r = roleOf(req);
  if (r === 'admin' || (role === 'team' && r === 'team')) return next();
  res.status(r ? 403 : 401).json({ error: r ? 'Dafür sind Admin-Rechte nötig.' : 'Bitte anmelden.' });
};

const safeEqual = (a, b) => a && b && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

app.get('/api/session', (req, res) => {
  res.json({ role: roleOf(req), authEnabled: AUTH_ENABLED });
});

app.post('/api/login', (req, res) => {
  const pw = String(req.body.password || '');
  const role = safeEqual(pw, config.ADMIN_PASSWORD) ? 'admin' : safeEqual(pw, config.TEAM_PASSWORD) ? 'team' : null;
  if (!role) return res.status(401).json({ error: 'Passwort stimmt nicht.' });
  const secure = config.PUBLIC_BASE_URL.startsWith('https') ? '; Secure' : '';
  res.setHeader('Set-Cookie', `gva=${encodeURIComponent(sign(role))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 90}${secure}`);
  res.json({ role });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'gva=; Path=/; Max-Age=0');
  res.json({ ok: true });
});

// ---------- Hochladen ----------

// Art der Datei: MIME-Typ oder (falls der Browser keinen schickt) Dateiendung
const isVideo = (f) => f.mimetype.startsWith('video/') || /\.(mp4|mov|m4v|3gp|webm|mkv|avi)$/i.test(f.originalname);
const isImage = (f) => f.mimetype.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.originalname);

const upload = multer({
  storage: multer.diskStorage({
    destination: config.UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${store.newId()}${path.extname(file.originalname).toLowerCase() || ''}`),
  }),
  limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => cb(null, isVideo(file) || isImage(file)),
});

const cleanPlatforms = (list) => [].concat(list || []).filter((p) => PLATFORM_IDS.includes(p));

app.post('/api/uploads', requireRole('team'), upload.array('files', 20), (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'Bitte mindestens ein Video oder Foto auswählen.' });

  const base = {
    uploader: String(req.body.uploader || '').slice(0, 80),
    category: CATEGORIES[req.body.category] ? req.body.category : 'sonstiges',
    note: String(req.body.note || '').slice(0, 1000),
    location: String(req.body.location || '').slice(0, 120),
    hook: String(req.body.hook || '').slice(0, 80),
    platforms: cleanPlatforms(req.body.platforms),
  };
  if (!base.platforms.length) base.platforms = [...PLATFORM_IDS];

  const asFile = (f) => ({ original: f.originalname, stored: f.filename, size: f.size });
  const videos = files.filter(isVideo);
  const photos = files.filter((f) => !isVideo(f));
  const groups = [
    ...videos.map((f) => ({ kind: 'video', files: [asFile(f)] })),
    ...(photos.length ? [{ kind: 'photos', files: photos.map(asFile) }] : []),
  ];

  const ids = groups.map((g) => {
    const item = store.addItem({
      id: store.newId(),
      createdAt: new Date().toISOString(),
      ...base,
      ...g,
      status: 'processing',
      texts: null,
      feedback: [],
      publishResults: {},
    });
    jobs.enqueueRender(item.id);
    return item.id;
  });
  res.status(201).json({ ids });
});

// ---------- Freigabe-Liste ----------

const publicItem = (item) => item && {
  ...item,
  videoUrl: item.output ? `/media/${item.output}?v=${item.version || 0}` : null,
  thumbUrl: item.thumb ? `/media/${item.thumb}?v=${item.version || 0}` : null,
};

app.get('/api/items', requireRole('team'), (req, res) => {
  res.json({ items: store.listItems().map(publicItem) });
});

app.get('/api/items/:id', requireRole('team'), (req, res) => {
  const item = store.getItem(req.params.id);
  if (!item) return res.status(404).json({ error: 'Nicht gefunden.' });
  res.json({ item: publicItem(item) });
});

function loadItem(req, res, next) {
  req.item = store.getItem(req.params.id);
  if (!req.item) return res.status(404).json({ error: 'Nicht gefunden.' });
  next();
}

// Texte/Plattformauswahl übernehmen, die im Freigabe-Formular bearbeitet wurden.
function applyEdits(item, body) {
  const patch = {};
  if (body.texts) {
    patch.texts = { ...item.texts };
    for (const pid of PLATFORM_IDS) {
      if (body.texts[pid]) patch.texts[pid] = { ...item.texts?.[pid], ...body.texts[pid] };
    }
  }
  if (body.platforms) patch.platforms = cleanPlatforms(body.platforms);
  return store.updateItem(item.id, patch);
}

app.patch('/api/items/:id', requireRole('admin'), loadItem, (req, res) => {
  res.json({ item: publicItem(applyEdits(req.item, req.body)) });
});

app.post('/api/items/:id/regenerate-texts', requireRole('admin'), loadItem, (req, res) => {
  const it = req.item;
  const fresh = generateTexts({ category: it.category, note: it.note, location: it.location, transcript: it.transcript });
  const only = req.body.platform;
  const texts = only && PLATFORM_IDS.includes(only) ? { ...it.texts, [only]: fresh[only] } : fresh;
  res.json({ item: publicItem(store.updateItem(it.id, { texts })) });
});

// Der eine Knopf: Freigeben → sofort auf allen gewählten Plattformen posten.
app.post('/api/items/:id/approve', requireRole('admin'), loadItem, (req, res) => {
  if (!['review', 'changes_requested'].includes(req.item.status)) {
    return res.status(409).json({ error: 'Dieser Beitrag wartet gerade nicht auf Freigabe.' });
  }
  const item = applyEdits(req.item, req.body);
  if (!item.platforms.length) return res.status(400).json({ error: 'Bitte mindestens eine Plattform auswählen.' });
  store.updateItem(item.id, {
    status: 'approved', approvedAt: new Date().toISOString(), approvedBy: String(req.body.by || '').slice(0, 80), publishResults: {},
  });
  jobs.publishItem(item.id).catch((err) => console.error(err));
  res.json({ item: publicItem(store.getItem(item.id)) });
});

// Änderungen verlangen: Kommentar + optional direkte Korrekturen am Video (lösen Neu-Schnitt aus).
app.post('/api/items/:id/request-changes', requireRole('admin'), loadItem, (req, res) => {
  const item = applyEdits(req.item, req.body);
  const note = String(req.body.note || '').trim().slice(0, 2000);
  const edit = req.body.edit || null;
  const feedback = [...(item.feedback || [])];
  if (note || edit) feedback.push({ at: new Date().toISOString(), by: String(req.body.by || '').slice(0, 80), note, edit });

  if (edit && Object.keys(edit).length) {
    const patch = { feedback, edit: { ...item.edit, ...sanitizeEdit(edit) } };
    if (Array.isArray(edit.segments) && item.transcript) {
      patch.transcript = { ...item.transcript, segments: sanitizeSegments(edit.segments), edited: true };
    }
    store.updateItem(item.id, patch);
    jobs.enqueueRender(item.id);
  } else {
    store.updateItem(item.id, { feedback, status: 'changes_requested' });
  }
  res.json({ item: publicItem(store.getItem(item.id)) });
});

function sanitizeEdit(e) {
  const out = {};
  if ('hook' in e) out.hook = String(e.hook || '').slice(0, 80);
  if (e.start !== undefined && e.start !== '') out.start = Math.max(0, Number(e.start) || 0);
  if (e.length) out.length = Math.min(config.MAX_SECONDS, Math.max(config.MIN_SECONDS, Number(e.length)));
  if ('music' in e) out.music = String(e.music || '');
  if ('subtitles' in e) out.subtitles = Boolean(e.subtitles);
  return out;
}

const sanitizeSegments = (segs) => segs
  .filter((s) => Number.isFinite(Number(s.start)) && Number.isFinite(Number(s.end)))
  .map((s) => ({ start: Number(s.start), end: Number(s.end), text: String(s.text || '').slice(0, 300) }))
  .filter((s) => s.text.trim());

app.post('/api/items/:id/resubmit', requireRole('admin'), loadItem, (req, res) => {
  const item = applyEdits(req.item, req.body);
  res.json({ item: publicItem(store.updateItem(item.id, { status: 'review' })) });
});

app.post('/api/items/:id/rerender', requireRole('admin'), loadItem, (req, res) => {
  jobs.enqueueRender(req.item.id);
  res.json({ item: publicItem(store.getItem(req.item.id)) });
});

app.post('/api/items/:id/retry-publish', requireRole('admin'), loadItem, (req, res) => {
  const failed = req.item.platforms.filter((p) => req.item.publishResults?.[p]?.status !== 'ok');
  if (!failed.length) return res.status(409).json({ error: 'Es gibt nichts erneut zu posten.' });
  jobs.publishItem(req.item.id, failed).catch((err) => console.error(err));
  res.json({ item: publicItem(store.getItem(req.item.id)) });
});

app.delete('/api/items/:id', requireRole('admin'), loadItem, (req, res) => {
  const it = req.item;
  for (const f of it.files || []) fs.rmSync(path.join(config.UPLOAD_DIR, f.stored), { force: true });
  for (const f of [it.output, it.thumb].filter(Boolean)) fs.rmSync(path.join(config.RENDER_DIR, f), { force: true });
  store.deleteItem(it.id);
  res.json({ ok: true });
});

app.get('/api/meta', requireRole('team'), (req, res) => {
  res.json({
    categories: Object.fromEntries(Object.entries(CATEGORIES).map(([k, v]) => [k, `${v.emoji} ${v.label}`])),
    platforms: PLATFORM_IDS.map((id) => ({ id, name: PLATFORMS[id].name, connected: Boolean(store.getAccount(id)) })),
    music: listMusic(),
    limits: { min: config.MIN_SECONDS, max: config.MAX_SECONDS, maxUploadMb: config.MAX_UPLOAD_MB },
  });
});

app.use('/media', requireRole('team'), express.static(config.RENDER_DIR, { maxAge: '1h' }));

// ---------- Konto-Verknüpfung (OAuth) ----------

// Facebook nutzt den Facebook Login (Callback /auth/meta/…), Instagram den eigenen Instagram-Login.
const oauthKey = (pid) => (pid === 'facebook' ? 'meta' : pid);
const redirectUri = (pid) => `${config.PUBLIC_BASE_URL}/auth/${oauthKey(pid)}/callback`;
const pendingStates = new Map();

const publicAccount = (acc) => acc && {
  displayName: acc.displayName, pages: acc.pages, pageId: acc.pageId, updatedAt: acc.updatedAt, expiresAt: acc.expiresAt || null,
};

app.get('/api/accounts', requireRole('admin'), (req, res) => {
  res.json({
    publicBaseUrl: config.PUBLIC_BASE_URL,
    platforms: PLATFORM_IDS.map((id) => ({
      id,
      name: PLATFORMS[id].name,
      configured: PLATFORMS[id].configured(),
      requiredEnv: PLATFORMS[id].requiredEnv,
      redirectUri: redirectUri(id),
      account: publicAccount(store.getAccount(id)),
    })),
  });
});

app.get('/auth/:platform/start', requireRole('admin'), (req, res) => {
  const platform = PLATFORMS[req.params.platform];
  if (!platform) return res.status(404).send('Unbekannte Plattform');
  if (!platform.configured()) return res.redirect(`/#konten?fehler=${encodeURIComponent(`${platform.name}: Zugangsdaten fehlen in der .env`)}`);
  const state = crypto.randomBytes(16).toString('hex');
  pendingStates.set(state, { platform: platform.id, expires: Date.now() + 15 * 60_000 });
  res.redirect(platform.authUrl(state, redirectUri(platform.id)));
});

app.get('/auth/:key/callback', requireRole('admin'), async (req, res) => {
  const { state, code, error, error_description: errorDescription } = req.query;
  const pending = pendingStates.get(state);
  pendingStates.delete(state);
  const back = (msg, ok) => res.redirect(`/#konten?${ok ? 'ok' : 'fehler'}=${encodeURIComponent(msg)}`);
  if (!pending || pending.expires < Date.now() || oauthKey(pending.platform) !== req.params.key) {
    return back('Anmeldung abgelaufen oder ungültig – bitte erneut verbinden.');
  }
  if (error || !code) return back(`Verknüpfung abgebrochen: ${errorDescription || error || 'kein Code erhalten'}`);
  const platform = PLATFORMS[pending.platform];
  try {
    if (oauthKey(platform.id) === 'meta') {
      const pages = await platform.exchangeCode(code, redirectUri(platform.id));
      if (!pages.length) return back('Keine Facebook-Seite gefunden – das Konto muss Admin einer Seite sein.');
      const preferred = pages.find((pg) => pg.pageId === store.getAccount('facebook')?.pageId) || pages[0];
      store.setAccount('facebook', { ...platform.accountFromPage(preferred, pages), allPages: pages });
      return back(`Facebook verknüpft (Seite ${preferred.pageName}).`, true);
    }
    store.setAccount(platform.id, await platform.handleCallback(code, redirectUri(platform.id)));
    back(`${platform.name} verknüpft.`, true);
  } catch (err) {
    console.error(`[oauth ${platform.id}]`, err);
    back(`${platform.name}: ${err.message}`);
  }
});

// Bei mehreren Facebook-Seiten: die richtige auswählen.
app.post('/api/accounts/:platform/page', requireRole('admin'), (req, res) => {
  const platform = PLATFORMS[req.params.platform];
  const acc = store.getAccount(req.params.platform);
  if (!platform?.accountFromPage || !acc) return res.status(404).json({ error: 'Nicht verknüpft.' });
  const page = acc.allPages.find((p) => p.pageId === req.body.pageId);
  const account = platform.accountFromPage(page, acc.allPages);
  if (!account) return res.status(400).json({ error: 'Diese Seite passt nicht (kein Instagram-Konto verbunden?).' });
  store.setAccount(platform.id, { ...account, allPages: acc.allPages });
  res.json({ ok: true });
});

app.delete('/api/accounts/:platform', requireRole('admin'), (req, res) => {
  store.setAccount(req.params.platform, null);
  res.json({ ok: true });
});

// ---------- Oberfläche ----------

app.use(express.static(path.join(__dirname, 'public')));
app.use('/brand', express.static(config.BRAND_DIR));

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? `Datei zu groß (max. ${config.MAX_UPLOAD_MB} MB).` : err.message;
    return res.status(400).json({ error: msg });
  }
  console.error(err);
  res.status(500).json({ error: 'Interner Fehler' });
});

if (require.main === module) {
  app.listen(config.PORT, () => {
    console.log(`GR·EAT Video AI läuft auf ${config.PUBLIC_BASE_URL} (Port ${config.PORT})`);
    if (!AUTH_ENABLED) console.warn('⚠  Keine Passwörter gesetzt (TEAM_PASSWORD/ADMIN_PASSWORD) – nur für lokale Tests geeignet!');
    jobs.resume();
  });
}

module.exports = app;
