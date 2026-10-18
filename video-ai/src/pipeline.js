// Video-Pipeline: Analyse → Spracherkennung (Whisper) → Auswahl des besten 15–30-s-Ausschnitts
// → Hochformat-Render mit Untertiteln, Logo und Musik (FFmpeg). Alles lokal und kostenlos.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const config = require('./config');

const W = 1080;
const H = 1920;
const FPS = 30;

function run(cmd, args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-8000)));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve({ stdout, stderr });
      const err = new Error(`${path.basename(cmd)} beendet mit Code ${code}: ${stderr.trim().split('\n').slice(-4).join(' | ')}`);
      err.code = code;
      reject(err);
    });
  });
}

async function probe(file) {
  const { stdout } = await run(config.FFPROBE, [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file,
  ]);
  const info = JSON.parse(stdout);
  const video = info.streams.find((s) => s.codec_type === 'video');
  const audio = info.streams.find((s) => s.codec_type === 'audio');
  let width = video?.width || 0;
  let height = video?.height || 0;
  const rotation = Number(
    video?.tags?.rotate ?? video?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0,
  );
  if (Math.abs(rotation) % 180 === 90) [width, height] = [height, width];
  return {
    duration: Number(info.format?.duration || video?.duration || 0),
    width,
    height,
    hasAudio: Boolean(audio),
  };
}

// ---------- Spracherkennung ----------

async function transcribe(videoFile, workDir) {
  const wav = path.join(workDir, 'audio.wav');
  const out = path.join(workDir, 'transcript.json');
  await run(config.FFMPEG, ['-y', '-i', videoFile, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
  try {
    await run(config.PYTHON, [
      path.join(config.ROOT, 'scripts', 'transcribe.py'), wav, out,
      '--model', config.WHISPER_MODEL, '--language', config.WHISPER_LANGUAGE,
    ]);
  } catch (err) {
    const reason = err.code === 3
      ? 'Whisper ist nicht installiert (pip install faster-whisper) – Video ohne Untertitel erstellt.'
      : `Spracherkennung fehlgeschlagen (${err.message.split(' | ').pop()}) – Video ohne Untertitel erstellt. Beim ersten Start lädt Whisper das Modell aus dem Internet.`;
    return { engine: null, segments: [], warning: reason };
  } finally {
    fs.rmSync(wav, { force: true });
  }
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}

// ---------- Auswahl des Ausschnitts ----------

// Wählt einen Ausschnitt von 15–30 s. Kriterien: möglichst viel Sprache drin,
// keine angeschnittenen Sätze am Anfang/Ende, wacklige erste Sekunde vermeiden.
function chooseWindow(duration, segments = []) {
  const { MIN_SECONDS: MIN, MAX_SECONDS: MAX } = config;
  if (duration <= MAX) {
    return { start: 0, length: Math.max(duration, MIN), loop: duration < MIN };
  }
  const L = MAX;
  const maxStart = duration - L;
  if (!segments.length) {
    return { start: round(Math.min(maxStart, Math.max(1, maxStart * 0.25))), length: L, loop: false };
  }

  const candidates = new Set();
  for (let s = 0; s <= maxStart; s += 0.5) candidates.add(round(s));
  for (const seg of segments) if (seg.start <= maxStart) candidates.add(round(Math.max(0, seg.start - 0.2)));

  let best = { score: -Infinity, start: 0 };
  for (const s of candidates) {
    const e = s + L;
    let score = 0;
    for (const seg of segments) {
      score += Math.max(0, Math.min(e, seg.end) - Math.max(s, seg.start));
      if (seg.start < s && seg.end > s) score -= 2; // Satz am Anfang angeschnitten
      if (seg.start < e && seg.end > e) score -= 1; // Satz am Ende angeschnitten
    }
    if (s < 0.8) score -= 0.5;
    // Reels müssen sofort starten: lange Stille am Anfang kostet Punkte.
    const firstSpeech = segments.find((seg) => seg.end > s && seg.start < e);
    if (firstSpeech) score -= 0.3 * Math.min(10, Math.max(0, firstSpeech.start - s));
    if (score > best.score) best = { score, start: s };
  }

  // Ende auf eine Satzgrenze ziehen bzw. Stille am Ende kürzen, solange mindestens 15 s bleiben.
  let end = best.start + L;
  const cut = segments.find((seg) => seg.start < end && seg.end > end);
  if (cut && cut.start - 0.1 - best.start >= MIN) end = cut.start - 0.1;
  const lastSpeech = Math.max(...segments.filter((seg) => seg.start < end && seg.end > best.start).map((seg) => Math.min(seg.end, end)));
  if (lastSpeech + 1.5 < end) end = Math.max(best.start + MIN, lastSpeech + 1.5);
  return { start: best.start, length: round(end - best.start), loop: false };
}

const round = (n) => Math.round(n * 100) / 100;

// ---------- Untertitel (ASS) ----------

const assTime = (t) => {
  t = Math.max(0, t);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = (t % 60).toFixed(2).padStart(5, '0');
  return `${h}:${String(m).padStart(2, '0')}:${s}`;
};
const assText = (s) => s.replace(/[{}\\]/g, '').replace(/\s+/g, ' ').trim();

// Kurze Untertitel-Häppchen (max. ~5 Wörter), wie man es von Reels kennt.
function chunkSegment(seg) {
  const words = assText(seg.text).split(' ').filter(Boolean);
  const chunks = [];
  let cur = [];
  for (const w of words) {
    if (cur.length && (cur.length >= 5 || [...cur, w].join(' ').length > 30)) {
      chunks.push(cur.join(' '));
      cur = [];
    }
    cur.push(w);
  }
  if (cur.length) chunks.push(cur.join(' '));
  const totalChars = chunks.reduce((n, c) => n + c.length, 0) || 1;
  const span = seg.end - seg.start;
  let t = seg.start;
  return chunks.map((text) => {
    const d = (span * text.length) / totalChars;
    const c = { start: t, end: t + d, text };
    t += d;
    return c;
  });
}

function buildAss({ segments = [], start = 0, length, loop, hook, subtitles = true }) {
  const font = config.FONT_NAME;
  const lines = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 0', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // Untertitel: weiß, kräftiger dunkler Rand, unteres Drittel (über den Plattform-Buttons)
    `Style: Sub,${font},74,&H00FFFFFF,&H00FFFFFF,&H00142A1E,&H80000000,-1,0,0,0,100,100,0,0,1,6,2,2,90,90,470,1`,
    // Überschrift/Hook: Mango-Box oben
    `Style: Hook,${font},68,&H00FFFFFF,&H00FFFFFF,&H002E8AE9,&H002E8AE9,-1,0,0,0,100,100,0,0,3,18,0,8,80,80,300,1`,
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  if (hook) {
    lines.push(`Dialogue: 1,${assTime(0.2)},${assTime(Math.min(4, length))},Hook,,0,0,0,,{\\fad(200,300)}${assText(hook)}`);
  }
  if (subtitles) {
    // Bei sehr kurzen, geloopten Clips werden die Untertitel mit wiederholt.
    const offsets = loop ? [] : [0];
    if (loop) {
      const srcLen = Math.max(...segments.map((s) => s.end), 0.1);
      for (let o = 0; o < length; o += srcLen) offsets.push(o);
    }
    for (const o of offsets) {
      for (const seg of segments) {
        for (const c of chunkSegment(seg)) {
          const s = c.start - start + o;
          const e = Math.min(c.end - start + o, length);
          if (e <= 0 || s >= length || e - s < 0.15) continue;
          lines.push(`Dialogue: 0,${assTime(s)},${assTime(e)},Sub,,0,0,0,,${c.text}`);
        }
      }
    }
  }
  return lines.join('\n') + '\n';
}

// ---------- Rendern ----------

function listMusic() {
  if (!fs.existsSync(config.MUSIC_DIR)) return [];
  return fs.readdirSync(config.MUSIC_DIR).filter((f) => /\.(mp3|m4a|aac|wav|ogg|flac)$/i.test(f)).sort();
}

function pickMusic(choice) {
  const tracks = listMusic();
  if (choice === 'none' || !tracks.length) return null;
  const name = tracks.includes(choice) ? choice : tracks[Math.floor(Math.random() * tracks.length)];
  return { name, file: path.join(config.MUSIC_DIR, name) };
}

// Bringt beliebige Formate auf 1080×1920: Hochformat wird bildfüllend beschnitten,
// Quer-/Quadratformat bekommt einen unscharfen Hintergrund statt schwarzer Balken.
function fitFilter(input, aspect, out, w = W, h = H) {
  if (aspect <= 0.75) {
    return `[${input}]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1[${out}]`;
  }
  return [
    `[${input}]split=2[${out}_a][${out}_b]`,
    `[${out}_a]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=40:4,eq=brightness=-0.1[${out}_bg]`,
    `[${out}_b]scale=${w}:-2[${out}_fg]`,
    `[${out}_bg][${out}_fg]overlay=(W-w)/2:(H-h)/2,setsar=1[${out}]`,
  ].join(';');
}

// ---------- Verschönern: Stabilisieren, Ausschnitt, Bildverbesserung ----------

const filterCache = {};
async function hasFilter(name) {
  if (!(name in filterCache)) {
    try {
      const { stdout } = await run(config.FFMPEG, ['-hide_banner', '-filters']);
      filterCache[name] = new RegExp(`\\s${name}\\s`).test(stdout);
    } catch { filterCache[name] = false; }
  }
  return filterCache[name];
}

// Leicht entrauschen, Kontrast/Farbe etwas kräftiger, nachschärfen – Lebensmittel wirken appetitlicher.
const ENHANCE = 'hqdn3d=1.5:1.5:6:6,eq=contrast=1.06:saturation=1.15:gamma=1.03,unsharp=5:5:0.5';

// Ausschnitt als Anteile des Bildes (x, y, w, h zwischen 0 und 1), gewählt in der Freigabe.
function cleanCrop(c) {
  if (!c) return null;
  const v = ['x', 'y', 'w', 'h'].map((k) => Number(c[k]));
  if (v.some((n) => !Number.isFinite(n))) return null;
  let [x, y, w, h] = v;
  w = Math.min(1, Math.max(0.05, w)); h = Math.min(1, Math.max(0.05, h));
  x = Math.min(1 - w, Math.max(0, x)); y = Math.min(1 - h, Math.max(0, y));
  if (w > 0.98 && h > 0.98) return null;
  return { x, y, w, h };
}
const cropFilter = (c) => `crop=trunc(iw*${c.w.toFixed(4)}/2)*2:trunc(ih*${c.h.toFixed(4)}/2)*2:trunc(iw*${c.x.toFixed(4)}):trunc(ih*${c.y.toFixed(4)})`;

// Erster Durchgang der Stabilisierung: Kamerabewegung im gewählten Ausschnitt messen.
async function stabilizeDetect(source, window, workDir) {
  await run(config.FFMPEG, [
    '-y', '-ss', String(window.start), '-t', String(window.length), '-i', source,
    '-vf', 'vidstabdetect=shakiness=6:accuracy=12:result=transforms.trf', '-f', 'null', '-',
  ], { cwd: workDir });
}

// Vorschaubild des Originals für das Ausschnitt-Werkzeug (richtig gedreht).
async function sourcePreview(source, at, out) {
  await run(config.FFMPEG, ['-y', '-ss', String(at), '-i', source, '-frames:v', '1', '-vf', 'scale=720:-2', '-q:v', '4', out]);
}

function audioGraph({ hasVoice, voiceLabel, musicLabel, length }) {
  const fadeOut = Math.max(0, length - 1.2).toFixed(2);
  const fades = `afade=t=in:d=0.3,afade=t=out:st=${fadeOut}:d=1.2`;
  if (hasVoice && musicLabel) {
    return [
      `[${voiceLabel}]aresample=48000,aformat=channel_layouts=stereo,asplit=2[voice][sc]`,
      `[${musicLabel}]aresample=48000,aformat=channel_layouts=stereo,volume=0.22[mus]`,
      // Musik wird automatisch leiser, wenn jemand spricht (Ducking)
      `[mus][sc]sidechaincompress=threshold=0.02:ratio=10:attack=15:release=450[duck]`,
      `[voice][duck]amix=inputs=2:duration=first:normalize=0,${fades}[aout]`,
    ].join(';');
  }
  if (hasVoice) return `[${voiceLabel}]aresample=48000,aformat=channel_layouts=stereo,${fades}[aout]`;
  return `[${musicLabel}]aresample=48000,aformat=channel_layouts=stereo,volume=0.7,${fades}[aout]`;
}

const encodeArgs = (length, out) => [
  '-t', String(length),
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-profile:v', 'high', '-level', '4.1',
  '-pix_fmt', 'yuv420p', '-r', String(FPS), '-g', String(FPS * 2),
  '-c:a', 'aac', '-b:a', '160k', '-ar', '48000',
  '-movflags', '+faststart', out,
];

// Logo oben links + Abspann (Logo mit Slogan „Immer gut versorgt“) in den letzten Sekunden.
// Erwartet das Bild unter [subbed], liefert [v]; `idx` ist der nächste freie FFmpeg-Eingang.
function branding(idx, length) {
  const inputs = ['-i', config.LOGO_FILE];
  const filters = [`[${idx}:v]scale=220:-1,format=rgba[logo]`];
  const outroStart = (length - config.OUTRO_SECONDS).toFixed(2);
  if (!(config.OUTRO_SECONDS > 0) || !fs.existsSync(config.OUTRO_FILE)) {
    filters.push('[subbed][logo]overlay=48:96[v]');
    return { inputs, filters, next: idx + 1 };
  }
  inputs.push('-loop', '1', '-framerate', String(FPS), '-t', String(length), '-i', config.OUTRO_FILE);
  filters.push(
    `[subbed][logo]overlay=48:96:enable='lt(t,${outroStart})'[branded]`,
    `[${idx + 1}:v]format=rgba,fade=t=in:st=${outroStart}:d=0.5:alpha=1[outro]`,
    `[branded][outro]overlay=(W-w)/2:(H-h)/2:enable='gte(t,${outroStart})'[v]`,
  );
  return { inputs, filters, next: idx + 2 };
}

async function renderVideo({ source, meta, window, music, assFile, workDir, out, look = {} }) {
  const inputs = [];
  if (window.loop) inputs.push('-stream_loop', '-1');
  inputs.push('-ss', String(window.start), '-t', String(window.length), '-i', source);
  const brand = branding(1, window.length);
  inputs.push(...brand.inputs);
  if (music) inputs.push('-stream_loop', '-1', '-i', music.file);
  let aspect = meta.width / meta.height || 9 / 16;
  const pre = [];
  if (look.stabilize) pre.push('vidstabtransform=input=transforms.trf:smoothing=15:optzoom=1:zoomspeed=0.2');
  if (look.crop) {
    pre.push(cropFilter(look.crop));
    aspect = (meta.width * look.crop.w) / (meta.height * look.crop.h);
  }
  if (look.enhance) pre.push(ENHANCE);
  const filters = [
    ...(pre.length ? [`[0:v]${pre.join(',')}[pre]`] : []),
    fitFilter(pre.length ? 'pre' : '0:v', aspect, 'base'),
    `[base]fps=${FPS},ass=${path.basename(assFile)}[subbed]`,
    ...brand.filters,
  ];
  if (meta.hasAudio || music) {
    filters.push(audioGraph({
      hasVoice: meta.hasAudio, voiceLabel: '0:a', musicLabel: music ? `${brand.next}:a` : null, length: window.length,
    }));
  }
  const maps = ['-map', '[v]'];
  if (meta.hasAudio || music) maps.push('-map', '[aout]');
  await run(config.FFMPEG, [
    '-y', ...inputs, '-filter_complex', filters.join(';'), ...maps, ...encodeArgs(window.length, out),
  ], { cwd: workDir });
}

async function renderPhotos({ photos, music, assFile, workDir, out, length, look = {} }) {
  const per = length / photos.length;
  const frames = Math.round(per * FPS);
  const inputs = [];
  const filters = [];
  photos.forEach((p, i) => {
    inputs.push('-loop', '1', '-framerate', String(FPS), '-t', per.toFixed(3), '-i', p.file);
    const zoomIn = i % 2 === 0; // abwechselnd rein- und rauszoomen (Ken-Burns-Effekt)
    const z = zoomIn ? `min(1+on*0.12/${frames},1.12)` : `max(1.12-on*0.12/${frames},1)`;
    if (look.enhance) filters.push(`[${i}:v]${ENHANCE}[en${i}]`);
    filters.push(fitFilter(look.enhance ? `en${i}` : `${i}:v`, p.width / p.height, `fit${i}`, W, H));
    filters.push(`[fit${i}]zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${FPS},setsar=1[p${i}]`);
  });
  filters.push(`${photos.map((_, i) => `[p${i}]`).join('')}concat=n=${photos.length}:v=1:a=0,ass=${path.basename(assFile)}[subbed]`);
  const brand = branding(photos.length, length);
  inputs.push(...brand.inputs);
  filters.push(...brand.filters);
  const maps = ['-map', '[v]'];
  if (music) {
    inputs.push('-stream_loop', '-1', '-i', music.file);
    filters.push(audioGraph({ hasVoice: false, musicLabel: `${brand.next}:a`, length }));
    maps.push('-map', '[aout]');
  }
  await run(config.FFMPEG, [
    '-y', ...inputs, '-filter_complex', filters.join(';'), ...maps, ...encodeArgs(length, out),
  ], { cwd: workDir });
}

async function thumbnail(video, out) {
  await run(config.FFMPEG, ['-y', '-ss', '1', '-i', video, '-frames:v', '1', '-vf', 'scale=360:-2', '-q:v', '4', out]);
}

async function normalizePhoto(src, dst) {
  try {
    await run(config.PYTHON, [path.join(config.ROOT, 'scripts', 'normalize_photo.py'), src, dst]);
    return dst;
  } catch {
    return src; // Pillow fehlt → Originaldatei direkt an FFmpeg geben
  }
}

/**
 * Erstellt (oder erneuert) das Reel für einen Eintrag.
 * `item.edit` enthält optionale manuelle Vorgaben aus der Freigabe (Start, Länge, Hook, Musik, Untertitel an/aus,
 * Ausschnitt, Verschönern/Stabilisieren an/aus).
 * `onProgress(text)` meldet den Zwischenstand an die Oberfläche.
 */
async function processItem(item, onProgress = () => {}) {
  const workDir = path.join(config.WORK_DIR, item.id);
  fs.mkdirSync(workDir, { recursive: true });
  const edit = item.edit || {};
  const warnings = [];
  const out = path.join(config.RENDER_DIR, `${item.id}.mp4`);
  const tmpOut = path.join(workDir, 'reel.mp4');
  const assFile = path.join(workDir, 'subs.ass');
  const music = pickMusic(edit.music);
  if (!music && edit.music !== 'none') warnings.push('Noch keine Musik hochgeladen (Konten → Hintergrundmusik) – Reel ohne Hintergrundmusik.');
  const result = { warnings, music: music?.name || null };

  if (item.kind === 'video') {
    const source = path.join(config.UPLOAD_DIR, item.files[0].stored);
    onProgress('Video wird analysiert …');
    const meta = await probe(source);
    if (!meta.duration) throw new Error('Video konnte nicht gelesen werden.');

    let transcript = item.transcript;
    if (!transcript) {
      if (meta.hasAudio) {
        onProgress('Spracherkennung läuft (Whisper) …');
        transcript = await transcribe(source, workDir);
        if (transcript.warning) warnings.push(transcript.warning);
      } else {
        transcript = { engine: null, segments: [] };
      }
    }
    const auto = chooseWindow(meta.duration, transcript.segments);
    const window = { ...auto };
    if (edit.start !== undefined && edit.start !== null && edit.start !== '') {
      window.start = Math.min(Math.max(0, Number(edit.start)), Math.max(0, meta.duration - 1));
    }
    if (edit.length) {
      window.length = Math.min(config.MAX_SECONDS, Math.max(config.MIN_SECONDS, Number(edit.length)));
    }
    window.loop = window.start + window.length > meta.duration + 0.05;
    if (window.loop) window.start = 0;

    fs.writeFileSync(assFile, buildAss({
      segments: transcript.segments, ...window, hook: edit.hook ?? item.hook, subtitles: edit.subtitles !== false,
    }));
    const look = { enhance: edit.enhance !== false, crop: cleanCrop(edit.crop), stabilize: false };
    if (edit.stabilize !== false && !window.loop && await hasFilter('vidstabdetect')) {
      onProgress('Wackler werden ausgeglichen …');
      try {
        await stabilizeDetect(source, window, workDir);
        look.stabilize = true;
      } catch (err) {
        warnings.push('Stabilisierung übersprungen (Analyse fehlgeschlagen).');
      }
    }
    onProgress(`Reel wird geschnitten (${window.length.toFixed(0)} s) …`);
    await renderVideo({ source, meta, window, music, assFile, workDir, out: tmpOut, look });
    const srcThumb = `${item.id}-src.jpg`;
    await sourcePreview(source, Math.min(window.start + 1, Math.max(0, meta.duration - 0.2)), path.join(config.RENDER_DIR, srcThumb));
    Object.assign(result, {
      transcript, window, sourceDuration: round(meta.duration),
      srcThumb, srcWidth: meta.width, srcHeight: meta.height,
      look: { enhance: look.enhance, stabilize: look.stabilize, crop: look.crop },
    });
  } else {
    onProgress('Fotos werden vorbereitet …');
    const photos = [];
    for (const [i, f] of item.files.entries()) {
      const file = await normalizePhoto(path.join(config.UPLOAD_DIR, f.stored), path.join(workDir, `photo${i}.jpg`));
      const meta = await probe(file);
      photos.push({ file, width: meta.width || 1080, height: meta.height || 1920 });
    }
    const length = Number(edit.length) || Math.min(config.MAX_SECONDS, Math.max(config.MIN_SECONDS, photos.length * 4));
    fs.writeFileSync(assFile, buildAss({ segments: [], length, hook: edit.hook ?? item.hook, subtitles: false }));
    onProgress(`Foto-Reel wird erstellt (${length} s) …`);
    await renderPhotos({ photos, music, assFile, workDir, out: tmpOut, length, look: { enhance: edit.enhance !== false } });
    Object.assign(result, { transcript: { engine: null, segments: [] }, window: { start: 0, length, loop: false } });
  }

  fs.renameSync(tmpOut, out);
  const thumb = path.join(config.RENDER_DIR, `${item.id}.jpg`);
  await thumbnail(out, thumb);
  fs.rmSync(workDir, { recursive: true, force: true });
  return { ...result, output: path.basename(out), thumb: path.basename(thumb) };
}

module.exports = { processItem, probe, chooseWindow, buildAss, chunkSegment, listMusic, cleanCrop };
