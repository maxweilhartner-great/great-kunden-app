// TikTok über die offizielle Content Posting API (Direct Post, Datei-Upload).
// Hinweis: Solange die TikTok-App nicht von TikTok geprüft („audited“) ist, dürfen
// Beiträge nur privat (SELF_ONLY) veröffentlicht werden – daher der Standardwert.
const config = require('../config');
const { request, sleep, readFile, fileSize } = require('./http');

const API = 'https://open.tiktokapis.com/v2';
const auth = (token) => ({ Authorization: `Bearer ${token}` });

async function tokenRequest(form) {
  const tok = await request(`${API}/oauth/token/`, {
    method: 'POST',
    form: { client_key: config.TIKTOK_CLIENT_KEY, client_secret: config.TIKTOK_CLIENT_SECRET, ...form },
  });
  return {
    token: tok.access_token,
    refreshToken: tok.refresh_token,
    expiresAt: Date.now() + tok.expires_in * 1000,
    openId: tok.open_id,
  };
}

// TikTok-Chunk-Regeln: Dateien ≤ 64 MB in einem Stück, sonst 10-MB-Teile (letzter Teil nimmt den Rest).
function chunkPlan(size) {
  if (size <= 64 * 1024 * 1024) return { chunkSize: size, count: 1 };
  const chunkSize = 10 * 1024 * 1024;
  return { chunkSize, count: Math.floor(size / chunkSize) };
}

module.exports = {
  id: 'tiktok',
  name: 'TikTok',
  configured: () => Boolean(config.TIKTOK_CLIENT_KEY && config.TIKTOK_CLIENT_SECRET),
  requiredEnv: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'],
  authUrl(state, redirectUri) {
    const q = new URLSearchParams({
      client_key: config.TIKTOK_CLIENT_KEY, response_type: 'code', scope: 'user.info.basic,video.publish',
      redirect_uri: redirectUri, state,
    });
    return `https://www.tiktok.com/v2/auth/authorize/?${q}`;
  },
  async handleCallback(code, redirectUri) {
    const tok = await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: redirectUri });
    const me = await request(`${API}/user/info/?fields=open_id,display_name`, { headers: auth(tok.token) });
    return { displayName: me.data?.user?.display_name || 'TikTok-Konto', ...tok };
  },
  async refresh(account) {
    if (account.expiresAt && account.expiresAt - Date.now() > 60_000) return account;
    return { ...account, ...(await tokenRequest({ grant_type: 'refresh_token', refresh_token: account.refreshToken })) };
  },
  async publish(account, { file, texts }) {
    const creator = await request(`${API}/post/publish/creator_info/query/`, {
      method: 'POST', headers: auth(account.token), json: {},
    });
    const options = creator.data?.privacy_level_options || [];
    const privacy = options.includes(config.TIKTOK_PRIVACY) ? config.TIKTOK_PRIVACY : options.includes('SELF_ONLY') ? 'SELF_ONLY' : options[0];

    const size = fileSize(file);
    const { chunkSize, count } = chunkPlan(size);
    const init = await request(`${API}/post/publish/video/init/`, {
      method: 'POST',
      headers: auth(account.token),
      json: {
        post_info: {
          title: texts.tiktok.caption.slice(0, 2200), privacy_level: privacy,
          disable_comment: false, disable_duet: false, disable_stitch: false,
        },
        source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunkSize, total_chunk_count: count },
      },
    });
    const { publish_id: publishId, upload_url: uploadUrl } = init.data;
    const data = readFile(file);
    for (let i = 0; i < count; i++) {
      const first = i * chunkSize;
      const last = i === count - 1 ? size - 1 : first + chunkSize - 1;
      await request(uploadUrl, {
        method: 'PUT', raw: true,
        headers: { 'Content-Type': 'video/mp4', 'Content-Range': `bytes ${first}-${last}/${size}` },
        body: data.subarray(first, last + 1),
      });
    }
    for (let i = 0; i < 60; i++) {
      const s = await request(`${API}/post/publish/status/fetch/`, {
        method: 'POST', headers: auth(account.token), json: { publish_id: publishId },
      });
      const status = s.data?.status;
      if (status === 'PUBLISH_COMPLETE') {
        const postId = s.data.publicaly_available_post_id?.[0] || s.data.publicly_available_post_id?.[0];
        return { id: postId || publishId, url: null, note: privacy === 'SELF_ONLY' ? 'Privat veröffentlicht (TikTok-App noch nicht geprüft)' : undefined };
      }
      if (status === 'FAILED') throw new Error(`TikTok: ${s.data.fail_reason || 'Veröffentlichung fehlgeschlagen'}`);
      await sleep(5000);
    }
    return { id: publishId, url: null, note: 'TikTok verarbeitet noch – Status in der TikTok-App prüfen.' };
  },
  chunkPlan,
};
