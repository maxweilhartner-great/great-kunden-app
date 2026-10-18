// Zentrale Konfiguration – alles über Umgebungsvariablen (siehe .env.example).
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');

// Minimaler .env-Loader, damit keine zusätzliche Abhängigkeit nötig ist.
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const env = (key, fallback = '') => process.env[key] ?? fallback;
const DATA_DIR = path.resolve(ROOT, env('DATA_DIR', 'data'));

const config = {
  ROOT,
  PORT: Number(env('PORT', 3000)),
  PUBLIC_BASE_URL: env('PUBLIC_BASE_URL', `http://localhost:${env('PORT', 3000)}`).replace(/\/$/, ''),
  SESSION_SECRET: env('SESSION_SECRET', 'bitte-in-.env-aendern'),
  TEAM_PASSWORD: env('TEAM_PASSWORD'),
  ADMIN_PASSWORD: env('ADMIN_PASSWORD'),
  MAX_UPLOAD_MB: Number(env('MAX_UPLOAD_MB', 2048)),

  DATA_DIR,
  UPLOAD_DIR: path.join(DATA_DIR, 'uploads'),
  RENDER_DIR: path.join(DATA_DIR, 'renders'),
  WORK_DIR: path.join(DATA_DIR, 'work'),
  DB_FILE: path.join(DATA_DIR, 'db.json'),

  BRAND_DIR: path.join(ROOT, 'brand'),
  LOGO_FILE: path.resolve(ROOT, env('LOGO_FILE', 'brand/logo.png')),
  OUTRO_FILE: path.resolve(ROOT, env('OUTRO_FILE', 'brand/logo-outro.png')),
  OUTRO_SECONDS: Number(env('OUTRO_SECONDS', 2.5)),
  MUSIC_DIR: path.resolve(ROOT, env('MUSIC_DIR', 'brand/music')),
  FONT_NAME: env('SUBTITLE_FONT', 'Inter'),

  FFMPEG: env('FFMPEG_PATH', 'ffmpeg'),
  FFPROBE: env('FFPROBE_PATH', 'ffprobe'),
  PYTHON: env('PYTHON_PATH', 'python3'),
  WHISPER_MODEL: env('WHISPER_MODEL', 'small'),
  WHISPER_LANGUAGE: env('WHISPER_LANGUAGE', 'de'),

  MIN_SECONDS: 15,
  MAX_SECONDS: 30,

  META_GRAPH_VERSION: env('META_GRAPH_VERSION', 'v23.0'),
  META_APP_ID: env('META_APP_ID'),
  META_APP_SECRET: env('META_APP_SECRET'),
  META_CONFIG_ID: env('META_CONFIG_ID'),
  INSTAGRAM_APP_ID: env('INSTAGRAM_APP_ID'),
  INSTAGRAM_APP_SECRET: env('INSTAGRAM_APP_SECRET'),
  EPIDEMIC_API_KEY: env('EPIDEMIC_API_KEY'),
  EPIDEMIC_API_BASE: env('EPIDEMIC_API_BASE', 'https://api.epidemicsound.com'),
  EPIDEMIC_USER_ID: env('EPIDEMIC_USER_ID', 'great-video-ai'),
  LINKEDIN_CLIENT_ID: env('LINKEDIN_CLIENT_ID'),
  LINKEDIN_CLIENT_SECRET: env('LINKEDIN_CLIENT_SECRET'),
  LINKEDIN_ORGANIZATION_ID: env('LINKEDIN_ORGANIZATION_ID'),
  LINKEDIN_VERSION: env('LINKEDIN_VERSION', '202509'),
  GOOGLE_CLIENT_ID: env('GOOGLE_CLIENT_ID'),
  GOOGLE_CLIENT_SECRET: env('GOOGLE_CLIENT_SECRET'),
  YOUTUBE_PRIVACY: env('YOUTUBE_PRIVACY', 'public'),
  TIKTOK_CLIENT_KEY: env('TIKTOK_CLIENT_KEY'),
  TIKTOK_CLIENT_SECRET: env('TIKTOK_CLIENT_SECRET'),
  TIKTOK_PRIVACY: env('TIKTOK_PRIVACY', 'SELF_ONLY'),
};

for (const dir of [config.DATA_DIR, config.UPLOAD_DIR, config.RENDER_DIR, config.WORK_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

module.exports = config;
