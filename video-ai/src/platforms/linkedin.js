// LinkedIn über die offizielle Posts- und Videos-API (REST, versioniert).
// Ohne LINKEDIN_ORGANIZATION_ID wird im Namen der verknüpften Person gepostet,
// mit ID auf der Unternehmensseite (erfordert die „Community Management API“).
const config = require('../config');
const { request, sleep, readFile, fileSize } = require('./http');

const REST = 'https://api.linkedin.com/rest';
const restHeaders = (token) => ({
  Authorization: `Bearer ${token}`,
  'LinkedIn-Version': config.LINKEDIN_VERSION,
  'X-Restli-Protocol-Version': '2.0.0',
});

// LinkedIn verlangt in „commentary“ das Escapen reservierter Zeichen; Hashtags bekommen eigenes Markup.
function toLittleText(text) {
  const parts = text.split(/(#[\p{L}\p{N}_]+)/u);
  return parts.map((p) => (p.startsWith('#') && p.length > 1
    ? `{hashtag|\\#|${p.slice(1)}}`
    : p.replace(/[\\|{}@\[\]()<>#*_~]/g, (c) => `\\${c}`))).join('');
}

module.exports = {
  id: 'linkedin',
  name: 'LinkedIn',
  configured: () => Boolean(config.LINKEDIN_CLIENT_ID && config.LINKEDIN_CLIENT_SECRET),
  requiredEnv: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'],
  authUrl(state, redirectUri) {
    const scopes = ['openid', 'profile', 'w_member_social'];
    if (config.LINKEDIN_ORGANIZATION_ID) scopes.push('w_organization_social');
    const q = new URLSearchParams({
      response_type: 'code', client_id: config.LINKEDIN_CLIENT_ID, redirect_uri: redirectUri, state, scope: scopes.join(' '),
    });
    return `https://www.linkedin.com/oauth/v2/authorization?${q}`;
  },
  async handleCallback(code, redirectUri) {
    const tok = await request('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      form: {
        grant_type: 'authorization_code', code, redirect_uri: redirectUri,
        client_id: config.LINKEDIN_CLIENT_ID, client_secret: config.LINKEDIN_CLIENT_SECRET,
      },
    });
    const me = await request('https://api.linkedin.com/v2/userinfo', { headers: { Authorization: `Bearer ${tok.access_token}` } });
    const org = config.LINKEDIN_ORGANIZATION_ID;
    return {
      displayName: org ? `${me.name} → Unternehmensseite ${org}` : me.name,
      author: org ? `urn:li:organization:${org}` : `urn:li:person:${me.sub}`,
      token: tok.access_token,
      refreshToken: tok.refresh_token || null,
      expiresAt: tok.expires_in ? Date.now() + tok.expires_in * 1000 : null,
    };
  },
  async publish(account, { file, texts, item }) {
    const size = fileSize(file);
    const init = await request(`${REST}/videos?action=initializeUpload`, {
      method: 'POST',
      headers: restHeaders(account.token),
      json: { initializeUploadRequest: { owner: account.author, fileSizeBytes: size, uploadCaptions: false, uploadThumbnail: false } },
    });
    const { uploadInstructions, video, uploadToken } = init.value;
    const data = readFile(file);
    const etags = [];
    for (const part of uploadInstructions) {
      const res = await request(part.uploadUrl, {
        method: 'PUT', raw: true,
        headers: { 'Content-Type': 'application/octet-stream' },
        body: data.subarray(part.firstByte, part.lastByte + 1),
      });
      etags.push(res.headers.get('etag'));
    }
    await request(`${REST}/videos?action=finalizeUpload`, {
      method: 'POST',
      headers: restHeaders(account.token),
      json: { finalizeUploadRequest: { video, uploadToken: uploadToken || '', uploadedPartIds: etags } },
    });
    for (let i = 0; i < 40; i++) {
      const v = await request(`${REST}/videos/${encodeURIComponent(video)}`, { headers: restHeaders(account.token) });
      if (v.status === 'AVAILABLE') break;
      if (v.status === 'PROCESSING_FAILED') throw new Error('LinkedIn konnte das Video nicht verarbeiten.');
      await sleep(5000);
    }
    const post = await request(`${REST}/posts`, {
      method: 'POST',
      headers: restHeaders(account.token),
      json: {
        author: account.author,
        commentary: toLittleText(texts.linkedin.caption),
        visibility: 'PUBLIC',
        distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
        content: { media: { title: item.hook || 'GR·EAT Reel', id: video } },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
      },
    });
    const id = post._headers.get('x-restli-id');
    return { id, url: id ? `https://www.linkedin.com/feed/update/${id}` : null };
  },
  toLittleText,
};
