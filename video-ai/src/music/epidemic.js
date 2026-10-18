// Epidemic Sound (Partner Content API): Musik im ganzen Katalog suchen, vorhören und
// für die Reels übernehmen. Auth: API-Schlüssel als Bearer-Token, dazu eine feste
// Partner-Nutzer-ID für unsere App. Die Antwortfelder werden bewusst tolerant gelesen –
// /api/music/epidemic/diagnose zeigt die rohe Antwort, falls Epidemic etwas umbenennt.
const fs = require('fs');
const path = require('path');
const config = require('../config');

const base = () => config.EPIDEMIC_API_BASE.replace(/\/$/, '');
const headers = () => ({
  Authorization: `Bearer ${config.EPIDEMIC_API_KEY}`,
  'x-partner-user-id': config.EPIDEMIC_USER_ID,
  Accept: 'application/json',
});

async function call(p, { method = 'GET', json } = {}) {
  const res = await fetch(`${base()}${p}`, {
    method,
    headers: { ...headers(), ...(json ? { 'Content-Type': 'application/json' } : {}) },
    body: json ? JSON.stringify(json) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 500) }; }
  if (!res.ok) {
    const msg = data.message || data.error?.message || data.error || data.title || text.slice(0, 300);
    const err = new Error(`Epidemic Sound ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const first = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== '');
const names = (list) => (Array.isArray(list) ? list.map((x) => (typeof x === 'string' ? x : x?.name || x?.displayTag || x?.title)).filter(Boolean) : []);

function normalizeTrack(t) {
  const lenRaw = first(t.length, t.duration, t.durationMs, t.lengthMs);
  const seconds = lenRaw > 1000 ? Math.round(lenRaw / 1000) : Math.round(lenRaw || 0);
  const img = t.images || t.image || t.coverArt || {};
  return {
    id: String(first(t.id, t.trackId, t.uuid)),
    title: first(t.title, t.name, 'Ohne Titel'),
    artists: names(first(t.mainArtists, t.artists, t.creatives?.mainArtists, [])).join(', '),
    seconds,
    bpm: first(t.bpm, t.tempo, null),
    moods: names(first(t.moods, t.mood, [])).slice(0, 3),
    genres: names(first(t.genres, t.genre, [])).slice(0, 2),
    cover: typeof img === 'string' ? img : first(img.S, img.small, img.default, img.M, img.url, null),
    premium: Boolean(first(t.isPremium, t.premium, t.tier === 'premium', false)),
  };
}

module.exports = {
  configured: () => Boolean(config.EPIDEMIC_API_KEY),

  async search(term, { limit = 24, offset = 0 } = {}) {
    const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (term) q.set('term', term);
    const data = await call(`/v0/tracks/search?${q}`);
    const list = first(data.tracks, data.data, data.items, data.results, []);
    return { tracks: (Array.isArray(list) ? list : []).map(normalizeTrack), total: first(data.pagination?.total, data.total, null) };
  },

  async diagnose(term = 'happy') {
    return call(`/v0/tracks/search?${new URLSearchParams({ term, limit: '2' })}`);
  },

  // Vorhören: Stream (meist HLS) oder – falls nicht verfügbar – die MP3 in normaler Qualität.
  async preview(id) {
    try {
      const s = await call(`/v0/tracks/${encodeURIComponent(id)}/stream`);
      const url = first(s.url, s.streamUrl, s.hlsUrl, s.data?.url);
      if (url) return { url, hls: /\.m3u8(\?|$)/i.test(url) };
    } catch { /* weiter mit MP3 */ }
    const d = await call(`/v0/tracks/${encodeURIComponent(id)}/download?format=mp3&quality=normal`);
    return { url: first(d.url, d.downloadUrl, d.data?.url), hls: false };
  },

  // Übernehmen: MP3 in hoher Qualität laden und in den Musikordner legen.
  async importTrack(id) {
    const info = await call(`/v0/tracks/${encodeURIComponent(id)}/download?format=mp3&quality=high`);
    const url = first(info.url, info.downloadUrl, info.data?.url);
    if (!url) throw new Error('Epidemic Sound hat keine Download-Adresse geliefert.');
    const meta = await call(`/v0/tracks/${encodeURIComponent(id)}`).catch(() => ({}));
    const t = normalizeTrack(meta.track || meta.data || meta || { id });
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download fehlgeschlagen (HTTP ${res.status}).`);
    const clean = (s) => String(s || '').replace(/[^\w äöüÄÖÜß().,-]/g, '').trim().slice(0, 60);
    const file = `ES - ${clean(t.artists) || 'Epidemic'} - ${clean(t.title) || id}.mp3`;
    fs.mkdirSync(config.MUSIC_DIR, { recursive: true });
    fs.writeFileSync(path.join(config.MUSIC_DIR, file), Buffer.from(await res.arrayBuffer()));
    // Nutzung melden (Pflicht für Partner); Fehler hier blockieren den Import nicht.
    call('/v0/analytics/report', {
      method: 'POST',
      json: { events: [{ type: 'DOWNLOAD', trackId: id, timestamp: new Date().toISOString() }] },
    }).catch(() => {});
    return file;
  },
};
