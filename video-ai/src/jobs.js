// Hintergrund-Warteschlangen: Rendern (eins nach dem anderen, FFmpeg ist CPU-hungrig)
// und Veröffentlichen nach der Freigabe.
const path = require('path');
const store = require('./store');
const config = require('./config');
const { processItem } = require('./pipeline');
const { generateTexts } = require('./captions');
const { PLATFORMS } = require('./platforms');

const renderQueue = [];
let rendering = false;

function enqueueRender(id) {
  if (!renderQueue.includes(id)) renderQueue.push(id);
  store.updateItem(id, { status: 'processing', progress: 'Wartet auf Verarbeitung …', error: null });
  drainRender();
}

async function drainRender() {
  if (rendering) return;
  rendering = true;
  while (renderQueue.length) {
    const id = renderQueue.shift();
    const item = store.getItem(id);
    if (!item) continue;
    try {
      const result = await processItem(item, (progress) => store.updateItem(id, { progress }));
      store.updateItem(id, (it) => {
        const patch = {
          ...result,
          status: 'review',
          progress: null,
          renderedAt: new Date().toISOString(),
          version: (it.version || 0) + 1,
        };
        // Texte nur beim ersten Mal automatisch erzeugen – manuelle Änderungen bleiben erhalten.
        if (!it.texts) {
          patch.texts = generateTexts({ category: it.category, note: it.note, location: it.location, transcript: result.transcript });
        }
        return patch;
      });
    } catch (err) {
      console.error(`[render ${id}]`, err);
      store.updateItem(id, { status: 'failed', progress: null, error: err.message });
    }
  }
  rendering = false;
}

async function withFreshToken(platform, account) {
  if (!platform.refresh || !account.refreshToken) return account;
  const fresh = await platform.refresh(account);
  if (fresh !== account) store.setAccount(platform.id, fresh);
  return fresh;
}

async function publishItem(id, onlyPlatforms) {
  const item = store.getItem(id);
  const targets = onlyPlatforms || item.platforms;
  store.updateItem(id, { status: 'publishing' });
  const file = path.join(config.RENDER_DIR, item.output);

  for (const pid of targets) {
    const platform = PLATFORMS[pid];
    const setResult = (r) => store.updateItem(id, (it) => ({ publishResults: { ...it.publishResults, [pid]: { ...r, at: new Date().toISOString() } } }));
    let account = store.getAccount(pid);
    if (!account) {
      setResult({ status: 'error', error: `${platform.name} ist nicht verknüpft.` });
      continue;
    }
    setResult({ status: 'running' });
    try {
      account = await withFreshToken(platform, account);
      const res = await platform.publish(account, { file, texts: item.texts, item });
      setResult({ status: 'ok', ...res });
    } catch (err) {
      console.error(`[publish ${id} → ${pid}]`, err);
      setResult({ status: 'error', error: err.message });
    }
  }

  store.updateItem(id, (it) => {
    const results = it.platforms.map((p) => it.publishResults?.[p]?.status);
    const allOk = results.every((s) => s === 'ok');
    const someOk = results.some((s) => s === 'ok');
    return { status: allOk ? 'published' : someOk ? 'partly_published' : 'publish_failed', publishedAt: someOk ? new Date().toISOString() : it.publishedAt };
  });
}

// Nach einem Neustart unterbrochene Arbeit wieder aufnehmen.
function resume() {
  for (const item of store.listItems()) {
    if (item.status === 'processing') enqueueRender(item.id);
    if (item.status === 'publishing') {
      const pending = item.platforms.filter((p) => item.publishResults?.[p]?.status !== 'ok');
      publishItem(item.id, pending);
    }
  }
}

module.exports = { enqueueRender, publishItem, resume };
