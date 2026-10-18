// YouTube Shorts über die YouTube Data API v3 (resumable Upload).
// Hochformat + ≤ 60 s + #Shorts im Titel → YouTube zeigt es als Short.
const config = require('../config');
const { request, readFile, fileSize } = require('./http');

async function refresh(account) {
  if (account.expiresAt && account.expiresAt - Date.now() > 60_000) return account;
  const tok = await request('https://oauth2.googleapis.com/token', {
    method: 'POST',
    form: {
      client_id: config.GOOGLE_CLIENT_ID, client_secret: config.GOOGLE_CLIENT_SECRET,
      refresh_token: account.refreshToken, grant_type: 'refresh_token',
    },
  });
  return { ...account, token: tok.access_token, expiresAt: Date.now() + tok.expires_in * 1000 };
}

module.exports = {
  id: 'youtube',
  name: 'YouTube',
  configured: () => Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET),
  requiredEnv: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  authUrl(state, redirectUri) {
    const q = new URLSearchParams({
      client_id: config.GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code', state,
      scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',
      access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  },
  async handleCallback(code, redirectUri) {
    const tok = await request('https://oauth2.googleapis.com/token', {
      method: 'POST',
      form: {
        code, client_id: config.GOOGLE_CLIENT_ID, client_secret: config.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri, grant_type: 'authorization_code',
      },
    });
    const ch = await request('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    const channel = ch.items?.[0];
    if (!channel) throw new Error('Mit diesem Google-Konto ist kein YouTube-Kanal verbunden.');
    return {
      displayName: channel.snippet.title,
      channelId: channel.id,
      token: tok.access_token,
      refreshToken: tok.refresh_token,
      expiresAt: Date.now() + tok.expires_in * 1000,
    };
  },
  refresh,
  async publish(account, { file, texts }) {
    const size = fileSize(file);
    const init = await request('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
      method: 'POST', raw: true,
      headers: {
        Authorization: `Bearer ${account.token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'video/mp4',
        'X-Upload-Content-Length': String(size),
      },
      body: JSON.stringify({
        snippet: {
          title: texts.youtube.title.slice(0, 100),
          description: texts.youtube.description.slice(0, 5000),
          categoryId: '22', defaultLanguage: 'de', defaultAudioLanguage: 'de',
        },
        status: { privacyStatus: config.YOUTUBE_PRIVACY, selfDeclaredMadeForKids: false },
      }),
    });
    const video = await request(init.headers.get('location'), {
      method: 'PUT',
      headers: { Authorization: `Bearer ${account.token}`, 'Content-Type': 'video/mp4' },
      body: readFile(file),
    });
    return { id: video.id, url: `https://www.youtube.com/shorts/${video.id}` };
  },
};
