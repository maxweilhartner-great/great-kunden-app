// Facebook-Seite + Instagram-Business-Konto über die offizielle Meta Graph API.
// Eine Meta-App deckt beide Plattformen ab; die Verknüpfung speichert das Seiten-Token
// (aus einem Langzeit-Nutzertoken abgeleitet → läuft nicht ab).
const config = require('../config');
const { request, sleep, readFile, fileSize } = require('./http');

const graph = (p) => `https://graph.facebook.com/${config.META_GRAPH_VERSION}/${p}`;
const rupload = (p) => `https://rupload.facebook.com/${p}`;

const SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'publish_video',
  'business_management',
  'instagram_basic',
  'instagram_content_publish',
];

const shared = {
  configured: () => Boolean(config.META_APP_ID && config.META_APP_SECRET),
  requiredEnv: ['META_APP_ID', 'META_APP_SECRET'],
  authUrl(state, redirectUri) {
    const q = new URLSearchParams({
      client_id: config.META_APP_ID, redirect_uri: redirectUri, state, scope: SCOPES.join(','), response_type: 'code',
    });
    return `https://www.facebook.com/${config.META_GRAPH_VERSION}/dialog/oauth?${q}`;
  },
  // Liefert alle Seiten inkl. verknüpftem Instagram-Konto; der Aufrufer speichert beide Plattformen.
  async exchangeCode(code, redirectUri) {
    const short = await request(graph(`oauth/access_token?${new URLSearchParams({
      client_id: config.META_APP_ID, client_secret: config.META_APP_SECRET, redirect_uri: redirectUri, code,
    })}`));
    const long = await request(graph(`oauth/access_token?${new URLSearchParams({
      grant_type: 'fb_exchange_token', client_id: config.META_APP_ID, client_secret: config.META_APP_SECRET,
      fb_exchange_token: short.access_token,
    })}`));
    const pages = await request(graph(`me/accounts?${new URLSearchParams({
      fields: 'id,name,access_token,instagram_business_account{id,username}', access_token: long.access_token, limit: '100',
    })}`));
    return (pages.data || []).map((p) => ({
      pageId: p.id,
      pageName: p.name,
      pageToken: p.access_token,
      igId: p.instagram_business_account?.id || null,
      igUsername: p.instagram_business_account?.username || null,
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

const instagram = {
  id: 'instagram',
  name: 'Instagram',
  ...shared,
  accountFromPage: (page, pages) => page?.igId && {
    displayName: `@${page.igUsername}`, igId: page.igId, pageId: page.pageId, token: page.pageToken,
    pages: pages.filter((p) => p.igId).map(({ pageId, pageName, igUsername }) => ({ pageId, pageName: `@${igUsername} (${pageName})` })),
  },
  // Instagram-Reel: Container anlegen → Datei direkt hochladen → warten bis verarbeitet → veröffentlichen
  async publish(account, { file, texts }) {
    const container = await request(graph(`${account.igId}/media`), {
      method: 'POST',
      form: {
        media_type: 'REELS', upload_type: 'resumable', caption: texts.instagram.caption,
        share_to_feed: 'true', access_token: account.token,
      },
    });
    await request(rupload(`ig-api-upload/${config.META_GRAPH_VERSION}/${container.id}`), {
      method: 'POST',
      headers: { Authorization: `OAuth ${account.token}`, offset: '0', file_size: String(fileSize(file)) },
      body: readFile(file),
    });
    for (let i = 0; i < 60; i++) {
      const s = await request(graph(`${container.id}?fields=status_code,status&access_token=${account.token}`));
      if (s.status_code === 'FINISHED') break;
      if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error(`Instagram-Verarbeitung fehlgeschlagen: ${s.status || s.status_code}`);
      if (i === 59) throw new Error('Instagram verarbeitet das Video zu lange – bitte später erneut versuchen.');
      await sleep(5000);
    }
    const pub = await request(graph(`${account.igId}/media_publish`), {
      method: 'POST', form: { creation_id: container.id, access_token: account.token },
    });
    let url = null;
    try {
      url = (await request(graph(`${pub.id}?fields=permalink&access_token=${account.token}`))).permalink;
    } catch { /* Link ist nur Komfort */ }
    return { id: pub.id, url };
  },
};

module.exports = { facebook, instagram };
