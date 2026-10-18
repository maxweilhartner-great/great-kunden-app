// Facebook-Seite über die offizielle Meta Graph API (Facebook Login).
// Die Verknüpfung speichert das Seiten-Token (aus einem Langzeit-Nutzertoken abgeleitet → läuft nicht ab).
// Instagram läuft getrennt über den Instagram-Login (instagram.js) – neue Meta-Apps erlauben
// instagram_basic/instagram_content_publish im Facebook Login nicht mehr („Invalid Scopes“).
const config = require('../config');
const { request, sleep, readFile, fileSize } = require('./http');

const graph = (p) => `https://graph.facebook.com/${config.META_GRAPH_VERSION}/${p}`;
const rupload = (p) => `https://rupload.facebook.com/${p}`;

const SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'business_management',
];

const shared = {
  configured: () => Boolean(config.META_APP_ID && config.META_APP_SECRET),
  requiredEnv: ['META_APP_ID', 'META_APP_SECRET'],
  authUrl(state, redirectUri) {
    const q = new URLSearchParams({ client_id: config.META_APP_ID, redirect_uri: redirectUri, state, response_type: 'code' });
    // Facebook Login for Business arbeitet mit einer „Konfiguration“ statt einer Rechte-Liste.
    if (config.META_CONFIG_ID) q.set('config_id', config.META_CONFIG_ID);
    else q.set('scope', SCOPES.join(','));
    return `https://www.facebook.com/${config.META_GRAPH_VERSION}/dialog/oauth?${q}`;
  },
  // Liefert alle Facebook-Seiten, die das Konto verwaltet.
  async exchangeCode(code, redirectUri) {
    const short = await request(graph(`oauth/access_token?${new URLSearchParams({
      client_id: config.META_APP_ID, client_secret: config.META_APP_SECRET, redirect_uri: redirectUri, code,
    })}`));
    const long = await request(graph(`oauth/access_token?${new URLSearchParams({
      grant_type: 'fb_exchange_token', client_id: config.META_APP_ID, client_secret: config.META_APP_SECRET,
      fb_exchange_token: short.access_token,
    })}`));
    const pages = await request(graph(`me/accounts?${new URLSearchParams({
      fields: 'id,name,access_token', access_token: long.access_token, limit: '100',
    })}`));
    return (pages.data || []).map((p) => ({
      pageId: p.id,
      pageName: p.name,
      pageToken: p.access_token,
    }));
  },
};

const facebook = {
  id: 'facebook',
  name: 'Facebook',
  ...shared,
  accountFromPage: (page, pages) => page && {
    displayName: page.pageName, pageId: page.pageId, token: page.pageToken, pages: pages.map(({ pageId, pageName }) => ({ pageId, pageName })),
  },
  // Facebook-Reel: start → Binär-Upload → finish (veröffentlichen)
  async publish(account, { file, texts }) {
    const start = await request(graph(`${account.pageId}/video_reels`), {
      method: 'POST', form: { upload_phase: 'start', access_token: account.token },
    });
    await request(start.upload_url || rupload(`video-upload/${config.META_GRAPH_VERSION}/${start.video_id}`), {
      method: 'POST',
      headers: { Authorization: `OAuth ${account.token}`, offset: '0', file_size: String(fileSize(file)) },
      body: readFile(file),
    });
    await request(graph(`${account.pageId}/video_reels`), {
      method: 'POST',
      form: {
        upload_phase: 'finish', video_id: start.video_id, video_state: 'PUBLISHED',
        description: texts.facebook.caption, access_token: account.token,
      },
    });
    return { id: start.video_id, url: `https://www.facebook.com/reel/${start.video_id}` };
  },
};

module.exports = { facebook };
