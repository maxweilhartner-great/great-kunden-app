// Instagram-Reels über die offizielle „Instagram API mit Instagram-Login“.
// Eigene Zugangsdaten (Instagram-App-ID/-Geheimcode aus dem Meta-Anwendungsfall
// „Messaging und Content auf Instagram verwalten“ → „API-Einrichtung mit Instagram-Login“).
// Das Token gilt 60 Tage und wird vor jedem Posten automatisch verlängert.
const config = require('../config');
const { request, sleep, readFile, fileSize } = require('./http');

const IG = (p) => `https://graph.instagram.com/${config.META_GRAPH_VERSION}/${p}`;
const SCOPES = ['instagram_business_basic', 'instagram_business_content_publish'];
const DAY = 86_400_000;

async function refresh(account) {
  // Erst ab 24 h Alter verlängerbar; ab 10 Tagen Restlaufzeit gar nicht nötig.
  if (!account.expiresAt || account.expiresAt - Date.now() > 10 * DAY) return account;
  if (Date.now() - (account.issuedAt || 0) < DAY) return account;
  const tok = await request(`https://graph.instagram.com/refresh_access_token?${new URLSearchParams({
    grant_type: 'ig_refresh_token', access_token: account.token,
  })}`);
  return { ...account, token: tok.access_token, issuedAt: Date.now(), expiresAt: Date.now() + tok.expires_in * 1000 };
}

module.exports = {
  id: 'instagram',
  name: 'Instagram',
  configured: () => Boolean(config.INSTAGRAM_APP_ID && config.INSTAGRAM_APP_SECRET),
  requiredEnv: ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET'],
  authUrl(state, redirectUri) {
    const q = new URLSearchParams({
      client_id: config.INSTAGRAM_APP_ID, redirect_uri: redirectUri, response_type: 'code',
      scope: SCOPES.join(','), state,
    });
    return `https://www.instagram.com/oauth/authorize?${q}`;
  },
  async handleCallback(code, redirectUri) {
    const short = await request('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      form: {
        client_id: config.INSTAGRAM_APP_ID, client_secret: config.INSTAGRAM_APP_SECRET,
        grant_type: 'authorization_code', redirect_uri: redirectUri, code: String(code).replace(/#_$/, ''),
      },
    });
    const long = await request(`https://graph.instagram.com/access_token?${new URLSearchParams({
      grant_type: 'ig_exchange_token', client_secret: config.INSTAGRAM_APP_SECRET, access_token: short.access_token,
    })}`);
    const me = await request(IG(`me?fields=user_id,username&access_token=${encodeURIComponent(long.access_token)}`));
    return {
      displayName: `@${me.username}`,
      igId: me.user_id || me.id || short.user_id,
      token: long.access_token,
      refreshToken: 'ig', // markiert das Konto für die automatische Verlängerung (jobs.js)
      issuedAt: Date.now(),
      expiresAt: Date.now() + (long.expires_in || 60 * 86400) * 1000,
    };
  },
  refresh,
  // Reel: Container anlegen → Datei direkt hochladen → warten bis verarbeitet → veröffentlichen
  async publish(account, { file, texts }) {
    const container = await request(IG(`${account.igId}/media`), {
      method: 'POST',
      form: {
        media_type: 'REELS', upload_type: 'resumable', caption: texts.instagram.caption,
        share_to_feed: 'true', access_token: account.token,
      },
    });
    await request(`https://rupload.facebook.com/ig-api-upload/${config.META_GRAPH_VERSION}/${container.id}`, {
      method: 'POST',
      headers: { Authorization: `OAuth ${account.token}`, offset: '0', file_size: String(fileSize(file)) },
      body: readFile(file),
    });
    for (let i = 0; i < 60; i++) {
      const s = await request(IG(`${container.id}?fields=status_code,status&access_token=${encodeURIComponent(account.token)}`));
      if (s.status_code === 'FINISHED') break;
      if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error(`Instagram-Verarbeitung fehlgeschlagen: ${s.status || s.status_code}`);
      if (i === 59) throw new Error('Instagram verarbeitet das Video zu lange – bitte später erneut versuchen.');
      await sleep(5000);
    }
    const pub = await request(IG(`${account.igId}/media_publish`), {
      method: 'POST', form: { creation_id: container.id, access_token: account.token },
    });
    let url = null;
    try {
      url = (await request(IG(`${pub.id}?fields=permalink&access_token=${encodeURIComponent(account.token)}`))).permalink;
    } catch { /* Link ist nur Komfort */ }
    return { id: pub.id, url };
  },
};
