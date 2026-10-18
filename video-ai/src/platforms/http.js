// Kleine Helfer für die Plattform-APIs (Node 20+ hat fetch eingebaut).
const fs = require('fs');

async function request(url, { method = 'GET', headers = {}, json, form, body, raw = false } = {}) {
  const opts = { method, headers: { ...headers } };
  if (json !== undefined) {
    opts.body = JSON.stringify(json);
    opts.headers['Content-Type'] = 'application/json';
  } else if (form !== undefined) {
    opts.body = new URLSearchParams(form).toString();
    opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
  } else if (body !== undefined) {
    opts.body = body;
  }
  const res = await fetch(url, opts);
  if (raw) {
    if (!res.ok) throw new ApiError(`${method} ${shortUrl(url)} → HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`, res.status);
    return res;
  }
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok || data.error?.message || (data.error?.code && data.error.code !== 'ok')) {
    const msg = data.error?.message || data.error_description || data.message || data.error?.code || text.slice(0, 400);
    throw new ApiError(`${method} ${shortUrl(url)} → HTTP ${res.status}: ${msg}`, res.status);
  }
  return Object.assign(data, { _headers: res.headers });
}

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const shortUrl = (u) => u.split('?')[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readFile = (file) => fs.readFileSync(file);
const fileSize = (file) => fs.statSync(file).size;

module.exports = { request, ApiError, sleep, readFile, fileSize };
